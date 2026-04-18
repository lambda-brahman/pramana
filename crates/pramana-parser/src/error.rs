use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    Frontmatter { message: String },
    Read { message: String },
    Validation { message: String },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Frontmatter { message } => write!(f, "frontmatter: {message}"),
            Self::Read { message } => write!(f, "read: {message}"),
            Self::Validation { message } => write!(f, "validation: {message}"),
        }
    }
}

impl std::error::Error for ParseError {}
