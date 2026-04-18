use crate::model::RankedResult;
use std::collections::HashSet;

/// Reciprocal Rank Fusion.
///
/// For each slug, computes `sum(1 / (k + rank_in_list))` across all input lists.
/// Slugs absent from a list receive penalty rank `total_docs + 1`.
pub fn rrf(lists: &[&[RankedResult]], k: usize, total_docs: usize) -> Vec<RankedResult> {
    let penalty_rank = total_docs + 1;

    let mut all_slugs = HashSet::new();
    for list in lists {
        for item in *list {
            all_slugs.insert(item.slug.clone());
        }
    }

    let mut results: Vec<RankedResult> = all_slugs
        .into_iter()
        .map(|slug| {
            let mut rrf_score = 0.0;
            for list in lists {
                match list.iter().position(|r| r.slug == slug) {
                    Some(rank) => rrf_score += 1.0 / (k as f64 + rank as f64 + 1.0),
                    None => rrf_score += 1.0 / (k as f64 + penalty_rank as f64),
                }
            }
            RankedResult {
                slug,
                score: rrf_score,
            }
        })
        .collect();

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranked(slug: &str, score: f64) -> RankedResult {
        RankedResult {
            slug: slug.to_string(),
            score,
        }
    }

    #[test]
    fn item_in_both_lists_ranks_highest() {
        let fts = [ranked("a", 10.0), ranked("b", 5.0)];
        let vec = [ranked("b", 0.9), ranked("c", 0.5)];
        let fused = rrf(&[&fts, &vec], 10, 3);
        assert_eq!(fused[0].slug, "b");
    }

    #[test]
    fn empty_lists_returns_empty() {
        let fused = rrf(&[], 10, 0);
        assert!(fused.is_empty());
    }

    #[test]
    fn single_list_preserves_order() {
        let list = [ranked("x", 3.0), ranked("y", 2.0), ranked("z", 1.0)];
        let fused = rrf(&[&list], 10, 3);
        assert_eq!(fused[0].slug, "x");
        assert_eq!(fused[1].slug, "y");
        assert_eq!(fused[2].slug, "z");
    }

    #[test]
    fn penalty_rank_uses_total_docs_plus_one() {
        let list_a = [ranked("only-a", 1.0)];
        let list_b: [RankedResult; 0] = [];
        let fused = rrf(&[&list_a, &list_b], 10, 100);
        assert_eq!(fused.len(), 1);
        // score = 1/(10+0+1) + 1/(10+101) = 1/11 + 1/111
        let expected = 1.0 / 11.0 + 1.0 / 111.0;
        assert!((fused[0].score - expected).abs() < 1e-10);
    }
}
