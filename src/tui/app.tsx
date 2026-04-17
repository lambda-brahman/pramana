import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback, useState } from "react";
import { Breadcrumb } from "./components/breadcrumb.tsx";
import { HelpOverlay } from "./components/help-overlay.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import type { DataSource } from "./data-source.ts";
import { APP_CHROME_LINES } from "./layout.ts";
import { ArtifactDetailView } from "./views/artifact-detail.tsx";
import { ArtifactListView } from "./views/artifact-list.tsx";
import { DashboardView } from "./views/dashboard.tsx";
import { GraphView } from "./views/graph.tsx";
import { KbContextView } from "./views/kb-context.tsx";
import { KbListView } from "./views/kb-list.tsx";
import { SearchView } from "./views/search.tsx";

export type ViewName =
  | "kb-list"
  | "kb-context"
  | "list"
  | "detail"
  | "search"
  | "graph"
  | "dashboard";

type NavEntry = {
  view: ViewName;
  slug?: string;
};

type Props = {
  dataSource: DataSource;
  initialTenant: string;
  port: string;
};

export function App({ dataSource: initialDataSource, initialTenant, port }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [dataSource, setDataSource] = useState<DataSource>(initialDataSource);
  const [navStack, setNavStack] = useState<NavEntry[]>([{ view: "kb-list" }]);
  const [tenant, setTenant] = useState(initialTenant);
  const [showHelp, setShowHelp] = useState(false);
  const [isFormActive, setIsFormActive] = useState(false);

  const swapDataSource = useCallback((ds: DataSource) => {
    setDataSource(ds);
  }, []);

  const termHeight = stdout?.rows ?? 24;
  const contentHeight = termHeight - APP_CHROME_LINES;

  const current = navStack[navStack.length - 1]!;
  const view = current.view;
  const selectedSlug = current.slug ?? null;

  function navigateTo(target: ViewName, slug?: string) {
    setNavStack((stack) => [...stack, { view: target, slug }]);
  }

  function goBack() {
    setNavStack((stack) => {
      if (stack.length <= 1) {
        exit();
        return stack;
      }
      return stack.slice(0, -1);
    });
  }

  function buildBreadcrumb(): string[] {
    const crumbs: string[] = ["pramana"];
    for (const entry of navStack) {
      switch (entry.view) {
        case "kb-list":
          break;
        case "kb-context":
          crumbs.push(tenant);
          break;
        case "list":
          crumbs.push("Artifacts");
          break;
        case "detail":
          crumbs.push(entry.slug ?? "");
          break;
        case "search":
          crumbs.push("Search");
          break;
        case "graph":
          crumbs.push("Graph");
          break;
        case "dashboard":
          crumbs.push("Info");
          break;
      }
    }
    return crumbs;
  }

  // Global keybindings
  const isSearchActive = view === "search";
  useInput(
    (input, key) => {
      if (showHelp) {
        setShowHelp(false);
        return;
      }

      if (input === "?") {
        setShowHelp(true);
        return;
      }

      if (input === "q") {
        if (view === "kb-list") {
          exit();
        } else {
          goBack();
        }
        return;
      }

      // Esc on kb-list exits (no view-level handler for kb-list Esc)
      if (key.escape && view === "kb-list") {
        exit();
        return;
      }
    },
    { isActive: !isSearchActive && !showHelp && !isFormActive },
  );

  // Help dismissal
  useInput(
    () => {
      setShowHelp(false);
    },
    { isActive: showHelp },
  );

  if (showHelp) {
    return (
      <Box flexDirection="column" height={termHeight}>
        <HelpOverlay />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Breadcrumb */}
      <Breadcrumb segments={buildBreadcrumb()} />

      <Box flexDirection="column" flexGrow={1}>
        {view === "kb-list" && (
          <KbListView
            dataSource={dataSource}
            activeTenant={tenant}
            isActive={view === "kb-list"}
            onSelectKb={(name) => {
              setTenant(name);
              navigateTo("kb-context");
            }}
            onReload={() => {}}
            onFormModeChange={setIsFormActive}
            onSwapDataSource={swapDataSource}
            port={port}
            height={contentHeight}
          />
        )}

        {view === "kb-context" && (
          <KbContextView
            dataSource={dataSource}
            tenant={tenant}
            isActive={view === "kb-context"}
            onBrowse={() => navigateTo("list")}
            onSearch={() => navigateTo("search")}
            onGraph={() => navigateTo("graph")}
            onInfo={() => navigateTo("dashboard")}
            onBack={goBack}
            height={contentHeight}
          />
        )}

        {view === "list" && (
          <ArtifactListView
            dataSource={dataSource}
            tenant={tenant}
            isActive={view === "list"}
            onSelectArtifact={(slug) => navigateTo("detail", slug)}
            onBack={goBack}
            height={contentHeight}
          />
        )}

        {view === "detail" && selectedSlug && (
          <ArtifactDetailView
            dataSource={dataSource}
            tenant={tenant}
            slug={selectedSlug}
            isActive={view === "detail"}
            onBack={goBack}
            onNavigate={(slug) => navigateTo("detail", slug)}
            height={contentHeight}
          />
        )}

        {view === "search" && (
          <SearchView
            dataSource={dataSource}
            tenant={tenant}
            isActive={view === "search"}
            onSelectArtifact={(slug) => navigateTo("detail", slug)}
            onBack={goBack}
            height={contentHeight}
          />
        )}

        {view === "graph" && (
          <GraphView
            dataSource={dataSource}
            tenant={tenant}
            isActive={view === "graph"}
            initialSlug={selectedSlug ?? undefined}
            onSelectArtifact={(slug) => navigateTo("detail", slug)}
            onBack={goBack}
            height={contentHeight}
          />
        )}

        {view === "dashboard" && (
          <DashboardView
            dataSource={dataSource}
            activeTenant={tenant}
            isActive={view === "dashboard"}
            onBack={goBack}
          />
        )}
      </Box>

      <StatusBar view={view} tenant={tenant} mode={dataSource.mode} depth={navStack.length} />
    </Box>
  );
}
