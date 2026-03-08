import { Box, Text } from "ink";
import type { ViewName } from "../app.tsx";
import { theme } from "../theme.ts";

type Props = {
  view: ViewName;
  tenant: string;
  mode: "daemon" | "standalone";
  depth: number;
};

const viewLabels: Record<ViewName, string> = {
  "kb-list": "KB List",
  "kb-context": "KB Hub",
  list: "Artifacts",
  detail: "Detail",
  search: "Search",
  graph: "Graph",
  dashboard: "Info",
};

export function StatusBar({ view, tenant, mode, depth }: Props) {
  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.border}
    >
      <Box marginRight={2}>
        <Text color={theme.primary} bold>
          {" "}
          pramana
        </Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.hintDesc}>kb:</Text>
        <Text color={theme.success}>{tenant}</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.hintDesc}>view:</Text>
        <Text color={theme.accent}>{viewLabels[view]}</Text>
      </Box>
      <Box marginRight={2}>
        <Text color={theme.hintDesc}>mode:</Text>
        <Text color={mode === "daemon" ? theme.success : theme.accent}>{mode}</Text>
      </Box>
      {depth > 1 && (
        <Box marginRight={2}>
          <Text color={theme.hintDesc}>depth:</Text>
          <Text color={theme.muted}>{depth}</Text>
        </Box>
      )}
      <Box flexGrow={1} />
      <Text>
        <Text color={theme.hintKey}>?</Text>
        <Text color={theme.hintDesc}> help </Text>
        <Text color={theme.hintKey}>q</Text>
        <Text color={theme.hintDesc}> quit</Text>
      </Text>
    </Box>
  );
}
