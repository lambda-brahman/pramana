---
slug: term
title: Term
tags: [concept, core]
relationships:
  depends-on: []
  relates-to: [substitution, unification]
---

# Term

## Intuitive Overview

A term is the fundamental unit of data in a predicate logic interpreter. Every query, every fact, every rule -- they are all built from terms. Where a language like Rust has `i32` and `String` and `struct` as its building blocks, a logic language has exactly one: the term.

Think of terms as a universal symbolic tree. An atom like `foo` is a leaf. A variable like `X` is a placeholder leaf -- a hole waiting to be filled by [[unification]]. A number like `42` is a leaf carrying a numeric value. A compound term like `f(a, X)` is a branch node: it has a label (the functor `f`) and children (the arguments `a` and `X`). Lists are just a conventional way of writing nested compound terms using the functor `.` (dot), with the atom `nil` marking the end.

The key insight is that terms are *inert symbolic structures*. They do not evaluate. `+(2, 3)` is not `5` -- it is a tree with functor `+` and two children `2` and `3`. Computation happens not by reducing terms, but by finding [[substitution]]s that make terms identical through [[unification]].

Why does a logic interpreter need a single universal data type? Because the language is *homoiconic at the term level*: the data that programs manipulate (terms) and the programs themselves (clauses, which are terms) share the same representation. A predicate `parent(tom, bob)` is simultaneously a statement in a knowledge base and a compound term with functor `parent` and arity 2.

## Formal Definition

### The Term Algebra

Let **Sigma** be a *signature*, consisting of:

- A set **F** of *functor symbols*, each with an associated arity (a non-negative integer). Atoms are functors of arity 0.
- A countably infinite set **V** of *variables*, disjoint from **F**.
- A set **N** of *numeric constants* (here, the IEEE 754 f64 values, or a tagged union of i64 and f64).

The set **T(Sigma, V)** of *terms over Sigma and V* is the smallest set such that:

1. Every variable `v` in **V** is a term.
2. Every numeric constant `n` in **N** is a term.
3. Every functor symbol `f` in **F** with arity 0 is a term (these are the atoms).
4. If `f` in **F** has arity `k > 0` and `t_1, ..., t_k` are terms, then `f(t_1, ..., t_k)` is a term.

A term containing no variables is called a *ground term*. The set of all ground terms is the *Herbrand universe* **U(Sigma)**.

This is a *free algebra*: no two syntactically distinct terms are equal. `f(a)` is not equal to `f(b)`, and `f(X)` is not equal to `g(X)`, regardless of what `X` might eventually stand for. Equality of terms is purely structural -- two terms are equal if and only if they have identical tree structure with identical labels at every node.

### Lists as Syntactic Sugar

Lists are not a separate algebraic sort. They are a notational convenience mapped onto the term algebra:

| List syntax     | Term representation                             |
|-----------------|--------------------------------------------------|
| `[]`            | the atom `nil`                                   |
| `[a]`           | `'.'(a, nil)`                                    |
| `[a, b]`        | `'.'(a, '.'(b, nil))`                            |
| `[H\|T]`        | `'.'(H, T)`                                      |
| `[a, b \| T]`   | `'.'(a, '.'(b, T))`                              |

The functor `.` (dot) has arity 2 by convention. The first argument is the *head*, the second is the *tail*. This encoding is identical to Lisp's cons cells and Prolog's list representation.

### Nil

`nil` is an atom -- a functor of arity 0 -- that serves as the list terminator. In the Rust representation, it may be given a dedicated variant `Nil` for pattern-matching convenience and to avoid a string lookup for the most common atom in the system. Semantically, `Nil` and `Atom(intern("nil"))` are interchangeable; the dedicated variant is a performance and ergonomics choice, not a semantic one.

## Algebraic Laws and Invariants

These properties must hold and should be verified by property-based tests.

### Structural Equality

**Law 1 (Reflexivity).** For all terms `t`: `t = t`.

**Law 2 (Symmetry).** For all terms `t`, `u`: if `t = u` then `u = t`.

**Law 3 (Congruence).** For all functors `f` of arity `k` and terms `t_1, ..., t_k`, `u_1, ..., u_k`: `f(t_1, ..., t_k) = f(u_1, ..., u_k)` if and only if `t_i = u_i` for all `1 <= i <= k`.

**Law 4 (Discrimination).** Distinct constructors produce distinct terms:
- `Atom(a) != Variable(v)` for all `a`, `v`.
- `Atom(a) != Number(n)` for all `a`, `n`.
- `Compound(f, k, args) != Atom(a)` when `k > 0`.
- `f(t_1, ..., t_k) != g(u_1, ..., u_m)` when `f != g` or `k != m`.

### Arena Invariants

**Invariant A1 (ID Validity).** Every `TermId` obtained from `arena.alloc(node)` remains valid for the lifetime of the arena. There is no deallocation of individual terms.

**Invariant A2 (Referential Integrity).** If a `TermNode::Compound { args, .. }` contains a `TermId`, that ID was previously allocated in the same arena. No cross-arena references.

**Invariant A3 (Deterministic Retrieval).** `arena.get(arena.alloc(node))` returns a node structurally equal to `node`. Allocation is append-only and never mutates existing entries.

**Invariant A4 (Interning Consistency).** For all strings `s`: `atom_table.intern(s) == atom_table.intern(s)`. The same string always yields the same `InternedAtom`.

### List Encoding Invariant

**Invariant L1.** Any term produced by list syntax `[t_1, ..., t_n]` is structurally equal to the right-nested compound `'.'(t_1, '.'(t_2, ... '.'(t_n, nil) ...))`. A well-formed list is either `nil` or `'.'(H, T)` where `T` is a well-formed list. A term `'.'(H, T)` where `T` is not a well-formed list is a *partial list* (or *dotted pair*) -- legal but potentially problematic for predicates expecting proper lists.

## Rust Type Sketch

```rust
/// Handle into the term arena. Cheap to copy, compare, and hash.
/// The u32 limits us to ~4 billion terms per arena, which is
/// sufficient for any interactive session.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct TermId(u32);

/// Interned atom identifier. Two InternedAtoms are equal iff they
/// refer to the same original string. Comparison is O(1).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct InternedAtom(u32);

/// Variable identifier. During parsing, named variables (X, Y, _Foo)
/// are mapped to sequential VarIds within a clause scope.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct VarId(u32);

/// The core term representation. Each variant maps to one case
/// in the formal definition of T(Sigma, V).
#[derive(Clone, Debug)]
pub enum TermNode {
    /// A named constant. Arity-0 functor in the signature.
    /// The string content lives in the AtomTable; we hold only the index.
    Atom(InternedAtom),

    /// An unbound variable, identified by its VarId.
    /// Variable *bindings* live in the substitution, not here.
    Variable(VarId),

    /// A numeric constant. Using f64 for simplicity.
    /// If integer semantics matter, expand to a tagged union:
    ///   Number(NumericValue) where NumericValue is Int(i64) | Float(f64).
    Number(f64),

    /// A compound term: functor applied to arguments.
    /// `args` is a Vec<TermId> of length `arity`.
    /// The functor is an interned atom; arity is args.len().
    Compound {
        functor: InternedAtom,
        args: Vec<TermId>,
    },

    /// The empty list. Semantically identical to Atom(intern("nil")),
    /// but given a dedicated variant for ergonomics and to avoid
    /// a hash lookup on the critical path of list processing.
    Nil,
}
```

### Design Rationale: Why Arena + Indices

The central design decision is *arena allocation with index handles* rather than `Box`-based trees or reference-counted nodes.

**Why not `Box<TermNode>`?**
Boxed trees require recursive ownership. A compound term owns its children, which own their children, and so on. This creates three problems:
1. *Sharing is expensive.* If two compound terms share a subterm, you must either clone the entire subtree or introduce `Rc`/`Arc`, which adds reference counting overhead on every access.
2. *Lifetimes infect everything.* Borrowing into a boxed tree requires lifetime annotations that propagate through every function touching terms.
3. *Deep trees blow the stack.* Recursive drop on a deeply nested term can overflow the stack (Rust does not guarantee tail-call optimization for `Drop`).

**Why arena + indices?**
- `TermId` is `Copy` -- passing terms around is a `u32` copy. Zero-cost sharing.
- No lifetimes on term references. The arena owns everything; consumers hold indices.
- Terms persist until the entire arena is dropped. No use-after-free, no dangling pointers, no `Rc` cycles.
- Allocation is O(1) amortized (append to a `Vec`).
- Cache-friendly: terms are packed contiguously in memory.

**Trade-off acknowledged:** You cannot free individual terms. The arena grows monotonically. For an interactive interpreter where queries are short-lived, this is acceptable -- drop the arena between queries if memory pressure is a concern.

### Atom Interning

```rust
/// Maps strings to InternedAtom identifiers and back.
/// Interning ensures that atom comparison is O(1) (integer comparison)
/// rather than O(n) (string comparison).
pub struct AtomTable {
    /// Forward map: string -> id.
    to_id: HashMap<String, InternedAtom>,
    /// Reverse map: id -> string (for display/debug).
    to_str: Vec<String>,
}
```

The `AtomTable` is separate from the `TermArena` because atoms have a different lifecycle: they are interned once and reused across many terms, many arenas, and many queries. The arena is transient; the atom table is long-lived.

### The Arena

```rust
/// Append-only storage for term nodes.
pub struct TermArena {
    nodes: Vec<TermNode>,
}
```

The arena is deliberately minimal. It does not know about atom interning, variable naming, or any higher-level concern. Its sole job is to store `TermNode` values and hand back `TermId` handles.

## Operations

### Core Arena Operations

```rust
impl TermArena {
    /// Allocate a new term node and return its handle.
    /// O(1) amortized. Never fails (panics only on OOM or u32 overflow).
    pub fn alloc(&mut self, node: TermNode) -> TermId;

    /// Retrieve a reference to the node behind a TermId.
    /// O(1). Panics if the ID is out of bounds (violated Invariant A2).
    pub fn get(&self, id: TermId) -> &TermNode;

    /// Number of terms currently in the arena.
    pub fn len(&self) -> usize;
}
```

### Core AtomTable Operations

```rust
impl AtomTable {
    /// Intern a string, returning its InternedAtom.
    /// If the string was previously interned, returns the same InternedAtom.
    /// O(1) amortized (hash map lookup/insert).
    pub fn intern(&mut self, s: &str) -> InternedAtom;

    /// Retrieve the string behind an InternedAtom.
    /// O(1). Panics if the ID is invalid.
    pub fn resolve(&self, atom: InternedAtom) -> &str;
}
```

### Convenience Constructors

These are not strictly necessary but reduce boilerplate when building terms programmatically:

```rust
impl TermArena {
    /// Allocate an atom term. Requires the atom to already be interned.
    pub fn atom(&mut self, a: InternedAtom) -> TermId {
        self.alloc(TermNode::Atom(a))
    }

    /// Allocate a variable term.
    pub fn var(&mut self, v: VarId) -> TermId {
        self.alloc(TermNode::Variable(v))
    }

    /// Allocate a numeric term.
    pub fn number(&mut self, n: f64) -> TermId {
        self.alloc(TermNode::Number(n))
    }

    /// Allocate a compound term.
    pub fn compound(&mut self, functor: InternedAtom, args: Vec<TermId>) -> TermId {
        self.alloc(TermNode::Compound { functor, args })
    }

    /// Allocate the Nil term.
    pub fn nil(&mut self) -> TermId {
        self.alloc(TermNode::Nil)
    }

    /// Build a list from a slice of TermIds.
    /// `from_list(&[a, b, c])` produces `'.'(a, '.'(b, '.'(c, nil)))`.
    pub fn list(&mut self, elements: &[TermId], dot: InternedAtom) -> TermId {
        let mut current = self.nil();
        for &elem in elements.iter().rev() {
            current = self.compound(dot, vec![elem, current]);
        }
        current
    }

    /// Build a list with an explicit tail (partial list / dotted pair).
    /// `from_list_with_tail(&[a, b], T)` produces `'.'(a, '.'(b, T))`.
    pub fn list_with_tail(
        &mut self,
        elements: &[TermId],
        tail: TermId,
        dot: InternedAtom,
    ) -> TermId {
        let mut current = tail;
        for &elem in elements.iter().rev() {
            current = self.compound(dot, vec![elem, current]);
        }
        current
    }
}
```

### Traversal and Inspection

```rust
impl TermNode {
    /// Returns true if this term contains no variables.
    /// Must be called recursively via the arena for compound terms.
    pub fn is_ground(&self, arena: &TermArena) -> bool;

    /// Returns the set of VarIds occurring in this term.
    /// For compound terms, recurses through the arena.
    pub fn vars(&self, arena: &TermArena) -> HashSet<VarId>;

    /// Returns the depth of the term tree.
    /// Atoms, Variables, Numbers, and Nil have depth 0.
    /// Compound terms have depth 1 + max(depth of args).
    pub fn depth(&self, arena: &TermArena) -> usize;
}
```

Note: these recursive operations on arena-indexed terms require an explicit `arena` parameter because the `TermNode` does not own its children -- it holds `TermId` handles that must be resolved through the arena. This is the ergonomic cost of the arena design, and it is worth paying.

## Edge Cases

### Deeply Nested Terms

A term like `f(f(f(f(...))))` nested to depth 10,000 is representable in the arena (it is just 10,000 entries in a `Vec`). However, naive recursive traversal will overflow the stack. All recursive operations (equality checking, variable collection, depth computation, printing) must either:
- Use an explicit stack (iterative deepening), or
- Set a configurable depth limit and return an error when exceeded.

The arena representation actually *helps* here: since terms are stored flat in a `Vec`, you can iterate over them non-recursively for some operations (e.g., collecting all variables in the entire arena).

### Self-Referential Terms (The Occurs Check)

The term algebra is *well-founded*: every term has finite depth. A variable `X` cannot be unified with a term containing `X` (e.g., `X = f(X)` has no finite solution). This is enforced by the *occurs check* during [[unification]], not during term construction. The arena representation does not structurally prevent creating a "cycle" (you could allocate `f(id)` where `id` points to the compound itself), but the occurs check in [[unification]] must reject such bindings.

If the occurs check is omitted (as in standard Prolog for performance), self-referential terms become *rational trees* -- infinite but regular structures. The arena can represent these, but traversal algorithms must detect cycles or they will loop forever. This is a deliberate semantic choice: the Pramana interpreter should implement the occurs check by default for correctness, with an option to disable it for Prolog compatibility.

### Empty Argument Lists

A compound term with an empty argument list (`f()`, arity 0) is semantically identical to an atom `f`. The implementation should either:
- **Normalize eagerly:** When `args` is empty, store `Atom(functor)` instead of `Compound { functor, args: vec![] }`. This simplifies pattern matching downstream.
- **Normalize lazily:** Allow both representations but ensure equality comparison treats them as identical.

Recommendation: *normalize eagerly*. The `compound` constructor should check `args.is_empty()` and delegate to `atom` in that case. This upholds Law 3 (congruence) without requiring special-case equality logic.

### NaN in Numeric Terms

IEEE 754 specifies that `NaN != NaN`. This violates Law 1 (reflexivity). Two options:
- **Disallow NaN:** The `number` constructor rejects NaN values, returning an error or panicking. Arithmetic operations that would produce NaN (e.g., `0.0 / 0.0`) should raise a domain error instead.
- **Use total ordering:** Implement `Eq` for `Number` using `f64::total_cmp`, which treats all NaN bit patterns as equal and orders them consistently.

Recommendation: *disallow NaN*. A logic interpreter should not silently propagate undefined numeric results. Fail loudly.

### The Anonymous Variable `_`

In Prolog, `_` is the anonymous variable: each occurrence is a distinct, fresh variable that the user never references by name. During parsing, each `_` should be assigned a unique `VarId` that is not shared with any other occurrence. The term representation does not need a special variant for this -- anonymous variables are just regular `Variable(VarId)` nodes whose IDs are guaranteed to be unique and unreferenced elsewhere.

### Arity Limits

Since `args` is a `Vec<TermId>`, arity is bounded only by memory. In practice, predicates with arity > 20 are extremely rare. No artificial limit is needed, but implementations may want to log a warning for arity > 255 as a hint that something may have gone wrong during parsing.

## Relationships

### Relates to: [[substitution]]

A [[substitution]] is a mapping from `VarId` to `TermId`. Applying a substitution to a term replaces each variable with its bound value, producing a new term (or a chain of lookups if the substitution maps variables to other variables). The term representation must be designed so that substitution application is efficient -- this is why variables are identified by `VarId(u32)` rather than by name strings.

### Relates to: [[unification]]

[[Unification]] takes two terms and attempts to find a most general [[substitution]] that makes them structurally identical. The term representation is the input to unification. The choice of arena + indices means unification operates on `TermId` pairs, resolving through the arena, rather than pattern-matching on owned tree nodes. This affects the unification algorithm's structure: it must carry an `&TermArena` (or `&mut TermArena` if it allocates result terms) through every recursive call.

## Examples

### Example 1: Building the term `parent(tom, bob)`

```
// Setup
let mut atoms = AtomTable::new();
let mut arena = TermArena::new();

// Intern the atom strings
let parent = atoms.intern("parent");
let tom    = atoms.intern("tom");
let bob    = atoms.intern("bob");

// Allocate leaf terms
let tom_term = arena.atom(tom);   // TermId(0)
let bob_term = arena.atom(bob);   // TermId(1)

// Allocate the compound term
let goal = arena.compound(parent, vec![tom_term, bob_term]); // TermId(2)

// Inspect
match arena.get(goal) {
    TermNode::Compound { functor, args } => {
        assert_eq!(*functor, parent);
        assert_eq!(args.len(), 2);
        assert!(matches!(arena.get(args[0]), TermNode::Atom(a) if *a == tom));
        assert!(matches!(arena.get(args[1]), TermNode::Atom(a) if *a == bob));
    }
    _ => panic!("expected compound"),
}
```

### Example 2: Building the list `[a, b, c]`

The list `[a, b, c]` desugars to `'.'(a, '.'(b, '.'(c, nil)))`.

```
let mut atoms = AtomTable::new();
let mut arena = TermArena::new();

let a   = atoms.intern("a");
let b   = atoms.intern("b");
let c   = atoms.intern("c");
let dot = atoms.intern(".");

let a_term = arena.atom(a);
let b_term = arena.atom(b);
let c_term = arena.atom(c);

// Using the convenience constructor
let list = arena.list(&[a_term, b_term, c_term], dot);

// The structure is: '.'(a, '.'(b, '.'(c, nil)))
match arena.get(list) {
    TermNode::Compound { functor, args } => {
        assert_eq!(*functor, dot);
        assert_eq!(args.len(), 2);
        // Head is 'a'
        assert!(matches!(arena.get(args[0]), TermNode::Atom(x) if *x == a));
        // Tail is '.'(b, '.'(c, nil))
        match arena.get(args[1]) {
            TermNode::Compound { functor: f2, args: args2 } => {
                assert_eq!(*f2, dot);
                assert!(matches!(arena.get(args2[0]), TermNode::Atom(x) if *x == b));
                // Inner tail is '.'(c, nil)
                match arena.get(args2[1]) {
                    TermNode::Compound { functor: f3, args: args3 } => {
                        assert_eq!(*f3, dot);
                        assert!(matches!(arena.get(args3[0]), TermNode::Atom(x) if *x == c));
                        assert!(matches!(arena.get(args3[1]), TermNode::Nil));
                    }
                    _ => panic!("expected compound"),
                }
            }
            _ => panic!("expected compound"),
        }
    }
    _ => panic!("expected compound"),
}
```

### Example 3: A term with variables -- `ancestor(X, Y)`

```
let mut atoms = AtomTable::new();
let mut arena = TermArena::new();

let ancestor = atoms.intern("ancestor");

let x = arena.var(VarId(0));  // X
let y = arena.var(VarId(1));  // Y

let term = arena.compound(ancestor, vec![x, y]);

// This term is NOT ground
assert!(!arena.get(term).is_ground(&arena));

// It contains two variables
let vars = arena.get(term).vars(&arena);
assert_eq!(vars.len(), 2);
assert!(vars.contains(&VarId(0)));
assert!(vars.contains(&VarId(1)));
```

### Example 4: Sharing via TermId

A key advantage of the arena is zero-cost sharing. The same subterm can appear in multiple compound terms without cloning:

```
let mut atoms = AtomTable::new();
let mut arena = TermArena::new();

let f = atoms.intern("f");
let g = atoms.intern("g");
let a = atoms.intern("a");

let shared = arena.atom(a);          // TermId(0) -- allocated once

let t1 = arena.compound(f, vec![shared, shared]);  // f(a, a) -- shares the same TermId
let t2 = arena.compound(g, vec![shared]);           // g(a)    -- also shares it

// `shared` was allocated once. t1 and t2 both reference TermId(0).
// No cloning, no reference counting, no lifetime annotations.
```

### Example 5: The Herbrand universe for a minimal signature

Consider the signature Sigma = { a/0, f/1 }. The Herbrand universe is:

```
a
f(a)
f(f(a))
f(f(f(a)))
...
```

This is a countably infinite set. In the arena, you can generate as many elements as memory allows:

```
let mut atoms = AtomTable::new();
let mut arena = TermArena::new();

let a_atom = atoms.intern("a");
let f_atom = atoms.intern("f");

let mut current = arena.atom(a_atom);
for _ in 0..1000 {
    current = arena.compound(f_atom, vec![current]);
}
// `current` is now f(f(f(...f(a)...))) with depth 1000.
// The arena contains 1001 entries. Each is O(1) to allocate.
```

## Appendix: Term Grammar (BNF)

For reference, here is the abstract syntax of terms in BNF notation, corresponding to the formal definition above:

```
<term>     ::= <atom>
             | <variable>
             | <number>
             | <compound>
             | <list>

<atom>     ::= <lowercase-identifier>
             | <quoted-string>

<variable> ::= <uppercase-identifier>
             | "_"

<number>   ::= <integer-literal>
             | <float-literal>

<compound> ::= <atom> "(" <term> ("," <term>)* ")"

<list>     ::= "[" "]"
             | "[" <term> ("," <term>)* "]"
             | "[" <term> ("," <term>)* "|" <term> "]"
```

This grammar is *concrete syntax* -- the parser transforms it into `TermNode` values stored in the arena. The list productions desugar into compound terms with functor `.` as described in the Lists as Syntactic Sugar section.

## Appendix: Memory Layout and Performance Characteristics

| Operation                     | Time       | Space          |
|-------------------------------|------------|----------------|
| `arena.alloc(node)`           | O(1) amort | +1 TermNode    |
| `arena.get(id)`               | O(1)       | 0              |
| `atom_table.intern(s)`        | O(\|s\|) amort | +\|s\| bytes (first time only) |
| `atom_table.resolve(atom)`    | O(1)       | 0              |
| Structural equality (depth d) | O(d)       | O(d) stack or explicit stack |
| Variable collection (size n)  | O(n)       | O(n)           |
| List construction (length k)  | O(k)       | +k compounds + 1 nil |
| `TermId` comparison           | O(1)       | 0              |

The arena's `Vec<TermNode>` will typically be the largest single allocation in the interpreter. For a session with 100,000 terms, at roughly 40 bytes per `TermNode` (enum discriminant + padding + `Vec` header for compound args), this is approximately 4 MB -- trivial for modern systems.

## Appendix: Comparison with Alternative Representations

| Approach             | Sharing cost | Lifetime ergonomics | Deep tree safety | Cache locality |
|----------------------|-------------|---------------------|------------------|----------------|
| `Box<TermNode>`      | Clone or Rc  | Infectious lifetimes | Stack overflow on drop | Poor (pointer chasing) |
| `Rc<TermNode>`       | Rc::clone O(1) | No lifetimes needed | Stack overflow on drop | Poor |
| `Arc<TermNode>`      | Arc::clone O(1) | No lifetimes, thread-safe | Stack overflow on drop | Poor |
| Arena + `TermId`     | Copy O(1)   | No lifetimes        | Safe (flat storage) | Excellent |
| Hash-consing         | O(1) dedup  | No lifetimes        | Safe              | Good, but hash overhead |

The arena approach wins on the combination of simplicity, performance, and ergonomics for this use case. Hash-consing is worth considering if term deduplication becomes important (e.g., for tabling/memoization), but it adds complexity to allocation and is not needed initially.
