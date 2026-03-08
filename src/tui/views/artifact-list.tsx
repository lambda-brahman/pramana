import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { ArtifactView } from "../../engine/reader.ts";
import { ScrollableList } from "../components/scrollable-list.tsx";
import { TextInput } from "../components/text-input.tsx";
import type { DataSource } from "../data-source.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  tenant: string;
  isActive: boolean;
  onSelectArtifact: (slug: string) => void;
  height: number;
};

export function ArtifactListView({
  dataSource,
  tenant,
  isActive,
  onSelectArtifact,
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

  const listHeight = height - 3 - (filterMode ? 1 : 0);

  return (
    <Box flexDirection="column">
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
            <Text color={isSelected ? theme.selected : undefined} bold={isSelected}>
              {isSelected ? ">" : " "}{" "}
            </Text>
            <Text color={isSelected ? theme.selected : undefined}>{item.slug}</Text>
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
        <Text color={theme.muted}>j/k navigate Enter view f filter g/G top/bottom</Text>
      </Box>
    </Box>
  );
}
