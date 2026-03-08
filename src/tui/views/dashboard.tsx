import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { TenantInfo } from "../../engine/tenant.ts";
import { VERSION } from "../../version.ts";
import type { DataSource } from "../data-source.ts";
import { theme } from "../theme.ts";

type Props = {
  dataSource: DataSource;
  activeTenant: string;
  isActive: boolean;
  onBack: () => void;
};

export function DashboardView({ dataSource, activeTenant, isActive, onBack }: Props) {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await dataSource.listTenants();
    if (result.ok) setTenants(result.value);
    setLoading(false);
  }, [dataSource]);

  useEffect(() => {
    load();
  }, [load]);

  useInput(
    (_input, key) => {
      if (key.escape) onBack();
    },
    { isActive },
  );

  if (loading) return <Text color={theme.muted}>Loading dashboard...</Text>;

  const totalArtifacts = tenants.reduce((sum, t) => sum + t.artifactCount, 0);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Dashboard
        </Text>
      </Box>

      {/* Version & Mode */}
      <Box flexDirection="column" marginBottom={1} borderStyle="single" paddingX={1}>
        <Box>
          <Box width={20}>
            <Text color={theme.muted}>Version</Text>
          </Box>
          <Text>pramana {VERSION}</Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={theme.muted}>Mode</Text>
          </Box>
          <Text color={dataSource.mode === "daemon" ? theme.success : theme.accent}>
            {dataSource.mode}
          </Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={theme.muted}>Active tenant</Text>
          </Box>
          <Text color={theme.success}>{activeTenant}</Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={theme.muted}>Total tenants</Text>
          </Box>
          <Text>{tenants.length}</Text>
        </Box>
        <Box>
          <Box width={20}>
            <Text color={theme.muted}>Total artifacts</Text>
          </Box>
          <Text>{totalArtifacts}</Text>
        </Box>
      </Box>

      {/* Per-tenant stats */}
      <Text bold color={theme.accent}>
        Tenant Summary
      </Text>
      {tenants.map((t) => (
        <Box key={t.name} marginLeft={1}>
          <Box width={20}>
            <Text
              color={t.name === activeTenant ? theme.success : undefined}
              bold={t.name === activeTenant}
            >
              {t.name}
            </Text>
          </Box>
          <Text color={theme.muted}>{t.artifactCount} artifacts</Text>
          <Text color={theme.muted}> | {t.sourceDir}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text color={theme.muted}>Esc back</Text>
      </Box>
    </Box>
  );
}
