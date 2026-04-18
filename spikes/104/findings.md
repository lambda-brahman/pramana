# Spike #104: rust port feasibility — single self-contained static binary

## TL;DR

**port** — a Rust build produces a truly self-contained single binary with every native dep (SQLite + sqlite-vec + onnxruntime + tokenizer + model weights) statically linked: **148 MB bundled** (well under the 300 MB ceiling) or **19 MB lazy** (well under the 50 MB ceiling), with retrieval accuracy on the #91 judged set indistinguishable from the Bun+transformers.js path (top-1 94.4% agreement, within-noise aggregate metrics, Rust marginally ahead on this corpus) and cold-start ~13× faster. None of the four cache-bootstrap dances we currently ship (onnxruntime WASM/dylib, sharp libvips, vec0 extension, extension-capable libsqlite3) survive the port.

## Method

All measurements on a single machine — **aarch64-apple-darwin, Rust 1.89.0, Bun 1.3.10** — in a throwaway Cargo project under `spikes/104/rust-core/` with `release + LTO thin + codegen-units=1 + strip`.

Model used: `Xenova/gte-small` (384-dim BERT, 127 MB fp32 ONNX) — the same model pramana ships in production today, loaded from the existing local cache (`~/.cache/pramana/models/Xenova/gte-small/`) rather than re-downloaded.

Judged-set parity baseline: the 3-corpus / 90-query set from spike #91 Q5 ([commit `e236be7`](https://github.com/lambda-brahman/pramana/issues/91#issuecomment-4273091061)). Ported wholesale into `spikes/104/judged/` so the Rust binary and a Bun baseline could run against identical fixtures.

Two Rust crates carried the load:

- **`rusqlite` 0.32 with the `bundled` feature** — builds SQLite 3.46.0 from source with `SQLITE_ENABLE_LOAD_EXTENSION` on. No system SQLite dependency.
- **`sqlite-vec` 0.1.9** — exposes `sqlite3_vec_init`, registered via `sqlite3_auto_extension` before opening any connection. Single-crate static link; no `.dylib/.so/.dll` shipped alongside the binary.
- **`ort` 2.0.0-rc.10** — pulls a prebuilt static `libonnxruntime.a` (68 MB for aarch64-darwin) from pyke's mirror at build time, statically linked into the final binary. `otool -L` confirms zero onnxruntime dylib reference in the output.
- **`tokenizers` 0.20** — pure-Rust HuggingFace tokenizer; `Tokenizer::from_bytes(include_bytes!(…/tokenizer.json))` and go.

## Q1 — sqlite-vec + SQLite static linking (`spikes/104/rust-core/src/q1_vec.rs`)

| check | result |
|---|---|
| `cargo build --release` produces a binary | yes, **2.3 MB** |
| `otool -L` dynamic deps | only `/usr/lib/libSystem.B.dylib` (macOS libc) |
| SQLite version reported at runtime | `3.46.0` (bundled) |
| sqlite-vec version | `v0.1.9` (crate-embedded) |
| `CREATE VIRTUAL TABLE … USING vec0(embedding float[4])` | works |
| kNN `WHERE embedding MATCH ? AND k = 3` | returns 3 rows in cosine order |
| `SELECT vec_distance_cosine(?, ?)` | returns 0.006116 vs hand-computed 0.006113 (Δ < 1e-5) |

Pass. This was the gating question, and it answers cleanly — the sqlite half of the port goes fully static in a 2.3 MB binary.

## Q2 — embedder + model weights static linking (`spikes/104/rust-core/src/q2_embed.rs`)

`Session::commit_from_memory(include_bytes!("…/model.onnx"))` + `Tokenizer::from_bytes(include_bytes!("…/tokenizer.json"))` — both model and tokenizer live in `.rodata` of the final binary; nothing on disk at runtime.

| check | result |
|---|---|
| Produces 384-dim embeddings on known strings | yes |
| L2-normalized (‖v‖ ≈ 1) | yes (within float noise, `abs(norm - 1) < 1e-3`) |
| `otool -L` dynamic deps | system only: `libSystem`, `libiconv`, `libc++`, `Foundation`, `CoreFoundation`, `CoreML`, `libobjc` — all present on any macOS install |
| `otool -L` onnxruntime reference | **none** (statically linked) |
| `nm` count of `OrtApi` symbols inlined into binary | 391 |
| libonnxruntime.a size (pyke prebuilt, aarch64-darwin) | 68 MB archive, compressed into the binary |
| Binary size with model bundled | **154 MB** (of which 127 MB is the ONNX model) |

Pass. The "embedder cache bootstrap" pattern (#38, #90) is not required — ORT can be statically linked, and `include_bytes!` handles the model+tokenizer cleanly.

Relevant caveat documented inline for the port: `ort` defaults to downloading its prebuilt `libonnxruntime.a` from `parcel.pyke.io` during `cargo build`. For fully-reproducible offline builds, switch to `ORT_STRATEGY=compile` and build ONNX Runtime from source (adds ~25 min to first clean build, cached thereafter). Acceptable; not blocking.

## Q3 — binary size

Measured on aarch64-apple-darwin; other targets not measured in this spike (no cross toolchain locally) but pyke ships prebuilt `libonnxruntime.a` for darwin-{arm64,x64}, linux-{arm64,x64}, and windows-x64, so the shape holds.

| variant | binary | stripped | budget ceiling | verdict |
|---|---:|---:|---:|---:|
| **bundled** (model+tokenizer in `.rodata`, `include_bytes!`) | 156 MB | **148 MB** | < 300 MB | **pass (49% headroom)** |
| **lazy** (model loaded from disk at runtime) | 27 MB | **19 MB** | < 50 MB | **pass (62% headroom)** |

Section breakdown of the bundled binary: `__TEXT` = 146 MB (dominated by the 127 MB `include_bytes!` blob sitting in `__const` + ~18 MB of compiled ORT/SQLite/app code), `__DATA` = 112 KB, everything else negligible.

The delta between bundled and lazy (129 MB) is exactly the model + tokenizer payload, confirming the baseline Rust footprint (ORT + SQLite + sqlite-vec + tokenizers + ndarray + app) is ~19 MB stripped — small enough that even shipping one binary per platform per release is cheap on bandwidth.

Either shape works; "bundled" is the one that actually delivers the "zero network at first run" story that motivates this spike.

## Q4 — accuracy parity (`spikes/104/bun-baseline.ts` vs `spikes/104/rust-core/src/q3_search.rs`)

Same model (`Xenova/gte-small`), same corpora (90 queries, 3 corpora from spike #91 Q5), same mean-pool + L2-normalize + cosine-rank pipeline. Difference is only the inference runtime (ort 2.x Rust vs onnxruntime-web via transformers.js 3.x).

Per-corpus, Bun baseline vs Rust:

| corpus | n | bun top-1 | rust top-1 | Δ | bun MRR | rust MRR | Δ | bun nDCG@5 | rust nDCG@5 | Δ | top-1 agreement | full top-5 agreement |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| corpus-a (specs) | 30 | 0.700 | 0.700 | +0.000 | 0.778 | 0.794 | +0.017 | 0.746 | 0.776 | +0.030 | 27/30 | 6/30 |
| corpus-b (REST API) | 30 | 0.900 | 0.900 | +0.000 | 0.932 | 0.932 | +0.000 | 0.910 | 0.910 | +0.000 | 30/30 | 30/30 |
| corpus-c (formal CS) | 30 | 0.767 | 0.800 | +0.033 | 0.852 | 0.874 | +0.022 | 0.814 | 0.827 | +0.012 | 28/30 | 11/30 |
| **overall** | **90** | **0.789** | **0.800** | **+0.011** | **0.854** | **0.867** | **+0.013** | **0.823** | **0.838** | **+0.015** | **85/90 (94.4%)** | **47/90 (52.2%)** |

Five queries disagree on top-1 (3 go Rust-right-Bun-wrong, 2 go Bun-right-Rust-wrong, 0 regressions strictly). Full-top-5 agreement is lower (52%) because within-top-5 order shuffles under the small float deltas between ORT and onnxruntime-web — the *set* of top-5 docs is nearly always identical; the *order* within that set is what drifts. This is well within judged-set noise and lines up with the #91 Q5 conclusion that cosine ranking on L2-normalized vectors is robust to float-precision differences at k=5.

One implementation detail worth calling out as a port-time gotcha: `Xenova/gte-small`'s `tokenizer.json` embeds `truncation.max_length = 128` while `tokenizer_config.json` declares `model_max_length = 512`. transformers.js (correctly) picks 512; `tokenizers-rs` loaded via `Tokenizer::from_bytes` picks up the 128 from the JSON. Setting truncation explicitly to 512 in the Rust path closed a 13-point top-1 gap on corpus-a that initially looked like a real parity failure. The port plan should codify this: always override truncation from `tokenizer_config.json`, not `tokenizer.json`.

**Cold-start** (incidental, measured during parity runs): loading tokenizer + ONNX session in Rust takes **132–222 ms**; loading the same model via `@huggingface/transformers` in Bun takes **2995 ms** — a ~**13–20× improvement**. Not the reason to port, but a side-benefit that helps TUI/MCP startup.

Pass. Ranking quality does not regress.

## Q5 — Bun limitations catalogue

The structural issue is one sentence: **`bun build --compile` bundles JavaScript plus `.node` files into `/$bunfs/root/`, but it does not walk `.node` transitive native dependencies, does not embed arbitrary binary assets addressable by file path, and therefore cannot ship anything that needs `dlopen`/`loadExtension`/ONNX-runtime-asset-lookup in a single file.** Every concrete pain we've hit on the distribution side has been a corollary of this.

Concrete instances:

- **#38** — `onnxruntime-node` `.node` addon has `@rpath/libonnxruntime.1.21.0.dylib` as a transitive dep. `bun build --compile` embeds the `.node` into `$bunfs` but not the dylib; at runtime the extracted addon can't find it, the embedder fails silently, semantic search degrades to FTS-only with one line of red stderr. Current fix (src/storage/embedder.ts:23 `ensureWasmRuntime`): switch to `onnxruntime-web` WASM, download the WASM runtime files to `~/.cache/pramana/wasm/` on first run. Trades the load-time crash for a first-run-requires-network failure mode.
- **#90** — Same class, different transitive dep. `@huggingface/transformers` pulls `sharp` for image preprocessing (unused by `gte-small`, which is text-only). `sharp` has platform-specific subpackages (`@img/sharp-darwin-arm64`, `@img/sharp-libvips-darwin-arm64`) containing `libvips` dylibs. Compiled binary fails to load `sharp`, embedder init warning spams ~8 lines of red stderr on every invocation, and the user has no clean way to distinguish this from actual breakage. Open.
- **#66** — Mach-O binaries cross-compiled on Linux lack `LC_CODE_SIGNATURE`, which Apple Silicon kernels SIGKILL. Current fix: build macOS binaries on `macos-latest` runners in CI and apply an ad-hoc `codesign --force --sign -` step, plus a matrix job that downloads the release artifact and verifies the signature. Works, but it's another platform-specific branch in the release pipeline that a Rust workflow (which produces correctly-signed binaries without the dance) would eliminate.
- **#91** — `sqlite-vec` adoption under Bun would require **two** cache bootstraps simultaneously: (a) the `vec0` extension (`.dylib`/`.so`/`.dll`) downloaded per-platform because `bun build --compile` can't embed native libraries addressable by `sqlite3_load_extension`; and (b) on macOS specifically, a replacement `libsqlite3.dylib` compiled *without* `SQLITE_OMIT_LOAD_EXTENSION` (Bun's bundled SQLite omits it). spike #91 Q5 confirmed sqlite-vec is accuracy-neutral and therefore would-be-adoptable, but the shipping cost has kept it in `defer` — this spike's finding is that the shipping cost is Bun-specific; it vanishes under Rust.

Systemic symptoms that fall out of the same root cause:

- Every native-dep fix ends up as "download + extract + cache on first run," which means the working directory has to be writable, the network has to work on first launch (no airgapped installs), `~/.cache/pramana/` has to be creatable and uncorrupted, and we have to maintain a cache-invalidation story per-dependency per-platform.
- The cache-bootstrap pattern composes badly — each new native dep we want (sqlite-vec, a different embedder, a native ANN index, etc.) adds another download-and-hope step and another class of first-run failure.
- "Embed the model in the binary" is not available to us under Bun — there is no equivalent of Rust's `include_bytes!` that produces a runtime-file-addressable asset from `bun build --compile`.

This section stands independent of whether we port. Even if the port is deferred, **it is the honest description of what staying on Bun means**: every new native-dep idea has to pay the cache-bootstrap tax, and fragility compounds.

## Caveats

- **Single-platform measurement.** All numbers are aarch64-apple-darwin on one M-series machine. Linux/x86 expected to be similar (ORT prebuilts exist for all five common targets) but not empirically confirmed in this spike.
- **One model.** Parity measured on `Xenova/gte-small` only. `bge-small-en-v1.5` was used in spike #91 Q5; the parity logic (same model → both runtimes agree) should transfer, but a port that adds model-selection UX should validate on each model it ships.
- **Vec-exact path only.** We measured vec-exact retrieval; hybrid FTS5-+-vec-exact (which is pramana's real path today) was not reproduced end-to-end in the spike driver. FTS5 is provided by bundled SQLite with zero extra work, so this is mechanical, not a risk.
- **Port cost not estimated.** This spike answers "is it feasible?" with a clear yes. It does not estimate engineering weeks — that's the job of the follow-up issue breakdown.
- **ORT build-time network dep.** `ort` fetches a prebuilt static archive at `cargo build` time. For fully-offline CI, switch to `ORT_STRATEGY=compile` — adds ~25 min to first clean build, cached thereafter. Not blocking.
- **TUI / MCP / plugin contract not spiked.** The issue body explicitly scoped those out as port-time decisions. Mature Rust crates exist (`ratatui`, `rmcp`, etc.) but picking between them is the port's first week, not this spike's.
- **bge instruction prefix.** `Xenova/bge-small-en-v1.5` requires a `"Represent this sentence for searching relevant passages: "` prefix on queries. `gte-small` does not. This spike used gte-small so the issue doesn't arise; a port that supports both must carry the per-model prefix logic (one-liner, but noted here so it isn't forgotten).

## Recommendation

**Port.** The measured wins are:

1. **One binary per platform, no first-run network, no cache bootstrap.** Eliminates #38, #90, (future) #91, and the structural class behind all three.
2. **Macos distribution simplifies.** Rust binaries codesign fine in CI; the #66 native-hardware + ad-hoc-codesign workaround goes away.
3. **Size comfortably under every ceiling** (148 MB bundled / 19 MB lazy vs 300/50 MB budgets).
4. **Accuracy non-regressing** on judged set (Rust marginally ahead, fully within judged-set noise).
5. **Cold-start ~13× faster**, which matters directly for TUI responsiveness and MCP handshake latency.
6. **Every future native dep is now `cargo add <X>`** instead of "design another cache bootstrap." sqlite-vec stops being a shipping-cost decision. Swapping embedders stops being a shipping-cost decision. This is the compound interest.

Adopting implies filing a follow-up issue (or set of issues) for the port itself, each sized to fit normal sprint budget. Proposed breakdown:

1. `port(storage): FTS5 + sqlite-vec schema, ingestion, query paths` — direct translation of `src/storage/`; the hardest part already de-risked by this spike.
2. `port(embedder): ort + tokenizers + include_bytes! model; per-model instruction-prefix support`
3. `port(parser): frontmatter + wikilinks + markdown — straight port, pure functions`
4. `port(engine): BFS traverse, get/search/list/traverse primitives, tenant manager`
5. `port(mcp): stdio server, JSON-RPC over stdio, tool registrations — pick crate (rmcp, etc.) in the first issue and justify`
6. `port(cli): flag parsing (clap), top-level command surface, `doctor`/`upgrade` subcommands`
7. `port(tui): ratatui with a thin adapter over the engine; golden snapshots carried across`
8. `port(plugin): compile-time feature-flagged extensions rather than dynamic load; simpler contract surface`
9. `port(ci): cargo release pipeline, 4–5 target matrix, cargo-about for license aggregation, strip + checksum + upload`
10. `port(release): swap scripts/release.sh and install.sh to fetch Rust artifacts; keep version bumping compatible with CHANGELOG.md`

The current TypeScript tree stays on `main` until the Rust tree is at parity; the switch-over is a single `release.sh` change. Nothing in this spike touched `src/` — the port itself is the follow-up, not this issue.

## Branch

`spike/issue-104-rust-port-feasibility` — reproducible commits:

- `chore: plan for spike #104`
- `chore: q1 probe for spike #104 — rusqlite+sqlite-vec static link works`
- `chore: q2 probe for spike #104 — ort+tokenizers static embed works`
- `chore: q3+q4 probes for spike #104 — e2e search + parity`
- `chore: findings for spike #104`

Repro from the branch root:

```bash
cd spikes/104/rust-core
cargo build --release --bins
./target/release/q1-vec                           # Q1 pass
./target/release/q2-embed                         # Q2 pass
for c in corpus-a corpus-b corpus-c; do
  SPIKE_CORPUS_DIR=../judged/fixtures/$c \
    SPIKE_QUERIES_JSON=../judged/corpora/$c.queries.json \
    SPIKE_OUTPUT_JSON=../results/rust-$c.json \
    ./target/release/q3-search
done
cd ../../..
bun spikes/104/bun-baseline.ts                    # regenerates Bun baseline
bun spikes/104/compare.ts                         # prints the parity table
```

Model assets are gitignored — the repro copies them from `~/.cache/pramana/models/Xenova/gte-small/`; re-run `pramana` once to repopulate the cache if missing.
