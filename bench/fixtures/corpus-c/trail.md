---
slug: trail
title: Trail
tags: [concept, core]
relationships:
  depends-on: [substitution]
  relates-to: [choice-point, resolution]
---

# Trail

## Intuitive Overview

The trail is an undo log. It exists because predicate logic search is speculative: the engine guesses which clause might satisfy a goal, commits to that guess by binding variables during unification, and then discovers — sometimes many steps later — that the guess was wrong. At that point every binding made since the guess must be erased, cleanly and completely, so the engine can try the next clause as if the failed attempt never happened.

Without the trail, undoing bindings would require either copying the entire substitution at every choice point (expensive in space) or walking the substitution to figure out which bindings are "new" (expensive in time). The trail solves this by recording, at binding time, *which* variable was bound. Undoing is then a simple stack pop: walk backward through the trail entries, removing each recorded binding from the substitution.

Think of it like this: you are filling in a crossword puzzle in pen. Before you try a speculative word, you write down on a separate slip of paper which squares you are about to fill in. If the word turns out wrong, you consult the slip, erase exactly those squares, and try a different word. The trail is that slip of paper. The substitution is the crossword grid.

### Why not just copy the substitution?

A copy-on-choice-point strategy (sometimes called "environment saving") duplicates the entire substitution map at every branch. For a substitution with *s* bindings and a search tree with *c* choice points, this costs O(s * c) space. The trail strategy costs O(b) space where *b* is the total number of bindings made — typically much smaller, because most choice points add only a handful of new bindings.

### Where the trail sits in the engine

```
  Query
    |
    v
  Resolution loop
    |
    +---> Select goal
    +---> Find matching clauses --> create ChoicePoint (mark the trail here)
    +---> Unify goal with clause head
    |       |
    |       +--> bind variables --> push onto Trail
    |       +--> bind variables --> push onto Trail
    |
    +---> If unification fails or later goal fails:
    |       |
    |       +--> Backtrack to ChoicePoint
    |       +--> Trail.undo(mark, &mut substitution)
    |       +--> Try next clause
    |
    +---> If all clauses exhausted: backtrack further
```

The trail is touched by exactly two subsystems: **unification** (which pushes entries) and **backtracking** (which pops them). This narrow interface is a key design virtue — it means the trail can be understood, tested, and optimized in isolation.

## Formal Definition

### Structure

The trail is a finite sequence of trail entries:

```
T = [e_1, e_2, ..., e_n]    where each e_i in VarId
```

Each entry `e_i` records the identity of a variable that was bound in the substitution during forward computation.

### Trail Mark

A **trail mark** is an index into the trail, specifically the trail's length at the moment the mark is taken:

```
Mark = usize

mark(T) = |T|
```

Trail marks are created when a choice point is established. They record "how long the trail was before this speculative branch began," so that all entries pushed *after* the mark can be attributed to the speculative branch and undone if needed.

### Undo Operation

Given a trail `T` with current length `n` and a mark `m` where `0 <= m <= n`:

```
undo(T, m, S) :
    for i = n down to m + 1:
        S := S \ {e_i -> _}      // remove binding for variable e_i
    T := T[1..m]                  // truncate trail to length m
```

The iteration order (high to low) matters for semantic clarity — it reverses the binding sequence — though for a `HashMap`-based substitution the removals are commutative and order does not affect correctness. For more structured substitution representations (e.g., union-find with path compression), reversal order can matter.

### Invariants

1. **Trail length consistency**: After `undo(T, m, S)`, `|T| = m`.
2. **Substitution consistency**: After `undo(T, m, S)`, every variable recorded in `T[m+1..n]` has no binding in `S`.
3. **Monotonic marks**: Trail marks obtained from successive choice points in a single branch form a non-decreasing sequence: `m_1 <= m_2 <= ... <= m_k`. (They are strictly increasing unless a choice point is created with zero intervening bindings.)
4. **Coverage**: Every variable bound in the substitution during forward computation has a corresponding trail entry. If a variable was already bound (i.e., the unification is re-confirming an existing binding rather than creating a new one), no trail entry is created.

## Algebraic Properties

### The trail is a stack (LIFO)

Entries are pushed during forward computation and popped (in reverse order) during backtracking. This gives the trail **stack discipline**: the last binding made is the first undone.

```
push(push(T, x), y).undo(mark) = push(T, x)    when mark = |push(T, x)|
```

### Trail marks partition the trail into segments

If choice points are created at marks `m_0 = 0, m_1, m_2, ..., m_k`, the trail is partitioned into segments:

```
T = [e_1 .. e_{m_1}] ++ [e_{m_1+1} .. e_{m_2}] ++ ... ++ [e_{m_{k-1}+1} .. e_{m_k}] ++ [e_{m_k+1} .. e_n]
```

Each segment contains the bindings made between consecutive choice points. Backtracking to choice point `j` undoes all segments after `m_j`.

### Undo is the inverse of forward binding

If the forward phase performs the binding sequence `[bind X, bind Y, bind Z]`, undo performs `[unbind Z, unbind Y, unbind X]`. The composition is the identity on the substitution (restricted to those variables):

```
let S_0 = S.clone();
trail.push(X); subst.bind(X, t1);
trail.push(Y); subst.bind(Y, t2);
trail.push(Z); subst.bind(Z, t3);
trail.undo(mark, &mut subst);
// Now subst restricted to {X, Y, Z} equals S_0 restricted to {X, Y, Z}
```

### Trail + Substitution form a reversible computation

The pair `(Trail, Substitution)` together support **reversible computation**: any sequence of bind operations can be exactly undone, restoring the substitution to its prior state. This is the algebraic property that makes backtracking search correct.

More precisely, if we define:

```
State = (Trail, Substitution)
Forward(State, bindings) -> State'
Undo(State', mark) -> State''
```

Then `State'' = State` (restricted to the variables that were unbound at `State`). Variables that were *already* bound before the forward phase are untouched by both forward and undo.

### Idempotence of undo

Undoing to the same mark twice is a no-op on the second call:

```
trail.undo(m, &mut subst);
trail.undo(m, &mut subst);  // no effect — trail is already at length m
```

This follows from the truncation semantics: after the first undo, `|T| = m`, so the second undo finds no entries to remove.

## Rust Type Sketch

```rust
/// An index identifying a logic variable in the term arena.
/// (Defined in the term/variable module; reproduced here for context.)
type VarId = usize;

/// A snapshot of the trail length, used to undo bindings back to a prior state.
/// Created when a choice point is established.
type TrailMark = usize;

/// The substitution maps variables to the terms they are bound to.
/// (Defined in the substitution module; reproduced here for interface context.)
/// Uses HashMap<VarId, TermId> as per the project's semantic decision.
struct Substitution {
    bindings: HashMap<VarId, TermId>,
}

/// The trail: an undo log for variable bindings.
///
/// Design rationale:
/// - `Vec<VarId>` is the simplest viable representation. Each entry is just the
///   variable that was bound — we do not need to record *what* it was bound to,
///   because undo only needs to *remove* the binding, not restore a prior value.
///   (Variables in Prolog are either unbound or bound-once; there is no "rebinding"
///   during forward computation.)
/// - `Vec` gives us O(1) amortized push, O(1) mark (just read the length), and
///   O(k) undo where k is the number of entries to remove.
/// - Trail marks are plain `usize` indices rather than a separate type because
///   they are simple, copyable, and their semantics are transparent. A newtype
///   wrapper (e.g., `struct TrailMark(usize)`) could be added later for type
///   safety without changing the representation.
struct Trail {
    entries: Vec<VarId>,
}

impl Trail {
    /// Create an empty trail.
    fn new() -> Self {
        Trail { entries: Vec::new() }
    }

    /// Save the current trail position. Returns a mark that can later be passed
    /// to `undo` to restore the substitution to its current state.
    ///
    /// O(1).
    fn mark(&self) -> TrailMark {
        self.entries.len()
    }

    /// Record that `var` was just bound in the substitution. Must be called by
    /// the unification procedure every time a previously-unbound variable
    /// receives a binding.
    ///
    /// O(1) amortized.
    fn push(&mut self, var: VarId) {
        self.entries.push(var);
    }

    /// Undo all bindings recorded after `mark`. Pops trail entries from the top
    /// down to (but not including) position `mark`, removing each variable's
    /// binding from `subst`.
    ///
    /// O(k) where k = self.entries.len() - mark.
    ///
    /// # Panics
    ///
    /// Panics if `mark > self.entries.len()` (the mark is ahead of the current
    /// trail position, which indicates a bug in choice point management).
    fn undo(&mut self, mark: TrailMark, subst: &mut Substitution) {
        assert!(
            mark <= self.entries.len(),
            "trail mark {} is ahead of trail length {}",
            mark,
            self.entries.len()
        );
        while self.entries.len() > mark {
            let var = self.entries.pop().unwrap();
            subst.unbind(var);
        }
    }
}
```

### Why `Vec<VarId>` and not `Vec<(VarId, TermId)>`?

In a standard Prolog-style engine, variables are bound at most once during any forward computation phase. When we undo, we *remove* the binding entirely — we do not "restore a previous value." Therefore we only need to know *which* variable to unbind, not what it was previously bound to (it was unbound). Storing the `TermId` would waste space and provide no useful information.

This would change if the engine supported **destructive assignment** (like `setarg/3` in some Prolog systems), where a term's structure can be mutated. In that case the trail would need to record the old value. Our engine does not support this.

### Capacity pre-allocation

For performance-sensitive workloads, the trail could be created with `Vec::with_capacity(n)` where `n` is an estimate of the maximum trail depth. In practice, the `Vec` doubling strategy is adequate and avoids requiring the caller to guess.

## Operations

| Operation | Signature | Semantics | Complexity |
|-----------|-----------|-----------|------------|
| `new` | `() -> Trail` | Create an empty trail | O(1) |
| `mark` | `(&self) -> TrailMark` | Return current trail length as a checkpoint | O(1) |
| `push` | `(&mut self, VarId)` | Append a variable to the trail | O(1) amortized |
| `undo` | `(&mut self, TrailMark, &mut Substitution)` | Pop entries back to mark, unbinding each variable | O(k), k = entries removed |
| `len` | `(&self) -> usize` | Current number of entries (useful for debugging/assertions) | O(1) |
| `is_empty` | `(&self) -> bool` | Whether the trail has any entries | O(1) |

### Operation Contracts

**`push` precondition**: The variable `var` must have *just* been bound in the substitution. Pushing a variable that was not actually bound creates a phantom trail entry; the subsequent `undo` will attempt to unbind a variable that may have been bound at a different time, corrupting the substitution.

**`undo` precondition**: `mark <= self.entries.len()`. A mark that exceeds the trail length indicates that choice point management has a bug (a mark was created in a "future" state that was never reached).

**`undo` postcondition**: `self.entries.len() == mark` and for every variable `v` that was in `self.entries[mark..]` before the call, `subst.bindings.contains_key(v)` is `false`.

## Edge Cases

### 1. Undoing to mark 0 (complete reset)

When backtracking undoes *all* bindings (mark = 0), the trail becomes empty and the substitution returns to its initial unbound state. This happens when the engine exhausts all clauses for the very first goal.

```rust
let mut trail = Trail::new();
let mut subst = Substitution::new();
let mark = trail.mark(); // mark = 0

subst.bind(v1, t1); trail.push(v1);
subst.bind(v2, t2); trail.push(v2);

trail.undo(mark, &mut subst);
// trail.len() == 0
// subst.is_empty() == true (assuming it was empty at the start)
```

### 2. Empty trail undo

Undoing on an empty trail with mark = 0 is a no-op. This must not panic or corrupt state.

```rust
let mut trail = Trail::new();
let mut subst = Substitution::new();
trail.undo(0, &mut subst); // No-op. No panic.
```

### 3. Bind-undo-rebind cycle

A variable is bound, the binding is undone via the trail, and then the same variable is bound to a *different* term. This is the normal case during backtracking: a variable like `X` might first be bound to `a`, then after backtracking, bound to `b`.

```rust
let mut trail = Trail::new();
let mut subst = Substitution::new();

// First attempt
let mark = trail.mark();
subst.bind(v1, term_a); trail.push(v1);
// Backtrack
trail.undo(mark, &mut subst);
assert!(!subst.is_bound(v1));

// Second attempt — same variable, different term
subst.bind(v1, term_b); trail.push(v1);
assert_eq!(subst.resolve(v1), term_b); // Must reflect the new binding
```

The correctness here depends on `unbind` fully removing the binding, so that the subsequent `bind` operates on a clean slate.

### 4. Nested choice points with nested marks

Multiple choice points create a stack of marks. Backtracking must respect the nesting order.

```rust
let mark_outer = trail.mark();     // mark = 0
subst.bind(v1, t1); trail.push(v1);

let mark_inner = trail.mark();     // mark = 1
subst.bind(v2, t2); trail.push(v2);
subst.bind(v3, t3); trail.push(v3);

// Backtrack inner choice point only
trail.undo(mark_inner, &mut subst);
// v2, v3 are unbound. v1 is still bound.
assert!(subst.is_bound(v1));
assert!(!subst.is_bound(v2));
assert!(!subst.is_bound(v3));

// Later, backtrack outer choice point
trail.undo(mark_outer, &mut subst);
// Now v1 is also unbound.
assert!(!subst.is_bound(v1));
```

### 5. Choice point with zero bindings

A choice point might be created even when the unification that follows makes no new bindings (e.g., unifying two ground terms that happen to match). The mark and subsequent undo are still valid — they simply do nothing.

```rust
let mark = trail.mark();
// Unification succeeds without binding any variables
trail.undo(mark, &mut subst); // No-op
```

### 6. Mark validity after partial undo

After undoing to `mark_inner`, any marks created *between* `mark_inner` and the undo point are invalidated — they refer to a trail state that no longer exists. Using such a stale mark would be a logic error. The engine must ensure that choice points are managed in strict LIFO order.

## Relationships

### Depends on: Substitution

The trail's `undo` operation mutates the substitution by calling `unbind`. The trail is meaningless without a substitution to undo into. The substitution module must expose an `unbind(var: VarId)` method that removes a binding. This is the only place in the engine where bindings are *removed* — all other substitution operations are additive.

**Interface contract**: `subst.unbind(v)` after `subst.bind(v, t)` must leave `v` in the same state as if `bind` had never been called. For a `HashMap<VarId, TermId>`, this is simply `self.bindings.remove(&v)`.

### Relates to: Choice Point

A choice point stores a trail mark (among other things like the current goal list and the remaining untried clauses). The choice point's mark is created via `trail.mark()` at choice point creation time, and passed to `trail.undo()` at backtracking time. The choice point does not interact with the trail in any other way.

```
ChoicePoint {
    trail_mark: TrailMark,   // <-- the connection
    goal_stack: ...,
    remaining_clauses: ...,
}
```

### Relates to: Resolution (SLD Resolution)

The resolution loop is the orchestrator that:
1. Creates choice points (and thus trail marks)
2. Calls unification (which pushes trail entries)
3. Detects failure and triggers backtracking (which calls `trail.undo`)

The trail itself is a passive data structure — it does not drive control flow. Resolution uses it as a bookkeeping tool.

## Examples

### Worked Example: `?- member(X, [a, b, c]).`

Assume the standard definition of `member/2`:

```prolog
member(X, [X|_]).          % Clause 1: X is the head
member(X, [_|Tail]) :-     % Clause 2: X is in the tail
    member(X, Tail).
```

The query `?- member(X, [a, b, c]).` asks: "For what values of X is X a member of the list [a, b, c]?"

We use variable IDs: `X` = v0 (from query). Each clause application introduces fresh variables via renaming.

#### Step 1: Initial state

```
Substitution: {}
Trail:        []
Goal stack:   [member(v0, [a, b, c])]
```

#### Step 2: Match against Clause 1

Both clauses match, so create a **choice point** (to try Clause 2 later if Clause 1 fails or on backtracking for more solutions).

```
ChoicePoint #1:
    trail_mark: 0
    remaining_clauses: [Clause 2]
    goal: member(v0, [a, b, c])
```

Rename Clause 1: `member(v1, [v1|_])` (fresh variable v1).

Unify `member(v0, [a, b, c])` with `member(v1, [v1|_])`:
- Unify v0 with v1: bind v0 -> v1. **Trail push: v0**. Trail = [v0].
- Unify [a, b, c] with [v1|_]: unify head a with v1: bind v1 -> a. **Trail push: v1**. Trail = [v0, v1].
- Tail `[b, c]` unifies with anonymous `_` (wildcard, no binding needed).

```
Substitution: {v0 -> v1, v1 -> a}    (so v0 resolves to a)
Trail:        [v0, v1]
Goal stack:   []                       (Clause 1 body is empty)
```

**First solution found: X = a.**

#### Step 3: User asks for more solutions (`;`)

Backtrack to Choice Point #1. Undo trail to mark 0:

```
trail.undo(0, &mut subst):
    pop v1 -> subst.unbind(v1)    // remove {v1 -> a}
    pop v0 -> subst.unbind(v0)    // remove {v0 -> v1}
```

```
Substitution: {}
Trail:        []
Goal stack:   [member(v0, [a, b, c])]    (restored from choice point)
```

#### Step 4: Match against Clause 2

Rename Clause 2: `member(v2, [v3|v4]) :- member(v2, v4)`.

Unify `member(v0, [a, b, c])` with `member(v2, [v3|v4])`:
- Unify v0 with v2: bind v0 -> v2. **Trail push: v0**. Trail = [v0].
- Unify [a, b, c] with [v3|v4]: bind v3 -> a. **Trail push: v3**. Trail = [v0, v3]. Bind v4 -> [b, c]. **Trail push: v4**. Trail = [v0, v3, v4].

```
Substitution: {v0 -> v2, v3 -> a, v4 -> [b, c]}
Trail:        [v0, v3, v4]
Goal stack:   [member(v2, v4)]    i.e., member(v2, [b, c])
```

#### Step 5: Recurse — match `member(v2, [b, c])` against Clause 1

Both clauses match again, so create another choice point:

```
ChoicePoint #2:
    trail_mark: 3
    remaining_clauses: [Clause 2]
    goal: member(v2, [b, c])
```

Rename Clause 1: `member(v5, [v5|_])`.

Unify `member(v2, [b, c])` with `member(v5, [v5|_])`:
- bind v2 -> v5. **Trail push: v2**. Trail = [v0, v3, v4, v2].
- bind v5 -> b. **Trail push: v5**. Trail = [v0, v3, v4, v2, v5].

```
Substitution: {v0 -> v2, v3 -> a, v4 -> [b, c], v2 -> v5, v5 -> b}
Trail:        [v0, v3, v4, v2, v5]
Goal stack:   []
```

**Second solution found: X = b.** (v0 -> v2 -> v5 -> b)

#### Step 6: User asks for more solutions (`;`)

Backtrack to Choice Point #2. Undo trail to mark 3:

```
trail.undo(3, &mut subst):
    pop v5 -> subst.unbind(v5)
    pop v2 -> subst.unbind(v2)
```

```
Substitution: {v0 -> v2, v3 -> a, v4 -> [b, c]}
Trail:        [v0, v3, v4]
Goal stack:   [member(v2, [b, c])]
```

Note how the bindings from Step 4 (v0, v3, v4) are preserved because they were made *before* Choice Point #2's mark.

#### Step 7: Match `member(v2, [b, c])` against Clause 2

Rename Clause 2: `member(v6, [v7|v8]) :- member(v6, v8)`.

Unify `member(v2, [b, c])` with `member(v6, [v7|v8])`:
- bind v2 -> v6. **Trail push: v2**. Trail = [v0, v3, v4, v2].
- bind v7 -> b. **Trail push: v7**. Trail = [v0, v3, v4, v2, v7].
- bind v8 -> [c]. **Trail push: v8**. Trail = [v0, v3, v4, v2, v7, v8].

```
Substitution: {v0 -> v2, v3 -> a, v4 -> [b, c], v2 -> v6, v7 -> b, v8 -> [c]}
Trail:        [v0, v3, v4, v2, v7, v8]
Goal stack:   [member(v6, v8)]    i.e., member(v6, [c])
```

#### Step 8: Recurse — match `member(v6, [c])` against Clause 1

```
ChoicePoint #3:
    trail_mark: 6
    remaining_clauses: [Clause 2]
    goal: member(v6, [c])
```

Rename Clause 1: `member(v9, [v9|_])`.

Unify: bind v6 -> v9, bind v9 -> c.

```
Substitution: {v0 -> v2, ..., v2 -> v6, v6 -> v9, v9 -> c}
Trail:        [v0, v3, v4, v2, v7, v8, v6, v9]
Goal stack:   []
```

**Third solution found: X = c.** (v0 -> v2 -> v6 -> v9 -> c)

#### Trail State Summary

| Event | Trail | Mark(s) active | Substitution (X resolves to) |
|-------|-------|----------------|------------------------------|
| Start | `[]` | - | unbound |
| Solution X=a | `[v0, v1]` | CP#1 @ 0 | a |
| Backtrack CP#1 | `[]` | - | unbound |
| Into Clause 2 | `[v0, v3, v4]` | CP#1 consumed | unbound (chain incomplete) |
| Solution X=b | `[v0, v3, v4, v2, v5]` | CP#2 @ 3 | b |
| Backtrack CP#2 | `[v0, v3, v4]` | - | unbound |
| Into Clause 2 again | `[v0, v3, v4, v2, v7, v8]` | CP#2 consumed | unbound |
| Solution X=c | `[v0, v3, v4, v2, v7, v8, v6, v9]` | CP#3 @ 6 | c |

The trail grew monotonically during forward computation and shrank at each backtrack event, exactly to the mark recorded in the relevant choice point. This is the fundamental rhythm of Prolog execution: grow forward, trim back, grow forward again.

## Appendix: Property Tests

The algebraic properties described above translate directly into property-based tests:

```rust
/// After undo(mark), trail length equals mark.
#[test]
fn trail_length_after_undo() {
    let mut trail = Trail::new();
    let mut subst = Substitution::new();
    let mark = trail.mark();
    for var in 0..10 {
        subst.bind(var, /* some term */);
        trail.push(var);
    }
    trail.undo(mark, &mut subst);
    assert_eq!(trail.len(), mark);
}

/// Undo is idempotent.
#[test]
fn undo_idempotent() {
    let mut trail = Trail::new();
    let mut subst = Substitution::new();
    let mark = trail.mark();
    subst.bind(0, /* term */);
    trail.push(0);
    trail.undo(mark, &mut subst);
    let snapshot = subst.clone();
    trail.undo(mark, &mut subst);
    assert_eq!(subst, snapshot);
}

/// Bind-undo-rebind cycle: variable can be rebound after undo.
#[test]
fn bind_undo_rebind() {
    let mut trail = Trail::new();
    let mut subst = Substitution::new();
    let mark = trail.mark();
    subst.bind(0, term_a);
    trail.push(0);
    trail.undo(mark, &mut subst);
    subst.bind(0, term_b);
    trail.push(0);
    assert_eq!(subst.resolve(0), term_b);
}

/// Nested marks: inner undo preserves outer bindings.
#[test]
fn nested_marks() {
    let mut trail = Trail::new();
    let mut subst = Substitution::new();
    let outer = trail.mark();
    subst.bind(0, t0); trail.push(0);
    let inner = trail.mark();
    subst.bind(1, t1); trail.push(1);
    trail.undo(inner, &mut subst);
    assert!(subst.is_bound(0));
    assert!(!subst.is_bound(1));
}
```

## Appendix: Performance Characteristics

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| `new` | O(1) | O(1) | Empty Vec allocation |
| `mark` | O(1) | O(1) | Reads Vec length |
| `push` | O(1)* | O(1)* | *Amortized; occasional Vec reallocation |
| `undo(mark)` | O(k) | O(1) | k = entries popped; Vec truncation |
| Total trail space | - | O(b) | b = total bindings in deepest branch |

The trail's maximum size at any point equals the number of bindings in the substitution. After undo, memory is not freed (the `Vec` retains its capacity), which is desirable since the capacity will likely be reused by the next forward computation branch. To force deallocation, one could call `entries.shrink_to_fit()`, but this is almost never worthwhile.

## Appendix: Historical Context

The trail mechanism originates from the **Warren Abstract Machine (WAM)**, described by David H.D. Warren in 1983. In the WAM, the trail is one of several memory areas (along with the heap, stack, and PDL). The WAM trail stores *addresses* on the heap rather than variable IDs, because the WAM uses a heap-allocated term representation where variables are memory cells. Our design simplifies this by using arena indices (`VarId = usize`) rather than raw pointers, but the principle is identical.

The term "trail" itself comes from the metaphor of leaving a trail of breadcrumbs: as you walk forward through the search tree, you drop markers so you can find your way back.

**Key reference**: Warren, D.H.D. (1983). *An Abstract Prolog Instruction Set*. Technical Note 309, SRI International.
