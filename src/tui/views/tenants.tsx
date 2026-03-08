import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { TenantInfo } from "../../engine/tenant.ts";
import type { DataSource } from "../data-source.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  activeTenant: string;
  isActive: boolean;
  onSwitchTenant: (name: string) => void;
  onBack: () => void;
  height: number;
};

export function TenantsView({ dataSource, activeTenant, isActive, onSwitchTenant, onBack }: Props) {
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
      if (key.escape) {
        onBack();
        return;
      }

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, tenants.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        const selected = tenants[selectedIndex];
        if (selected) onSwitchTenant(selected.name);
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

  if (loading) return <Text color={theme.muted}>Loading tenants...</Text>;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Tenants
        </Text>
        <Text color={theme.muted}> ({tenants.length})</Text>
      </Box>

      {tenants.map((t, i) => {
        const isSelected = i === selectedIndex;
        const isActive = t.name === activeTenant;
        return (
          <Box key={t.name}>
            <Text color={isSelected ? theme.selected : undefined} bold={isSelected}>
              {isSelected ? ">" : " "}{" "}
            </Text>
            {isActive && <Text color={theme.success}>* </Text>}
            <Text color={isSelected ? theme.selected : undefined} bold={isActive}>
              {t.name}
            </Text>
            <Text color={theme.muted}> {t.sourceDir}</Text>
            <Text color={theme.accent}> ({t.artifactCount} artifacts)</Text>
            {reloading === t.name && <Text color={theme.accent}> reloading...</Text>}
          </Box>
        );
      })}

      {message && (
        <Box marginTop={1}>
          <Text color={message.startsWith("Reload failed") ? theme.error : theme.success}>
            {message}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>j/k navigate Enter switch r reload Esc back (* = active)</Text>
      </Box>
    </Box>
  );
}
