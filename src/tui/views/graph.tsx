import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { ArtifactView } from "../../engine/reader.ts";
import { TextInput } from "../components/text-input.tsx";
import type { DataSource } from "../data-source.ts";
import { theme } from "../theme.ts";

type TreeNode = {
  slug: string;
  title: string;
  relType: string;
  direction: "out" | "in";
  depth: number;
  children: TreeNode[];
  expanded: boolean;
};

type Props = {
  dataSource: DataSource;
  tenant: string;
  isActive: boolean;
  initialSlug?: string;
  onSelectArtifact: (slug: string) => void;
  onBack: () => void;
  height: number;
};

export function GraphView({
  dataSource,
  tenant,
  isActive,
  initialSlug,
  onSelectArtifact,
  onBack,
  height,
}: Props) {
  const [rootSlug, setRootSlug] = useState(initialSlug ?? "");
  const [inputMode, setInputMode] = useState(!initialSlug);
  const [rootArtifact, setRootArtifact] = useState<ArtifactView | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatNodes, setFlatNodes] = useState<TreeNode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [maxDepth, setMaxDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  const loadGraph = useCallback(
    async (slug: string, depth: number) => {
      if (!slug.trim()) return;
      setLoading(true);
      setError(null);

      const rootResult = await dataSource.get(tenant, slug);
      if (!rootResult.ok) {
        setError(rootResult.error.message);
        setLoading(false);
        return;
      }
      if (!rootResult.value) {
        setError(`Artifact "${slug}" not found`);
        setLoading(false);
        return;
      }

      setRootArtifact(rootResult.value);
      const root = rootResult.value;

      // Build tree from outbound and inbound relationships
      const outNodes: TreeNode[] = root.relationships.map((r) => ({
        slug: r.target.split("#")[0]!,
        title: "",
        relType: r.type,
        direction: "out" as const,
        depth: 1,
        children: [],
        expanded: false,
      }));

      const inNodes: TreeNode[] = root.inverseRelationships.map((r) => ({
        slug: r.target.split("#")[0]!,
        title: "",
        relType: r.type,
        direction: "in" as const,
        depth: 1,
        children: [],
        expanded: false,
      }));

      // Load deeper levels via traverse
      if (depth > 1) {
        const traverseResult = await dataSource.traverse(tenant, slug, undefined, depth);
        if (traverseResult.ok) {
          for (const node of outNodes) {
            const match = traverseResult.value.find((a) => a.slug === node.slug);
            if (match) {
              node.title = match.title;
              node.children = match.relationships.map((r) => ({
                slug: r.target.split("#")[0]!,
                title: "",
                relType: r.type,
                direction: "out" as const,
                depth: 2,
                children: [],
                expanded: false,
              }));
            }
          }
        }
      }

      const allNodes = [...outNodes, ...inNodes];
      setTree(allNodes);
      setSelectedIndex(0);
      setLoading(false);
    },
    [dataSource, tenant],
  );

  useEffect(() => {
    if (rootSlug && !inputMode) {
      loadGraph(rootSlug, maxDepth);
    }
  }, [rootSlug, maxDepth, inputMode, loadGraph]);

  // Flatten tree for navigation
  useEffect(() => {
    const flat: TreeNode[] = [];
    function flatten(nodes: TreeNode[]) {
      for (const node of nodes) {
        flat.push(node);
        if (node.expanded) flatten(node.children);
      }
    }
    flatten(tree);
    setFlatNodes(flat);
  }, [tree]);

  // Keep selected visible
  useEffect(() => {
    const viewH = height - 7;
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + viewH) {
      setScrollOffset(selectedIndex - viewH + 1);
    }
  }, [selectedIndex, height, scrollOffset]);

  useInput(
    (input, key) => {
      if (inputMode) {
        if (key.return && rootSlug.trim()) {
          setInputMode(false);
        } else if (key.escape) {
          onBack();
        }
        return;
      }

      if (key.escape) {
        onBack();
        return;
      }

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, flatNodes.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        const node = flatNodes[selectedIndex];
        if (node) onSelectArtifact(node.slug);
      } else if (input === "e" || key.rightArrow) {
        // Expand/collapse
        const node = flatNodes[selectedIndex];
        if (node && node.children.length > 0) {
          node.expanded = !node.expanded;
          setTree([...tree]);
        }
      } else if (input === "+") {
        setMaxDepth((d) => Math.min(d + 1, 5));
      } else if (input === "-") {
        setMaxDepth((d) => Math.max(d - 1, 1));
      } else if (input === "s") {
        setInputMode(true);
      }
    },
    { isActive },
  );

  if (inputMode) {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.primary}>
          Graph Traverse
        </Text>
        <Box marginTop={1}>
          <Text color={theme.accent}>Root artifact: </Text>
          <TextInput
            value={rootSlug}
            onChange={setRootSlug}
            placeholder="Enter artifact slug..."
            isActive={isActive}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Enter to traverse Esc back</Text>
        </Box>
      </Box>
    );
  }

  if (loading) return <Text color={theme.muted}>Loading graph for {rootSlug}...</Text>;
  if (error) return <Text color={theme.error}>Error: {error}</Text>;

  const viewH = height - 7;
  const visibleNodes = flatNodes.slice(scrollOffset, scrollOffset + viewH);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Graph: {rootArtifact?.title ?? rootSlug}
        </Text>
        <Text color={theme.muted}> (depth: {maxDepth})</Text>
      </Box>

      {/* Root node */}
      <Text color={theme.accent} bold>
        {"●"} {rootSlug}
      </Text>

      {/* Tree */}
      {flatNodes.length === 0 ? (
        <Text color={theme.muted}>No relationships</Text>
      ) : (
        visibleNodes.map((node, i) => {
          const actualIdx = scrollOffset + i;
          const isSelected = actualIdx === selectedIndex;
          const indent = "  ".repeat(node.depth);
          const arrow = node.direction === "out" ? "→" : "←";
          const prefix = node.children.length > 0 ? (node.expanded ? "▼" : "▶") : "─";
          const relColor = node.relType === "depends-on" ? theme.dependsOn : theme.relatesTo;

          return (
            <Box key={`${node.slug}-${node.direction}-${actualIdx}`}>
              <Text color={isSelected ? theme.selected : undefined} bold={isSelected}>
                {isSelected ? ">" : " "}
                {indent}
                {prefix}{" "}
              </Text>
              <Text color={relColor}>{arrow} </Text>
              <Text color={isSelected ? theme.selected : undefined}>{node.slug}</Text>
              <Text color={theme.muted}> [{node.relType}]</Text>
              {node.title && <Text color={theme.muted}> {node.title}</Text>}
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          j/k nav Enter view e expand +/- depth s change root Esc back
        </Text>
      </Box>
    </Box>
  );
}
