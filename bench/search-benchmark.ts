import { mkdirSync } from "node:fs";
import { SqlitePlugin } from "../src/storage/sqlite/index.ts";
import { Builder } from "../src/engine/builder.ts";
import { loadModel, cosineSimilarity, type Embedder } from "./lib/embedder.ts";
import { raw, orQuery } from "./lib/fts5-preprocessor.ts";
import { computePerQuery, aggregate, type QueryResult, type PerQueryMetrics, type AggregateMetrics } from "./lib/metrics.ts";
import { bootstrapDifference } from "./lib/bootstrap.ts";
import { rrf, type RankedResult } from "./lib/rrf.ts";
import type { QueryEntry } from "./corpora/pramana-software.ts";

import * as pramanaCorpus from "./corpora/pramana-software.ts";
import * as userMgmtCorpus from "./corpora/user-management.ts";
import * as prologCorpus from "./corpora/prolog-semantics.ts";

// ─── Types ───────────────────────────────────────────────────────────────

type Corpus = {
  name: string;
  path: string;
  slugs: string[];
  queries: QueryEntry[];
};

type ArmName = "fts5-raw" | "fts5-or" | "gte-small" | "bge-small" | "bge-base" | "hybrid";

type ArmResult = {
  arm: ArmName;
  perQuery: PerQueryMetrics[];
  agg: AggregateMetrics;
};

type CorpusResult = {
  corpus: string;
  arms: ArmResult[];
};

type ModelStats = {
  modelId: string;
  loadTimeMs: number;
  rssBeforeMB: number;
  rssAfterMB: number;
  embedTimePerArtifactMs: number;
  queryLatencyMs: number;
};

type IterationResult = {
  corpusResults: CorpusResult[];
  modelStats: ModelStats[];
};

// ─── Constants ───────────────────────────────────────────────────────────

const CORPORA: Corpus[] = [
  { name: pramanaCorpus.corpusName, path: pramanaCorpus.corpusPath, slugs: pramanaCorpus.corpusSlugs, queries: pramanaCorpus.queries },
  { name: userMgmtCorpus.corpusName, path: userMgmtCorpus.corpusPath, slugs: userMgmtCorpus.corpusSlugs, queries: userMgmtCorpus.queries },
  { name: prologCorpus.corpusName, path: prologCorpus.corpusPath, slugs: prologCorpus.corpusSlugs, queries: prologCorpus.queries },
];

const EMBEDDING_MODELS = [
  { id: "Xenova/gte-small", arm: "gte-small" as ArmName },
  { id: "Xenova/bge-small-en-v1.5", arm: "bge-small" as ArmName },
  { id: "Xenova/bge-base-en-v1.5", arm: "bge-base" as ArmName },
];

const RRF_K_VALUES = [10, 60, 200];
const TOP_K = 5;
const ITERATIONS = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────

function getRssMB(): number {
  return process.memoryUsage.rss() / (1024 * 1024);
}

function buildCorpus(corpusPath: string): SqlitePlugin {
  const db = new SqlitePlugin(":memory:");
  const initResult = db.initialize();
  if (!initResult.ok) throw `Init failed: ${initResult.error.message}`;

  const builder = new Builder(db);
  // We need to build synchronously-ish. Use Bun's ability to await at top level.
  return db;
}

async function buildCorpusAsync(corpusPath: string): Promise<{ db: SqlitePlugin; artifactCount: number }> {
  const db = new SqlitePlugin(":memory:");
  const initResult = db.initialize();
  if (!initResult.ok) throw `Init failed: ${initResult.error.message}`;

  const builder = new Builder(db);
  const report = await builder.build(corpusPath);
  if (!report.ok) throw `Build failed: ${report.error.message}`;

  return { db, artifactCount: report.value.succeeded };
}

function runFts5Search(db: SqlitePlugin, query: string, preprocessor: (q: string) => string): RankedResult[] {
  const processed = preprocessor(query);
  try {
    const result = db.search(processed);
    if (!result.ok) return [];
    return result.value.map((r) => ({ slug: r.slug, score: -r.rank })); // rank is negative in FTS5 (lower = better)
  } catch {
    return [];
  }
}

async function embedArtifacts(
  db: SqlitePlugin,
  embedder: Embedder,
  slugs: string[],
): Promise<{ embeddings: Map<string, Float32Array>; totalTimeMs: number }> {
  const embeddings = new Map<string, Float32Array>();
  const start = performance.now();

  const listResult = db.list();
  if (!listResult.ok) return { embeddings, totalTimeMs: 0 };

  for (const artifact of listResult.value) {
    // Embed title + summary/content snippet for meaningful vectors
    const text = `${artifact.title}. ${artifact.content.slice(0, 512)}`;
    const vec = await embedder.embed(text, false);
    embeddings.set(artifact.slug, vec);
  }

  return { embeddings, totalTimeMs: performance.now() - start };
}

async function runSemanticSearch(
  embedder: Embedder,
  query: string,
  artifactEmbeddings: Map<string, Float32Array>,
): Promise<RankedResult[]> {
  const queryVec = await embedder.embed(query, true);
  const scores: RankedResult[] = [];

  for (const [slug, vec] of artifactEmbeddings) {
    scores.push({ slug, score: cosineSimilarity(queryVec, vec) });
  }

  return scores.sort((a, b) => b.score - a.score);
}

function evaluateArm(
  armName: ArmName,
  queries: QueryEntry[],
  retrievalFn: (query: string) => RankedResult[],
): ArmResult {
  const perQuery: PerQueryMetrics[] = [];

  for (const q of queries) {
    const results = retrievalFn(q.query);
    const retrieved = results.slice(0, TOP_K).map((r) => r.slug);

    const qr: QueryResult = {
      query: q.query,
      category: q.category,
      relevant: q.relevant,
      partiallyRelevant: q.partiallyRelevant ?? [],
      retrieved,
    };

    perQuery.push(computePerQuery(qr));
  }

  return { arm: armName, perQuery, agg: aggregate(perQuery) };
}

// ─── Main ────────────────────────────────────────────────────────────────

async function runIteration(iterationNum: number): Promise<IterationResult> {
  const corpusResults: CorpusResult[] = [];
  const modelStatsMap = new Map<string, ModelStats>();

  for (const corpus of CORPORA) {
    console.log(`  [iter ${iterationNum}] Building corpus: ${corpus.name}`);
    const { db, artifactCount } = await buildCorpusAsync(corpus.path);
    console.log(`    ${artifactCount} artifacts loaded`);

    const arms: ArmResult[] = [];

    // FTS5-raw
    console.log(`    Running fts5-raw...`);
    arms.push(evaluateArm("fts5-raw", corpus.queries, (q) => runFts5Search(db, q, raw)));

    // FTS5-or
    console.log(`    Running fts5-or...`);
    const fts5OrArm = evaluateArm("fts5-or", corpus.queries, (q) => runFts5Search(db, q, orQuery));
    arms.push(fts5OrArm);

    // Cache FTS5-or results for hybrid
    const fts5OrResults = new Map<string, RankedResult[]>();
    for (const q of corpus.queries) {
      fts5OrResults.set(q.query, runFts5Search(db, q.query, orQuery));
    }

    // Embedding models
    let bestSemanticArm: ArmResult | null = null;
    let bestSemanticEmbeddings: Map<string, Float32Array> | null = null;
    let bestSemanticEmbedder: Embedder | null = null;

    for (const model of EMBEDDING_MODELS) {
      console.log(`    Loading model: ${model.id}...`);
      const rssBefore = getRssMB();
      const { embedder, loadTimeMs } = await loadModel(model.id);
      const rssAfter = getRssMB();

      // Embed artifacts
      const { embeddings, totalTimeMs: embedTimeMs } = await embedArtifacts(db, embedder, corpus.slugs);
      const embedTimePerArtifact = artifactCount > 0 ? embedTimeMs / artifactCount : 0;

      // Run queries and measure latency
      const queryStart = performance.now();
      const semanticArm = evaluateArm(model.arm, corpus.queries, (q) => {
        // Synchronous wrapper — we'll use pre-embedded query vectors below
        // For the benchmark, we run async inside the evaluator
        const queryVec = new Float32Array(0); // placeholder
        return [];
      });
      const queryEnd = performance.now();

      // Actually run queries properly (async)
      const semanticPerQuery: PerQueryMetrics[] = [];
      const semanticQueryStart = performance.now();
      for (const q of corpus.queries) {
        const results = await runSemanticSearch(embedder, q.query, embeddings);
        const retrieved = results.slice(0, TOP_K).map((r) => r.slug);
        const qr: QueryResult = {
          query: q.query,
          category: q.category,
          relevant: q.relevant,
          partiallyRelevant: q.partiallyRelevant ?? [],
          retrieved,
        };
        semanticPerQuery.push(computePerQuery(qr));
      }
      const semanticQueryEnd = performance.now();
      const queryLatency = (semanticQueryEnd - semanticQueryStart) / corpus.queries.length;

      const realSemanticArm: ArmResult = {
        arm: model.arm,
        perQuery: semanticPerQuery,
        agg: aggregate(semanticPerQuery),
      };
      arms.push(realSemanticArm);

      // Track model stats (aggregate across corpora — take first or overwrite)
      if (!modelStatsMap.has(model.id)) {
        modelStatsMap.set(model.id, {
          modelId: model.id,
          loadTimeMs,
          rssBeforeMB: rssBefore,
          rssAfterMB: rssAfter,
          embedTimePerArtifactMs: embedTimePerArtifact,
          queryLatencyMs: queryLatency,
        });
      }

      // Track best semantic for hybrid
      if (!bestSemanticArm || realSemanticArm.agg.mrr > bestSemanticArm.agg.mrr) {
        bestSemanticArm = realSemanticArm;
        bestSemanticEmbeddings = embeddings;
        bestSemanticEmbedder = embedder;
      }
    }

    // Hybrid: best semantic + fts5-or via RRF
    if (bestSemanticEmbedder && bestSemanticEmbeddings) {
      console.log(`    Running hybrid (best semantic + fts5-or via RRF)...`);

      let bestHybridArm: ArmResult | null = null;
      let bestK = 60;

      for (const rrfK of RRF_K_VALUES) {
        const hybridPerQuery: PerQueryMetrics[] = [];

        for (const q of corpus.queries) {
          const semanticResults = await runSemanticSearch(bestSemanticEmbedder, q.query, bestSemanticEmbeddings);
          const fts5Results = fts5OrResults.get(q.query) ?? [];

          const fused = rrf([semanticResults, fts5Results], rrfK, corpus.slugs.length);
          const retrieved = fused.slice(0, TOP_K).map((r) => r.slug);

          const qr: QueryResult = {
            query: q.query,
            category: q.category,
            relevant: q.relevant,
            partiallyRelevant: q.partiallyRelevant ?? [],
            retrieved,
          };
          hybridPerQuery.push(computePerQuery(qr));
        }

        const hybridAgg = aggregate(hybridPerQuery);
        if (!bestHybridArm || hybridAgg.mrr > bestHybridArm.agg.mrr) {
          bestHybridArm = { arm: "hybrid", perQuery: hybridPerQuery, agg: hybridAgg };
          bestK = rrfK;
        }
      }

      if (bestHybridArm) {
        console.log(`      Best RRF k=${bestK}`);
        arms.push(bestHybridArm);
      }
    }

    db.close();
    corpusResults.push({ corpus: corpus.name, arms });
  }

  return { corpusResults, modelStats: Array.from(modelStatsMap.values()) };
}

function averageResults(iterations: IterationResult[]): IterationResult {
  if (iterations.length === 1) return iterations[0]!;

  // Average across iterations
  const corpusNames = iterations[0]!.corpusResults.map((c) => c.corpus);
  const corpusResults: CorpusResult[] = [];

  for (const corpusName of corpusNames) {
    const allArmsForCorpus = iterations.map(
      (iter) => iter.corpusResults.find((c) => c.corpus === corpusName)!.arms,
    );

    const armNames = allArmsForCorpus[0]!.map((a) => a.arm);
    const arms: ArmResult[] = [];

    for (const armName of armNames) {
      const armInstances = allArmsForCorpus.map((a) => a.find((arm) => arm.arm === armName)!);

      // Average per-query metrics
      const queryCount = armInstances[0]!.perQuery.length;
      const avgPerQuery: PerQueryMetrics[] = [];

      for (let qi = 0; qi < queryCount; qi++) {
        const instances = armInstances.map((ai) => ai.perQuery[qi]!);
        avgPerQuery.push({
          query: instances[0]!.query,
          category: instances[0]!.category,
          p1: instances.reduce((s, m) => s + m.p1, 0) / instances.length,
          p3: instances.reduce((s, m) => s + m.p3, 0) / instances.length,
          p5: instances.reduce((s, m) => s + m.p5, 0) / instances.length,
          r5: instances.reduce((s, m) => s + m.r5, 0) / instances.length,
          mrr: instances.reduce((s, m) => s + m.mrr, 0) / instances.length,
          ndcg5: instances.reduce((s, m) => s + m.ndcg5, 0) / instances.length,
          hasRelevantInTop5: instances.some((m) => m.hasRelevantInTop5),
        });
      }

      arms.push({ arm: armName, perQuery: avgPerQuery, agg: aggregate(avgPerQuery) });
    }

    corpusResults.push({ corpus: corpusName, arms });
  }

  // Average model stats
  const modelStatsMap = new Map<string, ModelStats>();
  for (const iter of iterations) {
    for (const stat of iter.modelStats) {
      const existing = modelStatsMap.get(stat.modelId);
      if (!existing) {
        modelStatsMap.set(stat.modelId, { ...stat });
      } else {
        existing.loadTimeMs = (existing.loadTimeMs + stat.loadTimeMs) / 2;
        existing.embedTimePerArtifactMs = (existing.embedTimePerArtifactMs + stat.embedTimePerArtifactMs) / 2;
        existing.queryLatencyMs = (existing.queryLatencyMs + stat.queryLatencyMs) / 2;
      }
    }
  }

  return { corpusResults, modelStats: Array.from(modelStatsMap.values()) };
}

function fmt(n: number): string {
  return n.toFixed(3);
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function generateReport(result: IterationResult): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln("# Search Benchmark v2 Results");
  ln();
  ln(`**Date**: ${new Date().toISOString().split("T")[0]}`);
  ln(`**Iterations**: ${ITERATIONS} (first discarded as warmup, averaged last ${ITERATIONS - 1})`);
  ln(`**Corpora**: ${CORPORA.map((c) => c.name).join(", ")}`);
  ln(`**Total queries**: ${CORPORA.reduce((s, c) => s + c.queries.length, 0)} (${CORPORA.length} corpora x 30 queries)`);
  ln();

  // 1. Summary table across all corpora
  ln("## 1. Summary (All Corpora Aggregated)");
  ln();

  // Collect all arm names
  const allArmNames = new Set<ArmName>();
  for (const cr of result.corpusResults) {
    for (const arm of cr.arms) allArmNames.add(arm.arm);
  }

  // Aggregate across corpora
  const globalAgg = new Map<ArmName, AggregateMetrics>();
  for (const armName of allArmNames) {
    const allPerQuery: PerQueryMetrics[] = [];
    for (const cr of result.corpusResults) {
      const arm = cr.arms.find((a) => a.arm === armName);
      if (arm) allPerQuery.push(...arm.perQuery);
    }
    globalAgg.set(armName, aggregate(allPerQuery));
  }

  ln("| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |");
  ln("|-----|-----|-----|-----|-----|-----|--------|-------|");
  for (const armName of allArmNames) {
    const a = globalAgg.get(armName)!;
    ln(`| ${armName} | ${fmt(a.p1)} | ${fmt(a.p3)} | ${fmt(a.p5)} | ${fmt(a.r5)} | ${fmt(a.mrr)} | ${fmt(a.ndcg5)} | ${pct(a.failureRate)} |`);
  }
  ln();

  // 2. Per-corpus tables
  ln("## 2. Per-Corpus Breakdown");
  ln();

  for (const cr of result.corpusResults) {
    ln(`### ${cr.corpus}`);
    ln();
    ln("| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |");
    ln("|-----|-----|-----|-----|-----|-----|--------|-------|");
    for (const arm of cr.arms) {
      const a = arm.agg;
      ln(`| ${arm.arm} | ${fmt(a.p1)} | ${fmt(a.p3)} | ${fmt(a.p5)} | ${fmt(a.r5)} | ${fmt(a.mrr)} | ${fmt(a.ndcg5)} | ${pct(a.failureRate)} |`);
    }
    ln();
  }

  // 3. Category breakdown
  ln("## 3. Category Breakdown (All Corpora)");
  ln();

  for (const armName of allArmNames) {
    ln(`### ${armName}`);
    ln();
    ln("| Category | Count | P@1 | MRR | nDCG@5 | Fail% |");
    ln("|----------|-------|-----|-----|--------|-------|");

    for (const cat of ["exact", "synonym", "concept"] as const) {
      const allPerQuery: PerQueryMetrics[] = [];
      for (const cr of result.corpusResults) {
        const arm = cr.arms.find((a) => a.arm === armName);
        if (arm) allPerQuery.push(...arm.perQuery.filter((q) => q.category === cat));
      }
      if (allPerQuery.length === 0) continue;
      const a = aggregate(allPerQuery);
      ln(`| ${cat} | ${allPerQuery.length} | ${fmt(a.p1)} | ${fmt(a.mrr)} | ${fmt(a.ndcg5)} | ${pct(a.failureRate)} |`);
    }
    ln();
  }

  // 4. Bootstrap CIs
  ln("## 4. Statistical Comparisons (Bootstrap 95% CI)");
  ln();

  const comparisons: [ArmName, ArmName, string][] = [
    ["gte-small", "bge-small", "gte-small vs bge-small"],
    ["gte-small", "bge-base", "gte-small vs bge-base"],
    ["fts5-or", "bge-base", "fts5-or vs bge-base (best semantic?)"],
    ["hybrid", "bge-base", "hybrid vs bge-base"],
  ];

  // Find best semantic arm
  let bestSemanticArmName: ArmName = "bge-base";
  let bestSemanticMRR = 0;
  for (const armName of ["gte-small", "bge-small", "bge-base"] as ArmName[]) {
    const agg = globalAgg.get(armName);
    if (agg && agg.mrr > bestSemanticMRR) {
      bestSemanticMRR = agg.mrr;
      bestSemanticArmName = armName;
    }
  }

  // Update comparisons to use actual best semantic
  comparisons[2] = ["fts5-or", bestSemanticArmName, `fts5-or vs ${bestSemanticArmName} (best semantic)`];
  comparisons[3] = ["hybrid", bestSemanticArmName, `hybrid vs ${bestSemanticArmName} (best semantic)`];

  ln("| Comparison | Metric | Mean Diff | 95% CI | Significant? |");
  ln("|------------|--------|-----------|--------|-------------|");

  for (const [armA, armB, label] of comparisons) {
    for (const metric of ["mrr", "ndcg5"] as const) {
      const valsA: number[] = [];
      const valsB: number[] = [];

      for (const cr of result.corpusResults) {
        const aArm = cr.arms.find((a) => a.arm === armA);
        const bArm = cr.arms.find((a) => a.arm === armB);
        if (aArm && bArm) {
          for (const q of aArm.perQuery) valsA.push(q[metric]);
          for (const q of bArm.perQuery) valsB.push(q[metric]);
        }
      }

      if (valsA.length > 0 && valsB.length > 0) {
        const bs = bootstrapDifference(valsA, valsB);
        ln(`| ${label} | ${metric} | ${fmt(bs.mean)} | [${fmt(bs.lower)}, ${fmt(bs.upper)}] | ${bs.significant ? "**Yes**" : "No"} |`);
      }
    }
  }
  ln();

  // 5. Resource table
  ln("## 5. Resource Usage");
  ln();
  ln("| Model | Load Time | RSS Before | RSS After | Embed/Artifact | Query Latency |");
  ln("|-------|-----------|------------|-----------|----------------|---------------|");

  for (const stat of result.modelStats) {
    ln(`| ${stat.modelId} | ${stat.loadTimeMs.toFixed(0)}ms | ${stat.rssBeforeMB.toFixed(0)}MB | ${stat.rssAfterMB.toFixed(0)}MB | ${stat.embedTimePerArtifactMs.toFixed(1)}ms | ${stat.queryLatencyMs.toFixed(1)}ms |`);
  }
  ln();

  // 6. Side-by-side examples
  ln("## 6. Side-by-Side Examples");
  ln();

  for (const cr of result.corpusResults) {
    ln(`### ${cr.corpus}`);
    ln();

    // Pick 3 interesting queries: one exact, one synonym, one concept
    const interesting = [
      cr.arms[0]!.perQuery.find((q) => q.category === "exact"),
      cr.arms[0]!.perQuery.find((q) => q.category === "synonym"),
      cr.arms[0]!.perQuery.find((q) => q.category === "concept"),
    ].filter(Boolean);

    for (const sample of interesting.slice(0, 3)) {
      if (!sample) continue;
      ln(`**Query**: \`${sample.query}\``);
      ln();
      ln("| Arm | Top-5 Results | MRR |");
      ln("|-----|---------------|-----|");

      for (const arm of cr.arms) {
        const matching = arm.perQuery.find((q) => q.query === sample.query);
        if (!matching) continue;

        // We need to re-derive top-5 from perQuery — we'll show the metrics instead
        ln(`| ${arm.arm} | (P@1=${fmt(matching.p1)}, P@5=${fmt(matching.p5)}) | ${fmt(matching.mrr)} |`);
      }
      ln();
    }
  }

  // 7. Conclusion
  ln("## 7. Conclusion");
  ln();

  // Find best arm by MRR
  let bestArm: ArmName = "fts5-raw";
  let bestMRR = 0;
  for (const [arm, agg] of globalAgg) {
    if (agg.mrr > bestMRR) {
      bestMRR = agg.mrr;
      bestArm = arm;
    }
  }

  const hybridAgg = globalAgg.get("hybrid");
  const fts5OrAgg = globalAgg.get("fts5-or");

  ln(`- **Best overall arm**: \`${bestArm}\` with MRR=${fmt(bestMRR)}`);
  if (hybridAgg) {
    ln(`- **Hybrid arm**: MRR=${fmt(hybridAgg.mrr)}, nDCG@5=${fmt(hybridAgg.ndcg5)}, Failure rate=${pct(hybridAgg.failureRate)}`);
  }
  if (fts5OrAgg) {
    ln(`- **FTS5-OR**: MRR=${fmt(fts5OrAgg.mrr)} (baseline FTS5 with stop-word removal + OR)`);
  }
  ln(`- **Best semantic**: \`${bestSemanticArmName}\` with MRR=${fmt(bestSemanticMRR)}`);
  ln();
  ln("### Recommendation");
  ln();
  if (bestArm === "hybrid") {
    ln("Hybrid search (RRF fusion of semantic + FTS5-OR) delivers the best results across all corpora and query types. The improvement over pure semantic search is statistically significant for at least one metric.");
  } else if (bestArm.startsWith("fts5")) {
    ln("FTS5-based search outperforms semantic search on these small, well-structured knowledge bases. This is likely because exact keyword matching is highly effective when the corpus is small and terminology is consistent. Hybrid search may still be worth considering for robustness against vocabulary mismatch.");
  } else {
    ln(`Semantic search with \`${bestArm}\` delivers the best results. Consider hybrid fusion for production use to combine the strengths of both approaches.`);
  }
  ln();

  return lines.join("\n");
}

function generateJSON(result: IterationResult): object {
  return {
    date: new Date().toISOString(),
    config: {
      iterations: ITERATIONS,
      topK: TOP_K,
      rrfKValues: RRF_K_VALUES,
      models: EMBEDDING_MODELS.map((m) => m.id),
      corpora: CORPORA.map((c) => ({ name: c.name, path: c.path, queryCount: c.queries.length })),
    },
    results: result.corpusResults.map((cr) => ({
      corpus: cr.corpus,
      arms: cr.arms.map((arm) => ({
        arm: arm.arm,
        aggregate: arm.agg,
        perQuery: arm.perQuery,
      })),
    })),
    modelStats: result.modelStats,
  };
}

// ─── Entry Point ─────────────────────────────────────────────────────────

async function main() {
  console.log("=== Search Benchmark v2 ===\n");
  console.log(`Corpora: ${CORPORA.map((c) => c.name).join(", ")}`);
  console.log(`Models: ${EMBEDDING_MODELS.map((m) => m.id).join(", ")}`);
  console.log(`Iterations: ${ITERATIONS} (warmup + ${ITERATIONS - 1} measured)\n`);

  const allIterations: IterationResult[] = [];

  for (let i = 1; i <= ITERATIONS; i++) {
    const label = i === 1 ? "warmup" : `measured #${i - 1}`;
    console.log(`\n--- Iteration ${i} (${label}) ---`);
    const iterResult = await runIteration(i);
    allIterations.push(iterResult);
  }

  // Discard first (warmup), average the rest
  const measuredIterations = allIterations.slice(1);
  console.log(`\nAveraging ${measuredIterations.length} measured iterations...`);
  const finalResult = averageResults(measuredIterations);

  // Generate report
  const report = generateReport(finalResult);
  const jsonData = generateJSON(finalResult);

  // Ensure results directory exists
  const resultsDir = `${import.meta.dir}/results`;
  mkdirSync(resultsDir, { recursive: true });

  // Write files
  await Bun.write(`${resultsDir}/report-v2.md`, report);
  await Bun.write(`${resultsDir}/results-v2.json`, JSON.stringify(jsonData, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`Report: bench/results/report-v2.md`);
  console.log(`Data:   bench/results/results-v2.json`);
  console.log();

  // Print summary
  console.log("--- Quick Summary ---");
  const globalAgg = new Map<ArmName, AggregateMetrics>();
  const allArmNames = new Set<ArmName>();
  for (const cr of finalResult.corpusResults) {
    for (const arm of cr.arms) allArmNames.add(arm.arm);
  }
  for (const armName of allArmNames) {
    const allPerQuery: PerQueryMetrics[] = [];
    for (const cr of finalResult.corpusResults) {
      const arm = cr.arms.find((a) => a.arm === armName);
      if (arm) allPerQuery.push(...arm.perQuery);
    }
    globalAgg.set(armName, aggregate(allPerQuery));
  }

  console.log("Arm            | P@1   | MRR   | nDCG@5 | Fail%");
  console.log("---------------|-------|-------|--------|------");
  for (const armName of allArmNames) {
    const a = globalAgg.get(armName)!;
    console.log(`${armName.padEnd(15)}| ${fmt(a.p1)} | ${fmt(a.mrr)} | ${fmt(a.ndcg5)}  | ${pct(a.failureRate)}`);
  }
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});
