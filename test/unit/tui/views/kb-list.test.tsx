import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { TenantInfo } from "../../../../src/engine/tenant.ts";
import { ok } from "../../../../src/lib/result.ts";
import type { DataSource } from "../../../../src/tui/data-source.ts";
import { KB_LIST_CHROME, KB_LIST_FORM_LINES } from "../../../../src/tui/layout.ts";
import { KbListView } from "../../../../src/tui/views/kb-list.tsx";

afterEach(() => {
  cleanup();
});

function makeTenants(count: number): TenantInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `kb-${i + 1}`,
    sourceDir: `/tmp/kb-${i + 1}`,
    artifactCount: i,
  }));
}

function createDataSource(tenants: TenantInfo[]): DataSource {
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
      return ok([]);
    },
    async listTenants() {
      return ok(tenants);
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

describe("KbListView scroll invariants", () => {
  test("listHeight is positive at minimum terminal height (24 rows)", () => {
    const height = 24;
    const listHeight = height - KB_LIST_CHROME;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(18);
  });

  test("listHeight is positive at larger terminal (40 rows)", () => {
    const height = 40;
    const listHeight = height - KB_LIST_CHROME;
    expect(listHeight).toBeGreaterThan(0);
    expect(listHeight).toBe(34);
  });

  test("form mode reduces list height and remains positive at 24 rows", () => {
    const height = 24;
    const formHeight = height - KB_LIST_CHROME - KB_LIST_FORM_LINES;
    expect(formHeight).toBeGreaterThan(0);
    expect(formHeight).toBe(15);
  });

  test("first KB is visible at initial scroll position", async () => {
    const height = 24;
    const listHeight = height - KB_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeTenants(count));

    const { lastFrame } = render(
      <KbListView
        dataSource={ds}
        activeTenant="kb-1"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port="5111"
        height={height}
      />,
    );
    await delay(100);

    expect(lastFrame()).toContain("kb-1");
  });

  test("last KB is visible at max scroll (24 rows)", async () => {
    const height = 24;
    const listHeight = height - KB_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeTenants(count));

    const { lastFrame, stdin } = render(
      <KbListView
        dataSource={ds}
        activeTenant="kb-1"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port="5111"
        height={height}
      />,
    );
    await delay(100);

    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`kb-${count}`);
  });

  test("last KB is visible at max scroll (40 rows)", async () => {
    const height = 40;
    const listHeight = height - KB_LIST_CHROME;
    const count = listHeight + 5;
    const ds = createDataSource(makeTenants(count));

    const { lastFrame, stdin } = render(
      <KbListView
        dataSource={ds}
        activeTenant="kb-1"
        isActive={true}
        onSelectKb={() => {}}
        onReload={() => {}}
        onFormModeChange={() => {}}
        onSwapDataSource={() => {}}
        port="5111"
        height={height}
      />,
    );
    await delay(100);

    for (let i = 0; i < count; i++) {
      stdin.write("j");
    }
    await delay(50);

    expect(lastFrame()).toContain(`kb-${count}`);
  });
});
