import { cosineSimilarity } from "./embedder.ts";

export class EmbeddingIndex {
  private vectors = new Map<string, Float32Array>();

  add(slug: string, vector: Float32Array): void {
    this.vectors.set(slug, vector);
  }

  remove(slug: string): void {
    this.vectors.delete(slug);
  }

  search(queryVector: Float32Array, limit: number): Array<{ slug: string; score: number }> {
    const results: Array<{ slug: string; score: number }> = [];

    for (const [slug, vector] of this.vectors) {
      results.push({ slug, score: cosineSimilarity(queryVector, vector) });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  clear(): void {
    this.vectors.clear();
  }

  get size(): number {
    return this.vectors.size;
  }
}
