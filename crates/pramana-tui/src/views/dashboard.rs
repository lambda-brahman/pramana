use crate::theme::THEME;
use crossterm::event::{KeyCode, KeyEvent};
use pramana_engine::TenantInfo;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};

pub struct DashboardView {
    pub mode: &'static str,
    pub port: u16,
    pub daemon_status: String,
    pub tenants: Vec<TenantInfo>,
    scroll_offset: usize,
    content_height: usize,
}

impl Default for DashboardView {
    fn default() -> Self {
        Self {
            mode: "standalone",
            port: 0,
            daemon_status: "unknown".into(),
            tenants: Vec::new(),
            scroll_offset: 0,
            content_height: 20,
        }
    }
}

impl DashboardView {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn populate(
        &mut self,
        mode: &'static str,
        port: u16,
        daemon_status: String,
        tenants: Vec<TenantInfo>,
    ) {
        self.mode = mode;
        self.port = port;
        self.daemon_status = daemon_status;
        self.tenants = tenants;
        self.scroll_offset = 0;
    }

    fn line_count(&self) -> usize {
        7 + std::cmp::max(1, self.tenants.len())
    }

    fn build_lines(&self) -> Vec<Line<'_>> {
        let mut lines = Vec::new();

        lines.push(Line::from(vec![
            Span::styled(
                "  pramana ",
                Style::default()
                    .fg(THEME.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("v{}", env!("CARGO_PKG_VERSION")),
                Style::default().fg(THEME.accent),
            ),
        ]));
        lines.push(Line::from(""));

        lines.push(Line::from(vec![
            Span::styled("  mode: ", Style::default().fg(THEME.secondary)),
            Span::styled(self.mode, Style::default().fg(THEME.primary)),
            Span::styled("    port: ", Style::default().fg(THEME.secondary)),
            Span::styled(format!("{}", self.port), Style::default().fg(THEME.primary)),
        ]));

        let status_color = match self.daemon_status.as_str() {
            "running" => THEME.success,
            "stopped" => THEME.error,
            _ => THEME.secondary,
        };
        lines.push(Line::from(vec![
            Span::styled("  daemon: ", Style::default().fg(THEME.secondary)),
            Span::styled(
                self.daemon_status.as_str(),
                Style::default().fg(status_color),
            ),
        ]));

        lines.push(Line::from(""));

        let total_artifacts: usize = self.tenants.iter().map(|t| t.artifact_count).sum();
        lines.push(Line::from(vec![
            Span::styled(
                format!("  Knowledge Bases ({})  ", self.tenants.len()),
                Style::default()
                    .fg(THEME.heading2)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("{total_artifacts} total artifacts"),
                Style::default().fg(THEME.muted),
            ),
        ]));

        lines.push(Line::from(""));

        if self.tenants.is_empty() {
            lines.push(Line::styled(
                "  No knowledge bases configured",
                Style::default().fg(THEME.muted),
            ));
        } else {
            for t in &self.tenants {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {:<20}", t.name),
                        Style::default().fg(THEME.primary),
                    ),
                    Span::styled(
                        format!("{:>5} artifacts  ", t.artifact_count),
                        Style::default().fg(THEME.accent),
                    ),
                    Span::styled(&t.source_dir, Style::default().fg(THEME.muted)),
                ]));
            }
        }

        lines
    }
}

pub enum DashboardAction {
    None,
    Back,
}

pub fn handle_dashboard_input(view: &mut DashboardView, key: KeyEvent) -> DashboardAction {
    let max_scroll = view.line_count().saturating_sub(view.content_height);

    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            if view.scroll_offset < max_scroll {
                view.scroll_offset += 1;
            }
            DashboardAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            view.scroll_offset = view.scroll_offset.saturating_sub(1);
            DashboardAction::None
        }
        KeyCode::Esc | KeyCode::Char('q') => DashboardAction::Back,
        _ => DashboardAction::None,
    }
}

pub fn render_dashboard(view: &mut DashboardView, area: Rect, buf: &mut Buffer) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(THEME.border))
        .title(Span::styled(
            " Dashboard ",
            Style::default()
                .fg(THEME.primary)
                .add_modifier(Modifier::BOLD),
        ));

    let inner = block.inner(area);
    block.render(area, buf);

    let chunks = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).split(inner);

    view.content_height = chunks[0].height as usize;

    let lines = view.build_lines();
    Paragraph::new(lines)
        .scroll((view.scroll_offset as u16, 0))
        .render(chunks[0], buf);

    let hints: Vec<(&str, &str)> = vec![("[j/k]", "scroll"), ("[Esc/q]", "back"), ("[?]", "help")];
    let hint_spans: Vec<Span> = hints
        .iter()
        .flat_map(|(k, d)| {
            vec![
                Span::styled(format!(" {k} "), Style::default().fg(THEME.hint_key)),
                Span::styled(format!("{d} "), Style::default().fg(THEME.hint_desc)),
            ]
        })
        .collect();
    Paragraph::new(Line::from(hint_spans)).render(chunks[1], buf);
}
