// throwaway — spike #91 corpus + PRNG
export const DIM = 384;

// mulberry32 — deterministic, fast enough for bench glue.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomVec(rng: () => number, dim = DIM): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    // box-muller-ish; uniform is fine for benchmarking cosine.
    const x = rng() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i]! /= norm;
  return v;
}

export function buildCorpus(n: number, seed = 42): {
  slugs: string[];
  vectors: Float32Array[];
} {
  const rng = mulberry32(seed);
  const slugs: string[] = [];
  const vectors: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    slugs.push(`doc-${i.toString().padStart(6, "0")}`);
    vectors.push(randomVec(rng));
  }
  return { slugs, vectors };
}

export function buildQueries(n: number, seed = 1337): Float32Array[] {
  const rng = mulberry32(seed);
  const qs: Float32Array[] = [];
  for (let i = 0; i < n; i++) qs.push(randomVec(rng));
  return qs;
}

export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}
