import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { ArtifactView } from "../../../src/engine/reader.ts";
import type { BuildReport } from "../../../src/engine/builder.ts";
import type { TenantInfo } from "../../../src/engine/tenant.ts";
import { ok, type Result } from "../../../src/lib/result.ts";
import type { DataSource, DataSourceError } from "../../../src/tui/data-source.ts";
import { ArtifactDetailView } from "../../../src/tui/views/artifact-detail.tsx";
import { ArtifactListView } from "../../../src/tui/views/artifact-list.tsx";
import { DashboardView } from "../../../src/tui/views/dashboard.tsx";
import { GraphView } from "../../../src/tui/views/graph.tsx";
import { SearchView } from "../../../src/tui/views/search.tsx";
import { KbListView } from "../../../src/tui/views/kb-list.tsx";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeView(overrides: Partial<ArtifactView> = {}): ArtifactView {
  return {
    slug: "test",
    title: "Test",
    tags: ["entity"],
    relationships: [],
    inverseRelationships: [],
    sections: [],
    content: "# Test\n\nContent here.",
    hash: "abc123",
    ...overrides,
  };
}

const orderView = makeView({
  slug: "order",
  title: "Order",
  tags: ["entity", "commerce"],
  relationships: [{ target: "customer", type: "depends-on" }],
  inverseRelationships: [{ target: "line-item", type: "depends-on" }],
  sections: [
    { id: "attributes", heading: "Attributes", level: 2, line: 3 },
    { id: "rules", heading: "Rules", level: 2, line: 6 },
  ],
  content: "# Order\n\n## Attributes\nSome attributes.\n\n## Rules\nSome rules.",
});

const customerView = makeView({
  slug: "customer",
  title: "Customer",
  tags: ["entity", "commerce"],
  relationships: [],
  inverseRelationships: [{ target: "order", type: "depends-on" }],
});

const lineItemView = makeView({
  slug: "line-item",
  title: "Line Item",
  tags: ["entity", "commerce"],
  relationships: [{ target: "order", type: "depends-on" }],
});

const allArtifacts = [orderView, customerView, lineItemView];

function createMockDataSource(
  artifacts: ArtifactView[] = allArtifacts,
): DataSource {
  return {
    mode: "standalone",

    async get(_tenant, slug) {
      const found = artifacts.find((a) => a.slug === slug);
      return ok(found ?? null);
    },

    async search(_tenant, query) {
      const q = query.toLowerCase();
      const results = artifacts
        .filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            a.slug.toLowerCase().includes(q) ||
            a.content.toLowerCase().includes(q),
        )
        .map((a) => ({
          slug: a.slug,
          title: a.title,
          snippet: a.content.slice(0, 100),
          rank: 1.0,
        }));
      return ok(results);
    },

    async traverse(_tenant, from, _relType, _depth) {
      const root = artifacts.find((a) => a.slug === from);
      if (!root) return ok([]);
      const targets = root.relationships
        .map((r) => artifacts.find((a) => a.slug === r.target.split("#")[0]))
        .filter((a): a is ArtifactView => a !== undefined);
      return ok(targets);
    },

    async list(_tenant, filter) {
      let filtered = artifacts;
      if (filter?.tags?.length) {
        filtered = artifacts.filter((a) =>
          filter.tags!.every((t) => a.tags.includes(t)),
        );
      }
      return ok(filtered);
    },

    async listTenants() {
      return ok([
        { name: "test", sourceDir: "/tmp/test", artifactCount: artifacts.length },
        { name: "other", sourceDir: "/tmp/other", artifactCount: 2 },
      ] as TenantInfo[]);
    },

    async reload(_tenant): Promise<Result<BuildReport, DataSourceError>> {
      return ok({
        total: artifacts.length,
        succeeded: artifacts.length,
        failed: [],
      });
    },

    async addKb(_name, _sourceDir) {
      return ok(undefined);
    },

    async removeKb(_name) {
      return ok(undefined);
    },

    close() {},
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// ArtifactListView
// ---------------------------------------------------------------------------
describe("ArtifactListView", () => {
  test("renders artifact list after loading", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    expect(lastFrame()).toContain("Loading");

    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("order");
    expect(frame).toContain("customer");
    expect(frame).toContain("line-item");
  });

  test("shows artifact count", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("(3)");
  });

  test("shows tags", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("entity");
    expect(lastFrame()).toContain("commerce");
  });

  test("calls onSelectArtifact on Enter", async () => {
    const ds = createMockDataSource();
    let selectedSlug: string | null = null;
    const { stdin } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={(slug) => {
          selectedSlug = slug;
        }}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(100);

    stdin.write("\r"); // Enter
    await delay(50);
    expect(selectedSlug).not.toBeNull();
  });

  test("shows hint bar", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("navigate");
    expect(frame).toContain("filter");
  });

  test("shows relationship count", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("2 rels");
  });
});

// ---------------------------------------------------------------------------
// ArtifactDetailView
// ---------------------------------------------------------------------------
describe("ArtifactDetailView", () => {
  test("renders artifact title and slug", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("Order");
    expect(frame).toContain("order");
  });

  test("shows tags", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("entity");
    expect(lastFrame()).toContain("commerce");
  });

  test("shows panel tabs", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("content");
    expect(frame).toContain("relationships");
    expect(frame).toContain("sections");
  });

  test("shows content by default", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("Attributes");
    expect(lastFrame()).toContain("Rules");
  });

  test("switches panels with Tab", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);

    stdin.write("\t");
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain("customer");
    expect(frame).toContain("depends-on");
  });

  test("shows not found for missing artifact", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="nonexistent"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("Not found");
  });

  test("calls onBack on Escape", async () => {
    const ds = createMockDataSource();
    let backedOut = false;
    const { stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {
          backedOut = true;
        }}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    stdin.write("\x1B"); // Escape
    await delay(50);
    expect(backedOut).toBe(true);
  });

  test("shows section count in tab", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("sections (2)");
  });

  test("shows relationship count in tab", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="order"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={30}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("relationships (2)");
  });
});

// ---------------------------------------------------------------------------
// SearchView
// ---------------------------------------------------------------------------
describe("SearchView", () => {
  test("renders search input", () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Search");
    expect(frame).toContain("Type to search");
  });

  test("shows results after typing", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );

    stdin.write("order");
    await delay(400);

    const frame = lastFrame()!;
    expect(frame).toContain("order");
  });

  test("shows result count", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );

    stdin.write("entity");
    await delay(400);

    expect(lastFrame()).toContain("result");
  });

  test("shows hint bar for input mode", () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    expect(lastFrame()).toContain("to results");
  });
});

// ---------------------------------------------------------------------------
// GraphView
// ---------------------------------------------------------------------------
describe("GraphView", () => {
  test("shows input prompt when no initial slug", () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Graph Traverse");
    expect(frame).toContain("Root artifact");
  });

  test("renders graph when initial slug provided", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        initialSlug="order"
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(200);
    const frame = lastFrame()!;
    expect(frame).toContain("order");
    expect(frame).toContain("customer");
  });

  test("shows depth indicator", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        initialSlug="order"
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(200);
    expect(lastFrame()).toContain("depth:");
  });

  test("shows hint bar", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        initialSlug="order"
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={20}
      />,
    );
    await delay(200);
    expect(lastFrame()).toContain("nav");
    expect(lastFrame()).toContain("expand");
  });

  test("calls onBack on Escape from input mode", async () => {
    const ds = createMockDataSource();
    let backedOut = false;
    const { stdin } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {
          backedOut = true;
        }}
        height={20}
      />,
    );
    stdin.write("\x1B");
    await delay(50);
    expect(backedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KbListView (replaces TenantsView)
// ---------------------------------------------------------------------------
describe("KbListView", () => {
  test("renders KB list", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("test");
    expect(frame).toContain("other");
  });

  test("shows active KB indicator", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("*");
  });

  test("shows artifact count per KB", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("(3)");
    expect(lastFrame()).toContain("(2)");
  });

  test("calls onSelectKb on Enter", async () => {
    const ds = createMockDataSource();
    let selected: string | null = null;
    const { stdin } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={(name: string) => {
          selected = name;
        }}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    stdin.write("\r"); // Enter
    await delay(50);
    expect(selected).not.toBeNull();
    expect(selected!).toBe("test");
  });

  test("shows KB count", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("(2)");
  });

  test("shows hint bar", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port={5111}
        height={20}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("navigate");
    expect(frame).toContain("reload");
  });
});

// ---------------------------------------------------------------------------
// DashboardView
// ---------------------------------------------------------------------------
describe("DashboardView", () => {
  test("renders dashboard title", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("KB Info");
  });

  test("shows version", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("pramana");
  });

  test("shows mode", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("standalone");
  });

  test("shows active tenant", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="mytest"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("mytest");
  });

  test("shows tenant summary", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("Tenant Summary");
    expect(frame).toContain("test");
    expect(frame).toContain("other");
  });

  test("shows total artifact count", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {}}
      />,
    );
    await delay(100);
    expect(lastFrame()).toContain("5");
  });

  test("calls onBack on Escape", async () => {
    const ds = createMockDataSource();
    let backedOut = false;
    const { stdin } = render(
      <DashboardView
        dataSource={ds}
        activeTenant="test"
        isActive={true}
        onBack={() => {
          backedOut = true;
        }}
      />,
    );
    await delay(100);
    stdin.write("\x1B");
    await delay(50);
    expect(backedOut).toBe(true);
  });
});
