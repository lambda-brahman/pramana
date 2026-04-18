---
slug: clause
title: Clause
tags: [concept, core]
relationships:
  depends-on: [term]
  relates-to: [knowledge-base, resolution]
---

# Clause

## Intuitive Overview

A clause is the fundamental unit of knowledge in Prolog. Every statement a Prolog program makes about the world takes the form of a clause. There are two kinds:

- **Fact**: A clause with no body. `parent(tom, bob).` asserts unconditionally that Tom is a parent of Bob. There is nothing to prove -- the relationship simply holds.
- **Rule**: A clause with a head and a body. `ancestor(X, Y) :- parent(X, Y).` asserts that X is an ancestor of Y *if* X is a parent of Y. The head (`ancestor(X, Y)`) is the conclusion; the body (`parent(X, Y)`) is the premise that must be established first.

A third form is worth mentioning even though it is not stored in the knowledge base:

- **Query (goal)**: A clause with no head. `?- ancestor(tom, bob).` asks the system to prove that Tom is an ancestor of Bob. It is all premise, no conclusion -- pure demand.

### Why clauses exist

The entire execution model of Prolog revolves around clauses. When the system receives a query, it searches the knowledge base for clauses whose heads unify with the current goal. Each successful unification either resolves the goal immediately (if the clause is a fact) or replaces it with new subgoals (if the clause is a rule). This process -- SLD resolution -- is the heartbeat of the interpreter. Clauses are what it beats on.

### The logical reading

Logically, a definite clause is a universally quantified implication:

> "For all X, Y: if parent(X, Y) then ancestor(X, Y)."

But Prolog programmers rarely think in terms of universal quantifiers and disjunctions. They read `ancestor(X, Y) :- parent(X, Y).` procedurally: "To prove `ancestor(X, Y)`, prove `parent(X, Y)`." Both readings are valid. The logical reading ensures soundness; the procedural reading guides implementation.

---

## Formal Definition

A **definite clause** is a first-order formula of the form:

```
forall X_1 ... X_n . (B_1 /\ B_2 /\ ... /\ B_m -> H)
```

where H (the **head**) is an atom, and each B_i (a **body goal**) is an atom. The variables X_1 ... X_n are exactly the free variables appearing in H and B_1 ... B_m.

In Prolog notation this is written:

```prolog
H :- B_1, B_2, ..., B_m.
```

Three degenerate cases:

| Form       | Constraint | Prolog syntax          | Logical reading                              |
|------------|------------|------------------------|----------------------------------------------|
| **Fact**   | m = 0      | `H.`                  | H is unconditionally true (for all bindings)  |
| **Rule**   | m >= 1     | `H :- B_1, ..., B_m.` | H holds if all B_i hold                      |
| **Query**  | no head    | `?- B_1, ..., B_m.`   | Prove that all B_i hold simultaneously        |

An **atom** here means a compound term used in predicate position: a functor applied to zero or more argument terms. For example, `parent(tom, X)` is the atom with functor `parent`, arity 2, and arguments `tom` (a constant) and `X` (a variable).

### Horn clause connection

Every definite clause is a Horn clause (a disjunction with at most one positive literal). The contrapositive of `B_1 /\ ... /\ B_m -> H` is equivalent to the clause `H \/ ~B_1 \/ ... \/ ~B_m`, which has exactly one positive literal (H). Facts correspond to unit clauses (a single positive literal). Queries correspond to **goal clauses** (all literals negative -- no positive literal at all).

---

## Algebraic Laws and Invariants

### Invariant 1: Variable scope is clause-local

All variables in a clause are implicitly universally quantified over that clause alone. Variable names do not leak across clause boundaries. Two clauses that both use `X` are talking about completely independent bindings of `X`. This is not a convention -- it is a semantic requirement. The `num_vars` field and offset-based renaming exist to enforce this.

### Invariant 2: Offset renaming preserves clause semantics

If clause C contains variables `{v_0, v_1, ..., v_{k-1}}` and we rename them to `{v_{offset}, v_{offset+1}, ..., v_{offset+k-1}}`, the resulting clause C' is an **alphabetic variant** of C. Alphabetic variants are logically equivalent -- they assert the same universally quantified formula.

Formally, for any substitution theta that is a bijective variable renaming:

```
C ≡ C * theta  (logical equivalence under alphabetic variance)
```

### Invariant 3: Offset freshness guarantee

The offset-based scheme guarantees no variable capture during resolution if the following protocol is maintained:

```
Pre:  global_counter is at least max(VarId) + 1 across all currently active terms
Post: after renaming clause C with offset = global_counter,
      global_counter' = global_counter + C.num_vars
      All VarIds in the renamed clause are in [global_counter, global_counter + C.num_vars)
      This range does not overlap with any previously allocated range
```

This is cheaper than the traditional approach of collecting all variables and generating fresh names. It requires O(1) bookkeeping per clause application instead of O(|vars|).

### Invariant 4: Head functor determines indexing

The functor and arity of the head atom uniquely determine which goal atoms can possibly unify with this clause. This is not an algebraic law in the strict sense, but it is an invariant the knowledge base relies on for first-argument indexing:

```
unify(goal, clause.head) = Fail  if  functor(goal) != functor(clause.head)
                                  or  arity(goal) != arity(clause.head)
```

### Invariant 5: Body ordering is semantically significant

Unlike pure logic (where conjunction is commutative), Prolog evaluates body goals left to right. The ordering of body goals affects:

- **Termination**: reordering can turn a terminating program into a non-terminating one
- **Efficiency**: goals that fail quickly should appear early (fail-fast)
- **Side effects**: if the language later supports `write/1` or `assert/1`, ordering is observable

Therefore, `body: Vec<TermId>` is an ordered sequence, not a set.

---

## Rust Type Sketch

```rust
/// A definite clause: head :- body_0, body_1, ..., body_{n-1}.
///
/// All TermIds point into the same TermArena that owns this clause's terms.
/// Variables are numbered 0..num_vars-1 within the clause. During resolution,
/// they are shifted by a global offset to ensure freshness.
#[derive(Debug, Clone)]
struct Clause {
    /// The head atom. A TermId pointing to a compound term in the arena.
    /// The outermost functor of this term is the clause's predicate.
    head: TermId,

    /// Body goals, evaluated left-to-right during SLD resolution.
    /// Empty for facts.
    body: Vec<TermId>,

    /// Count of distinct variables in this clause (0-indexed: Var(0)..Var(num_vars-1)).
    /// Used by the offset-based renaming scheme.
    num_vars: u32,
}

/// A query (goal clause): ?- goal_0, goal_1, ..., goal_{n-1}.
///
/// Queries have no head. They represent the "question" the user asks the system.
/// Structurally similar to a clause body, but kept as a distinct type because
/// queries are never stored in the knowledge base and never participate as
/// "clauses" in resolution -- they are the *initiators* of resolution.
#[derive(Debug, Clone)]
struct Query {
    /// Goals to be proven, evaluated left-to-right.
    goals: Vec<TermId>,

    /// Count of distinct variables in this query.
    num_vars: u32,
}
```

### Why this representation

**Why `TermId` and not inline `Term`?** Terms are recursive (a compound term contains other terms), and Rust does not allow unsized recursive structs on the stack. The standard solution is `Box<Term>`, but that scatters allocations across the heap, destroying cache locality. Instead, all terms live in a `TermArena` (a flat `Vec<TermNode>`), and `TermId(u32)` is a 4-byte index into that arena. This gives us:

- Cache-friendly traversal (sequential memory layout)
- Cheap copying (copy a u32, not a tree)
- Structural sharing (two clauses can reference the same subterm)
- Natural deduplication via hash-consing (optional, but the arena enables it)

**Why `num_vars: u32`?** The offset-based renaming scheme needs to know how many variables a clause contains *without traversing the term tree*. Computing this at parse time and storing it in the clause header makes resolution O(1) in bookkeeping cost per clause application. A `u32` supports up to ~4 billion distinct variables per clause, which is wildly more than any real program would contain.

**Why separate `Clause` and `Query`?** They have different shapes (query has no head) and different lifetimes (clauses persist in the knowledge base; queries are transient). A single enum could unify them, but separate types make the API honest: functions that need a head can require `&Clause`, and functions that operate on goal lists can accept either via a trait or by extracting `&[TermId]`.

### Design alternative considered and rejected

An enum representation:

```rust
enum ClauseKind {
    Fact { head: TermId, num_vars: u32 },
    Rule { head: TermId, body: Vec<TermId>, num_vars: u32 },
    Query { goals: Vec<TermId>, num_vars: u32 },
}
```

This was rejected because it collapses three distinct roles into one type. Resolution needs to match on the kind at every step, and the `Fact` vs `Rule` distinction adds branching without benefit -- a fact is just a rule with an empty body. The `Clause` struct already handles this uniformly via `body.is_empty()`. Queries are structurally different enough (no head) to warrant a separate type.

---

## Operations

### `is_fact`

```rust
impl Clause {
    /// Returns true if this clause is a fact (no body goals).
    fn is_fact(&self) -> bool {
        self.body.is_empty()
    }
}
```

A fact has no proof obligations. When resolution selects a fact, the current goal is immediately resolved (pending unification of the head with the goal atom).

### `rename_vars`

```rust
impl Clause {
    /// Create an alphabetic variant of this clause by shifting all variable IDs
    /// by `offset`. Every Var(i) in the original becomes Var(i + offset) in the
    /// result. New terms are allocated in `arena`.
    ///
    /// Precondition: offset + self.num_vars does not overflow u32.
    /// Postcondition: returned clause has the same num_vars; its head and body
    ///                point to freshly allocated terms in `arena` with shifted VarIds.
    fn rename_vars(&self, offset: u32, arena: &mut TermArena) -> Clause {
        let head = arena.shift_vars(self.head, offset);
        let body = self.body.iter()
            .map(|&goal| arena.shift_vars(goal, offset))
            .collect();
        Clause { head, body, num_vars: self.num_vars }
    }
}
```

This is the core of the freshness guarantee. Every time resolution applies a clause, it must rename variables to avoid capture. The offset-based approach works as follows:

1. The resolver maintains a `global_counter: u32`, starting at 0 (or at `query.num_vars` after processing the initial query).
2. Before using clause C, call `C.rename_vars(global_counter, &mut arena)`.
3. Increment `global_counter += C.num_vars`.
4. The renamed clause's variables occupy the range `[global_counter_old, global_counter_old + C.num_vars)`, guaranteed disjoint from all prior ranges.

### `head_functor`

```rust
impl Clause {
    /// Extract the functor name and arity from the head atom.
    /// Used for first-argument indexing in the knowledge base.
    ///
    /// Panics if the head term is not a compound term (which would indicate
    /// a malformed clause -- heads must always be atoms/compound terms).
    fn head_functor(&self, arena: &TermArena) -> (InternedAtom, u8) {
        match arena.get(self.head) {
            TermNode::Compound { functor, arity, .. } => (functor, arity),
            _ => panic!("clause head must be a compound term"),
        }
    }
}
```

The return type `(InternedAtom, u8)` pairs an interned functor name with the arity (up to 255 arguments -- Prolog implementations traditionally limit arity, and u8 is generous). This pair serves as the key for knowledge-base indexing: when a goal `ancestor(tom, Y)` arrives, the resolver looks up `(ancestor, 2)` to find candidate clauses.

### `goals` (on Query)

```rust
impl Query {
    /// Returns the goal list as a slice.
    fn goals(&self) -> &[TermId] {
        &self.goals
    }
}
```

---

## Edge Cases

### Ground clauses (no variables)

```prolog
parent(tom, bob).
```

Here `num_vars = 0`. The `rename_vars` operation is a no-op (no variables to shift), but it still allocates fresh copies of the terms in the arena. An optimization is to detect `num_vars == 0` and skip renaming entirely, reusing the original TermIds. This is safe because ground terms cannot participate in variable capture.

```rust
fn rename_vars(&self, offset: u32, arena: &mut TermArena) -> Clause {
    if self.num_vars == 0 {
        return self.clone(); // no variables to rename; safe to share TermIds
    }
    // ... full renaming logic
}
```

### Anonymous variables

In Prolog, `_` is the anonymous variable. Each occurrence of `_` is independent -- it matches anything and is never bound. During parsing, each `_` must be assigned a unique VarId:

```prolog
foo(_, _).
```

If the parser has seen no other variables yet, this becomes:

```
head: Compound { functor: foo, arity: 2, args: [Var(0), Var(1)] }
num_vars: 2
```

The two `_` get VarIds 0 and 1 respectively. They are *not* the same variable. The `num_vars` count includes anonymous variables because the renaming scheme must allocate fresh slots for them too (even though they will never be referenced by name after parsing).

### Very long bodies

```prolog
big_rule(X) :- a(X), b(X), c(X), ..., z(X).
```

A clause with many body goals produces a long `Vec<TermId>`. This is not a problem for the representation -- `Vec` handles arbitrary lengths. However, during resolution, each body goal becomes a subgoal, and the resolver must process them left-to-right. A clause with N body goals expands the goal stack by N-1 goals (replacing the current goal with N new ones). Pathologically large bodies can deepen the search tree significantly.

No special handling is needed in the `Clause` struct itself, but the resolver should be aware that large bodies increase memory pressure on the goal stack.

### Unit clauses (facts) in pattern matching

Code that processes clauses must not assume the body is non-empty. A common mistake:

```rust
// WRONG: panics on facts
let first_goal = clause.body[0];

// CORRECT: check first
if let Some(&first_goal) = clause.body.first() {
    // handle rule
} else {
    // handle fact
}
```

The `is_fact()` method exists precisely to make this distinction explicit.

### Clause with a single variable used many times

```prolog
same(X, X, X).
```

Here `num_vars = 1` even though `X` appears three times. The count tracks *distinct* variables, not *occurrences*. This is correct for the offset scheme: we only need one fresh slot for `X`, and all three occurrences will be shifted to the same fresh VarId.

### Queries with zero goals

```prolog
?- .
```

This is syntactically odd but logically valid -- a query with no goals succeeds trivially (the empty conjunction is true). The `Query` struct allows `goals` to be empty. Whether the parser accepts this syntax is a separate concern.

---

## Relationships

### Depends on: `term`

Clauses are made of terms. The `head` is a term (specifically a compound term / atom). Each body goal is a term. The `TermId` and `TermArena` types come from the term module. Without the term representation, clauses have no content -- they would be empty shells.

The design choice of arena + indices (see `term` artifact) directly shapes the clause representation: heads and bodies store `TermId` indices, not owned `Term` trees. This coupling is intentional and load-bearing.

### Relates to: `knowledge-base`

A knowledge base is a collection of clauses, typically indexed by head functor and arity for efficient lookup. The `head_functor` operation on `Clause` exists specifically to support knowledge-base indexing. Clauses are the *content* that the knowledge base *organizes*.

The knowledge base must maintain clause ordering within each functor/arity group, because Prolog tries clauses in the order they were defined. This ordering affects which solutions are found first (and whether the search terminates at all).

### Relates to: `resolution`

SLD resolution is the consumer of clauses. The resolution algorithm:

1. Picks the leftmost goal from the current goal list.
2. Searches the knowledge base for clauses whose head functor matches the goal's functor.
3. For each candidate clause, renames variables (via `rename_vars`) to ensure freshness.
4. Attempts to unify the goal with the renamed clause's head.
5. On success, replaces the goal with the clause's body goals (under the unifying substitution).

Every step of this process touches the `Clause` struct. The `rename_vars` method is called at step 3. The `head` field is used at step 4. The `body` field provides the replacement goals at step 5. The `num_vars` field drives the offset arithmetic.

---

## Examples

### Setup: The term arena

Before constructing clauses, we need a `TermArena` populated with terms. Assume the following interned atoms and term layout:

```
InternedAtom table:
  "tom"      -> Atom(0)
  "bob"      -> Atom(1)
  "ann"      -> Atom(2)
  "parent"   -> Atom(3)
  "ancestor" -> Atom(4)
```

### Example 1: A fact

```prolog
parent(tom, bob).
```

Arena state after parsing this clause:

```
TermArena:
  [0] Atom(0)                              -- tom
  [1] Atom(1)                              -- bob
  [2] Compound { functor: Atom(3), arity: 2, args: [TermId(0), TermId(1)] }
                                            -- parent(tom, bob)
```

Resulting clause:

```rust
Clause {
    head: TermId(2),   // parent(tom, bob)
    body: vec![],      // no body -- this is a fact
    num_vars: 0,       // no variables
}
```

`is_fact()` returns `true`. `head_functor()` returns `(Atom(3), 2)`, i.e., `parent/2`.

### Example 2: A rule with one body goal

```prolog
ancestor(X, Y) :- parent(X, Y).
```

Variables X and Y are assigned VarId(0) and VarId(1) during parsing.

Arena state (continuing from above):

```
TermArena:
  ...
  [3] Var(0)                                -- X
  [4] Var(1)                                -- Y
  [5] Compound { functor: Atom(4), arity: 2, args: [TermId(3), TermId(4)] }
                                            -- ancestor(X, Y)
  [6] Compound { functor: Atom(3), arity: 2, args: [TermId(3), TermId(4)] }
                                            -- parent(X, Y)
```

Note that `TermId(3)` (Var(0), representing X) is shared between the head and body. Both `ancestor(X, Y)` and `parent(X, Y)` point to the same variable nodes. This structural sharing is natural with the arena approach.

Resulting clause:

```rust
Clause {
    head: TermId(5),       // ancestor(X, Y)
    body: vec![TermId(6)], // [parent(X, Y)]
    num_vars: 2,           // two distinct variables: X=Var(0), Y=Var(1)
}
```

`is_fact()` returns `false`. `head_functor()` returns `(Atom(4), 2)`, i.e., `ancestor/2`.

### Example 3: A rule with two body goals

```prolog
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
```

Variables: X = Var(0), Y = Var(1), Z = Var(2).

Arena state (continuing):

```
TermArena:
  ...
  [7]  Var(0)                               -- X  (may share with TermId(3) if deduped)
  [8]  Var(1)                               -- Y
  [9]  Var(2)                               -- Z
  [10] Compound { functor: Atom(4), arity: 2, args: [TermId(7), TermId(8)] }
                                            -- ancestor(X, Y)       [head]
  [11] Compound { functor: Atom(3), arity: 2, args: [TermId(7), TermId(9)] }
                                            -- parent(X, Z)         [body goal 1]
  [12] Compound { functor: Atom(4), arity: 2, args: [TermId(9), TermId(8)] }
                                            -- ancestor(Z, Y)       [body goal 2]
```

Resulting clause:

```rust
Clause {
    head: TermId(10),                    // ancestor(X, Y)
    body: vec![TermId(11), TermId(12)],  // [parent(X, Z), ancestor(Z, Y)]
    num_vars: 3,                         // three distinct variables: X, Y, Z
}
```

### Example 4: Offset-based renaming in action

Suppose the resolver is processing the query `?- ancestor(tom, Y).` and the global variable counter stands at `global_counter = 1` (because the query's Y was assigned Var(0), so we already consumed one slot).

The resolver selects Example 3's clause (`ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).`, with `num_vars = 3`). It calls `rename_vars(1, &mut arena)`:

```
Before renaming:          After renaming (offset = 1):
  Var(0) -> X               Var(1) -> X'
  Var(1) -> Y               Var(2) -> Y'
  Var(2) -> Z               Var(3) -> Z'
```

New arena entries:

```
TermArena:
  ...
  [13] Var(1)                               -- X' (shifted from Var(0))
  [14] Var(2)                               -- Y' (shifted from Var(1))
  [15] Var(3)                               -- Z' (shifted from Var(2))
  [16] Compound { functor: Atom(4), arity: 2, args: [TermId(13), TermId(14)] }
                                            -- ancestor(X', Y')     [renamed head]
  [17] Compound { functor: Atom(3), arity: 2, args: [TermId(13), TermId(15)] }
                                            -- parent(X', Z')       [renamed body goal 1]
  [18] Compound { functor: Atom(4), arity: 2, args: [TermId(15), TermId(14)] }
                                            -- ancestor(Z', Y')     [renamed body goal 2]
```

The global counter advances: `global_counter = 1 + 3 = 4`. The next clause application will rename starting from Var(4), guaranteeing no overlap.

Now the resolver unifies the query goal `ancestor(tom, Var(0))` with the renamed head `ancestor(Var(1), Var(2))`, producing substitution `{Var(1) -> tom, Var(2) -> Var(0)}`. The body goals `parent(Var(1), Var(3))` and `ancestor(Var(3), Var(2))` are added to the goal stack (with the substitution applied), becoming `parent(tom, Var(3))` and `ancestor(Var(3), Var(0))`.

This is the complete cycle: clause lookup, renaming, unification, body expansion. The `Clause` struct participates in every step.
