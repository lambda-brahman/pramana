use crate::theme::THEME;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Widget};

pub struct HelpOverlay<'a> {
    bindings: &'a [(&'a str, &'a str)],
}

impl<'a> HelpOverlay<'a> {
    pub fn new(bindings: &'a [(&'a str, &'a str)]) -> Self {
        Self { bindings }
    }
}

impl Widget for HelpOverlay<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let width = 40u16.min(area.width.saturating_sub(4));
        let height = (self.bindings.len() as u16 + 4).min(area.height.saturating_sub(2));
        let x = area.x + (area.width.saturating_sub(width)) / 2;
        let y = area.y + (area.height.saturating_sub(height)) / 2;
        let popup_area = Rect::new(x, y, width, height);

        Clear.render(popup_area, buf);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(THEME.border))
            .title(Span::styled(
                " Keybindings ",
                Style::default()
                    .fg(THEME.primary)
                    .add_modifier(Modifier::BOLD),
            ));

        let inner = block.inner(popup_area);
        block.render(popup_area, buf);

        let key_style = Style::default().fg(THEME.hint_key);
        let desc_style = Style::default().fg(THEME.hint_desc);

        let lines: Vec<Line> = self
            .bindings
            .iter()
            .map(|(key, desc)| {
                Line::from(vec![
                    Span::styled(format!("  {key:<12}"), key_style),
                    Span::styled(*desc, desc_style),
                ])
            })
            .collect();

        let [content_area] = Layout::vertical([Constraint::Min(0)]).areas(inner);
        Paragraph::new(lines).render(content_area, buf);
    }
}
