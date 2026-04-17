import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { ArtifactView } from "../../../../src/engine/reader.ts";
import { ok } from "../../../../src/lib/result.ts";
import type { DataSource } from "../../../../src/tui/data-source.ts";
import {
  ARTIFACT_LIST_CHROME,
  ARTIFACT_LIST_FILTER_LINES,
} from "../../../../src/tui/layout.ts";
import { ArtifactListView } from "../../../../src/tui/views/artifact-list.tsx";

afterEach(() => {
  cleanup();
});

function makeArtifacts(count: number): ArtifactView[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `artifact-${i + 1}`,
    title: `Artifact ${i + 1}`,
    tags: [],
    relationships: [],
    inverseRelationships: [],
    sections: [],
    content: "",
    hash: "abc",
  }));
}

function createDataSource(artifacts: ArtifactView[]): DataSource {
  return {
    mode: "standalone",
    async get() {
      return ok(null);
    },
    async search() {
      return ok([]);
    },
    async traverse() {
      return ok([]);
    },
    async list() {
      return ok(artifacts);
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

describe("ArtifactListView scroll invariants", () => {
  test("listHeight is positive at minimum terminal height (24 rows)", () => {
    const height = 24;
    const listHeight = height - ARTIFACT_LIST_CHROME;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(18);
  });

  test("listHeight is positive at larger terminal (40 rows)", () => {
    const height = 40;
    const listHeight = height - ARTIFACT_LIST_CHROME;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(34);
  });

  test("filter mode reduces list height and remains positive at 24 rows", () => {
    const height = 24;
    const filteredHeight = height - ARTIFACT_LIST_CHROME - ARTIFACT_LIST_FILTER_LINES;
    expect(filteredHeight).toBeGreaterThan(0);
    expect(filteredHeight).toBe(16);
  });

  test("first artifact visible at initial scroll position", async () => {
    const height = 24;
    const listHeight = height - ARTIFACT_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeArtifacts(count));

    const { lastFrame } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );
    await delay(100);

    expect(lastFrame()).toContain("artifact-1");
  });

  test("last artifact is visible at max scroll (24 rows)", async () => {
    const height = 24;
    const listHeight = height - ARTIFACT_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeArtifacts(count));

    const { lastFrame, stdin } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );
    await delay(100);

    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`artifact-${count}`);
  });

  test("last artifact is visible at max scroll (40 rows)", async () => {
    const height = 40;
    const listHeight = height - ARTIFACT_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeArtifacts(count));

    const { lastFrame, stdin } = render(
      <ArtifactListView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );
    await delay(100);

    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`artifact-${count}`);
  });
});
