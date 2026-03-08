const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "not", "no", "nor", "so", "if", "then", "than", "that", "this",
  "these", "those", "it", "its", "i", "me", "my", "we", "us", "our",
  "you", "your", "he", "him", "his", "she", "her", "they", "them",
  "their", "what", "which", "who", "whom", "when", "where", "why",
  "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "just", "about",
  "above", "after", "again", "also", "am", "any", "because", "before",
  "below", "between", "during", "further", "here", "into", "once",
  "out", "over", "there", "through", "under", "until", "up", "very",
  "while",
]);

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Pass query through as-is (current behavior, implicit AND).
 */
export function raw(query: string): string {
  return query;
}

/**
 * Strip stop words, join remaining tokens with OR.
 * e.g. "how does search work" -> "search OR work"
 */
export function orQuery(query: string): string {
  const tokens = tokenize(query);
  const meaningful = tokens.filter((t) => !STOP_WORDS.has(t));
  if (meaningful.length === 0) {
    // If all tokens are stop words, return the original tokens to avoid empty query
    return tokens.join(" OR ");
  }
  return meaningful.join(" OR ");
}
