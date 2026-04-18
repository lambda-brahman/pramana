use crate::layout::HORIZONTAL_SCROLL_STEP;
use crate::theme::THEME;
use crate::widgets::scrollable_list::{ScrollableList, ScrollableListState};
use crate::widgets::text_input::TextInputState;
use crossterm::event::{KeyCode, KeyEvent};
use pramana_engine::SearchResult;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Widget};
use std::time::Instant;

const DEBOUNCE_MS: u128 = 200;

pub struct SearchView {
    pub input: TextInputState,
    pub results: Vec<SearchResult>,
    pub selected_index: isize,
    pub input_focused: bool,
    pub scroll_x: usize,
    pub loading: bool,
    pub scroll_state: ScrollableListState,
    pub last_input_time: Option<Instant>,
    pub pending_query: Option<String>,
}

impl Default for SearchView {
    fn default() -> Self {
        Self {
            input: TextInputState::new(),
            results: Vec::new(),
            selected_index: -1,
            input_focused: true,
            scroll_x: 0,
            loading: false,
            scroll_state: ScrollableListState::new(),
            last_input_time: None,
            pending_query: None,
        }
    }
}

impl SearchView {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn needs_search(&self) -> bool {
        if let Some(ref pending) = self.pending_query {
            if let Some(t) = self.last_input_time {
                return t.elapsed().as_millis() >= DEBOUNCE_MS && !pending.is_empty();
            }
        }
        false
    }

    pub fn take_pending_query(&mut self) -> Option<String> {
        self.pending_query.take()
    }

    pub fn set_results(&mut self, results: Vec<SearchResult>) {
        self.results = results;
        self.loading = false;
        self.scroll_state = ScrollableListState::new();
    }

    fn schedule_search(&mut self) {
        self.last_input_time = Some(Instant::now());
        self.pending_query = Some(self.input.value.clone());
    }
}

pub enum SearchAction {
    None,
    Back,
    ViewArtifact(String),
}

pub fn handle_search_input(view: &mut SearchView, key: KeyEvent) -> SearchAction {
    if view.input_focused {
        handle_input_mode(view, key)
    } else {
        handle_results_mode(view, key)
    }
}

fn handle_input_mode(view: &mut SearchView, key: KeyEvent) -> SearchAction {
    match key.code {
        KeyCode::Esc => {
            if !view.input.value.is_empty() {
                view.input.clear();
                view.results.clear();
                view.selected_index = -1;
                SearchAction::None
            } else {
                SearchAction::Back
            }
        }
        KeyCode::Down | KeyCode::Enter => {
            if !view.results.is_empty() {
                view.input_focused = false;
                view.selected_index = 0;
                let heights = compute_heights(&view.results);
                let len = heights.len();
                view.scroll_state
                    .ensure_visible(0, len, 20, &|i| heights.get(i).copied().unwrap_or(1));
            }
            SearchAction::None
        }
        KeyCode::Backspace => {
            view.input.backspace();
            view.schedule_search();
            SearchAction::None
        }
        KeyCode::Char(c) => {
            view.input.insert(c);
            view.schedule_search();
            SearchAction::None
        }
        _ => SearchAction::None,
    }
}

fn handle_results_mode(view: &mut SearchView, key: KeyEvent) -> SearchAction {
    match key.code {
        KeyCode::Esc => {
            view.input_focused = true;
            view.selected_index = -1;
            SearchAction::None
        }
        KeyCode::Char('j') | KeyCode::Down => {
            if !view.results.is_empty() {
                let max = view.results.len() as isize - 1;
                view.selected_index = (view.selected_index + 1).min(max);
                let heights = compute_heights(&view.results);
                let len = heights.len();
                view.scroll_state
                    .ensure_visible(view.selected_index, len, 20, &|i| {
                        heights.get(i).copied().unwrap_or(1)
                    });
            }
            SearchAction::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if view.selected_index > 0 {
                view.selected_index -= 1;
                let heights = compute_heights(&view.results);
                let len = heights.len();
                view.scroll_state
                    .ensure_visible(view.selected_index, len, 20, &|i| {
                        heights.get(i).copied().unwrap_or(1)
                    });
            } else {
                view.input_focused = true;
                view.selected_index = -1;
            }
            SearchAction::None
        }
        KeyCode::Char('h') | KeyCode::Left => {
            view.scroll_x = view.scroll_x.saturating_sub(HORIZONTAL_SCROLL_STEP);
            SearchAction::None
        }
        KeyCode::Char('l') | KeyCode::Right => {
            view.scroll_x += HORIZONTAL_SCROLL_STEP;
            SearchAction::None
        }
        KeyCode::Enter => {
            if view.selected_index >= 0 {
                if let Some(r) = view.results.get(view.selected_index as usize) {
                    return SearchAction::ViewArtifact(r.slug.clone());
                }
            }
            SearchAction::None
        }
        _ => SearchAction::None,
    }
}

fn compute_heights(results: &[SearchResult]) -> Vec<usize> {
    results
        .iter()
        .map(|r| if r.snippet.is_empty() { 1 } else { 2 })
        .collect()
}

pub fn render_search(view: &SearchView, area: Rect, buf: &mut Buffer) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(THEME.border))
        .title(Span::styled(
            " Search ",
            Style::default()
                .fg(THEME.primary)
                .add_modifier(Modifier::BOLD),
        ));

    let inner = block.inner(area);
    block.render(area, buf);

    let chunks = Layout::vertical([
        Constraint::Length(1), // input
        Constraint::Length(1), // result count
        Constraint::Min(1),    // results
        Constraint::Length(1), // hints
    ])
    .split(inner);

    // Input line
    let input_style = if view.input_focused {
        Style::default().fg(THEME.accent)
    } else {
        Style::default().fg(THEME.secondary)
    };
    let mut input_spans = vec![
        Span::styled("  Search: ", Style::default().fg(THEME.primary)),
        Span::styled(&view.input.value, input_style),
    ];
    if view.input_focused {
        input_spans.push(Span::styled("\u{2588}", input_style));
    }
    if view.loading {
        input_spans.push(Span::styled(
            "  searching...",
            Style::default().fg(THEME.muted),
        ));
    }
    Line::from(input_spans).render(chunks[0], buf);

    // Result count
    let count_msg = if view.results.is_empty() && !view.input.value.is_empty() && !view.loading {
        "  No results".to_string()
    } else if !view.results.is_empty() {
        format!("  {} results", view.results.len())
    } else {
        String::new()
    };
    Line::styled(count_msg, Style::default().fg(THEME.muted)).render(chunks[1], buf);

    // Results list
    let items: Vec<Vec<Line>> = view
        .results
        .iter()
        .map(|r| {
            let mut lines = vec![Line::from(vec![
                Span::styled(format!("  {} ", r.slug), Style::default().fg(THEME.primary)),
                Span::styled(&r.title, Style::default().fg(THEME.secondary)),
                Span::styled(
                    format!("  (rank: {:.1})", r.rank),
                    Style::default().fg(THEME.muted),
                ),
            ])];
            if !r.snippet.is_empty() {
                let snippet_chars: Vec<char> = r.snippet.chars().collect();
                let start = view.scroll_x.min(snippet_chars.len());
                let end = (view.scroll_x + area.width as usize).min(snippet_chars.len());
                let visible: String = snippet_chars[start..end].iter().collect();
                lines.push(Line::styled(
                    format!("    {visible}"),
                    Style::default().fg(THEME.muted),
                ));
            }
            lines
        })
        .collect();

    let list = ScrollableList::new(&items, view.selected_index, &view.scroll_state)
        .empty_message("Type to search");
    list.render(chunks[2], buf);

    // Hints
    let hints = if view.input_focused {
        "[Enter/\u{2193}] results  [Esc] back"
    } else {
        "[j/k] nav  [h/l] pan  [Enter] view  [Esc] input"
    };
    Line::styled(format!("  {hints}"), Style::default().fg(THEME.hint_desc)).render(chunks[3], buf);
}
