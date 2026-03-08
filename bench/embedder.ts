import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractor: FeatureExtractionPipeline | null = null;

export async function loadModel(): Promise<{ loadTimeMs: number }> {
  const start = performance.now();
  extractor = await pipeline("feature-extraction", MODEL_ID, {
    dtype: "fp32",
  });
  return { loadTimeMs: performance.now() - start };
}

export async function embed(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error("Model not loaded — call loadModel() first");
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data as Float64Array);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  // Already normalized by the pipeline, so dot product = cosine similarity
  return dot;
}
