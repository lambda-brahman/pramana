// throwaway — spike #91 bench harness. js-map vs sqlite-vec vec0 exact.
// Usage: bun bench.ts [--n=<n>] [--queries=<q>] [--k=<k>] [--backend=js-map|vec-exact|both]
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { buildCorpus, buildQueries, DIM, quantile } from "./corpus";

const CUSTOM_SQLITE =
  process.env.PRAMANA_SPIKE_SQLITE ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";

type Args = { n: number; queries: number; k: number; backend: string };
function parseArgs(): Args {
  const out: Args = { n: 5000, queries: 200, k: 10, backend: "both" };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "n" && v) out.n = Number.parseInt(v, 10);
    else if (k === "queries" && v) out.queries = Number.parseInt(v, 10);
    else if (k === "k" && v) out.k = Number.parseInt(v, 10);
    else if (k === "backend" && v) out.backend = v;
  }
  return out;
}

function rssMb(): number {
  return Math.round((process.memoryUsage.rss() / 1024 / 1024) * 10) / 10;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

type Stats = {
  backend: string;
  n: number;
  ingestMs: number;
  rssAfterIngestMb: number;
  dbSizeMb: number | null;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
};

function summarise(backend: string, n: number, ingestMs: number, dbSizeMb: number | null, lats: number[]): Stats {
  const sorted = [...lats].sort((a, b) => a - b);
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    backend,
    n,
    ingestMs: Math.round(ingestMs),
    rssAfterIngestMb: rssMb(),
    dbSizeMb,
    p50: round2(quantile(sorted, 0.5)),
    p95: round2(quantile(sorted, 0.95)),
    p99: round2(quantile(sorted, 0.99)),
    mean: round2(mean),
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function benchJsMap(args: Args): Promise<Stats> {
  const { slugs, vectors } = buildCorpus(args.n);
  const queries = buildQueries(args.queries);

  const ingestStart = performance.now();
  const map = new Map<string, Float32Array>();
  for (let i = 0; i < slugs.length; i++) map.set(slugs[i]!, vectors[i]!);
  const ingestMs = performance.now() - ingestStart;

  const lats: number[] = [];
  for (const q of queries) {
    const t = performance.now();
    const results: Array<{ slug: string; score: number }> = [];
    for (const [slug, vec] of map) results.push({ slug, score: cosine(q, vec) });
    results.sort((a, b) => b.score - a.score);
    results.slice(0, args.k);
    lats.push(performance.now() - t);
  }

  return summarise("js-map", args.n, ingestMs, null, lats);
}

async function benchVecExact(args: Args): Promise<Stats> {
  Database.setCustomSQLite(CUSTOM_SQLITE);
  const dbPath = join(tmpdir(), `spike-91-${Date.now()}-${args.n}.sqlite`);
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.loadExtension(sqliteVec.getLoadablePath());
  db.exec(`CREATE VIRTUAL TABLE v USING vec0(slug TEXT PRIMARY KEY, embedding float[${DIM}])`);

  const { slugs, vectors } = buildCorpus(args.n);
  const queries = buildQueries(args.queries);

  const ingestStart = performance.now();
  const ins = db.prepare("INSERT INTO v(slug, embedding) VALUES (?, ?)");
  db.transaction(() => {
    for (let i = 0; i < slugs.length; i++) {
      ins.run(slugs[i]!, new Uint8Array(vectors[i]!.buffer));
    }
  })();
  const ingestMs = performance.now() - ingestStart;

  const selectStmt = db.prepare(
    "SELECT slug, distance FROM v WHERE embedding MATCH ? AND k = ? ORDER BY distance",
  );
  const lats: number[] = [];
  for (const q of queries) {
    const buf = new Uint8Array(q.buffer);
    const t = performance.now();
    selectStmt.all(buf, args.k);
    lats.push(performance.now() - t);
  }

  const dbSizeMb = Math.round((Bun.file(dbPath).size / 1024 / 1024) * 100) / 100;
  db.close();
  try {
    unlinkSync(dbPath);
    unlinkSync(`${dbPath}-wal`);
    unlinkSync(`${dbPath}-shm`);
  } catch {}

  return summarise("vec-exact", args.n, ingestMs, dbSizeMb, lats);
}

const args = parseArgs();
console.log(`spike-91 bench n=${args.n} queries=${args.queries} k=${args.k} backend=${args.backend}`);
console.log(`dim=${DIM} rssStart=${rssMb()}MB`);

const rows: Stats[] = [];
if (args.backend === "both" || args.backend === "js-map") rows.push(await benchJsMap(args));
if (args.backend === "both" || args.backend === "vec-exact") rows.push(await benchVecExact(args));

console.log("\nresults:");
console.table(rows);
