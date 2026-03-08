import { Box, Text } from "ink";
import { theme } from "../theme.ts";

type Binding = { keys: string; description: string };

const globalBindings: Binding[] = [
  { keys: "1", description: "Artifact list" },
  { keys: "2 or /", description: "Search" },
  { keys: "3", description: "Graph traverse" },
  { keys: "4", description: "Tenants" },
  { keys: "5", description: "Dashboard" },
  { keys: "?", description: "Toggle help" },
  { keys: "q / Esc", description: "Back / Quit" },
];

const listBindings: Binding[] = [
  { keys: "j/k or arrows", description: "Navigate" },
  { keys: "Enter", description: "View artifact" },
  { keys: "f", description: "Filter by tag" },
  { keys: "g/G", description: "Jump to top/bottom" },
];

const detailBindings: Binding[] = [
  { keys: "j/k or arrows", description: "Scroll content" },
  { keys: "Tab", description: "Cycle panels" },
  { keys: "Enter", description: "Follow relationship" },
  { keys: "Esc", description: "Back to list" },
];

const searchBindings: Binding[] = [
  { keys: "type to search", description: "Incremental search" },
  { keys: "j/k", description: "Navigate results" },
  { keys: "Enter", description: "View result" },
  { keys: "Esc", description: "Back" },
];

function BindingGroup({ title, bindings }: { title: string; bindings: Binding[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.accent}>
        {title}
      </Text>
      {bindings.map((b) => (
        <Box key={b.keys}>
          <Box width={20}>
            <Text color={theme.primary}> {b.keys}</Text>
          </Box>
          <Text>{b.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function HelpOverlay() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color={theme.primary}>
        Pramana TUI — Keybindings
      </Text>
      <Text color={theme.muted}>Press any key to dismiss</Text>
      <Text> </Text>
      <BindingGroup title="Global" bindings={globalBindings} />
      <BindingGroup title="Artifact List" bindings={listBindings} />
      <BindingGroup title="Artifact Detail" bindings={detailBindings} />
      <BindingGroup title="Search" bindings={searchBindings} />
    </Box>
  );
}
