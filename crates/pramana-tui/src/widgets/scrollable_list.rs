use crate::theme::THEME;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::widgets::Widget;

#[derive(Default)]
pub struct ScrollableListState {
    pub scroll_offset: usize,
}

impl ScrollableListState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Update scroll offset so that `selected_index` is visible.
    /// Port of the TS useEffect scroll logic from scrollable-list.tsx.
    /// Guards against selectedIndex < 0 (no selection) per issue #57.
    pub fn ensure_visible<F>(
        &mut self,
        selected_index: isize,
        item_count: usize,
        viewport_height: usize,
        item_height: &F,
    ) where
        F: Fn(usize) -> usize,
    {
        if selected_index < 0 {
            return;
        }
        let selected = selected_index as usize;
        if selected >= item_count {
            return;
        }

        let effective_end =
            effective_end_index(self.scroll_offset, item_count, viewport_height, item_height);

        if selected < self.scroll_offset {
            self.scroll_offset = selected;
        } else if selected >= effective_end {
            // Walk backward from selected to find highest offset where it fits
            let sel_height = get_item_height(item_height, selected).max(1);
            let mut consumed = sel_height;
            let mut new_offset = selected;

            while new_offset > 0 {
                let candidate = new_offset - 1;
                let scroll_up_lines = if candidate > 0 { 1 } else { 0 };
                let scroll_down_lines = if selected < item_count - 1 { 1 } else { 0 };
                let limit = viewport_height
                    .saturating_sub(scroll_up_lines)
                    .saturating_sub(scroll_down_lines)
                    .max(1);
                let candidate_height = get_item_height(item_height, candidate).max(1);
                if consumed + candidate_height > limit {
                    break;
                }
                new_offset -= 1;
                consumed += candidate_height;
            }
            self.scroll_offset = new_offset;
        }
    }
}

/// Two-pass viewport calculation from the TS ScrollableList.
/// Pass 1: Calculate end index with scroll-up indicator space.
/// Pass 2: Adjust for scroll-down indicator. (Issue #58)
fn effective_end_index<F>(
    offset: usize,
    item_count: usize,
    viewport_height: usize,
    item_height: &F,
) -> usize
where
    F: Fn(usize) -> usize,
{
    let scroll_up_lines = if offset > 0 { 1 } else { 0 };
    let height_after_up = viewport_height.saturating_sub(scroll_up_lines).max(1);
    let pass1_end = end_index_for_offset(offset, item_count, height_after_up, item_height);
    let scroll_down_lines = if pass1_end < item_count { 1 } else { 0 };
    let effective_height = height_after_up.saturating_sub(scroll_down_lines).max(1);
    end_index_for_offset(offset, item_count, effective_height, item_height)
}

fn end_index_for_offset<F>(
    offset: usize,
    item_count: usize,
    available_height: usize,
    item_height: &F,
) -> usize
where
    F: Fn(usize) -> usize,
{
    let mut consumed = 0usize;
    let mut i = offset;
    while i < item_count {
        let h = get_item_height(item_height, i).max(1);
        if consumed + h > available_height {
            break;
        }
        consumed += h;
        i += 1;
    }
    i
}

/// Clamp item height to >= 1 per issue #61.
fn get_item_height<F>(item_height: &F, index: usize) -> usize
where
    F: Fn(usize) -> usize,
{
    item_height(index).max(1)
}

pub struct ScrollableList<'a> {
    items: &'a [Vec<Line<'a>>],
    selected_index: isize,
    state: &'a ScrollableListState,
    empty_message: &'a str,
}

impl<'a> ScrollableList<'a> {
    pub fn new(
        items: &'a [Vec<Line<'a>>],
        selected_index: isize,
        state: &'a ScrollableListState,
    ) -> Self {
        Self {
            items,
            selected_index,
            state,
            empty_message: "No items",
        }
    }

    pub fn empty_message(mut self, msg: &'a str) -> Self {
        self.empty_message = msg;
        self
    }
}

impl Widget for ScrollableList<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if self.items.is_empty() {
            let line = Line::styled(
                format!("  {}", self.empty_message),
                Style::default().fg(THEME.muted),
            );
            line.render(area, buf);
            return;
        }

        let viewport_height = area.height as usize;
        let item_height_fn =
            |i: usize| -> usize { self.items.get(i).map_or(1, |lines| lines.len().max(1)) };

        let offset = self.state.scroll_offset;
        let end = effective_end_index(offset, self.items.len(), viewport_height, &item_height_fn);

        let show_scroll_up = offset > 0;
        let show_scroll_down = end < self.items.len();

        let mut y = area.y;

        if show_scroll_up {
            let msg = format!(" \u{2191} {} more above", offset);
            let line = Line::styled(msg, Style::default().fg(THEME.muted));
            if y < area.y + area.height {
                line.render(Rect::new(area.x, y, area.width, 1), buf);
                y += 1;
            }
        }

        for (idx_offset, item_lines) in self.items[offset..end].iter().enumerate() {
            let abs_idx = offset + idx_offset;
            let is_selected = self.selected_index >= 0 && abs_idx == self.selected_index as usize;

            for line in item_lines {
                if y >= area.y + area.height {
                    break;
                }
                let styled_line = if is_selected {
                    line.clone()
                        .patch_style(Style::default().fg(THEME.selected_fg).bg(THEME.selected_bg))
                } else {
                    line.clone()
                };
                styled_line.render(Rect::new(area.x, y, area.width, 1), buf);
                y += 1;
            }
        }

        if show_scroll_down && y < area.y + area.height {
            let remaining = self.items.len() - end;
            let msg = format!(" \u{2193} {} more below", remaining);
            let line = Line::styled(msg, Style::default().fg(THEME.muted));
            line.render(Rect::new(area.x, y, area.width, 1), buf);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uniform_height(_: usize) -> usize {
        1
    }

    #[test]
    fn ensure_visible_noop_when_no_selection() {
        let mut state = ScrollableListState::new();
        state.scroll_offset = 5;
        state.ensure_visible(-1, 10, 5, &uniform_height);
        assert_eq!(state.scroll_offset, 5);
    }

    #[test]
    fn ensure_visible_scrolls_up_when_above_viewport() {
        let mut state = ScrollableListState::new();
        state.scroll_offset = 5;
        state.ensure_visible(3, 10, 5, &uniform_height);
        assert_eq!(state.scroll_offset, 3);
    }

    #[test]
    fn ensure_visible_scrolls_down_when_below_viewport() {
        let mut state = ScrollableListState::new();
        state.scroll_offset = 0;
        state.ensure_visible(8, 10, 3, &uniform_height);
        assert!(state.scroll_offset > 0);
        let end = effective_end_index(state.scroll_offset, 10, 3, &uniform_height);
        assert!(8 < end);
    }

    #[test]
    fn effective_end_no_scroll_indicators() {
        let end = effective_end_index(0, 5, 5, &uniform_height);
        assert_eq!(end, 5);
    }

    #[test]
    fn effective_end_reserves_scroll_down_line() {
        let end = effective_end_index(0, 10, 5, &uniform_height);
        assert_eq!(end, 4);
    }

    #[test]
    fn effective_end_reserves_both_indicators() {
        let end = effective_end_index(2, 10, 5, &uniform_height);
        assert_eq!(end, 5);
    }

    #[test]
    fn variable_height_items() {
        let heights = [1, 3, 2, 1, 2];
        let item_h = |i: usize| -> usize { *heights.get(i).unwrap_or(&1) };
        let end = effective_end_index(0, 5, 6, &item_h);
        assert!(end <= 5);
    }

    #[test]
    fn item_height_clamped_to_one() {
        let zero_height = |_: usize| -> usize { 0 };
        let h = get_item_height(&zero_height, 0);
        assert_eq!(h, 1);
    }
}
