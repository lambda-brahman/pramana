export type QueryResult = {
  query: string;
  category: "exact" | "synonym" | "concept";
  relevant: string[];
  partiallyRelevant: string[];
  retrieved: string[]; // top-k slugs returned by search
};

export type PerQueryMetrics = {
  query: string;
  category: "exact" | "synonym" | "concept";
  p1: number;
  p3: number;
  p5: number;
  r5: number;
  mrr: number;
  ndcg5: number;
  hasRelevantInTop5: boolean;
};

export type AggregateMetrics = {
  p1: number;
  p3: number;
  p5: number;
  r5: number;
  mrr: number;
  ndcg5: number;
  failureRate: number;
};

function relevanceGain(slug: string, relevant: string[], partiallyRelevant: string[]): number {
  if (relevant.includes(slug)) return 1.0;
  if (partiallyRelevant.includes(slug)) return 0.5;
  return 0.0;
}

/** Precision at k */
function precisionAtK(retrieved: string[], relevant: string[], partiallyRelevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  if (topK.length === 0) return 0;
  const allRelevant = new Set([...relevant, ...partiallyRelevant]);
  const hits = topK.filter((s) => allRelevant.has(s)).length;
  return hits / k;
}

/** Recall at k */
function recallAtK(retrieved: string[], relevant: string[], partiallyRelevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const allRelevant = new Set([...relevant, ...partiallyRelevant]);
  if (allRelevant.size === 0) return 1; // vacuous truth
  const hits = topK.filter((s) => allRelevant.has(s)).length;
  return hits / allRelevant.size;
}

/** Mean Reciprocal Rank */
function mrr(retrieved: string[], relevant: string[], partiallyRelevant: string[]): number {
  const allRelevant = new Set([...relevant, ...partiallyRelevant]);
  for (let i = 0; i < retrieved.length; i++) {
    if (allRelevant.has(retrieved[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/** nDCG at k with graded relevance */
function ndcgAtK(
  retrieved: string[],
  relevant: string[],
  partiallyRelevant: string[],
  k: number,
): number {
  const topK = retrieved.slice(0, k);

  // Compute DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const gain = relevanceGain(topK[i]!, relevant, partiallyRelevant);
    dcg += gain / Math.log2(i + 2); // log2(rank+1) where rank is 1-indexed
  }

  // Compute ideal DCG: sort all relevant docs by gain descending
  const allGains: number[] = [];
  for (const s of relevant) allGains.push(1.0);
  for (const s of partiallyRelevant) allGains.push(0.5);
  allGains.sort((a, b) => b - a);

  let idcg = 0;
  for (let i = 0; i < Math.min(allGains.length, k); i++) {
    idcg += allGains[i]! / Math.log2(i + 2);
  }

  if (idcg === 0) return 1; // no relevant docs, vacuous
  return dcg / idcg;
}

export function computePerQuery(result: QueryResult): PerQueryMetrics {
  const { query, category, relevant, partiallyRelevant, retrieved } = result;
  const allRelevant = new Set([...relevant, ...partiallyRelevant]);

  return {
    query,
    category,
    p1: precisionAtK(retrieved, relevant, partiallyRelevant, 1),
    p3: precisionAtK(retrieved, relevant, partiallyRelevant, 3),
    p5: precisionAtK(retrieved, relevant, partiallyRelevant, 5),
    r5: recallAtK(retrieved, relevant, partiallyRelevant, 5),
    mrr: mrr(retrieved, relevant, partiallyRelevant),
    ndcg5: ndcgAtK(retrieved, relevant, partiallyRelevant, 5),
    hasRelevantInTop5: retrieved.slice(0, 5).some((s) => allRelevant.has(s)),
  };
}

export function aggregate(perQuery: PerQueryMetrics[]): AggregateMetrics {
  if (perQuery.length === 0) {
    return { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0, ndcg5: 0, failureRate: 1 };
  }

  const n = perQuery.length;
  const sum = (fn: (m: PerQueryMetrics) => number) =>
    perQuery.reduce((acc, m) => acc + fn(m), 0) / n;

  return {
    p1: sum((m) => m.p1),
    p3: sum((m) => m.p3),
    p5: sum((m) => m.p5),
    r5: sum((m) => m.r5),
    mrr: sum((m) => m.mrr),
    ndcg5: sum((m) => m.ndcg5),
    failureRate: perQuery.filter((m) => !m.hasRelevantInTop5).length / n,
  };
}
