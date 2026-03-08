import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { err, ok, type Result } from "../lib/result.ts";

export type Embedder = {
  embed(text: string, isQuery?: boolean): Promise<Float32Array>;
  modelId: string;
};

export type EmbedderError = { type: "embedder"; message: string };

const BGE_INSTRUCTION_PREFIX = "Represent this sentence for searching relevant passages: ";

const WASM_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"] as const;

/**
 * Ensure ONNX WASM runtime files exist in a local cache directory.
 * In compiled binaries, onnxruntime-web's WASM files aren't embedded — we
 * download them once from the onnxruntime-web npm package on CDN.
 */
async function ensureWasmRuntime(wasmDir: string): Promise<void> {
  if (WASM_FILES.every((f) => existsSync(join(wasmDir, f)))) return;

  mkdirSync(wasmDir, { recursive: true });
  const version = "1.22.0-dev.20250409-89f8206ba4";
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist`;

  await Promise.all(
    WASM_FILES.map(async (file) => {
      const dest = join(wasmDir, file);
      if (existsSync(dest)) return;
      const res = await fetch(`${base}/${file}`);
      if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
    }),
  );
}

function isBgeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("bge");
}

/**
 * Load a sentence-transformer model and return an Embedder instance.
 * For BGE models, the instruction prefix is automatically prepended when isQuery=true.
 */
export async function loadEmbedder(
  modelId: string,
): Promise<Result<{ embedder: Embedder; loadTimeMs: number }, EmbedderError>> {
  try {
    const { env, pipeline } = await import("@huggingface/transformers");

    // In compiled binaries, the default cache dir resolves to /$bunfs (read-only).
    // Redirect to ~/.cache/pramana/models which is always writable.
    const cacheBase = join(homedir(), ".cache", "pramana");
    env.cacheDir = join(cacheBase, "models");
    env.useBrowserCache = false;

    // When onnxruntime-web is used (compiled binary), the WASM runtime files
    // must be on disk for dynamic import. Download once to a local cache. (#38)
    if (env.backends?.onnx?.wasm) {
      const wasmDir = join(cacheBase, "wasm");
      await ensureWasmRuntime(wasmDir);
      env.backends.onnx.wasm.wasmPaths = `file://${wasmDir}/`;
    }

    const start = performance.now();
    const extractor: FeatureExtractionPipeline = await pipeline("feature-extraction", modelId, {
      dtype: "fp32",
    });
    const loadTimeMs = performance.now() - start;

    const bge = isBgeModel(modelId);

    const embedder: Embedder = {
      modelId,
      async embed(text: string, isQuery = false): Promise<Float32Array> {
        const input = bge && isQuery ? `${BGE_INSTRUCTION_PREFIX}${text}` : text;
        const output = await extractor(input, { pooling: "mean", normalize: true });
        return new Float32Array(output.data as Float64Array);
      },
    };

    return ok({ embedder, loadTimeMs });
  } catch (e) {
    return err({
      type: "embedder",
      message: `Failed to load model "${modelId}": ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
