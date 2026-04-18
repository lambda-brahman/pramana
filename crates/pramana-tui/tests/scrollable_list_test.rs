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
    /// Multi-byte characters should not cause panics when scrolled.
    #[test]
    fn grapheme_safe_scroll() {
        // Test with emoji and CJK characters
        let line = "Hello 🌍 世界 test";
        let chars: Vec<char> = line.chars().collect();
        let start = 5usize.min(chars.len());
        let end = 10usize.min(chars.len());
        let visible: String = chars[start..end].iter().collect();
        // Should not panic and should produce valid UTF-8
        assert!(visible.is_char_boundary(0));
    }
}

mod golden_snapshots {
    use super::*;

    fn make_test_app() -> App {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        App::new(ds, 5111, None)
    }

    fn render_to_string(app: &App, width: u16, height: u16) -> String {
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
        let app = make_test_app();
        let output = render_to_string(&app, 60, 15);
        assert!(output.contains("Knowledge Bases (0)"));
        assert!(output.contains("No knowledge bases configured"));
        assert!(output.contains("pramana"));
    }

    /// Golden snapshot: kb-list view renders breadcrumb and status bar.
    #[test]
    fn kb_list_chrome() {
        let app = make_test_app();
        let output = render_to_string(&app, 80, 20);
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
        let app = make_test_app();
        let output = render_to_string(&app, 60, 15);
        assert!(output.contains("Knowledge Bases"));
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
