use crate::data_source::DataSource;
use crate::error::TuiError;
use crate::io_worker::{IoHandle, IoResponse};
use crate::views::artifact_detail::{
    handle_detail_input, render_artifact_detail, ArtifactDetailView, DetailAction,
};
use crate::views::kb_list::{handle_kb_list_input, render_kb_list, KbListAction, KbListView};
use crate::views::search::{handle_search_input, render_search, SearchAction, SearchView};
use crate::widgets::breadcrumb::Breadcrumb;
use crate::widgets::help_overlay::HelpOverlay;
use crate::widgets::status_bar::StatusBar;
use crossterm::event::{self, Event, KeyCode, KeyEvent};
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::widgets::Widget;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Clone)]
pub enum View {
    KbList,
    Search,
    ArtifactDetail { slug: String },
}

struct NavEntry {
    view: View,
}

pub struct App {
    io: IoHandle,
    io_rx: mpsc::Receiver<IoResponse>,
    mode_label: &'static str,
    pub active_tenant: String,
    pub port: u16,
    nav_stack: Vec<NavEntry>,
    pub kb_list: KbListView,
    pub search: SearchView,
    pub detail: ArtifactDetailView,
    pub show_help: bool,
    pub should_quit: bool,
    pub last_content_height: u16,
    search_generation: u64,
    health_check_in_flight: bool,
}

impl App {
    pub fn new(data_source: DataSource, port: u16, initial_tenant: Option<String>) -> Self {
        let mode_label = data_source.mode_label();
        let (io, io_rx) = IoHandle::new(data_source);
        let tenant = initial_tenant.unwrap_or_default();
        let mut app = Self {
            io,
            io_rx,
            mode_label,
            active_tenant: tenant,
            port,
            nav_stack: vec![NavEntry { view: View::KbList }],
            kb_list: KbListView::new(),
            search: SearchView::new(),
            detail: ArtifactDetailView::new(),
            show_help: false,
            should_quit: false,
            last_content_height: 20,
            search_generation: 0,
            health_check_in_flight: false,
        };
        app.refresh_tenants();
        app
    }

    pub fn current_view(&self) -> &View {
        &self
            .nav_stack
            .last()
            .expect("nav stack should never be empty")
            .view
    }

    fn push_view(&mut self, view: View) {
        self.nav_stack.push(NavEntry { view });
    }

    fn pop_view(&mut self) {
        if self.nav_stack.len() > 1 {
            self.nav_stack.pop();
        } else {
            self.should_quit = true;
        }
    }

    fn breadcrumb_segments(&self) -> Vec<String> {
        let mut segments = vec!["pramana".to_string()];
        for entry in &self.nav_stack {
            match &entry.view {
                View::KbList => segments.push("kb-list".into()),
                View::Search => {
                    segments.push(self.active_tenant.clone());
                    segments.push("search".into());
                }
                View::ArtifactDetail { slug } => {
                    segments.push(self.active_tenant.clone());
                    segments.push(slug.clone());
                }
            }
        }
        segments
    }

    fn view_label(&self) -> &str {
        match self.current_view() {
            View::KbList => "kb-list",
            View::Search => "search",
            View::ArtifactDetail { .. } => "detail",
        }
    }

    pub fn refresh_tenants(&mut self) {
        self.io.spawn_list_tenants();
    }

    pub fn handle_event(&mut self, event: Event) {
        if let Event::Key(key) = event {
            if self.show_help {
                if matches!(
                    key.code,
                    KeyCode::Esc | KeyCode::Char('?') | KeyCode::Char('q')
                ) {
                    self.show_help = false;
                }
                return;
            }

            if !self.kb_list.is_form_active()
                && !matches!(self.current_view(), View::Search)
                && key.code == KeyCode::Char('?')
            {
                self.show_help = true;
                return;
            }

            let current = self.current_view().clone();
            match current {
                View::KbList => self.handle_kb_list_event(key),
                View::Search => self.handle_search_event(key),
                View::ArtifactDetail { .. } => self.handle_detail_event(key),
            }
        }
    }

    fn handle_kb_list_event(&mut self, key: KeyEvent) {
        let action = handle_kb_list_input(&mut self.kb_list, key);
        match action {
            KbListAction::Quit => self.should_quit = true,
            KbListAction::SelectKb(name) => {
                self.active_tenant = name;
                self.search = SearchView::new();
                self.push_view(View::Search);
            }
            KbListAction::Reload(name) => {
                self.kb_list.status_message = Some(format!("Reloading '{name}'..."));
                self.io.spawn_reload(name);
            }
            KbListAction::AddKb { name, source_dir } => {
                self.kb_list.status_message = Some(format!("Adding '{name}'..."));
                self.io.spawn_add_kb(name, source_dir);
            }
            KbListAction::RemoveKb(name) => {
                self.kb_list.status_message = Some(format!("Removing '{name}'..."));
                self.io.spawn_remove_kb(name);
            }
            KbListAction::OpenDir(dir) => {
                let _ = open_directory(&dir);
            }
            KbListAction::ToggleDaemon => {
                self.kb_list.status_message =
                    Some("Daemon toggle not available in standalone mode".into());
            }
            KbListAction::None => {}
        }
    }

    fn handle_search_event(&mut self, key: KeyEvent) {
        if !self.search.input_focused && key.code == KeyCode::Char('?') {
            self.show_help = true;
            return;
        }

        let action = handle_search_input(&mut self.search, key);
        match action {
            SearchAction::Back => self.pop_view(),
            SearchAction::ViewArtifact(slug) => {
                self.navigate_to_artifact(&slug);
            }
            SearchAction::None => {}
        }
    }

    fn handle_detail_event(&mut self, key: KeyEvent) {
        if key.code == KeyCode::Char('q') {
            self.pop_view();
            return;
        }

        let action = handle_detail_input(&mut self.detail, key);
        match action {
            DetailAction::Back => self.pop_view(),
            DetailAction::NavigateTo(slug) => {
                self.navigate_to_artifact(&slug);
            }
            DetailAction::None => {}
        }
    }

    fn navigate_to_artifact(&mut self, slug: &str) {
        self.search.loading = true;
        self.io
            .spawn_get(self.active_tenant.clone(), slug.to_string());
    }

    fn process_io_responses(&mut self) {
        while let Ok(resp) = self.io_rx.try_recv() {
            match resp {
                IoResponse::HealthCheck(running) => {
                    self.health_check_in_flight = false;
                    self.kb_list.set_health_result(running);
                    self.kb_list.status_message = None;
                }
                IoResponse::Tenants(Ok(tenants)) => {
                    self.kb_list.tenants = tenants;
                    if self.active_tenant.is_empty() {
                        if let Some(first) = self.kb_list.tenants.first() {
                            self.active_tenant = first.name.clone();
                        }
                    }
                }
                IoResponse::Tenants(Err(_)) => {}
                IoResponse::Search { generation, result } => {
                    if generation == self.search_generation {
                        match result {
                            Ok(results) => self.search.set_results(results),
                            Err(e) => {
                                self.search.set_results(Vec::new());
                                self.search.error_message = Some(format!("Search failed: {e}"));
                            }
                        }
                    }
                }
                IoResponse::Get { slug, result } => match *result {
                    Ok(Some(artifact)) => {
                        self.search.loading = false;
                        self.detail = ArtifactDetailView::new();
                        self.detail.set_artifact(artifact);
                        self.push_view(View::ArtifactDetail { slug });
                    }
                    Ok(None) => {
                        self.search.loading = false;
                        self.search.error_message = Some(format!("Artifact '{slug}' not found"));
                    }
                    Err(e) => {
                        self.search.loading = false;
                        self.search.error_message = Some(format!("Failed to load '{slug}': {e}"));
                    }
                },
                IoResponse::Reload { name, result } => {
                    match result {
                        Ok(report) => {
                            self.kb_list.status_message = Some(format!(
                                "Reloaded '{}': {}/{} files",
                                name, report.succeeded, report.total
                            ));
                        }
                        Err(e) => {
                            self.kb_list.error_message = Some(format!("Reload failed: {e}"));
                        }
                    }
                    self.refresh_tenants();
                }
                IoResponse::AddKb { name, result } => {
                    match result {
                        Ok(report) => {
                            self.kb_list.status_message = Some(format!(
                                "Added '{}': {}/{} files",
                                name, report.succeeded, report.total
                            ));
                        }
                        Err(e) => {
                            self.kb_list.error_message = Some(format!("Add failed: {e}"));
                        }
                    }
                    self.refresh_tenants();
                }
                IoResponse::RemoveKb { name, result } => {
                    match result {
                        Ok(()) => {
                            self.kb_list.status_message = Some(format!("Removed '{name}'"));
                            if self.active_tenant == name {
                                self.active_tenant = self
                                    .kb_list
                                    .tenants
                                    .first()
                                    .map(|t| t.name.clone())
                                    .unwrap_or_default();
                            }
                        }
                        Err(e) => {
                            self.kb_list.error_message = Some(format!("Remove failed: {e}"));
                        }
                    }
                    self.refresh_tenants();
                }
            }
        }
    }

    pub fn tick(&mut self) {
        self.process_io_responses();

        if matches!(self.current_view(), View::KbList)
            && !self.health_check_in_flight
            && self.kb_list.needs_health_check()
        {
            self.health_check_in_flight = true;
            self.kb_list.status_message = Some("Checking daemon...".into());
            self.io.spawn_health_check(self.port);
        }

        if matches!(self.current_view(), View::Search) && self.search.needs_search() {
            if let Some(query) = self.search.take_pending_query() {
                self.search_generation += 1;
                self.search.loading = true;
                self.io
                    .spawn_search(self.active_tenant.clone(), query, self.search_generation);
            }
        }
    }
}

pub fn render_app(app: &mut App, area: Rect, buf: &mut Buffer) {
    let chunks = Layout::vertical([
        Constraint::Length(1), // breadcrumb
        Constraint::Min(1),    // content
        Constraint::Length(1), // status bar
    ])
    .split(area);

    // Breadcrumb
    let segments = app.breadcrumb_segments();
    Breadcrumb::new(&segments).render(chunks[0], buf);

    // Content
    let content_area = chunks[1];
    app.last_content_height = content_area.height;
    match app.current_view() {
        View::KbList => render_kb_list(&mut app.kb_list, content_area, buf, &app.active_tenant),
        View::Search => render_search(&mut app.search, content_area, buf),
        View::ArtifactDetail { .. } => render_artifact_detail(&mut app.detail, content_area, buf),
    }

    // Status bar
    StatusBar::new(
        app.view_label(),
        &app.active_tenant,
        app.mode_label,
        app.nav_stack.len(),
    )
    .render(chunks[2], buf);

    // Help overlay
    if app.show_help {
        let bindings: Vec<(&str, &str)> = match app.current_view() {
            View::KbList => vec![
                ("j/k", "Navigate"),
                ("Enter", "Open KB"),
                ("a", "Add KB"),
                ("d", "Delete KB"),
                ("r", "Reload KB"),
                ("o", "Open source dir"),
                ("S", "Toggle daemon"),
                ("q/Esc", "Quit"),
                ("?", "Toggle help"),
            ],
            View::Search => vec![
                ("type", "Search"),
                ("Enter/↓", "Go to results"),
                ("j/k", "Navigate results"),
                ("h/l", "Pan snippet"),
                ("Enter", "View artifact"),
                ("Esc", "Back / clear"),
                ("?", "Toggle help"),
            ],
            View::ArtifactDetail { .. } => vec![
                ("j/k", "Scroll / navigate"),
                ("d/u", "Half-page scroll"),
                ("h/l", "Pan left/right"),
                ("0", "Reset scroll"),
                ("Tab", "Cycle panels"),
                ("Enter", "Follow link"),
                ("Esc/q", "Back"),
                ("?", "Toggle help"),
            ],
        };
        HelpOverlay::new(&bindings).render(area, buf);
    }
}

fn open_directory(dir: &str) -> Result<(), std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(dir).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(dir).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(dir).spawn()?;
    }
    Ok(())
}

pub fn run_event_loop(app: &mut App) -> Result<(), TuiError> {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        ratatui::restore();
        prev_hook(info);
    }));

    let mut terminal = ratatui::init();

    let result = (|| -> Result<(), TuiError> {
        loop {
            terminal.draw(|frame| {
                let area = frame.area();
                render_app(app, area, frame.buffer_mut());
            })?;

            if app.should_quit {
                break;
            }

            if event::poll(Duration::from_millis(100))? {
                let ev = event::read()?;
                app.handle_event(ev);
            }

            app.tick();
        }
        Ok(())
    })();

    ratatui::restore();
    result
}
