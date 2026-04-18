// throwaway — spike #91 Q2 entry. Target of `bun build --compile`.
// Tests whether the compiled binary can locate vec0.dylib and a usable
// libsqlite3.dylib at runtime.
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const CUSTOM_SQLITE = process.env.PRAMANA_SPIKE_SQLITE ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
Database.setCustomSQLite(CUSTOM_SQLITE);

const db = new Database(":memory:");
db.loadExtension(sqliteVec.getLoadablePath());
db.exec("CREATE VIRTUAL TABLE v USING vec0(slug TEXT PRIMARY KEY, embedding float[4])");

const q = new Float32Array([1, 0, 0, 0]);
const out = db
  .query("SELECT vec_version() AS v, ? AS probe")
  .all(new Uint8Array(q.buffer)) as Array<{ v: string; probe: unknown }>;

console.log(JSON.stringify({ ok: true, vec_version: out[0]!.v, loadable: sqliteVec.getLoadablePath() }));
