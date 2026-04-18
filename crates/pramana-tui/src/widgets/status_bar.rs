use crate::theme::THEME;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

pub struct StatusBar<'a> {
    view: &'a str,
    tenant: &'a str,
    mode: &'a str,
    depth: usize,
}

impl<'a> StatusBar<'a> {
    pub fn new(view: &'a str, tenant: &'a str, mode: &'a str, depth: usize) -> Self {
        Self {
            view,
            tenant,
            mode,
            depth,
        }
    }
}

impl Widget for StatusBar<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let sep = Style::default().fg(THEME.muted);
        let label = Style::default().fg(THEME.secondary);
        let key_style = Style::default().fg(THEME.hint_key);

        let mut left_spans = vec![
            Span::styled("pramana", label),
            Span::styled(" | ", sep),
            Span::styled(format!("kb:{}", self.tenant), label),
            Span::styled(" | ", sep),
            Span::styled(format!("view:{}", self.view), label),
            Span::styled(" | ", sep),
            Span::styled(format!("mode:{}", self.mode), label),
        ];

        if self.depth > 1 {
            left_spans.push(Span::styled(" | ", sep));
            left_spans.push(Span::styled(format!("depth:{}", self.depth), label));
        }

        let right_text = "[?] help [q] quit";
        let right_start = (area.width as usize).saturating_sub(right_text.len());

        let left_line = Line::from(left_spans);
        left_line.render(area, buf);

        let right_spans = vec![
            Span::styled("[", sep),
            Span::styled("?", key_style),
            Span::styled("] ", sep),
            Span::styled("help ", Style::default().fg(THEME.hint_desc)),
            Span::styled("[", sep),
            Span::styled("q", key_style),
            Span::styled("] ", sep),
            Span::styled("quit", Style::default().fg(THEME.hint_desc)),
        ];
        let right_line = Line::from(right_spans);
        if right_start > 0 {
            right_line.render(
                Rect::new(area.x + right_start as u16, area.y, area.width, 1),
                buf,
            );
        }
    }
}
