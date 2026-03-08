/**
 * Multi-Model Search Benchmark: FTS5 vs multiple semantic models vs hybrid (RRF)
 *
 * Usage: bun run bench/search-benchmark.ts <knowledge-base-dir>
 *
 * Loads a real knowledge base, runs the query set against FTS5, four embedding
 * models, and a hybrid RRF approach for each model, then prints a consolidated
 * comparison report.
 */

import { Builder } from "../src/engine/builder.ts";
import { SqlitePlugin } from "../src/storage/sqlite/index.ts";
import type { SearchResult } from "../src/storage/interface.ts";
import { loadModel, cosineSimilarity, type Embedder } from "./embedder.ts";
import { QUERY_SET } from "./ground-truth.ts";
import {
  precisionAt1,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  aggregate,
  percentiles,
  type RankedResult,
} from "./metrics.ts";

// -- Config -------------------------------------------------------------------

const KB_DIR = process.argv[2];
if (!KB_DIR) {
  console.error("Usage: bun run bench/search-benchmark.ts <knowledge-base-dir>");
  process.exit(1);
}

const MODELS = [
  { id: "Xenova/all-MiniLM-L6-v2", dim: 384 },
  { id: "Xenova/bge-small-en-v1.5", dim: 384 },
  { id: "Xenova/gte-small", dim: 384 },
  { id: "Xenova/bge-base-en-v1.5", dim: 768 },
] as const;

const RRF_K = 60;

// -- Types --------------------------------------------------------------------

type PerQueryMetrics = {
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  recallAt5: number;
  rr: number;
};

type MethodQueryResult = PerQueryMetrics & {
  results: RankedResult[];
  latencyMs: number;
};

type ModelBenchmark = {
  modelId: string;
  dim: number;
  loadTimeMs: number;
  rssDeltaMB: number;
  embedTimeMs: number;
  embedPerArtifactMs: number;
  semantic: {
    perQuery: Array<{ query: string; category: string } & MethodQueryResult>;
    latencies: number[];
  };
  hybrid: {
    perQuery: Array<{ query: string; category: string } & MethodQueryResult>;
    latencies: number[];
  };
};

// -- Build corpus -------------------------------------------------------------

console.log(`\n--- Loading knowledge base from: ${KB_DIR}`);

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
console.log(`    ${report.succeeded}/${report.total} artifacts loaded in ${buildTimeMs.toFixed(1)}ms`);
if (report.failed.length > 0) {
  console.log(`    WARNING: ${report.failed.length} failed:`, report.failed.map((f) => f.file));
}

// -- Get all artifacts --------------------------------------------------------

const allArtifacts = storage.list();
if (!allArtifacts.ok) {
  console.error("Failed to list artifacts:", allArtifacts.error);
  process.exit(1);
}

const artifacts = allArtifacts.value;

// -- FTS5 search wrapper ------------------------------------------------------

function fts5Search(query: string): RankedResult[] {
  const result = storage.search(query);
  if (!result.ok) return [];
  return result.value.map((r: SearchResult) => ({
    slug: r.slug,
    score: -r.rank, // FTS5 rank is negative (lower = better), flip for consistency
  }));
}

function computeMetrics(results: RankedResult[], relevant: string[]): PerQueryMetrics {
  return {
    precisionAt1: precisionAt1(results, relevant),
    precisionAt3: precisionAtK(results, relevant, 3),
    precisionAt5: precisionAtK(results, relevant, 5),
    recallAt5: recallAtK(results, relevant, 5),
    rr: reciprocalRank(results, relevant),
  };
}

// -- Run FTS5 baseline --------------------------------------------------------

console.log(`\n--- Running FTS5 baseline (${QUERY_SET.length} queries)...`);

const fts5PerQuery: Array<{ query: string; category: string } & MethodQueryResult> = [];
const fts5Latencies: number[] = [];
let fts5Errors = 0;

for (const entry of QUERY_SET) {
  const start = performance.now();
  let results: RankedResult[];
  try {
    results = fts5Search(entry.query);
  } catch {
    results = [];
    fts5Errors++;
  }
  const latencyMs = performance.now() - start;
  fts5Latencies.push(latencyMs);

  const metrics = computeMetrics(results, entry.relevant);
  fts5PerQuery.push({
    query: entry.query,
    category: entry.category,
    results,
    latencyMs,
    ...metrics,
  });
}

if (fts5Errors > 0) {
  console.log(`    WARNING: ${fts5Errors}/${QUERY_SET.length} FTS5 queries errored`);
}

// -- Reciprocal Rank Fusion ---------------------------------------------------

function hybridRRF(
  fts5Results: RankedResult[],
  semanticResults: RankedResult[],
  k: number,
): RankedResult[] {
  // Build rank maps (1-indexed)
  const fts5RankMap = new Map<string, number>();
  for (let i = 0; i < fts5Results.length; i++) {
    fts5RankMap.set(fts5Results[i]!.slug, i + 1);
  }

  const semanticRankMap = new Map<string, number>();
  for (let i = 0; i < semanticResults.length; i++) {
    semanticRankMap.set(semanticResults[i]!.slug, i + 1);
  }

  // Collect all unique slugs
  const allSlugs = new Set<string>([
    ...fts5Results.map((r) => r.slug),
    ...semanticResults.map((r) => r.slug),
  ]);

  // Compute RRF score for each slug
  const scored: RankedResult[] = [];
  for (const slug of allSlugs) {
    let score = 0;
    const fts5Rank = fts5RankMap.get(slug);
    if (fts5Rank !== undefined) {
      score += 1 / (k + fts5Rank);
    }
    const semRank = semanticRankMap.get(slug);
    if (semRank !== undefined) {
      score += 1 / (k + semRank);
    }
    scored.push({ slug, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// -- Run each model -----------------------------------------------------------

const modelBenchmarks: ModelBenchmark[] = [];

for (const model of MODELS) {
  console.log(`\n--- Loading model: ${model.id} (${model.dim}-dim)...`);

  // RSS before model load
  const rssBefore = process.memoryUsage().rss;

  const { embedder, loadTimeMs: modelLoadMs } = await loadModel(model.id);

  // RSS after model load
  const rssAfter = process.memoryUsage().rss;
  const rssDeltaMB = (rssAfter - rssBefore) / 1024 / 1024;

  console.log(`    Model loaded in ${modelLoadMs.toFixed(0)}ms (RSS delta: ${rssDeltaMB.toFixed(1)}MB)`);

  // Compute embeddings for all artifacts
  console.log(`    Computing embeddings for ${artifacts.length} artifacts...`);
  type EmbeddedArtifact = { slug: string; title: string; vector: Float32Array };
  const embeddedIndex: EmbeddedArtifact[] = [];

  const embedStart = performance.now();
  for (const artifact of artifacts) {
    const textParts = [artifact.title];
    if (artifact.summary) textParts.push(artifact.summary);
    if (artifact.aliases) textParts.push(artifact.aliases.join(", "));
    textParts.push(artifact.content);
    const text = textParts.join("\n");

    const vector = await embedder.embed(text);
    embeddedIndex.push({ slug: artifact.slug, title: artifact.title, vector });
  }

  const embedTimeMs = performance.now() - embedStart;
  const embedPerArtifactMs = embedTimeMs / embeddedIndex.length;
  console.log(`    ${embeddedIndex.length} embeddings in ${embedTimeMs.toFixed(0)}ms (${embedPerArtifactMs.toFixed(1)}ms/artifact)`);

  // Semantic search function for this model
  async function semanticSearch(query: string): Promise<RankedResult[]> {
    const qVec = await embedder.embed(query);
    const scored = embeddedIndex.map((a) => ({
      slug: a.slug,
      score: cosineSimilarity(qVec, a.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // Run queries
  console.log(`    Running ${QUERY_SET.length} queries...`);

  const semanticPerQuery: Array<{ query: string; category: string } & MethodQueryResult> = [];
  const semanticLatencies: number[] = [];
  const hybridPerQuery: Array<{ query: string; category: string } & MethodQueryResult> = [];
  const hybridLatencies: number[] = [];

  for (let qi = 0; qi < QUERY_SET.length; qi++) {
    const entry = QUERY_SET[qi]!;

    // Semantic
    const semStart = performance.now();
    const semResults = await semanticSearch(entry.query);
    const semMs = performance.now() - semStart;
    semanticLatencies.push(semMs);

    const semMetrics = computeMetrics(semResults, entry.relevant);
    semanticPerQuery.push({
      query: entry.query,
      category: entry.category,
      results: semResults,
      latencyMs: semMs,
      ...semMetrics,
    });

    // Hybrid (RRF)
    const hybStart = performance.now();
    const fts5ForHybrid = fts5PerQuery[qi]!.results;
    const hybResults = hybridRRF(fts5ForHybrid, semResults, RRF_K);
    const hybMs = performance.now() - hybStart;
    hybridLatencies.push(hybMs);

    const hybMetrics = computeMetrics(hybResults, entry.relevant);
    hybridPerQuery.push({
      query: entry.query,
      category: entry.category,
      results: hybResults,
      latencyMs: hybMs,
      ...hybMetrics,
    });
  }

  modelBenchmarks.push({
    modelId: model.id,
    dim: model.dim,
    loadTimeMs: modelLoadMs,
    rssDeltaMB,
    embedTimeMs,
    embedPerArtifactMs,
    semantic: { perQuery: semanticPerQuery, latencies: semanticLatencies },
    hybrid: { perQuery: hybridPerQuery, latencies: hybridLatencies },
  });
}

// -- Memory snapshot ----------------------------------------------------------

const memUsage = process.memoryUsage();

// -- Consolidated Report ------------------------------------------------------

const W = 100;
const SEP = "=".repeat(W);
const THIN = "-".repeat(W);

console.log(`\n${SEP}`);
console.log("  MULTI-MODEL SEARCH BENCHMARK RESULTS");
console.log(SEP);

// Column labels: FTS5 + semantic per model + hybrid per model
const modelShortNames = MODELS.map((m) => m.id.split("/")[1]!);
const allMethodLabels = [
  "FTS5",
  ...modelShortNames.map((n) => `sem:${n}`),
  ...modelShortNames.map((n) => `hyb:${n}`),
];

// -- Model overhead table -----------------------------------------------------

console.log("\n--- Model Overhead\n");
console.log(
  `  ${"Model".padEnd(28)} ${"Dim".padStart(5)} ${"Load(ms)".padStart(10)} ${"RSS(MB)".padStart(10)} ${"Embed(ms)".padStart(11)} ${"ms/art".padStart(9)}`
);
console.log(`  ${THIN}`);

for (const mb of modelBenchmarks) {
  const name = mb.modelId.split("/")[1]!;
  console.log(
    `  ${name.padEnd(28)} ${String(mb.dim).padStart(5)} ${mb.loadTimeMs.toFixed(0).padStart(10)} ${mb.rssDeltaMB.toFixed(1).padStart(10)} ${mb.embedTimeMs.toFixed(0).padStart(11)} ${mb.embedPerArtifactMs.toFixed(1).padStart(9)}`
  );
}

console.log(`\n  Build (FTS5):  ${buildTimeMs.toFixed(0)}ms`);
console.log(`  Total RSS:     ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Heap Used:     ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);

// -- Aggregate metrics table --------------------------------------------------

console.log("\n--- Aggregate Metrics (ALL queries)\n");

function printAggregateTable(
  label: string,
  fts5Agg: ReturnType<typeof aggregate>,
  modelAggs: Array<{ semantic: ReturnType<typeof aggregate>; hybrid: ReturnType<typeof aggregate>; name: string }>,
) {
  // Header
  const hdr = [`  ${"Metric".padEnd(10)}`];
  hdr.push("FTS5".padStart(8));
  for (const ma of modelAggs) {
    hdr.push(`s:${ma.name}`.slice(0, 12).padStart(12));
  }
  for (const ma of modelAggs) {
    hdr.push(`h:${ma.name}`.slice(0, 12).padStart(12));
  }
  console.log(`  ${label}`);
  console.log(hdr.join(" "));
  console.log(`  ${THIN}`);

  type MetricKey = "meanP1" | "meanP3" | "meanP5" | "meanR5" | "mrr";
  const metrics: Array<[string, MetricKey]> = [
    ["P@1", "meanP1"],
    ["P@3", "meanP3"],
    ["P@5", "meanP5"],
    ["R@5", "meanR5"],
    ["MRR", "mrr"],
  ];

  for (const [name, key] of metrics) {
    const row = [`  ${name.padEnd(10)}`];
    row.push(fts5Agg[key].toFixed(3).padStart(8));
    for (const ma of modelAggs) {
      row.push(ma.semantic[key].toFixed(3).padStart(12));
    }
    for (const ma of modelAggs) {
      row.push(ma.hybrid[key].toFixed(3).padStart(12));
    }
    console.log(row.join(" "));
  }
  console.log();
}

// Compute aggregates
const fts5AggAll = aggregate(fts5PerQuery);
const modelAggsAll = modelBenchmarks.map((mb) => ({
  name: mb.modelId.split("/")[1]!.slice(0, 10),
  semantic: aggregate(mb.semantic.perQuery),
  hybrid: aggregate(mb.hybrid.perQuery),
}));

printAggregateTable("ALL queries", fts5AggAll, modelAggsAll);

// Per category
for (const category of ["exact", "synonym", "concept"] as const) {
  const ftsFiltered = fts5PerQuery.filter((q) => q.category === category);
  const ftsAgg = aggregate(ftsFiltered);
  const modelAggsCat = modelBenchmarks.map((mb) => ({
    name: mb.modelId.split("/")[1]!.slice(0, 10),
    semantic: aggregate(mb.semantic.perQuery.filter((q) => q.category === category)),
    hybrid: aggregate(mb.hybrid.perQuery.filter((q) => q.category === category)),
  }));
  printAggregateTable(`${category.toUpperCase()} queries`, ftsAgg, modelAggsCat);
}

// -- Latency table ------------------------------------------------------------

console.log("--- Query Latency\n");

console.log(
  `  ${"Method".padEnd(28)} ${"p50(ms)".padStart(10)} ${"p95(ms)".padStart(10)} ${"p99(ms)".padStart(10)}`
);
console.log(`  ${THIN}`);

const fts5Pctl = percentiles(fts5Latencies);
console.log(
  `  ${"FTS5".padEnd(28)} ${fts5Pctl.p50.toFixed(2).padStart(10)} ${fts5Pctl.p95.toFixed(2).padStart(10)} ${fts5Pctl.p99.toFixed(2).padStart(10)}`
);

for (const mb of modelBenchmarks) {
  const name = mb.modelId.split("/")[1]!;
  const semP = percentiles(mb.semantic.latencies);
  console.log(
    `  ${("sem:" + name).padEnd(28)} ${semP.p50.toFixed(2).padStart(10)} ${semP.p95.toFixed(2).padStart(10)} ${semP.p99.toFixed(2).padStart(10)}`
  );
  const hybP = percentiles(mb.hybrid.latencies);
  console.log(
    `  ${("hyb:" + name).padEnd(28)} ${hybP.p50.toFixed(2).padStart(10)} ${hybP.p95.toFixed(2).padStart(10)} ${hybP.p99.toFixed(2).padStart(10)}`
  );
}

// -- Per-query breakdown (compact) --------------------------------------------

console.log(`\n--- Per-Query P@1 Comparison\n`);

const pqHdr = [`  ${"Query".padEnd(46)} ${"Cat".padEnd(8)} ${"FTS5".padStart(5)}`];
for (const name of modelShortNames) {
  pqHdr.push(`${name.slice(0, 10)}`.padStart(12));
}
for (const name of modelShortNames) {
  pqHdr.push(`h:${name.slice(0, 8)}`.padStart(12));
}
console.log(pqHdr.join(" "));
console.log(`  ${THIN}`);

for (let qi = 0; qi < QUERY_SET.length; qi++) {
  const entry = QUERY_SET[qi]!;
  const q = entry.query.length > 44 ? entry.query.slice(0, 41) + "..." : entry.query;
  const row = [`  ${q.padEnd(46)} ${entry.category.padEnd(8)} ${fts5PerQuery[qi]!.precisionAt1.toFixed(1).padStart(5)}`];
  for (const mb of modelBenchmarks) {
    row.push(mb.semantic.perQuery[qi]!.precisionAt1.toFixed(1).padStart(12));
  }
  for (const mb of modelBenchmarks) {
    row.push(mb.hybrid.perQuery[qi]!.precisionAt1.toFixed(1).padStart(12));
  }
  console.log(row.join(" "));
}

console.log(`\n${SEP}`);

// -- JSON output --------------------------------------------------------------

const jsonReport = {
  timestamp: new Date().toISOString(),
  corpus: { dir: KB_DIR, artifacts: report.succeeded, buildTimeMs },
  memory: { rss: memUsage.rss, heapUsed: memUsage.heapUsed },
  fts5: {
    latency: percentiles(fts5Latencies),
    errors: fts5Errors,
    aggregates: {
      all: fts5AggAll,
      exact: aggregate(fts5PerQuery.filter((q) => q.category === "exact")),
      synonym: aggregate(fts5PerQuery.filter((q) => q.category === "synonym")),
      concept: aggregate(fts5PerQuery.filter((q) => q.category === "concept")),
    },
  },
  models: modelBenchmarks.map((mb) => ({
    modelId: mb.modelId,
    dim: mb.dim,
    loadTimeMs: mb.loadTimeMs,
    rssDeltaMB: mb.rssDeltaMB,
    embedTimeMs: mb.embedTimeMs,
    embedPerArtifactMs: mb.embedPerArtifactMs,
    semantic: {
      latency: percentiles(mb.semantic.latencies),
      aggregates: {
        all: aggregate(mb.semantic.perQuery),
        exact: aggregate(mb.semantic.perQuery.filter((q) => q.category === "exact")),
        synonym: aggregate(mb.semantic.perQuery.filter((q) => q.category === "synonym")),
        concept: aggregate(mb.semantic.perQuery.filter((q) => q.category === "concept")),
      },
    },
    hybrid: {
      latency: percentiles(mb.hybrid.latencies),
      aggregates: {
        all: aggregate(mb.hybrid.perQuery),
        exact: aggregate(mb.hybrid.perQuery.filter((q) => q.category === "exact")),
        synonym: aggregate(mb.hybrid.perQuery.filter((q) => q.category === "synonym")),
        concept: aggregate(mb.hybrid.perQuery.filter((q) => q.category === "concept")),
      },
    },
  })),
  perQuery: QUERY_SET.map((entry, qi) => ({
    query: entry.query,
    category: entry.category,
    relevant: entry.relevant,
    fts5: {
      top5: fts5PerQuery[qi]!.results.slice(0, 5).map((r) => r.slug),
      p1: fts5PerQuery[qi]!.precisionAt1,
      p3: fts5PerQuery[qi]!.precisionAt3,
      p5: fts5PerQuery[qi]!.precisionAt5,
      r5: fts5PerQuery[qi]!.recallAt5,
      rr: fts5PerQuery[qi]!.rr,
      ms: fts5PerQuery[qi]!.latencyMs,
    },
    models: modelBenchmarks.map((mb) => ({
      modelId: mb.modelId,
      semantic: {
        top5: mb.semantic.perQuery[qi]!.results.slice(0, 5).map((r) => r.slug),
        p1: mb.semantic.perQuery[qi]!.precisionAt1,
        p3: mb.semantic.perQuery[qi]!.precisionAt3,
        p5: mb.semantic.perQuery[qi]!.precisionAt5,
        r5: mb.semantic.perQuery[qi]!.recallAt5,
        rr: mb.semantic.perQuery[qi]!.rr,
        ms: mb.semantic.perQuery[qi]!.latencyMs,
      },
      hybrid: {
        top5: mb.hybrid.perQuery[qi]!.results.slice(0, 5).map((r) => r.slug),
        p1: mb.hybrid.perQuery[qi]!.precisionAt1,
        p3: mb.hybrid.perQuery[qi]!.precisionAt3,
        p5: mb.hybrid.perQuery[qi]!.precisionAt5,
        r5: mb.hybrid.perQuery[qi]!.recallAt5,
        rr: mb.hybrid.perQuery[qi]!.rr,
        ms: mb.hybrid.perQuery[qi]!.latencyMs,
      },
    })),
  })),
};

const outPath = "bench/results-multimodel.json";
await Bun.write(outPath, JSON.stringify(jsonReport, null, 2));
console.log(`\nJSON results written to ${outPath}`);
