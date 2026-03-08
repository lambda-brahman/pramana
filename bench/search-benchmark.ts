/**
 * Search Benchmark: FTS5 vs all-MiniLM-L6-v2 semantic search
 *
 * Usage: bun run bench/search-benchmark.ts <knowledge-base-dir>
 *
 * Loads a real knowledge base, runs the query set against both engines,
 * computes metrics, and prints a comparison report.
 */

import { Builder } from "../src/engine/builder.ts";
import { SqlitePlugin } from "../src/storage/sqlite/index.ts";
import type { SearchResult } from "../src/storage/interface.ts";
import { loadModel, embed, cosineSimilarity } from "./embedder.ts";
import { QUERY_SET, type QueryEntry } from "./ground-truth.ts";
import {
  precisionAtK,
  recallAtK,
  reciprocalRank,
  aggregate,
  percentiles,
  type RankedResult,
} from "./metrics.ts";

// ── Config ──────────────────────────────────────────────────────────────

const KB_DIR = process.argv[2];
if (!KB_DIR) {
  console.error("Usage: bun run bench/search-benchmark.ts <knowledge-base-dir>");
  process.exit(1);
}

// ── Build corpus ────────────────────────────────────────────────────────

console.log(`\n📂 Loading knowledge base from: ${KB_DIR}`);

const storage = new SqlitePlugin();
storage.initialize();

const builder = new Builder(storage);
const buildStart = performance.now();
const buildResult = await builder.build(KB_DIR);
const buildTimeMs = performance.now() - buildStart;

if (!buildResult.ok) {
  console.error("Build failed:", buildResult.error);
  process.exit(1);
}

const report = buildResult.value;
console.log(`   ${report.succeeded}/${report.total} artifacts loaded in ${buildTimeMs.toFixed(1)}ms`);
if (report.failed.length > 0) {
  console.log(`   ⚠ ${report.failed.length} failed:`, report.failed.map((f) => f.file));
}

// ── Build embedding index ───────────────────────────────────────────────

console.log(`\n🤖 Loading all-MiniLM-L6-v2 model...`);
const { loadTimeMs: modelLoadMs } = await loadModel();
console.log(`   Model loaded in ${modelLoadMs.toFixed(0)}ms`);

// Get all artifacts for embedding
const allArtifacts = storage.list();
if (!allArtifacts.ok) {
  console.error("Failed to list artifacts:", allArtifacts.error);
  process.exit(1);
}

type EmbeddedArtifact = { slug: string; title: string; vector: Float32Array };
const embeddedIndex: EmbeddedArtifact[] = [];

console.log(`\n📐 Computing embeddings for ${allArtifacts.value.length} artifacts...`);
const embedStart = performance.now();

for (const artifact of allArtifacts.value) {
  // Embed a composite of title + summary + aliases + content (matching what FTS5 indexes)
  const textParts = [artifact.title];
  if (artifact.summary) textParts.push(artifact.summary);
  if (artifact.aliases) textParts.push(artifact.aliases.join(", "));
  textParts.push(artifact.content);
  const text = textParts.join("\n");

  const vector = await embed(text);
  embeddedIndex.push({ slug: artifact.slug, title: artifact.title, vector });
}

const embedTimeMs = performance.now() - embedStart;
console.log(`   ${embeddedIndex.length} embeddings computed in ${embedTimeMs.toFixed(0)}ms`);
const embedPerArtifact = embedTimeMs / embeddedIndex.length;
console.log(`   ${embedPerArtifact.toFixed(1)}ms per artifact`);

// ── Semantic search function ────────────────────────────────────────────

async function semanticSearch(query: string): Promise<RankedResult[]> {
  const qVec = await embed(query);
  const scored = embeddedIndex.map((a) => ({
    slug: a.slug,
    score: cosineSimilarity(qVec, a.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ── FTS5 search wrapper ─────────────────────────────────────────────────

function fts5Search(query: string): RankedResult[] {
  const result = storage.search(query);
  if (!result.ok) return [];
  return result.value.map((r: SearchResult) => ({
    slug: r.slug,
    score: -r.rank, // FTS5 rank is negative (lower = better), flip for consistency
  }));
}

// ── Run benchmark ───────────────────────────────────────────────────────

type QueryResult = {
  query: string;
  category: string;
  fts5: { results: RankedResult[]; latencyMs: number; precisionAt3: number; precisionAt5: number; recallAt5: number; rr: number };
  semantic: { results: RankedResult[]; latencyMs: number; precisionAt3: number; precisionAt5: number; recallAt5: number; rr: number };
};

console.log(`\n🏃 Running ${QUERY_SET.length} queries...\n`);

const queryResults: QueryResult[] = [];
const fts5Latencies: number[] = [];
const semanticLatencies: number[] = [];
let fts5Errors = 0;

for (const entry of QUERY_SET) {
  // FTS5
  const fts5Start = performance.now();
  let fts5Results: RankedResult[];
  try {
    fts5Results = fts5Search(entry.query);
  } catch {
    fts5Results = [];
    fts5Errors++;
  }
  const fts5Ms = performance.now() - fts5Start;
  fts5Latencies.push(fts5Ms);

  // Semantic
  const semStart = performance.now();
  const semResults = await semanticSearch(entry.query);
  const semMs = performance.now() - semStart;
  semanticLatencies.push(semMs);

  queryResults.push({
    query: entry.query,
    category: entry.category,
    fts5: {
      results: fts5Results,
      latencyMs: fts5Ms,
      precisionAt3: precisionAtK(fts5Results, entry.relevant, 3),
      precisionAt5: precisionAtK(fts5Results, entry.relevant, 5),
      recallAt5: recallAtK(fts5Results, entry.relevant, 5),
      rr: reciprocalRank(fts5Results, entry.relevant),
    },
    semantic: {
      results: semResults,
      latencyMs: semMs,
      precisionAt3: precisionAtK(semResults, entry.relevant, 3),
      precisionAt5: precisionAtK(semResults, entry.relevant, 5),
      recallAt5: recallAtK(semResults, entry.relevant, 5),
      rr: reciprocalRank(semResults, entry.relevant),
    },
  });
}

// ── Memory footprint ────────────────────────────────────────────────────

const memUsage = process.memoryUsage();

// ── Report ──────────────────────────────────────────────────────────────

console.log("═".repeat(90));
console.log("  SEARCH BENCHMARK RESULTS");
console.log("═".repeat(90));

// Per-query detail table
console.log("\n┌─ Per-Query Breakdown ─────────────────────────────────────────────────────────────────┐\n");
console.log(
  `${"Query".padEnd(50)} ${"Cat".padEnd(8)} ${"FTS5 P@3".padEnd(10)} ${"SEM P@3".padEnd(10)} ${"FTS5 R@5".padEnd(10)} ${"SEM R@5".padEnd(10)} ${"FTS5 RR".padEnd(10)} ${"SEM RR".padEnd(10)}`
);
console.log("─".repeat(118));

for (const qr of queryResults) {
  const q = qr.query.length > 48 ? qr.query.slice(0, 45) + "..." : qr.query;
  console.log(
    `${q.padEnd(50)} ${qr.category.padEnd(8)} ${qr.fts5.precisionAt3.toFixed(2).padEnd(10)} ${qr.semantic.precisionAt3.toFixed(2).padEnd(10)} ${qr.fts5.recallAt5.toFixed(2).padEnd(10)} ${qr.semantic.recallAt5.toFixed(2).padEnd(10)} ${qr.fts5.rr.toFixed(2).padEnd(10)} ${qr.semantic.rr.toFixed(2).padEnd(10)}`
  );
}

// Aggregate by category
console.log("\n┌─ Aggregate Metrics ───────────────────────────────────────────────────────────────────┐\n");

for (const category of ["exact", "synonym", "concept", "ALL"] as const) {
  const filtered =
    category === "ALL"
      ? queryResults
      : queryResults.filter((q) => q.category === category);

  const fts5Agg = aggregate(filtered.map((q) => q.fts5));
  const semAgg = aggregate(filtered.map((q) => q.semantic));

  console.log(`  ${category.toUpperCase()} (${filtered.length} queries)`);
  console.log(`  ${"Metric".padEnd(20)} ${"FTS5".padEnd(12)} ${"Semantic".padEnd(12)} ${"Delta".padEnd(12)}`);
  console.log(`  ${"─".repeat(56)}`);

  const rows = [
    ["Mean P@3", fts5Agg.meanP3, semAgg.meanP3],
    ["Mean P@5", fts5Agg.meanP5, semAgg.meanP5],
    ["Mean R@5", fts5Agg.meanR5, semAgg.meanR5],
    ["MRR", fts5Agg.mrr, semAgg.mrr],
  ] as const;

  for (const [label, fts5Val, semVal] of rows) {
    const delta = semVal - fts5Val;
    const sign = delta > 0 ? "+" : "";
    console.log(
      `  ${label.padEnd(20)} ${fts5Val.toFixed(3).padEnd(12)} ${semVal.toFixed(3).padEnd(12)} ${(sign + delta.toFixed(3)).padEnd(12)}`
    );
  }
  console.log();
}

// Latency
console.log("┌─ Latency ─────────────────────────────────────────────────────────────────────────────┐\n");
const fts5P = percentiles(fts5Latencies);
const semP = percentiles(semanticLatencies);

console.log(`  ${"".padEnd(12)} ${"p50".padEnd(12)} ${"p95".padEnd(12)} ${"p99".padEnd(12)}`);
console.log(`  ${"FTS5".padEnd(12)} ${(fts5P.p50.toFixed(2) + "ms").padEnd(12)} ${(fts5P.p95.toFixed(2) + "ms").padEnd(12)} ${(fts5P.p99.toFixed(2) + "ms").padEnd(12)}`);
console.log(`  ${"Semantic".padEnd(12)} ${(semP.p50.toFixed(2) + "ms").padEnd(12)} ${(semP.p95.toFixed(2) + "ms").padEnd(12)} ${(semP.p99.toFixed(2) + "ms").padEnd(12)}`);

// Overhead
console.log("\n┌─ Overhead ────────────────────────────────────────────────────────────────────────────┐\n");
console.log(`  Model load:            ${modelLoadMs.toFixed(0)}ms`);
console.log(`  Embed ${embeddedIndex.length} artifacts:    ${embedTimeMs.toFixed(0)}ms (${embedPerArtifact.toFixed(1)}ms/artifact)`);
console.log(`  Build (FTS5 only):     ${buildTimeMs.toFixed(0)}ms`);
console.log(`  Memory RSS:            ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Memory Heap Used:      ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
if (fts5Errors > 0) {
  console.log(`  FTS5 query errors:     ${fts5Errors}/${QUERY_SET.length}`);
}

// Top-results comparison for interesting queries
console.log("\n┌─ Side-by-Side: Top-5 Results (selected queries) ─────────────────────────────────────┐\n");

const showcase = queryResults.filter((q) =>
  ["how does search work", "database backend persistence layer", "AI assistant integration", "how does Claude access domain knowledge", "markdown to structured data pipeline"].includes(q.query)
);

for (const qr of showcase) {
  console.log(`  Query: "${qr.query}" [${qr.category}]`);
  console.log(`  Expected: ${queryResults.find((q) => q.query === qr.query) ? QUERY_SET.find((q) => q.query === qr.query)?.relevant.join(", ") : "?"}`);
  console.log(`  ${"FTS5".padEnd(40)} ${"Semantic"}`);
  const maxLen = Math.max(qr.fts5.results.length, 5);
  for (let i = 0; i < Math.min(maxLen, 5); i++) {
    const f = qr.fts5.results[i];
    const s = qr.semantic.results[i];
    const fStr = f ? `${f.slug} (${f.score.toFixed(3)})` : "—";
    const sStr = s ? `${s.slug} (${s.score.toFixed(3)})` : "—";
    console.log(`  ${(i + 1 + ". " + fStr).padEnd(40)} ${i + 1}. ${sStr}`);
  }
  console.log();
}

console.log("═".repeat(90));

// ── JSON output for machine consumption ─────────────────────────────────

const jsonReport = {
  corpus: { dir: KB_DIR, artifacts: report.succeeded, buildTimeMs },
  model: { id: "Xenova/all-MiniLM-L6-v2", loadTimeMs: modelLoadMs, embedTimeMs, embedPerArtifactMs: embedPerArtifact },
  memory: { rss: memUsage.rss, heapUsed: memUsage.heapUsed },
  latency: { fts5: fts5P, semantic: semP },
  aggregates: {
    exact: {
      fts5: aggregate(queryResults.filter((q) => q.category === "exact").map((q) => q.fts5)),
      semantic: aggregate(queryResults.filter((q) => q.category === "exact").map((q) => q.semantic)),
    },
    synonym: {
      fts5: aggregate(queryResults.filter((q) => q.category === "synonym").map((q) => q.fts5)),
      semantic: aggregate(queryResults.filter((q) => q.category === "synonym").map((q) => q.semantic)),
    },
    concept: {
      fts5: aggregate(queryResults.filter((q) => q.category === "concept").map((q) => q.fts5)),
      semantic: aggregate(queryResults.filter((q) => q.category === "concept").map((q) => q.semantic)),
    },
    all: {
      fts5: aggregate(queryResults.map((q) => q.fts5)),
      semantic: aggregate(queryResults.map((q) => q.semantic)),
    },
  },
  perQuery: queryResults.map((qr) => ({
    query: qr.query,
    category: qr.category,
    fts5: { top5: qr.fts5.results.slice(0, 5).map((r) => r.slug), p3: qr.fts5.precisionAt3, r5: qr.fts5.recallAt5, rr: qr.fts5.rr, ms: qr.fts5.latencyMs },
    semantic: { top5: qr.semantic.results.slice(0, 5).map((r) => r.slug), p3: qr.semantic.precisionAt3, r5: qr.semantic.recallAt5, rr: qr.semantic.rr, ms: qr.semantic.latencyMs },
  })),
};

const outPath = "bench/results.json";
await Bun.write(outPath, JSON.stringify(jsonReport, null, 2));
console.log(`\n📄 JSON results written to ${outPath}`);
