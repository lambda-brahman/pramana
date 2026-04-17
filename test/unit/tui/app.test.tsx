import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { ArtifactView } from "../../../src/engine/reader.ts";
import type { BuildReport } from "../../../src/engine/builder.ts";
import type { TenantInfo } from "../../../src/engine/tenant.ts";
import { ok, type Result } from "../../../src/lib/result.ts";
import { App } from "../../../src/tui/app.tsx";
import type { DataSource, DataSourceError } from "../../../src/tui/data-source.ts";

afterEach(() => {
  cleanup();
});

function makeView(overrides: Partial<ArtifactView> = {}): ArtifactView {
  return {
    slug: "test",
    title: "Test",
    tags: ["entity"],
    relationships: [],
    inverseRelationships: [],
    sections: [],
    content: "# Test\n\nContent.",
    hash: "abc123",
    ...overrides,
  };
}

const artifacts = [
  makeView({ slug: "order", title: "Order", tags: ["entity", "commerce"] }),
  makeView({ slug: "customer", title: "Customer" }),
];

function createMockDataSource(): DataSource {
  return {
    mode: "standalone",
    async get(_t, slug) {
      return ok(artifacts.find((a) => a.slug === slug) ?? null);
    },
    async search(_t, q) {
      const results = artifacts
        .filter((a) => a.slug.includes(q) || a.title.toLowerCase().includes(q.toLowerCase()))
        .map((a) => ({ slug: a.slug, title: a.title, snippet: "", rank: 1 }));
      return ok(results);
    },
    async traverse() {
      return ok([]);
    },
    async list() {
      return ok(artifacts);
    },
    async listTenants() {
      return ok([{ name: "test", sourceDir: "/tmp", artifactCount: 2 }] as TenantInfo[]);
    },
    async reload(): Promise<Result<BuildReport, DataSourceError>> {
      return ok({ total: 2, succeeded: 2, failed: [] });
    },
    async addKb() {
      return ok(undefined);
    },
    async removeKb() {
      return ok(undefined);
    },
    close() {},
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("App", () => {
  test("renders with status bar showing initial tenant", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" port={5111} />);
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("pramana");
    expect(frame).toContain("test");
    expect(frame).toContain("standalone");
  });

  test("starts on KB list view", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" port={5111} />);
    await delay(100);
    expect(lastFrame()).toContain("Knowledge Bases");
  });

  test("shows KB list on startup", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" port={5111} />);
    await delay(200);
    const frame = lastFrame()!;
    expect(frame).toContain("test");
    expect(frame).toContain("Knowledge Bases");
  });

  test("shows help overlay on ? key", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("?");
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain("Toggle help");
  });

  test("dismisses help overlay on any key", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("?");
    await delay(50);
    expect(lastFrame()).toContain("Toggle help");

    stdin.write("x"); // any key
    await delay(50);
    expect(lastFrame()).not.toContain("Toggle help");
  });

  test("navigates to KB context on Enter", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter to select KB
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("Browse artifacts");
  });

  test("navigates KB context > browse > artifact list", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    stdin.write("1"); // Browse artifacts
    await delay(200);

    const frame = lastFrame()!;
    expect(frame).toContain("Artifacts");
    expect(frame).toContain("order");
    expect(frame).toContain("customer");
  });

  test("navigates KB context > search", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    stdin.write("2"); // Search
    await delay(50);

    const frame = lastFrame()!;
    expect(frame).toContain("Search");
    expect(frame).toContain("Type to search");
  });

  test("navigates KB context > graph", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    stdin.write("3"); // Graph
    await delay(50);

    expect(lastFrame()).toContain("Graph Traverse");
  });

  test("navigates KB context > dashboard", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    stdin.write("i"); // Info/dashboard
    await delay(150);

    expect(lastFrame()).toContain("KB Info");
  });

  test("Esc navigates back through stack", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    // KB list → KB context
    stdin.write("\r");
    await delay(100);
    expect(lastFrame()).toContain("Browse artifacts");

    // KB context → artifact list
    stdin.write("1");
    await delay(200);
    expect(lastFrame()).toContain("Artifacts");

    // Esc back to KB context
    stdin.write("\x1B");
    await delay(100);
    expect(lastFrame()).toContain("Browse artifacts");

    // Esc back to KB list
    stdin.write("\x1B");
    await delay(100);
    expect(lastFrame()).toContain("Knowledge Bases");
  });

  test("q from KB context goes back to KB list", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    expect(lastFrame()).toContain("Browse artifacts");

    stdin.write("q"); // back
    await delay(100);
    expect(lastFrame()).toContain("Knowledge Bases");
  });

  test("status bar shows KB List on startup", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);
    expect(lastFrame()).toContain("KB List");
  });

  test("status bar updates on navigation", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    stdin.write("\r"); // Enter KB
    await delay(100);
    expect(lastFrame()).toContain("KB Hub");
  });

  test("renders daemon mode in status bar", async () => {
    const ds = createMockDataSource();
    (ds as { mode: string }).mode = "daemon";
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" port={5111} />);
    await delay(100);
    expect(lastFrame()).toContain("daemon");
  });

  test("breadcrumb shows navigation path", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" port={5111} />,
    );
    await delay(100);

    // Initially just "pramana"
    expect(lastFrame()).toContain("pramana");

    // Enter KB → shows tenant name in breadcrumb
    stdin.write("\r");
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("pramana");
    expect(frame).toContain("test");
  });
});
