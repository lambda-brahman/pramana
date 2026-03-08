# Search Benchmark v2 Results

**Date**: 2026-03-08
**Iterations**: 3 (first discarded as warmup, averaged last 2)
**Corpora**: corpus-a, corpus-b, corpus-c
**Total queries**: 90 (3 corpora x 30 queries)

## 1. Summary (All Corpora Aggregated)

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.489 | 0.233 | 0.147 | 0.326 | 0.500 | 0.399 | 48.9% |
| fts5-or | 0.756 | 0.481 | 0.349 | 0.727 | 0.803 | 0.727 | 14.4% |
| gte-small | 0.867 | 0.522 | 0.380 | 0.805 | 0.914 | 0.800 | 2.2% |
| bge-small | 0.856 | 0.481 | 0.373 | 0.793 | 0.906 | 0.789 | 2.2% |
| bge-base | 0.856 | 0.507 | 0.380 | 0.798 | 0.901 | 0.792 | 3.3% |
| hybrid | 0.922 | 0.570 | 0.409 | 0.866 | 0.956 | 0.863 | 0.0% |

## 2. Per-Corpus Breakdown

### corpus-a

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.467 | 0.256 | 0.153 | 0.308 | 0.483 | 0.380 | 50.0% |
| fts5-or | 0.633 | 0.467 | 0.340 | 0.625 | 0.692 | 0.626 | 23.3% |
| gte-small | 0.800 | 0.500 | 0.367 | 0.711 | 0.872 | 0.727 | 3.3% |
| bge-small | 0.800 | 0.478 | 0.367 | 0.711 | 0.869 | 0.727 | 3.3% |
| bge-base | 0.767 | 0.511 | 0.380 | 0.736 | 0.842 | 0.715 | 3.3% |
| hybrid | 0.867 | 0.556 | 0.420 | 0.814 | 0.922 | 0.805 | 0.0% |

### corpus-b

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.333 | 0.133 | 0.080 | 0.236 | 0.333 | 0.283 | 66.7% |
| fts5-or | 0.900 | 0.489 | 0.347 | 0.833 | 0.933 | 0.847 | 3.3% |
| gte-small | 0.967 | 0.544 | 0.373 | 0.886 | 0.967 | 0.893 | 3.3% |
| bge-small | 0.967 | 0.489 | 0.367 | 0.869 | 0.967 | 0.877 | 3.3% |
| bge-base | 0.967 | 0.489 | 0.373 | 0.878 | 0.967 | 0.884 | 3.3% |
| hybrid | 1.000 | 0.567 | 0.373 | 0.903 | 1.000 | 0.921 | 0.0% |

### corpus-c

| Arm | P@1 | P@3 | P@5 | R@5 | MRR | nDCG@5 | Fail% |
|-----|-----|-----|-----|-----|-----|--------|-------|
| fts5-raw | 0.667 | 0.311 | 0.207 | 0.434 | 0.683 | 0.536 | 30.0% |
| fts5-or | 0.733 | 0.489 | 0.360 | 0.722 | 0.783 | 0.709 | 16.7% |
| gte-small | 0.833 | 0.522 | 0.400 | 0.817 | 0.903 | 0.779 | 0.0% |
| bge-small | 0.800 | 0.478 | 0.387 | 0.798 | 0.881 | 0.765 | 0.0% |
| bge-base | 0.833 | 0.522 | 0.387 | 0.780 | 0.894 | 0.778 | 3.3% |
| hybrid | 0.900 | 0.589 | 0.433 | 0.881 | 0.944 | 0.862 | 0.0% |

## 3. Category Breakdown (All Corpora)

### fts5-raw

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.648 | 0.667 | 0.561 | 31.5% |
| synonym | 21 | 0.238 | 0.238 | 0.169 | 76.2% |
| concept | 15 | 0.267 | 0.267 | 0.141 | 73.3% |

### fts5-or

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.796 | 0.824 | 0.771 | 14.8% |
| synonym | 21 | 0.571 | 0.667 | 0.625 | 23.8% |
| concept | 15 | 0.867 | 0.917 | 0.711 | 0.0% |

### gte-small

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.852 | 0.894 | 0.786 | 3.7% |
| synonym | 21 | 0.905 | 0.952 | 0.869 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.754 | 0.0% |

### bge-small

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.833 | 0.880 | 0.777 | 3.7% |
| synonym | 21 | 0.905 | 0.952 | 0.844 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.757 | 0.0% |

### bge-base

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.852 | 0.887 | 0.769 | 5.6% |
| synonym | 21 | 0.857 | 0.913 | 0.868 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.770 | 0.0% |

### hybrid

| Category | Count | P@1 | MRR | nDCG@5 | Fail% |
|----------|-------|-----|-----|--------|-------|
| exact | 54 | 0.944 | 0.966 | 0.887 | 0.0% |
| synonym | 21 | 0.905 | 0.944 | 0.893 | 0.0% |
| concept | 15 | 0.867 | 0.933 | 0.732 | 0.0% |

## 4. Statistical Comparisons (Bootstrap 95% CI)

| Comparison | Metric | Mean Diff | 95% CI | Significant? |
|------------|--------|-----------|--------|-------------|
| gte-small vs bge-small | mrr | 0.008 | [-0.021, 0.039] | No |
| gte-small vs bge-small | ndcg5 | 0.010 | [-0.014, 0.033] | No |
| gte-small vs bge-base | mrr | 0.013 | [-0.024, 0.053] | No |
| gte-small vs bge-base | ndcg5 | 0.008 | [-0.020, 0.039] | No |
| fts5-or vs gte-small (best semantic) | mrr | -0.111 | [-0.201, -0.025] | **Yes** |
| fts5-or vs gte-small (best semantic) | ndcg5 | -0.073 | [-0.154, 0.008] | No |
| hybrid vs gte-small (best semantic) | mrr | 0.042 | [0.004, 0.083] | **Yes** |
| hybrid vs gte-small (best semantic) | ndcg5 | 0.063 | [0.029, 0.102] | **Yes** |

## 5. Resource Usage

| Model | Load Time | RSS Before | RSS After | Embed/Artifact | Query Latency |
|-------|-----------|------------|-----------|----------------|---------------|
| Xenova/gte-small | 134ms | 2114MB | 2239MB | 23.7ms | 3.5ms |
| Xenova/bge-small-en-v1.5 | 126ms | 2269MB | 2361MB | 25.7ms | 4.7ms |
| Xenova/bge-base-en-v1.5 | 360ms | 2395MB | 2553MB | 75.4ms | 13.2ms |

## 6. Side-by-Side Examples

### corpus-a

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

### corpus-b

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

### corpus-c

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
| bge-base | (P@1=1.000, P@5=0.600) | 1.000 |
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
- **Hybrid arm**: MRR=0.956, nDCG@5=0.863, Failure rate=0.0%
- **FTS5-OR**: MRR=0.803 (baseline FTS5 with stop-word removal + OR)
- **Best semantic**: `gte-small` with MRR=0.914

### Recommendation

Hybrid search (RRF fusion of semantic + FTS5-OR) delivers the best results across all corpora and query types. The improvement over pure semantic search is statistically significant for at least one metric.
