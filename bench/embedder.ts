import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export type Embedder = {
  embed(text: string): Promise<Float32Array>;
  modelId: string;
};

/**
 * Load a sentence-transformer model and return an Embedder instance.
 * Each call creates a new pipeline — callers can switch models by
 * calling loadModel() again with a different ID.
 */
export async function loadModel(modelId: string): Promise<{ embedder: Embedder; loadTimeMs: number }> {
  const start = performance.now();
  const extractor: FeatureExtractionPipeline = await pipeline("feature-extraction", modelId, {
    dtype: "fp32",
  });
  const loadTimeMs = performance.now() - start;

  const embedder: Embedder = {
    modelId,
    async embed(text: string): Promise<Float32Array> {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      return new Float32Array(output.data as Float64Array);
    },
  };

  return { embedder, loadTimeMs };
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  // Already normalized by the pipeline, so dot product = cosine similarity
  return dot;
}
