import { describe, expect, test } from "bun:test";
import path from "node:path";

const CLI_PATH = path.join(import.meta.dir, "../../../src/cli/index.ts");

async function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("port flag validation", () => {
  test("rejects non-numeric --port", async () => {
    const { stderr, exitCode } = await run(["list", "--port", "foo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
    expect(stderr).toContain("foo");
  });

  test("rejects port 0", async () => {
    const { stderr, exitCode } = await run(["list", "--port", "0"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  test("rejects port 65536", async () => {
    const { stderr, exitCode } = await run(["list", "--port", "65536"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  test("rejects negative port", async () => {
    const { stderr, exitCode } = await run(["list", "--port", "-1"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
  });

  test("rejects non-numeric PRAMANA_PORT env var", async () => {
    const { stderr, exitCode } = await run(["list"], { PRAMANA_PORT: "notaport" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid port");
    expect(stderr).toContain("notaport");
  });
});
