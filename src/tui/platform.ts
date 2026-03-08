import { spawn } from "node:child_process";

export function openInFileManager(path: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === "darwin") {
    cmd = "open";
  } else if (platform === "win32") {
    cmd = "explorer";
  } else {
    cmd = "xdg-open";
  }
  spawn(cmd, [path], { detached: true, stdio: "ignore" }).unref();
}
