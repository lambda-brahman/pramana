---
slug: tui
title: TUI
tags: [tui, module]
relationships:
  depends-on: [pramana, cli, data-source, engine, multi-tenant]
---

# TUI

Interactive terminal interface for browsing, querying, and managing Pramana knowledge bases. Built on ink (React for CLI). A presentation layer only — it reads through [[data-source]], never touches [[storage]] or [[parser]] directly.

## Specification

```
pramana tui [--source <dir>[:name] ...] [--port <n>] [--standalone] [--tenant <name>]
```

### Connection lifecycle

```
1. if not --standalone:
     check daemon at port (GET /v1/version, 1s timeout)
     if reachable: ds = HttpDataSource(port), resolve tenants via ds.listTenants()
2. if standalone or daemon unreachable:
     load config + CLI sources → build TenantManager
     ds = ReaderDataSource(tm)
3. initialTenant = --tenant flag ∨ first available tenant
4. render App(ds, initialTenant) via ink
5. await exit signal (q from list view)
```

This mirrors the [[cli]] client mode fallback but launches a persistent interactive session instead of a one-shot command.

### Dynamic import

The TUI imports `ink` and `react` lazily:
```
const { startTui } = await import("../tui/index.tsx")
```
Non-TUI commands (`get`, `search`, `list`, `serve`) never load React. This keeps startup fast for the common path.

## Views

Six views, each a React component. Only one is active at a time.

| View | Key | Component | Data | Active keybindings |
|------|-----|-----------|------|-------------------|
| Artifact List | `1` (default) | `ArtifactListView` | `ds.list(tenant, filter?)` | j/k navigate, Enter view, f filter, g/G top/bottom |
| Artifact Detail | Enter from list/search | `ArtifactDetailView` | `ds.get(tenant, slug)` | j/k scroll, Tab switch panel, Enter follow rel, Esc back |
| Search | `2` or `/` | `SearchView` | `ds.search(tenant, query)` | Type to search, j/k results, Enter view, Esc back |
| Graph | `3` | `GraphView` | `ds.get` + `ds.traverse(tenant, slug, relType?, depth?)` | j/k navigate, e expand, +/- depth, s change root, Esc back |
| Tenants | `4` or `t` | `TenantsView` | `ds.listTenants()` + `ds.reload(tenant)` | j/k navigate, Enter switch, r reload, Esc back |
| Dashboard | `5` | `DashboardView` | `ds.listTenants()` | Esc back |

### Artifact List

Default view. Loads all artifacts via `ds.list()`. Supports:
- Tag filtering: press `f`, type comma-separated tags, Enter to apply, Esc to clear
- Sorted navigation with relationship count display
- Selection indicator (`>`) tracks cursor position

### Artifact Detail

Three tabbed panels, cycled with Tab:
- **content**: scrollable markdown body with j/k and d/u (half-page) scrolling
- **relationships**: outbound (`→`) and inbound (`←`) edges, color-coded by type (`depends-on` = red, `relates-to` = blue). Enter follows a relationship to its target artifact.
- **sections**: lists `##` and `###` headings with line numbers. Enter jumps to the section in the content panel.

### Search

Incremental search with 200ms debounce. Two modes:
- Input focused (default): typing updates query, Enter/↓ moves to results
- Results focused: j/k navigates ranked results, Enter views detail, ↑/Esc returns to input

### Graph

Tree visualization of the relationship graph from a root artifact. Shows outbound and inbound edges with box-drawing characters. Supports:
- Expand/collapse subtrees with `e` or `→`
- Depth control: `+` increases max depth (up to 5), `-` decreases
- Root switching: `s` opens slug input to change the traversal root

### Tenants

Lists all tenants with stats (artifact count, source directory). Active tenant marked with `*`. Enter switches the active tenant (returns to list view). `r` triggers reload via `ds.reload(tenant)` and shows the build report.

### Dashboard

Read-only overview: version, mode (daemon/standalone), active tenant, total tenants, total artifacts, and per-tenant summary with source directories.

## Components

Reusable components shared across views:

| Component | Purpose |
|-----------|---------|
| `ScrollableList<T>` | Virtual scrolling with viewport windowing, scroll indicators (↑/↓ N more), Fragment-keyed items |
| `TextInput` | Keyboard-driven text input with cursor, backspace, placeholder. No external dependency. |
| `StatusBar` | Persistent bottom bar: pramana logo, current view, active tenant, mode, key hints |
| `HelpOverlay` | Full-screen keybinding reference, grouped by context (global, list, detail, search). Any key dismisses. |

## Navigation

### Global keybindings (active in all views except search input)

| Key | Action |
|-----|--------|
| `1` | Switch to Artifact List |
| `2` or `/` | Switch to Search |
| `3` | Switch to Graph |
| `4` or `t` | Switch to Tenants |
| `5` | Switch to Dashboard |
| `?` | Toggle help overlay |
| `q` | Quit (from list) or back to list (from other views) |
| `Esc` | Back to previous view |

### Input isolation

The search view's text input captures all keystrokes when focused. Global keybindings (number keys, `?`, `q`) are disabled while the search input or tag filter is active. This is implemented via ink's `useInput({ isActive })` option.

## Laws

**T1. DataSource-only access**: the TUI never imports from `src/engine/`, `src/storage/`, or `src/api/` directly. All data flows through [[data-source]]. This ensures mode transparency.

**T2. View isolation**: each view manages its own state (loading, error, selection index, scroll offset). Switching views does not destroy state — returning to a view preserves its previous state unless the tenant changed.

**T3. Presentation purity**: the TUI performs no writes to the knowledge base. `reload` triggers a rebuild but does not modify source files. The TUI is read-only + reload.

**T4. Keyboard-first**: every action is reachable via keyboard. No mouse support. This follows the issue specification and Unix terminal conventions.

**T5. Lazy loading**: ink and React are loaded only when `pramana tui` is invoked. Other commands pay zero cost for the TUI's dependency tree.

**T6. Respect NO_COLOR**: when `NO_COLOR` is set in the environment, the theme should degrade gracefully (ink handles this via its built-in color detection).

## Design rationale

**Why ink (React for CLI)?** The TUI has 6 views with state management, input handling, and async data loading. React's component model makes this manageable. ink provides flexbox layout, built-in `useInput`, and `useStdout` for terminal dimensions. The alternative — raw ANSI escape codes — would require reimplementing layout, input handling, and re-rendering from scratch.

**Why not blessed/neo-blessed?** Node.js specific, large API surface, and the project already has `"jsx": "react-jsx"` in tsconfig. ink is lighter and Bun-native.

**Why 6 views, not a single scrollable document?** The four primitives (get, search, traverse, list) serve different cognitive needs — discovery, focused reading, graph exploration, and overview. Separate views match these mental models. A single view would conflate them.

**Why a debounced search rather than search-on-Enter?** Incremental results provide immediate feedback about query quality. 200ms debounce prevents excessive API calls while feeling responsive.

**Why limit graph depth to 5?** In practice, relationship chains beyond depth 3-4 become noise. Depth 5 is generous while preventing accidental full-graph expansion.

**Why custom TextInput instead of ink-text-input?** One less dependency. The component is 30 lines: track value, handle backspace and character input, render cursor. Not worth a package for this.
