import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import { ok } from "../../../../src/lib/result.ts";
import type { SearchResult } from "../../../../src/storage/interface.ts";
import type { DataSource } from "../../../../src/tui/data-source.ts";
import { SEARCH_CHROME, SEARCH_RESULT_COUNT_LINES } from "../../../../src/tui/layout.ts";
import { SearchView } from "../../../../src/tui/views/search.tsx";

afterEach(() => {
  cleanup();
});

function makeResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `result-${i + 1}`,
    title: `Result ${i + 1}`,
    snippet: `snippet for result ${i + 1}`,
    rank: count - i,
  }));
}

function createDataSource(results: SearchResult[]): DataSource {
  return {
    mode: "standalone",
    async get() {
      return ok(null);
    },
    async search() {
      return ok(results);
    },
    async traverse() {
      return ok([]);
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

describe("SearchView scroll invariants", () => {
  test("listHeight without results is positive at minimum terminal height (24 rows)", () => {
    const height = 24;
    const listHeight = height - SEARCH_CHROME;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(18);
  });

  test("listHeight with results accounts for result-count lines and remains positive", () => {
    const height = 24;
    const listHeight = height - SEARCH_CHROME - SEARCH_RESULT_COUNT_LINES;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(16);
  });

  test("listHeight with results is positive at larger terminal (40 rows)", () => {
    const height = 40;
    const listHeight = height - SEARCH_CHROME - SEARCH_RESULT_COUNT_LINES;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(32);
  });

  test("last result is visible at max scroll (24 rows)", async () => {
    const height = 24;
    // Use listHeight with result count lines since results will be present
    const listHeight = height - SEARCH_CHROME - SEARCH_RESULT_COUNT_LINES;
    const count = listHeight + 5;
    const ds = createDataSource(makeResults(count));

    const { lastFrame, stdin } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );

    // Type a query to trigger search
    stdin.write("test");
    await delay(400);

    // Switch from input mode to results navigation
    stdin.write("\r");
    await delay(50);

    // Navigate to last result
    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`result-${count}`);
  });

  test("last result is visible at max scroll (40 rows)", async () => {
    const height = 40;
    const listHeight = height - SEARCH_CHROME - SEARCH_RESULT_COUNT_LINES;
    const count = listHeight + 5;
    const ds = createDataSource(makeResults(count));

    const { lastFrame, stdin } = render(
      <SearchView
        dataSource={ds}
        tenant="test"
        isActive={true}
        onSelectArtifact={() => {}}
        onBack={() => {}}
        height={height}
      />,
    );

    stdin.write("test");
    await delay(400);

    stdin.write("\r");
    await delay(50);

    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`result-${count}`);
  });
});
