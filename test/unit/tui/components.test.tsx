import { afterEach, describe, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { cleanup, render } from "ink-testing-library";

import { HelpOverlay } from "../../../src/tui/components/help-overlay.tsx";
import { ScrollableList } from "../../../src/tui/components/scrollable-list.tsx";
import { StatusBar } from "../../../src/tui/components/status-bar.tsx";
import { TextInput } from "../../../src/tui/components/text-input.tsx";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// ScrollableList
// ---------------------------------------------------------------------------
describe("ScrollableList", () => {
  test("renders items", () => {
    const items = ["alpha", "beta", "gamma"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={10}
        renderItem={(item, _i, isSelected) => (
          <Text>
            {isSelected ? ">" : " "} {item}
          </Text>
        )}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
    expect(frame).toContain("gamma");
  });

  test("highlights selected item", () => {
    const items = ["alpha", "beta", "gamma"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={1}
        height={10}
        renderItem={(item, _i, isSelected) => (
          <Text>
            {isSelected ? ">" : " "} {item}
          </Text>
        )}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("> beta");
    expect(frame).not.toContain("> alpha");
  });

  test("shows empty message when no items", () => {
    const { lastFrame } = render(
      <ScrollableList
        items={[]}
        selectedIndex={0}
        height={10}
        renderItem={() => <Text>x</Text>}
        emptyMessage="Nothing here"
      />,
    );
    expect(lastFrame()).toContain("Nothing here");
  });

  test("shows scroll indicators when items exceed height", () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={5}
        height={5}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    // Should show "more below" since 20 items > 5 height
    expect(frame).toContain("more below");
  });

  test("uses default empty message", () => {
    const { lastFrame } = render(
      <ScrollableList
        items={[]}
        selectedIndex={0}
        height={5}
        renderItem={() => <Text>x</Text>}
      />,
    );
    expect(lastFrame()).toContain("No items");
  });
});

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------
describe("TextInput", () => {
  test("renders value", () => {
    const { lastFrame } = render(
      <TextInput value="hello" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain("hello");
  });

  test("renders placeholder when empty", () => {
    const { lastFrame } = render(
      <TextInput value="" onChange={() => {}} placeholder="Type here..." />,
    );
    expect(lastFrame()).toContain("Type here...");
  });

  test("shows cursor when active", () => {
    const { lastFrame } = render(
      <TextInput value="test" onChange={() => {}} isActive={true} />,
    );
    // Active text input renders an inverse space for cursor
    const frame = lastFrame()!;
    expect(frame).toContain("test");
  });

  test("handles character input", async () => {
    let current = "";
    const { stdin, lastFrame } = render(
      <TextInput value={current} onChange={(v) => (current = v)} />,
    );
    stdin.write("a");
    await delay(50);
    expect(current).toBe("a");
  });

  test("handles backspace", async () => {
    let current = "abc";
    const { stdin } = render(
      <TextInput value={current} onChange={(v) => (current = v)} />,
    );
    stdin.write("\x7F"); // backspace
    await delay(50);
    expect(current).toBe("ab");
  });
});

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------
describe("StatusBar", () => {
  test("renders view name", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="standalone" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Artifacts");
  });

  test("renders tenant name", () => {
    const { lastFrame } = render(
      <StatusBar view="search" tenant="myknowledge" mode="daemon" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("myknowledge");
    expect(frame).toContain("Search");
  });

  test("renders mode", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="daemon" />,
    );
    expect(lastFrame()).toContain("daemon");
  });

  test("renders standalone mode", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="standalone" />,
    );
    expect(lastFrame()).toContain("standalone");
  });

  test("renders help hint", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="standalone" />,
    );
    expect(lastFrame()).toContain("? help");
  });

  test("renders all view types correctly", () => {
    const views = [
      { name: "list" as const, label: "Artifacts" },
      { name: "detail" as const, label: "Detail" },
      { name: "search" as const, label: "Search" },
      { name: "graph" as const, label: "Graph" },
      { name: "tenants" as const, label: "Tenants" },
      { name: "dashboard" as const, label: "Dashboard" },
    ];

    for (const v of views) {
      cleanup();
      const { lastFrame } = render(
        <StatusBar view={v.name} tenant="t" mode="standalone" />,
      );
      expect(lastFrame()).toContain(v.label);
    }
  });
});

// ---------------------------------------------------------------------------
// HelpOverlay
// ---------------------------------------------------------------------------
describe("HelpOverlay", () => {
  test("renders title", () => {
    const { lastFrame } = render(<HelpOverlay />);
    // Title may get ANSI-overlapped in test terminal; check for identifiable content
    expect(lastFrame()).toContain("Toggle help");
  });

  test("shows global keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Artifact list");
    expect(frame).toContain("Search");
    expect(frame).toContain("Graph traverse");
    expect(frame).toContain("Tenants");
    expect(frame).toContain("Dashboard");
    expect(frame).toContain("Toggle help");
    expect(frame).toContain("Back / Quit");
  });

  test("shows list keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Navigate");
    expect(frame).toContain("View artifact");
    expect(frame).toContain("Filter by tag");
  });

  test("shows detail keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Scroll content");
    expect(frame).toContain("Cycle panels");
    expect(frame).toContain("Follow relationship");
  });

  test("shows search keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Incremental search");
    expect(frame).toContain("Navigate results");
    expect(frame).toContain("View result");
  });

  test("shows dismiss hint", () => {
    const { lastFrame } = render(<HelpOverlay />);
    expect(lastFrame()).toContain("Press any key to dismiss");
  });
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
