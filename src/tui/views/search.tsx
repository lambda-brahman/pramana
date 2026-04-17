import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../../storage/interface.ts";
import { ScrollableList } from "../components/scrollable-list.tsx";
import { TextInput } from "../components/text-input.tsx";
import type { DataSource } from "../data-source.ts";
import { SEARCH_CHROME, SEARCH_RESULT_COUNT_LINES } from "../layout.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  tenant: string;
  isActive: boolean;
  onSelectArtifact: (slug: string) => void;
  onBack: () => void;
  height: number;
};

export function SearchView({
  dataSource,
  tenant,
  isActive,
  onSelectArtifact,
  onBack,
  height,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      const result = await dataSource.search(tenant, q);
      if (result.ok) {
        setResults(result.value);
        setSelectedIndex(0);
      }
      setLoading(false);
    },
    [dataSource, tenant],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  useInput(
    (input, key) => {
      if (inputFocused) {
        if (key.escape) {
          if (query) {
            setQuery("");
            setResults([]);
          } else {
            onBack();
          }
          return;
        }
        if (key.return || key.downArrow) {
          if (results.length > 0) {
            setInputFocused(false);
          }
          return;
        }
        return;
      }

      // Results navigation
      if (key.escape) {
        setInputFocused(true);
        return;
      }
      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => {
          if (i <= 0) {
            setInputFocused(true);
            return 0;
          }
          return i - 1;
        });
      } else if (key.return) {
        const selected = results[selectedIndex];
        if (selected) onSelectArtifact(selected.slug);
      }
    },
    { isActive },
  );

  const resultCountLines = results.length > 0 ? SEARCH_RESULT_COUNT_LINES : 0;
  const listHeight = height - SEARCH_CHROME - resultCountLines;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Search{" "}
        </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Type to search..."
          isActive={isActive && inputFocused}
        />
        {loading && <Text color={theme.muted}> searching...</Text>}
      </Box>

      {results.length > 0 && (
        <Box marginBottom={1}>
          <Text color={theme.muted}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </Text>
        </Box>
      )}

      <ScrollableList
        items={results}
        selectedIndex={inputFocused ? -1 : selectedIndex}
        height={listHeight}
        emptyMessage={query ? "No results" : ""}
        renderItem={(item, _index, isSelected) => (
          <Box flexDirection="column">
            <Box>
              <Text
                color={isSelected ? theme.selected : undefined}
                backgroundColor={isSelected ? theme.selectedBg : undefined}
                bold={isSelected}
              >
                {" "}
                {item.slug}
              </Text>
              <Text color={theme.muted}> {item.title}</Text>
              <Text color={theme.accent}> (rank: {item.rank.toFixed(1)})</Text>
            </Box>
            {item.snippet && (
              <Text color={theme.muted} wrap="wrap">
                {"  "}
                {item.snippet}
              </Text>
            )}
          </Box>
        )}
      />

      <Box marginTop={1}>
        <Text>
          {inputFocused ? (
            <>
              <Text color={theme.hintKey}>[Enter/\u2193]</Text>
              <Text color={theme.hintDesc}> to results </Text>
              <Text color={theme.hintKey}>[Esc]</Text>
              <Text color={theme.hintDesc}> back</Text>
            </>
          ) : (
            <>
              <Text color={theme.hintKey}>[j/k]</Text>
              <Text color={theme.hintDesc}> navigate </Text>
              <Text color={theme.hintKey}>[Enter]</Text>
              <Text color={theme.hintDesc}> view </Text>
              <Text color={theme.hintKey}>[\u2191/Esc]</Text>
              <Text color={theme.hintDesc}> back to input</Text>
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
