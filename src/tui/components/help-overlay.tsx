import { Box, Text } from "ink";
import { theme } from "../theme.ts";

type Binding = { keys: string; description: string };

const kbListBindings: Binding[] = [
  { keys: "j/k or arrows", description: "Navigate KBs" },
  { keys: "Enter", description: "Enter KB" },
  { keys: "a", description: "Add knowledge base" },
  { keys: "d", description: "Remove knowledge base" },
  { keys: "o", description: "Open source in file manager" },
  { keys: "r", description: "Reload KB" },
  { keys: "S", description: "Start/stop daemon" },
  { keys: "q", description: "Quit" },
];

const kbContextBindings: Binding[] = [
  { keys: "1 or Enter", description: "Browse artifacts" },
  { keys: "2 or /", description: "Search" },
  { keys: "3", description: "Graph traverse" },
  { keys: "i", description: "KB info / dashboard" },
  { keys: "o", description: "Open source in file manager" },
  { keys: "Esc", description: "Back to KB list" },
];

const listBindings: Binding[] = [
  { keys: "j/k or arrows", description: "Navigate" },
  { keys: "Enter", description: "View artifact" },
  { keys: "f", description: "Filter by tag" },
  { keys: "g/G", description: "Jump to top/bottom" },
  { keys: "Esc", description: "Back to KB hub" },
];

const detailBindings: Binding[] = [
  { keys: "j/k or arrows", description: "Scroll content" },
  { keys: "h/l or ←/→", description: "Pan horizontally" },
  { keys: "0", description: "Reset horizontal scroll" },
  { keys: "Tab", description: "Cycle panels" },
  { keys: "Enter", description: "Follow relationship" },
  { keys: "d/u", description: "Half-page scroll" },
  { keys: "Esc", description: "Back (pops stack)" },
];

const searchBindings: Binding[] = [
  { keys: "type to search", description: "Incremental search" },
  { keys: "j/k", description: "Navigate results" },
  { keys: "h/l", description: "Pan snippets" },
  { keys: "Enter", description: "View result" },
  { keys: "Esc", description: "Back" },
];

const graphBindings: Binding[] = [
  { keys: "j/k", description: "Navigate tree" },
  { keys: "e", description: "Expand/collapse" },
  { keys: "+/-", description: "Increase/decrease depth" },
  { keys: "s", description: "Change root" },
  { keys: "Enter", description: "View artifact" },
  { keys: "Esc", description: "Back" },
];

const globalBindings: Binding[] = [
  { keys: "?", description: "Toggle help" },
  { keys: "q", description: "Back / Quit (from KB list)" },
  { keys: "Esc", description: "Go back one level" },
];

function BindingGroup({ title, bindings }: { title: string; bindings: Binding[] }) {
  const keyPad = Math.max(...bindings.map((b) => b.keys.length)) + 3;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.accent}>
        {title}
      </Text>
      {bindings.map((b) => (
        <Box key={b.keys}>
          <Text color={theme.hintKey}>{` ${b.keys}`.padEnd(keyPad)}</Text>
          <Text color={theme.hintDesc}>{b.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function HelpOverlay() {
  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={theme.border}
    >
      <Text bold color={theme.primary}>
        Pramana TUI — Keybindings
      </Text>
      <Text color={theme.muted}>Press any key to dismiss</Text>
      <Text> </Text>
      <BindingGroup title="Global" bindings={globalBindings} />
      <BindingGroup title="KB List (landing)" bindings={kbListBindings} />
      <BindingGroup title="KB Hub" bindings={kbContextBindings} />
      <BindingGroup title="Artifact List" bindings={listBindings} />
      <BindingGroup title="Artifact Detail" bindings={detailBindings} />
      <BindingGroup title="Search" bindings={searchBindings} />
      <BindingGroup title="Graph" bindings={graphBindings} />
    </Box>
  );
}
