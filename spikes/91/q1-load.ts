// throwaway — spike #91 Q1 probe. Does sqlite-vec load under bun:sqlite?
// macOS system sqlite is compiled with SQLITE_OMIT_LOAD_EXTENSION, so we
// must point Bun at a custom sqlite dylib via Database.setCustomSQLite().
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const CUSTOM_SQLITE = process.env.PRAMANA_SPIKE_SQLITE ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
Database.setCustomSQLite(CUSTOM_SQLITE);

const db = new Database(":memory:");
db.loadExtension(sqliteVec.getLoadablePath());

const [{ vec_version }] = db.query("SELECT vec_version() AS vec_version").all() as Array<{
  vec_version: string;
}>;
console.log("vec_version:", vec_version);

db.exec(`CREATE VIRTUAL TABLE v USING vec0(slug TEXT PRIMARY KEY, embedding float[4])`);

const rows: Array<[string, Float32Array]> = [
  ["a", new Float32Array([1, 0, 0, 0])],
  ["b", new Float32Array([0, 1, 0, 0])],
  ["c", new Float32Array([0.9, 0.1, 0, 0])],
];
const ins = db.prepare("INSERT INTO v(slug, embedding) VALUES (?, ?)");
for (const [slug, vec] of rows) ins.run(slug, new Uint8Array(vec.buffer));

const q = new Float32Array([1, 0, 0, 0]);
const hits = db
  .query("SELECT slug, distance FROM v WHERE embedding MATCH ? AND k = 3 ORDER BY distance")
  .all(new Uint8Array(q.buffer)) as Array<{ slug: string; distance: number }>;

console.log("hits:", hits);
console.log("OK");
