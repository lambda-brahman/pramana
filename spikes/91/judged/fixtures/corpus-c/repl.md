---
slug: repl
title: REPL
tags: [concept, interface]
relationships:
  depends-on: [lexer, parser, resolution, knowledge-base]
  relates-to: [builtins]
---

# REPL

## Intuitive Overview

The REPL -- Read, Eval, Print, Loop -- is the outermost shell of the interpreter. It is the surface the user touches. Everything else in the system (lexing, parsing, unification, resolution, the knowledge base) is internal machinery; the REPL is the doorway through which queries enter and answers exit.

Concretely, the REPL does four things in a tight loop:

1. **Read**: Accept a line (or lines) of text from the user.
2. **Eval**: Determine whether the input is a clause (to be added to the knowledge base) or a query (to be solved). Dispatch accordingly.
3. **Print**: Display the result -- a confirmation for clauses, variable bindings for queries, or an error message.
4. **Loop**: Go back to step 1 unless the user requests termination.

What makes the REPL interesting -- and subtler than a typical read-eval-print loop -- is its **interactive query protocol**. When a query has multiple solutions, the REPL does not dump them all at once. It presents the first solution and *waits*. The user decides: press `;` to see the next solution (forcing the solver to backtrack), or press `.` or Enter to stop searching. This gives the user control over potentially infinite answer streams without requiring the system to enumerate all solutions upfront.

The REPL has two conceptual modes:

- **Consult mode**: Loading clauses into the knowledge base. This happens when the user types a clause directly (`parent(tom, bob).`) or invokes `consult('file.pl').` to load from a file. Each successfully parsed clause is added to the KB, and the REPL prints a confirmation.

- **Query mode**: Solving goals. This is triggered by the `?-` prefix. The REPL parses the query, creates a solver, finds the first solution (if any), and enters the interactive answer-display protocol described above.

The REPL is a **state machine** whose state is the knowledge base. Every clause added mutates the state; every query reads it. The running flag determines whether the loop continues. That's the entire model.

### Why the REPL matters for correctness

The REPL is the integration point. It is where all the individually-tested modules (lexer, parser, unifier, resolver, knowledge base) compose into a running system. A bug in the REPL -- say, failing to rename variables in the displayed answer, or resetting the solver prematurely -- will make the entire interpreter appear broken even if every underlying module is correct. Testing the REPL means testing the whole pipeline end-to-end.

## Formal Definition

### State Machine

The REPL is a **state machine** with the following components:

**State:** A tuple `(KB, running)` where:
- `KB` is a `KnowledgeBase` (a finite map from predicate indicators to ordered clause lists, as defined in the knowledge-base artifact)
- `running` is a boolean flag, initially `true`

**Input alphabet:** Lines of text from the user (strings over UTF-8).

**Output alphabet:** Printed messages (confirmations, variable bindings, errors, prompts).

**Transition function:** Given the current state `(KB, running)` and an input line `input`:

| Input form | Transition | Output |
|---|---|---|
| Clause: `H :- B.` or `H.` | Parse, add to KB. `(KB', running)` where `KB' = KB + clause` | `% clause added.` (or similar confirmation) |
| Query: `?- G_1, ..., G_n.` | Parse, create solver, enter query session | First solution or `false.` |
| `;` (during query session) | Backtrack solver for next solution | Next solution or `false.` |
| `.` or Enter (during query session) | Stop searching, return to main prompt | (nothing, return to prompt) |
| `halt.` or EOF | `(KB, false)` | (exit) |
| Syntax error | State unchanged | Error message with line/column |
| Incomplete input (no `.`) | Buffer, prompt for continuation | Continuation prompt `|    ` |

**Acceptance:** The machine runs until `running = false`.

### Moore Machine Classification

The REPL is more precisely a **Mealy machine** (output depends on both current state and input), but in a loose sense it behaves like a **Moore machine** during query sessions: once a query is active, the output (next solution or `false`) depends on the solver's internal state, which is a function of the KB at query-creation time plus the sequence of `;` inputs received so far.

### Query Session Sub-Machine

A query session is itself a small state machine:

**State:** `(Solver, query_vars, exhausted)` where:
- `Solver` is the resolution engine, positioned at the current point in the search tree
- `query_vars` is the list of `(String, VarId)` pairs mapping user-facing variable names back to internal variable identifiers
- `exhausted` is a boolean indicating whether the solver has no more solutions

**Transitions:**

```
                       +---> display bindings ---> wait for user input
                       |                              |
                       |                    ';' ------+---> backtrack
 solve first solution -+                              |       |
                       |                    '.' ------+---> end session
                       |                              |
                       +---> no solution -----------> print "false." ---> end session
```

When the solver is exhausted (no more choice points to explore), the session prints `false.` and ends regardless of user input.

## Algebraic Laws and Invariants

### Invariant 1: Query independence

Each query creates an independent solver. Queries do not share resolution state. The only shared state between queries is the knowledge base itself.

```
solve(Q1, KB) is independent of solve(Q2, KB)
```

This means: running query Q1 before Q2 produces the same answers for Q2 as running Q2 alone -- provided Q1 does not modify the KB through builtins like `assert/1` or `retract/1`.

### Invariant 2: Consulting is monotonic (under standard loading)

Loading clauses via `consult` adds to the KB. Under standard loading semantics (no `:- abolish` or `:- retract` directives), the set of provable goals can only grow:

```
If KB |- Q (query Q succeeds under KB), then KB' |- Q for any KB' = KB + clauses
```

This is the monotonicity property inherited from the knowledge base. It breaks if directives that retract clauses are executed during consulting.

### Invariant 3: Answer variable scoping

The variables displayed in an answer are exactly the named variables from the original query (excluding anonymous variables `_`). No internal variables (generated by clause renaming during resolution) appear in the output.

```
displayed_vars(answer) subset-of named_vars(query)
```

This requires the REPL to maintain a mapping from user-facing variable names to the `VarId`s assigned during parsing, and to use this mapping when formatting the answer substitution.

### Invariant 4: Semi-colon exhaustiveness

If the user presses `;` after every displayed solution, the REPL will eventually print `false.` -- it will exhaust the search space (for finite search spaces). The sequence of answers displayed is exactly the sequence of solutions found by depth-first SLD resolution, in order.

```
solutions_displayed(Q, KB, all-semicolons) = DFS_solutions(Q, KB)
```

### Invariant 5: Idempotence of halt

Sending `halt.` or EOF when already in the `running = false` state is a no-op. The REPL does not attempt to halt twice or produce duplicate exit messages.

### Invariant 6: REPL state consistency after errors

A syntax error or runtime error during query evaluation must not corrupt the knowledge base or leave the REPL in an inconsistent state. After any error, the REPL returns to its main prompt with the KB unchanged (unless the error occurred after a successful `assert` within the query).

```
error_during(process_input(KB, bad_input)) => KB' = KB
```

## Rust Type Sketch

```rust
/// The top-level interpreter loop.
///
/// Owns the knowledge base and builtin registry. All user interaction
/// flows through this struct. The REPL is the composition root --
/// it wires together the lexer, parser, resolver, and KB into a
/// running system.
struct Repl {
    /// The clause database. Persists across queries. Modified by
    /// clause loading and by `assert`/`retract` builtins.
    kb: KnowledgeBase,

    /// Registry of built-in predicates (consult/1, write/1, halt/0, etc.).
    /// Builtins are looked up by predicate indicator before searching the KB.
    builtin_registry: BuiltinRegistry,
}

/// The outcome of processing a single input line (or multi-line input).
enum ReplResult {
    /// One or more clauses were successfully parsed and added to the KB.
    /// The usize is the count of clauses added (useful for consult, which
    /// may load many clauses from a file).
    ClauseAdded(usize),

    /// A query was processed. The Vec<Answer> contains all solutions
    /// that were displayed before the user stopped or the solver exhausted.
    /// This variant is used for programmatic/test access; the interactive
    /// REPL prints answers incrementally rather than collecting them.
    QueryResult(Vec<Answer>),

    /// A file was successfully consulted.
    /// The String is the filename, for the confirmation message.
    ConsultOk(String),

    /// An error occurred (parse error, runtime error, file not found, etc.).
    Error(String),

    /// The user requested termination (halt/0, EOF, ctrl-D).
    Halt,
}

/// A single answer to a query: a set of variable bindings.
struct Answer {
    /// Variable bindings in the order they appeared in the query.
    /// Each entry maps a user-facing variable name to its resolved
    /// term, pretty-printed in Prolog syntax.
    bindings: Vec<(String, String)>,
}

/// An active query session. Created when the user enters a `?-` query.
/// Lives until the user stops requesting solutions or the solver exhausts.
///
/// The query session mediates between the solver (which produces
/// substitutions) and the display layer (which formats them as
/// user-readable variable bindings).
struct QuerySession {
    /// The resolution engine, positioned in the search tree.
    /// Calling `next_solution()` backtracks and finds the next answer.
    solver: Solver,

    /// Mapping from user-facing variable names to internal VarIds.
    /// Built during parsing of the query. Used to extract the
    /// relevant bindings from the solver's substitution.
    ///
    /// Excludes anonymous variables (`_`), which are never displayed.
    /// Ordered by first occurrence in the query text, so that output
    /// is deterministic and matches the user's expectations.
    query_vars: Vec<(String, VarId)>,
}
```

### Design Rationale

**Why does `Repl` own the `KnowledgeBase`?** The KB persists across queries -- it *is* the interpreter's long-lived state. Ownership by `Repl` makes the lifetime relationship clear: the KB lives exactly as long as the REPL session. No `Rc`, no `Arc`, no lifetime parameters.

**Why `BuiltinRegistry` as a separate field?** Builtins (like `consult/1`, `halt/0`, `write/1`, `assert/1`) are predicate-like operations that cannot be expressed as clauses. They need special handling during resolution: when the resolver encounters a goal whose predicate indicator matches a builtin, it invokes the builtin's Rust function instead of searching the KB. The registry is a map from predicate indicators to builtin implementations. Keeping it separate from the KB maintains the separation between "user-defined knowledge" and "interpreter infrastructure."

**Why `QuerySession` as a separate struct?** The query session has a different lifetime from the REPL itself -- it exists only while a query is being interactively explored. Encapsulating the solver and variable mapping in a struct makes it easy to reason about when resolution state is active and when it is released. It also prevents the solver's mutable borrow of the KB from conflicting with other operations.

**Why `Vec<(String, VarId)>` for `query_vars`?** This preserves the order of variable first-appearance in the query, which determines the display order of bindings. A `HashMap<String, VarId>` would lose this ordering. The Vec is small (queries rarely have more than a handful of named variables), so linear search is not a performance concern.

## Operations

### `new() -> Repl`

Construct a REPL with an empty knowledge base and the default set of builtins.

```rust
impl Repl {
    fn new() -> Self {
        let mut builtin_registry = BuiltinRegistry::new();
        builtin_registry.register_defaults(); // halt/0, consult/1, write/1, nl/0, etc.
        Repl {
            kb: KnowledgeBase::new(),
            builtin_registry,
        }
    }
}
```

**Postcondition:** The KB is empty. The builtin registry contains the default builtins. The REPL is ready to accept input.

---

### `run(&mut self)`

The main loop. Reads input, processes it, prints results, repeats until halt.

```rust
impl Repl {
    fn run(&mut self) {
        println!("?- ");  // initial prompt
        loop {
            let input = self.read_input();
            match self.process_input(&input) {
                ReplResult::Halt => break,
                ReplResult::ClauseAdded(n) => {
                    println!("% {} clause(s) added.", n);
                }
                ReplResult::ConsultOk(file) => {
                    println!("% {} consulted.", file);
                }
                ReplResult::QueryResult(_) => {
                    // answers were already printed incrementally
                    // during handle_query
                }
                ReplResult::Error(msg) => {
                    eprintln!("ERROR: {}", msg);
                }
            }
            print!("?- ");  // prompt for next input
        }
    }
}
```

**Key detail:** The prompt is `?- ` at the top level. During multi-line input (when a clause or query spans multiple lines because no `.` terminator has been seen), the continuation prompt is `|    ` (pipe followed by spaces), matching the SWI-Prolog convention.

---

### `read_input(&mut self) -> String`

Read one complete Prolog sentence (clause or query) from the user. A sentence is terminated by `.` followed by whitespace or EOF. If the user presses Enter without a `.`, continue reading on the next line.

```rust
impl Repl {
    fn read_input(&mut self) -> String {
        let mut buffer = String::new();
        loop {
            let line = // read one line from stdin
            buffer.push_str(&line);
            buffer.push('\n');

            // Check if buffer contains a complete sentence:
            // a '.' followed by whitespace or at end of input.
            // This is a heuristic -- a dot inside a quoted atom
            // (e.g., 'a.b') should not count as a terminator.
            // For robustness, attempt to tokenise the buffer and
            // check if a Dot token appears at the expected position.
            if self.appears_complete(&buffer) {
                break;
            }

            print!("|    ");  // continuation prompt
        }
        buffer
    }
}
```

**Subtlety:** Detecting sentence completeness by looking for `.` in the raw text is fragile -- a dot can appear inside quoted atoms (`'file.pl'`), inside comments (`% version 2.0`), or as a decimal point (`3.14`). The robust approach is to attempt tokenisation of the accumulated buffer and check whether the token stream contains a `Dot` token at the top level. If tokenisation fails with an `UnterminatedQuotedAtom` error, the input is definitely incomplete. If it fails with other errors, those are real errors that should be reported.

---

### `process_input(&mut self, input: &str) -> ReplResult`

The central dispatcher. Tokenises and parses the input, then routes to clause loading or query handling.

```rust
impl Repl {
    fn process_input(&mut self, input: &str) -> ReplResult {
        // Step 1: Tokenise
        let tokens = match tokenise(input) {
            Ok(tokens) => tokens,
            Err(e) => return ReplResult::Error(format_lex_error(e, input)),
        };

        // Step 2: Determine input kind by inspecting the first token
        match tokens.first().map(|t| &t.kind) {
            Some(TokenKind::Query) => {
                // Input starts with ?- : this is a query
                match parse_query(&tokens) {
                    Ok(query) => self.handle_query(query),
                    Err(e) => ReplResult::Error(format_parse_error(e, input)),
                }
            }
            Some(TokenKind::Eof) => {
                // Empty input (just whitespace/comments)
                ReplResult::Halt  // or ignore and continue, depending on policy
            }
            _ => {
                // Everything else is treated as a clause (fact or rule)
                match parse_clause(&tokens) {
                    Ok(clause) => {
                        self.kb.add_clause(clause);
                        ReplResult::ClauseAdded(1)
                    }
                    Err(e) => ReplResult::Error(format_parse_error(e, input)),
                }
            }
        }
    }
}
```

**Design note:** The dispatch logic is simple because the lexer has already distinguished `?-` as a `Query` token and `:-` as a `Neck` token. The first token tells us everything we need: if it's `Query`, we're handling a query; otherwise, we're loading a clause. This mirrors how Prolog systems work: the `?-` prefix is the syntactic marker that distinguishes queries from definitions.

---

### `consult_file(&mut self, path: &str) -> Result<usize, ConsultError>`

Read and parse an entire file, adding all clauses to the KB. Returns the number of clauses added.

```rust
impl Repl {
    fn consult_file(&mut self, path: &str) -> Result<usize, ConsultError> {
        let source = std::fs::read_to_string(path)
            .map_err(|e| ConsultError::FileNotFound(path.to_string(), e))?;

        let tokens = tokenise(&source)
            .map_err(|e| ConsultError::LexError(path.to_string(), e))?;

        let clauses = parse_program(&tokens)
            .map_err(|e| ConsultError::ParseError(path.to_string(), e))?;

        let count = clauses.len();
        for clause in clauses {
            self.kb.add_clause(clause);
        }
        Ok(count)
    }
}

#[derive(Debug)]
enum ConsultError {
    FileNotFound(String, std::io::Error),
    LexError(String, LexError),
    ParseError(String, ParseError),
}
```

**Semantics:** Standard Prolog `consult/1` replaces all clauses for predicates defined in the file. Our initial implementation uses simpler `assertz`-style semantics: clauses are appended. The more sophisticated "replace predicates defined in this file" behavior can be layered on top by tracking which predicate indicators appear in the file and clearing them before loading.

**Directive handling:** Some `.pl` files contain directives like `:- use_module(...)` or `:- ensure_loaded(...)`. These are clauses with no head (just a body prefixed by `:-`). The consult function should recognise these and execute them as goals rather than adding them to the KB. For the initial implementation, directives are not supported; the parser reports them as errors with a helpful message.

---

### `handle_query(&mut self, query: Query) -> ReplResult`

Create a solver for the query and enter the interactive answer-display loop.

```rust
impl Repl {
    fn handle_query(&mut self, query: Query) -> ReplResult {
        let query_vars = query.named_variables(); // Vec<(String, VarId)>

        let mut solver = Solver::new(
            query.goals().to_vec(),
            &self.kb,
            &self.builtin_registry,
        );

        let mut answers = Vec::new();

        // Find the first solution
        match solver.next_solution() {
            Some(subst) => {
                if query_vars.is_empty() {
                    // Ground query: just print true
                    println!("true.");
                    answers.push(Answer { bindings: vec![] });
                } else {
                    let answer = self.format_answer(&subst, &query_vars);
                    self.print_answer(&answer);
                    answers.push(answer.clone());

                    // Interactive loop: wait for user input
                    loop {
                        let user_input = self.read_single_char();
                        match user_input {
                            ';' => {
                                // Backtrack for next solution
                                match solver.next_solution() {
                                    Some(subst) => {
                                        let answer = self.format_answer(&subst, &query_vars);
                                        self.print_answer(&answer);
                                        answers.push(answer.clone());
                                    }
                                    None => {
                                        println!("false.");
                                        break;
                                    }
                                }
                            }
                            '.' | '\n' => {
                                // User satisfied, stop searching
                                println!();
                                break;
                            }
                            _ => {
                                // Ignore unexpected input
                            }
                        }
                    }
                }
            }
            None => {
                println!("false.");
            }
        }

        ReplResult::QueryResult(answers)
    }
}
```

**Why `next_solution()` returns `Option<Substitution>`?** The solver is a lazy iterator over the search tree. Each call to `next_solution()` resumes depth-first search from where it left off, backtracks past the previous solution, and either finds the next solution (returning `Some(subst)`) or exhausts the search space (returning `None`). This design avoids computing all solutions upfront, which is critical for queries with infinite answer sets.

---

### `display_answer(&self, subst: &Substitution, query_vars: &[(String, VarId)])`

Format a substitution into user-readable variable bindings.

```rust
impl Repl {
    fn format_answer(
        &self,
        subst: &Substitution,
        query_vars: &[(String, VarId)],
    ) -> Answer {
        let bindings: Vec<(String, String)> = query_vars
            .iter()
            .map(|(name, var_id)| {
                let resolved_term = subst.walk(*var_id, &self.kb.arena);
                let printed = self.pretty_print_term(resolved_term, &self.kb.arena, &self.kb.atoms);
                (name.clone(), printed)
            })
            .collect();
        Answer { bindings }
    }

    fn print_answer(&self, answer: &Answer) {
        if answer.bindings.is_empty() {
            print!("true");
        } else {
            let formatted: Vec<String> = answer.bindings
                .iter()
                .map(|(name, value)| format!("{} = {}", name, value))
                .collect();
            print!("{}", formatted.join(",\n"));
        }
        // Do not print newline yet -- wait for user's ; or .
    }
}
```

**Pretty-printing rules:**

1. **Atoms:** Print bare if the atom is a valid bare-atom identifier (starts with lowercase, contains only alphanumerics and underscores). Otherwise, print in single quotes with internal quotes doubled. Examples: `tom`, `'Hello World'`, `'it''s'`.

2. **Numbers:** Print integers without decimal point, floats with decimal point. Negative numbers are printed with a leading minus.

3. **Variables:** An unbound variable in the answer is printed as its user-facing name (e.g., `X`). This happens when a query variable was not constrained by the solution.

4. **Compound terms:** Print as `functor(arg1, arg2, ...)`. The functor follows the atom quoting rules above.

5. **Lists:** Detect the `./2` + `nil` encoding and print in list syntax: `[a, b, c]`. For partial lists (tail is a non-nil, non-cons term), print `[a, b | T]`. This requires walking the cons-chain to detect whether the tail is `nil`.

6. **Operators:** For known infix operators (`is`, `+`, `-`, `*`, `/`, `=`, `<`, `>`, etc.), print in infix notation with appropriate parenthesisation. This is a display convenience, not a semantic requirement.

## Edge Cases

### 1. Multi-line input

A clause or query that spans multiple lines because the user did not type `.` yet:

```
?- parent(
|    tom,
|    bob
|    ).
true.
```

The REPL must detect incomplete input (no `.` terminator in the token stream) and continue reading with the continuation prompt `|    `. The accumulated buffer is parsed as a single sentence when complete.

**Pitfall:** A `.` inside a quoted atom (`'a.b'`) or a comment (`% done.`) should not be treated as a clause terminator. The detection logic must be aware of lexical context, which means it should use the tokeniser rather than raw string scanning.

### 2. Syntax errors

```
?- parent(tom, .
ERROR: unexpected token '.' at line 1, column 16. Expected: term.

?-
```

After a syntax error, the REPL must:
- Display a clear error message with the source location.
- Discard the malformed input entirely (do not add partial clauses to the KB).
- Return to the main prompt, ready for the next input.

The knowledge base must be unchanged after an error. This is Invariant 6.

### 3. Query with no solutions

```
?- parent(alice, bob).
false.
```

When the solver immediately exhausts the search space (no clauses match the goal, or all unification attempts fail), print `false.` and return to the prompt. No interactive session is entered.

### 4. Query with infinite solutions

```
?- repeat.
true ;
true ;
true ;
true.
```

The builtin `repeat/0` succeeds infinitely. The user must press `.` or Enter to stop. The REPL must not attempt to enumerate all solutions before displaying the first one -- the lazy `next_solution()` design handles this naturally.

Without user intervention, the REPL would loop forever. This is correct behavior: the user is in control of the search.

### 5. Consult within a query

```
?- consult('family.pl').
% family.pl consulted, 5 clauses.
true.
```

The `consult/1` builtin is invoked as a goal during resolution. It modifies the knowledge base as a side effect and succeeds once. The REPL displays the consult confirmation as part of the builtin's output, then displays `true.` as the query result.

**Subtlety:** Consulting a file during query evaluation mutates the KB while the solver may still be holding references to clause slices. This is the same dynamic-modification issue described in the knowledge-base artifact's Edge Case 4. The recommended mitigation (clone-on-lookup during resolution) ensures correctness.

### 6. Anonymous variables in queries

```
?- parent(_, bob).
true.
```

The anonymous variable `_` should not appear in the answer bindings. If the query contains only anonymous variables (no named variables), and the query succeeds, print `true.` rather than an empty binding set. If the query fails, print `false.`.

The `query_vars` list (used by `format_answer`) excludes entries for `_`, so anonymous variables are automatically filtered from the output.

### 7. Variable named `_` vs. variables starting with `_`

```
?- member(_X, [1, 2, 3]).
_X = 1 ;
_X = 2 ;
_X = 3 ;
false.
```

Variables starting with `_` followed by alphanumeric characters (like `_X`, `_Result`) are named variables -- they *are* displayed in the answer. Only the bare `_` (the anonymous variable) is suppressed. This distinction is handled at the lexer level (`AnonymousVariable` vs `Variable("_X")`), and the REPL respects it.

### 8. Queries where a variable is bound to another variable

```
?- X = Y.
X = Y.
```

When a query variable `X` is bound to another query variable `Y` (and neither is bound to a concrete term), the display should show the relationship. If `X` is bound to `Y`, print `X = Y`. If both are bound to a shared internal variable `_G42`, resolve back to the user-facing name.

**Implementation:** After walking the substitution for each query variable, if the resolved term is itself a variable, check whether that VarId corresponds to another query variable. If so, print the user-facing name. If the resolved VarId is an internal variable (from clause renaming), print a generated name like `_G42` -- though ideally this should not occur for well-scoped queries.

### 9. Queries that trigger errors during resolution

```
?- X is hello.
ERROR: arithmetic error: 'hello' is not a number.

?-
```

Runtime errors during resolution (type errors in arithmetic, instantiation errors, etc.) should be caught and displayed as error messages. The solver state is abandoned, and the REPL returns to the main prompt with the KB unchanged (except for any `assert` side effects that occurred before the error).

### 10. Empty file consult

```
?- consult('empty.pl').
% empty.pl consulted, 0 clauses.
true.
```

Consulting a file with no clauses (only comments or whitespace) should succeed and report 0 clauses. This is not an error.

### 11. Re-consulting the same file

Standard Prolog `consult/1` replaces all clauses for predicates defined in the file. In our initial implementation (appendonly), re-consulting appends duplicates. This should be documented in the REPL's help output as a known limitation. The user can work around it by restarting the REPL or by calling a (future) `abolish/1` builtin.

### 12. EOF handling

When the input stream reaches EOF (ctrl-D on Unix, ctrl-Z on Windows):

- If the REPL is at the main prompt: treat as `halt.` and exit cleanly.
- If the REPL is mid-input (reading a multi-line clause): treat the incomplete input as an error, report it, and exit.
- If the REPL is in a query session (waiting for `;` or `.`): treat as `.` (stop searching) and then exit.

## Interaction Model

A complete REPL session demonstrating all major features:

```
?- consult('family.pl').
% family.pl consulted, 5 clauses.
true.

?- parent(X, bob).
X = tom ;
false.

?- ancestor(X, ann).
X = bob ;
X = tom ;
false.

?- X is 2 + 3.
X = 5.

?- parent(tom, bob).
true.

?- parent(alice, bob).
false.

?- member(X, [a, b, c]).
X = a ;
X = b ;
X = c ;
false.

?- append([1, 2], [3, 4], X).
X = [1, 2, 3, 4].

?- X = f(Y), Y = a.
X = f(a),
Y = a.

?- halt.
```

### Anatomy of the Interactive Protocol

When the REPL prints an answer and waits for input, the display looks like this:

```
?- parent(X, Y).
X = tom,
Y = bob ;          <-- user typed ';' here (on the same line, after the last binding)
X = tom,
Y = liz ;          <-- user typed ';' again
X = bob,
Y = ann ;          <-- user typed ';' again
false.             <-- no more solutions
```

The `;` character is read immediately (without waiting for Enter in a typical terminal with raw mode). In a simpler line-buffered implementation, the user types `;` followed by Enter.

After the last binding in each answer, the REPL prints a space and waits. The user's `;` or `.` appears on the same line. If the user presses `.`:

```
?- parent(X, Y).
X = tom,
Y = bob.           <-- user typed '.' here; search stops

?-                 <-- back to main prompt
```

## Relationships

### Depends on: `lexer`

The REPL calls the lexer (via `tokenise()`) to convert raw input text into a token stream. The lexer is the first stage of the processing pipeline within `process_input`. Lexical errors (unterminated quoted atoms, unexpected characters) are caught here and reported to the user with source locations derived from the `Span` values in the token stream.

The REPL also uses the lexer for multi-line input detection: it tokenises the accumulated buffer to check whether a `Dot` token (clause terminator) has appeared at the top level.

### Depends on: `parser`

The REPL calls the parser to transform token streams into `Clause` or `Query` values. The parser is the second stage of the pipeline. Parse errors (unexpected tokens, missing operands) are caught and reported with source locations.

The parser produces the `query_vars` mapping (from user-facing variable names to `VarId`s) as a side output of parsing a query. The REPL needs this mapping to display answers.

### Depends on: `resolution`

The REPL creates a `Solver` for each query and calls `next_solution()` to enumerate answers. The resolution engine (SLD resolution with depth-first search) is the computational core that the REPL wraps with an interactive interface.

The solver holds mutable references to the knowledge base (or works from a snapshot), the term arena, the substitution, and the trail. The REPL manages the solver's lifecycle: creating it when a query begins, advancing it on `;`, and dropping it when the user stops or the solver exhausts.

### Depends on: `knowledge-base`

The REPL owns the knowledge base and modifies it when clauses are loaded (via direct input or `consult`). The KB is the persistent state that connects consecutive queries. The REPL passes the KB to the solver at query time.

### Relates to: `builtins`

Builtins like `consult/1`, `halt/0`, `write/1`, `assert/1`, and `retract/1` are invoked during resolution but produce effects that the REPL must handle:

- `halt/0` sets the REPL's `running` flag to `false`.
- `consult/1` calls back into the REPL's `consult_file` method.
- `write/1` and `nl/0` produce output that appears in the REPL's output stream, interleaved with the REPL's own prompts and answers.
- `assert/1` and `retract/1` modify the KB that the REPL owns.

The boundary between "builtin logic" and "REPL logic" is important. Builtins should not have direct access to the REPL struct; instead, they communicate through a well-defined interface (e.g., a callback trait or a context object passed during resolution). This prevents builtins from corrupting REPL state.

## Examples

### Example 1: Processing a fact

```
Input: "parent(tom, bob)."

process_input("parent(tom, bob).")
  -> tokenise: Ok([Atom("parent"), LParen, Atom("tom"), Comma, Atom("bob"), RParen, Dot, Eof])
  -> first token is Atom, not Query: dispatch to clause parsing
  -> parse_clause: Ok(Clause { head: parent(tom, bob), body: [], num_vars: 0 })
  -> kb.add_clause(clause)
  -> return ReplResult::ClauseAdded(1)

Output: "% 1 clause(s) added."
```

### Example 2: Processing a query with one solution

Given KB: `{ parent(tom, bob). }`

```
Input: "?- parent(X, bob)."

process_input("?- parent(X, bob).")
  -> tokenise: Ok([Query, Atom("parent"), LParen, Variable("X"), Comma, Atom("bob"), RParen, Dot, Eof])
  -> first token is Query: dispatch to query handling
  -> parse_query: Ok(Query { goals: [parent(X, bob)], num_vars: 1 })
  -> query_vars = [("X", VarId(0))]
  -> Solver::new(goals: [parent(X, bob)], kb: &self.kb)

  solver.next_solution():
    -> Select goal: parent(VarId(0), bob)
    -> Lookup parent/2 in KB: [Clause { head: parent(tom, bob), body: [] }]
    -> Rename clause (0 vars, no-op): parent(tom, bob)
    -> Unify parent(VarId(0), bob) with parent(tom, bob):
       VarId(0) = tom  =>  bind VarId(0) -> tom
       bob = bob        =>  ok
    -> Body is empty: solution found!
    -> Return Some(Substitution { VarId(0) -> tom })

  format_answer:
    -> Walk VarId(0): resolves to Atom("tom")
    -> pretty_print: "tom"
    -> Answer { bindings: [("X", "tom")] }

  print_answer: "X = tom"
  (wait for user input)

  User types ';':
    solver.next_solution():
      -> No more clauses for parent/2. Backtrack. No more choice points.
      -> Return None.
    print: "false."
```

Output as seen by user:

```
?- parent(X, bob).
X = tom ;
false.
```

### Example 3: Consulting a file

Suppose `family.pl` contains:

```prolog
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
```

```
Input: "?- consult('family.pl')."

process_input("?- consult('family.pl').")
  -> parse_query: Ok(Query { goals: [consult('family.pl')], num_vars: 0 })
  -> Solver::new(goals: [consult('family.pl')], kb: &self.kb)

  solver.next_solution():
    -> Select goal: consult('family.pl')
    -> Lookup consult/1: found in builtin_registry
    -> Execute builtin consult/1:
       -> Resolve argument: 'family.pl' (ground atom)
       -> Call self.consult_file("family.pl"):
          -> Read file, tokenise, parse: 5 clauses
          -> Add all to KB
          -> Print: "% family.pl consulted, 5 clauses."
          -> Return Ok(5)
       -> Builtin succeeds
    -> Body is empty (builtin): solution found!
    -> Return Some(Substitution { })  -- no variables

  query_vars is empty (no named variables in query)
  print: "true."
```

### Example 4: Multi-line input handling

```
?- ancestor(
|    tom,
|    ann
|    ).

Read iteration 1:
  buffer = "ancestor(\n"
  tokenise attempt: [Atom("ancestor"), LParen, Eof]
  No Dot token found -> incomplete input
  Print continuation prompt "|    "

Read iteration 2:
  buffer = "ancestor(\n    tom,\n"
  tokenise attempt: [Atom("ancestor"), LParen, Atom("tom"), Comma, Eof]
  No Dot token found -> incomplete
  Print "|    "

Read iteration 3:
  buffer = "ancestor(\n    tom,\n    ann\n"
  tokenise attempt: [Atom("ancestor"), LParen, Atom("tom"), Comma, Atom("ann"), Eof]
  No Dot token found -> incomplete
  Print "|    "

Read iteration 4:
  buffer = "ancestor(\n    tom,\n    ann\n    ).\n"
  tokenise attempt: [Atom("ancestor"), LParen, Atom("tom"), Comma, Atom("ann"), RParen, Dot, Eof]
  Dot token found -> complete!

Proceed to process_input with the full buffer.
```

### Example 5: Error recovery

```
?- parent(tom, ).
ERROR: unexpected token ')' at line 1, column 15. Expected: term.

?- parent(tom, bob).
true.
```

The first input produces a parse error. The REPL reports it and returns to the prompt. The KB is unchanged. The second input succeeds normally, demonstrating that the error did not corrupt any state.

## Appendix: Prompt Design

| Context | Prompt | Rationale |
|---------|--------|-----------|
| Main (awaiting input) | `?- ` | Matches standard Prolog convention. The `?-` mirrors the query syntax, signaling that the system is ready. |
| Continuation (multi-line) | `\|    ` | Pipe-plus-indent, matching SWI-Prolog. Visually distinct from the main prompt. |
| Query answer (awaiting `;`/`.`) | (no explicit prompt; cursor waits after the last binding) | The absence of a prompt signals that the system is showing a result and waiting for the user to decide. |

## Appendix: Error Message Format

Error messages should follow a consistent format:

```
ERROR: <category>: <description> at line <N>, column <M>.
```

Categories:
- `syntax error` -- lexical or parse errors
- `existence error` -- undefined predicate, file not found
- `type error` -- wrong argument type (e.g., arithmetic on atoms)
- `instantiation error` -- variable not sufficiently instantiated
- `permission error` -- modifying a static predicate, etc.

Example:

```
ERROR: syntax error: unexpected token ')'. Expected: term, at line 1, column 15.
ERROR: existence error: file 'missing.pl' not found.
ERROR: type error: expected number, got atom 'hello', in goal: X is hello.
```

This format matches ISO Prolog's error classification, adapted for a single-line display suitable for a terminal.

## Appendix: REPL vs. Batch Mode

The REPL is inherently interactive, but the same processing pipeline supports batch mode:

```rust
impl Repl {
    /// Process a complete program and a list of queries non-interactively.
    /// Used for testing and scripting.
    fn batch(&mut self, program: &str, queries: &[&str]) -> Vec<ReplResult> {
        // Load the program
        self.process_input(program);
        // Run each query, collecting all solutions (no interactive ';')
        queries.iter()
            .map(|q| self.process_input(q))
            .collect()
    }
}
```

In batch mode, all solutions are collected eagerly (the solver runs to exhaustion without waiting for `;`). This is the mode used by property tests: generate random programs and queries, run them in batch, and verify invariants on the results.

## Appendix: Testing Strategy

The REPL is best tested at two levels:

**Unit tests** for individual methods:
- `process_input` with known clause inputs: verify `ClauseAdded` result and KB state
- `process_input` with known query inputs against a pre-loaded KB: verify `QueryResult` contents
- `consult_file` with fixture files: verify clause counts and KB contents
- `format_answer` with known substitutions: verify binding display strings
- Error inputs: verify that `Error` results contain expected messages and that KB is unchanged

**Integration tests** as scripted REPL sessions:
- Feed a sequence of inputs (clauses, then queries) through `process_input` in order
- Verify that the sequence of outputs matches expected results
- Test the complete pipeline from raw text to displayed answers

```rust
#[test]
fn repl_family_program() {
    let mut repl = Repl::new();

    // Load clauses
    assert!(matches!(
        repl.process_input("parent(tom, bob)."),
        ReplResult::ClauseAdded(1)
    ));
    assert!(matches!(
        repl.process_input("parent(tom, liz)."),
        ReplResult::ClauseAdded(1)
    ));
    assert!(matches!(
        repl.process_input("parent(bob, ann)."),
        ReplResult::ClauseAdded(1)
    ));

    // Query
    match repl.process_input("?- parent(tom, X).") {
        ReplResult::QueryResult(answers) => {
            assert_eq!(answers.len(), 2);
            assert_eq!(answers[0].bindings, vec![("X".into(), "bob".into())]);
            assert_eq!(answers[1].bindings, vec![("X".into(), "liz".into())]);
        }
        other => panic!("expected QueryResult, got {:?}", other),
    }
}
```

## Appendix: Performance Characteristics

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| `process_input` (clause) | O(\|input\| + parse) | O(\|clause\|) | Dominated by tokenisation and parsing |
| `process_input` (query, first solution) | O(\|input\| + resolution) | O(\|search tree depth\|) | Resolution cost varies widely |
| `consult_file` | O(\|file\|) | O(\|all clauses\|) | Linear in file size |
| `format_answer` | O(\|query_vars\| * \|term depth\|) | O(\|output string\|) | Walking + pretty-printing |
| `next_solution` (backtrack) | O(\|backtrack distance\|) | O(1) additional | Trail undo is O(bindings undone) |

The REPL itself adds negligible overhead. The performance-critical path is resolution, which is documented in the resolution artifact.

## Appendix: Future Extensions

1. **Tab completion**: Complete predicate names, file paths, and variable names based on the current KB and file system.

2. **History**: Record previous inputs and allow recall via up-arrow (using a readline library like `rustyline`).

3. **Trace/debug mode**: `?- trace.` enables step-by-step display of the resolution process, showing which goals are selected, which clauses are tried, and which bindings are made. This is implemented as a flag on the solver, not in the REPL itself.

4. **Listing**: `?- listing.` or `?- listing(parent/2).` prints the current KB contents in Prolog syntax.

5. **Module system**: Support for `module/2` declarations and qualified predicate references.

6. **Operator definitions**: `?- op(700, xfx, <>).` to define user operators. This requires the REPL to update the parser's operator table dynamically.
