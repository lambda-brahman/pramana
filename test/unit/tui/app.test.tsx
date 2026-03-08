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
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("App", () => {
  test("renders with status bar showing initial tenant", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" />);
    await delay(100);
    const frame = lastFrame()!;
    expect(frame).toContain("pramana");
    expect(frame).toContain("test");
    expect(frame).toContain("standalone");
  });

  test("starts on list view", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" />);
    await delay(100);
    expect(lastFrame()).toContain("Artifacts");
  });

  test("shows artifact list on startup", async () => {
    const ds = createMockDataSource();
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" />);
    await delay(200);
    const frame = lastFrame()!;
    expect(frame).toContain("order");
    expect(frame).toContain("customer");
  });

  test("shows help overlay on ? key", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
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
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("?");
    await delay(50);
    expect(lastFrame()).toContain("Toggle help");

    stdin.write("x"); // any key
    await delay(50);
    expect(lastFrame()).not.toContain("Toggle help");
  });

  test("switches to search on key 2", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("2");
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain("Search");
    expect(frame).toContain("Type to search");
  });

  test("switches to graph on key 3", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("3");
    await delay(50);
    expect(lastFrame()).toContain("Graph Traverse");
  });

  test("switches to tenants on key 4", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("4");
    await delay(150);
    expect(lastFrame()).toContain("Tenants");
  });

  test("switches to dashboard on key 5", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("5");
    await delay(150);
    expect(lastFrame()).toContain("Dashboard");
  });

  test("switches back to list on key 1", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("5"); // go to dashboard
    await delay(100);
    stdin.write("1"); // back to list
    await delay(100);
    expect(lastFrame()).toContain("Artifacts");
  });

  test("status bar updates on view change", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    expect(lastFrame()).toContain("Artifacts");

    stdin.write("5");
    await delay(100);
    expect(lastFrame()).toContain("Dashboard");
  });

  test("/ key switches to search", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("/");
    await delay(50);
    expect(lastFrame()).toContain("Search");
  });

  test("t key switches to tenants", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("t");
    await delay(150);
    expect(lastFrame()).toContain("Tenants");
  });

  test("q from non-list view returns to list", async () => {
    const ds = createMockDataSource();
    const { lastFrame, stdin } = render(
      <App dataSource={ds} initialTenant="test" />,
    );
    await delay(100);

    stdin.write("5"); // dashboard
    await delay(100);
    stdin.write("q"); // should go back to list
    await delay(100);
    expect(lastFrame()).toContain("Artifacts");
  });

  test("renders daemon mode in status bar", async () => {
    const ds = createMockDataSource();
    (ds as { mode: string }).mode = "daemon";
    const { lastFrame } = render(<App dataSource={ds} initialTenant="test" />);
    await delay(100);
    expect(lastFrame()).toContain("daemon");
  });
});
