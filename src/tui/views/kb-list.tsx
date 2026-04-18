import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import { isDaemonRunning, startDaemon, stopDaemon } from "../../daemon/lifecycle.ts";
import type { TenantInfo } from "../../engine/tenant.ts";
import { NAME_REGEX, RESERVED_NAMES } from "../../lib/tenant-names.ts";
import { ScrollableList } from "../components/scrollable-list.tsx";
import { TextInput } from "../components/text-input.tsx";
import {
  createHttpDataSource,
  createStandaloneFromConfig,
  type DataSource,
} from "../data-source.ts";
import { KB_LIST_CHROME, KB_LIST_FORM_LINES } from "../layout.ts";
import { openInFileManager } from "../platform.ts";
import { theme } from "../theme.ts";

type Mode =
  | { type: "normal" }
  | { type: "adding-name"; value: string; error: string | null }
  | { type: "adding-dir"; name: string; value: string; error: string | null }
  | { type: "confirming-delete"; name: string };

type DaemonState = "checking" | "running" | "stopped" | "starting" | "stopping";

type Props = {
  dataSource: DataSource;
  activeTenant: string;
  isActive: boolean;
  onSelectKb: (name: string) => void;
  onReload: () => void;
  onFormModeChange: (active: boolean) => void;
  onSwapDataSource: (ds: DataSource) => void;
  port: number;
  height: number;
};

function hasMarkdownFiles(dir: string): boolean {
  const glob = new Bun.Glob("**/*.md");
  for (const _file of glob.scanSync({ cwd: dir })) {
    return true;
  }
  return false;
}

export function KbListView({
  dataSource,
  activeTenant,
  isActive,
  onSelectKb,
  onFormModeChange,
  onSwapDataSource,
  port,
  height,
}: Props) {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ type: "normal" });
  const [daemonState, setDaemonState] = useState<DaemonState>("checking");

  const isFormMode = mode.type !== "normal";

  useEffect(() => {
    onFormModeChange(isFormMode);
  }, [isFormMode, onFormModeChange]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await dataSource.listTenants();
    if (result.ok) {
      setTenants(result.value);
      const activeIdx = result.value.findIndex((t) => t.name === activeTenant);
      if (activeIdx >= 0) {
        setSelectedIndex(activeIdx);
      } else {
        setSelectedIndex((prev) => Math.min(prev, Math.max(result.value.length - 1, 0)));
      }
    }
    setLoading(false);
  }, [dataSource, activeTenant]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    isDaemonRunning(port).then((running) => {
      setDaemonState(running ? "running" : "stopped");
    });
  }, [port]);

  useEffect(() => {
    if (daemonState !== "running") return;
    const id = setInterval(async () => {
      const running = await isDaemonRunning(port);
      if (!running) {
        setDaemonState("stopped");
      }
    }, 12_000);
    return () => clearInterval(id);
  }, [daemonState, port]);

  // Normal mode keybindings
  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, tenants.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        const selected = tenants[selectedIndex];
        if (selected) onSelectKb(selected.name);
      } else if (input === "o") {
        const selected = tenants[selectedIndex];
        if (selected) openInFileManager(selected.sourceDir);
      } else if (input === "r") {
        const selected = tenants[selectedIndex];
        if (selected) {
          setReloading(selected.name);
          setMessage(null);
          dataSource.reload(selected.name).then((result) => {
            if (result.ok) {
              setMessage(
                `Reloaded "${selected.name}": ${result.value.succeeded}/${result.value.total} files`,
              );
            } else {
              setMessage(`Reload failed: ${result.error.message}`);
            }
            setReloading(null);
            load();
          });
        }
      } else if (input === "S") {
        if (daemonState === "stopped") {
          setDaemonState("starting");
          setMessage("Starting daemon...");
          startDaemon(port).then((result) => {
            if (!result.ok) {
              setMessage(`Start failed: ${result.error.message}`);
              setDaemonState("stopped");
              return;
            }
            onSwapDataSource(createHttpDataSource(port));
            setDaemonState("running");
            setMessage(`Daemon started on port ${port}`);
          });
        } else if (daemonState === "running") {
          setDaemonState("stopping");
          setMessage("Stopping daemon, switching to standalone...");
          createStandaloneFromConfig().then(async (standaloneResult) => {
            if (!standaloneResult.ok) {
              setMessage(`Failed to build standalone: ${standaloneResult.error.message}`);
              setDaemonState("running");
              return;
            }
            onSwapDataSource(standaloneResult.value.ds);
            const stopResult = await stopDaemon(port);
            const mountWarning =
              standaloneResult.value.mountFailures.length > 0
                ? ` (failed to mount: ${standaloneResult.value.mountFailures.join(", ")})`
                : "";
            if (!stopResult.ok) {
              setMessage(
                `Warning: ${stopResult.error.message}. Switched to standalone.${mountWarning}`,
              );
            } else {
              setMessage(`Daemon stopped — standalone mode${mountWarning}`);
            }
            setDaemonState("stopped");
          });
        }
      } else if (input === "a") {
        setMessage(null);
        setMode({ type: "adding-name", value: "", error: null });
      } else if (input === "d") {
        const selected = tenants[selectedIndex];
        if (selected) {
          setMessage(null);
          setMode({ type: "confirming-delete", name: selected.name });
        }
      }
    },
    { isActive: isActive && !isFormMode },
  );

  // Form mode keybindings (Enter, Esc, y/n for confirm)
  useInput(
    (input, key) => {
      if (mode.type === "adding-name") {
        if (key.escape) {
          setMode({ type: "normal" });
          return;
        }
        if (key.return) {
          const name = mode.value.trim();
          if (!name) {
            setMode({ ...mode, error: "Name is required" });
            return;
          }
          if (!NAME_REGEX.test(name)) {
            setMode({ ...mode, error: "Must match /^[a-z][a-z0-9-]*$/" });
            return;
          }
          if (RESERVED_NAMES.has(name)) {
            setMode({ ...mode, error: `"${name}" is a reserved name` });
            return;
          }
          if (tenants.some((t) => t.name === name)) {
            setMode({ ...mode, error: `"${name}" already exists` });
            return;
          }
          setMode({ type: "adding-dir", name, value: "", error: null });
          return;
        }
      }

      if (mode.type === "adding-dir") {
        if (key.escape) {
          setMode({ type: "normal" });
          return;
        }
        if (key.return) {
          const dir = mode.value.trim();
          if (!dir) {
            setMode({ ...mode, error: "Directory is required" });
            return;
          }
          const absDir = resolve(dir);
          if (!existsSync(absDir)) {
            setMode({ ...mode, error: `Directory does not exist: ${absDir}` });
            return;
          }

          const mdWarning = !hasMarkdownFiles(absDir) ? "No .md files found in directory" : null;
          const name = mode.name;
          setMode({ type: "normal" });
          setMessage("Adding...");
          dataSource.addKb(name, absDir).then((result) => {
            if (result.ok) {
              const base = `Added "${name}"`;
              const daemonHint =
                dataSource.mode === "daemon" ? " (restart daemon to activate)" : "";
              const mdHint = mdWarning ? ` \u2014 ${mdWarning}` : "";
              setMessage(base + daemonHint + mdHint);
            } else {
              setMessage(`Add failed: ${result.error.message}`);
            }
            load();
          });
          return;
        }
      }

      if (mode.type === "confirming-delete") {
        if (input === "y") {
          const name = mode.name;
          setMode({ type: "normal" });
          setMessage("Removing...");
          dataSource.removeKb(name).then((result) => {
            if (result.ok) {
              const daemonHint = dataSource.mode === "daemon" ? " (restart daemon to apply)" : "";
              setMessage(`Removed "${name}"${daemonHint}`);
            } else {
              setMessage(`Remove failed: ${result.error.message}`);
            }
            load();
          });
          return;
        }
        if (input === "n" || key.escape) {
          setMode({ type: "normal" });
          return;
        }
      }
    },
    { isActive: isActive && isFormMode },
  );

  if (loading) return <Text color={theme.muted}>Loading knowledge bases...</Text>;

  const formLines = isFormMode ? KB_LIST_FORM_LINES : 0;
  const listHeight = height - KB_LIST_CHROME - formLines;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Knowledge Bases
        </Text>
        <Text color={theme.muted}> ({tenants.length})</Text>
        <Text> </Text>
        {daemonState === "running" && <Text color={theme.success}>● daemon :{port}</Text>}
        {daemonState === "stopped" && <Text color={theme.muted}>○ standalone</Text>}
        {(daemonState === "starting" ||
          daemonState === "stopping" ||
          daemonState === "checking") && <Text color={theme.accent}>◌ {daemonState}...</Text>}
      </Box>

      <ScrollableList
        items={tenants}
        selectedIndex={selectedIndex}
        height={listHeight}
        emptyMessage="No knowledge bases configured \u2014 press 'a' to add one"
        renderItem={(t, _index, isSelected) => (
          <Box>
            <Text
              color={isSelected ? theme.selected : undefined}
              backgroundColor={isSelected ? theme.selectedBg : undefined}
              bold={isSelected}
            >
              {" "}
              {t.name === activeTenant ? "*" : " "} {t.name}
            </Text>
            <Text color={theme.muted}> {t.sourceDir}</Text>
            <Text color={theme.accent}> ({t.artifactCount})</Text>
            {reloading === t.name && <Text color={theme.accent}> reloading...</Text>}
          </Box>
        )}
      />

      {mode.type === "adding-name" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={theme.accent}>Add KB </Text>
            <Text>Name: </Text>
            <TextInput
              value={mode.value}
              onChange={(v) => setMode({ ...mode, value: v, error: null })}
              placeholder="my-kb"
              isActive={isActive}
            />
          </Box>
          {mode.error && <Text color={theme.error}> {mode.error}</Text>}
        </Box>
      )}

      {mode.type === "adding-dir" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={theme.accent}>Add KB </Text>
            <Text color={theme.muted}>{mode.name} </Text>
            <Text>Directory: </Text>
            <TextInput
              value={mode.value}
              onChange={(v) => setMode({ ...mode, value: v, error: null })}
              placeholder="/path/to/knowledge"
              isActive={isActive}
            />
          </Box>
          {mode.error && <Text color={theme.error}> {mode.error}</Text>}
        </Box>
      )}

      {mode.type === "confirming-delete" && (
        <Box marginTop={1}>
          <Text>
            Remove KB &quot;<Text bold>{mode.name}</Text>&quot;? Config only, source files
            untouched. <Text color={theme.hintKey}>(y/n)</Text>
          </Text>
        </Box>
      )}

      {message && mode.type === "normal" && (
        <Box marginTop={1}>
          <Text
            color={
              message.startsWith("Reload failed") ||
              message.startsWith("Add failed") ||
              message.startsWith("Remove failed")
                ? theme.error
                : theme.success
            }
          >
            {message}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>
          {mode.type === "normal" ? (
            <>
              <Text color={theme.hintKey}>[j/k]</Text>
              <Text color={theme.hintDesc}> navigate </Text>
              <Text color={theme.hintKey}>[Enter]</Text>
              <Text color={theme.hintDesc}> open </Text>
              <Text color={theme.hintKey}>[a]</Text>
              <Text color={theme.hintDesc}> add </Text>
              <Text color={theme.hintKey}>[d]</Text>
              <Text color={theme.hintDesc}> delete </Text>
              <Text color={theme.hintKey}>[o]</Text>
              <Text color={theme.hintDesc}> finder </Text>
              <Text color={theme.hintKey}>[r]</Text>
              <Text color={theme.hintDesc}> reload </Text>
              <Text color={theme.hintKey}>[S]</Text>
              <Text color={theme.hintDesc}>
                {" "}
                {daemonState === "running" ? "stop daemon" : "start daemon"}{" "}
              </Text>
              <Text color={theme.hintKey}>[?]</Text>
              <Text color={theme.hintDesc}> help </Text>
              <Text color={theme.hintKey}>[q]</Text>
              <Text color={theme.hintDesc}> quit</Text>
            </>
          ) : mode.type === "confirming-delete" ? (
            <>
              <Text color={theme.hintKey}>[y]</Text>
              <Text color={theme.hintDesc}> confirm </Text>
              <Text color={theme.hintKey}>[n/Esc]</Text>
              <Text color={theme.hintDesc}> cancel</Text>
            </>
          ) : (
            <>
              <Text color={theme.hintKey}>[Enter]</Text>
              <Text color={theme.hintDesc}> confirm </Text>
              <Text color={theme.hintKey}>[Esc]</Text>
              <Text color={theme.hintDesc}> cancel</Text>
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
