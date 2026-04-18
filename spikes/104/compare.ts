// throwaway — diff Rust vs Bun retrieval outputs per query.
import { readFileSync } from "node:fs";

type PQ = { query: string; category: string; top5: string[]; top1_hit: boolean; rr: number; ndcg5: number };
type Result = {
  runtime: string;
  top1: number;
  mrr: number;
  ndcg5: number;
  per_query: PQ[];
};

function load(path: string): Result {
  return JSON.parse(readFileSync(path, "utf8"));
}

const DIR = `${import.meta.dir}/results`;
const corpora = ["corpus-a", "corpus-b", "corpus-c"];

console.log(
  `| corpus | n | bun top1 | rust top1 | Δ | bun MRR | rust MRR | Δ | bun nDCG | rust nDCG | Δ | top-5 full match | top-1 match |`,
);
console.log(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);

const agg = { n: 0, fullMatch: 0, t1Match: 0, bunTop1: 0, rustTop1: 0 };

for (const c of corpora) {
  const bun = load(`${DIR}/bun-${c}.json`);
  const rust = load(`${DIR}/rust-${c}.json`);

  const byQ = new Map(bun.per_query.map((q) => [q.query, q]));
  let full = 0;
  let t1 = 0;
  for (const rq of rust.per_query) {
    const bq = byQ.get(rq.query);
    if (!bq) continue;
    if (rq.top5.join("|") === bq.top5.join("|")) full++;
    if (rq.top5[0] === bq.top5[0]) t1++;
  }
  const n = rust.per_query.length;
  agg.n += n;
  agg.fullMatch += full;
  agg.t1Match += t1;
  agg.bunTop1 += bun.top1 * n;
  agg.rustTop1 += rust.top1 * n;

  const d = (a: number, b: number) => {
    const v = b - a;
    return `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
  };
  console.log(
    `| ${c} | ${n} | ${bun.top1.toFixed(3)} | ${rust.top1.toFixed(3)} | ${d(bun.top1, rust.top1)} | ${bun.mrr.toFixed(3)} | ${rust.mrr.toFixed(3)} | ${d(bun.mrr, rust.mrr)} | ${bun.ndcg5.toFixed(3)} | ${rust.ndcg5.toFixed(3)} | ${d(bun.ndcg5, rust.ndcg5)} | ${full}/${n} | ${t1}/${n} |`,
  );
}

console.log();
console.log(`overall n=${agg.n}`);
console.log(`bun top1 avg = ${(agg.bunTop1 / agg.n).toFixed(3)}`);
console.log(`rust top1 avg = ${(agg.rustTop1 / agg.n).toFixed(3)}`);
console.log(`full top-5 match: ${agg.fullMatch}/${agg.n} = ${(agg.fullMatch / agg.n * 100).toFixed(1)}%`);
console.log(`top-1 match: ${agg.t1Match}/${agg.n} = ${(agg.t1Match / agg.n * 100).toFixed(1)}%`);

// Per-query disagreements
console.log("\n--- top-1 disagreements ---");
for (const c of corpora) {
  const bun = load(`${DIR}/bun-${c}.json`);
  const rust = load(`${DIR}/rust-${c}.json`);
  const byQ = new Map(bun.per_query.map((q) => [q.query, q]));
  for (const rq of rust.per_query) {
    const bq = byQ.get(rq.query);
    if (!bq) continue;
    if (rq.top5[0] !== bq.top5[0]) {
      console.log(`[${c}] "${rq.query}"`);
      console.log(`  bun:  ${bq.top5.join(", ")} — hit=${bq.top1_hit}`);
      console.log(`  rust: ${rq.top5.join(", ")} — hit=${rq.top1_hit}`);
    }
  }
}
