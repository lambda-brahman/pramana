import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const TEST_PORT = 59876;

function mockFetch(fn: (...args: unknown[]) => unknown) {
  global.fetch = fn as unknown as typeof fetch;
}

describe("isDaemonRunning", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns true when /v1/version responds ok", async () => {
    mockFetch(mock(async () => new Response('{"version":"v1.0.0"}', { status: 200 })));
    const { isDaemonRunning } = await import("../../../src/daemon/lifecycle.ts");
    const result = await isDaemonRunning(TEST_PORT);
    expect(result).toBe(true);
  });

  test("returns false when fetch throws (connection refused)", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const { isDaemonRunning } = await import("../../../src/daemon/lifecycle.ts");
    const result = await isDaemonRunning(TEST_PORT);
    expect(result).toBe(false);
  });

  test("returns false when /v1/version returns non-ok status", async () => {
    mockFetch(mock(async () => new Response("Not Found", { status: 404 })));
    const { isDaemonRunning } = await import("../../../src/daemon/lifecycle.ts");
    const result = await isDaemonRunning(TEST_PORT);
    expect(result).toBe(false);
  });
});

describe("startDaemon", () => {
  const originalFetch = global.fetch;
  const originalSpawn = Bun.spawn;
  const originalSleep = Bun.sleep;

  beforeEach(() => {
    (Bun as { sleep: typeof Bun.sleep }).sleep = mock(async () => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Bun.spawn = originalSpawn;
    (Bun as { sleep: typeof Bun.sleep }).sleep = originalSleep;
  });

  test("returns error when daemon is already running", async () => {
    mockFetch(mock(async () => new Response('{"version":"v1.0.0"}', { status: 200 })));
    const { startDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await startDaemon(TEST_PORT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("already running");
  });

  test("returns error when daemon does not start within timeout", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const spawnMock = mock(() => ({ unref: mock(() => {}) }));
    Bun.spawn = spawnMock as unknown as typeof Bun.spawn;

    const { startDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await startDaemon(TEST_PORT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("did not start");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test("returns ok when daemon starts after a few failed polls", async () => {
    let callCount = 0;
    mockFetch(
      mock(async () => {
        callCount++;
        if (callCount <= 4) throw new Error("ECONNREFUSED");
        return new Response('{"version":"v1.0.0"}', { status: 200 });
      }),
    );
    const spawnMock = mock(() => ({ unref: mock(() => {}) }));
    Bun.spawn = spawnMock as unknown as typeof Bun.spawn;

    const { startDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await startDaemon(TEST_PORT);
    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(callCount).toBeGreaterThan(4);
  });
});

describe("stopDaemon", () => {
  const originalFetch = global.fetch;
  const originalSleep = Bun.sleep;

  beforeEach(() => {
    (Bun as { sleep: typeof Bun.sleep }).sleep = mock(async () => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (Bun as { sleep: typeof Bun.sleep }).sleep = originalSleep;
  });

  test("returns ok immediately when daemon is not running", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { stopDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await stopDaemon(TEST_PORT);
    expect(result.ok).toBe(true);
  });

  test("returns error when daemon does not stop within timeout", async () => {
    let shutdownCalled = false;
    mockFetch(
      mock(async (url: unknown, opts?: unknown) => {
        const urlStr = typeof url === "string" ? url : String(url);
        const method = (opts as RequestInit | undefined)?.method;
        if (method === "POST" && urlStr.includes("/v1/shutdown")) {
          shutdownCalled = true;
          throw new Error("connection closed");
        }
        return new Response('{"version":"v1.0.0"}', { status: 200 });
      }),
    );

    const { stopDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await stopDaemon(TEST_PORT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("did not stop");
    expect(shutdownCalled).toBe(true);
  });

  test("returns ok when daemon stops after shutdown request", async () => {
    let shutdownCalled = false;
    let pollCount = 0;
    mockFetch(
      mock(async (url: unknown, opts?: unknown) => {
        const urlStr = typeof url === "string" ? url : String(url);
        const method = (opts as RequestInit | undefined)?.method;
        if (method === "POST" && urlStr.includes("/v1/shutdown")) {
          shutdownCalled = true;
          return new Response('{"status":"shutting-down"}', { status: 200 });
        }
        pollCount++;
        if (pollCount <= 3) {
          return new Response('{"version":"v1.0.0"}', { status: 200 });
        }
        throw new Error("ECONNREFUSED");
      }),
    );

    const { stopDaemon } = await import("../../../src/daemon/lifecycle.ts");
    const result = await stopDaemon(TEST_PORT);
    expect(result.ok).toBe(true);
    expect(shutdownCalled).toBe(true);
    expect(pollCount).toBeGreaterThan(1);
  });
});
