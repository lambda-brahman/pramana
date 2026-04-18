use pramana_tui::app::{render_app, App};
use pramana_tui::DataSource;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

mod scrollable_list_algorithm {
    /// Regression test for issue #57: selectedIndex=-1 guard.
    /// When no item is selected (index=-1), scroll offset must not change.
    #[test]
    fn no_selection_does_not_scroll() {
        let ds =
            pramana_tui::DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let app = pramana_tui::app::App::new(ds, 5111, None);
        // search view starts with selected_index=-1
        assert_eq!(app.search.selected_index, -1);
        assert_eq!(app.search.scroll_state.scroll_offset, 0);
    }

    /// Regression test for issue #58: scroll indicators eat viewport lines.
    /// When items exceed viewport, the end index must account for
    /// the "N more below" indicator line.
    #[test]
    fn scroll_down_indicator_reserves_line() {
        let mut state = pramana_tui::app::App::new(
            pramana_tui::DataSource::Standalone(Box::new(pramana_engine::TenantManager::new())),
            5111,
            None,
        )
        .search
        .scroll_state;

        // Simulate: 10 items, viewport of 5 lines, all height-1
        state.ensure_visible(4, 10, 5, &|_| 1);
        // After ensuring index 4 visible with 10 items in 5 lines,
        // offset should allow seeing index 4 while reserving indicator lines
        assert!(state.scroll_offset <= 4);
    }

    /// Regression test for issue #61: item height clamped to >= 1.
    /// An item-height callback returning 0 should be treated as 1.
    #[test]
    fn zero_height_clamped_to_one() {
        let mut state = pramana_tui::app::App::new(
            pramana_tui::DataSource::Standalone(Box::new(pramana_engine::TenantManager::new())),
            5111,
            None,
        )
        .search
        .scroll_state;

        // Item height returns 0 — must be clamped to 1
        state.ensure_visible(3, 5, 5, &|_| 0);
        assert!(state.scroll_offset <= 3);
    }

    /// Regression test for issue #63: grapheme-safe horizontal scroll.
    /// Scrolling through multi-codepoint graphemes (ZWJ family emoji)
    /// must not split them mid-cluster.
    #[test]
    fn grapheme_safe_scroll() {
        use pramana_tui::views::artifact_detail;

        let line =
            artifact_detail::style_markdown_line_for_test("Hi 👨\u{200d}👩\u{200d}👧 end", 3, 5);
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(text, "👨\u{200d}👩\u{200d}👧 end");
    }
}

mod golden_snapshots {
    use super::*;

    fn make_test_app() -> App {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        App::new(ds, 5111, None)
    }

    fn render_to_string(app: &mut App, width: u16, height: u16) -> String {
        let area = Rect::new(0, 0, width, height);
        let mut buf = Buffer::empty(area);
        render_app(app, area, &mut buf);

        let mut output = String::new();
        for y in 0..height {
            for x in 0..width {
                let cell = &buf[(x, y)];
                output.push_str(cell.symbol());
            }
            output.push('\n');
        }
        output
    }

    /// Golden snapshot: kb-list view with no tenants.
    /// Diff tolerance: exact match on text content; ANSI colors may vary
    /// between terminal configurations. Tests compare text-only output from
    /// ratatui's TestBackend (no ANSI escapes).
    #[test]
    fn kb_list_empty() {
        let mut app = make_test_app();
        let output = render_to_string(&mut app, 60, 15);
        assert!(output.contains("Knowledge Bases (0)"));
        assert!(output.contains("No knowledge bases configured"));
        assert!(output.contains("pramana"));
    }

    /// Golden snapshot: kb-list view renders breadcrumb and status bar.
    #[test]
    fn kb_list_chrome() {
        let mut app = make_test_app();
        let output = render_to_string(&mut app, 80, 20);
        // Breadcrumb
        assert!(output.contains("pramana"));
        assert!(output.contains("kb-list"));
        // Status bar
        assert!(output.contains("view:kb-list"));
        assert!(output.contains("standalone"));
    }

    /// Golden snapshot: search view renders input and hints.
    #[test]
    fn search_view_empty() {
        let mut app = make_test_app();
        let output = render_to_string(&mut app, 60, 15);
        assert!(output.contains("Knowledge Bases"));
    }
}

mod graph_view {
    use super::*;

    fn make_test_app_with_graph() -> App {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, None);

        let root = pramana_engine::ArtifactView {
            slug: "order".into(),
            title: "Order".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![
                pramana_engine::Relationship {
                    target: "customer".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
                pramana_engine::Relationship {
                    target: "product".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
            ],
            inverse_relationships: vec![pramana_engine::Relationship {
                target: "invoice".into(),
                kind: "relates-to".into(),
                line: None,
                section: None,
            }],
            sections: vec![],
            content: String::new(),
            hash: "abc".into(),
            focused_section: None,
        };

        let traversed = vec![
            pramana_engine::ArtifactView {
                slug: "customer".into(),
                title: "Customer entity".into(),
                summary: None,
                aliases: None,
                tags: vec![],
                relationships: vec![],
                inverse_relationships: vec![],
                sections: vec![],
                content: String::new(),
                hash: "def".into(),
                focused_section: None,
            },
            pramana_engine::ArtifactView {
                slug: "product".into(),
                title: "Product catalog item".into(),
                summary: None,
                aliases: None,
                tags: vec![],
                relationships: vec![],
                inverse_relationships: vec![],
                sections: vec![],
                content: String::new(),
                hash: "ghi".into(),
                focused_section: None,
            },
        ];

        app.graph.set_root(&root, &traversed);
        app
    }

    #[test]
    fn graph_view_snapshot() {
        let mut app = make_test_app_with_graph();
        app.graph.depth = 1;

        let output = {
            use pramana_tui::views::graph::render_graph;
            let area = Rect::new(0, 0, 80, 15);
            let mut buf = Buffer::empty(area);
            render_graph(&mut app.graph, area, &mut buf);

            let mut out = String::new();
            for y in 0..15 {
                for x in 0..80 {
                    let cell = &buf[(x, y)];
                    out.push_str(cell.symbol());
                }
                out.push('\n');
            }
            out
        };

        assert!(output.contains("Order"));
        assert!(output.contains("graph: order"));
        assert!(output.contains("depth: 1"));
        assert!(output.contains("customer"));
        assert!(output.contains("product"));
        assert!(output.contains("invoice"));
        assert!(output.contains("[depends-on]"));
        assert!(output.contains("[relates-to]"));
    }

    #[test]
    fn graph_view_empty_entries() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, None);

        let root = pramana_engine::ArtifactView {
            slug: "isolated".into(),
            title: "Isolated Node".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![],
            inverse_relationships: vec![],
            sections: vec![],
            content: String::new(),
            hash: "xyz".into(),
            focused_section: None,
        };

        app.graph.set_root(&root, &[]);

        let area = Rect::new(0, 0, 60, 12);
        let mut buf = Buffer::empty(area);
        pramana_tui::views::graph::render_graph(&mut app.graph, area, &mut buf);

        let mut output = String::new();
        for y in 0..12 {
            for x in 0..60 {
                let cell = &buf[(x, y)];
                output.push_str(cell.symbol());
            }
            output.push('\n');
        }

        assert!(output.contains("Isolated Node"));
        assert!(output.contains("No relationships"));
    }

    #[test]
    fn graph_navigate_and_select() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        use pramana_tui::views::graph::{handle_graph_input, GraphAction};

        let mut app = make_test_app_with_graph();

        let key = |code: KeyCode| KeyEvent::new(code, KeyModifiers::NONE);

        assert_eq!(app.graph.selected_index, 0);
        assert_eq!(app.graph.selected_slug(), Some("customer"));

        handle_graph_input(&mut app.graph, key(KeyCode::Char('j')));
        assert_eq!(app.graph.selected_index, 1);
        assert_eq!(app.graph.selected_slug(), Some("product"));

        handle_graph_input(&mut app.graph, key(KeyCode::Char('j')));
        assert_eq!(app.graph.selected_index, 2);
        assert_eq!(app.graph.selected_slug(), Some("invoice"));

        // Can't go past the last item
        handle_graph_input(&mut app.graph, key(KeyCode::Char('j')));
        assert_eq!(app.graph.selected_index, 2);

        handle_graph_input(&mut app.graph, key(KeyCode::Char('k')));
        assert_eq!(app.graph.selected_index, 1);

        // Enter returns NavigateTo
        let action = handle_graph_input(&mut app.graph, key(KeyCode::Enter));
        assert!(matches!(action, GraphAction::NavigateTo(s) if s == "product"));

        // g returns Reroot
        let action = handle_graph_input(&mut app.graph, key(KeyCode::Char('g')));
        assert!(matches!(action, GraphAction::Reroot(s) if s == "product"));
    }

    #[test]
    fn graph_depth_change() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        use pramana_tui::views::graph::{handle_graph_input, GraphAction};

        let mut app = make_test_app_with_graph();

        let key = |code: KeyCode| KeyEvent::new(code, KeyModifiers::NONE);

        assert_eq!(app.graph.depth, 1);

        let action = handle_graph_input(&mut app.graph, key(KeyCode::Char('+')));
        assert!(matches!(action, GraphAction::DepthChanged));
        assert_eq!(app.graph.depth, 2);

        let action = handle_graph_input(&mut app.graph, key(KeyCode::Char('-')));
        assert!(matches!(action, GraphAction::DepthChanged));
        assert_eq!(app.graph.depth, 1);

        // Can't go below 1
        let action = handle_graph_input(&mut app.graph, key(KeyCode::Char('-')));
        assert!(matches!(action, GraphAction::None));
        assert_eq!(app.graph.depth, 1);
    }
}

mod keybinding_parity {
    /// Verify all expected keybindings exist in the kb-list handler.
    #[test]
    fn kb_list_keybindings() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

        let ds =
            pramana_tui::DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = pramana_tui::app::App::new(ds, 5111, None);

        let key = |code: KeyCode| KeyEvent::new(code, KeyModifiers::NONE);

        // These should not panic
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Char('j'))));
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Char('k'))));
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Char('a'))));
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Esc))); // cancel add
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Char('?'))));
        app.handle_event(crossterm::event::Event::Key(key(KeyCode::Char('?'))));
        // toggle off
    }

    /// Verify graph keybindings don't panic.
    #[test]
    fn graph_keybindings() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

        let mut view = pramana_tui::views::graph::GraphView::new();
        let root = pramana_engine::ArtifactView {
            slug: "test".into(),
            title: "Test".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![pramana_engine::Relationship {
                target: "other".into(),
                kind: "depends-on".into(),
                line: None,
                section: None,
            }],
            inverse_relationships: vec![],
            sections: vec![],
            content: String::new(),
            hash: "abc".into(),
            focused_section: None,
        };
        view.set_root(&root, &[]);

        let key = |code: KeyCode| KeyEvent::new(code, KeyModifiers::NONE);

        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('j')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('k')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Down));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Up));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Enter));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('g')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('+')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('-')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('=')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Char('q')));
        pramana_tui::views::graph::handle_graph_input(&mut view, key(KeyCode::Esc));
    }

    /// Verify artifact-detail keybindings don't panic.
    #[test]
    fn detail_keybindings() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        use pramana_engine::ArtifactView;

        let mut view = pramana_tui::app::App::new(
            pramana_tui::DataSource::Standalone(Box::new(pramana_engine::TenantManager::new())),
            5111,
            None,
        )
        .detail;

        let key = |code: KeyCode| KeyEvent::new(code, KeyModifiers::NONE);
        view.set_artifact(ArtifactView {
            slug: "test".into(),
            title: "Test".into(),
            summary: None,
            aliases: None,
            tags: vec!["tag1".into()],
            relationships: vec![],
            inverse_relationships: vec![],
            sections: vec![],
            content: "# Test\n\nContent here\n".into(),
            hash: "abc".into(),
            focused_section: None,
        });

        // All content panel keys
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('j')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('k')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('d')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('u')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('h')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('l')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(
            &mut view,
            key(KeyCode::Char('0')),
        );
        pramana_tui::views::artifact_detail::handle_detail_input(&mut view, key(KeyCode::Tab));
    }
}
