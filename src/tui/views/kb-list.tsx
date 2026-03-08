import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { TenantInfo } from "../../engine/tenant.ts";
import { ScrollableList } from "../components/scrollable-list.tsx";
import type { DataSource } from "../data-source.ts";
import { openInFileManager } from "../platform.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  activeTenant: string;
  isActive: boolean;
  onSelectKb: (name: string) => void;
  onReload: () => void;
  height: number;
};

export function KbListView({ dataSource, activeTenant, isActive, onSelectKb, height }: Props) {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await dataSource.listTenants();
    if (result.ok) {
      setTenants(result.value);
      const activeIdx = result.value.findIndex((t) => t.name === activeTenant);
      if (activeIdx >= 0) setSelectedIndex(activeIdx);
    }
    setLoading(false);
  }, [dataSource, activeTenant]);

  useEffect(() => {
    load();
  }, [load]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, tenants.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        const selected = tenants[selectedIndex];
        if (selected) onSelectKb(selected.name);
      } else if (input === "o") {
        const selected = tenants[selectedIndex];
        if (selected) openInFileManager(selected.sourceDir);
      } else if (input === "r") {
        const selected = tenants[selectedIndex];
        if (selected) {
          setReloading(selected.name);
          setMessage(null);
          dataSource.reload(selected.name).then((result) => {
            if (result.ok) {
              setMessage(
                `Reloaded "${selected.name}": ${result.value.succeeded}/${result.value.total} files`,
              );
            } else {
              setMessage(`Reload failed: ${result.error.message}`);
            }
            setReloading(null);
            load();
          });
        }
      }
    },
    { isActive },
  );

  if (loading) return <Text color={theme.muted}>Loading knowledge bases...</Text>;

  const listHeight = height - 5;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Knowledge Bases
        </Text>
        <Text color={theme.muted}> ({tenants.length})</Text>
      </Box>

      <ScrollableList
        items={tenants}
        selectedIndex={selectedIndex}
        height={listHeight}
        emptyMessage="No knowledge bases configured"
        renderItem={(t, _index, isSelected) => (
          <Box>
            <Text
              color={isSelected ? theme.selected : undefined}
              backgroundColor={isSelected ? theme.selectedBg : undefined}
              bold={isSelected}
            >
              {" "}
              {t.name === activeTenant ? "*" : " "} {t.name}
            </Text>
            <Text color={theme.muted}> {t.sourceDir}</Text>
            <Text color={theme.accent}> ({t.artifactCount})</Text>
            {reloading === t.name && <Text color={theme.accent}> reloading...</Text>}
          </Box>
        )}
      />

      {message && (
        <Box marginTop={1}>
          <Text color={message.startsWith("Reload failed") ? theme.error : theme.success}>
            {message}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>
          <Text color={theme.hintKey}>[j/k]</Text>
          <Text color={theme.hintDesc}> navigate </Text>
          <Text color={theme.hintKey}>[Enter]</Text>
          <Text color={theme.hintDesc}> open </Text>
          <Text color={theme.hintKey}>[o]</Text>
          <Text color={theme.hintDesc}> finder </Text>
          <Text color={theme.hintKey}>[r]</Text>
          <Text color={theme.hintDesc}> reload </Text>
          <Text color={theme.hintKey}>[?]</Text>
          <Text color={theme.hintDesc}> help </Text>
          <Text color={theme.hintKey}>[q]</Text>
          <Text color={theme.hintDesc}> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
