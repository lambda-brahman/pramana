import { Box, Text } from "ink";
import type { ViewName } from "../app.tsx";
import { theme } from "../theme.ts";

type Props = {
  view: ViewName;
  tenant: string;
  mode: "daemon" | "standalone";
};

const viewLabels: Record<ViewName, string> = {
  list: "Artifacts",
  detail: "Detail",
  search: "Search",
  graph: "Graph",
  tenants: "Tenants",
  dashboard: "Dashboard",
};

export function StatusBar({ view, tenant, mode }: Props) {
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Box marginRight={2}>
        <Text color={theme.primary} bold>
          {" "}
          pramana
        </Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.muted}>view:</Text>
        <Text color={theme.accent}>{viewLabels[view]}</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.muted}>tenant:</Text>
        <Text color={theme.success}>{tenant}</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.muted}>mode:</Text>
        <Text color={mode === "daemon" ? theme.success : theme.accent}>{mode}</Text>
      </Box>
      <Box flexGrow={1} />
      <Text color={theme.muted}>? help q quit</Text>
    </Box>
  );
}
