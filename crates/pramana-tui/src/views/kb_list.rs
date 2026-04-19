use crate::theme::THEME;
use crate::widgets::scrollable_list::{ScrollableList, ScrollableListState};
use crate::widgets::text_input::TextInputState;
use crossterm::event::{KeyCode, KeyEvent};
use pramana_engine::TenantInfo;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use std::time::Instant;

const HEALTH_CHECK_INTERVAL_SECS: u64 = 12;

#[derive(Clone)]
pub enum KbListMode {
    Normal,
    AddingName,
    AddingDir { name: String },
    ConfirmingDelete { name: String },
}

#[derive(Clone, PartialEq, Eq)]
pub enum DaemonState {
    Checking,
    Running,
    Stopped,
}

pub struct KbListView {
    pub tenants: Vec<TenantInfo>,
    pub selected_index: usize,
    pub mode: KbListMode,
    pub scroll_state: ScrollableListState,
    pub name_input: TextInputState,
    pub dir_input: TextInputState,
    pub daemon_state: DaemonState,
    pub last_health_check: Option<Instant>,
    pub status_message: Option<String>,
    pub error_message: Option<String>,
    pub last_viewport_height: usize,
}

impl Default for KbListView {
    fn default() -> Self {
        Self {
            tenants: Vec::new(),
            selected_index: 0,
            mode: KbListMode::Normal,
            scroll_state: ScrollableListState::new(),
            name_input: TextInputState::new(),
            dir_input: TextInputState::new(),
            daemon_state: DaemonState::Checking,
            last_health_check: None,
            status_message: None,
            error_message: None,
            last_viewport_height: 20,
        }
    }
}

impl KbListView {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn selected_tenant_name(&self) -> Option<&str> {
        self.tenants
            .get(self.selected_index)
            .map(|t| t.name.as_str())
    }

    pub fn is_form_active(&self) -> bool {
        !matches!(self.mode, KbListMode::Normal)
    }

    pub fn needs_health_check(&self) -> bool {
        match self.daemon_state {
            DaemonState::Running => self
                .last_health_check
                .map(|t| t.elapsed().as_secs() >= HEALTH_CHECK_INTERVAL_SECS)
                .unwrap_or(true),
            DaemonState::Checking => true,
            _ => false,
        }
    }

    pub fn set_health_result(&mut self, running: bool) {
        self.daemon_state = if running {
            DaemonState::Running
        } else {
            DaemonState::Stopped
        };
        self.last_health_check = Some(Instant::now());
    }
}

pub enum KbListAction {
    None,
    SelectKb(String),
    Quit,
    Reload(String),
    AddKb { name: String, source_dir: String },
    RemoveKb(String),
    ToggleDaemon,
    OpenDir(String),
    ShowDashboard,
}

pub fn handle_kb_list_input(view: &mut KbListView, key: KeyEvent) -> KbListAction {
    let delete_name = if let KbListMode::ConfirmingDelete { ref name } = view.mode {
        Some(name.clone())
    } else {
        None
    };
    if matches!(view.mode, KbListMode::Normal) {
        handle_normal_input(view, key)
    } else if matches!(view.mode, KbListMode::AddingName) {
        handle_adding_name_input(view, key)
    } else if matches!(view.mode, KbListMode::AddingDir { .. }) {
        handle_adding_dir_input(view, key)
    } else {
        handle_confirming_delete_input(view, key, &delete_name.expect("delete_name is set"))
    }
}

fn handle_normal_input(view: &mut KbListView, key: KeyEvent) -> KbListAction {
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            if !view.tenants.is_empty() {
                view.selected_index = (view.selected_index + 1).min(view.tenants.len() - 1);
                update_scroll(view);
            }
            KbListAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if !view.tenants.is_empty() {
                view.selected_index = view.selected_index.saturating_sub(1);
                update_scroll(view);
            }
            KbListAction::None
        }
        KeyCode::Enter => {
            if let Some(t) = view.tenants.get(view.selected_index) {
                KbListAction::SelectKb(t.name.clone())
            } else {
                KbListAction::None
            }
        }
        KeyCode::Char('a') => {
            view.mode = KbListMode::AddingName;
            view.name_input.clear();
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Char('d') => {
            if let Some(t) = view.tenants.get(view.selected_index) {
                view.mode = KbListMode::ConfirmingDelete {
                    name: t.name.clone(),
                };
            }
            KbListAction::None
        }
        KeyCode::Char('o') => {
            if let Some(t) = view.tenants.get(view.selected_index) {
                KbListAction::OpenDir(t.source_dir.clone())
            } else {
                KbListAction::None
            }
        }
        KeyCode::Char('r') => {
            if let Some(t) = view.tenants.get(view.selected_index) {
                KbListAction::Reload(t.name.clone())
            } else {
                KbListAction::None
            }
        }
        KeyCode::Char('S') => KbListAction::ToggleDaemon,
        KeyCode::Char('i') => KbListAction::ShowDashboard,
        KeyCode::Char('q') | KeyCode::Esc => KbListAction::Quit,
        _ => KbListAction::None,
    }
}

fn handle_adding_name_input(view: &mut KbListView, key: KeyEvent) -> KbListAction {
    match key.code {
        KeyCode::Esc => {
            view.mode = KbListMode::Normal;
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Enter => {
            let name = view.name_input.value.trim().to_string();
            if name.is_empty() {
                view.error_message = Some("Name cannot be empty".into());
                return KbListAction::None;
            }
            if let Err(msg) = validate_kb_name(&name, &view.tenants) {
                view.error_message = Some(msg);
                return KbListAction::None;
            }
            view.mode = KbListMode::AddingDir { name };
            view.dir_input.clear();
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Backspace => {
            view.name_input.backspace();
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Char(c) => {
            view.name_input.insert(c);
            view.error_message = None;
            KbListAction::None
        }
        _ => KbListAction::None,
    }
}

fn handle_adding_dir_input(view: &mut KbListView, key: KeyEvent) -> KbListAction {
    let name = match &view.mode {
        KbListMode::AddingDir { name } => name.clone(),
        _ => return KbListAction::None,
    };

    match key.code {
        KeyCode::Esc => {
            view.mode = KbListMode::Normal;
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Enter => {
            let dir = view.dir_input.value.trim().to_string();
            if dir.is_empty() {
                view.error_message = Some("Directory cannot be empty".into());
                return KbListAction::None;
            }
            if !std::path::Path::new(&dir).is_dir() {
                view.error_message = Some(format!("Directory not found: {dir}"));
                return KbListAction::None;
            }
            view.mode = KbListMode::Normal;
            view.error_message = None;
            KbListAction::AddKb {
                name,
                source_dir: dir,
            }
        }
        KeyCode::Backspace => {
            view.dir_input.backspace();
            view.error_message = None;
            KbListAction::None
        }
        KeyCode::Char(c) => {
            view.dir_input.insert(c);
            view.error_message = None;
            KbListAction::None
        }
        _ => KbListAction::None,
    }
}

fn handle_confirming_delete_input(
    view: &mut KbListView,
    key: KeyEvent,
    name: &str,
) -> KbListAction {
    match key.code {
        KeyCode::Char('y') | KeyCode::Char('Y') => {
            let action = KbListAction::RemoveKb(name.to_owned());
            view.mode = KbListMode::Normal;
            action
        }
        KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
            view.mode = KbListMode::Normal;
            KbListAction::None
        }
        _ => KbListAction::None,
    }
}

fn validate_kb_name(name: &str, existing: &[TenantInfo]) -> Result<(), String> {
    let re = regex_lite_check(name);
    if !re {
        return Err("Name must match /^[a-z][a-z0-9-]*$/".into());
    }
    let reserved = [
        "get", "search", "traverse", "list", "tenants", "reload", "version",
    ];
    if reserved.contains(&name) {
        return Err(format!("'{name}' is a reserved name"));
    }
    if existing.iter().any(|t| t.name == name) {
        return Err(format!("'{name}' already exists"));
    }
    Ok(())
}

fn regex_lite_check(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    for c in chars {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' {
            return false;
        }
    }
    true
}

fn update_scroll(view: &mut KbListView) {
    view.scroll_state.ensure_visible(
        view.selected_index as isize,
        view.tenants.len(),
        view.last_viewport_height,
        &|_| 1,
    );
}

pub fn render_kb_list(view: &mut KbListView, area: Rect, buf: &mut Buffer, active_tenant: &str) {
    let daemon_label = match view.daemon_state {
        DaemonState::Checking => "checking...",
        DaemonState::Running => "daemon: running",
        DaemonState::Stopped => "daemon: stopped",
    };

    let title = format!(" Knowledge Bases ({}) ", view.tenants.len());
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(THEME.border))
        .title(Span::styled(
            title,
            Style::default()
                .fg(THEME.primary)
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Span::styled(
            format!(" {daemon_label} "),
            Style::default().fg(THEME.muted),
        ));

    let inner = block.inner(area);
    block.render(area, buf);

    let form_lines = match &view.mode {
        KbListMode::Normal => 0u16,
        KbListMode::AddingName | KbListMode::AddingDir { .. } => 3,
        KbListMode::ConfirmingDelete { .. } => 2,
    };
    let hint_lines = 2u16;
    let msg_lines = if view.status_message.is_some() || view.error_message.is_some() {
        1u16
    } else {
        0
    };
    let list_height = inner
        .height
        .saturating_sub(form_lines + hint_lines + msg_lines);
    view.last_viewport_height = list_height as usize;

    let chunks = Layout::vertical([
        Constraint::Length(list_height),
        Constraint::Length(form_lines),
        Constraint::Length(msg_lines),
        Constraint::Length(hint_lines),
    ])
    .split(inner);

    // Render list
    let items: Vec<Vec<Line>> = view
        .tenants
        .iter()
        .map(|t| {
            let marker = if t.name == active_tenant { "* " } else { "  " };
            let name_style = if t.name == active_tenant {
                Style::default()
                    .fg(THEME.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(THEME.primary)
            };
            vec![Line::from(vec![
                Span::styled(marker, name_style),
                Span::styled(&t.name, name_style),
                Span::styled(
                    format!("  {}  ", t.source_dir),
                    Style::default().fg(THEME.muted),
                ),
                Span::styled(
                    format!("{} artifacts", t.artifact_count),
                    Style::default().fg(THEME.secondary),
                ),
            ])]
        })
        .collect();

    let list = ScrollableList::new(&items, view.selected_index as isize, &view.scroll_state)
        .empty_message("No knowledge bases configured. Press [a] to add one.");
    list.render(chunks[0], buf);

    // Render form
    match &view.mode {
        KbListMode::AddingName => {
            let label_line = Line::from(vec![
                Span::styled("  Name: ", Style::default().fg(THEME.primary)),
                Span::styled(&view.name_input.value, Style::default().fg(THEME.accent)),
                Span::styled("\u{2588}", Style::default().fg(THEME.accent)),
            ]);
            label_line.render(Rect::new(chunks[1].x, chunks[1].y, chunks[1].width, 1), buf);
            let hint = Line::styled(
                "  [Enter] next  [Esc] cancel",
                Style::default().fg(THEME.hint_desc),
            );
            hint.render(
                Rect::new(chunks[1].x, chunks[1].y + 2, chunks[1].width, 1),
                buf,
            );
        }
        KbListMode::AddingDir { name } => {
            let label_line = Line::from(vec![
                Span::styled(
                    format!("  Dir for '{name}': "),
                    Style::default().fg(THEME.primary),
                ),
                Span::styled(&view.dir_input.value, Style::default().fg(THEME.accent)),
                Span::styled("\u{2588}", Style::default().fg(THEME.accent)),
            ]);
            label_line.render(Rect::new(chunks[1].x, chunks[1].y, chunks[1].width, 1), buf);
            let hint = Line::styled(
                "  [Enter] add  [Esc] cancel",
                Style::default().fg(THEME.hint_desc),
            );
            hint.render(
                Rect::new(chunks[1].x, chunks[1].y + 2, chunks[1].width, 1),
                buf,
            );
        }
        KbListMode::ConfirmingDelete { name } => {
            let confirm = Line::from(vec![
                Span::styled("  Delete '", Style::default().fg(THEME.error)),
                Span::styled(name.as_str(), Style::default().fg(THEME.error)),
                Span::styled("'? [y/n] ", Style::default().fg(THEME.error)),
                Span::styled(
                    "(source files are not deleted)",
                    Style::default().fg(THEME.muted),
                ),
            ]);
            confirm.render(Rect::new(chunks[1].x, chunks[1].y, chunks[1].width, 1), buf);
        }
        KbListMode::Normal => {}
    }

    // Status / error message
    if let Some(ref msg) = view.error_message {
        let err_line = Line::styled(format!("  {msg}"), Style::default().fg(THEME.error));
        err_line.render(Rect::new(chunks[2].x, chunks[2].y, chunks[2].width, 1), buf);
    } else if let Some(ref msg) = view.status_message {
        let status_line = Line::styled(format!("  {msg}"), Style::default().fg(THEME.success));
        status_line.render(Rect::new(chunks[2].x, chunks[2].y, chunks[2].width, 1), buf);
    }

    // Hint bar
    let hints = if view.is_form_active() {
        vec![]
    } else {
        vec![
            ("[j/k]", "nav"),
            ("[Enter]", "open"),
            ("[a]", "add"),
            ("[d]", "delete"),
            ("[r]", "reload"),
            ("[o]", "open dir"),
            ("[S]", "daemon"),
            ("[i]", "info"),
        ]
    };

    if !hints.is_empty() {
        let hint_spans: Vec<Span> = hints
            .iter()
            .flat_map(|(k, d)| {
                vec![
                    Span::styled(format!(" {k} "), Style::default().fg(THEME.hint_key)),
                    Span::styled(format!("{d} "), Style::default().fg(THEME.hint_desc)),
                ]
            })
            .collect();

        Paragraph::new(Line::from(hint_spans)).render(
            Rect::new(chunks[3].x, chunks[3].y + 1, chunks[3].width, 1),
            buf,
        );
    }
}
