// throwaway — spike #91 Q5: semantic accuracy parity on the judged set.
//
// Re-uses the corpus/query/fixture assets and metrics from the
// exploration/search-benchmark branch (issue #28). Runs the same 3 corpora
// through two vector backends with identical bge-small-en-v1.5 embeddings:
//
//   - js-map     — current EmbeddingIndex-style dot-product loop.
//   - vec-exact  — sqlite-vec vec0 with vec_distance_cosine.
//
// Both should be mathematically identical on normalized vectors. This
// confirms empirically and surfaces any float-precision or tie-break drift.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { queries as queriesA, corpusSlugs as slugsA } from "./judged/corpora/corpus-a";
import { queries as queriesB, corpusSlugs as slugsB } from "./judged/corpora/corpus-b";
import { queries as queriesC, corpusSlugs as slugsC } from "./judged/corpora/corpus-c";
import { aggregate, computePerQuery, type QueryResult } from "./judged/lib/metrics";
import { bootstrapDifference } from "./judged/lib/bootstrap";
import { loadModel, type Embedder } from "./judged/lib/embedder";

Database.setCustomSQLite(
  process.env.PRAMANA_SPIKE_SQLITE ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
);

const MODEL_ID = process.env.PRAMANA_SPIKE_MODEL ?? "Xenova/bge-small-en-v1.5";
const K = 5;

type Corpus = {
  name: string;
  slugs: string[];
  queries: typeof queriesA;
  fixtureDir: string;
};

const corpora: Corpus[] = [
  { name: "corpus-a", slugs: slugsA, queries: queriesA, fixtureDir: "judged/fixtures/corpus-a" },
  { name: "corpus-b", slugs: slugsB, queries: queriesB, fixtureDir: "judged/fixtures/corpus-b" },
  { name: "corpus-c", slugs: slugsC, queries: queriesC, fixtureDir: "judged/fixtures/corpus-c" },
];

async function readCorpus(c: Corpus): Promise<Array<{ slug: string; text: string }>> {
  const files = readdirSync(c.fixtureDir).filter((f) => f.endsWith(".md"));
  const docs: Array<{ slug: string; text: string }> = [];
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    const text = await Bun.file(join(c.fixtureDir, f)).text();
    docs.push({ slug, text });
  }
  return docs;
}

function searchJsMap(
  vectors: Map<string, Float32Array>,
  q: Float32Array,
  k: number,
): string[] {
  const scored: Array<{ slug: string; score: number }> = [];
  for (const [slug, v] of vectors) {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i]! * q[i]!;
    scored.push({ slug, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((r) => r.slug);
}

async function runBackend(
  backend: "js-map" | "vec-exact",
  corpus: Corpus,
  docVecs: Map<string, Float32Array>,
  queryVecs: Map<string, Float32Array>,
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  if (backend === "js-map") {
    for (const q of corpus.queries) {
      const qv = queryVecs.get(q.query)!;
      const retrieved = searchJsMap(docVecs, qv, K);
      results.push({
        query: q.query,
        category: q.category,
        relevant: q.relevant,
        partiallyRelevant: q.partiallyRelevant ?? [],
        retrieved,
      });
    }
    return results;
  }

  const dim = docVecs.values().next().value!.length;
  const db = new Database(":memory:");
  db.loadExtension(sqliteVec.getLoadablePath());
  db.exec(`CREATE VIRTUAL TABLE v USING vec0(slug TEXT PRIMARY KEY, embedding float[${dim}])`);
  const ins = db.prepare("INSERT INTO v(slug, embedding) VALUES (?, ?)");
  db.transaction(() => {
    for (const [slug, vec] of docVecs) ins.run(slug, new Uint8Array(vec.buffer));
  })();
  const stmt = db.prepare(
    "SELECT slug FROM v WHERE embedding MATCH ? AND k = ? ORDER BY distance",
  );
  for (const q of corpus.queries) {
    const qv = queryVecs.get(q.query)!;
    const rows = stmt.all(new Uint8Array(qv.buffer), K) as Array<{ slug: string }>;
    results.push({
      query: q.query,
      category: q.category,
      relevant: q.relevant,
      partiallyRelevant: q.partiallyRelevant ?? [],
      retrieved: rows.map((r) => r.slug),
    });
  }
  db.close();
  return results;
}

async function embedCorpus(
  embedder: Embedder,
  corpus: Corpus,
): Promise<{ docVecs: Map<string, Float32Array>; queryVecs: Map<string, Float32Array> }> {
  const docs = await readCorpus(corpus);
  const docVecs = new Map<string, Float32Array>();
  for (const d of docs) docVecs.set(d.slug, await embedder.embed(d.text, false));
  const queryVecs = new Map<string, Float32Array>();
  for (const q of corpus.queries) queryVecs.set(q.query, await embedder.embed(q.query, true));
  return { docVecs, queryVecs };
}

function fmt(x: number): string {
  return (Math.round(x * 1000) / 1000).toFixed(3);
}

async function main(): Promise<void> {
  console.log(`loading model: ${MODEL_ID}`);
  const { embedder, loadTimeMs } = await loadModel(MODEL_ID);
  console.log(`loaded in ${Math.round(loadTimeMs)}ms`);

  const allJsPerQuery: ReturnType<typeof computePerQuery>[] = [];
  const allVecPerQuery: ReturnType<typeof computePerQuery>[] = [];
  const slugDriftRows: Array<{ corpus: string; query: string; jsTop: string; vecTop: string }> = [];

  for (const c of corpora) {
    console.log(`\n=== ${c.name} (${c.slugs.length} docs, ${c.queries.length} queries) ===`);
    const { docVecs, queryVecs } = await embedCorpus(embedder, c);

    const jsResults = await runBackend("js-map", c, docVecs, queryVecs);
    const vecResults = await runBackend("vec-exact", c, docVecs, queryVecs);

    const jsPerQuery = jsResults.map(computePerQuery);
    const vecPerQuery = vecResults.map(computePerQuery);

    const jsAgg = aggregate(jsPerQuery);
    const vecAgg = aggregate(vecPerQuery);

    console.log(`                 js-map    vec-exact`);
    console.log(`  P@1          : ${fmt(jsAgg.p1)}      ${fmt(vecAgg.p1)}`);
    console.log(`  P@5          : ${fmt(jsAgg.p5)}      ${fmt(vecAgg.p5)}`);
    console.log(`  R@5          : ${fmt(jsAgg.r5)}      ${fmt(vecAgg.r5)}`);
    console.log(`  MRR          : ${fmt(jsAgg.mrr)}      ${fmt(vecAgg.mrr)}`);
    console.log(`  nDCG@5       : ${fmt(jsAgg.ndcg5)}      ${fmt(vecAgg.ndcg5)}`);
    console.log(`  failure rate : ${fmt(jsAgg.failureRate)}      ${fmt(vecAgg.failureRate)}`);

    // Per-query drift: does top-K slug list match?
    let orderMatch = 0;
    let topMatch = 0;
    for (let i = 0; i < jsResults.length; i++) {
      const js = jsResults[i]!.retrieved;
      const vec = vecResults[i]!.retrieved;
      const orderSame = js.length === vec.length && js.every((s, j) => s === vec[j]);
      if (orderSame) orderMatch++;
      if (js[0] === vec[0]) topMatch++;
      else {
        slugDriftRows.push({
          corpus: c.name,
          query: jsResults[i]!.query,
          jsTop: js[0] ?? "",
          vecTop: vec[0] ?? "",
        });
      }
    }
    console.log(
      `  parity: top-1 match ${topMatch}/${jsResults.length}, full top-${K} order match ${orderMatch}/${jsResults.length}`,
    );

    allJsPerQuery.push(...jsPerQuery);
    allVecPerQuery.push(...vecPerQuery);
  }

  console.log(`\n=== overall (${allJsPerQuery.length} queries) ===`);
  const jsAll = aggregate(allJsPerQuery);
  const vecAll = aggregate(allVecPerQuery);
  console.log(`                 js-map    vec-exact    delta`);
  const metrics: Array<[string, keyof typeof jsAll]> = [
    ["P@1", "p1"],
    ["P@5", "p5"],
    ["R@5", "r5"],
    ["MRR", "mrr"],
    ["nDCG@5", "ndcg5"],
    ["failure", "failureRate"],
  ];
  for (const [label, key] of metrics) {
    const d = (vecAll[key] as number) - (jsAll[key] as number);
    console.log(`  ${label.padEnd(12)} : ${fmt(jsAll[key] as number)}      ${fmt(vecAll[key] as number)}      ${d >= 0 ? "+" : ""}${fmt(d)}`);
  }

  // Bootstrap paired CI on MRR and nDCG@5.
  const jsMrr = allJsPerQuery.map((m) => m.mrr);
  const vecMrr = allVecPerQuery.map((m) => m.mrr);
  const mrrCi = bootstrapDifference(vecMrr, jsMrr, 10000);
  const jsNdcg = allJsPerQuery.map((m) => m.ndcg5);
  const vecNdcg = allVecPerQuery.map((m) => m.ndcg5);
  const ndcgCi = bootstrapDifference(vecNdcg, jsNdcg, 10000);
  console.log(`\nbootstrap 95% CI (vec-exact - js-map):`);
  console.log(
    `  ΔMRR    : mean=${fmt(mrrCi.mean)} [${fmt(mrrCi.lower)}, ${fmt(mrrCi.upper)}]  significant=${mrrCi.significant}`,
  );
  console.log(
    `  ΔnDCG@5 : mean=${fmt(ndcgCi.mean)} [${fmt(ndcgCi.lower)}, ${fmt(ndcgCi.upper)}]  significant=${ndcgCi.significant}`,
  );

  if (slugDriftRows.length === 0) {
    console.log(`\ntop-1 drift: none across all ${allJsPerQuery.length} queries.`);
  } else {
    console.log(`\ntop-1 drift rows (${slugDriftRows.length}):`);
    for (const r of slugDriftRows) {
      console.log(`  ${r.corpus}  "${r.query}"  js=${r.jsTop}  vec=${r.vecTop}`);
    }
  }
}

await main();
