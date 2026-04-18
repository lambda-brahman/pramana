use crate::data_source::DataSource;
use crate::error::TuiError;
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
    pub data_source: DataSource,
    pub active_tenant: String,
    pub port: u16,
    nav_stack: Vec<NavEntry>,
    pub kb_list: KbListView,
    pub search: SearchView,
    pub detail: ArtifactDetailView,
    pub show_help: bool,
    pub should_quit: bool,
}

impl App {
    pub fn new(data_source: DataSource, port: u16, initial_tenant: Option<String>) -> Self {
        let tenant = initial_tenant.unwrap_or_default();
        let mut app = Self {
            data_source,
            active_tenant: tenant,
            port,
            nav_stack: vec![NavEntry { view: View::KbList }],
            kb_list: KbListView::new(),
            search: SearchView::new(),
            detail: ArtifactDetailView::new(),
            show_help: false,
            should_quit: false,
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
        if let Ok(tenants) = self.data_source.list_tenants() {
            self.kb_list.tenants = tenants;
            if self.active_tenant.is_empty() {
                if let Some(first) = self.kb_list.tenants.first() {
                    self.active_tenant = first.name.clone();
                }
            }
        }
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
                match self.data_source.reload(&name) {
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
            KbListAction::AddKb { name, source_dir } => {
                match self.data_source.add_kb(&name, &source_dir) {
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
            KbListAction::RemoveKb(name) => {
                match self.data_source.remove_kb(&name) {
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
        match self.data_source.get(&self.active_tenant, slug) {
            Ok(Some(artifact)) => {
                self.detail = ArtifactDetailView::new();
                self.detail.set_artifact(artifact);
                self.push_view(View::ArtifactDetail {
                    slug: slug.to_string(),
                });
            }
            Ok(None) => {
                self.search.loading = false;
            }
            Err(_) => {
                self.search.loading = false;
            }
        }
    }

    pub fn tick(&mut self) {
        if matches!(self.current_view(), View::KbList) && self.kb_list.needs_health_check() {
            let running = DataSource::check_daemon(self.port);
            self.kb_list.set_health_result(running);
        }

        if matches!(self.current_view(), View::Search) && self.search.needs_search() {
            if let Some(query) = self.search.take_pending_query() {
                self.search.loading = true;
                match self.data_source.search(&self.active_tenant, &query) {
                    Ok(results) => self.search.set_results(results),
                    Err(_) => self.search.set_results(Vec::new()),
                }
            }
        }
    }
}

pub fn render_app(app: &App, area: Rect, buf: &mut Buffer) {
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
    match app.current_view() {
        View::KbList => render_kb_list(&app.kb_list, content_area, buf, &app.active_tenant),
        View::Search => render_search(&app.search, content_area, buf),
        View::ArtifactDetail { .. } => render_artifact_detail(&app.detail, content_area, buf),
    }

    // Status bar
    StatusBar::new(
        app.view_label(),
        &app.active_tenant,
        app.data_source.mode_label(),
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
    let mut terminal = ratatui::init();

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

    ratatui::restore();
    Ok(())
}
