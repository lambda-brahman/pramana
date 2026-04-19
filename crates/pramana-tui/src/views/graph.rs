use crate::theme::THEME;
use crate::widgets::scrollable_list::{ScrollableList, ScrollableListState};
use crossterm::event::{KeyCode, KeyEvent};
use pramana_engine::ArtifactView;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RelDirection {
    Outbound,
    Inbound,
}

pub struct GraphEntry {
    pub slug: String,
    pub title: String,
    pub kind: String,
    pub direction: RelDirection,
    pub depth_level: usize,
    pub tree_prefix: String,
}

pub struct GraphView {
    pub from_slug: String,
    pub root_title: String,
    pub entries: Vec<GraphEntry>,
    pub selected_index: usize,
    pub depth: usize,
    pub scroll_state: ScrollableListState,
    pub error_message: Option<String>,
    pub last_viewport_height: usize,
}

impl Default for GraphView {
    fn default() -> Self {
        Self {
            from_slug: String::new(),
            root_title: String::new(),
            entries: Vec::new(),
            selected_index: 0,
            depth: 1,
            scroll_state: ScrollableListState::new(),
            error_message: None,
            last_viewport_height: 20,
        }
    }
}

impl GraphView {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_root(&mut self, root: &ArtifactView, traversed: &[ArtifactView]) {
        self.from_slug = root.slug.clone();
        self.root_title = root.title.clone();
        self.error_message = None;
        self.selected_index = 0;
        self.scroll_state = ScrollableListState::new();

        let traversed_map: HashMap<&str, &ArtifactView> =
            traversed.iter().map(|a| (a.slug.as_str(), a)).collect();

        let mut entries = Vec::new();
        let mut visited: HashSet<String> = HashSet::new();
        visited.insert(root.slug.clone());

        let max_depth_level = self.depth.saturating_sub(1);
        build_tree_entries(
            root,
            0,
            max_depth_level,
            "",
            &traversed_map,
            &mut visited,
            &mut entries,
        );

        for rel in &root.inverse_relationships {
            let target_slug = rel.target.split('#').next().unwrap_or(&rel.target);
            if visited.contains(target_slug) {
                continue;
            }
            visited.insert(target_slug.to_owned());
            let title = traversed_map
                .get(target_slug)
                .map(|a| a.title.clone())
                .unwrap_or_else(|| target_slug.to_owned());
            entries.push(GraphEntry {
                slug: target_slug.to_owned(),
                title,
                kind: rel.kind.clone(),
                direction: RelDirection::Inbound,
                depth_level: 0,
                tree_prefix: String::new(),
            });
        }

        self.entries = entries;
    }

    pub fn selected_slug(&self) -> Option<&str> {
        self.entries
            .get(self.selected_index)
            .map(|e| e.slug.as_str())
    }
}

/// Recursively expand outbound relationships in DFS order, building tree_prefix strings
/// using box-drawing characters for depth > 0 levels.
fn build_tree_entries<'a>(
    artifact: &'a ArtifactView,
    depth_level: usize,
    max_depth_level: usize,
    continuation: &str,
    traversed_map: &HashMap<&str, &'a ArtifactView>,
    visited: &mut HashSet<String>,
    entries: &mut Vec<GraphEntry>,
) {
    let children: Vec<(&str, String)> = artifact
        .relationships
        .iter()
        .filter_map(|rel| {
            let slug = rel.target.split('#').next().unwrap_or(&rel.target);
            if visited.contains(slug) {
                None
            } else {
                Some((slug, rel.kind.clone()))
            }
        })
        .collect();

    for (i, (slug, kind)) in children.iter().enumerate() {
        visited.insert(slug.to_string());
        let is_last = i == children.len() - 1;

        let (tree_prefix, child_continuation) = if depth_level == 0 {
            (String::new(), String::new())
        } else {
            let connector = if is_last {
                "\u{2514}\u{2500}"
            } else {
                "\u{251C}\u{2500}"
            };
            let cont_segment = if is_last { "   " } else { "\u{2502}  " };
            (
                format!("{continuation}{connector}"),
                format!("{continuation}{cont_segment}"),
            )
        };

        let title = traversed_map
            .get(*slug)
            .map(|a| a.title.clone())
            .unwrap_or_else(|| slug.to_string());

        entries.push(GraphEntry {
            slug: slug.to_string(),
            title,
            kind: kind.clone(),
            direction: RelDirection::Outbound,
            depth_level,
            tree_prefix,
        });

        if depth_level < max_depth_level {
            if let Some(child_artifact) = traversed_map.get(*slug) {
                build_tree_entries(
                    child_artifact,
                    depth_level + 1,
                    max_depth_level,
                    &child_continuation,
                    traversed_map,
                    visited,
                    entries,
                );
            }
        }
    }
}

pub enum GraphAction {
    None,
    Back,
    NavigateTo(String),
    Reroot(String),
    DepthChanged,
}

pub fn handle_graph_input(view: &mut GraphView, key: KeyEvent) -> GraphAction {
    if view.entries.is_empty() {
        return match key.code {
            KeyCode::Esc | KeyCode::Char('q') => GraphAction::Back,
            _ => GraphAction::None,
        };
    }

    match key.code {
        KeyCode::Esc | KeyCode::Char('q') => GraphAction::Back,
        KeyCode::Char('j') | KeyCode::Down => {
            if view.selected_index < view.entries.len().saturating_sub(1) {
                view.selected_index += 1;
            }
            view.scroll_state.ensure_visible(
                view.selected_index as isize,
                view.entries.len(),
                view.last_viewport_height,
                &|_| 1,
            );
            GraphAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            view.selected_index = view.selected_index.saturating_sub(1);
            view.scroll_state.ensure_visible(
                view.selected_index as isize,
                view.entries.len(),
                view.last_viewport_height,
                &|_| 1,
            );
            GraphAction::None
        }
        KeyCode::Enter => {
            if let Some(slug) = view.selected_slug() {
                GraphAction::NavigateTo(slug.to_owned())
            } else {
                GraphAction::None
            }
        }
        KeyCode::Char('g') => {
            if let Some(slug) = view.selected_slug() {
                GraphAction::Reroot(slug.to_owned())
            } else {
                GraphAction::None
            }
        }
        KeyCode::Char('+') | KeyCode::Char('=') => {
            if view.depth < 5 {
                view.depth += 1;
                GraphAction::DepthChanged
            } else {
                GraphAction::None
            }
        }
        KeyCode::Char('-') => {
            if view.depth > 1 {
                view.depth -= 1;
                GraphAction::DepthChanged
            } else {
                GraphAction::None
            }
        }
        _ => GraphAction::None,
    }
}

pub fn render_graph(view: &mut GraphView, area: Rect, buf: &mut Buffer) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(THEME.border));

    let inner = block.inner(area);
    block.render(area, buf);

    let chunks = Layout::vertical([
        Constraint::Length(1), // title
        Constraint::Length(1), // subtitle (slug + depth)
        Constraint::Length(1), // separator
        Constraint::Min(1),    // entries list
        Constraint::Length(1), // footer
        Constraint::Length(1), // hints
    ])
    .split(inner);

    // Title
    let title = Line::from(vec![Span::styled(
        &view.root_title,
        Style::default()
            .fg(THEME.primary)
            .add_modifier(Modifier::BOLD),
    )]);
    title.render(chunks[0], buf);

    // Subtitle
    let subtitle = Line::from(vec![
        Span::styled("graph: ", Style::default().fg(THEME.muted)),
        Span::styled(&view.from_slug, Style::default().fg(THEME.secondary)),
        Span::styled(
            format!("  depth: {}", view.depth),
            Style::default().fg(THEME.muted),
        ),
    ]);
    subtitle.render(chunks[1], buf);

    // Separator
    let sep = "\u{2500}".repeat(chunks[2].width as usize);
    Line::styled(sep, Style::default().fg(THEME.border)).render(chunks[2], buf);

    // Error message
    if let Some(err) = &view.error_message {
        let msg = Paragraph::new(Line::styled(err.as_str(), Style::default().fg(THEME.error)));
        msg.render(chunks[3], buf);
        return;
    }

    // Entries list
    view.last_viewport_height = chunks[3].height as usize;
    let items: Vec<Vec<Line>> = view
        .entries
        .iter()
        .map(|entry| {
            let (arrow, color) = match entry.direction {
                RelDirection::Outbound => ("\u{2192}", THEME.depends_on),
                RelDirection::Inbound => ("\u{2190}", THEME.relates_to),
            };
            vec![Line::from(vec![
                Span::styled(
                    format!("  {}{arrow} ", entry.tree_prefix),
                    Style::default().fg(color),
                ),
                Span::styled(&entry.slug, Style::default().fg(THEME.primary)),
                Span::styled(
                    format!("  [{}]", entry.kind),
                    Style::default().fg(THEME.muted),
                ),
                Span::styled(
                    format!("  {}", entry.title),
                    Style::default().fg(THEME.secondary),
                ),
            ])]
        })
        .collect();

    let list = ScrollableList::new(&items, view.selected_index as isize, &view.scroll_state)
        .empty_message("No relationships");
    list.render(chunks[3], buf);

    // Footer
    let total = view.entries.len();
    let footer = if total > 0 {
        format!("[{}/{}]", view.selected_index + 1, total)
    } else {
        String::new()
    };
    Line::styled(footer, Style::default().fg(THEME.muted)).render(chunks[4], buf);

    // Hints
    let hints = "[Esc] back [j/k] nav [Enter] detail [g] re-root [+/-] depth";
    Line::styled(hints, Style::default().fg(THEME.hint_desc)).render(chunks[5], buf);
}
