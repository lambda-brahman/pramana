use crate::theme::THEME;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

pub struct Breadcrumb<'a> {
    segments: &'a [String],
}

impl<'a> Breadcrumb<'a> {
    pub fn new(segments: &'a [String]) -> Self {
        Self { segments }
    }
}

impl Widget for Breadcrumb<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let sep_style = Style::default().fg(THEME.muted);
        let seg_style = Style::default().fg(THEME.breadcrumb);

        let mut spans = Vec::new();
        for (i, seg) in self.segments.iter().enumerate() {
            if i > 0 {
                spans.push(Span::styled(" > ", sep_style));
            }
            spans.push(Span::styled(seg.clone(), seg_style));
        }

        Line::from(spans).render(area, buf);
    }
}
