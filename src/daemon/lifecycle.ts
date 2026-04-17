import { err, ok, type Result } from "../lib/result.ts";

type DaemonError = { type: "daemon"; message: string };

function daemonErr(message: string): DaemonError {
  return { type: "daemon", message };
}

export async function isDaemonRunning(port: string): Promise<boolean> {
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

function buildSpawnArgs(port: string): string[] {
  const script = process.argv[1];
  if (script && (script.endsWith(".ts") || script.endsWith(".js"))) {
    return [process.execPath, "run", script, "serve", "--port", port];
  }
  return [process.execPath, "serve", "--port", port];
}

export async function startDaemon(port: string): Promise<Result<void, DaemonError>> {
  if (await isDaemonRunning(port)) {
    return err(daemonErr(`Daemon already running on port ${port}`));
  }

  const proc = Bun.spawn(buildSpawnArgs(port), {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();

  for (let i = 0; i < 25; i++) {
    await Bun.sleep(200);
    if (await isDaemonRunning(port)) return ok(undefined);
  }

  return err(daemonErr(`Daemon did not start within 5 seconds on port ${port}`));
}

export async function stopDaemon(port: string): Promise<Result<void, DaemonError>> {
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
