pub trait StopWordFilter: Send + Sync {
    fn is_stop_word(&self, word: &str) -> bool;
}

pub struct NoOpFilter;

impl StopWordFilter for NoOpFilter {
    fn is_stop_word(&self, _word: &str) -> bool {
        false
    }
}

fn tokenize(query: &str) -> Vec<String> {
    query
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(|t| t.trim_start_matches('-').to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

pub fn or_query(query: &str, filter: &dyn StopWordFilter) -> String {
    let tokens = tokenize(query);
    let meaningful: Vec<&str> = tokens
        .iter()
        .filter(|t| !filter.is_stop_word(t))
        .map(String::as_str)
        .collect();
    if meaningful.is_empty() {
        tokens.join(" OR ")
    } else {
        meaningful.join(" OR ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestFilter;
    impl StopWordFilter for TestFilter {
        fn is_stop_word(&self, word: &str) -> bool {
            matches!(word, "how" | "does" | "the" | "is" | "a")
        }
    }

    #[test]
    fn tokenize_lowercases_and_strips_punctuation() {
        assert_eq!(tokenize("Hello, World!"), vec!["hello", "world"]);
    }

    #[test]
    fn tokenize_preserves_hyphens() {
        assert_eq!(tokenize("well-known fact"), vec!["well-known", "fact"]);
    }

    #[test]
    fn tokenize_handles_empty_input() {
        let result: Vec<String> = vec![];
        assert_eq!(tokenize(""), result);
    }

    #[test]
    fn or_query_with_no_filter() {
        let filter = NoOpFilter;
        assert_eq!(or_query("rust programming", &filter), "rust OR programming");
    }

    #[test]
    fn or_query_strips_stop_words() {
        let filter = TestFilter;
        assert_eq!(or_query("how does search work", &filter), "search OR work");
    }

    #[test]
    fn or_query_all_stop_words_falls_back() {
        let filter = TestFilter;
        assert_eq!(or_query("how does the", &filter), "how OR does OR the");
    }

    #[test]
    fn or_query_empty_input() {
        let filter = NoOpFilter;
        assert_eq!(or_query("", &filter), "");
    }

    #[test]
    fn tokenize_strips_leading_hyphens() {
        assert_eq!(tokenize("-secret"), vec!["secret"]);
        assert_eq!(tokenize("config -password"), vec!["config", "password"]);
        assert_eq!(tokenize("--double"), vec!["double"]);
    }

    #[test]
    fn tokenize_bare_hyphen_is_dropped() {
        let result: Vec<String> = vec![];
        assert_eq!(tokenize("-"), result);
    }
}
