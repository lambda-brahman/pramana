// throwaway — spike #91 Q4 hybrid shape check.
//
// Recall between js-map brute-force and vec-exact is trivially identical:
// both compute the same cosine distance, so top-K ordering matches by
// construction. ANN recall is out of scope per the issue.
//
// This file demonstrates the hybrid-search SHAPE: one SQL statement that
// combines FTS5 ranking and vec0 k-NN via Reciprocal Rank Fusion expressed
// in SQL, vs the current two-stage JS RRF. Output parity against a
// reference in-JS RRF over the same two subqueries is the check.
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { DIM, mulberry32, randomVec } from "./corpus";

Database.setCustomSQLite(
  process.env.PRAMANA_SPIKE_SQLITE ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
);

const dbPath = join(tmpdir(), `spike-91-q4-${Date.now()}.sqlite`);
const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL;");
db.loadExtension(sqliteVec.getLoadablePath());

db.exec(`
  CREATE VIRTUAL TABLE v USING vec0(slug TEXT PRIMARY KEY, embedding float[${DIM}]);
  CREATE VIRTUAL TABLE f USING fts5(slug UNINDEXED, title, content, tokenize='porter unicode61');
`);

const rng = mulberry32(7);
const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"];
const N = 500;
const insV = db.prepare("INSERT INTO v(slug, embedding) VALUES (?, ?)");
const insF = db.prepare("INSERT INTO f(slug, title, content) VALUES (?, ?, ?)");
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const slug = `doc-${i}`;
    const wordMix = Array.from({ length: 8 }, () => words[Math.floor(rng() * words.length)]).join(" ");
    insV.run(slug, new Uint8Array(randomVec(rng).buffer));
    insF.run(slug, `Title ${i}`, wordMix);
  }
})();

// Query: FTS keyword + semantic vector together.
const queryText = "alpha gamma theta";
const queryVec = randomVec(rng);
const qBuf = new Uint8Array(queryVec.buffer);
const K = 10;
const RRF_K = 60;

// --- Shape A: current-style, two subqueries, RRF combined in JS ---
const ftsRows = db
  .prepare("SELECT slug, rank FROM f WHERE f MATCH ? ORDER BY rank LIMIT 50")
  .all(queryText) as Array<{ slug: string; rank: number }>;
const vecRows = db
  .prepare("SELECT slug, distance FROM v WHERE embedding MATCH ? AND k = 50 ORDER BY distance")
  .all(qBuf) as Array<{ slug: string; distance: number }>;

function rrfJs(
  ftsList: Array<{ slug: string }>,
  vecList: Array<{ slug: string }>,
): Array<{ slug: string; score: number }> {
  const scores = new Map<string, number>();
  ftsList.forEach((r, i) => scores.set(r.slug, (scores.get(r.slug) ?? 0) + 1 / (RRF_K + i + 1)));
  vecList.forEach((r, i) => scores.set(r.slug, (scores.get(r.slug) ?? 0) + 1 / (RRF_K + i + 1)));
  return [...scores.entries()]
    .map(([slug, score]) => ({ slug, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, K);
}
const hybridJs = rrfJs(ftsRows, vecRows);

// --- Shape B: single SQL, RRF expressed via ROW_NUMBER + CTE ---
const hybridSqlStmt = db.prepare(`
  WITH
    fts AS (
      SELECT slug, ROW_NUMBER() OVER (ORDER BY rank) AS r
      FROM f WHERE f MATCH ? ORDER BY rank LIMIT 50
    ),
    vec AS (
      SELECT slug, ROW_NUMBER() OVER (ORDER BY distance) AS r
      FROM v WHERE embedding MATCH ? AND k = 50
    ),
    fused AS (
      SELECT slug, SUM(1.0 / (${RRF_K} + r)) AS score
      FROM (SELECT * FROM fts UNION ALL SELECT * FROM vec)
      GROUP BY slug
    )
  SELECT slug, score FROM fused ORDER BY score DESC LIMIT ?
`);
const hybridSql = hybridSqlStmt.all(queryText, qBuf, K) as Array<{ slug: string; score: number }>;

// --- Parity ---
const sameOrder = hybridJs.every((r, i) => r.slug === hybridSql[i]?.slug);
const sameScores = hybridJs.every(
  (r, i) => Math.abs(r.score - (hybridSql[i]?.score ?? NaN)) < 1e-9,
);

console.log("js-rrf top:", hybridJs.map((r) => r.slug).join(", "));
console.log("sql-rrf top:", hybridSql.map((r) => r.slug).join(", "));
console.log(`slug order matches: ${sameOrder}`);
console.log(`scores within 1e-9:  ${sameScores}`);

db.close();
try {
  unlinkSync(dbPath);
  unlinkSync(`${dbPath}-wal`);
  unlinkSync(`${dbPath}-shm`);
} catch {}
