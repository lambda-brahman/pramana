# Spike #91 — plan: sqlite-vec vs in-memory cosine brute-force

## Dependency chain

The questions are gated. If an earlier one fails, later ones become moot.

1. **Does `sqlite-vec` load under `bun:sqlite`?**
   Call `db.loadExtension(vec.getLoadablePath())` in a plain `bun run`. Must create a `vec0` table and run `vec_distance_cosine()` without crashing.
   *Stop-if-no:* writeup `reject` — if the extension won't load in `bun run` there is no path.

2. **Does the extension survive `bun build --compile`?**
   Build a tiny entrypoint at `spikes/91/entry.ts` that loads the extension and runs one query. Run the compiled binary from a different cwd. Must work.
   *Stop-if-no:* writeup `defer` — library works but we cannot ship, same shape as #38/#90. The path forward is either bundle via a postinstall (like the ONNX WASM workaround) or wait.

3. **Perf vs current JS-brute-force on realistic corpora.**
   Seeded synthetic vectors (384-dim, matching BGE-small). Sizes: 50, 5 000, 50 000.
   Compare: cold ingest (sec), query latency p50/p95/p99 (ms) over 200 seeded queries, process RSS (MB) at rest, DB file size on disk (MB).
   Implementations under test:
   - `js-map` — current `EmbeddingIndex` + `cosineSimilarity`.
   - `vec-exact` — `vec0` virtual table with float[384], `ORDER BY distance`.
   *Stop-if-no:* if `vec-exact` is slower than `js-map` at 50k by >2x, writeup `reject`.

4. **Hybrid-search shape sanity.**
   Build a tiny judged set (20 queries × top-5 relevance labels over the 5k corpus). Compare current RRF(fts, js-map) vs a single-SQL hybrid query (`WITH fts AS ..., vec AS ..., combine via RRF in SQL`). Report MRR@5 and NDCG@5 on both, plus query p95.
   *Stop-if-no:* if recall drops meaningfully (>5% MRR) without a clear reason, writeup `defer`.

## Non-goals (hard)

- Migrating real DBs. Separate file, separate process.
- `vec0` quantization, ANN tuning, `int8`/`bit` quantized types.
- Editing anything under `src/`.
- Replacing BGE or changing embedding dimensions.

## Throwaway code rules

- Everything under `spikes/91/`. `// throwaway` marker on bench glue.
- Pure bench code may `throw`. No `Result<T,E>` requirement.
- `biome check` must pass on anything committed (CI will run on push).
- No new deps in the root `package.json`. Keep `sqlite-vec` and any test helpers in `spikes/91/package.json` via `bun add --cwd spikes/91`.

## Budget

2 hours session time. Check `mcx claude ls` cost between steps 1→2 and 3→4.

## Artifacts

- `spikes/91/plan.md` — this file.
- `spikes/91/bench.ts` — the runner, flag-driven.
- `spikes/91/entry.ts` — `bun build --compile` target.
- `spikes/91/corpus.ts` — seeded corpus + query generator.
- `spikes/91/findings.md` — writeup posted to the issue.
