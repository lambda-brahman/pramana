export type RankedResult = { slug: string; score: number };

/**
 * Precision@k -- fraction of top-k results that are relevant.
 */
export function precisionAtK(results: RankedResult[], relevant: string[], k: number): number {
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((r) => relevant.includes(r.slug)).length;
  return hits / topK.length;
}

/**
 * Precision@1 convenience alias.
 */
export function precisionAt1(results: RankedResult[], relevant: string[]): number {
  return precisionAtK(results, relevant, 1);
}

/**
 * Recall@k -- fraction of relevant documents found in top-k.
 */
export function recallAtK(results: RankedResult[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 1;
  const topK = results.slice(0, k);
  const hits = topK.filter((r) => relevant.includes(r.slug)).length;
  return hits / relevant.length;
}

/**
 * Mean Reciprocal Rank -- 1 / position of first relevant result.
 */
export function reciprocalRank(results: RankedResult[], relevant: string[]): number {
  for (let i = 0; i < results.length; i++) {
    if (relevant.includes(results[i]!.slug)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Aggregate metrics across a set of queries.
 */
export function aggregate(
  perQuery: Array<{
    precisionAt1: number;
    precisionAt3: number;
    precisionAt5: number;
    recallAt5: number;
    rr: number;
  }>,
): { meanP1: number; meanP3: number; meanP5: number; meanR5: number; mrr: number } {
  const n = perQuery.length;
  if (n === 0) return { meanP1: 0, meanP3: 0, meanP5: 0, meanR5: 0, mrr: 0 };

  return {
    meanP1: perQuery.reduce((s, q) => s + q.precisionAt1, 0) / n,
    meanP3: perQuery.reduce((s, q) => s + q.precisionAt3, 0) / n,
    meanP5: perQuery.reduce((s, q) => s + q.precisionAt5, 0) / n,
    meanR5: perQuery.reduce((s, q) => s + q.recallAt5, 0) / n,
    mrr: perQuery.reduce((s, q) => s + q.rr, 0) / n,
  };
}

/**
 * Latency percentiles from sorted array of durations.
 */
export function percentiles(durations: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...durations].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    p50: sorted[Math.floor(n * 0.5)] ?? 0,
    p95: sorted[Math.floor(n * 0.95)] ?? 0,
    p99: sorted[Math.floor(n * 0.99)] ?? 0,
  };
}
