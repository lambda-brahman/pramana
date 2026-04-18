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

        std::thread::sleep(Duration::from_millis(50));
        app.tick();

        assert!(
            !app.kb_list.tenants.is_empty(),
            "tenants should be populated after tick"
        );
        assert_eq!(app.active_tenant, "demo");
    }
}
