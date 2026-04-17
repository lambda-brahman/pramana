import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { ArtifactView } from "../../../../src/engine/reader.ts";
import { ok } from "../../../../src/lib/result.ts";
import type { DataSource } from "../../../../src/tui/data-source.ts";
import { GRAPH_CHROME } from "../../../../src/tui/layout.ts";
import { GraphView } from "../../../../src/tui/views/graph.tsx";

afterEach(() => {
  cleanup();
});

function makeRootArtifact(relCount: number): ArtifactView {
  return {
    slug: "root",
    title: "Root",
    tags: [],
    relationships: Array.from({ length: relCount }, (_, i) => ({
      target: `rel-${i + 1}`,
      type: "depends-on",
    })),
    inverseRelationships: [],
    sections: [],
    content: "",
    hash: "abc",
  };
}

function makeRelArtifact(slug: string): ArtifactView {
  return {
    slug,
    title: slug,
    tags: [],
    relationships: [],
    inverseRelationships: [],
    sections: [],
    content: "",
    hash: "abc",
  };
}

function createDataSource(relCount: number): DataSource {
  const root = makeRootArtifact(relCount);
  const relArtifacts = Array.from({ length: relCount }, (_, i) =>
    makeRelArtifact(`rel-${i + 1}`),
  );

  return {
    mode: "standalone",
    async get(_tenant, slug) {
      if (slug === "root") return ok(root);
      const found = relArtifacts.find((a) => a.slug === slug);
      return ok(found ?? null);
    },
    async search() {
      return ok([]);
    },
    async traverse() {
      return ok(relArtifacts);
    },
    async list() {
      return ok([]);
    },
    async listTenants() {
      return ok([]);
    },
    async reload() {
      return ok({ total: 0, succeeded: 0, failed: [] });
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

describe("GraphView scroll invariants", () => {
  test("viewH is positive at minimum terminal height (24 rows)", () => {
    const height = 24;
    const viewH = height - GRAPH_CHROME;
    expect(viewH).toBeGreaterThan(0);
    expect(viewH).toBe(17);
  });

  test("viewH is positive at larger terminal (40 rows)", () => {
    const height = 40;
    const viewH = height - GRAPH_CHROME;
    expect(viewH).toBeGreaterThan(0);
    expect(viewH).toBe(33);
  });

  test("last node is visible at max scroll (24 rows)", async () => {
    const height = 24;
    const viewH = height - GRAPH_CHROME;
    const relCount = viewH + 5;
    const ds = createDataSource(relCount);

    const { lastFrame, stdin } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        initialSlug="root"
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );
    await delay(200);

    for (let i = 0; i < relCount; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`rel-${relCount}`);
  });

  test("last node is visible at max scroll (40 rows)", async () => {
    const height = 40;
    const viewH = height - GRAPH_CHROME;
    const relCount = viewH + 5;
    const ds = createDataSource(relCount);

    const { lastFrame, stdin } = render(
      <GraphView
        dataSource={ds}
        tenant="test"
        isActive={true}
        initialSlug="root"
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );
    await delay(200);

    for (let i = 0; i < relCount; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`rel-${relCount}`);
  });
});
