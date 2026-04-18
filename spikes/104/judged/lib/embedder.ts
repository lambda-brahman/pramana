import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export type Embedder = {
  embed(text: string, isQuery?: boolean): Promise<Float32Array>;
  modelId: string;
};

const BGE_INSTRUCTION_PREFIX = "Represent this sentence for searching relevant passages: ";

function isBgeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("bge");
}

/**
 * Load a sentence-transformer model and return an Embedder instance.
 * For BGE models, the instruction prefix is automatically prepended when isQuery=true.
 */
export async function loadModel(modelId: string): Promise<{ embedder: Embedder; loadTimeMs: number }> {
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

  return { embedder, loadTimeMs };
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
