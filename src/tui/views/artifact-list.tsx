import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { ArtifactView } from "../../engine/reader.ts";
import { ScrollableList } from "../components/scrollable-list.tsx";
import { TextInput } from "../components/text-input.tsx";
import type { DataSource } from "../data-source.ts";
import { ARTIFACT_LIST_CHROME, ARTIFACT_LIST_FILTER_LINES } from "../layout.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  tenant: string;
  isActive: boolean;
  onSelectArtifact: (slug: string) => void;
  onBack: () => void;
  height: number;
};

export function ArtifactListView({
  dataSource,
  tenant,
  isActive,
  onSelectArtifact,
  onBack,
  height,
}: Props) {
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState(false);
  const [filterText, setFilterText] = useState("");

  const load = useCallback(
    async (tags?: string[]) => {
      setLoading(true);
      const result = await dataSource.list(tenant, tags?.length ? { tags } : undefined);
      if (result.ok) {
        setArtifacts(result.value);
        setSelectedIndex(0);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    },
    [dataSource, tenant],
  );

  useEffect(() => {
    load();
  }, [load]);

  useInput(
    (input, key) => {
      if (filterMode) {
        if (key.return) {
          setFilterMode(false);
          const tags = filterText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          load(tags.length > 0 ? tags : undefined);
        } else if (key.escape) {
          setFilterMode(false);
          setFilterText("");
          load();
        }
        return;
      }

      if (key.escape) {
        onBack();
        return;
      }

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, artifacts.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (input === "g") {
        setSelectedIndex(0);
      } else if (input === "G") {
        setSelectedIndex(Math.max(0, artifacts.length - 1));
      } else if (key.return) {
        const selected = artifacts[selectedIndex];
        if (selected) onSelectArtifact(selected.slug);
      } else if (input === "f") {
        setFilterMode(true);
      }
    },
    { isActive },
  );

  if (loading) return <Text color={theme.muted}>Loading artifacts...</Text>;
  if (error) return <Text color={theme.error}>Error: {error}</Text>;

  const listHeight = height - ARTIFACT_LIST_CHROME - (filterMode ? ARTIFACT_LIST_FILTER_LINES : 0);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Artifacts
        </Text>
        <Text color={theme.muted}> ({artifacts.length})</Text>
        {filterText && !filterMode && <Text color={theme.tag}> filter: {filterText}</Text>}
      </Box>

      {filterMode && (
        <Box marginBottom={1}>
          <Text color={theme.accent}>Filter tags: </Text>
          <TextInput
            value={filterText}
            onChange={setFilterText}
            placeholder="tag1, tag2 (Enter to apply, Esc to clear)"
          />
        </Box>
      )}

      <ScrollableList
        items={artifacts}
        selectedIndex={selectedIndex}
        height={listHeight}
        emptyMessage="No artifacts found"
        renderItem={(item, _index, isSelected) => (
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
            {item.tags.length > 0 && <Text color={theme.tag}> [{item.tags.join(", ")}]</Text>}
            <Text color={theme.muted}>
              {" "}
              {item.relationships.length + item.inverseRelationships.length} rels
            </Text>
          </Box>
        )}
      />

      <Box marginTop={1}>
        <Text>
          <Text color={theme.hintKey}>[j/k]</Text>
          <Text color={theme.hintDesc}> navigate </Text>
          <Text color={theme.hintKey}>[Enter]</Text>
          <Text color={theme.hintDesc}> view </Text>
          <Text color={theme.hintKey}>[f]</Text>
          <Text color={theme.hintDesc}> filter </Text>
          <Text color={theme.hintKey}>[g/G]</Text>
          <Text color={theme.hintDesc}> top/bottom </Text>
          <Text color={theme.hintKey}>[Esc]</Text>
          <Text color={theme.hintDesc}> back</Text>
        </Text>
      </Box>
    </Box>
  );
}
