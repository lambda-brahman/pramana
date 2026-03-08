---
slug: token-types
title: Token Types
tags: [concept, lexical]
relationships:
  depends-on: []
  relates-to: [lexer, parser]
---

# Token Types

## Intuitive Overview

Before a Prolog-like language can reason about logic, it must *read*. Reading means converting a flat stream of characters into a sequence of meaningful chunks -- tokens. A token is the smallest unit of meaning: an atom like `parent`, a variable like `X`, a punctuation mark like `:-`, a number like `42`. The lexer's job is to carve the input into these pieces and label each one.

Think of tokenisation as the boundary between "characters" and "syntax." On one side, the input is just bytes. On the other side, it is a structured stream that the parser can consume without worrying about whitespace, comment boundaries, or whether `=<` is one operator or two characters. Every decision about *what constitutes a lexeme* is made here, once, so that no downstream phase ever has to re-examine raw text.

Why does this matter for a predicate logic interpreter specifically? Because the lexical vocabulary determines what the language *can say*. If the token set lacks `:-`, there are no rules. If it lacks `?-`, there are no queries. The token types are the alphabet of the logic language, and getting them right -- with precise boundaries, unambiguous classification, and complete coverage -- is the foundation everything else rests on.

## Formal Definition

**Definition (Token).** A *token* is a triple `(tag, lexeme, span)` where:

- `tag` is drawn from a finite set of token kinds `T = {Atom, Variable, Integer, Float, LParen, RParen, ...}`,
- `lexeme` is the substring of the input that this token spans (for tokens with variable content) or is implicitly determined by the tag (for fixed-syntax tokens),
- `span` is a value `(line, column, byte_offset, byte_length)` that locates the token in the source.

**Definition (Tokenisation).** A *tokenisation* of an input string `s` is a sequence of tokens `[t_1, t_2, ..., t_n]` such that:

1. **Coverage**: the concatenation of all lexemes (including skipped whitespace and comments) reconstructs `s` exactly.
2. **Ordering**: `span(t_i).byte_offset + span(t_i).byte_length <= span(t_{i+1}).byte_offset` for all `i`.
3. **Maximality (maximal munch)**: each token's lexeme is the longest prefix of the remaining input that matches any token pattern.
4. **Determinism**: given the same input, the tokenisation is unique.

**Definition (Lexical Category).** The token kinds partition into categories:

```
C_ident   = {Atom, Variable}
C_literal = {Integer, Float}
C_punct   = {LParen, RParen, LBracket, RBracket, Pipe, Comma, Dot,
             Neck, Query, Cut, Equals, NotUnifiable, Is,
             Plus, Minus, Star, Slash, Mod,
             LessThan, GreaterThan, LessEq, GreaterEq,
             ArithEq, ArithNeq}
C_special = {Eof}
```

These categories are mutually exclusive and exhaustive over the token kind set: every token kind belongs to exactly one category.

## Algebraic Laws and Invariants

The tokeniser must satisfy the following properties, stated as testable propositions.

### Partition Law

> **For all valid inputs `s`:** every byte in `s` is accounted for by exactly one of: a token's span, a whitespace region, or a comment region. No byte is unclaimed; no byte is double-claimed.

Formally: let `R(t)` denote the byte range `[t.span.byte_offset, t.span.byte_offset + t.span.byte_length)` for a token `t`, and let `W` be the set of byte ranges for whitespace and comment regions. Then:

```
Union(R(t_i) for all i) ∪ W = [0, len(s))
```

and all ranges in the union are pairwise disjoint.

### Roundtrip Law

> **For all valid inputs `s`:** concatenating the lexemes of all tokens (including whitespace/comment pseudo-tokens, if retained) in order reproduces `s` byte-for-byte.

This is a stronger form of the partition law. Even if whitespace and comments are *skipped* in the output token stream, the spans must still account for them. A debug mode that emits whitespace/comment tokens must roundtrip perfectly.

### Maximal Munch Law

> **For all token boundaries:** the lexer always consumes the longest possible match. `=<` is one `LessEq` token, never `=` followed by `<`. `:-` is one `Neck` token, never `:` followed by `-`.

### Determinism Law

> **For all inputs `s`:** `tokenise(s) = tokenise(s)`. The function is pure. No hidden state, no nondeterminism.

### Span Consistency Law

> **For all tokens `t` in `tokenise(s)`:** `s[t.span.byte_offset .. t.span.byte_offset + t.span.byte_length] = t.lexeme`.

The span must always agree with the lexeme content. This is critical for error reporting: a span that points to the wrong location is worse than no span at all.

### Line/Column Monotonicity

> **For tokens `t_i` and `t_{i+1}`:** either `t_{i+1}.span.line > t_i.span.line`, or `t_{i+1}.span.line == t_i.span.line` and `t_{i+1}.span.column > t_i.span.column`.

Tokens appear in strictly increasing source order.

## The Lexical Vocabulary

### Atoms

Atoms are the "words" of Prolog -- ground identifiers that name predicates, functors, and constants.

**Bare atoms** start with a lowercase ASCII letter and continue with alphanumeric characters or underscores:

```
atom_bare ::= [a-z][a-zA-Z0-9_]*
```

Examples: `foo`, `parent`, `is_valid`, `x1`.

**Quoted atoms** are enclosed in single quotes and may contain any character (including spaces, uppercase letters, and special characters). A single quote within a quoted atom is escaped by doubling it:

```
atom_quoted ::= "'" ( [^'] | "''" )* "'"
```

Examples: `'Hello World'`, `'it''s'`, `'+'`.

Note: the keywords `is` and `mod` are lexed as their own distinct token kinds, not as atoms. This is a deliberate lexical-level decision: it simplifies the parser and avoids ambiguity. If a user writes `is` in atom position (e.g., as a functor), they must quote it: `'is'`.

### Variables

Variables are the "unknowns" that unification fills in.

**Named variables** start with an uppercase letter or underscore followed by at least one alphanumeric character:

```
variable_named ::= [A-Z][a-zA-Z0-9_]* | _[a-zA-Z0-9_]+
```

Examples: `X`, `Var`, `_hidden`, `Result1`.

**Anonymous variable** is the single underscore `_`. Each occurrence of `_` is a distinct, fresh variable -- the lexer records it with a special variant so the compiler knows not to share bindings.

```
variable_anon ::= "_"
```

The distinction between `_` and `_foo` matters: `_foo` is a named variable (it can be referenced again), while `_` is always fresh.

### Numbers

**Integers** are sequences of digits, optionally preceded by a minus sign:

```
integer ::= "-"? [0-9]+
```

Examples: `42`, `0`, `-7`.

**Floats** contain a decimal point with digits on both sides, optionally preceded by a minus sign:

```
float ::= "-"? [0-9]+ "." [0-9]+
```

Examples: `3.14`, `-0.001`, `100.0`.

Note on leading minus: the minus sign is *lexically* part of the number token only when it is not ambiguous. In the expression `3-2`, the minus is the arithmetic operator `Minus`, not part of the integer `-2`. The lexer resolves this by treating a minus as part of a number only when it is not preceded by a token that could be an operand (i.e., not preceded by a number, atom, variable, or closing bracket). This is a context-sensitive lexical decision -- one of the few places where the lexer must peek at the previous token.

*Alternatively*, a simpler design: the lexer *never* attaches the minus sign to number literals. `-7` is always `Minus` followed by `Integer(7)`. The parser handles negation. This avoids the context-sensitivity entirely and is the approach taken in many Prolog implementations. **The Rust sketch below follows this simpler design.**

### Operators and Punctuation

These are the fixed-syntax tokens. Each has exactly one lexeme.

#### Grouping and Structure

| Token Kind  | Lexeme | Role                                       |
|-------------|--------|--------------------------------------------|
| `LParen`    | `(`    | Open grouping / begin compound term args   |
| `RParen`    | `)`    | Close grouping / end compound term args    |
| `LBracket`  | `[`    | Open list literal                          |
| `RBracket`  | `]`    | Close list literal                         |
| `Pipe`      | `\|`   | List head-tail separator: `[H \| T]`      |
| `Comma`     | `,`    | Argument separator / conjunction           |
| `Dot`       | `.`    | Clause terminator (must be followed by whitespace or EOF) |

#### Logic Connectives

| Token Kind  | Lexeme | Role                                       |
|-------------|--------|--------------------------------------------|
| `Neck`      | `:-`   | Rule neck ("if")                           |
| `Query`     | `?-`   | Query prefix                               |
| `Cut`       | `!`    | Cut (prune search tree)                    |

#### Unification and Evaluation

| Token Kind     | Lexeme | Role                                    |
|----------------|--------|-----------------------------------------|
| `Equals`       | `=`    | Unification                             |
| `NotUnifiable`  | `\\=`  | Not unifiable                           |
| `Is`           | `is`   | Arithmetic evaluation                   |

#### Arithmetic Operators

| Token Kind | Lexeme | Role             |
|------------|--------|------------------|
| `Plus`     | `+`    | Addition         |
| `Minus`    | `-`    | Subtraction      |
| `Star`     | `*`    | Multiplication   |
| `Slash`    | `/`    | Division         |
| `Mod`      | `mod`  | Modulo           |

#### Comparison Operators

| Token Kind    | Lexeme | Role                           |
|---------------|--------|--------------------------------|
| `LessThan`    | `<`    | Arithmetic less than           |
| `GreaterThan` | `>`    | Arithmetic greater than        |
| `LessEq`      | `=<`   | Arithmetic less than or equal  |
| `GreaterEq`   | `>=`   | Arithmetic greater than or equal|
| `ArithEq`     | `=:=`  | Arithmetic equality            |
| `ArithNeq`    | `=\\=` | Arithmetic inequality          |

Note the Prolog-specific `=<` (not `<=`). This is a deliberate choice inherited from Edinburgh Prolog to avoid ambiguity with `<=` which could be confused with an arrow notation. The lexer must match `=<` as a single token, not `=` followed by `<`.

### Special Tokens

**EOF** marks the end of the input stream. It carries no lexeme and its span points to the position one past the last byte. The parser uses EOF to detect termination.

**Whitespace** (spaces, tabs, newlines, carriage returns) is consumed and discarded. It serves only to separate tokens and to advance the line/column counters. Whitespace is never emitted in the token stream.

**Comments** are also consumed and discarded:

- **Line comments** begin with `%` and extend to the end of the line (not including the newline character itself, which is whitespace).
- **Block comments** begin with `/*` and end with `*/`. They may span multiple lines. The question of nesting is addressed under Edge Cases below.

## Rust Type Sketch

```rust
/// Byte-level position in the source string, sufficient to reconstruct
/// line:column display positions and to slice back into the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// 1-based line number.
    pub line: u32,
    /// 1-based column number (byte offset within the line, not codepoint).
    pub column: u32,
    /// 0-based byte offset from the start of the input.
    pub byte_offset: u32,
    /// Length of the lexeme in bytes.
    pub byte_length: u32,
}

/// A token is a tagged lexeme with position metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

/// The finite set of token kinds.
///
/// Variants that carry data (atoms, variables, numbers) hold the parsed
/// value directly. Fixed-syntax tokens carry no payload -- their lexeme
/// is fully determined by the variant.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    // -- Identifiers --
    /// A bare atom (`foo`, `parent`) or a quoted atom (`'Hello World'`).
    /// The String holds the logical content: for quoted atoms, quotes are
    /// stripped and escape sequences (doubled quotes) are resolved.
    Atom(String),

    /// A named variable (`X`, `_hidden`).
    /// The String holds the variable name as written.
    Variable(String),

    /// The anonymous variable `_`.
    /// Distinguished from Variable because each occurrence is
    /// semantically independent -- no name sharing.
    AnonymousVariable,

    // -- Literals --
    /// An integer literal. Stored as i64 to accommodate standard
    /// Prolog integer ranges without immediate overflow.
    Integer(i64),

    /// A floating-point literal. Stored as f64.
    Float(f64),

    // -- Grouping / Structure --
    LParen,       // (
    RParen,       // )
    LBracket,     // [
    RBracket,     // ]
    Pipe,         // |
    Comma,        // ,
    Dot,          // .

    // -- Logic Connectives --
    Neck,         // :-
    Query,        // ?-
    Cut,          // !

    // -- Unification / Evaluation --
    Equals,       // =
    NotUnifiable,  // \=
    Is,           // is

    // -- Arithmetic --
    Plus,         // +
    Minus,        // -
    Star,         // *
    Slash,        // /
    Mod,          // mod

    // -- Comparison --
    LessThan,     // <
    GreaterThan,  // >
    LessEq,       // =<
    GreaterEq,    // >=
    ArithEq,      // =:=
    ArithNeq,     // =\=

    // -- Special --
    Eof,
}
```

### Design Rationale

**Why `Atom(String)` and not a separate `QuotedAtom`?** After lexing, the distinction between `foo` and `'foo'` is irrelevant -- both refer to the same atom. The lexer resolves quoting and escaping, producing the logical atom name. Downstream phases never need to know whether it was quoted. This is the standard Prolog semantics: `foo` and `'foo'` unify.

**Why `AnonymousVariable` instead of `Variable("_".into())`?** Because the anonymous variable has *different semantics*: each occurrence is a fresh variable, whereas two occurrences of `Variable("X")` refer to the same variable within a clause. Encoding this in the type system prevents the parser from accidentally sharing anonymous variables. The compiler can enforce this invariant structurally rather than by convention.

**Why `i64` and `f64` instead of storing the raw string?** The lexer is the right place to parse numeric values. If the string `99999999999999999999` overflows `i64`, the lexer should report the error with a precise span, not the parser or evaluator. Storing parsed values also avoids re-parsing later.

**Why `u32` for span fields?** Source files larger than 4 GiB are not a realistic use case for a pedagogical Prolog interpreter. Using `u32` instead of `usize` halves the memory footprint of spans and makes `Token` fit comfortably in cache. If this constraint is ever violated, the lexer should fail at input validation with a clear error, not silently wrap.

**Why is `Span` `Copy`?** Spans are small (16 bytes) and immutable. Making them `Copy` eliminates lifetime concerns when error messages need to reference multiple spans simultaneously.

## Operations

### Core Lexer Interface

```rust
/// Tokenise an entire input string, returning all tokens or the first
/// lexical error with its span.
pub fn tokenise(input: &str) -> Result<Vec<Token>, LexError>;

/// A lexical error: an unexpected character or malformed token, plus the
/// location where it occurred.
#[derive(Debug, Clone, PartialEq)]
pub struct LexError {
    pub kind: LexErrorKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LexErrorKind {
    /// A `'` was opened but never closed before EOF or newline-in-bare-context.
    UnterminatedQuotedAtom,
    /// A `/*` was opened but `*/` was never found.
    UnterminatedBlockComment,
    /// A character was encountered that does not begin any valid token.
    UnexpectedCharacter(char),
    /// A numeric literal overflowed the representable range.
    NumericOverflow,
    /// A `.` was not followed by whitespace or EOF (ambiguous: could be
    /// a decimal point, a clause terminator, or an error).
    AmbiguousDot,
}
```

### Token Inspection Methods

```rust
impl Token {
    /// Returns true if this token is a clause terminator (`.`).
    pub fn is_clause_end(&self) -> bool;

    /// Returns true if this token can appear as the start of a term.
    /// Atoms, variables, numbers, `(`, `[`, and `!` can start terms.
    pub fn is_term_start(&self) -> bool;

    /// Returns the source slice corresponding to this token, given the
    /// original input string. Relies on the Span Consistency Law.
    pub fn lexeme<'a>(&self, source: &'a str) -> &'a str;
}
```

### Span Methods

```rust
impl Span {
    /// Create a span that covers from `self` to `other` (inclusive).
    /// Used for error messages that reference a range of tokens.
    pub fn merge(&self, other: &Span) -> Span;

    /// A human-readable location string: `"line 3, column 12"`.
    pub fn display(&self) -> String;
}
```

## Edge Cases

### 1. Unterminated Quoted Atoms

Input: `parent('Hello`

The lexer opens a quoted atom at `'H` and scans forward looking for a closing `'`. When it hits EOF without finding one, it must report `LexError::UnterminatedQuotedAtom` with a span pointing to the opening quote. The span should cover from the opening `'` to EOF so the error message can show the full unterminated region.

### 2. Nested Block Comments

Input: `/* outer /* inner */ still comment? */`

**Decision: block comments do not nest.** The first `*/` closes the comment opened by the first `/*`. The text ` still comment? */` is then lexed as regular tokens (and will likely produce errors or unexpected tokens). This matches ISO Prolog behaviour.

If nesting were supported, `/* inner */` would be an inner comment, and the outer comment would close at the final `*/`. This is the SWI-Prolog extension behaviour and is arguably more user-friendly but deviates from the standard. The choice should be documented in the lexer and easily togglable.

### 3. Operator Disambiguation and Maximal Munch

The input `=<` must lex as a single `LessEq` token, not as `Equals` followed by `LessThan`. Similarly:

- `:-` is `Neck`, not `:` (which is not even a valid token) followed by `Minus`.
- `?-` is `Query`, not `?` followed by `Minus`.
- `=:=` is `ArithEq`, not `Equals` `:` `Equals`.
- `=\=` is `ArithNeq`, not `Equals` `\` `Equals`.
- `\=` is `NotUnifiable`, not `\` followed by `Equals`.

The lexer must try multi-character operators before single-character ones. A trie or ordered prefix table is the natural implementation strategy.

### 4. The Dot Ambiguity

In Prolog, `.` serves double duty:

- **Clause terminator**: `parent(tom, bob).` -- the dot ends the clause. It must be followed by whitespace or EOF.
- **Decimal point**: `3.14` -- the dot is part of a float literal.

The lexer resolves this by context:

- If `.` appears immediately after digits *and* is immediately followed by digits, it is part of a float.
- Otherwise, `.` is a clause terminator, and the lexer checks that the next character is whitespace, EOF, or `%` (start of a comment). If it is not, the lexer emits `LexError::AmbiguousDot`.

This means `foo.bar` is an error (dot not followed by whitespace), which is correct Prolog behaviour.

### 5. The Minus Ambiguity

As discussed in the Numbers section, the minus sign is lexed as a `Minus` operator token, never as part of a number literal. The expression `-7` produces `[Minus, Integer(7)]`. The parser or evaluator handles arithmetic negation. This sidesteps the ambiguity between `a-b` (subtraction) and `a - b` (also subtraction) and `f(-3)` (argument is negative three).

### 6. Keywords vs. Atoms: `is` and `mod`

The identifiers `is` and `mod` are lexed as `TokenKind::Is` and `TokenKind::Mod` respectively, *not* as `Atom("is")` or `Atom("mod")`. This means:

- `X is 3 + 4` lexes as `[Variable("X"), Is, Integer(3), Plus, Integer(4)]`.
- `is(foo)` lexes as `[Is, LParen, Atom("foo"), RParen]` -- which the parser will reject.
- To use `is` as a functor name, quote it: `'is'(foo)` lexes as `[Atom("is"), LParen, Atom("foo"), RParen]`.

### 7. Empty Input

The input `""` (empty string) produces a single `[Eof]` token with span `(line: 1, column: 1, byte_offset: 0, byte_length: 0)`.

### 8. Comment-Only Input

The input `% just a comment` produces `[Eof]`. The comment is consumed and discarded. The Eof span points to the position after the comment.

### 9. Adjacent Operators

The input `=:==` should lex as `[ArithEq, Equals]` by maximal munch: `=:=` is consumed first (3 characters), then `=` is the next token.

The input `>=<` should lex as `[GreaterEq, LessThan]`: `>=` is consumed first (2 characters), then `<`.

### 10. Unicode in Quoted Atoms

Input: `'cafe\u0301'` (the character `e` followed by a combining accent).

Quoted atoms may contain arbitrary UTF-8. The lexer does not normalise Unicode -- it preserves bytes exactly as written. The atoms `'cafe\u0301'` and `'caf\u00e9'` are therefore *distinct* atoms even though they render identically. This is a deliberate simplicity choice; Unicode normalisation is a separate concern.

## Relationships

### Depends On

None. Token types are a leaf concept -- they depend only on the definition of the source character set (UTF-8). This is the foundation layer of the interpreter pipeline.

### Relates To

**Lexer** (`relates-to: lexer`): The lexer is the *machine* that produces tokens. Token types define the *output vocabulary* of that machine. The lexer artifact will describe the scanning algorithm (state machine, character-by-character dispatch, error recovery), referencing these token types as its output contract.

**Parser** (`relates-to: parser`): The parser is the *consumer* of the token stream. It pattern-matches on `TokenKind` variants to build an abstract syntax tree. The parser artifact will define grammar productions in terms of these token kinds. Every `TokenKind` variant must appear in at least one grammar production (otherwise it is dead vocabulary). Conversely, every terminal in the grammar must correspond to exactly one `TokenKind` variant.

## Examples

### Example 1: A Simple Fact

**Input:**
```prolog
parent(tom, bob).
```

**Token stream:**

| # | Kind              | Lexeme   | Line | Col | Offset | Length |
|---|-------------------|----------|------|-----|--------|--------|
| 1 | `Atom("parent")`  | `parent` | 1    | 1   | 0      | 6      |
| 2 | `LParen`          | `(`      | 1    | 7   | 6      | 1      |
| 3 | `Atom("tom")`     | `tom`    | 1    | 8   | 7      | 3      |
| 4 | `Comma`           | `,`      | 1    | 11  | 10     | 1      |
| 5 | `Atom("bob")`     | `bob`    | 1    | 13  | 12     | 3      |
| 6 | `RParen`          | `)`      | 1    | 16  | 15     | 1      |
| 7 | `Dot`             | `.`      | 1    | 17  | 16     | 1      |
| 8 | `Eof`             | --       | 1    | 18  | 17     | 0      |

Note: the space after `,` (byte offset 11) is consumed as whitespace and does not appear in the token stream. The partition law holds: bytes 0-16 are covered by tokens, byte 11 is whitespace, byte 17 is past the end.

### Example 2: A Rule with Arithmetic

**Input:**
```prolog
factorial(N, F) :-
    N > 0,
    N1 is N - 1,
    factorial(N1, F1),
    F is F1 * N.
```

**Token stream (abbreviated, showing only kinds):**

```
Atom("factorial") LParen Variable("N") Comma Variable("F") RParen Neck
Variable("N") GreaterThan Integer(0) Comma
Variable("N1") Is Variable("N") Minus Integer(1) Comma
Atom("factorial") LParen Variable("N1") Comma Variable("F1") RParen Comma
Variable("F") Is Variable("F1") Star Variable("N") Dot
Eof
```

All whitespace (spaces, newlines, indentation) is consumed silently. The `Neck` token `:-` spans the boundary between lines but is a single token. The `is` keyword appears twice, both times lexed as `Is`, not `Atom("is")`.

### Example 3: List Syntax

**Input:**
```prolog
?- append([1, 2], [3 | X], Result).
```

**Token stream:**

```
Query LParen Atom("append") LParen
LBracket Integer(1) Comma Integer(2) RBracket Comma
LBracket Integer(3) Pipe Variable("X") RBracket Comma
Variable("Result") RParen Dot Eof
```

Note the `Query` token `?-` is consumed as a single two-character token. The `Pipe` separates the head `3` from the tail variable `X` in the list `[3 | X]`.

### Example 4: Quoted Atoms and Comments

**Input:**
```prolog
% This is a greeting rule
greet('Hello World') :- !. /* cut */
```

**Token stream:**

```
Atom("greet") LParen Atom("Hello World") RParen Neck Cut Dot Eof
```

The line comment `% This is a greeting rule` and the block comment `/* cut */` are both consumed and discarded. The quoted atom `'Hello World'` becomes `Atom("Hello World")` -- quotes stripped, content preserved. The `!` is lexed as `Cut`.

### Example 5: Edge Case Gauntlet

**Input:**
```prolog
X =:= Y, A =\= B, C =< D, E >= F, G \= H.
```

**Token stream:**

```
Variable("X") ArithEq Variable("Y") Comma
Variable("A") ArithNeq Variable("B") Comma
Variable("C") LessEq Variable("D") Comma
Variable("E") GreaterEq Variable("F") Comma
Variable("G") NotUnifiable Variable("H") Dot Eof
```

Every multi-character operator is consumed as a single token by maximal munch. None of them decompose into smaller operators.
