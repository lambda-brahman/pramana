import { err, ok, type Result } from "../lib/result.ts";

type DaemonError = { type: "daemon"; message: string };

function daemonErr(message: string): DaemonError {
  return { type: "daemon", message };
}

export async function isDaemonRunning(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://localhost:${port}/v1/version`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function buildSpawnArgs(port: number): string[] {
  const script = process.argv[1];
  if (script && (script.endsWith(".ts") || script.endsWith(".js"))) {
    return [process.execPath, "run", script, "serve", "--port", String(port)];
  }
  return [process.execPath, "serve", "--port", String(port)];
}

export async function startDaemon(port: number): Promise<Result<void, DaemonError>> {
  if (await isDaemonRunning(port)) {
    return err(daemonErr(`Daemon already running on port ${port}`));
  }

  const proc = Bun.spawn(buildSpawnArgs(port), {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  const stderrChunks: Uint8Array[] = [];
  (async () => {
    if (!proc.stderr) return;
    for await (const chunk of proc.stderr as AsyncIterable<Uint8Array>) {
      stderrChunks.push(chunk);
    }
  })();

  proc.unref();

  for (let i = 0; i < 25; i++) {
    await Bun.sleep(200);
    if (await isDaemonRunning(port)) return ok(undefined);
  }

  const decoder = new TextDecoder();
  const stderrText = stderrChunks
    .map((c) => decoder.decode(c))
    .join("")
    .trim();
  const detail = stderrText ? `: ${stderrText}` : "";
  return err(daemonErr(`Daemon did not start within 30 seconds on port ${port}${detail}`));
}

export async function stopDaemon(port: number): Promise<Result<void, DaemonError>> {
  if (!(await isDaemonRunning(port))) {
    return ok(undefined);
  }

  try {
    await fetch(`http://localhost:${port}/v1/shutdown`, { method: "POST" });
  } catch {
    // Shutdown may close the connection before responding — that's fine
  }

  for (let i = 0; i < 15; i++) {
    await Bun.sleep(200);
    if (!(await isDaemonRunning(port))) return ok(undefined);
  }

  return err(daemonErr(`Daemon did not stop within 3 seconds on port ${port}`));
}
