use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use pramana_tui::app::App;
use pramana_tui::DataSource;
use std::time::{Duration, Instant};

fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

mod nonblocking {
    use super::*;

    #[test]
    fn tick_returns_immediately_in_daemon_mode() {
        let ds = DataSource::Daemon { port: 1 };
        let mut app = App::new(ds, 1, None);

        let start = Instant::now();
        app.tick();
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_millis(100),
            "tick() took {elapsed:?}, expected < 100ms (health check would take 1s if blocking)"
        );
    }

    #[test]
    fn search_dispatched_without_blocking() {
        let ds = DataSource::Daemon { port: 1 };
        let mut app = App::new(ds, 1, Some("test".into()));

        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "test".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.handle_event(key(KeyCode::Enter));

        app.search.input.insert('a');
        app.search.pending_query = Some("a".into());
        app.search.last_input_time = Some(Instant::now() - Duration::from_millis(300));

        let start = Instant::now();
        app.tick();
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_millis(100),
            "tick() with pending search took {elapsed:?}, expected < 100ms"
        );
        assert!(app.search.loading, "search should be marked as loading");
    }

    #[test]
    fn navigate_to_artifact_does_not_block() {
        let ds = DataSource::Daemon { port: 1 };
        let mut app = App::new(ds, 1, Some("test".into()));

        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "test".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.handle_event(key(KeyCode::Enter));

        let start = Instant::now();
        app.search.loading = false;
        app.handle_event(key(KeyCode::Char('t')));

        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(100),
            "handle_event took {elapsed:?}, expected < 100ms"
        );
    }
}

mod quit_during_io {
    use super::*;

    #[test]
    fn quit_from_kb_list_while_health_check_in_flight() {
        let ds = DataSource::Daemon { port: 1 };
        let mut app = App::new(ds, 1, None);

        app.tick();

        app.handle_event(key(KeyCode::Char('q')));
        assert!(
            app.should_quit,
            "should quit even with health check in flight"
        );
    }

    #[test]
    fn back_from_search_while_search_in_flight() {
        let ds = DataSource::Daemon { port: 1 };
        let mut app = App::new(ds, 1, Some("test".into()));

        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "test".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.handle_event(key(KeyCode::Enter));

        app.search.loading = true;
        app.search.input.insert('a');

        app.handle_event(key(KeyCode::Esc));
        app.handle_event(key(KeyCode::Esc));

        assert!(
            matches!(app.current_view(), pramana_tui::app::View::KbList),
            "should navigate back to KbList even with search in flight"
        );
    }
}

mod standalone_responses {
    use super::*;

    #[test]
    fn standalone_tenants_arrive_after_tick() {
        let mut tm = pramana_engine::TenantManager::new();
        let cfg = pramana_engine::TenantConfig {
            name: "demo".into(),
            source_dir: "/tmp".into(),
        };
        let _ = tm.mount(cfg);

        let ds = DataSource::Standalone(Box::new(tm));
        let mut app = App::new(ds, 5111, None);

        for _ in 0..20 {
            app.tick();
            if !app.kb_list.tenants.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(
            !app.kb_list.tenants.is_empty(),
            "tenants should be populated after tick"
        );
        assert_eq!(app.active_tenant, "demo");
    }
}

mod remove_kb {
    use super::*;
    use pramana_tui::io_worker::IoResponse;

    #[test]
    fn active_tenant_cleared_on_remove_before_refresh() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, Some("alpha".into()));

        app.kb_list.tenants = vec![
            pramana_engine::TenantInfo {
                name: "alpha".into(),
                source_dir: "/tmp".into(),
                artifact_count: 0,
            },
            pramana_engine::TenantInfo {
                name: "beta".into(),
                source_dir: "/tmp".into(),
                artifact_count: 0,
            },
        ];
        app.active_tenant = "alpha".into();

        // Inject RemoveKb success — kb_list.tenants is still the stale list.
        app.inject_response(IoResponse::RemoveKb {
            name: "alpha".into(),
            result: Ok(()),
        });
        app.tick();

        // active_tenant must not reference the deleted KB.
        assert!(
            app.active_tenant.is_empty(),
            "active_tenant should be empty after removing the active KB, got '{}'",
            app.active_tenant
        );
    }

    #[test]
    fn active_tenant_repopulated_by_tenants_response() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, Some("alpha".into()));

        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "alpha".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.active_tenant = "alpha".into();

        // Remove clears active_tenant.
        app.inject_response(IoResponse::RemoveKb {
            name: "alpha".into(),
            result: Ok(()),
        });
        app.tick();
        assert!(app.active_tenant.is_empty());

        // Refreshed tenant list arrives (only beta remains).
        app.inject_response(IoResponse::Tenants(Ok(vec![pramana_engine::TenantInfo {
            name: "beta".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }])));
        app.tick();

        assert_eq!(
            app.active_tenant, "beta",
            "active_tenant should be set to the first tenant in the refreshed list"
        );
    }

    #[test]
    fn non_active_tenant_remove_does_not_change_active_tenant() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, Some("alpha".into()));

        app.kb_list.tenants = vec![
            pramana_engine::TenantInfo {
                name: "alpha".into(),
                source_dir: "/tmp".into(),
                artifact_count: 0,
            },
            pramana_engine::TenantInfo {
                name: "beta".into(),
                source_dir: "/tmp".into(),
                artifact_count: 0,
            },
        ];
        app.active_tenant = "alpha".into();

        app.inject_response(IoResponse::RemoveKb {
            name: "beta".into(),
            result: Ok(()),
        });
        app.tick();

        assert_eq!(
            app.active_tenant, "alpha",
            "active_tenant should be unchanged when a non-active KB is removed"
        );
    }
}

mod generation_counters {
    use super::*;
    use pramana_tui::io_worker::IoResponse;

    #[test]
    fn stale_search_response_is_discarded() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, None);

        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "test".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.handle_event(key(KeyCode::Enter));

        app.search.input.insert('a');
        app.search.pending_query = Some("a".into());
        app.search.last_input_time = Some(Instant::now() - Duration::from_millis(300));
        app.tick();

        app.search.input.insert('b');
        app.search.pending_query = Some("ab".into());
        app.search.last_input_time = Some(Instant::now() - Duration::from_millis(300));
        app.tick();

        let stale = IoResponse::Search {
            generation: 1,
            result: Ok(vec![pramana_engine::SearchResult {
                slug: "stale".into(),
                title: "Stale".into(),
                summary: None,
                snippet: String::new(),
                rank: 1.0,
            }]),
        };
        let current = IoResponse::Search {
            generation: 2,
            result: Ok(vec![pramana_engine::SearchResult {
                slug: "current".into(),
                title: "Current".into(),
                summary: None,
                snippet: String::new(),
                rank: 1.0,
            }]),
        };

        app.inject_response(stale);
        app.inject_response(current);
        app.tick();

        assert_eq!(app.search.results.len(), 1);
        assert_eq!(app.search.results[0].slug, "current");
    }

    #[test]
    fn stale_get_response_does_not_push_view() {
        let ds = DataSource::Standalone(Box::new(pramana_engine::TenantManager::new()));
        let mut app = App::new(ds, 5111, Some("test".into()));

        // Navigate to Search view.
        app.kb_list.tenants = vec![pramana_engine::TenantInfo {
            name: "test".into(),
            source_dir: "/tmp".into(),
            artifact_count: 0,
        }];
        app.handle_event(key(KeyCode::Enter));

        // Trigger navigate_to_artifact via UI: populate results, select
        // the first, then press Enter. This bumps get_generation to 1.
        app.search.set_results(vec![pramana_engine::SearchResult {
            slug: "artifact-a".into(),
            title: "Artifact A".into(),
            summary: None,
            snippet: String::new(),
            rank: 1.0,
        }]);
        app.search.input_focused = false;
        app.search.selected_index = 0;
        app.handle_event(key(KeyCode::Enter));
        // get_generation is now 1. A real Get(gen=1) is in flight
        // (will fail for this empty TenantManager, but that's fine).

        // Navigate again: pressing Enter on the same result bumps
        // get_generation to 2.
        app.handle_event(key(KeyCode::Enter));
        // get_generation is now 2.

        // Inject a stale Get response for artifact A with generation 1.
        let stale_artifact = pramana_engine::ArtifactView {
            slug: "artifact-a".into(),
            title: "Artifact A".into(),
            summary: None,
            aliases: None,
            tags: vec![],
            relationships: vec![],
            inverse_relationships: vec![],
            sections: vec![],
            content: "stale content".into(),
            hash: "abc".into(),
            focused_section: None,
        };
        app.inject_response(IoResponse::Get {
            generation: 1,
            slug: "artifact-a".into(),
            result: Box::new(Ok(Some(stale_artifact))),
        });
        app.tick();

        // The stale Get(gen=1) should be discarded — no ArtifactDetail pushed.
        assert!(
            matches!(app.current_view(), pramana_tui::app::View::Search),
            "stale Get response should not push ArtifactDetail view"
        );
    }
}
