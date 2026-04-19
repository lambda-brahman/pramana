use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn make_tenant(name: &str) -> pramana_engine::TenantInfo {
    pramana_engine::TenantInfo {
        name: name.into(),
        source_dir: "/tmp".into(),
        artifact_count: 3,
    }
}

fn make_artifact(slug: &str) -> pramana_engine::ArtifactView {
    pramana_engine::ArtifactView {
        slug: slug.into(),
        title: "Test Article".into(),
        summary: None,
        aliases: None,
        tags: vec![],
        relationships: vec![],
        inverse_relationships: vec![],
        sections: vec![],
        content: "line one\nline two\nline three\n".into(),
        hash: "abc".into(),
        focused_section: None,
    }
}

fn make_search_result(slug: &str) -> pramana_engine::SearchResult {
    pramana_engine::SearchResult {
        slug: slug.into(),
        title: "Result".into(),
        summary: None,
        snippet: String::new(),
        rank: 1.0,
    }
}

// ────────────────────────────────────────────────────────────────────────────
// KbList
// ────────────────────────────────────────────────────────────────────────────

mod kb_list {
    use super::*;
    use pramana_tui::views::kb_list::{handle_kb_list_input, KbListAction, KbListMode, KbListView};

    fn view_with_tenants(names: &[&str]) -> KbListView {
        let mut v = KbListView::new();
        v.tenants = names.iter().map(|n| make_tenant(n)).collect();
        v
    }

    // ── normal mode navigation ───────────────────────────────────────────────

    #[test]
    fn j_moves_selection_down() {
        let mut v = view_with_tenants(&["alpha", "beta", "gamma"]);
        assert_eq!(v.selected_index, 0);
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn down_arrow_moves_selection_down() {
        let mut v = view_with_tenants(&["alpha", "beta"]);
        let action = handle_kb_list_input(&mut v, key(KeyCode::Down));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn k_moves_selection_up() {
        let mut v = view_with_tenants(&["alpha", "beta", "gamma"]);
        v.selected_index = 2;
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn up_arrow_moves_selection_up() {
        let mut v = view_with_tenants(&["alpha", "beta"]);
        v.selected_index = 1;
        let action = handle_kb_list_input(&mut v, key(KeyCode::Up));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 0);
    }

    #[test]
    fn j_at_last_item_stays() {
        let mut v = view_with_tenants(&["alpha", "beta"]);
        v.selected_index = 1;
        handle_kb_list_input(&mut v, key(KeyCode::Char('j')));
        assert_eq!(v.selected_index, 1, "should not go past last item");
    }

    #[test]
    fn k_at_first_item_stays() {
        let mut v = view_with_tenants(&["alpha", "beta"]);
        v.selected_index = 0;
        handle_kb_list_input(&mut v, key(KeyCode::Char('k')));
        assert_eq!(v.selected_index, 0, "should not go below 0");
    }

    #[test]
    fn j_on_empty_list_returns_none_without_panic() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 0);
    }

    #[test]
    fn k_on_empty_list_returns_none_without_panic() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, KbListAction::None));
        assert_eq!(v.selected_index, 0);
    }

    // ── normal mode actions ──────────────────────────────────────────────────

    #[test]
    fn enter_with_tenant_returns_select_kb() {
        let mut v = view_with_tenants(&["alpha", "beta"]);
        v.selected_index = 0;
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::SelectKb(n) if n == "alpha"));
    }

    #[test]
    fn enter_with_no_tenants_returns_none() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::None));
    }

    #[test]
    fn r_with_tenant_returns_reload() {
        let mut v = view_with_tenants(&["alpha"]);
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('r')));
        assert!(matches!(action, KbListAction::Reload(n) if n == "alpha"));
    }

    #[test]
    fn r_with_no_tenants_returns_none() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('r')));
        assert!(matches!(action, KbListAction::None));
    }

    #[test]
    fn o_with_tenant_returns_open_dir() {
        let mut v = view_with_tenants(&["alpha"]);
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('o')));
        assert!(matches!(action, KbListAction::OpenDir(d) if d == "/tmp"));
    }

    #[test]
    fn o_with_no_tenants_returns_none() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('o')));
        assert!(matches!(action, KbListAction::None));
    }

    #[test]
    fn d_with_tenant_enters_confirming_delete_mode() {
        let mut v = view_with_tenants(&["alpha"]);
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('d')));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::ConfirmingDelete { ref name } if name == "alpha"));
    }

    #[test]
    fn d_with_no_tenants_stays_normal() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('d')));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn a_enters_adding_name_mode() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('a')));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::AddingName));
    }

    #[test]
    fn capital_s_returns_toggle_daemon() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('S')));
        assert!(matches!(action, KbListAction::ToggleDaemon));
    }

    #[test]
    fn i_returns_show_dashboard() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('i')));
        assert!(matches!(action, KbListAction::ShowDashboard));
    }

    #[test]
    fn q_returns_quit() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('q')));
        assert!(matches!(action, KbListAction::Quit));
    }

    #[test]
    fn esc_returns_quit() {
        let mut v = KbListView::new();
        let action = handle_kb_list_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, KbListAction::Quit));
    }

    // ── adding-name mode ─────────────────────────────────────────────────────

    #[test]
    fn adding_name_esc_cancels_to_normal() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingName;
        let action = handle_kb_list_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn adding_name_char_inserts_into_input() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingName;
        handle_kb_list_input(&mut v, key(KeyCode::Char('m')));
        handle_kb_list_input(&mut v, key(KeyCode::Char('y')));
        assert_eq!(v.name_input.value, "my");
    }

    #[test]
    fn adding_name_backspace_removes_char() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingName;
        v.name_input.insert('a');
        v.name_input.insert('b');
        handle_kb_list_input(&mut v, key(KeyCode::Backspace));
        assert_eq!(v.name_input.value, "a");
    }

    #[test]
    fn adding_name_enter_empty_sets_error() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingName;
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::None));
        assert!(v.error_message.is_some());
        assert!(matches!(v.mode, KbListMode::AddingName));
    }

    #[test]
    fn adding_name_enter_valid_name_advances_to_adding_dir() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingName;
        for c in "myname".chars() {
            v.name_input.insert(c);
        }
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::AddingDir { ref name } if name == "myname"));
    }

    #[test]
    fn adding_name_enter_duplicate_name_sets_error() {
        let mut v = view_with_tenants(&["existing"]);
        v.mode = KbListMode::AddingName;
        for c in "existing".chars() {
            v.name_input.insert(c);
        }
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::None));
        assert!(v.error_message.is_some());
    }

    // ── adding-dir mode ──────────────────────────────────────────────────────

    #[test]
    fn adding_dir_esc_cancels_to_normal() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingDir {
            name: "myname".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn adding_dir_enter_empty_sets_error() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingDir {
            name: "myname".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, KbListAction::None));
        assert!(v.error_message.is_some());
    }

    #[test]
    fn adding_dir_enter_valid_dir_returns_add_kb() {
        let mut v = KbListView::new();
        v.mode = KbListMode::AddingDir {
            name: "myname".into(),
        };
        // /tmp always exists on macOS/Linux
        for c in "/tmp".chars() {
            v.dir_input.insert(c);
        }
        let action = handle_kb_list_input(&mut v, key(KeyCode::Enter));
        assert!(
            matches!(action, KbListAction::AddKb { ref name, ref source_dir } if name == "myname" && source_dir == "/tmp")
        );
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    // ── confirming-delete mode ───────────────────────────────────────────────

    #[test]
    fn confirming_delete_y_returns_remove_kb_and_resets_mode() {
        let mut v = KbListView::new();
        v.mode = KbListMode::ConfirmingDelete {
            name: "alpha".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('y')));
        assert!(matches!(action, KbListAction::RemoveKb(n) if n == "alpha"));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn confirming_delete_capital_y_returns_remove_kb() {
        let mut v = KbListView::new();
        v.mode = KbListMode::ConfirmingDelete {
            name: "alpha".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('Y')));
        assert!(matches!(action, KbListAction::RemoveKb(n) if n == "alpha"));
    }

    #[test]
    fn confirming_delete_n_cancels_to_normal() {
        let mut v = KbListView::new();
        v.mode = KbListMode::ConfirmingDelete {
            name: "alpha".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('n')));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn confirming_delete_capital_n_cancels_to_normal() {
        let mut v = KbListView::new();
        v.mode = KbListMode::ConfirmingDelete {
            name: "alpha".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Char('N')));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }

    #[test]
    fn confirming_delete_esc_cancels_to_normal() {
        let mut v = KbListView::new();
        v.mode = KbListMode::ConfirmingDelete {
            name: "alpha".into(),
        };
        let action = handle_kb_list_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, KbListAction::None));
        assert!(matches!(v.mode, KbListMode::Normal));
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────────────────────

mod search {
    use super::*;
    use pramana_tui::views::search::{handle_search_input, SearchAction, SearchView};

    fn view_with_results(slugs: &[&str]) -> SearchView {
        let mut v = SearchView::new();
        v.set_results(slugs.iter().map(|s| make_search_result(s)).collect());
        v
    }

    // ── input-focused mode ───────────────────────────────────────────────────

    #[test]
    fn esc_with_empty_input_returns_back() {
        let mut v = SearchView::new();
        assert!(v.input.value.is_empty());
        let action = handle_search_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, SearchAction::Back));
    }

    #[test]
    fn esc_with_non_empty_input_clears_and_returns_none() {
        let mut v = SearchView::new();
        v.input.insert('a');
        v.input.insert('b');
        let action = handle_search_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, SearchAction::None));
        assert!(v.input.value.is_empty());
        assert!(v.results.is_empty());
    }

    #[test]
    fn char_inserts_into_input() {
        let mut v = SearchView::new();
        handle_search_input(&mut v, key(KeyCode::Char('h')));
        handle_search_input(&mut v, key(KeyCode::Char('i')));
        assert_eq!(v.input.value, "hi");
    }

    #[test]
    fn backspace_removes_char_from_input() {
        let mut v = SearchView::new();
        v.input.insert('a');
        v.input.insert('b');
        handle_search_input(&mut v, key(KeyCode::Backspace));
        assert_eq!(v.input.value, "a");
    }

    #[test]
    fn down_with_empty_results_stays_focused() {
        let mut v = SearchView::new();
        let action = handle_search_input(&mut v, key(KeyCode::Down));
        assert!(matches!(action, SearchAction::None));
        assert!(v.input_focused);
    }

    #[test]
    fn down_with_results_unfocuses_input() {
        let mut v = view_with_results(&["a", "b"]);
        let action = handle_search_input(&mut v, key(KeyCode::Down));
        assert!(matches!(action, SearchAction::None));
        assert!(!v.input_focused);
        assert_eq!(v.selected_index, 0);
    }

    #[test]
    fn enter_with_results_unfocuses_input() {
        let mut v = view_with_results(&["a", "b"]);
        let action = handle_search_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, SearchAction::None));
        assert!(!v.input_focused);
    }

    // ── results mode ─────────────────────────────────────────────────────────

    #[test]
    fn esc_in_results_mode_refocuses_input() {
        let mut v = view_with_results(&["a", "b"]);
        v.input_focused = false;
        v.selected_index = 1;
        let action = handle_search_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, SearchAction::None));
        assert!(v.input_focused);
        assert_eq!(v.selected_index, -1);
    }

    #[test]
    fn j_in_results_mode_moves_down() {
        let mut v = view_with_results(&["a", "b", "c"]);
        v.input_focused = false;
        v.selected_index = 0;
        let action = handle_search_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, SearchAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn j_at_last_result_stays() {
        let mut v = view_with_results(&["a", "b"]);
        v.input_focused = false;
        v.selected_index = 1;
        handle_search_input(&mut v, key(KeyCode::Char('j')));
        assert_eq!(v.selected_index, 1, "should not go past last result");
    }

    #[test]
    fn k_in_results_mode_moves_up() {
        let mut v = view_with_results(&["a", "b", "c"]);
        v.input_focused = false;
        v.selected_index = 2;
        let action = handle_search_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, SearchAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn k_at_first_result_refocuses_input() {
        let mut v = view_with_results(&["a", "b"]);
        v.input_focused = false;
        v.selected_index = 0;
        let action = handle_search_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, SearchAction::None));
        assert!(v.input_focused);
        assert_eq!(v.selected_index, -1);
    }

    #[test]
    fn l_pans_right() {
        let mut v = view_with_results(&["a"]);
        v.input_focused = false;
        v.selected_index = 0;
        let before = v.scroll_x;
        handle_search_input(&mut v, key(KeyCode::Char('l')));
        assert!(v.scroll_x > before);
    }

    #[test]
    fn h_pans_left_after_panning_right() {
        let mut v = view_with_results(&["a"]);
        v.input_focused = false;
        v.selected_index = 0;
        v.scroll_x = 10;
        handle_search_input(&mut v, key(KeyCode::Char('h')));
        assert!(v.scroll_x < 10);
    }

    #[test]
    fn enter_in_results_mode_returns_view_artifact() {
        let mut v = view_with_results(&["article-one", "article-two"]);
        v.input_focused = false;
        v.selected_index = 1;
        let action = handle_search_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, SearchAction::ViewArtifact(s) if s == "article-two"));
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ArtifactDetail
// ────────────────────────────────────────────────────────────────────────────

mod artifact_detail {
    use super::*;
    use pramana_engine::Relationship;
    use pramana_tui::views::artifact_detail::{
        handle_detail_input, ArtifactDetailView, DetailAction, Panel,
    };

    fn view_with_content() -> ArtifactDetailView {
        let mut v = ArtifactDetailView::new();
        v.set_artifact(make_artifact("test-slug"));
        v
    }

    fn view_with_relationships() -> ArtifactDetailView {
        let mut v = ArtifactDetailView::new();
        v.set_artifact(pramana_engine::ArtifactView {
            slug: "test".into(),
            title: "Test".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![
                Relationship {
                    target: "dep-a".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
                Relationship {
                    target: "dep-b".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
            ],
            inverse_relationships: vec![],
            sections: vec![],
            content: String::new(),
            hash: "abc".into(),
            focused_section: None,
        });
        v.panel = Panel::Relationships;
        v
    }

    fn view_with_sections() -> ArtifactDetailView {
        let mut v = ArtifactDetailView::new();
        v.set_artifact(pramana_engine::ArtifactView {
            slug: "test".into(),
            title: "Test".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![],
            inverse_relationships: vec![],
            sections: vec![
                pramana_storage::Section {
                    id: "s1".into(),
                    heading: "First".into(),
                    level: 1,
                    line: 5,
                },
                pramana_storage::Section {
                    id: "s2".into(),
                    heading: "Second".into(),
                    level: 1,
                    line: 20,
                },
            ],
            content: (0..30).map(|i| format!("line {i}\n")).collect(),
            hash: "abc".into(),
            focused_section: None,
        });
        v.panel = Panel::Sections;
        v
    }

    // ── global keys ──────────────────────────────────────────────────────────

    #[test]
    fn esc_returns_back() {
        let mut v = view_with_content();
        let action = handle_detail_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, DetailAction::Back));
    }

    #[test]
    fn g_returns_open_graph() {
        let mut v = view_with_content();
        let action = handle_detail_input(&mut v, key(KeyCode::Char('g')));
        assert!(matches!(action, DetailAction::OpenGraph));
    }

    #[test]
    fn tab_cycles_panel() {
        let mut v = view_with_content();
        assert!(matches!(v.panel, Panel::Content));
        let action = handle_detail_input(&mut v, key(KeyCode::Tab));
        assert!(matches!(action, DetailAction::None));
        assert!(matches!(v.panel, Panel::Relationships));
        handle_detail_input(&mut v, key(KeyCode::Tab));
        assert!(matches!(v.panel, Panel::Sections));
        handle_detail_input(&mut v, key(KeyCode::Tab));
        assert!(matches!(v.panel, Panel::Content));
    }

    // ── content panel ────────────────────────────────────────────────────────

    #[test]
    fn j_scrolls_content_down() {
        let mut v = view_with_content();
        let before = v.scroll_offset;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, DetailAction::None));
        assert!(v.scroll_offset > before);
    }

    #[test]
    fn k_scrolls_content_up_after_scrolling_down() {
        let mut v = view_with_content();
        v.scroll_offset = 2;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.scroll_offset, 1);
    }

    #[test]
    fn k_at_top_stays_at_zero() {
        let mut v = view_with_content();
        assert_eq!(v.scroll_offset, 0);
        handle_detail_input(&mut v, key(KeyCode::Char('k')));
        assert_eq!(v.scroll_offset, 0, "should not go below 0");
    }

    #[test]
    fn d_pages_down_by_ten() {
        let mut v = ArtifactDetailView::new();
        let long_content: String = (0..50).map(|i| format!("line {i}\n")).collect();
        v.set_artifact(pramana_engine::ArtifactView {
            slug: "long".into(),
            title: "Long".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![],
            inverse_relationships: vec![],
            sections: vec![],
            content: long_content,
            hash: "x".into(),
            focused_section: None,
        });
        let action = handle_detail_input(&mut v, key(KeyCode::Char('d')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.scroll_offset, 10);
    }

    #[test]
    fn u_pages_up_by_ten() {
        let mut v = view_with_content();
        v.scroll_offset = 10;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('u')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.scroll_offset, 0);
    }

    #[test]
    fn l_pans_right() {
        let mut v = view_with_content();
        let before = v.scroll_x;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('l')));
        assert!(matches!(action, DetailAction::None));
        assert!(v.scroll_x > before);
    }

    #[test]
    fn h_pans_left_after_panning_right() {
        let mut v = view_with_content();
        v.scroll_x = 10;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('h')));
        assert!(matches!(action, DetailAction::None));
        assert!(v.scroll_x < 10);
    }

    #[test]
    fn zero_resets_pan() {
        let mut v = view_with_content();
        v.scroll_x = 15;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('0')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.scroll_x, 0);
    }

    // ── relationships panel ──────────────────────────────────────────────────

    #[test]
    fn j_in_relationships_moves_down() {
        let mut v = view_with_relationships();
        assert_eq!(v.rel_index, 0);
        let action = handle_detail_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.rel_index, 1);
    }

    #[test]
    fn j_in_relationships_at_last_stays() {
        let mut v = view_with_relationships();
        v.rel_index = 1;
        handle_detail_input(&mut v, key(KeyCode::Char('j')));
        assert_eq!(v.rel_index, 1, "should not go past last relationship");
    }

    #[test]
    fn k_in_relationships_moves_up() {
        let mut v = view_with_relationships();
        v.rel_index = 1;
        let action = handle_detail_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.rel_index, 0);
    }

    #[test]
    fn enter_in_relationships_returns_navigate_to() {
        let mut v = view_with_relationships();
        v.rel_index = 0;
        let action = handle_detail_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, DetailAction::NavigateTo(s) if s == "dep-a"));
    }

    #[test]
    fn enter_in_relationships_strips_section_anchor() {
        let mut v = ArtifactDetailView::new();
        v.set_artifact(pramana_engine::ArtifactView {
            slug: "test".into(),
            title: "Test".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![Relationship {
                target: "dep-a#intro".into(),
                kind: "depends-on".into(),
                line: None,
                section: None,
            }],
            inverse_relationships: vec![],
            sections: vec![],
            content: String::new(),
            hash: "abc".into(),
            focused_section: None,
        });
        v.panel = Panel::Relationships;
        let action = handle_detail_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, DetailAction::NavigateTo(s) if s == "dep-a"));
    }

    // ── sections panel ───────────────────────────────────────────────────────

    #[test]
    fn j_in_sections_moves_down() {
        let mut v = view_with_sections();
        assert_eq!(v.rel_index, 0);
        let action = handle_detail_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, DetailAction::None));
        assert_eq!(v.rel_index, 1);
    }

    #[test]
    fn enter_in_sections_jumps_to_content_line() {
        let mut v = view_with_sections();
        v.rel_index = 1;
        let action = handle_detail_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, DetailAction::None));
        assert!(matches!(v.panel, Panel::Content));
        assert_eq!(v.scroll_offset, 19, "line 20 → offset 19 (0-indexed)");
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Graph
// ────────────────────────────────────────────────────────────────────────────

mod graph {
    use super::*;
    use pramana_engine::Relationship;
    use pramana_tui::views::graph::{handle_graph_input, GraphAction, GraphView};

    fn view_with_entries() -> GraphView {
        let mut v = GraphView::new();
        let root = pramana_engine::ArtifactView {
            slug: "root".into(),
            title: "Root".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![
                Relationship {
                    target: "child-a".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
                Relationship {
                    target: "child-b".into(),
                    kind: "depends-on".into(),
                    line: None,
                    section: None,
                },
            ],
            inverse_relationships: vec![],
            sections: vec![],
            content: String::new(),
            hash: "abc".into(),
            focused_section: None,
        };
        v.set_root(&root, &[]);
        v
    }

    #[test]
    fn esc_returns_back() {
        let mut v = view_with_entries();
        let action = handle_graph_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, GraphAction::Back));
    }

    #[test]
    fn q_returns_back() {
        let mut v = view_with_entries();
        let action = handle_graph_input(&mut v, key(KeyCode::Char('q')));
        assert!(matches!(action, GraphAction::Back));
    }

    #[test]
    fn esc_on_empty_graph_returns_back() {
        let mut v = GraphView::new();
        let action = handle_graph_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, GraphAction::Back));
    }

    #[test]
    fn unrecognized_key_on_empty_graph_returns_none() {
        let mut v = GraphView::new();
        let action = handle_graph_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, GraphAction::None));
    }

    #[test]
    fn j_moves_selection_down() {
        let mut v = view_with_entries();
        assert_eq!(v.selected_index, 0);
        let action = handle_graph_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, GraphAction::None));
        assert_eq!(v.selected_index, 1);
    }

    #[test]
    fn j_at_last_entry_stays() {
        let mut v = view_with_entries();
        v.selected_index = 1;
        handle_graph_input(&mut v, key(KeyCode::Char('j')));
        assert_eq!(v.selected_index, 1, "should not go past last entry");
    }

    #[test]
    fn k_moves_selection_up() {
        let mut v = view_with_entries();
        v.selected_index = 1;
        let action = handle_graph_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, GraphAction::None));
        assert_eq!(v.selected_index, 0);
    }

    #[test]
    fn k_at_first_entry_stays() {
        let mut v = view_with_entries();
        v.selected_index = 0;
        handle_graph_input(&mut v, key(KeyCode::Char('k')));
        assert_eq!(v.selected_index, 0, "should not go below 0");
    }

    #[test]
    fn enter_returns_navigate_to_selected() {
        let mut v = view_with_entries();
        v.selected_index = 0;
        let action = handle_graph_input(&mut v, key(KeyCode::Enter));
        assert!(matches!(action, GraphAction::NavigateTo(s) if s == "child-a"));
    }

    #[test]
    fn g_returns_reroot_at_selected() {
        let mut v = view_with_entries();
        v.selected_index = 1;
        let action = handle_graph_input(&mut v, key(KeyCode::Char('g')));
        assert!(matches!(action, GraphAction::Reroot(s) if s == "child-b"));
    }

    #[test]
    fn plus_increases_depth() {
        let mut v = view_with_entries();
        assert_eq!(v.depth, 1);
        let action = handle_graph_input(&mut v, key(KeyCode::Char('+')));
        assert!(matches!(action, GraphAction::DepthChanged));
        assert_eq!(v.depth, 2);
    }

    #[test]
    fn equals_also_increases_depth() {
        let mut v = view_with_entries();
        let action = handle_graph_input(&mut v, key(KeyCode::Char('=')));
        assert!(matches!(action, GraphAction::DepthChanged));
        assert_eq!(v.depth, 2);
    }

    #[test]
    fn minus_decreases_depth() {
        let mut v = view_with_entries();
        v.depth = 3;
        let action = handle_graph_input(&mut v, key(KeyCode::Char('-')));
        assert!(matches!(action, GraphAction::DepthChanged));
        assert_eq!(v.depth, 2);
    }

    #[test]
    fn depth_cannot_exceed_five() {
        let mut v = view_with_entries();
        v.depth = 5;
        let action = handle_graph_input(&mut v, key(KeyCode::Char('+')));
        assert!(matches!(action, GraphAction::None));
        assert_eq!(v.depth, 5);
    }

    #[test]
    fn depth_cannot_go_below_one() {
        let mut v = view_with_entries();
        v.depth = 1;
        let action = handle_graph_input(&mut v, key(KeyCode::Char('-')));
        assert!(matches!(action, GraphAction::None));
        assert_eq!(v.depth, 1);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────────────────────

mod dashboard {
    use super::*;
    use pramana_tui::views::dashboard::{handle_dashboard_input, DashboardAction, DashboardView};

    fn populated_view() -> DashboardView {
        let mut v = DashboardView::new();
        v.populate(
            "standalone",
            5111,
            "running".into(),
            vec![
                make_tenant("alpha"),
                make_tenant("beta"),
                make_tenant("gamma"),
            ],
        );
        // Set a small content height so scrolling is possible.
        // line_count() = 7 + max(1, 3) = 10; with height 3 max_scroll = 7.
        v
    }

    #[test]
    fn esc_returns_back() {
        let mut v = DashboardView::new();
        let action = handle_dashboard_input(&mut v, key(KeyCode::Esc));
        assert!(matches!(action, DashboardAction::Back));
    }

    #[test]
    fn q_returns_back() {
        let mut v = DashboardView::new();
        let action = handle_dashboard_input(&mut v, key(KeyCode::Char('q')));
        assert!(matches!(action, DashboardAction::Back));
    }

    #[test]
    fn j_returns_none() {
        let mut v = DashboardView::new();
        let action = handle_dashboard_input(&mut v, key(KeyCode::Char('j')));
        assert!(matches!(action, DashboardAction::None));
    }

    #[test]
    fn k_returns_none() {
        let mut v = DashboardView::new();
        let action = handle_dashboard_input(&mut v, key(KeyCode::Char('k')));
        assert!(matches!(action, DashboardAction::None));
    }

    #[test]
    fn j_advances_scroll_offset() {
        let mut v = populated_view();
        // Force content_height small so scroll is possible
        // We read scroll_offset via the pub field added for testability
        assert_eq!(v.scroll_offset, 0);
        // Drive via handle_dashboard_input; max_scroll uses content_height=20 by default.
        // With line_count=10 and content_height=20 max_scroll=0, so j won't scroll.
        // Set the scenario properly by temporarily rendering — instead, use a
        // view that has more lines than the default content_height forces.
        // Add many tenants so line_count >> 20.
        v.populate(
            "standalone",
            5111,
            "running".into(),
            (0..30).map(|i| make_tenant(&format!("kb{i:02}"))).collect(),
        );
        // line_count = 7 + 30 = 37; content_height = 20; max_scroll = 17
        handle_dashboard_input(&mut v, key(KeyCode::Char('j')));
        assert_eq!(v.scroll_offset, 1, "j should advance scroll_offset by 1");
    }

    #[test]
    fn k_decreases_scroll_offset() {
        let mut v = populated_view();
        v.populate(
            "standalone",
            5111,
            "running".into(),
            (0..30).map(|i| make_tenant(&format!("kb{i:02}"))).collect(),
        );
        v.scroll_offset = 5;
        handle_dashboard_input(&mut v, key(KeyCode::Char('k')));
        assert_eq!(v.scroll_offset, 4, "k should decrease scroll_offset by 1");
    }

    #[test]
    fn k_at_top_does_not_underflow() {
        let mut v = DashboardView::new();
        v.scroll_offset = 0;
        handle_dashboard_input(&mut v, key(KeyCode::Char('k')));
        assert_eq!(v.scroll_offset, 0, "scroll_offset should not go below 0");
    }

    #[test]
    fn down_arrow_behaves_like_j() {
        let mut v = DashboardView::new();
        v.populate(
            "standalone",
            5111,
            "running".into(),
            (0..30).map(|i| make_tenant(&format!("kb{i:02}"))).collect(),
        );
        handle_dashboard_input(&mut v, key(KeyCode::Down));
        assert_eq!(v.scroll_offset, 1);
    }
}
