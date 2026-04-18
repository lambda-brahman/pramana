# Spike #104 — Rust port feasibility plan

Gated-chain investigation: each question has a stop-if-no rule. If any "reject/defer" condition fires, write up what we have and stop — the downstream questions become moot.

## Q1 — Static-link feasibility: SQLite + sqlite-vec

**Does `rusqlite` (with `bundled` feature) compiled alongside the `sqlite-vec` crate produce a single static binary that runs `vec0` virtual tables and `vec_distance_cosine` against ephemeral connections, with zero external files?**

Smoke test in `spikes/104/rust-core`:
- `rusqlite = { features = ["bundled"] }` — forces SQLite build-from-source, extension loading available.
- `sqlite-vec = "*"` — the Rust crate exposes `sqlite_vec::sqlite3_vec_init` which we register via `unsafe sqlite3_auto_extension`.
- Open an in-memory DB, create a `vec0` table, insert 3 rows of 384-dim vectors, run kNN query with `vec_distance_cosine`, assert ranking matches hand-computed cosine.
- `cargo build --release` → single binary. `otool -L` / `ldd` → no dynamic link to libsqlite3.

**Stop-if-no:** writeup `reject`. Whole port premise dies without this.

## Q2 — Static-link feasibility: embedder + model weights

**Can we statically link ONNX runtime and embed the `bge-small-en-v1.5` tokenizer + model into the binary?**

Two candidate paths, picked by which links cleanly first:
- **A: `fastembed-rs` with `ort` pinned to a statically linked build.** `ort = { features = ["download-binaries"] }` uses prebuilts; for a truly-static binary we need `features = ["load-dynamic"]` disabled + either `ort-sys` static or `tract` (pure-rust inference).
- **B: `tract-onnx`** — pure-Rust ONNX runtime, already static by definition. Requires us to drive the tokenizer (`tokenizers` crate) manually and run the graph against the exported `model.onnx`.

Model + tokenizer embedding via `rust-embed` or `include_bytes!` — the files live under `spikes/104/rust-core/assets/bge/`.

Answer these, in order:
1. Does the chosen path compile and produce correct 384-dim embeddings on a known string?
2. Can we embed the model bytes (~130MB fp32 or ~33MB int8) into the binary via `include_bytes!` without exploding build time?
3. If embedding is prohibitive, sketch the "lazy-download once, then self-contained" shape and measure binary-minus-model size.

**Stop-if-no:** writeup `defer`. Half a fix (SQLite static, embedder still cache-bootstraps) doesn't justify the port cost.

## Q3 — Binary size budget

With Q1 and Q2 glued together into a minimum `search(query) → top-5 slugs` driver against `corpus-a`, measure:
- `cargo build --release --target aarch64-apple-darwin` — native here.
- Other targets: attempt via `cross` in docker; if that takes >20 min of setup, report native only and note the delta as "expected-similar" with caveat.
- Strip symbols (`strip`) and re-measure.
- Report: bundled-model size, lazy-model size (model excluded).

Ceilings from the issue: **< 300MB bundled**, **< 50MB lazy**. Over → the "self-contained" angle loses its differentiation vs today's bun+cache.

No stop rule here — size is informative for the recommendation, not gating.

## Q4 — Accuracy parity

Using the judged set from spike #91 (3 corpora, 90 queries), run the Rust embedder + sqlite-vec path against the same fixtures and compare top-1 / MRR / nDCG@5 to the Bun + `Xenova/bge-small-en-v1.5` baseline (spike #91 Q5).

Bit-identity is not required — we're on a different ONNX runtime — but drift beyond judged-set noise is disqualifying.

**Stop-if-no:** writeup `reject`. A port that silently changes retrieval quality is worse than status quo.

## Q5 — Bun limitations catalogue

Orthogonal to the port decision: a plain-language section in findings listing each concrete structural limitation of Bun-as-distribution-runtime that has cost us, cross-referencing #38, #66, #90, #91 and any new ones this spike surfaces.

This is valuable even if the recommendation is `defer` — it's the honest description of what staying on Bun means.

## Dependency chain

```
Q1 ──► Q2 ──► Q3
           │
           └──► Q4
Q5 (independent, always ship)
```

Q3 and Q4 are gated by Q1∧Q2. If either early question fails, skip to writeup.

## Budget

Target 2–3h session time. Checkpoint after Q1 and Q2. If Q2 requires >90 min of toolchain-wrestling, fall back to lazy-download shape and note it — a "90% static + one file in ~/.cache" binary is still a strong data point.
