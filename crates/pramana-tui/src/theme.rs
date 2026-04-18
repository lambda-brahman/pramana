use ratatui::style::Color;

pub struct Theme {
    pub primary: Color,
    pub secondary: Color,
    pub accent: Color,
    pub success: Color,
    pub error: Color,
    pub muted: Color,

    pub selected_fg: Color,
    pub selected_bg: Color,

    pub tag: Color,
    pub depends_on: Color,
    pub relates_to: Color,

    pub heading1: Color,
    pub heading2: Color,
    pub heading3: Color,
    pub code: Color,
    pub link: Color,

    pub border: Color,
    pub breadcrumb: Color,
    pub hint_key: Color,
    pub hint_desc: Color,
}

pub const THEME: Theme = Theme {
    primary: Color::Rgb(95, 175, 255),
    secondary: Color::Rgb(128, 128, 128),
    accent: Color::Rgb(255, 215, 95),
    success: Color::Rgb(95, 175, 95),
    error: Color::Rgb(255, 95, 95),
    muted: Color::Rgb(108, 108, 108),

    selected_fg: Color::Rgb(95, 175, 255),
    selected_bg: Color::Rgb(28, 58, 95),

    tag: Color::Rgb(215, 135, 255),
    depends_on: Color::Rgb(255, 95, 95),
    relates_to: Color::Rgb(95, 135, 255),

    heading1: Color::Rgb(95, 175, 255),
    heading2: Color::Rgb(135, 175, 255),
    heading3: Color::Rgb(175, 215, 255),
    code: Color::Rgb(215, 175, 95),
    link: Color::Rgb(95, 135, 255),

    border: Color::Rgb(68, 68, 68),
    breadcrumb: Color::Rgb(128, 128, 128),
    hint_key: Color::Rgb(95, 175, 255),
    hint_desc: Color::Rgb(108, 108, 108),
};
