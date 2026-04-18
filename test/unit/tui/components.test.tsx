import { afterEach, describe, expect, test } from "bun:test";
import { Text } from "ink";
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

  test("respects itemHeight for viewport calculation", () => {
    // height=4, items each h=2, no scroll-up indicator.
    // After reserving 1 line for scroll-down indicator: effectiveHeight=3.
    // Only item "alpha" (h=2) fits; item "bravo" would bring total to 4 > 3.
    const items = ["alpha", "bravo", "charlie", "delta", "echo"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={4}
        itemHeight={() => 2}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("alpha");
    expect(frame).not.toContain("bravo");
    expect(frame).not.toContain("charlie");
    expect(frame).toContain("more below");
  });

  test("handles mixed item heights", () => {
    const items = [
      { text: "tall", height: 3 },
      { text: "short", height: 1 },
      { text: "medium", height: 2 },
      { text: "hidden", height: 1 },
    ];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={5}
        itemHeight={(item) => item.height}
        renderItem={(item) => <Text>{item.text}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("tall");
    expect(frame).toContain("short");
    expect(frame).not.toContain("medium");
    expect(frame).toContain("more below");
  });

  test("shows at least one item even if it exceeds viewport height", () => {
    const items = ["big", "small"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={1}
        itemHeight={() => 3}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("big");
  });

  test("scrolls down with variable heights — backward-walk computes correct offset", async () => {
    // height=4, items each h=2. With both scroll indicators (1 line each),
    // effective item space = 2 lines = 1 item. Selecting item-2 scrolls to
    // offset=2 showing only item-2 (↑2 above, ↓2 below).
    const items = ["item-0", "item-1", "item-2", "item-3", "item-4"];
    const { lastFrame, rerender } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={4}
        itemHeight={() => 2}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    expect(lastFrame()).toContain("item-0");
    expect(lastFrame()).not.toContain("item-2");

    rerender(
      <ScrollableList
        items={items}
        selectedIndex={2}
        height={4}
        itemHeight={() => 2}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain("item-2");
    expect(frame).not.toContain("item-1");
    expect(frame).not.toContain("item-0");
  });

  test("selectedIndex=-1 does not corrupt scroll state (shows all items)", () => {
    const items = ["alpha", "beta", "gamma"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={-1}
        height={10}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
    expect(frame).toContain("gamma");
  });

  test("selectedIndex=-1 with many items does not show empty list", () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={-1}
        height={5}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("item-0");
    expect(frame).toContain("item-3");
    expect(frame).not.toContain("item-4");
    expect(frame).toContain("more below");
  });

  test("scroll-down indicator line is subtracted from viewport height", () => {
    // height=5, 1-line items. Without fix: 5 items + indicator = 6 lines (overflow).
    // With fix: 4 items + 1 indicator = 5 lines (exact fit).
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={5}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("item-0");
    expect(frame).toContain("item-3");
    expect(frame).not.toContain("item-4");
    expect(frame).toContain("more below");
  });

  test("both scroll indicators are subtracted from viewport height", async () => {
    // height=6, 1-line items, both indicators visible.
    // Without fix: 6 items + 2 indicators = 8 lines (overflow).
    // With fix: 4 items + 2 indicators = 6 lines (exact fit).
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const { lastFrame, rerender } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={6}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    rerender(
      <ScrollableList
        items={items}
        selectedIndex={5}
        height={6}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain("more above");
    expect(frame).toContain("more below");
    // With height=6 and both indicators, exactly 4 item lines available
    const lines = frame.split("\n").filter((l) => l.includes("item-"));
    expect(lines.length).toBe(4);
  });


  test("scroll indicator 'more below' count reflects variable heights", () => {
    // height=4, items each h=2, offset=0 (no scroll-up indicator).
    // After reserving 1 line for scroll-down: effectiveHeight=3.
    // Only item "a" (h=2) fits → endIndex=1 → "3 more below" (b, c, d).
    const items = ["a", "b", "c", "d"];
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        height={4}
        itemHeight={() => 2}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("3 more below");
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
    const frame = lastFrame()!;
    expect(frame).toContain("test");
  });

  test("handles character input", async () => {
    let current = "";
    const { stdin } = render(
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
      <StatusBar view="list" tenant="test" mode="standalone" depth={1} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Artifacts");
  });

  test("renders tenant name", () => {
    const { lastFrame } = render(
      <StatusBar view="search" tenant="myknowledge" mode="daemon" depth={2} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("myknowledge");
    expect(frame).toContain("Search");
  });

  test("renders mode", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="daemon" depth={1} />,
    );
    expect(lastFrame()).toContain("daemon");
  });

  test("renders standalone mode", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="standalone" depth={1} />,
    );
    expect(lastFrame()).toContain("standalone");
  });

  test("renders help hint", () => {
    const { lastFrame } = render(
      <StatusBar view="list" tenant="test" mode="standalone" depth={1} />,
    );
    expect(lastFrame()).toContain("help");
  });

  test("renders all view types correctly", () => {
    const views = [
      { name: "list" as const, label: "Artifacts" },
      { name: "detail" as const, label: "Detail" },
      { name: "search" as const, label: "Search" },
      { name: "graph" as const, label: "Graph" },
      { name: "kb-list" as const, label: "KB List" },
      { name: "kb-context" as const, label: "KB Hub" },
      { name: "dashboard" as const, label: "Info" },
    ];

    for (const v of views) {
      cleanup();
      const { lastFrame } = render(
        <StatusBar view={v.name} tenant="t" mode="standalone" depth={1} />,
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
    expect(lastFrame()).toContain("Toggle help");
  });

  test("shows navigation keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Browse artifacts");
    expect(frame).toContain("Search");
    expect(frame).toContain("Graph traverse");
    expect(frame).toContain("Toggle help");
    expect(frame).toContain("Go back one level");
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
    expect(frame).toContain("Pan horizontally");
    expect(frame).toContain("Reset horizontal scroll");
    expect(frame).toContain("Cycle panels");
    expect(frame).toContain("Follow relationship");
  });

  test("shows search keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Incremental search");
    expect(frame).toContain("Navigate results");
    expect(frame).toContain("Pan snippets");
    expect(frame).toContain("View result");
  });

  test("shows dismiss hint", () => {
    const { lastFrame } = render(<HelpOverlay />);
    expect(lastFrame()).toContain("Press any key to dismiss");
  });

  test("shows KB list keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Enter KB");
    expect(frame).toContain("Open source in file manager");
    expect(frame).toContain("Reload KB");
  });

  test("shows graph keybindings", () => {
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame()!;
    expect(frame).toContain("Navigate tree");
    expect(frame).toContain("Expand/collapse");
    expect(frame).toContain("Change root");
  });
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
