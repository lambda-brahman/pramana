---
slug: parser
title: Parser
tags: [concept, parsing]
relationships:
  depends-on: [token-types, lexer, term, clause]
  relates-to: [knowledge-base]
---

# Parser

## Intuitive Overview

The parser is the bridge between syntax and semantics. It consumes the flat stream of tokens produced by the [[lexer]] and assembles them into the structured representations -- terms, clauses, queries -- that the rest of the interpreter operates on. If the lexer answers "what are the words?", the parser answers "what do they mean structurally?"

Consider the token stream for `ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).`:

```
Atom("ancestor") LParen Variable("X") Comma Variable("Y") RParen
Neck
Atom("parent") LParen Variable("X") Comma Variable("Z") RParen
Comma
Atom("ancestor") LParen Variable("Z") Comma Variable("Y") RParen
Dot
```

Sixteen tokens, no structure. The parser transforms this into a `Clause` with a head `TermId` pointing to `ancestor(Var(0), Var(1))`, a body containing two `TermId`s pointing to `parent(Var(0), Var(2))` and `ancestor(Var(2), Var(1))`, and `num_vars: 3`. The tokens are gone. What remains is a semantic object ready for resolution.

### Two responsibilities

The parser does two things simultaneously:

1. **Syntactic analysis**: It enforces the grammar. A term must be well-formed. A clause must end with `.`. A list must have matching brackets. Violations produce `ParseError` values with span information pointing back to the offending token.

2. **Variable name resolution**: It maps variable *names* (strings like `"X"`, `"Y"`) to variable *identifiers* (`VarId(0)`, `VarId(1)`). This mapping is local to each clause -- the string `"X"` in clause 1 and the string `"X"` in clause 2 produce different `VarId` values. The anonymous variable `_` gets a fresh `VarId` every time it appears, even within the same clause. This is where the logical scoping discipline of Prolog is enforced.

### Why recursive descent

The parser uses recursive descent: one function per grammar production, with explicit lookahead and token consumption. This is the simplest strategy that handles Prolog's grammar, which is LL(1) for the core term language (one token of lookahead suffices to determine which production to take). We do not use parser combinators (too much abstraction for a pedagogical implementation) or parser generators (too much machinery for a grammar this small). The parser is a direct transliteration of the grammar into Rust functions, readable as a grammar specification in its own right.

---

## Formal Definition (Grammar)

The grammar of the language, presented in EBNF. Terminal symbols correspond to `TokenKind` variants from [[token-types]].

```
program     ::= clause* query?
clause      ::= term '.' | term ':-' term_list '.'
query       ::= '?-' term_list '.'
term_list   ::= term (',' term)*
term        ::= atom | variable | number | compound | list | '(' term ')'
compound    ::= atom '(' term_list ')'
atom        ::= ATOM_TOKEN | QUOTED_ATOM_TOKEN
variable    ::= VARIABLE_TOKEN | ANONYMOUS_VARIABLE_TOKEN
number      ::= INTEGER_TOKEN | FLOAT_TOKEN
list        ::= '[' ']' | '[' term_list ']' | '[' term_list '|' term ']'
```

### Grammar notes

**LL(1) property.** The parser can determine which production to take by examining a single token of lookahead:

| Current token    | Production            | Reason                                       |
|------------------|-----------------------|----------------------------------------------|
| `Atom(_)`        | `term -> atom` or `term -> compound` | Peek at next: if `LParen`, it is compound; otherwise atom |
| `Variable(_)`    | `term -> variable`    | Unambiguous                                  |
| `AnonymousVariable` | `term -> variable` | Unambiguous (fresh VarId)                    |
| `Integer(_)`     | `term -> number`      | Unambiguous                                  |
| `Float(_)`       | `term -> number`      | Unambiguous                                  |
| `LParen`         | `term -> '(' term ')'`| Unambiguous                                  |
| `LBracket`       | `term -> list`        | Unambiguous                                  |
| `Cut`            | `term -> atom`        | `!` is treated as the atom `!/0`             |

The one case that requires two tokens of lookahead is `atom` vs `compound`: seeing `Atom("foo")` is not enough; we must peek at the next token to check for `LParen`. This makes the grammar LL(2) in the strict sense, but the distinction is handled by a simple peek inside `parse_term` rather than factoring the grammar.

**Clause vs query.** At the top level, `parse_program` distinguishes clauses from queries by checking whether the first token is `Query` (`?-`). If so, it parses a query. Otherwise, it parses a clause (which begins with a term and is followed by either `Dot` for a fact or `Neck` for a rule).

**List desugaring.** The parser transforms list syntax into compound terms using the functor `.` (dot) with arity 2 and the atom `nil` as the list terminator, as specified in [[term]]:

| List syntax       | Desugared term                                |
|--------------------|-----------------------------------------------|
| `[]`               | `Nil`                                        |
| `[a]`              | `'.'(a, nil)`                                |
| `[a, b]`           | `'.'(a, '.'(b, nil))`                        |
| `[H\|T]`           | `'.'(H, T)`                                  |
| `[a, b \| T]`      | `'.'(a, '.'(b, T))`                          |

This desugaring happens during parsing, not as a separate pass. The parser never produces a "list" AST node -- lists are compound terms from the moment they enter the arena.

---

## Algebraic Laws and Invariants

### Invariant P1: Roundtrip fidelity

> **For all syntactically valid inputs `s`:** if `tokenise(s)` succeeds with tokens `ts` and `parse(ts)` succeeds with program `P`, then `P` is a faithful representation of `s` in the term algebra. Every functor, atom, number, and variable relationship in the source is preserved in the arena.

This is not a literal roundtrip (we cannot reconstruct the exact source text from the AST, because whitespace and comments are discarded by the lexer), but a *semantic* roundtrip: the logical content is preserved.

### Invariant P2: Variable scope isolation

> **For all pairs of clauses `C_i`, `C_j` in a parsed program (i != j):** the VarId sets used in `C_i` and `C_j` are disjoint. No VarId appears in more than one clause's terms.

This is enforced by the parser's variable scoping protocol: `var_map` is cleared between clauses, and `next_var` is a monotonically increasing global counter that never resets. If clause `C_i` uses VarIds `[5, 6, 7]`, clause `C_j` starts from VarId `8` at the earliest.

### Invariant P3: Anonymous variable freshness

> **For all occurrences of `_` in a single clause:** each occurrence is assigned a distinct VarId. No two `_` tokens, even adjacent ones, share a VarId.

Formally: if token positions `p` and `q` both carry `AnonymousVariable` and `p != q`, then the `VarId` assigned at `p` differs from the `VarId` assigned at `q`, regardless of whether `p` and `q` are in the same clause or different clauses.

### Invariant P4: Named variable consistency within a clause

> **For all occurrences of a named variable `V` within a single clause:** all occurrences are assigned the same VarId.

If the token stream contains `Variable("X")` at positions `p` and `q` within the same clause, both positions produce the same `VarId`. This is what `var_map: HashMap<String, VarId>` enforces.

### Invariant P5: num_vars accuracy

> **For every clause `C` produced by the parser:** `C.num_vars` equals the count of distinct VarIds appearing in `C.head` and `C.body`, and VarIds within `C` occupy the contiguous range `[base, base + C.num_vars)` for some `base`.

The contiguity is a consequence of the sequential VarId assignment protocol. It is required by the offset-based renaming scheme in [[clause]] -- if VarIds were sparse, adding an offset would collide with VarIds from other clauses.

### Invariant P6: Term arena referential integrity

> **For every `TermId` in any `Clause` or `Query` produced by the parser:** the `TermId` refers to a valid entry in the `Program`'s `TermArena`. All compound term arguments likewise refer to valid entries.

This is a restatement of Invariant A2 from [[term]], applied specifically to the parser's output. The parser is the primary producer of arena entries, so it bears primary responsibility for this invariant.

### Invariant P7: Determinism

> **For all token sequences `ts`:** `parse(ts)` produces the same result on every invocation. The parser has no hidden state, no randomness, and no environment dependence.

---

## Rust Type Sketch

```rust
use std::collections::HashMap;

/// The parser: transforms a token stream into structured AST nodes.
///
/// Owns the term arena and atom table during parsing. These are
/// transferred to the `Program` on successful completion.
struct Parser<'t> {
    /// The input token stream. Borrowed for the duration of parsing.
    tokens: &'t [Token],

    /// Current position in the token stream.
    pos: usize,

    /// Arena for allocating term nodes. All TermIds produced during
    /// parsing reference entries in this arena.
    arena: TermArena,

    /// Interning table for atom strings. Shared across all clauses.
    atoms: AtomTable,

    /// Per-clause variable name -> VarId mapping.
    /// Reset to empty at the start of each clause.
    var_map: HashMap<String, VarId>,

    /// Global variable counter. Monotonically increasing across the
    /// entire program. Never reset. Ensures VarId uniqueness across
    /// clause boundaries (Invariant P2).
    next_var: VarId,
}
```

### The output types

```rust
/// A complete parsed program: all clauses, an optional trailing query,
/// and the arena + atom table that give meaning to the TermIds.
struct Program {
    /// Clauses in source order. Ordering matters: Prolog tries clauses
    /// top-to-bottom, so the knowledge base must preserve this order.
    clauses: Vec<Clause>,

    /// An optional query. At most one per program. If present, it is
    /// the `?- goals.` that appears at the end of the source.
    query: Option<Query>,

    /// The term arena containing all term nodes referenced by the
    /// clauses and query.
    arena: TermArena,

    /// The atom interning table. Needed to resolve InternedAtom values
    /// back to strings for display, debugging, and error reporting.
    atoms: AtomTable,
}
```

```rust
/// A parse error: what went wrong and where.
#[derive(Debug, Clone, PartialEq)]
struct ParseError {
    kind: ParseErrorKind,
    span: Span,
}

#[derive(Debug, Clone, PartialEq)]
enum ParseErrorKind {
    /// Expected a specific token kind, got something else.
    /// Example: expected `RParen` after argument list, got `Dot`.
    Expected {
        expected: TokenKind,
        found: TokenKind,
    },

    /// Expected the start of a term, got a token that cannot begin one.
    /// Example: `parent(, bob)` -- the comma cannot start a term.
    UnexpectedToken(TokenKind),

    /// A clause or query did not end with `.`.
    MissingDot,

    /// The token stream ended in the middle of a construct.
    /// Example: `parent(tom` -- no closing paren, no dot.
    UnexpectedEof,

    /// An empty argument list for a compound: `foo()`.
    /// Decision: treated as `foo/0`, which is equivalent to the atom `foo`.
    /// This is not an error but a normalization point. However, if the
    /// design rejects `foo()`, this variant serves as the error.
    EmptyArgumentList,

    /// The `|` in a list was followed by something invalid.
    /// Example: `[a | ]` -- no tail term before closing bracket.
    InvalidListTail,
}
```

### Design Rationale

**Why `Parser<'t>` with a borrowed token slice?** The parser does not need to own the tokens. It reads them sequentially, peeks ahead, and never modifies them. A borrowed slice is the minimal commitment: no allocation, no cloning, clear lifetime. The `'t` lifetime expresses that the parser cannot outlive the token stream it reads from.

**Why does `Parser` own the arena and atom table?** During parsing, the arena and atom table grow with every new term and atom encountered. After parsing, they are moved into the `Program` struct and transferred to the caller. This ownership model means there is exactly one arena per parse, no shared mutable state, and no lifetime entanglement between the parser and its output.

**Why `var_map: HashMap<String, VarId>` and not a more exotic structure?** Variable scopes are small (most clauses have fewer than 10 variables). A `HashMap` is overkill in terms of overhead but correct and clear. A `Vec` of `(String, VarId)` pairs with linear search would be faster for tiny scopes, but the `HashMap` makes the lookup semantics explicit and is never a bottleneck. Clarity wins.

**Why `next_var: VarId` as a global counter?** The alternative is to reset variable numbering to 0 for each clause and then assign an offset during resolution. This is what [[clause]]'s `rename_vars` does. But the parser's job is simpler if VarIds are globally unique from the start: it means the parser's output can be inspected, tested, and printed without any clause-level context. The `num_vars` field on `Clause` records the count; the offset-based renaming in resolution adds a further offset. These compose cleanly.

Wait -- there is a tension here. The `clause.md` artifact assumes VarIds within a clause are numbered `0..num_vars-1`, and the offset-based renaming shifts by an additive offset. If the parser assigns *globally* unique VarIds (clause 1 gets `[0, 1, 2]`, clause 2 gets `[3, 4]`), then `rename_vars` would shift clause 2's VarIds by an offset relative to a base of 3, not 0. This breaks the offset scheme.

**Resolution: VarIds are clause-local, starting from 0.** The `var_map` is reset between clauses, and the VarId counter *within a clause* starts from 0. The `next_var` field on the parser is used *within* a single clause to assign sequential IDs; it is reset to `VarId(0)` at the start of each new clause. This produces VarIds `0..num_vars-1` per clause, exactly matching the contract in [[clause]]. The global uniqueness guarantee is provided by `rename_vars` at resolution time, not at parse time.

```rust
/// Revised: next_var is reset per clause, not global.
struct Parser<'t> {
    tokens: &'t [Token],
    pos: usize,
    arena: TermArena,
    atoms: AtomTable,
    var_map: HashMap<String, VarId>,  // reset per clause
    next_var: VarId,                   // reset to VarId(0) per clause
}
```

This revision invalidates Invariant P2 as stated above (VarId sets being disjoint across clauses). The corrected invariant is:

> **P2 (revised):** For every clause `C`, VarIds within `C` occupy the range `[0, C.num_vars)`. VarIds are clause-local; they have no cross-clause meaning until resolution renames them.

---

## Operations

### `Parser::new`

```rust
impl<'t> Parser<'t> {
    /// Construct a new parser over the given token stream.
    fn new(tokens: &'t [Token]) -> Self {
        Parser {
            tokens,
            pos: 0,
            arena: TermArena::new(),
            atoms: AtomTable::new(),
            var_map: HashMap::new(),
            next_var: VarId(0),
        }
    }
}
```

**Post-condition:** The parser is positioned at the first token. The arena and atom table are empty. No variables have been assigned.

---

### `parse_program`

```rust
/// Top-level entry point. Parses the entire token stream into a Program.
///
/// Grammar: program ::= clause* query?
///
/// The parser loops, consuming clauses until it encounters either:
/// - `?-` (Query token): parse a query and stop.
/// - `Eof`: stop.
///
/// Returns Err if any syntactic error is encountered.
fn parse_program(&mut self) -> Result<Program, ParseError>;
```

**Algorithm:**

1. Initialize `clauses: Vec<Clause>` and `query: Option<Query>` as empty.
2. Loop:
   a. Peek at the current token.
   b. If `Eof`, break.
   c. If `Query`, call `parse_query()`, store result, break (only one query allowed).
   d. Otherwise, call `parse_clause()`, push result onto `clauses`.
3. Expect `Eof`.
4. Move `arena` and `atoms` out of `self` into a `Program`.

**Post-condition:** All tokens consumed. The `Program` contains all clauses in source order, at most one query, and the arena + atom table.

---

### `parse_clause`

```rust
/// Parse a single clause: either a fact or a rule.
///
/// Grammar: clause ::= term '.' | term ':-' term_list '.'
///
/// Resets variable scope before parsing (clears var_map, resets next_var).
/// After parsing, records num_vars from the final value of next_var.
fn parse_clause(&mut self) -> Result<Clause, ParseError>;
```

**Algorithm:**

1. **Reset variable scope:** `self.var_map.clear()` and `self.next_var = VarId(0)`.
2. **Parse the head:** call `parse_term()`. The result is a `TermId` for the head.
3. **Decide fact vs rule:** peek at the current token.
   - If `Dot`: consume it. The clause is a fact with empty body.
   - If `Neck` (`:-`): consume it. Parse the body via `parse_term_list()`. Then expect and consume `Dot`.
   - Otherwise: error -- expected `.` or `:-`.
4. **Record num_vars:** `num_vars = self.next_var.0`.
5. Return `Clause { head, body, num_vars }`.

**Variable scoping in action:** Between step 1 and step 4, every call to `parse_term` that encounters a `Variable("X")` token consults `var_map`. If `"X"` is already mapped, the existing `VarId` is reused. If not, a new `VarId` is assigned from `next_var` (which is then incremented). Anonymous variables skip the map entirely and always increment `next_var`.

---

### `parse_query`

```rust
/// Parse a query: ?- goals.
///
/// Grammar: query ::= '?-' term_list '.'
///
/// Resets variable scope (queries have their own scope, independent of
/// any preceding clause).
fn parse_query(&mut self) -> Result<Query, ParseError>;
```

**Algorithm:**

1. **Reset variable scope:** `self.var_map.clear()` and `self.next_var = VarId(0)`.
2. **Consume the `Query` token** (`?-`).
3. **Parse the goal list:** call `parse_term_list()`.
4. **Expect and consume `Dot`.**
5. **Record num_vars:** `num_vars = self.next_var.0`.
6. Return `Query { goals, num_vars }`.

---

### `parse_term`

```rust
/// Parse a single term.
///
/// Grammar:
///   term ::= atom | variable | number | compound | list | '(' term ')'
///
/// This is the heart of the parser. It dispatches on the current token
/// to determine which production to use.
fn parse_term(&mut self) -> Result<TermId, ParseError>;
```

**Algorithm (dispatch on current token kind):**

| Token kind         | Action                                                        |
|--------------------|---------------------------------------------------------------|
| `Atom(name)`       | Consume. Peek: if `LParen`, call `parse_compound(name)`. Otherwise, intern `name` and allocate an `Atom` node. |
| `Variable(name)`   | Consume. Look up `name` in `var_map`. If found, allocate a `Variable(existing_id)` node. If not, assign `next_var`, insert into `var_map`, increment `next_var`, allocate `Variable(new_id)`. |
| `AnonymousVariable`| Consume. Assign `next_var`, increment `next_var`, allocate `Variable(fresh_id)`. Do **not** insert into `var_map`. |
| `Integer(n)`       | Consume. Allocate a `Number(n as f64)` node (or a tagged integer variant if the term representation supports it). |
| `Float(f)`         | Consume. Allocate a `Number(f)` node. |
| `LParen`           | Consume. Call `parse_term()` recursively. Expect and consume `RParen`. Return the inner term's `TermId`. |
| `LBracket`         | Call `parse_list()`. |
| `Cut`              | Consume. Intern `"!"` and allocate an `Atom` node. The cut is represented as the atom `!/0` at the term level; its special semantics are handled by the resolver, not the parser. |
| Anything else      | Error: `UnexpectedToken`. |

**Why does the parser handle `Cut` here?** Because `!` is syntactically a term (it can appear in a body goal list just like any atom), even though it has special runtime semantics. Treating it as the atom `!/0` at parse time keeps the term representation uniform. The resolver checks for this specific atom during evaluation.

---

### `parse_compound`

```rust
/// Parse a compound term: functor(arg1, arg2, ..., argN).
///
/// Grammar: compound ::= atom '(' term_list ')'
///
/// Called after the functor atom has already been consumed and its name
/// is passed as a parameter. The current token should be `LParen`.
fn parse_compound(&mut self, functor: InternedAtom) -> Result<TermId, ParseError>;
```

**Algorithm:**

1. **Consume `LParen`.**
2. **Check for empty argument list:** peek at current token. If `RParen`:
   - Consume it. This is `foo()` -- a compound with zero arguments.
   - **Normalize:** return `arena.atom(functor)` instead of `arena.compound(functor, vec![])`. An arity-0 compound is semantically identical to an atom (see [[term]], Edge Cases, "Empty Argument Lists").
3. **Parse arguments:** call `parse_term_list()` to get `Vec<TermId>`.
4. **Consume `RParen`.**
5. Return `arena.compound(functor, args)`.

---

### `parse_list`

```rust
/// Parse a list literal.
///
/// Grammar:
///   list ::= '[' ']'
///          | '[' term_list ']'
///          | '[' term_list '|' term ']'
///
/// Desugars list syntax into compound terms with functor '.' and
/// the atom nil, per the encoding in the term artifact.
fn parse_list(&mut self) -> Result<TermId, ParseError>;
```

**Algorithm:**

1. **Consume `LBracket`.**
2. **Check for empty list:** if current token is `RBracket`, consume it and return `arena.nil()`. This is `[]`.
3. **Parse elements:** call `parse_term()` for the first element. Then loop: while the current token is `Comma`, consume it and call `parse_term()` again. Collect all elements into `Vec<TermId>`.
4. **Check for tail:**
   - If current token is `Pipe` (`|`): consume it. Call `parse_term()` to get the tail. The list is `[elems | tail]`.
   - Otherwise: the tail is `nil` (proper list).
5. **Consume `RBracket`.**
6. **Build the nested compound:** intern `"."` as the dot functor. Fold the elements right-to-left:
   ```
   let mut current = tail;  // either parsed tail or nil
   for elem in elements.iter().rev() {
       current = arena.compound(dot, vec![*elem, current]);
   }
   ```
7. Return `current`.

This is the `list` and `list_with_tail` convenience constructors from [[term]], invoked inline.

---

### `parse_term_list`

```rust
/// Parse a comma-separated list of one or more terms.
///
/// Grammar: term_list ::= term (',' term)*
///
/// Returns a Vec<TermId> of the parsed terms, preserving order.
fn parse_term_list(&mut self) -> Result<Vec<TermId>, ParseError>;
```

**Algorithm:**

1. Parse the first term via `parse_term()`.
2. While the current token is `Comma`, consume it and parse another term.
3. Return the collected terms.

**Note:** This function always returns at least one term. An empty term list is not syntactically valid in the grammar. The caller (`parse_clause`, `parse_query`, `parse_compound`) must handle the case where no terms are expected before calling this function.

---

### `peek` and `expect`

```rust
/// Look at the current token without consuming it.
/// Returns `Eof` if the position is past the end of the stream.
fn peek(&self) -> &Token;

/// Consume the current token if it matches the expected kind.
/// Returns the consumed token's span on success.
/// Returns Err(ParseError::Expected { expected, found }) on mismatch.
fn expect(&mut self, expected: TokenKind) -> Result<Span, ParseError>;

/// Consume the current token unconditionally, advancing pos.
/// Returns the consumed token.
fn advance(&mut self) -> &Token;
```

**Subtlety with `expect` and parameterized TokenKinds:** When the expected token carries data (e.g., `Atom(String)`), the `expect` method cannot check for equality because the caller does not know the string content in advance. In practice, `expect` is used only for fixed tokens (`LParen`, `RParen`, `Comma`, `Dot`, `Neck`, `Query`, `LBracket`, `RBracket`, `Pipe`). For data-carrying tokens, the parser uses `peek` to inspect the kind and then `advance` to consume.

---

### Variable resolution: `resolve_variable`

```rust
/// Resolve a variable name to a VarId within the current clause scope.
///
/// If the name has been seen before in this clause, returns the existing VarId.
/// If not, assigns the next available VarId and records the mapping.
fn resolve_variable(&mut self, name: &str) -> VarId {
    if let Some(&id) = self.var_map.get(name) {
        id
    } else {
        let id = self.next_var;
        self.var_map.insert(name.to_string(), id);
        self.next_var = VarId(id.0 + 1);
        id
    }
}

/// Allocate a fresh VarId for an anonymous variable.
/// Does not record anything in var_map.
fn fresh_anonymous_var(&mut self) -> VarId {
    let id = self.next_var;
    self.next_var = VarId(id.0 + 1);
    id
}
```

These two functions are the enforcement mechanism for Invariants P3 and P4. Named variables go through `resolve_variable` (which consults and updates `var_map`); anonymous variables go through `fresh_anonymous_var` (which bypasses `var_map` entirely).

---

## Edge Cases

### 1. Operator as functor: `+(1, 2)`

In Prolog, operators can be used as functors in standard compound term notation. The input `+(1, 2)` should parse as a compound term with functor `+` and two integer arguments.

However, the lexer emits `Plus` for `+`, not `Atom("+")`. The parser must handle this: when `parse_term` encounters an operator token followed by `LParen`, it should treat the operator as a functor name. This means the dispatch table in `parse_term` needs additional cases:

```rust
Plus  => if peek_next is LParen { parse_compound(intern("+")) } else { error }
Minus => if peek_next is LParen { parse_compound(intern("-")) } else { error }
Star  => if peek_next is LParen { parse_compound(intern("*")) } else { error }
// ... etc.
```

Alternatively, the parser can normalize all operator tokens to atoms when they appear in functor position. The key insight is that the functor/operator distinction is syntactic, not semantic -- `+(1, 2)` and `1 + 2` (if infix notation is supported) must produce the same term.

**Decision for this implementation:** Operator-as-functor is supported. When an operator token appears at the start of a term and is immediately followed by `LParen`, it is parsed as a compound term. When it does not have a following `LParen`, it is a parse error (we do not support infix operator notation in the initial implementation; terms must use standard functor notation).

### 2. Empty argument list: `foo()`

Per ISO Prolog, `foo()` is syntactically valid and denotes `foo/0`, which is identical to the atom `foo`. The parser normalizes this: `parse_compound` checks for an empty argument list and returns `arena.atom(functor)` instead of `arena.compound(functor, vec![])`. This upholds the normalization strategy described in [[term]] under "Empty Argument Lists."

If we wanted to reject `foo()` as an error, the `EmptyArgumentList` variant in `ParseErrorKind` would be used. The current design accepts and normalizes it.

### 3. Deeply nested lists: `[1,[2,[3,[]]]]`

Lists desugar to right-nested compound terms. The list `[1,[2,[3,[]]]]` produces:

```
'.'(1, '.'('.'(2, '.'('.'(3, '.'(nil, nil)), nil)), nil))
```

This is a tree of depth 6 in the arena. The parser handles it correctly because `parse_list` calls `parse_term` recursively, and `parse_term` calls `parse_list` when it encounters `LBracket`. The recursion depth is bounded by the nesting depth of the input. For pathological inputs with thousands of nesting levels, the parser will overflow the call stack.

**Mitigation:** A configurable recursion depth limit. The parser tracks depth and returns `ParseError` if the limit is exceeded. For the pedagogical interpreter, a limit of 1000 is generous.

### 4. Missing clause terminator `.`

Input: `parent(tom, bob)` followed by `Eof`.

The parser finishes parsing the term `parent(tom, bob)` and then expects either `Dot` or `Neck`. Finding `Eof` instead, it produces `ParseError { kind: MissingDot, span: <span of Eof> }`.

### 5. Unexpected EOF mid-term

Input: `parent(tom,` followed by `Eof`.

The parser is inside `parse_compound`, which called `parse_term_list`. After parsing `tom` and consuming the `Comma`, `parse_term` is called again. It finds `Eof`, which cannot start a term. Error: `ParseError { kind: UnexpectedEof, span: <span of Eof> }`.

### 6. Comma outside of term list

Input: `parent(tom bob).`

After parsing `tom`, the parser expects either `Comma` (more arguments) or `RParen` (end of arguments). Finding `Atom("bob")` instead, it produces: `ParseError { kind: Expected { expected: RParen, found: Atom("bob") }, span: <span of bob> }`.

### 7. The variable `_` appearing multiple times

Input: `foo(_, _, _).`

The parser assigns three distinct VarIds:

```
_ at position 1 -> VarId(0)
_ at position 2 -> VarId(1)
_ at position 3 -> VarId(2)
```

Resulting clause: `num_vars = 3`. Even though the source uses the same token `_` three times, the clause has three independent variables. This is critical for correct unification semantics: `foo(1, 2, 3)` must unify with `foo(_, _, _)` without imposing any equality constraints between the three positions.

### 8. Variable `_Foo` (named underscore variable)

Input: `bar(_Foo, _Foo).`

`_Foo` is a *named* variable (it starts with `_` followed by alphanumeric characters), not an anonymous variable. The lexer emits `Variable("_Foo")`, not `AnonymousVariable`. The parser treats it like any named variable: both occurrences get the same VarId.

```
_Foo at position 1 -> VarId(0) (new entry in var_map)
_Foo at position 2 -> VarId(0) (found in var_map)
```

Resulting clause: `num_vars = 1`. The two positions share a variable, so `bar(1, 2)` would *not* unify with `bar(_Foo, _Foo)` (because 1 != 2).

### 9. List with pipe but no tail: `[a | ]`

Input: `[a | ]`.

After consuming `Pipe`, the parser calls `parse_term()`. The current token is `RBracket`, which cannot start a term. Error: `ParseError { kind: InvalidListTail, span: <span of RBracket> }`.

### 10. Multiple queries

Input:

```prolog
parent(tom, bob).
?- parent(tom, X).
?- parent(Y, bob).
```

The grammar allows at most one query per program. After parsing the first query, `parse_program` expects `Eof`. Finding `Query` instead, it produces a parse error. If multiple queries are desired, the input should be split into separate parse calls, or the grammar should be extended.

### 11. Clause beginning with a variable

Input: `X :- foo(X).`

This is syntactically valid (the grammar says `clause ::= term ':-' term_list '.'`, and a variable is a term). However, it is semantically dubious -- a clause head should be an atom or compound term, not a bare variable. The parser accepts it (it follows the grammar), but a later semantic check in the knowledge base could reject it.

### 12. Negative numbers: `-7`

Per the decision in [[token-types]], the lexer emits `[Minus, Integer(7)]`, not `Integer(-7)`. The parser, as currently designed, does not handle infix operators. So `-7` in term position is a parse error: `Minus` cannot start a term (it is not in the dispatch table for `parse_term`).

**Resolution options:**
1. **Accept unary minus in `parse_term`:** When `Minus` is followed by `Integer` or `Float`, consume both and produce a negated `Number` node. This is a syntactic convenience that does not require full operator support.
2. **Require parenthesized negation:** `(-7)` is not valid either without infix support. The user must write `-(7)` as a compound term.
3. **Defer to arithmetic evaluation:** The term `-(7)` is a compound term, and `is/2` evaluates it as negation at runtime.

For the initial implementation, option 1 is recommended: handle unary minus as a special case in `parse_term` to avoid surprising users. The parser peeks at `Minus`, and if the next token is a number, consumes both and produces a `Number` node with the negated value.

---

## Relationships

### Depends on: [[token-types]]

The parser consumes `Token` values and dispatches on `TokenKind` variants. Every terminal in the grammar corresponds to a `TokenKind`. The parser's `peek`, `expect`, and `advance` methods operate on `Token` structs and examine `TokenKind` discriminants. Without the token type definitions, the parser has no input vocabulary.

### Depends on: [[lexer]]

The lexer is the *producer* of the token stream that the parser consumes. The parser assumes that the tokens it receives satisfy the lexer's invariants: the Partition Law, the Roundtrip Law, the Maximal Munch Law, and Span Consistency. In particular, the parser relies on spans being accurate for error reporting -- when it produces a `ParseError`, it attaches the span of the offending token so the user can locate the error in the source.

### Depends on: [[term]]

The parser is the primary *producer* of arena-allocated terms. It calls `arena.alloc`, `arena.atom`, `arena.var`, `arena.number`, `arena.compound`, and `arena.nil` to build the term tree. The `TermId`, `TermNode`, `TermArena`, `InternedAtom`, `VarId`, and `AtomTable` types are all defined in the term module. The parser's output is expressed entirely in terms of these types.

The parser also enforces the term module's normalization conventions: empty compound argument lists are normalized to atoms, lists are desugared to nested `'.'`/`nil` compounds.

### Depends on: [[clause]]

The parser produces `Clause` and `Query` values as defined in the clause module. The `Clause` struct's fields (`head`, `body`, `num_vars`) are populated by the parser. The `num_vars` field, in particular, is computed by the parser's variable assignment protocol -- it is the final value of `next_var` at the end of clause parsing.

### Relates to: [[knowledge-base]]

The knowledge base consumes the `Program` that the parser produces. Specifically, it takes the `Vec<Clause>` and indexes them by head functor and arity (using `Clause::head_functor`). The parser's output is the knowledge base's input. The parser ensures clause ordering is preserved (Prolog semantics depend on it), and the knowledge base must maintain that ordering.

---

## Examples

### Example 1: Parsing a fact

**Source:**

```prolog
parent(tom, bob).
```

**Token stream (from [[token-types]]):**

```
Atom("parent") LParen Atom("tom") Comma Atom("bob") RParen Dot Eof
```

**Parser trace:**

1. `parse_program` starts. Peek: `Atom("parent")`. Not `Query`, not `Eof`. Call `parse_clause`.
2. `parse_clause`: Reset scope (`var_map = {}`, `next_var = VarId(0)`).
3. Call `parse_term`:
   - Current token: `Atom("parent")`. Consume it. Intern `"parent"` -> `InternedAtom(0)`.
   - Peek: `LParen`. This is a compound term. Call `parse_compound(InternedAtom(0))`.
4. `parse_compound`:
   - Consume `LParen`.
   - Peek: `Atom("tom")` -- not `RParen`, so arguments exist.
   - Call `parse_term_list`:
     - `parse_term`: `Atom("tom")`. Consume. Intern `"tom"` -> `InternedAtom(1)`. Peek: `Comma`, not `LParen`. Allocate `arena.atom(InternedAtom(1))` -> `TermId(0)`.
     - Current token: `Comma`. Consume.
     - `parse_term`: `Atom("bob")`. Consume. Intern `"bob"` -> `InternedAtom(2)`. Peek: `RParen`, not `LParen`. Allocate `arena.atom(InternedAtom(2))` -> `TermId(1)`.
     - Current token: `RParen`, not `Comma`. Stop. Return `vec![TermId(0), TermId(1)]`.
   - Consume `RParen`.
   - Allocate `arena.compound(InternedAtom(0), vec![TermId(0), TermId(1)])` -> `TermId(2)`.
   - Return `TermId(2)`.
5. Back in `parse_clause`. Head = `TermId(2)`. Peek: `Dot`. Consume. Fact.
6. `num_vars = next_var.0 = 0`.
7. Return clause.

**Arena state:**

```
TermArena:
  [0] Atom(InternedAtom(1))                                -- tom
  [1] Atom(InternedAtom(2))                                -- bob
  [2] Compound { functor: InternedAtom(0), args: [TermId(0), TermId(1)] }
                                                           -- parent(tom, bob)
```

**AtomTable state:**

```
  InternedAtom(0) -> "parent"
  InternedAtom(1) -> "tom"
  InternedAtom(2) -> "bob"
```

**Resulting clause:**

```rust
Clause {
    head: TermId(2),   // parent(tom, bob)
    body: vec![],      // fact
    num_vars: 0,       // no variables
}
```

---

### Example 2: Parsing a rule with variable scoping

**Source:**

```prolog
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
```

**Token stream:**

```
Atom("ancestor") LParen Variable("X") Comma Variable("Y") RParen
Neck
Atom("parent") LParen Variable("X") Comma Variable("Z") RParen
Comma
Atom("ancestor") LParen Variable("Z") Comma Variable("Y") RParen
Dot
```

**Parser trace (variable resolution focus):**

1. `parse_clause`: Reset scope. `var_map = {}`, `next_var = VarId(0)`.
2. Parse head `ancestor(X, Y)`:
   - `Atom("ancestor")` -> intern -> `InternedAtom(3)` (assume 0-2 taken from prior clause).
   - `LParen` -> compound.
   - `Variable("X")`: not in `var_map`. Assign `VarId(0)`. Insert `"X" -> VarId(0)`. Allocate `arena.var(VarId(0))` -> `TermId(3)`. `next_var = VarId(1)`.
   - `Variable("Y")`: not in `var_map`. Assign `VarId(1)`. Insert `"Y" -> VarId(1)`. Allocate `arena.var(VarId(1))` -> `TermId(4)`. `next_var = VarId(2)`.
   - Compound: `arena.compound(InternedAtom(3), vec![TermId(3), TermId(4)])` -> `TermId(5)`.
3. Peek: `Neck`. Consume. Parse body.
4. Parse body goal 1 `parent(X, Z)`:
   - `Atom("parent")` -> `InternedAtom(0)` (already interned).
   - `Variable("X")`: found in `var_map` as `VarId(0)`. Allocate `arena.var(VarId(0))` -> `TermId(6)`.
   - `Variable("Z")`: not in `var_map`. Assign `VarId(2)`. Insert `"Z" -> VarId(2)`. Allocate `arena.var(VarId(2))` -> `TermId(7)`. `next_var = VarId(3)`.
   - Compound: `arena.compound(InternedAtom(0), vec![TermId(6), TermId(7)])` -> `TermId(8)`.
5. Consume `Comma`.
6. Parse body goal 2 `ancestor(Z, Y)`:
   - `Atom("ancestor")` -> `InternedAtom(3)`.
   - `Variable("Z")`: found in `var_map` as `VarId(2)`. Allocate `arena.var(VarId(2))` -> `TermId(9)`.
   - `Variable("Y")`: found in `var_map` as `VarId(1)`. Allocate `arena.var(VarId(1))` -> `TermId(10)`.
   - Compound: `arena.compound(InternedAtom(3), vec![TermId(9), TermId(10)])` -> `TermId(11)`.
7. Consume `Dot`.
8. `num_vars = next_var.0 = 3`.

**var_map at end of clause:**

```
  "X" -> VarId(0)
  "Y" -> VarId(1)
  "Z" -> VarId(2)
```

**Arena state (new entries only):**

```
  [3]  Var(VarId(0))                                        -- X
  [4]  Var(VarId(1))                                        -- Y
  [5]  Compound { functor: InternedAtom(3), args: [TermId(3), TermId(4)] }
                                                            -- ancestor(X, Y)
  [6]  Var(VarId(0))                                        -- X (another allocation, same VarId)
  [7]  Var(VarId(2))                                        -- Z
  [8]  Compound { functor: InternedAtom(0), args: [TermId(6), TermId(7)] }
                                                            -- parent(X, Z)
  [9]  Var(VarId(2))                                        -- Z (another allocation, same VarId)
  [10] Var(VarId(1))                                        -- Y (another allocation, same VarId)
  [11] Compound { functor: InternedAtom(3), args: [TermId(9), TermId(10)] }
                                                            -- ancestor(Z, Y)
```

Note: `VarId(0)` (X) is allocated at both `TermId(3)` and `TermId(6)`. These are two distinct arena entries that happen to represent the same logical variable. An optimization would be to reuse the same `TermId` for the same variable within a clause (using a `VarId -> TermId` cache), but this is not required for correctness.

**Resulting clause:**

```rust
Clause {
    head: TermId(5),                     // ancestor(X, Y)
    body: vec![TermId(8), TermId(11)],   // [parent(X, Z), ancestor(Z, Y)]
    num_vars: 3,                         // X=0, Y=1, Z=2
}
```

---

### Example 3: Parsing a query

**Source:**

```prolog
?- ancestor(Who, bob).
```

**Token stream:**

```
Query Atom("ancestor") LParen Variable("Who") Comma Atom("bob") RParen Dot
```

**Parser trace:**

1. `parse_program`: Peek: `Query`. Call `parse_query`.
2. `parse_query`: Reset scope. Consume `Query`.
3. Parse term list:
   - `parse_term`: `Atom("ancestor")` -> `InternedAtom(3)`. Peek: `LParen`. Compound.
   - `Variable("Who")`: assign `VarId(0)`. `arena.var(VarId(0))` -> `TermId(12)`.
   - `Atom("bob")`: `arena.atom(InternedAtom(2))` -> `TermId(13)`.
   - Compound: `arena.compound(InternedAtom(3), vec![TermId(12), TermId(13)])` -> `TermId(14)`.
4. Consume `Dot`.
5. `num_vars = 1` (only `Who`).

**Resulting query:**

```rust
Query {
    goals: vec![TermId(14)],   // [ancestor(Who, bob)]
    num_vars: 1,               // Who=Var(0)
}
```

**var_map at end of query:**

```
  "Who" -> VarId(0)
```

The query's variable scope is independent of all clause scopes. Even if a prior clause also had a variable called `Who`, the query's `VarId(0)` is its own.

---

### Example 4: Parsing a list

**Source:**

```prolog
append([], L, L).
```

**Token stream:**

```
Atom("append") LParen LBracket RBracket Comma Variable("L") Comma Variable("L") RParen Dot
```

**Parser trace (list focus):**

1. `parse_clause`: Reset scope.
2. Parse `append([], L, L)`:
   - `Atom("append")` -> `InternedAtom(4)`. Peek: `LParen`. Compound.
   - First argument: `parse_term` sees `LBracket`. Call `parse_list`.
     - Consume `LBracket`. Peek: `RBracket`. Empty list. Consume `RBracket`.
     - Return `arena.nil()` -> `TermId(15)`.
   - Second argument: `Variable("L")` -> `VarId(0)` -> `TermId(16)`.
   - Third argument: `Variable("L")` -> found in `var_map` as `VarId(0)` -> `TermId(17)`.
   - Compound: `arena.compound(InternedAtom(4), vec![TermId(15), TermId(16), TermId(17)])` -> `TermId(18)`.
3. Consume `Dot`. `num_vars = 1`.

Now consider the more complex list:

```prolog
append([H|T], L, [H|R]) :- append(T, L, R).
```

The head-tail list `[H|T]` is desugared:

1. `parse_list`:
   - Consume `LBracket`.
   - Parse `H`: `Variable("H")` -> `VarId(0)` -> allocate.
   - Current token: `Pipe`. Consume.
   - Parse tail `T`: `Variable("T")` -> `VarId(1)` -> allocate.
   - Consume `RBracket`.
   - Intern `"."` -> `InternedAtom(5)` (the dot functor).
   - Build: `arena.compound(InternedAtom(5), vec![H_id, T_id])`.
   - Result: the compound `'.'(H, T)`.

The second list `[H|R]` is desugared identically, reusing `VarId(0)` for the same `H` variable.

---

### Example 5: Anonymous variables

**Source:**

```prolog
ignore(_, _, X, _).
```

**Parser trace (variable resolution):**

1. Reset scope. `var_map = {}`, `next_var = VarId(0)`.
2. Parse arguments:
   - `_` (AnonymousVariable): `fresh_anonymous_var()` -> `VarId(0)`. `next_var = VarId(1)`.
   - `_` (AnonymousVariable): `fresh_anonymous_var()` -> `VarId(1)`. `next_var = VarId(2)`.
   - `Variable("X")`: `resolve_variable("X")` -> `VarId(2)`. Insert `"X" -> VarId(2)`. `next_var = VarId(3)`.
   - `_` (AnonymousVariable): `fresh_anonymous_var()` -> `VarId(3)`. `next_var = VarId(4)`.
3. `num_vars = 4`.

**var_map at end:**

```
  "X" -> VarId(2)
```

Note that `var_map` contains only one entry. The three anonymous variables are not in the map -- they are assigned sequentially but never recorded. `VarId(0)`, `VarId(1)`, and `VarId(3)` are permanently independent: nothing can ever refer to them by name.

---

### Example 6: Full program parse

**Source:**

```prolog
parent(tom, bob).
parent(bob, ann).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
?- ancestor(tom, Who).
```

**Resulting Program:**

```
Program {
    clauses: [
        Clause { head: parent(tom, bob),        body: [],                            num_vars: 0 },
        Clause { head: parent(bob, ann),        body: [],                            num_vars: 0 },
        Clause { head: ancestor(X, Y),          body: [parent(X, Y)],               num_vars: 2 },
        Clause { head: ancestor(X, Y),          body: [parent(X, Z), ancestor(Z, Y)], num_vars: 3 },
    ],
    query: Some(Query { goals: [ancestor(tom, Who)], num_vars: 1 }),
    arena: TermArena { ... },   // all term nodes
    atoms: AtomTable { ... },   // "parent", "tom", "bob", "ann", "ancestor"
}
```

Each clause has clause-local VarIds starting from 0:

| Clause                                               | var_map                        | num_vars |
|------------------------------------------------------|-------------------------------|----------|
| `parent(tom, bob).`                                   | `{}`                          | 0        |
| `parent(bob, ann).`                                   | `{}`                          | 0        |
| `ancestor(X, Y) :- parent(X, Y).`                    | `{"X": 0, "Y": 1}`           | 2        |
| `ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).`   | `{"X": 0, "Y": 1, "Z": 2}`  | 3        |
| `?- ancestor(tom, Who).`                              | `{"Who": 0}`                 | 1        |

The `X` in clause 3 (`VarId(0)`) and the `X` in clause 4 (`VarId(0)`) share the same VarId *value*, but they are semantically distinct because they belong to different clauses. The offset-based renaming in [[clause]] ensures they get disjoint IDs at resolution time.

---

## Appendix A: Error Reporting Strategy

Parse errors carry a `Span` that points to the offending token. A good error message combines:

1. The `Span` information (line, column) for location.
2. The `ParseErrorKind` for the nature of the error.
3. The actual token found (from `peek`) for context.

Example error output:

```
error: expected ')' but found '.'
  --> input.pl:3:18
   |
 3 | ancestor(X, Y :- parent(X, Y).
   |                  ^ expected ')'
```

The parser does not attempt error recovery. On the first error, it returns `Err(ParseError)` and stops. Error recovery (skipping to the next `.` and trying to continue) is a usability feature that can be added later without changing the parser's core architecture. The grammar is simple enough that most errors are caught within a few tokens of the mistake.

---

## Appendix B: Comparison with Alternative Parsing Strategies

| Strategy              | Complexity | Grammar coverage       | Error messages | Code size | Suitability          |
|-----------------------|-----------|------------------------|----------------|-----------|----------------------|
| Recursive descent     | LL(k)     | LL grammars, manual handling of left recursion | Excellent (hand-tuned) | Small | **Best for this project** |
| Parser combinators    | LL(k)     | LL grammars            | Good (with effort) | Moderate | Overkill for this grammar |
| PEG parser            | PEG       | PEG grammars (no left recursion) | Moderate | Small (with library) | Viable but adds dependency |
| LR parser generator   | LR(1)     | LR grammars            | Poor (shift-reduce errors) | Large (generated) | Wrong paradigm |
| Pratt parser          | Precedence climbing | Operator expressions  | Good | Small | Needed only if supporting infix operators |

Recursive descent wins because:

- The grammar is small (fewer than 10 productions).
- The grammar is LL(2) at most (atom vs compound ambiguity).
- Error messages are a first-class concern (this is a pedagogical tool).
- The code *is* the grammar specification -- no separate grammar file to maintain.
- No external dependencies.

If infix operator support is added later (e.g., `X is 3 + 4` parsed as `is(X, +(3, 4))`), a Pratt parser can be integrated as a subroutine within the recursive descent framework. Pratt parsing handles precedence and associativity elegantly and composes well with recursive descent for the non-operator parts of the grammar.

---

## Appendix C: Performance Characteristics

| Operation              | Time           | Space             | Notes                                      |
|------------------------|----------------|--------------------|---------------------------------------------|
| `parse_program(n tokens)` | O(n)        | O(n) arena entries | Each token is consumed exactly once         |
| `parse_term` (depth d) | O(d)          | O(d) stack frames  | Recursive; bounded by nesting depth         |
| `resolve_variable`     | O(1) amortized | O(1)              | HashMap lookup/insert                       |
| `fresh_anonymous_var`  | O(1)           | O(1)              | Increment counter                           |
| `intern` (atom)        | O(|s|) amortized | O(|s|) first time | From AtomTable, amortized across program    |
| Arena allocation       | O(1) amortized | +1 TermNode       | Vec::push                                  |
| Total memory           |                | O(n) terms + O(a) atoms | n = term count, a = unique atom count |

The parser is single-pass. It never backtracks (no grammar ambiguity requires it). Each token is examined at most twice (once by `peek`, once by `advance`), giving a strict O(n) time bound where n is the number of tokens. Memory usage is proportional to the output size (terms and atoms), not the input size -- though for Prolog programs these are nearly identical.

---

## Appendix D: Future Extensions

### Operator notation

The current grammar requires standard functor notation: `+(1, 2)` not `1 + 2`. Supporting infix/prefix/postfix operators requires:

1. An operator precedence table (definable via `op/3` directives in ISO Prolog).
2. A Pratt parser (precedence climbing) integrated into `parse_term`.
3. Desugaring `1 + 2` into `+(1, 2)` during parsing.

This is a significant extension but does not change the output types -- the arena and clause structures remain the same.

### DCG notation

Definite Clause Grammars (`-->`) are syntactic sugar:

```prolog
greeting --> [hello], name.
```

is transformed to:

```prolog
greeting(S0, S) :- 'C'(S0, hello, S1), name(S1, S).
```

This transformation can be done as a parser rewrite rule or as a separate desugaring pass after parsing. The latter is cleaner.

### Module system

If the language supports modules, the parser must handle `module/2` and `use_module/1` directives. These are parsed as directives (terms with special functor names) and processed by the knowledge base loader. The parser itself does not need to understand module semantics -- it just produces the terms.
