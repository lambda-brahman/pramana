import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { TenantInfo } from "../../engine/tenant.ts";
import { VERSION } from "../../version.ts";
import type { DataSource } from "../data-source.ts";
import { theme } from "../theme.ts";

const INFO_LABELS = ["Version", "Mode", "Active tenant", "Total tenants", "Total artifacts"];
const INFO_LABEL_PAD = Math.max(...INFO_LABELS.map((l) => l.length)) + 2;

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
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          KB Info
        </Text>
      </Box>

      {/* Version & Mode */}
      <Box
        flexDirection="column"
        marginBottom={1}
        borderStyle="single"
        borderColor={theme.border}
        paddingX={1}
      >
        <Box>
          <Text color={theme.muted}>{"Version".padEnd(INFO_LABEL_PAD)}</Text>
          <Text>pramana {VERSION}</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>{"Mode".padEnd(INFO_LABEL_PAD)}</Text>
          <Text color={dataSource.mode === "daemon" ? theme.success : theme.accent}>
            {dataSource.mode}
          </Text>
        </Box>
        <Box>
          <Text color={theme.muted}>{"Active tenant".padEnd(INFO_LABEL_PAD)}</Text>
          <Text color={theme.success}>{activeTenant}</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>{"Total tenants".padEnd(INFO_LABEL_PAD)}</Text>
          <Text>{tenants.length}</Text>
        </Box>
        <Box>
          <Text color={theme.muted}>{"Total artifacts".padEnd(INFO_LABEL_PAD)}</Text>
          <Text>{totalArtifacts}</Text>
        </Box>
      </Box>

      {/* Per-tenant stats */}
      <Text bold color={theme.accent}>
        Tenant Summary
      </Text>
      {tenants.map((t) => (
        <Box key={t.name} marginLeft={1}>
          <Box flexShrink={0} marginRight={2}>
            <Text
              color={t.name === activeTenant ? theme.success : undefined}
              bold={t.name === activeTenant}
            >
              {t.name}
            </Text>
          </Box>
          <Text color={theme.muted}>
            {t.artifactCount} artifacts | {t.sourceDir}
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text>
          <Text color={theme.hintKey}>[Esc]</Text>
          <Text color={theme.hintDesc}> back</Text>
        </Text>
      </Box>
    </Box>
  );
}
