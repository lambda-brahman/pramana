use crate::layout::HORIZONTAL_SCROLL_STEP;
use crate::theme::THEME;
use crate::widgets::scrollable_list::{ScrollableList, ScrollableListState};
use crossterm::event::{KeyCode, KeyEvent};
use pramana_engine::ArtifactView;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Tabs, Widget};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Content,
    Relationships,
    Sections,
}

impl Panel {
    fn index(self) -> usize {
        match self {
            Panel::Content => 0,
            Panel::Relationships => 1,
            Panel::Sections => 2,
        }
    }

    fn next(self) -> Self {
        match self {
            Panel::Content => Panel::Relationships,
            Panel::Relationships => Panel::Sections,
            Panel::Sections => Panel::Content,
        }
    }
}

pub struct ArtifactDetailView {
    pub artifact: Option<ArtifactView>,
    pub panel: Panel,
    pub scroll_offset: usize,
    pub rel_index: usize,
    pub scroll_x: usize,
    pub content_lines: Vec<String>,
    pub scroll_state: ScrollableListState,
    pub last_viewport_height: usize,
}

impl Default for ArtifactDetailView {
    fn default() -> Self {
        Self {
            artifact: None,
            panel: Panel::Content,
            scroll_offset: 0,
            rel_index: 0,
            scroll_x: 0,
            content_lines: Vec::new(),
            scroll_state: ScrollableListState::new(),
            last_viewport_height: 20,
        }
    }
}

impl ArtifactDetailView {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_artifact(&mut self, artifact: ArtifactView) {
        self.content_lines = artifact.content.lines().map(String::from).collect();
        self.artifact = Some(artifact);
        self.panel = Panel::Content;
        self.scroll_offset = 0;
        self.rel_index = 0;
        self.scroll_x = 0;
        self.scroll_state = ScrollableListState::new();
        self.last_viewport_height = 20;
    }
}

pub enum DetailAction {
    None,
    Back,
    NavigateTo(String),
    OpenGraph,
}

pub fn handle_detail_input(view: &mut ArtifactDetailView, key: KeyEvent) -> DetailAction {
    match key.code {
        KeyCode::Esc => DetailAction::Back,
        KeyCode::Char('g') => DetailAction::OpenGraph,
        KeyCode::Tab => {
            view.panel = view.panel.next();
            view.rel_index = 0;
            view.scroll_state = ScrollableListState::new();
            DetailAction::None
        }
        _ => match view.panel {
            Panel::Content => handle_content_input(view, key),
            Panel::Relationships => handle_rel_input(view, key),
            Panel::Sections => handle_sections_input(view, key),
        },
    }
}

fn handle_content_input(view: &mut ArtifactDetailView, key: KeyEvent) -> DetailAction {
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            if view.scroll_offset < view.content_lines.len().saturating_sub(1) {
                view.scroll_offset += 1;
            }
            DetailAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            view.scroll_offset = view.scroll_offset.saturating_sub(1);
            DetailAction::None
        }
        KeyCode::Char('d') => {
            view.scroll_offset =
                (view.scroll_offset + 10).min(view.content_lines.len().saturating_sub(1));
            DetailAction::None
        }
        KeyCode::Char('u') => {
            view.scroll_offset = view.scroll_offset.saturating_sub(10);
            DetailAction::None
        }
        KeyCode::Char('h') | KeyCode::Left => {
            view.scroll_x = view.scroll_x.saturating_sub(HORIZONTAL_SCROLL_STEP);
            DetailAction::None
        }
        KeyCode::Char('l') | KeyCode::Right => {
            view.scroll_x += HORIZONTAL_SCROLL_STEP;
            DetailAction::None
        }
        KeyCode::Char('0') => {
            view.scroll_x = 0;
            DetailAction::None
        }
        _ => DetailAction::None,
    }
}

fn handle_rel_input(view: &mut ArtifactDetailView, key: KeyEvent) -> DetailAction {
    let artifact = match &view.artifact {
        Some(a) => a,
        None => return DetailAction::None,
    };

    let total = artifact.relationships.len() + artifact.inverse_relationships.len();
    if total == 0 {
        return DetailAction::None;
    }

    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            view.rel_index = (view.rel_index + 1).min(total - 1);
            view.scroll_state.ensure_visible(
                view.rel_index as isize,
                total,
                view.last_viewport_height,
                &|_| 1,
            );
            DetailAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            view.rel_index = view.rel_index.saturating_sub(1);
            view.scroll_state.ensure_visible(
                view.rel_index as isize,
                total,
                view.last_viewport_height,
                &|_| 1,
            );
            DetailAction::None
        }
        KeyCode::Enter => {
            let all_rels: Vec<&str> = artifact
                .relationships
                .iter()
                .map(|r| r.target.as_str())
                .chain(
                    artifact
                        .inverse_relationships
                        .iter()
                        .map(|r| r.target.as_str()),
                )
                .collect();
            if let Some(target) = all_rels.get(view.rel_index) {
                let slug = target.split('#').next().unwrap_or(target);
                DetailAction::NavigateTo(slug.to_string())
            } else {
                DetailAction::None
            }
        }
        _ => DetailAction::None,
    }
}

fn handle_sections_input(view: &mut ArtifactDetailView, key: KeyEvent) -> DetailAction {
    let artifact = match &view.artifact {
        Some(a) => a,
        None => return DetailAction::None,
    };

    let total = artifact.sections.len();
    if total == 0 {
        return DetailAction::None;
    }

    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            view.rel_index = (view.rel_index + 1).min(total - 1);
            view.scroll_state.ensure_visible(
                view.rel_index as isize,
                total,
                view.last_viewport_height,
                &|_| 1,
            );
            DetailAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            view.rel_index = view.rel_index.saturating_sub(1);
            view.scroll_state.ensure_visible(
                view.rel_index as isize,
                total,
                view.last_viewport_height,
                &|_| 1,
            );
            DetailAction::None
        }
        KeyCode::Enter => {
            if let Some(section) = artifact.sections.get(view.rel_index) {
                let line_idx = (section.line as usize).saturating_sub(1);
                view.panel = Panel::Content;
                view.scroll_offset = line_idx;
            }
            DetailAction::None
        }
        _ => DetailAction::None,
    }
}

pub fn render_artifact_detail(view: &mut ArtifactDetailView, area: Rect, buf: &mut Buffer) {
    let artifact = match &view.artifact {
        Some(a) => a,
        None => {
            let msg = Paragraph::new("Loading...");
            msg.render(area, buf);
            return;
        }
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(THEME.border));

    let inner = block.inner(area);
    block.render(area, buf);

    let chunks = Layout::vertical([
        Constraint::Length(1), // title
        Constraint::Length(1), // slug + tags
        Constraint::Length(1), // tabs
        Constraint::Min(1),    // content
        Constraint::Length(1), // footer
        Constraint::Length(1), // hints
    ])
    .split(inner);

    // Title
    let title = Line::from(vec![Span::styled(
        &artifact.title,
        Style::default()
            .fg(THEME.primary)
            .add_modifier(Modifier::BOLD),
    )]);
    title.render(chunks[0], buf);

    // Slug + tags
    let mut slug_spans = vec![
        Span::styled("slug: ", Style::default().fg(THEME.muted)),
        Span::styled(&artifact.slug, Style::default().fg(THEME.secondary)),
    ];
    if !artifact.tags.is_empty() {
        slug_spans.push(Span::styled("  ", Style::default()));
        for tag in &artifact.tags {
            slug_spans.push(Span::styled(
                format!("[{tag}] "),
                Style::default().fg(THEME.tag),
            ));
        }
    }
    Line::from(slug_spans).render(chunks[1], buf);

    // Tabs
    let rel_count = artifact.relationships.len() + artifact.inverse_relationships.len();
    let sec_count = artifact.sections.len();
    let tab_titles = vec![
        format!("content"),
        format!("relationships ({rel_count})"),
        format!("sections ({sec_count})"),
    ];
    let tabs = Tabs::new(tab_titles)
        .select(view.panel.index())
        .highlight_style(
            Style::default()
                .fg(THEME.primary)
                .add_modifier(Modifier::BOLD),
        )
        .style(Style::default().fg(THEME.muted));
    tabs.render(chunks[2], buf);

    // Content area
    view.last_viewport_height = chunks[3].height as usize;
    match view.panel {
        Panel::Content => render_content_panel(view, chunks[3], buf),
        Panel::Relationships => render_relationships_panel(view, chunks[3], buf),
        Panel::Sections => render_sections_panel(view, chunks[3], buf),
    }

    // Footer
    let footer = match view.panel {
        Panel::Content => {
            let total = view.content_lines.len();
            let end = (view.scroll_offset + chunks[3].height as usize).min(total);
            let mut parts = format!("[line {}-{}/{}]", view.scroll_offset + 1, end, total);
            if view.scroll_x > 0 {
                parts.push_str(&format!(" col {}", view.scroll_x));
            }
            parts
        }
        Panel::Relationships => {
            let total = artifact.relationships.len() + artifact.inverse_relationships.len();
            if total > 0 {
                format!("[{}/{}]", view.rel_index + 1, total)
            } else {
                String::new()
            }
        }
        Panel::Sections => {
            let total = artifact.sections.len();
            if total > 0 {
                format!("[{}/{}]", view.rel_index + 1, total)
            } else {
                String::new()
            }
        }
    };
    Line::styled(footer, Style::default().fg(THEME.muted)).render(chunks[4], buf);

    // Hints
    let hints = match view.panel {
        Panel::Content => "[Esc] back [Tab] panels [j/k] scroll [d/u] page [h/l] pan [g] graph",
        Panel::Relationships | Panel::Sections => {
            "[Esc] back [Tab] panels [j/k] nav [Enter] follow [g] graph"
        }
    };
    Line::styled(hints, Style::default().fg(THEME.hint_desc)).render(chunks[5], buf);
}

fn render_content_panel(view: &ArtifactDetailView, area: Rect, buf: &mut Buffer) {
    let height = area.height as usize;
    let end = (view.scroll_offset + height).min(view.content_lines.len());
    let visible = &view.content_lines[view.scroll_offset..end];

    for (i, line_text) in visible.iter().enumerate() {
        let y = area.y + i as u16;
        if y >= area.y + area.height {
            break;
        }
        let styled = style_markdown_line(line_text, view.scroll_x, area.width as usize);
        styled.render(Rect::new(area.x, y, area.width, 1), buf);
    }
}

fn render_relationships_panel(view: &ArtifactDetailView, area: Rect, buf: &mut Buffer) {
    let artifact = match &view.artifact {
        Some(a) => a,
        None => return,
    };

    let mut items: Vec<Vec<Line>> = Vec::new();

    for rel in &artifact.relationships {
        items.push(vec![Line::from(vec![
            Span::styled("  \u{2192} ", Style::default().fg(THEME.depends_on)),
            Span::styled(&rel.target, Style::default().fg(THEME.primary)),
            Span::styled(
                format!("  ({})", rel.kind),
                Style::default().fg(THEME.muted),
            ),
        ])]);
    }

    for rel in &artifact.inverse_relationships {
        items.push(vec![Line::from(vec![
            Span::styled("  \u{2190} ", Style::default().fg(THEME.relates_to)),
            Span::styled(&rel.target, Style::default().fg(THEME.primary)),
            Span::styled(
                format!("  ({})", rel.kind),
                Style::default().fg(THEME.muted),
            ),
        ])]);
    }

    let list = ScrollableList::new(&items, view.rel_index as isize, &view.scroll_state)
        .empty_message("No relationships");
    list.render(area, buf);
}

fn render_sections_panel(view: &ArtifactDetailView, area: Rect, buf: &mut Buffer) {
    let artifact = match &view.artifact {
        Some(a) => a,
        None => return,
    };

    let items: Vec<Vec<Line>> = artifact
        .sections
        .iter()
        .map(|s| {
            let indent = "  ".repeat(s.level.max(1) as usize - 1);
            vec![Line::from(vec![
                Span::styled(format!("  {indent}"), Style::default()),
                Span::styled(&s.heading, Style::default().fg(THEME.primary)),
                Span::styled(format!("  L{}", s.line), Style::default().fg(THEME.muted)),
            ])]
        })
        .collect();

    let list = ScrollableList::new(&items, view.rel_index as isize, &view.scroll_state)
        .empty_message("No sections");
    list.render(area, buf);
}

/// Grapheme-safe horizontal scroll and markdown styling (issue #63).
fn style_markdown_line(line: &str, scroll_x: usize, width: usize) -> Line<'static> {
    let graphemes: Vec<&str> = line.graphemes(true).collect();
    let visible_start = scroll_x.min(graphemes.len());
    let visible_end = (scroll_x + width).min(graphemes.len());
    let visible: String = graphemes[visible_start..visible_end].concat();

    if line.starts_with("### ") {
        return Line::styled(visible, Style::default().fg(THEME.heading3));
    }
    if line.starts_with("## ") {
        return Line::styled(visible, Style::default().fg(THEME.heading2));
    }
    if line.starts_with("# ") {
        return Line::styled(
            visible,
            Style::default()
                .fg(THEME.heading1)
                .add_modifier(Modifier::BOLD),
        );
    }

    let mut spans = Vec::new();
    let mut current = String::new();
    let mut chars_iter = visible.chars().peekable();
    let default_style = Style::default();

    while let Some(ch) = chars_iter.next() {
        match ch {
            '`' => {
                if !current.is_empty() {
                    spans.push(Span::styled(current.clone(), default_style));
                    current.clear();
                }
                let mut code = String::new();
                for c in chars_iter.by_ref() {
                    if c == '`' {
                        break;
                    }
                    code.push(c);
                }
                spans.push(Span::styled(code, Style::default().fg(THEME.code)));
            }
            '*' if chars_iter.peek() == Some(&'*') => {
                chars_iter.next();
                if !current.is_empty() {
                    spans.push(Span::styled(current.clone(), default_style));
                    current.clear();
                }
                let mut bold = String::new();
                loop {
                    match chars_iter.next() {
                        Some('*') if chars_iter.peek() == Some(&'*') => {
                            chars_iter.next();
                            break;
                        }
                        Some(c) => bold.push(c),
                        None => break,
                    }
                }
                spans.push(Span::styled(
                    bold,
                    Style::default().add_modifier(Modifier::BOLD),
                ));
            }
            '[' if chars_iter.peek() == Some(&'[') => {
                chars_iter.next();
                if !current.is_empty() {
                    spans.push(Span::styled(current.clone(), default_style));
                    current.clear();
                }
                let mut link = String::new();
                loop {
                    match chars_iter.next() {
                        Some(']') if chars_iter.peek() == Some(&']') => {
                            chars_iter.next();
                            break;
                        }
                        Some(c) => link.push(c),
                        None => break,
                    }
                }
                spans.push(Span::styled(link, Style::default().fg(THEME.link)));
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        spans.push(Span::styled(current, default_style));
    }

    Line::from(spans)
}

pub fn style_markdown_line_for_test(line: &str, scroll_x: usize, width: usize) -> Line<'static> {
    style_markdown_line(line, scroll_x, width)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_heading_styles() {
        let line = style_markdown_line("# Title", 0, 80);
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn markdown_code_inline() {
        let line = style_markdown_line("Use `foo` here", 0, 80);
        assert!(line.spans.len() >= 3);
    }

    #[test]
    fn horizontal_scroll_grapheme_safe() {
        let line = style_markdown_line("Hello World", 3, 5);
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(text, "lo Wo");
    }

    #[test]
    fn horizontal_scroll_preserves_grapheme_clusters() {
        let line = style_markdown_line("Hi 👨\u{200d}👩\u{200d}👧 end", 3, 5);
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(text, "👨\u{200d}👩\u{200d}👧 end");
    }
}
