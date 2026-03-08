export type RankedResult = { slug: string; score: number };

/**
 * Reciprocal Rank Fusion.
 * For each slug, compute sum of 1/(k + rank_in_list) across all input lists.
 * If a slug doesn't appear in a list, use penalty rank (totalDocs + 1).
 */
export function rrf(lists: RankedResult[][], k: number, totalDocs: number): RankedResult[] {
  // Build a map of slug -> rrf score
  const scores = new Map<string, number>();
  const penaltyRank = totalDocs + 1;

  // Collect all slugs
  const allSlugs = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      allSlugs.add(item.slug);
    }
  }

  for (const slug of allSlugs) {
    let rrfScore = 0;
    for (const list of lists) {
      const rank = list.findIndex((r) => r.slug === slug);
      if (rank >= 0) {
        rrfScore += 1 / (k + rank + 1); // rank+1 because findIndex is 0-based
      } else {
        rrfScore += 1 / (k + penaltyRank);
      }
    }
    scores.set(slug, rrfScore);
  }

  // Sort by RRF score descending
  return Array.from(scores.entries())
    .map(([slug, score]) => ({ slug, score }))
    .sort((a, b) => b.score - a.score);
}
