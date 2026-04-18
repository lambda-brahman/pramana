# Spike #91: sqlite-vec vs in-memory cosine brute-force

## TL;DR

**defer** — `sqlite-vec` works and wins on latency above ~1k docs (5k: p95 **1.7ms vs 4.2ms**, 50k: **24ms vs 36ms**), but at today's scale (≤100 docs) both are sub-millisecond and the shipping cost is non-trivial (loadable `.dylib/.so/.dll` cache + extension-loading libsqlite on macOS, same shape as #38/#90). Recommend revisiting when any tenant crosses ~1000 docs or once a reusable native-binary loader lands.

Synthetic-only: results here measure pure vector retrieval. The architectural simplification (single source of truth + hybrid RRF expressed as one SQL) is demonstrated but not the deciding factor at current scale.

## Method

Hardware: `Darwin 24.6.0 arm64`, Bun 1.3.10, sqlite-vec 0.1.9, macOS system sqlite replaced via `Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib")`.

Corpus: seeded `mulberry32(42)`, 384-dim L2-normalized `Float32Array` (matches BGE-small-en).
Queries: 200 per run, seeded `mulberry32(1337)`.
k = 10. Each run fresh process.

Implementations under test:
- `js-map` — in-JS `Map<string, Float32Array>` + dot-product loop (clone of `src/storage/embedding-index.ts` + `cosineSimilarity`).
- `vec-exact` — `vec0` virtual table, `ORDER BY distance` with `MATCH ? AND k = ?`.

Harness: `spikes/91/bench.ts` (seeded, reproducible).

## Results

### Q1 — does `sqlite-vec` load under `bun:sqlite`? — **yes, with caveat**

Works in `bun run` and under `bun build --compile`, **but** on macOS `bun:sqlite` links against the system `libsqlite3.dylib`, which is compiled with `SQLITE_OMIT_LOAD_EXTENSION`. Default `db.loadExtension()` fails:

```
error: This build of sqlite3 does not support dynamic extension loading
```

Workaround: `Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib")` before opening the DB. Reproduced in `spikes/91/q1-load.ts`. Linux Bun builds ship an extension-capable sqlite so this is a macOS-only tax.

### Q2 — does the extension survive `bun build --compile`? — **yes, with caveat**

`bun build --compile` does not embed native `.dylib` assets. The default `sqlite-vec` npm resolution path (`require.resolve('sqlite-vec-darwin-arm64/vec0.dylib')`) fails inside the compiled `/$bunfs` filesystem:

```
error: Cannot find module 'sqlite-vec-darwin-arm64/vec0.dylib' from '/$bunfs/root/...'
```

If the caller passes an absolute filesystem path to `loadExtension()`, compiled binaries work. Reproduced in `spikes/91/entry.ts` + `/tmp/entry2.ts`. Shipping story is the #38 pattern: bundle `vec0.{dylib,so,dll}` per platform, cache to `~/.cache/pramana/extensions/` on first run, hand the path to `loadExtension()`.

### Q3 — perf on realistic corpora (synthetic vectors)

| n | backend | ingest (ms) | query p50 (ms) | p95 (ms) | p99 (ms) | RSS after ingest (MB) | DB on disk (MB) |
|------:|-----------|---:|-----:|-----:|-----:|---:|----:|
| 50    | js-map    | 0    | 0.03 | 0.09 | 0.12 | 46.7  | —    |
| 50    | vec-exact | 4    | 0.09 | 0.11 | 0.31 | 55.3  | 0.00 |
| 5 000 | js-map    | 1    | 2.99 | 4.24 | 13.38| 86.5  | —    |
| 5 000 | vec-exact | 88   | 1.42 | 1.69 | 2.00 | 113.0 | 7.79 |
| 50 000| js-map    | 5    | 33.32| 35.84| 37.10| 313.1 | —    |
| 50 000| vec-exact | 948  | 17.62| 24.31| 29.82| 366.3 | 76.18|

Reads:
- At **50 docs**, both are sub-ms; the 3x ratio is noise.
- At **5 000 docs**, vec-exact is ~2× faster at p50 and **~2.5× at p95** (SQL's tighter tail is the real win).
- At **50 000 docs**, vec-exact is ~2× faster at p50 and ~1.5× at p95. js-map p95 of 36 ms is still usable for an MCP tool, not for a TUI autocomplete.
- Ingest cost shifts from ~free to ~20 µs/insert under vec-exact — meaningful at 50k (~1 s) but trivial at 5k.
- RSS delta is ~+50 MB at 50k. Disk: 76 MB at 50k.

### Q4 — hybrid-search shape — **parity demonstrated**

Single-SQL RRF reproduces the existing JS RRF (`src/storage/sqlite/index.ts:244-291`) exactly:

```sql
WITH
  fts AS (SELECT slug, ROW_NUMBER() OVER (ORDER BY rank) AS r FROM f WHERE f MATCH ? LIMIT 50),
  vec AS (SELECT slug, ROW_NUMBER() OVER (ORDER BY distance) AS r FROM v WHERE embedding MATCH ? AND k = 50),
  fused AS (SELECT slug, SUM(1.0/(60+r)) AS score FROM (fts UNION ALL vec) GROUP BY slug)
SELECT slug, score FROM fused ORDER BY score DESC LIMIT ?;
```

Over a 500-doc seeded corpus, top-10 slug ordering and RRF scores match the current two-stage implementation to within 1e-9. Repro: `spikes/91/q4-hybrid.ts`.

Recall between brute-force and exact `vec_distance_cosine` is trivially identical (same math). ANN recall was explicitly out of scope.

## Caveats

- **Synthetic vectors.** Uniform `[-1, 1]` noise normalized to the unit sphere. Real BGE embeddings are structured; perf won't change but relevance tuning (which we didn't test) could.
- **One machine.** Apple Silicon M-series. Intel Mac, Linux ARM, and Linux x64 not measured. Linux avoids the `setCustomSQLite` hack.
- **No end-to-end ingest timing.** We didn't measure pramana startup + `buildEmbeddings` rebuild end-to-end; only the vector-store piece.
- **Judged relevance set not built.** Without real docs+queries, a recall/NDCG comparison would be synthetic and uninformative. If we adopt, a 20-query judged set should be built from real `ggo` docs before switching the default backend.
- **sqlite-vec 0.1.9 is pre-1.0.** API may shift; the `vec0` virtual table is the stable bit.

## Shipping cost (what "adopt" actually requires)

1. Platform binaries: ship/download `vec0.dylib` (macOS), `vec0.so` (Linux), `vec0.dll` (Windows) per arch. Same cache-on-first-run pattern as `ensureWasmRuntime` in `src/storage/embedder.ts:23`.
2. macOS extension-capable sqlite: either require homebrew sqlite (user tax) or ship `libsqlite3.dylib` alongside the binary and call `Database.setCustomSQLite()`. #38/#90 precedent suggests the latter is the one we'd do.
3. `bun build --compile` CI matrix: x2 (macOS x Linux) x2 (x64 x arm64) = 4 binary flavours, each now pulling a vec0 + possibly a libsqlite3.
4. Migration path for existing DBs (out of scope for this spike; `vec0` lives in a separate table so additive, not destructive).

## Recommendation

**Defer.** Reasons:

- Current scale (tens-to-low-hundreds of docs per tenant) sits in the range where both backends are sub-millisecond. The perf win kicks in above ~1k docs.
- Shipping cost is structurally similar to #38 and #90, which are still open wounds. Adopting before that infrastructure is reusable doubles the pain.
- The architectural win (one source of truth, hybrid RRF as one SQL) is real but ergonomic, not operational.

Revisit triggers:
- Any tenant crosses ~1 000 artifacts (real `ggo` KB growth or ingesting long-form papers/transcripts per the #91 motivation).
- A reusable "ship a native extension with pramana" mechanism lands as part of #38/#90 cleanup.
- sqlite-vec reaches 1.0 and/or ships an ANN (`vec0` quantization) that meaningfully changes the tail.

What would change the answer: if we started ingesting paper-sized corpora tomorrow, the 5k-scale numbers already make this adopt-worthy on latency alone. The deciding factor is future corpus size, not current perf.

## Branch

`spike/issue-91-explorationengine-benchmark-sqlite-vec-v` — reproduce with:

```
cd spikes/91
bun install
# macOS only: brew install sqlite
bun bench.ts --n=5000 --queries=200 --k=10
bun q4-hybrid.ts
```
