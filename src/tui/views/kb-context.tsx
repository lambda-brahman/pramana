import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { TenantInfo } from "../../engine/tenant.ts";
import type { DataSource } from "../data-source.ts";
import { openInFileManager } from "../platform.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  tenant: string;
  isActive: boolean;
  onBrowse: () => void;
  onSearch: () => void;
  onGraph: () => void;
  onInfo: () => void;
  onBack: () => void;
  height: number;
};

export function KbContextView({
  dataSource,
  tenant,
  isActive,
  onBrowse,
  onSearch,
  onGraph,
  onInfo,
  onBack,
}: Props) {
  const [info, setInfo] = useState<TenantInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = [
    { key: "1", label: "Browse artifacts", action: onBrowse },
    { key: "2", label: "Search", action: onSearch },
    { key: "3", label: "Graph traverse", action: onGraph },
    { key: "i", label: "KB info / dashboard", action: onInfo },
  ];

  const load = useCallback(async () => {
    const result = await dataSource.listTenants();
    if (result.ok) {
      const t = result.value.find((t) => t.name === tenant);
      if (t) setInfo(t);
    }
  }, [dataSource, tenant]);

  useEffect(() => {
    load();
  }, [load]);

  useInput(
    (input, key) => {
      if (key.escape) {
        onBack();
        return;
      }

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        items[selectedIndex]?.action();
      } else if (input === "1") {
        onBrowse();
      } else if (input === "2" || input === "/") {
        onSearch();
      } else if (input === "3") {
        onGraph();
      } else if (input === "i") {
        onInfo();
      } else if (input === "o") {
        if (info?.sourceDir) openInFileManager(info.sourceDir);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      {/* KB header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={theme.primary}>
          {tenant}
        </Text>
        {info && (
          <Box>
            <Text color={theme.muted}>Source: {info.sourceDir}</Text>
            <Text color={theme.accent}> Artifacts: {info.artifactCount}</Text>
          </Box>
        )}
      </Box>

      {/* Menu items */}
      <Box flexDirection="column" marginBottom={1}>
        {items.map((item, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={item.key}>
              <Text
                color={isSelected ? theme.selected : undefined}
                backgroundColor={isSelected ? theme.selectedBg : undefined}
                bold={isSelected}
              >
                {" "}
                [{item.key}] {item.label}
                {"  "}
              </Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color={theme.muted}>[/] Quick search</Text>
        </Box>
      </Box>

      {/* Hints */}
      <Box>
        <Text>
          <Text color={theme.hintKey}>[Enter]</Text>
          <Text color={theme.hintDesc}> select </Text>
          <Text color={theme.hintKey}>[o]</Text>
          <Text color={theme.hintDesc}> open in finder </Text>
          <Text color={theme.hintKey}>[Esc]</Text>
          <Text color={theme.hintDesc}> back to KB list</Text>
        </Text>
      </Box>
    </Box>
  );
}
