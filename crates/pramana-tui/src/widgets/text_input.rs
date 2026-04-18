use crate::theme::THEME;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

#[derive(Default)]
pub struct TextInputState {
    pub value: String,
    pub cursor: usize,
}

impl TextInputState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, ch: char) {
        let byte_pos = self
            .value
            .char_indices()
            .nth(self.cursor)
            .map(|(i, _)| i)
            .unwrap_or(self.value.len());
        self.value.insert(byte_pos, ch);
        self.cursor += 1;
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            let byte_pos = self
                .value
                .char_indices()
                .nth(self.cursor)
                .map(|(i, _)| i)
                .unwrap_or(self.value.len());
            let next_pos = self
                .value
                .char_indices()
                .nth(self.cursor + 1)
                .map(|(i, _)| i)
                .unwrap_or(self.value.len());
            self.value.replace_range(byte_pos..next_pos, "");
        }
    }

    pub fn clear(&mut self) {
        self.value.clear();
        self.cursor = 0;
    }
}

pub struct TextInput<'a> {
    state: &'a TextInputState,
    focused: bool,
    label: &'a str,
}

impl<'a> TextInput<'a> {
    pub fn new(state: &'a TextInputState, focused: bool) -> Self {
        Self {
            state,
            focused,
            label: "",
        }
    }

    pub fn label(mut self, label: &'a str) -> Self {
        self.label = label;
        self
    }
}

impl Widget for TextInput<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let label_style = Style::default().fg(THEME.primary);
        let input_style = if self.focused {
            Style::default().fg(THEME.accent)
        } else {
            Style::default().fg(THEME.secondary)
        };

        let cursor_char = if self.focused { "\u{2588}" } else { "" };

        let display_value = if self.state.value.is_empty() && !self.focused {
            String::new()
        } else {
            self.state.value.clone()
        };

        let mut spans = Vec::new();
        if !self.label.is_empty() {
            spans.push(Span::styled(format!("{} ", self.label), label_style));
        }
        spans.push(Span::styled(display_value, input_style));
        if self.focused {
            spans.push(Span::styled(cursor_char, input_style));
        }

        Line::from(spans).render(area, buf);
    }
}
