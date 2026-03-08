# Search Benchmark v2 Results

**Date**: 2026-03-08
**Iterations**: 3 (first discarded as warmup, averaged last 2)
**Corpora**: pramana-software, user-management, prolog-semantics
**Total queries**: 90 (3 corpora x 30 queries)

## 1. Summary (All Corpora Aggregated)

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.500 | 0.233 | 0.147 | 0.326 | 0.506 | 0.402 | 48.9% |
| fts5-or | 0.767 | 0.481 | 0.349 | 0.727 | 0.808 | 0.729 | 14.4% |
| gte-small | 0.867 | 0.511 | 0.376 | 0.796 | 0.913 | 0.794 | 2.2% |
| bge-small | 0.844 | 0.481 | 0.364 | 0.778 | 0.899 | 0.776 | 2.2% |
| bge-base | 0.811 | 0.493 | 0.371 | 0.781 | 0.876 | 0.770 | 3.3% |
| hybrid | 0.922 | 0.567 | 0.409 | 0.866 | 0.956 | 0.862 | 0.0% |

## 2. Per-Corpus Breakdown

### pramana-software

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.467 | 0.256 | 0.153 | 0.308 | 0.483 | 0.380 | 50.0% |
| fts5-or | 0.633 | 0.467 | 0.340 | 0.625 | 0.692 | 0.626 | 23.3% |
| gte-small | 0.800 | 0.500 | 0.367 | 0.711 | 0.872 | 0.727 | 3.3% |
| bge-small | 0.800 | 0.478 | 0.367 | 0.711 | 0.869 | 0.727 | 3.3% |
| bge-base | 0.767 | 0.511 | 0.380 | 0.736 | 0.842 | 0.715 | 3.3% |
| hybrid | 0.867 | 0.556 | 0.420 | 0.814 | 0.922 | 0.805 | 0.0% |

### user-management

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.333 | 0.133 | 0.080 | 0.236 | 0.333 | 0.283 | 66.7% |
| fts5-or | 0.900 | 0.489 | 0.347 | 0.833 | 0.933 | 0.847 | 3.3% |
| gte-small | 0.967 | 0.544 | 0.373 | 0.886 | 0.967 | 0.893 | 3.3% |
| bge-small | 0.967 | 0.489 | 0.367 | 0.869 | 0.967 | 0.877 | 3.3% |
| bge-base | 0.967 | 0.489 | 0.373 | 0.878 | 0.967 | 0.884 | 3.3% |
| hybrid | 1.000 | 0.567 | 0.373 | 0.903 | 1.000 | 0.921 | 0.0% |

### prolog-semantics

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.700 | 0.311 | 0.207 | 0.434 | 0.700 | 0.543 | 30.0% |
| fts5-or | 0.767 | 0.489 | 0.360 | 0.722 | 0.800 | 0.715 | 16.7% |
| gte-small | 0.833 | 0.489 | 0.387 | 0.789 | 0.901 | 0.763 | 0.0% |
| bge-small | 0.767 | 0.478 | 0.360 | 0.752 | 0.862 | 0.725 | 0.0% |
| bge-base | 0.700 | 0.478 | 0.360 | 0.730 | 0.819 | 0.712 | 3.3% |
| hybrid | 0.900 | 0.578 | 0.433 | 0.881 | 0.944 | 0.859 | 0.0% |

## 3. Category Breakdown (All Corpora)

### fts5-raw

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.667 | 0.676 | 0.565 | 31.5% |
| synonym | 21 | 0.238 | 0.238 | 0.169 | 76.2% |
| concept | 15 | 0.267 | 0.267 | 0.141 | 73.3% |

### fts5-or

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.815 | 0.833 | 0.775 | 14.8% |
| synonym | 21 | 0.571 | 0.667 | 0.625 | 23.8% |
| concept | 15 | 0.867 | 0.917 | 0.711 | 0.0% |

### gte-small

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.852 | 0.893 | 0.780 | 3.7% |
| synonym | 21 | 0.905 | 0.952 | 0.862 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.751 | 0.0% |

### bge-small

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.815 | 0.869 | 0.761 | 3.7% |
| synonym | 21 | 0.905 | 0.952 | 0.842 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.737 | 0.0% |

### bge-base

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.815 | 0.866 | 0.748 | 5.6% |
| synonym | 21 | 0.857 | 0.909 | 0.848 | 0.0% |
| concept | 15 | 0.733 | 0.867 | 0.740 | 0.0% |

### hybrid

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.944 | 0.966 | 0.886 | 0.0% |
| synonym | 21 | 0.905 | 0.944 | 0.893 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.732 | 0.0% |

## 4. Statistical Comparisons (Bootstrap 95% CI)

| Comparison | Metric | Mean Diff | 95% CI | Significant? |
|------------|--------|-----------|--------|-------------|
| gte-small vs bge-small | mrr | 0.014 | [-0.010, 0.043] | No |
| gte-small vs bge-small | ndcg5 | 0.018 | [-0.004, 0.041] | No |
| gte-small vs bge-base | mrr | 0.037 | [-0.006, 0.083] | No |
| gte-small vs bge-base | ndcg5 | 0.024 | [-0.006, 0.057] | No |
| fts5-or vs gte-small (best semantic) | mrr | -0.105 | [-0.194, -0.018] | **Yes** |
| fts5-or vs gte-small (best semantic) | ndcg5 | -0.065 | [-0.145, 0.015] | No |
| hybrid vs gte-small (best semantic) | mrr | 0.042 | [0.006, 0.084] | **Yes** |
| hybrid vs gte-small (best semantic) | ndcg5 | 0.067 | [0.033, 0.106] | **Yes** |

## 5. Resource Usage

| Model | Load Time | RSS Before | RSS After | Embed/Artifact | Query Latency |
|-------|-----------|------------|-----------|----------------|---------------|
| Xenova/gte-small | 119ms | 1494MB | 1722MB | 23.9ms | 4.0ms |
| Xenova/bge-small-en-v1.5 | 180ms | 1744MB | 1368MB | 24.9ms | 5.2ms |
| Xenova/bge-base-en-v1.5 | 490ms | 1245MB | 1218MB | 73.0ms | 12.5ms |

## 6. Side-by-Side Examples

### pramana-software

**Query**: `FTS5 porter tokenizer`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=1.000, P@5=0.200) | 1.000 |
| fts5-or | (P@1=1.000, P@5=0.200) | 1.000 |
| gte-small | (P@1=0.000, P@5=0.200) | 0.333 |
| bge-small | (P@1=0.000, P@5=0.400) | 0.250 |
| bge-base | (P@1=0.000, P@5=0.200) | 0.333 |
| hybrid | (P@1=0.000, P@5=0.200) | 0.500 |

**Query**: `full-text indexing keywords`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=0.000, P@5=0.000) | 0.000 |
| fts5-or | (P@1=0.000, P@5=0.000) | 0.000 |
| gte-small | (P@1=1.000, P@5=0.200) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.200) | 1.000 |
| bge-base | (P@1=0.000, P@5=0.400) | 0.333 |
| hybrid | (P@1=1.000, P@5=0.200) | 1.000 |

**Query**: `how does pramana rebuild the database on every startup`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=0.000, P@5=0.000) | 0.000 |
| fts5-or | (P@1=1.000, P@5=0.400) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.600) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.400) | 1.000 |

### user-management

**Query**: `POST /api/users create`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=0.000, P@5=0.000) | 0.000 |
| fts5-or | (P@1=1.000, P@5=0.400) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.400) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.400) | 1.000 |

**Query**: `register new account`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=0.000, P@5=0.000) | 0.000 |
| fts5-or | (P@1=1.000, P@5=0.400) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.400) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.400) | 1.000 |

**Query**: `what steps happen before a user can be deleted`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=0.000, P@5=0.000) | 0.000 |
| fts5-or | (P@1=1.000, P@5=0.800) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.600) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.600) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.600) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.600) | 1.000 |

### prolog-semantics

**Query**: `term functor arity compound atom variable`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=1.000, P@5=0.600) | 1.000 |
| fts5-or | (P@1=1.000, P@5=0.600) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.400) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.400) | 1.000 |

**Query**: `variable binding mapping constraint notebook`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=1.000, P@5=0.200) | 1.000 |
| fts5-or | (P@1=1.000, P@5=0.400) | 1.000 |
| gte-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-small | (P@1=1.000, P@5=0.400) | 1.000 |
| bge-base | (P@1=1.000, P@5=0.400) | 1.000 |
| hybrid | (P@1=1.000, P@5=0.600) | 1.000 |

**Query**: `how does Prolog find answers to a query through proof search`

| Arm | Top-5 Results | MRR |
|-----|---------------|-----|
| fts5-raw | (P@1=1.000, P@5=0.200) | 1.000 |
| fts5-or | (P@1=0.000, P@5=0.400) | 0.500 |
| gte-small | (P@1=0.000, P@5=0.600) | 0.500 |
| bge-small | (P@1=0.000, P@5=0.600) | 0.500 |
| bge-base | (P@1=0.000, P@5=0.600) | 0.500 |
| hybrid | (P@1=0.000, P@5=0.400) | 0.500 |

## 7. Conclusion

- **Best overall arm**: `hybrid` with MRR=0.956
- **Hybrid arm**: MRR=0.956, nDCG@5=0.862, Failure rate=0.0%
- **FTS5-OR**: MRR=0.808 (baseline FTS5 with stop-word removal + OR)
- **Best semantic**: `gte-small` with MRR=0.913

### Recommendation

Hybrid search (RRF fusion of semantic + FTS5-OR) delivers the best results across all corpora and query types. The improvement over pure semantic search is statistically significant for at least one metric.
