// throwaway — run the judged set through Bun + transformers.js + in-memory search
// to establish the parity reference for the Rust path. Dumps per-query JSON
// to spikes/104/results/bun-<corpus>.json for diff with the Rust outputs.
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadModel } from "./judged/lib/embedder";
import { queries as queriesA, corpusSlugs as slugsA } from "./judged/corpora/corpus-a";
import { queries as queriesB, corpusSlugs as slugsB } from "./judged/corpora/corpus-b";
import { queries as queriesC, corpusSlugs as slugsC } from "./judged/corpora/corpus-c";

const MODEL_ID = process.env.SPIKE_MODEL ?? "Xenova/gte-small";
const K = 5;

type Doc = { slug: string; text: string };
type Q = { query: string; category: string; relevant: string[]; partiallyRelevant?: string[] };

const corpora = [
  { name: "corpus-a", slugs: slugsA, queries: queriesA as Q[], dir: `${import.meta.dir}/judged/fixtures/corpus-a` },
  { name: "corpus-b", slugs: slugsB, queries: queriesB as Q[], dir: `${import.meta.dir}/judged/fixtures/corpus-b` },
  { name: "corpus-c", slugs: slugsC, queries: queriesC as Q[], dir: `${import.meta.dir}/judged/fixtures/corpus-c` },
];

function readCorpus(dir: string): Promise<Doc[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (f) => ({
      slug: f.replace(/\.md$/, ""),
      text: await Bun.file(join(dir, f)).text(),
    })),
  );
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}

function relevance(q: Q, slug: string): number {
  if (q.relevant.includes(slug)) return 1.0;
  if (q.partiallyRelevant?.includes(slug)) return 0.5;
  return 0.0;
}

function dcg(rel: number[]): number {
  return rel.reduce((sum, r, i) => sum + (Math.pow(2, r) - 1) / Math.log2(i + 2), 0);
}

mkdirSync(`${import.meta.dir}/results`, { recursive: true });
const tStart = performance.now();
const { embedder, loadTimeMs } = await loadModel(MODEL_ID);
console.log(`loaded ${MODEL_ID} in ${loadTimeMs.toFixed(0)} ms`);

for (const c of corpora) {
  const tCorpus = performance.now();
  const docs = await readCorpus(c.dir);

  const tDoc = performance.now();
  const docVecs = new Map<string, Float32Array>();
  for (const d of docs) docVecs.set(d.slug, await embedder.embed(d.text, false));
  const docMs = performance.now() - tDoc;

  const tQ = performance.now();
  const qVecs = new Map<string, Float32Array>();
  for (const q of c.queries) qVecs.set(q.query, await embedder.embed(q.query, true));
  const qMs = performance.now() - tQ;

  let top1 = 0;
  let rrSum = 0;
  let ndcgSum = 0;
  const perQuery: any[] = [];

  for (const q of c.queries) {
    const qv = qVecs.get(q.query)!;
    const scored: Array<{ slug: string; score: number }> = [];
    for (const [slug, v] of docVecs) scored.push({ slug, score: cosine(qv, v) });
    scored.sort((a, b) => b.score - a.score);
    const top5 = scored.slice(0, K).map((r) => r.slug);
    const rels = top5.map((s) => relevance(q, s));

    const isTop1 = relevance(q, top5[0]!) >= 1.0;
    if (isTop1) top1++;
    const idx = top5.findIndex((s) => relevance(q, s) >= 1.0);
    const rr = idx >= 0 ? 1.0 / (idx + 1) : 0;
    rrSum += rr;

    const idealRels = [
      ...q.relevant.map(() => 1.0),
      ...(q.partiallyRelevant ?? []).map(() => 0.5),
    ].sort((a, b) => b - a).slice(0, K);
    const idcg = dcg(idealRels);
    const ndcg = idcg > 0 ? dcg(rels) / idcg : 0;
    ndcgSum += ndcg;

    perQuery.push({
      query: q.query,
      category: q.category,
      top5,
      scores: scored.slice(0, K).map((r) => r.score),
      top1_hit: isTop1,
      rr,
      ndcg5: ndcg,
    });
  }

  const n = c.queries.length;
  const summary = {
    runtime: "bun+transformers.js",
    model: MODEL_ID,
    corpus: c.name,
    load_ms: loadTimeMs,
    doc_embed_ms: docMs,
    query_embed_ms: qMs,
    corpus_total_ms: performance.now() - tCorpus,
    n_queries: n,
    top1: top1 / n,
    mrr: rrSum / n,
    ndcg5: ndcgSum / n,
    per_query: perQuery,
  };

  const out = `${import.meta.dir}/results/bun-${c.name}.json`;
  writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(
    `${c.name}: top1=${(top1/n).toFixed(3)} mrr=${(rrSum/n).toFixed(3)} ndcg5=${(ndcgSum/n).toFixed(3)} → ${out}`,
  );
}

console.log(`total ${((performance.now() - tStart)/1000).toFixed(1)}s`);
