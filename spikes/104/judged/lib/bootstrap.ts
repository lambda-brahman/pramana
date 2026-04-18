/**
 * Given two arrays of per-query metric values (e.g., MRR per query for method A and B),
 * compute bootstrap 95% CI for the mean difference (A - B).
 * Returns { mean, lower, upper, significant: boolean }
 */
export function bootstrapDifference(
  valuesA: number[],
  valuesB: number[],
  iterations = 10000,
): { mean: number; lower: number; upper: number; significant: boolean } {
  const n = valuesA.length;
  if (n !== valuesB.length || n === 0) {
    return { mean: 0, lower: 0, upper: 0, significant: false };
  }

  // Paired differences
  const diffs = valuesA.map((a, i) => a - valuesB[i]!);
  const observedMean = diffs.reduce((s, d) => s + d, 0) / n;

  // Bootstrap resampling
  const bootstrapMeans: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      sum += diffs[idx]!;
    }
    bootstrapMeans.push(sum / n);
  }

  // Sort for percentiles
  bootstrapMeans.sort((a, b) => a - b);

  const lowerIdx = Math.floor(0.025 * iterations);
  const upperIdx = Math.floor(0.975 * iterations);

  const lower = bootstrapMeans[lowerIdx]!;
  const upper = bootstrapMeans[upperIdx]!;

  // Significant if CI does not contain zero
  const significant = (lower > 0 && upper > 0) || (lower < 0 && upper < 0);

  return { mean: observedMean, lower, upper, significant };
}
