---
slug: lexer
title: Lexer
tags: [concept, parsing]
relationships:
  depends-on: [token-types]
  relates-to: [parser]
---

# Lexer

## Intuitive Overview

The lexer is the interpreter's first point of contact with the outside world. It takes a flat string of characters -- bytes, really -- and carves it into a sequence of [[token-types|tokens]]. Every downstream phase (the parser, the unifier, the resolver) operates on tokens, never on raw text. The lexer is the bouncer at the door: it decides what gets in, what gets rejected, and how everything is labelled.

What does the lexer actually *do*? It scans left to right through the source, one character at a time, making small, local decisions:

- Is this whitespace? Skip it, but remember to count lines and columns.
- Is this `%`? Then everything until the end of the line is a comment. Skip it.
- Is this a lowercase letter? Then it is the start of an atom or a keyword. Keep consuming alphanumeric characters and underscores until the run ends.
- Is this `=`? Then peek ahead: is the next character `:`, `<`, or `\`? If so, consume the multi-character operator. If not, emit a single `=`.

These decisions are small individually, but they accumulate into a complete, unambiguous tokenisation. The lexer's output is a `Vec<Token>` (or a `LexError` if the input is malformed), and every byte of the input is accounted for: either it belongs to a token's span, or it was whitespace or comment. No byte is unclaimed. No byte is double-claimed.

Why is the lexer a separate phase rather than being folded into the parser? Three reasons:

1. **Separation of concerns.** Character-level details (is `=<` one token or two? where does the comment end? is `'it''s'` a valid quoted atom?) are messy and distracting. The parser should think in terms of tokens, not bytes.
2. **Error reporting.** When the user writes `parent('Hello`, the lexer can report "unterminated quoted atom starting at line 1, column 8" with a precise span. If the parser had to deal with raw characters, error messages would be vague.
3. **Testability.** The lexer is a pure function from `&str` to `Result<Vec<Token>, LexError>`. It can be tested exhaustively in isolation, without constructing a parser or an interpreter.

The lexer is the simplest phase of the interpreter pipeline, but it is not trivial. It must handle multi-character operators, quoted atoms with escape sequences, the dot ambiguity (clause terminator vs. decimal point), nested vs. non-nested block comments, and the decision of whether a minus sign belongs to a number or is an operator. Getting these details right here means no downstream phase ever has to worry about them.

## Formal Definition

### The Lexer as a Transducer

**Definition (Lexer).** A *lexer* is a total function:

```
lex : &str -> Result<Vec<Token>, LexError>
```

More precisely, the lexer is a *finite-state transducer* that maps a sequence of characters (the input stream) to a sequence of tokens (the output stream), with the following structure:

- **States**: `Start`, `InAtom`, `InQuotedAtom`, `InVariable`, `InInteger`, `InFloat`, `InLineComment`, `InBlockComment`, `InOperator`.
- **Input alphabet**: The UTF-8 byte stream, interpreted as characters.
- **Output alphabet**: The set of `Token` values defined in [[token-types]].
- **Transition function**: `delta(state, char) -> (state', output?)` -- given the current state and the next input character, produce a new state and optionally emit a token.

The `Start` state is the dispatch hub. Every token recognition begins here. When a token is completed (the run of matching characters ends), the lexer emits the token and returns to `Start`.

### Regular Language Correspondence

Each token kind corresponds to a regular expression:

| Token Kind | Regular Expression |
|---|---|
| Atom (bare) | `[a-z][a-zA-Z0-9_]*` |
| Atom (quoted) | `'([^']|'')*'` |
| Variable (named) | `[A-Z][a-zA-Z0-9_]*` or `_[a-zA-Z0-9_]+` |
| Variable (anonymous) | `_` |
| Integer | `[0-9]+` |
| Float | `[0-9]+\.[0-9]+` |
| Whitespace | `[ \t\r\n]+` |
| Line comment | `%[^\n]*` |
| Block comment | `/\*([^*]|\*[^/])*\*/` |
| Multi-char operators | Finite set: `:-`, `?-`, `=:=`, `=\=`, `\=`, `=<`, `>=` |
| Single-char punctuation | Finite set: `(`, `)`, `[`, `]`, `|`, `,`, `.`, `!`, `=`, `+`, `-`, `*`, `/`, `<`, `>` |

The lexer is a *union* of these regular languages with a priority ordering. When multiple patterns match a prefix of the remaining input, two rules resolve the ambiguity:

1. **Maximal munch**: the longest match wins.
2. **Priority**: if two patterns match the same length, the one with higher priority wins (e.g., `is` matches both `Atom` and the keyword `Is`; the keyword wins).

### The Maximal Munch Principle

**Definition (Maximal Munch).** At each position in the input, the lexer selects the token whose lexeme is the longest prefix of the remaining input that matches any token pattern. Ties are broken by priority.

This is the standard disambiguation strategy for lexical analysis. It ensures determinism: for any input, there is at most one valid tokenisation (if one exists at all).

**Example:** The input `=:=` could be parsed as `=` then `:=` (invalid) or `=:` (invalid) then `=`, or as the single token `ArithEq`. Maximal munch selects the three-character match `=:=`.

### The Partition Property

**Definition (Partition).** A successful tokenisation of input `s` partitions the byte range `[0, len(s))` into:
- Token spans: each byte belongs to exactly one token.
- Whitespace regions: bytes consumed as whitespace.
- Comment regions: bytes consumed as comments.

Every byte is in exactly one of these categories. This is the fundamental correctness invariant of the lexer.

## Algebraic Laws and Invariants

These properties must hold for all inputs. They are stated as testable propositions -- each one should be a property-based test.

### Law 1: Determinism

> For all inputs `s`: `lex(s) == lex(s)`.

The lexer is a pure function. No hidden state, no randomness, no dependency on environment. Given the same input, it always produces the same output.

### Law 2: Partition Completeness

> For all inputs `s` where `lex(s) = Ok(tokens)`: the union of all token spans, whitespace regions, and comment regions covers `[0, len(s))` exactly, with no overlaps.

Formally, let `spans(tokens)` be the set of byte ranges `[t.span.byte_offset, t.span.byte_offset + t.span.byte_length)` for each token `t`. Let `W` be the set of byte ranges consumed as whitespace and `C` the set consumed as comments. Then:

```
spans(tokens) + W + C = [0, len(s))
```

where `+` denotes disjoint union.

### Law 3: Span Consistency

> For all tokens `t` in a successful tokenisation of `s`: `s[t.span.byte_offset .. t.span.byte_offset + t.span.byte_length]` is the lexeme of `t`.

The span always points to the right location in the source. This is the contract that error reporting depends on.

### Law 4: Monotonic Ordering

> For consecutive tokens `t_i` and `t_{i+1}` in a successful tokenisation: `t_i.span.byte_offset + t_i.span.byte_length <= t_{i+1}.span.byte_offset`.

Tokens appear in strictly increasing byte-offset order. The gap between one token's end and the next token's start (if any) is exactly the whitespace or comment between them.

### Law 5: Maximal Munch

> For all inputs `s` and all token boundaries: the selected token is the longest possible match at that position.

This is not directly testable as a universal property, but it generates specific test cases: `=<` must lex as `LessEq`, not `Equals` then `LessThan`. `=:=` must lex as `ArithEq`, not any decomposition. `:-` must lex as `Neck`, not any decomposition.

### Law 6: Weak Roundtrip

> For all inputs `s` where `lex(s) = Ok(tokens)`: concatenating the source slices `s[t.span.byte_offset .. t.span.byte_offset + t.span.byte_length]` for all tokens (excluding `Eof`), interspersed with the whitespace/comment regions, reproduces `s` exactly.

This is the "weak roundtrip" -- it requires retaining whitespace and comment positions. The stronger form (reconstructing `s` from token lexemes alone, without whitespace) holds only if whitespace and comments are also recorded.

### Law 7: EOF Termination

> For all inputs `s` where `lex(s) = Ok(tokens)`: `tokens.last() == Some(Token { kind: Eof, .. })`.

The token stream always ends with an `Eof` token. The parser relies on this as a termination sentinel.

### Invariant L1: Position Tracking Consistency

> After consuming `k` bytes of input, the `(line, col)` position equals the line and column of the `(k+1)`-th byte in the source, counting lines from 1 and columns from 1, where newlines (`\n`) reset the column to 1 and increment the line.

This ensures that span positions are always correct, not just for tokens but at every point during scanning.

## Rust Type Sketch

```rust
/// The lexer: a stateful cursor over source text.
///
/// This struct is consumed by `tokenize()`, which drives it to completion.
/// It can also be used as an iterator for lazy/streaming tokenisation.
pub struct Lexer<'src> {
    /// The full source text. Borrowed for the lexer's lifetime.
    /// All token spans are byte offsets into this string.
    source: &'src str,

    /// Current byte offset into `source`. Always on a UTF-8 character
    /// boundary (ensured by only advancing via `advance()` which reads
    /// a full `char`).
    pos: usize,

    /// Current 1-based line number. Incremented on `\n`.
    line: u32,

    /// Current 1-based column number (byte offset within line, not
    /// codepoint index). Reset to 1 on `\n`, incremented by byte
    /// length of each consumed character otherwise.
    col: u32,
}
```

### Design Rationale

**Why `&'src str` and not `&[u8]`?** Prolog source is text, not arbitrary bytes. Using `&str` gives us UTF-8 validity guarantees from Rust's type system and access to `chars()` for character-level iteration. The byte offset tracking (`pos: usize`) indexes into this string for span construction.

**Why `usize` for `pos` but `u32` for `line`/`col`?** The `pos` field is used to index into the `&str` slice, which requires `usize` on the Rust side. The `line` and `col` fields are stored in `Span` as `u32` (see [[token-types]]), so we use `u32` here for consistency. A source file with more than 4 billion lines is not a realistic scenario.

**Why a struct and not a free function?** The lexer needs mutable state (position, line, column) that evolves across token boundaries. Wrapping this in a struct makes the state explicit and enables both the "batch" API (`tokenize() -> Vec<Token>`) and the "streaming" API (`Iterator`).

**Why not a state-machine enum?** The lexer's states (`Start`, `InAtom`, `InQuotedAtom`, etc.) are implicit in the control flow -- each token recognition is a method call from the main dispatch loop. An explicit state-machine enum is useful for hand-written lexers in languages without closures, but in Rust, method dispatch is cleaner and more readable. The code reads like "if we see a lowercase letter, call `lex_atom()`" rather than "transition to state `InAtom`."

## Operations

### Top-Level Entry Point

```rust
/// Tokenise an entire source string.
///
/// Returns a Vec of tokens ending with Eof, or the first LexError.
/// This is the primary API for batch lexing.
pub fn tokenize(source: &str) -> Result<Vec<Token>, LexError> {
    let lexer = Lexer::new(source);
    lexer.tokenize_all()
}
```

### Lexer Construction

```rust
impl<'src> Lexer<'src> {
    /// Create a new lexer positioned at the start of the source.
    pub fn new(source: &'src str) -> Self {
        Lexer {
            source,
            pos: 0,
            line: 1,
            col: 1,
        }
    }

    /// Consume the lexer and produce all tokens.
    /// Calls `next_token()` repeatedly until Eof or error.
    pub fn tokenize_all(mut self) -> Result<Vec<Token>, LexError> {
        let mut tokens = Vec::new();
        loop {
            let token = self.next_token()?;
            let is_eof = token.kind == TokenKind::Eof;
            tokens.push(token);
            if is_eof {
                break;
            }
        }
        Ok(tokens)
    }
}
```

### Core Scanning Loop

```rust
impl<'src> Lexer<'src> {
    /// Produce the next token, advancing the cursor past it.
    ///
    /// This is the main dispatch function. It skips whitespace and
    /// comments, then examines the current character to decide which
    /// token recognition method to call.
    pub fn next_token(&mut self) -> Result<Token, LexError> {
        self.skip_whitespace_and_comments()?;

        if self.is_at_end() {
            return Ok(self.make_token(TokenKind::Eof, self.pos, 0));
        }

        let ch = self.current_char();

        match ch {
            'a'..='z' => self.lex_atom_or_keyword(),
            'A'..='Z' => self.lex_variable(),
            '_' => self.lex_underscore_variable(),
            '0'..='9' => self.lex_number(),
            '\'' => self.lex_quoted_atom(),
            '(' => self.single_char_token(TokenKind::LParen),
            ')' => self.single_char_token(TokenKind::RParen),
            '[' => self.single_char_token(TokenKind::LBracket),
            ']' => self.single_char_token(TokenKind::RBracket),
            '|' => self.single_char_token(TokenKind::Pipe),
            ',' => self.single_char_token(TokenKind::Comma),
            '!' => self.single_char_token(TokenKind::Cut),
            '+' => self.single_char_token(TokenKind::Plus),
            '*' => self.single_char_token(TokenKind::Star),
            '/' => self.single_char_token(TokenKind::Slash),
            '.' => self.lex_dot(),
            '-' => self.lex_minus(),
            '=' => self.lex_equals(),
            '\\' => self.lex_backslash(),
            ':' => self.lex_colon(),
            '?' => self.lex_question(),
            '<' => self.single_char_token(TokenKind::LessThan),
            '>' => self.lex_greater_than(),
            _ => Err(self.make_error(
                LexErrorKind::UnexpectedCharacter(ch),
                self.pos,
                ch.len_utf8() as u32,
            )),
        }
    }
}
```

### Character-Level Primitives

```rust
impl<'src> Lexer<'src> {
    /// Returns true if the cursor is at or past the end of the source.
    fn is_at_end(&self) -> bool {
        self.pos >= self.source.len()
    }

    /// Returns the character at the current position.
    /// Panics if at end -- callers must check `is_at_end()` first.
    fn current_char(&self) -> char {
        self.source[self.pos..].chars().next().unwrap()
    }

    /// Peek at the character `offset` bytes ahead of the current position.
    /// Returns None if that position is past the end.
    fn peek_ahead(&self, offset: usize) -> Option<char> {
        self.source[self.pos..].get(offset..)?.chars().next()
    }

    /// Advance the cursor by one character, updating line and column.
    /// Returns the consumed character.
    fn advance(&mut self) -> char {
        let ch = self.current_char();
        let byte_len = ch.len_utf8();
        self.pos += byte_len;
        if ch == '\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += byte_len as u32;
        }
        ch
    }

    /// Record the current (line, col, pos) as a snapshot for span
    /// construction. Called at the start of each token.
    fn mark(&self) -> (u32, u32, usize) {
        (self.line, self.col, self.pos)
    }

    /// Build a Token from a kind, a start byte offset, and a byte length.
    fn make_token(&self, kind: TokenKind, start: usize, len: u32) -> Token;

    /// Build a LexError with a span.
    fn make_error(&self, kind: LexErrorKind, start: usize, len: u32) -> LexError;
}
```

### Whitespace and Comment Skipping

```rust
impl<'src> Lexer<'src> {
    /// Skip whitespace and comments until a non-whitespace,
    /// non-comment character (or EOF) is reached.
    ///
    /// Returns Err only if an unterminated block comment is found.
    fn skip_whitespace_and_comments(&mut self) -> Result<(), LexError> {
        loop {
            if self.is_at_end() {
                break;
            }
            let ch = self.current_char();
            match ch {
                ' ' | '\t' | '\r' | '\n' => {
                    self.advance();
                }
                '%' => {
                    self.skip_line_comment();
                }
                '/' if self.peek_ahead(1) == Some('*') => {
                    self.skip_block_comment()?;
                }
                _ => break,
            }
        }
        Ok(())
    }

    /// Skip from `%` to end of line (not consuming the newline).
    fn skip_line_comment(&mut self) {
        while !self.is_at_end() && self.current_char() != '\n' {
            self.advance();
        }
    }

    /// Skip from `/*` to `*/`. Does not nest (ISO Prolog behavior).
    /// Returns Err(LexError::UnterminatedBlockComment) if `*/` is
    /// not found before EOF.
    fn skip_block_comment(&mut self) -> Result<(), LexError> {
        let start = self.pos;
        self.advance(); // consume '/'
        self.advance(); // consume '*'
        loop {
            if self.is_at_end() {
                return Err(self.make_error(
                    LexErrorKind::UnterminatedBlockComment,
                    start,
                    (self.pos - start) as u32,
                ));
            }
            if self.current_char() == '*' && self.peek_ahead(1) == Some('/') {
                self.advance(); // consume '*'
                self.advance(); // consume '/'
                return Ok(());
            }
            self.advance();
        }
    }
}
```

### Token Recognition Methods

Each method below corresponds to one branch of the dispatch `match` in `next_token()`. They are documented with their recognition logic and the regular expression they implement.

```rust
impl<'src> Lexer<'src> {
    /// Recognise a bare atom or keyword.
    ///
    /// Pattern: [a-z][a-zA-Z0-9_]*
    /// After consuming the full identifier, check if it is a keyword
    /// (`is` or `mod`). If so, emit the keyword token; otherwise
    /// emit Atom(name).
    fn lex_atom_or_keyword(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        let mut name = String::new();
        while !self.is_at_end() && self.current_char().is_ascii_alphanumeric()
            || (!self.is_at_end() && self.current_char() == '_')
        {
            name.push(self.advance());
        }
        let len = (self.pos - start_pos) as u32;
        let kind = match name.as_str() {
            "is" => TokenKind::Is,
            "mod" => TokenKind::Mod,
            _ => TokenKind::Atom(name),
        };
        Ok(Token {
            kind,
            span: Span {
                line: start_line,
                column: start_col,
                byte_offset: start_pos as u32,
                byte_length: len,
            },
        })
    }

    /// Recognise a quoted atom.
    ///
    /// Pattern: '([^']|'')*'
    /// Opening quote is consumed. Characters are collected until a
    /// closing (non-doubled) quote is found. Doubled quotes '' are
    /// unescaped to a single '. If EOF is reached before the closing
    /// quote, return LexError::UnterminatedQuotedAtom.
    fn lex_quoted_atom(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume opening '
        let mut content = String::new();
        loop {
            if self.is_at_end() {
                return Err(LexError {
                    kind: LexErrorKind::UnterminatedQuotedAtom,
                    span: Span {
                        line: start_line,
                        column: start_col,
                        byte_offset: start_pos as u32,
                        byte_length: (self.pos - start_pos) as u32,
                    },
                });
            }
            let ch = self.advance();
            if ch == '\'' {
                // Check for doubled quote escape
                if !self.is_at_end() && self.current_char() == '\'' {
                    self.advance(); // consume second '
                    content.push('\'');
                } else {
                    // End of quoted atom
                    break;
                }
            } else {
                content.push(ch);
            }
        }
        let len = (self.pos - start_pos) as u32;
        Ok(Token {
            kind: TokenKind::Atom(content),
            span: Span {
                line: start_line,
                column: start_col,
                byte_offset: start_pos as u32,
                byte_length: len,
            },
        })
    }

    /// Recognise a named variable.
    ///
    /// Pattern: [A-Z][a-zA-Z0-9_]*
    fn lex_variable(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        let mut name = String::new();
        while !self.is_at_end()
            && (self.current_char().is_ascii_alphanumeric()
                || self.current_char() == '_')
        {
            name.push(self.advance());
        }
        let len = (self.pos - start_pos) as u32;
        Ok(Token {
            kind: TokenKind::Variable(name),
            span: Span {
                line: start_line,
                column: start_col,
                byte_offset: start_pos as u32,
                byte_length: len,
            },
        })
    }

    /// Recognise an anonymous or named underscore-prefixed variable.
    ///
    /// If `_` is followed by [a-zA-Z0-9_], it is a named variable
    /// (e.g., `_hidden`). If `_` stands alone, it is AnonymousVariable.
    fn lex_underscore_variable(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '_'
        if !self.is_at_end()
            && (self.current_char().is_ascii_alphanumeric()
                || self.current_char() == '_')
        {
            // Named underscore variable: _foo, _Bar, __x, etc.
            let mut name = String::from("_");
            while !self.is_at_end()
                && (self.current_char().is_ascii_alphanumeric()
                    || self.current_char() == '_')
            {
                name.push(self.advance());
            }
            let len = (self.pos - start_pos) as u32;
            Ok(Token {
                kind: TokenKind::Variable(name),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: len,
                },
            })
        } else {
            // Anonymous variable: just _
            Ok(Token {
                kind: TokenKind::AnonymousVariable,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Recognise an integer or float literal.
    ///
    /// Pattern: [0-9]+ ('.' [0-9]+)?
    /// The minus sign is NOT consumed here -- it is always a separate
    /// Minus token. The parser handles negation.
    ///
    /// The dot ambiguity is resolved here: if digits are followed by
    /// '.' which is followed by more digits, it is a float. If '.'
    /// is followed by whitespace or EOF, the digits are an integer
    /// and the '.' is left for the main loop to handle as a Dot
    /// (clause terminator).
    fn lex_number(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        // Consume integer part
        while !self.is_at_end() && self.current_char().is_ascii_digit() {
            self.advance();
        }
        // Check for decimal point followed by digits (float)
        if !self.is_at_end()
            && self.current_char() == '.'
            && self.peek_ahead(1).map_or(false, |c| c.is_ascii_digit())
        {
            self.advance(); // consume '.'
            while !self.is_at_end() && self.current_char().is_ascii_digit() {
                self.advance();
            }
            let lexeme = &self.source[start_pos..self.pos];
            let value: f64 = lexeme.parse().map_err(|_| LexError {
                kind: LexErrorKind::NumericOverflow,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: (self.pos - start_pos) as u32,
                },
            })?;
            Ok(Token {
                kind: TokenKind::Float(value),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: (self.pos - start_pos) as u32,
                },
            })
        } else {
            let lexeme = &self.source[start_pos..self.pos];
            let value: i64 = lexeme.parse().map_err(|_| LexError {
                kind: LexErrorKind::NumericOverflow,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: (self.pos - start_pos) as u32,
                },
            })?;
            Ok(Token {
                kind: TokenKind::Integer(value),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: (self.pos - start_pos) as u32,
                },
            })
        }
    }

    /// Recognise the dot token (clause terminator).
    ///
    /// The dot is only valid as a clause terminator if followed by
    /// whitespace, EOF, or '%' (start of a line comment). Otherwise,
    /// it is ambiguous. Note: the case where '.' is part of a float
    /// (preceded by digits, followed by digits) is handled in
    /// `lex_number()`, which consumes the '.' before control reaches
    /// here.
    fn lex_dot(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '.'
        // Check that dot is followed by whitespace, EOF, or comment
        if self.is_at_end() {
            Ok(Token {
                kind: TokenKind::Dot,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        } else {
            let next = self.current_char();
            if next.is_ascii_whitespace() || next == '%' {
                Ok(Token {
                    kind: TokenKind::Dot,
                    span: Span {
                        line: start_line,
                        column: start_col,
                        byte_offset: start_pos as u32,
                        byte_length: 1,
                    },
                })
            } else {
                Err(LexError {
                    kind: LexErrorKind::AmbiguousDot,
                    span: Span {
                        line: start_line,
                        column: start_col,
                        byte_offset: start_pos as u32,
                        byte_length: 1,
                    },
                })
            }
        }
    }
}
```

### Operator Recognition Methods

```rust
impl<'src> Lexer<'src> {
    /// Recognise '-' as Minus token, or ':-' is handled via lex_colon.
    /// The minus is always a standalone operator -- never part of a
    /// number literal.
    fn lex_minus(&mut self) -> Result<Token, LexError> {
        self.single_char_token(TokenKind::Minus)
    }

    /// Recognise '=' or '=<' or '=:=' or '=\=' (maximal munch).
    fn lex_equals(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '='
        if !self.is_at_end() {
            match self.current_char() {
                '<' => {
                    self.advance(); // consume '<'
                    Ok(Token {
                        kind: TokenKind::LessEq,
                        span: Span {
                            line: start_line,
                            column: start_col,
                            byte_offset: start_pos as u32,
                            byte_length: 2,
                        },
                    })
                }
                ':' => {
                    // Potential =:=
                    if self.peek_ahead(1) == Some('=') {
                        self.advance(); // consume ':'
                        self.advance(); // consume '='
                        Ok(Token {
                            kind: TokenKind::ArithEq,
                            span: Span {
                                line: start_line,
                                column: start_col,
                                byte_offset: start_pos as u32,
                                byte_length: 3,
                            },
                        })
                    } else {
                        // Just '=', the ':' is not part of this token
                        Ok(Token {
                            kind: TokenKind::Equals,
                            span: Span {
                                line: start_line,
                                column: start_col,
                                byte_offset: start_pos as u32,
                                byte_length: 1,
                            },
                        })
                    }
                }
                '\\' => {
                    // Potential =\=
                    if self.peek_ahead(1) == Some('=') {
                        self.advance(); // consume '\'
                        self.advance(); // consume '='
                        Ok(Token {
                            kind: TokenKind::ArithNeq,
                            span: Span {
                                line: start_line,
                                column: start_col,
                                byte_offset: start_pos as u32,
                                byte_length: 3,
                            },
                        })
                    } else {
                        // Just '='
                        Ok(Token {
                            kind: TokenKind::Equals,
                            span: Span {
                                line: start_line,
                                column: start_col,
                                byte_offset: start_pos as u32,
                                byte_length: 1,
                            },
                        })
                    }
                }
                _ => {
                    Ok(Token {
                        kind: TokenKind::Equals,
                        span: Span {
                            line: start_line,
                            column: start_col,
                            byte_offset: start_pos as u32,
                            byte_length: 1,
                        },
                    })
                }
            }
        } else {
            Ok(Token {
                kind: TokenKind::Equals,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Recognise '\=' (NotUnifiable) or error on bare '\'.
    fn lex_backslash(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '\'
        if !self.is_at_end() && self.current_char() == '=' {
            self.advance(); // consume '='
            Ok(Token {
                kind: TokenKind::NotUnifiable,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 2,
                },
            })
        } else {
            Err(LexError {
                kind: LexErrorKind::UnexpectedCharacter('\\'),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Recognise ':-' (Neck) or error on bare ':'.
    fn lex_colon(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume ':'
        if !self.is_at_end() && self.current_char() == '-' {
            self.advance(); // consume '-'
            Ok(Token {
                kind: TokenKind::Neck,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 2,
                },
            })
        } else {
            Err(LexError {
                kind: LexErrorKind::UnexpectedCharacter(':'),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Recognise '?-' (Query) or error on bare '?'.
    fn lex_question(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '?'
        if !self.is_at_end() && self.current_char() == '-' {
            self.advance(); // consume '-'
            Ok(Token {
                kind: TokenKind::Query,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 2,
                },
            })
        } else {
            Err(LexError {
                kind: LexErrorKind::UnexpectedCharacter('?'),
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Recognise '>' or '>=' (maximal munch).
    fn lex_greater_than(&mut self) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance(); // consume '>'
        if !self.is_at_end() && self.current_char() == '=' {
            self.advance(); // consume '='
            Ok(Token {
                kind: TokenKind::GreaterEq,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 2,
                },
            })
        } else {
            Ok(Token {
                kind: TokenKind::GreaterThan,
                span: Span {
                    line: start_line,
                    column: start_col,
                    byte_offset: start_pos as u32,
                    byte_length: 1,
                },
            })
        }
    }

    /// Emit a single-character token and advance by one.
    fn single_char_token(&mut self, kind: TokenKind) -> Result<Token, LexError> {
        let (start_line, start_col, start_pos) = self.mark();
        self.advance();
        Ok(Token {
            kind,
            span: Span {
                line: start_line,
                column: start_col,
                byte_offset: start_pos as u32,
                byte_length: 1,
            },
        })
    }
}
```

### Iterator Implementation

```rust
/// The lexer can be used as a streaming iterator over tokens.
/// Each call to `next()` produces one token. The iterator terminates
/// after yielding Eof (returns None on subsequent calls) or on the
/// first error (returns Some(Err(...))).
impl<'src> Iterator for Lexer<'src> {
    type Item = Result<Token, LexError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.is_at_end() && self.pos > 0 {
            // Already emitted Eof on a previous call
            // (This check is imprecise -- a more robust approach
            // uses a `done: bool` field. Shown here for simplicity.)
            return None;
        }
        let result = self.next_token();
        match &result {
            Ok(token) if token.kind == TokenKind::Eof => Some(result),
            Ok(_) => Some(result),
            Err(_) => Some(result),
        }
    }
}
```

## The Scanning Algorithm

### Control Flow Diagram

```
                    +-------+
                    | Start |
                    +---+---+
                        |
               skip_whitespace_and_comments()
                        |
                  is_at_end()?
                   /         \
                 yes          no
                  |            |
              emit Eof    current_char()?
                           /  |  |  |  \
                      a-z  A-Z  _  0-9  '  punctuation  other
                       |    |   |   |   |      |           |
                  lex_atom  |   |  lex  lex    |       UnexpectedChar
                  _or_kw    |   | _num _quoted |         error
                            |   |  ber  _atom  |
                       lex_var  |         lex_operator_or_punct
                                |              |
                        lex_underscore    (dispatch on char:
                        _variable          =  \  :  ?  >  .  -
                                           and single-char)
```

### Complexity

| Aspect | Bound | Explanation |
|---|---|---|
| Time (total) | O(n) | Each byte is examined at most twice: once in the main scan, once in a lookahead. No backtracking. |
| Time (per token) | O(k) where k = lexeme length | Each token recognition method scans exactly the characters in its lexeme plus at most one lookahead character. |
| Space (output) | O(t) where t = number of tokens | One `Token` per output token. Typical ratio: t ~ n/4 (average token length ~4 bytes). |
| Space (working) | O(1) beyond the output Vec | The lexer uses a fixed number of local variables. No recursion, no auxiliary data structures. |

The lexer is *single-pass*: it never revisits a character it has already consumed. The `peek_ahead()` calls are non-consuming -- they read without advancing. The total work is bounded by `n + L` where `n` is the input length and `L` is the total number of lookahead peeks (at most `n` peeks, since each lookahead covers at most a constant number of bytes ahead).

## Edge Cases

### 1. Empty Input

```
Input:  ""
Output: [Eof]
```

The lexer starts, finds `is_at_end()` is true immediately, and emits `Eof` with span `(line: 1, col: 1, byte_offset: 0, byte_length: 0)`.

### 2. Whitespace-Only Input

```
Input:  "   \n\t  \n"
Output: [Eof]
```

All characters are consumed by `skip_whitespace_and_comments()`. Then `is_at_end()` is true, and `Eof` is emitted. The Eof span points to the position past the last whitespace character.

### 3. Comment-Only Input

```
Input:  "% this is a comment\n/* and another */\n"
Output: [Eof]
```

Both comments and the whitespace are consumed. Only `Eof` remains.

### 4. Unterminated Quoted Atom

```
Input:  "parent('Hello"
Output: Err(LexError { kind: UnterminatedQuotedAtom, span: (1, 8, 7, 6) })
```

The lexer successfully tokenises `parent` and `(`, then enters `lex_quoted_atom()` at the `'`. It consumes `Hello` but reaches EOF without finding a closing quote. The error span covers from the opening `'` (byte 7) to the end of the input (byte 13), length 6.

### 5. Unterminated Block Comment

```
Input:  "foo /* this never ends"
Output: Err(LexError { kind: UnterminatedBlockComment, span: (1, 5, 4, 18) })
```

The lexer tokenises `foo`, then enters `skip_block_comment()` and scans to EOF without finding `*/`. The error span covers the entire block comment region from `/*` to EOF.

### 6. The Dot Ambiguity

```
Input:  "3.14"     -> [Float(3.14), Eof]
Input:  "a."       -> error (dot not followed by whitespace)
Input:  "a. "      -> [Atom("a"), Dot, Eof]
Input:  "a.\n"     -> [Atom("a"), Dot, Eof]
Input:  "a.%end"   -> [Atom("a"), Dot, Eof]    (comment after dot is ok)
Input:  "a.b"      -> [Atom("a"), Err(AmbiguousDot)]
```

The critical distinction: in `3.14`, the dot is consumed by `lex_number()` (digits before and after), so `lex_dot()` is never called. In `a.b`, the dot is consumed by `lex_dot()`, which checks the next character and finds `b` -- not whitespace, not EOF, not `%` -- so it reports `AmbiguousDot`.

### 7. Operator Maximal Munch

```
Input:  "=:="     -> [ArithEq, Eof]
Input:  "=:a"     -> [Equals, Err(UnexpectedCharacter(':'))]  (but see below)
Input:  "=\="     -> [ArithNeq, Eof]
Input:  "=<"      -> [LessEq, Eof]
Input:  ">="      -> [GreaterEq, Eof]
Input:  "\="      -> [NotUnifiable, Eof]
Input:  ":-"      -> [Neck, Eof]
Input:  "?-"      -> [Query, Eof]
```

Wait -- `=:a` is interesting. The lexer enters `lex_equals()`, consumes `=`, sees `:`, peeks ahead and sees `a` (not `=`). So the `:` is not consumed -- the lexer emits `Equals` for just the `=`. Control returns to the main loop, which dispatches on `:` via `lex_colon()`. `lex_colon()` consumes `:`, expects `-`, finds `a` instead, and reports `UnexpectedCharacter(':')`. Actually let me reconsider: the correct output is `[Equals, Err(UnexpectedCharacter(':'))]`. The `=` is successfully emitted, then the `:` fails.

### 8. Adjacent Operators Without Whitespace

```
Input:  "=:==<"     -> [ArithEq, LessEq, Eof]
Input:  ">=<"       -> [GreaterEq, LessThan, Eof]
Input:  "\=\="      -> [NotUnifiable, NotUnifiable, Eof]
Input:  ":-?-"      -> [Neck, Query, Eof]
```

The lexer does not require whitespace between operators. It greedily consumes the longest match, then the next longest, and so on.

### 9. Keywords in Unexpected Positions

```
Input:  "is"        -> [Is, Eof]
Input:  "mod"       -> [Mod, Eof]
Input:  "island"    -> [Atom("island"), Eof]     (not Is + "land")
Input:  "modify"    -> [Atom("modify"), Eof]     (not Mod + "ify")
Input:  "'is'"      -> [Atom("is"), Eof]         (quoted: always atom)
Input:  "'mod'"     -> [Atom("mod"), Eof]
```

Maximal munch prevents `is` from being extracted from `island`. The keyword check happens *after* consuming the full `[a-z][a-zA-Z0-9_]*` run. Since `island` is a complete identifier, it is checked against the keyword table and does not match.

### 10. Negative Numbers

```
Input:  "-7"        -> [Minus, Integer(7), Eof]
Input:  "f(-7)"     -> [Atom("f"), LParen, Minus, Integer(7), RParen, Eof]
Input:  "3-2"       -> [Integer(3), Minus, Integer(2), Eof]
```

The minus sign is always a standalone `Minus` token. The parser handles arithmetic negation semantically. This avoids the context-sensitivity that would be required to distinguish "negative number literal" from "subtraction operator."

### 11. Escaped Quotes in Quoted Atoms

```
Input:  "'it''s'"     -> [Atom("it's"), Eof]
Input:  "''''''"      -> [Atom("''"), Eof]    (three pairs of doubled quotes: empty + '' + empty = "''" ... wait)
```

Let me trace `''''''` carefully. The lexer sees:
1. Opening `'` (consumed, not part of content)
2. `''` -- doubled quote, push one `'` to content
3. `''` -- doubled quote, push one `'` to content
4. `'` -- closing quote (not followed by another `'`)

Content: `''` (two single-quote characters). So `'''''' ` lexes as `Atom("''")`.

### 12. Numeric Overflow

```
Input:  "99999999999999999999"
Output: Err(LexError { kind: NumericOverflow, span: ... })
```

The string `99999999999999999999` exceeds the range of `i64` (max ~9.2 * 10^18). The `str::parse::<i64>()` call fails, and the lexer maps the parse error to `LexError::NumericOverflow` with a span covering the entire digit sequence.

### 13. Unicode in Source

```
Input:  "'cafe\u0301'"  -> [Atom("cafe\u0301"), Eof]      (e + combining accent)
Input:  "'caf\u00e9'"   -> [Atom("caf\u00e9"), Eof]       (precomposed e-acute)
```

These are *distinct* atoms. The lexer preserves bytes verbatim. No Unicode normalisation is performed. Byte-level span tracking handles multi-byte characters correctly because `advance()` increments `pos` by `ch.len_utf8()`.

### 14. Multiple Clauses

```
Input:  "a. b. c."
Output: [Atom("a"), Dot, Atom("b"), Dot, Atom("c"), Dot, Eof]
```

Each dot is followed by whitespace (spaces between clauses) so all three are valid clause terminators.

### 15. Bare ':' or '?' Without Following '-'

```
Input:  ":"   -> Err(UnexpectedCharacter(':'))
Input:  "?"   -> Err(UnexpectedCharacter('?'))
Input:  ":\n" -> Err(UnexpectedCharacter(':'))
```

These characters are not valid token starts on their own. They only appear as the first character of multi-character operators `:-` and `?-`. If the expected second character is missing, the lexer reports an error.

## Relationships

### Depends On: [[token-types]]

The lexer's entire purpose is to produce values of types defined in [[token-types]]: `Token`, `TokenKind`, `Span`, `LexError`, and `LexErrorKind`. The token types artifact defines *what* the lexer produces; this artifact defines *how* it produces it.

The dependency is strict: every `TokenKind` variant must be producible by some code path in the lexer, and every token the lexer emits must be a valid `TokenKind`. If a new token kind is added to [[token-types]] (e.g., a string literal type), the lexer must be extended with a corresponding recognition method. If a token kind is removed, the lexer code path that produces it becomes dead code.

### Relates To: [[parser]]

The parser is the lexer's sole consumer. The contract between them is the `Vec<Token>` (or the `Iterator<Item = Result<Token, LexError>>` in streaming mode). The parser drives the token stream forward, pattern-matching on `TokenKind` to recognise grammar productions.

Key interface constraints:
- The parser expects the token stream to end with exactly one `Eof` token.
- The parser never needs to look at raw source text -- it uses `TokenKind` payloads (the `String` in `Atom(String)`, the `i64` in `Integer(i64)`, etc.).
- The parser uses `Span` values from tokens for error messages. The Span Consistency Law (Law 3) is the parser's guarantee that spans are trustworthy.
- The parser may need multi-token lookahead (e.g., to distinguish a fact from a rule, it must look past the head to see if `:-` follows). This is a parser concern, not a lexer concern -- the lexer produces tokens one at a time or all at once; it does not buffer or provide random access.

### Relates To: [[term]]

The lexer does not directly produce [[term|terms]]. It produces tokens that the parser will later assemble into terms. However, the lexer's design decisions affect term construction:

- Atom interning happens in the parser or a shared `AtomTable`, not in the lexer. The lexer produces `Atom(String)`, which the parser converts to `Atom(InternedAtom)` via the `AtomTable`.
- Variable naming: the lexer preserves variable names as strings (`Variable("X")`). The parser maps these to `VarId` values within each clause scope.
- Number parsing: the lexer parses numeric literals into `i64`/`f64` so that the parser can directly construct `TermNode::Number` values.

## Examples

### Example 1: Simple Fact

**Input:**
```prolog
parent(tom, bob).
```

**Trace of lexer execution:**

| Step | State | pos | char | Action | Emitted |
|------|-------|-----|------|--------|---------|
| 1 | Start | 0 | `p` | dispatch to lex_atom_or_keyword | -- |
| 2 | InAtom | 0-5 | `parent` | consume [a-z]+ run | Atom("parent") |
| 3 | Start | 6 | `(` | single_char_token | LParen |
| 4 | Start | 7 | `t` | dispatch to lex_atom_or_keyword | -- |
| 5 | InAtom | 7-9 | `tom` | consume [a-z]+ run | Atom("tom") |
| 6 | Start | 10 | `,` | single_char_token | Comma |
| 7 | Start | 11 | ` ` | skip_whitespace | -- |
| 8 | Start | 12 | `b` | dispatch to lex_atom_or_keyword | -- |
| 9 | InAtom | 12-14 | `bob` | consume [a-z]+ run | Atom("bob") |
| 10 | Start | 15 | `)` | single_char_token | RParen |
| 11 | Start | 16 | `.` | lex_dot, next is `\n` (whitespace) | Dot |
| 12 | Start | 17 | `\n` | skip_whitespace, then is_at_end | Eof |

**Output:**
```
[Atom("parent"), LParen, Atom("tom"), Comma, Atom("bob"), RParen, Dot, Eof]
```

### Example 2: Rule with Variables

**Input:**
```prolog
ancestor(X, Y) :- parent(X, Y).
```

**Output:**
```
[Atom("ancestor"), LParen, Variable("X"), Comma, Variable("Y"), RParen,
 Neck, Atom("parent"), LParen, Variable("X"), Comma, Variable("Y"),
 RParen, Dot, Eof]
```

Key observations:
- `:-` is consumed as a single `Neck` token in `lex_colon()`. The space before `:-` is whitespace. The space after is whitespace.
- `X` and `Y` each appear twice. The lexer produces `Variable("X")` each time -- these are string-equal but independent tokens. The parser will map them to shared `VarId` values within the clause scope.

### Example 3: Query

**Input:**
```prolog
?- ancestor(Who, bob).
```

**Output:**
```
[Query, Atom("ancestor"), LParen, Variable("Who"), Comma,
 Atom("bob"), RParen, Dot, Eof]
```

Key observations:
- `?-` is consumed as a single `Query` token.
- `Who` starts with an uppercase letter, so it is a `Variable`.
- `bob` starts with a lowercase letter, so it is an `Atom`.

### Example 4: Arithmetic with Keywords

**Input:**
```prolog
factorial(0, 1).
factorial(N, F) :-
    N > 0,
    N1 is N - 1,
    factorial(N1, F1),
    F is F1 * N.
```

**Output (abbreviated):**
```
Atom("factorial") LParen Integer(0) Comma Integer(1) RParen Dot
Atom("factorial") LParen Variable("N") Comma Variable("F") RParen Neck
Variable("N") GreaterThan Integer(0) Comma
Variable("N1") Is Variable("N") Minus Integer(1) Comma
Atom("factorial") LParen Variable("N1") Comma Variable("F1") RParen Comma
Variable("F") Is Variable("F1") Star Variable("N") Dot
Eof
```

Key observations:
- `is` is lexed as `Is` (keyword), not `Atom("is")`.
- `N1` starts with uppercase, so it is `Variable("N1")`. The digit is part of the identifier run `[a-zA-Z0-9_]*`.
- `0` and `1` are `Integer` tokens. The minus in `N - 1` is `Minus`, not part of the integer.
- All indentation (four spaces) is consumed as whitespace and does not appear in the token stream.

### Example 5: Lists and Pipe

**Input:**
```prolog
?- append([1, 2], [3 | X], Result).
```

**Output:**
```
Query Atom("append") LParen
LBracket Integer(1) Comma Integer(2) RBracket Comma
LBracket Integer(3) Pipe Variable("X") RBracket Comma
Variable("Result") RParen Dot Eof
```

### Example 6: Quoted Atoms with Escapes

**Input:**
```prolog
greet('it''s a beautiful day').
```

**Output:**
```
[Atom("greet"), LParen, Atom("it's a beautiful day"), RParen, Dot, Eof]
```

The doubled `''` in the source is unescaped to a single `'` in the atom content. The outer quotes are stripped. The content includes spaces and mixed case because it is quoted.

### Example 7: All Comparison Operators

**Input:**
```prolog
X =:= Y, A =\= B, C =< D, E >= F, G \= H, I < J, K > L.
```

**Output:**
```
Variable("X") ArithEq Variable("Y") Comma
Variable("A") ArithNeq Variable("B") Comma
Variable("C") LessEq Variable("D") Comma
Variable("E") GreaterEq Variable("F") Comma
Variable("G") NotUnifiable Variable("H") Comma
Variable("I") LessThan Variable("J") Comma
Variable("K") GreaterThan Variable("L") Dot Eof
```

Every multi-character operator is consumed as a single token. The maximal munch principle ensures `=:=` is not split into `=` and `:=` or `=:` and `=`.

### Example 8: Comments Interleaved

**Input:**
```prolog
% facts about parenthood
parent(tom, bob). /* Tom is Bob's parent */
parent(bob, ann). % another fact
```

**Output:**
```
Atom("parent") LParen Atom("tom") Comma Atom("bob") RParen Dot
Atom("parent") LParen Atom("bob") Comma Atom("ann") RParen Dot
Eof
```

Both comment styles are consumed and discarded. They do not appear in the token stream.

## Appendix A: State Transition Table

The full state machine for the lexer's `Start` dispatch. Given the current character, the lexer transitions to a recognition method and eventually returns to `Start`.

| Current Char | Method Called | Possible Tokens |
|---|---|---|
| `a`-`z` | `lex_atom_or_keyword()` | `Atom(s)`, `Is`, `Mod` |
| `A`-`Z` | `lex_variable()` | `Variable(s)` |
| `_` | `lex_underscore_variable()` | `Variable(s)`, `AnonymousVariable` |
| `0`-`9` | `lex_number()` | `Integer(n)`, `Float(f)` |
| `'` | `lex_quoted_atom()` | `Atom(s)` or `LexError::UnterminatedQuotedAtom` |
| `(` | `single_char_token(LParen)` | `LParen` |
| `)` | `single_char_token(RParen)` | `RParen` |
| `[` | `single_char_token(LBracket)` | `LBracket` |
| `]` | `single_char_token(RBracket)` | `RBracket` |
| `\|` | `single_char_token(Pipe)` | `Pipe` |
| `,` | `single_char_token(Comma)` | `Comma` |
| `!` | `single_char_token(Cut)` | `Cut` |
| `+` | `single_char_token(Plus)` | `Plus` |
| `*` | `single_char_token(Star)` | `Star` |
| `/` | `single_char_token(Slash)` | `Slash` |
| `.` | `lex_dot()` | `Dot` or `LexError::AmbiguousDot` |
| `-` | `lex_minus()` | `Minus` |
| `=` | `lex_equals()` | `Equals`, `LessEq`, `ArithEq`, `ArithNeq` |
| `\` | `lex_backslash()` | `NotUnifiable` or `LexError::UnexpectedCharacter` |
| `:` | `lex_colon()` | `Neck` or `LexError::UnexpectedCharacter` |
| `?` | `lex_question()` | `Query` or `LexError::UnexpectedCharacter` |
| `<` | `single_char_token(LessThan)` | `LessThan` |
| `>` | `lex_greater_than()` | `GreaterThan`, `GreaterEq` |
| other | -- | `LexError::UnexpectedCharacter(ch)` |

## Appendix B: Operator Trie

The multi-character operators form a trie (prefix tree). This structure is implicit in the `lex_equals()`, `lex_colon()`, `lex_question()`, `lex_backslash()`, and `lex_greater_than()` methods, but it is useful to visualise explicitly:

```
=
├── (end) -> Equals
├── < -> LessEq
├── :
│   └── = -> ArithEq
└── \
    └── = -> ArithNeq

\
├── = -> NotUnifiable
└── (end) -> error

:
└── - -> Neck
    (no : alone is valid)

?
└── - -> Query
    (no ? alone is valid)

>
├── (end) -> GreaterThan
└── = -> GreaterEq
```

At each node, the lexer peeks at the next character to decide whether to extend the match. If the next character does not continue any operator, the lexer emits the operator recognised so far (or an error if no complete operator has been formed).

This trie structure ensures O(k) operator recognition where k is the length of the longest operator (currently 3 for `=:=` and `=\=`).

## Appendix C: Error Recovery Considerations

The current lexer design is *fail-fast*: it stops at the first `LexError` and returns it. This is the simplest correct approach for a pedagogical interpreter. However, for a better user experience in an interactive REPL, error recovery may be desirable.

**Possible recovery strategies** (not implemented, documented for future reference):

1. **Skip-and-continue**: On an unexpected character, emit an `ErrorToken` (a new `TokenKind` variant), skip the offending character, and continue lexing. The parser would then see the error token and report it while still parsing the rest of the clause.

2. **Synchronise on dot**: On any error, scan forward to the next `.` followed by whitespace, discard everything before it, and resume lexing. This loses one clause but recovers for subsequent clauses.

3. **Accumulate errors**: Change the return type to `(Vec<Token>, Vec<LexError>)` -- return all tokens that were successfully recognised plus all errors that were encountered. The parser can then report multiple errors in a single pass.

For the initial implementation, fail-fast is correct. Error recovery is a polish feature.

## Appendix D: Testing Strategy

The lexer is a pure function, making it exceptionally well-suited for exhaustive testing.

### Unit Tests (Example-Based)

One test per token kind:
- `lex("parent")` = `[Atom("parent"), Eof]`
- `lex("X")` = `[Variable("X"), Eof]`
- `lex("_")` = `[AnonymousVariable, Eof]`
- `lex("42")` = `[Integer(42), Eof]`
- `lex("3.14")` = `[Float(3.14), Eof]`
- `lex(":-")` = `[Neck, Eof]`
- ...one per variant.

One test per error kind:
- `lex("'unterminated")` = `Err(UnterminatedQuotedAtom)`
- `lex("/* unclosed")` = `Err(UnterminatedBlockComment)`
- `lex("@")` = `Err(UnexpectedCharacter('@'))`
- `lex("99999999999999999999")` = `Err(NumericOverflow)`
- `lex("a.b")` = partial success then `Err(AmbiguousDot)` (depending on implementation: batch mode may report after emitting `Atom("a")`)

### Property-Based Tests

Using a crate like `proptest` or `quickcheck`:

1. **Partition property**: For any generated input that lexes successfully, verify that the union of all token spans covers the input exactly.
2. **Span consistency**: For any generated input that lexes successfully, verify that `source[span.byte_offset..span.byte_offset + span.byte_length]` matches the expected lexeme for each token.
3. **Monotonicity**: For any generated input that lexes successfully, verify that token spans are in strictly increasing byte-offset order.
4. **Roundtrip**: For any generated input that lexes successfully, verify that concatenating all lexemes (with whitespace gaps filled from the source) reproduces the original input.
5. **Idempotence of keywords**: For any generated bare atom string, verify that it is classified as `Is` iff it equals `"is"`, `Mod` iff it equals `"mod"`, and `Atom(s)` otherwise.

### Fuzzing

Feed arbitrary byte sequences through the lexer (after validating they are UTF-8) and verify:
- The lexer either returns `Ok(tokens)` or `Err(error)` -- it never panics.
- On success, all invariants (partition, span consistency, monotonicity) hold.
- On error, the error span is within the input bounds.

## Appendix E: Performance Characteristics

| Input Size | Tokens (approx) | Time (expected) | Allocation |
|---|---|---|---|
| 100 bytes | ~25 | < 1 us | 1 Vec, ~25 Tokens |
| 10 KB | ~2,500 | < 100 us | 1 Vec, ~2,500 Tokens |
| 1 MB | ~250,000 | < 10 ms | 1 Vec, ~250,000 Tokens |
| 100 MB | ~25,000,000 | < 1 s | 1 Vec, ~25M Tokens |

The lexer is I/O-bound, not compute-bound. For a pedagogical interpreter processing interactive queries (typically < 1 KB), performance is not a concern. The O(n) single-pass design ensures that it will not be a bottleneck even for large source files.

**Allocation note**: Each `Atom(String)` and `Variable(String)` token allocates a `String` on the heap. For high-performance lexing, these could be replaced with interned string indices or `&'src str` slices into the source. For a pedagogical implementation, `String` is clearer and simpler.

## Appendix F: Comparison with Alternative Lexer Architectures

| Approach | Pros | Cons | Fit for Pramana |
|---|---|---|---|
| Hand-written (this design) | Full control, clear code, easy debugging, no dependencies | Verbose, manual maintenance | Best fit: pedagogical clarity |
| `logos` crate (derive macro) | Very fast, concise, zero-copy | Magic macro, hard to debug, limited error recovery | Overkill for this use case |
| `nom` parser combinator | Composable, reusable, well-tested | Lexing is not really parsing; overkill abstraction | Misfit: wrong level of abstraction |
| Table-driven (lex/flex style) | Proven technology, auto-generated from regexes | Opaque tables, poor error messages, C heritage | Poor fit: not pedagogical |
| Regex-based | Concise pattern definitions | Backtracking overhead, hard to get maximal munch right | Fragile for this use case |

The hand-written approach is chosen because the lexer's code should be as readable as its output. Every character-level decision is visible in the source. There are no macros to hide behind, no generated tables to trust blindly. When something goes wrong, the developer reads the method and understands exactly what happened.
