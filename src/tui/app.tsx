import { Box, useApp, useInput, useStdout } from "ink";
import { useState } from "react";
import { HelpOverlay } from "./components/help-overlay.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import type { DataSource } from "./data-source.ts";
import { ArtifactDetailView } from "./views/artifact-detail.tsx";
import { ArtifactListView } from "./views/artifact-list.tsx";
import { DashboardView } from "./views/dashboard.tsx";
import { GraphView } from "./views/graph.tsx";
import { SearchView } from "./views/search.tsx";
import { TenantsView } from "./views/tenants.tsx";

export type ViewName = "list" | "detail" | "search" | "graph" | "tenants" | "dashboard";

type Props = {
  dataSource: DataSource;
  initialTenant: string;
};

export function App({ dataSource, initialTenant }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<ViewName>("list");
  const [previousView, setPreviousView] = useState<ViewName>("list");
  const [tenant, setTenant] = useState(initialTenant);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const termHeight = stdout?.rows ?? 24;
  const contentHeight = termHeight - 4; // status bar + borders

  function navigateTo(target: ViewName, slug?: string) {
    setPreviousView(view);
    if (slug) setSelectedSlug(slug);
    setView(target);
  }

  function goBack() {
    if (view === "detail") {
      setView(previousView === "detail" ? "list" : previousView);
    } else if (view === "list") {
      exit();
    } else {
      setView("list");
    }
  }

  // Global keybindings — disabled when help is shown or search input is focused
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
        if (view === "list") {
          exit();
        } else {
          setView("list");
        }
        return;
      }

      if (key.escape) {
        goBack();
        return;
      }

      // View switching via number keys
      if (input === "1") setView("list");
      if (input === "2" || input === "/") navigateTo("search");
      if (input === "3") navigateTo("graph");
      if (input === "4") navigateTo("tenants");
      if (input === "5") navigateTo("dashboard");
      if (input === "t") navigateTo("tenants");
    },
    { isActive: !isSearchActive && !showHelp },
  );

  // Help dismissal when in help mode
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
      <Box flexDirection="column" flexGrow={1}>
        {view === "list" && (
          <ArtifactListView
            dataSource={dataSource}
            tenant={tenant}
            isActive={view === "list"}
            onSelectArtifact={(slug) => navigateTo("detail", slug)}
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

        {view === "tenants" && (
          <TenantsView
            dataSource={dataSource}
            activeTenant={tenant}
            isActive={view === "tenants"}
            onSwitchTenant={(name) => {
              setTenant(name);
              setView("list");
            }}
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

      <StatusBar view={view} tenant={tenant} mode={dataSource.mode} />
    </Box>
  );
}
