---
slug: choice-point
title: Choice Point
tags: [concept, core]
relationships:
  depends-on: [trail, clause]
  relates-to: [resolution, builtins]
---

# Choice Point

## Intuitive Overview

When a Prolog engine tries to satisfy a goal, it searches the clause database for matching clauses. Often, more than one clause could potentially match. The engine must pick one and try it --- but what if that attempt leads to a dead end? It needs a way to remember *where it was*, *what it had already tried*, and *what remains untried*, so it can rewind and try the next alternative.

A **choice point** is that memory. It is a snapshot of the engine's state at the moment a nondeterministic decision is made.

Think of it as a bookmark in a "choose your own adventure" book. When you reach a page that says "turn to page 42 *or* page 87," you dog-ear the page, note which option you're about to try, and proceed. If that path leads to "THE END --- you fell into a pit," you flip back to the bookmark and try the other option. The dog-ear is the choice point. The act of flipping back is backtracking.

More precisely, a choice point records four things:

1. **Where you were going** --- the remaining goals to solve (the continuation).
2. **What you haven't tried yet** --- the alternative clauses for the current goal.
3. **How far you had gotten** --- a marker in the trail so bindings made after this point can be undone.
4. **The variable counter** --- so that fresh variable allocation can be rewound.

The collection of all active choice points forms a **stack**. When the engine needs to backtrack, it pops the most recent choice point, undoes bindings back to the recorded trail mark, and retries with the next untried clause. This is the mechanism that gives Prolog its depth-first search behavior.

### Why not breadth-first?

Depth-first search with backtracking is a deliberate design choice. It uses O(d) space (where d is the depth of the search tree) rather than O(b^d) for breadth-first (where b is the branching factor). The trade-off is that depth-first can get lost in infinite branches --- but Prolog programmers learn to write clauses in an order that avoids this, and the `cut` mechanism provides explicit control over the search space.

## Formal Definition

A **choice point** is a 5-tuple:

> CP = (G, A, t, v, barrier)

where:

- **G = [g_1, g_2, ..., g_n]** is the *goal list* --- the remaining goals at the time of the choice, with g_1 being the goal currently under resolution.
- **A = [c_1, c_2, ..., c_k]** is the *alternative list* --- indices (or references) into the clause database for predicate p/n, representing untried clauses. The clause currently being attempted is *not* in this list; A contains only the alternatives that remain if the current attempt fails.
- **t : TrailMark** is the *trail mark* --- a position in the substitution trail such that undoing all trail entries from the current position back to t restores the substitution to its state at the moment this choice point was created.
- **v : u32** is the *variable counter* --- the value of the global variable counter at the time of creation. When we backtrack to this choice point, we reset the counter to v, ensuring that fresh variables generated during the failed attempt are reclaimed (logically, not necessarily physically in the arena).
- **barrier : bool** is the *cut barrier flag* --- when true, ISO cut (`!`) cannot remove this choice point or any choice point below it on the stack. This flag is set for the choice point that marks the entry into a predicate called with cut.

The engine maintains a **choice point stack** S = [CP_1, CP_2, ..., CP_m] where CP_m is the most recently created choice point (top of stack).

### State Transitions

The choice point stack participates in three state transitions:

1. **Forward computation (clause selection)**:
   When resolving goal g against predicate p/n, if clauses [c_1, c_2, ..., c_k] match (k >= 2), the engine:
   - Creates CP = (G, [c_2, ..., c_k], trail.mark(), var_counter, is_cut_barrier)
   - Pushes CP onto S
   - Proceeds with clause c_1

2. **Backtracking (failure)**:
   When the current goal list leads to failure, the engine:
   - Pops CP_m from S
   - Undoes trail entries back to CP_m.t (restoring substitution state)
   - Resets var_counter to CP_m.v
   - Takes the next alternative c from CP_m.A
   - If CP_m.A has remaining alternatives after c, pushes an updated choice point
   - Proceeds with clause c and goal list CP_m.G

3. **Cut**:
   When the engine encounters `!`, it:
   - Finds the cut barrier (the choice point marked with barrier = true for the current predicate invocation)
   - Removes all choice points above (more recent than) that barrier
   - The barrier choice point itself is **not** removed

## Algebraic Properties

### Stack Discipline (LIFO)

Choice points obey strict LIFO ordering. If CP_a was created before CP_b, then CP_b will be backtracked to before CP_a. This is what makes the search depth-first.

**Invariant**: For all i < j in the stack, CP_i.trail_mark <= CP_j.trail_mark. Trail marks are monotonically non-decreasing up the stack.

### Soundness of Backtracking

Restoring to a choice point recovers the exact computation state:

> undo_trail(current_trail_pos, CP.trail_mark) . reset_var_counter(CP.v) = state_at_creation(CP)

That is, the composition of trail undo and variable counter reset is a left inverse of the forward computation that occurred after the choice point was created. Bindings made after the choice point are erased; bindings made before it are preserved.

**Testable property**: After backtracking to CP, for every variable V that was unbound at the time CP was created, V is unbound again.

### Completeness of Exhaustive Search

> is_empty(S) AND failure => no more solutions exist

If the choice point stack is empty and the current computation fails, then every branch of the search tree has been explored (modulo cut). The engine can report definitive failure.

**Testable property**: For a finite clause database with no infinite derivations, the engine terminates and produces exactly the set of all correct answers.

### Cut Monotonicity

Cut only *removes* choice points; it never adds them. After a cut:

> |S_after| <= |S_before|

**Testable property**: `cut(barrier)` removes all CP_i where i > barrier and CP_i.barrier == false. The stack size decreases or stays the same.

### Determinism Optimization

When exactly one clause matches a goal, no choice point is created:

> |matching_clauses| == 1 => |S| unchanged

This is not just an optimization --- it is semantically meaningful because it means cut has no effect in deterministic predicates (there are no choice points to remove).

**Testable property**: After resolving a goal with exactly one matching clause, the choice point stack has the same length as before.

## Rust Type Sketch

```rust
/// A key identifying a predicate: functor name + arity.
/// Example: member/2 is PredicateKey { name: "member", arity: 2 }
type PredicateKey = (InternedStr, u8);

/// An index into the clause database for a given predicate.
/// Clauses are stored in definition order; index 0 is the first clause.
type ClauseIndex = usize;

/// Marks a position in the trail. Undoing the trail back to this mark
/// restores the substitution to the state it was in when the mark was taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct TrailMark(usize);

/// A single choice point: a snapshot of engine state at a nondeterministic decision.
#[derive(Debug)]
struct ChoicePoint {
    /// The remaining goal list at the time of the choice.
    /// goals[0] is the goal being resolved; goals[1..] are the continuation.
    goals: Vec<TermId>,

    /// Indices into the clause list for the predicate being resolved.
    /// These are the *untried* alternatives --- the clause currently being
    /// attempted is not in this list.
    alternatives: Vec<ClauseIndex>,

    /// Which predicate we are resolving. Needed to look up the clause
    /// by index when we backtrack and pick the next alternative.
    predicate: PredicateKey,

    /// Where to undo the trail to. All trail entries from the current
    /// position back to this mark are undone on backtracking.
    trail_mark: TrailMark,

    /// The variable counter value at the time of creation.
    /// Restored on backtracking so that fresh variable IDs are reused.
    var_counter: u32,

    /// If true, this choice point is a cut barrier.
    /// ISO cut removes all choice points above the nearest barrier
    /// but does not remove the barrier itself.
    cut_barrier: bool,
}

/// The choice point stack. LIFO discipline.
#[derive(Debug)]
struct ChoicePointStack {
    stack: Vec<ChoicePoint>,
}
```

### Design Rationale

**`goals: Vec<TermId>` rather than a pointer into a goal list**: Cloning the goal list into each choice point is simple and correct. It avoids aliasing issues and makes each choice point self-contained. For a pedagogical implementation, clarity outweighs the allocation cost. A production engine would use structure sharing or a goal stack with frame pointers.

**`alternatives: Vec<ClauseIndex>` rather than an iterator**: Storing remaining clause indices explicitly makes the choice point serializable and inspectable, which aids debugging and testing. A production engine might use a slice or cursor into the clause database.

**`predicate: PredicateKey`**: Stored so that when we pop a choice point and pick the next alternative, we know which predicate's clause list to index into. Without this, we would need to re-derive the predicate from the goal term.

**`cut_barrier: bool`**: A simple flag on each choice point, rather than a separate barrier stack. This keeps the data model flat. On cut, we scan downward from the top of the stack until we find a choice point with `cut_barrier == true`.

**`var_counter: u32`**: The variable counter is a monotonically increasing integer used to generate fresh variable IDs during clause renaming. On backtracking, we reset it so that the same IDs are reused. This is correct because all terms created during the failed branch are no longer reachable (the trail undo erases their bindings, and the goal list is restored from the choice point).

## Operations

### `push`

```rust
impl ChoicePointStack {
    /// Save a new choice point. Called when multiple clauses match a goal.
    ///
    /// # Preconditions
    /// - `alternatives` is non-empty (otherwise, there is nothing to backtrack to)
    /// - `trail_mark` was obtained from the trail *before* the first clause was applied
    ///
    /// # Postconditions
    /// - The stack grows by one
    /// - The new top has the given alternatives, goals, and trail mark
    fn push(&mut self, cp: ChoicePoint) {
        debug_assert!(!cp.alternatives.is_empty(), "no alternatives to save");
        self.stack.push(cp);
    }
}
```

### `pop`

```rust
impl ChoicePointStack {
    /// Backtrack to the most recent choice point.
    /// Returns None if the stack is empty (all alternatives exhausted).
    ///
    /// # Postconditions
    /// - If Some(cp), the stack has shrunk by one
    /// - The caller must undo the trail to cp.trail_mark
    /// - The caller must reset the variable counter to cp.var_counter
    /// - The caller must pick the first element of cp.alternatives as the next clause
    fn pop(&mut self) -> Option<ChoicePoint> {
        self.stack.pop()
    }
}
```

### `cut`

```rust
impl ChoicePointStack {
    /// ISO cut: remove all choice points above the given barrier index.
    ///
    /// The barrier index is the stack index of the choice point with
    /// cut_barrier == true that was created when the parent goal was entered.
    ///
    /// # Preconditions
    /// - `barrier_index <= self.stack.len()`
    ///
    /// # Postconditions
    /// - All choice points at indices > barrier_index are removed
    /// - The choice point at barrier_index (if any) is retained
    /// - If barrier_index >= current stack length, this is a no-op
    fn cut(&mut self, barrier_index: usize) {
        self.stack.truncate(barrier_index + 1);
    }
}
```

### `is_empty`

```rust
impl ChoicePointStack {
    /// Returns true if there are no more choice points.
    /// When this is true and the current computation fails,
    /// the query has no (more) solutions.
    fn is_empty(&self) -> bool {
        self.stack.is_empty()
    }
}
```

### `barrier_index` (helper for cut)

```rust
impl ChoicePointStack {
    /// Find the index of the most recent cut barrier.
    /// This is used by the cut operation to determine where to truncate.
    ///
    /// In practice, the engine passes the barrier index into the goal
    /// rather than searching for it, since the engine knows which
    /// choice point was the barrier when it set up the call.
    fn find_barrier(&self) -> Option<usize> {
        self.stack.iter().rposition(|cp| cp.cut_barrier)
    }
}
```

## Edge Cases

### 1. No matching clauses --- immediate failure

When a goal `g` is resolved against predicate `p/n` and *zero* clauses match (after filtering by functor/arity and first-argument indexing), no choice point is created. The engine immediately backtracks to the most recent existing choice point.

This is the base case of failure. No state is saved because there is nothing to retry.

### 2. Exactly one matching clause --- deterministic resolution

When exactly one clause matches, the engine proceeds with that clause and does **not** create a choice point. This is sometimes called *deterministic optimization* or *last-call determinism*.

This is not merely an optimization: it has semantic consequences. Since no choice point is created, a subsequent `cut` has no additional effect for this predicate. Programs that are "naturally deterministic" (e.g., arithmetic predicates, type-checking predicates) benefit from smaller choice point stacks and faster backtracking.

### 3. Cut with no choice points above the barrier --- no-op

If the choice point stack already has its top at or below the barrier index, `cut` does nothing. This can happen when:
- The predicate is deterministic (case 2 above)
- A prior cut already pruned the relevant choice points
- The predicate has only one clause

### 4. Deeply nested choice points from recursive predicates

Consider `member(X, [a, b, c, d, ..., z])`. Each recursive call to `member/2` creates a choice point (because there are two clauses). For a list of length n, this produces n choice points on the stack simultaneously. The trail also grows proportionally. This is the classic O(n) space cost of depth-first search.

For the pedagogical interpreter, this is acceptable. A production engine would apply last-call optimization and environment trimming to reduce the stack footprint.

### 5. Choice point for a partially resolved goal

When a goal list has multiple conjuncts `(g1, g2, g3)` and g1 matches multiple clauses, the choice point records the *entire remaining goal list* including g2 and g3. On backtracking, the engine retries g1 with a different clause, but g2 and g3 are still pending. Any bindings made while (successfully) resolving g2 and g3 in the failed branch are undone by the trail.

### 6. Interaction between nested cuts and barriers

Consider:
```prolog
a :- b, !, c.
b :- d.
b :- e.
```
When `a` is called, a cut barrier is set. Resolving `b` may create choice points (for `d` vs `e`). The `!` in the body of `a` removes the choice point for `b` (it is above the barrier for `a`), committing to whichever clause of `b` succeeded. The barrier for `a` itself is retained.

If `b` also contained a cut, that cut would remove choice points above `b`'s barrier, not `a`'s barrier. Cut barriers are scoped to their predicate invocation.

### 7. Empty alternative list after last retry

When backtracking pops a choice point and takes the last alternative from `cp.alternatives`, no new choice point is pushed (there are no more alternatives). This means the engine has committed to this branch for the given predicate --- if it fails again, it will backtrack past this predicate entirely to an earlier choice point.

## Relationships

### depends-on: trail

The choice point stores a `TrailMark` --- a position in the trail. On backtracking, the engine undoes all trail entries from the current position back to this mark. Without the trail, there is no way to restore the substitution state, and backtracking would be unsound.

The invariant connecting them: after `trail.undo_to(cp.trail_mark)`, every variable binding made after the choice point was created has been erased, and every binding that existed before it remains intact.

### depends-on: clause

The `alternatives` field stores indices into the clause database. Without clauses, there is nothing to choose between. The clause database provides the search space; the choice point provides the mechanism for navigating it.

### relates-to: resolution

Resolution is the process of matching a goal against a clause head, unifying, and replacing the goal with the clause body. Choice points are created *by* the resolution process when it finds multiple matching clauses. Resolution drives forward computation; choice points enable the reversal of that computation.

### relates-to: builtins

Some builtins interact with the choice point stack:
- `!` (cut) directly manipulates the stack via `cut(barrier_index)`
- `\+` (negation-as-failure) may save and restore choice point state
- `findall/3` collects all solutions, which means exhausting all choice points for a sub-query
- `assert/retract` modify the clause database, which can change what alternatives a choice point would try (in our implementation, choice points store clause indices captured at creation time, so dynamic changes after choice point creation do not affect it --- this is the "logical update view" per ISO)

## Examples

### Worked Example: `member/2`

```prolog
% Clause 1 (index 0):
member(X, [X|_]).

% Clause 2 (index 1):
member(X, [_|T]) :- member(X, T).

?- member(Y, [a, b, c]).
```

We trace the choice point stack at each step. The substitution is written as {Var = Term}. Trail marks are written as T0, T1, etc., indicating the trail length at that point.

---

**Step 0: Initial state**

```
Goal list:    [member(Y, [a, b, c])]
Subst:        {}
Trail:        []
CP Stack:     []
Var counter:  0
```

The engine looks up `member/2` and finds two clauses. Since there are two matches, a choice point is created.

---

**Step 1: Try Clause 0 for `member(Y, [a, b, c])`**

Create a choice point with Clause 1 as the untried alternative:

```
CP Stack:     [CP1 = {
                goals: [member(Y, [a, b, c])],
                alternatives: [1],        // clause index 1 untried
                predicate: member/2,
                trail_mark: T0,           // trail length 0
                var_counter: 2,
                cut_barrier: false
              }]
```

Rename Clause 0 with fresh variables: `member(X0, [X0|_0]).`
Unify goal `member(Y, [a, b, c])` with head `member(X0, [X0|_0])`:
- Y = X0
- [a, b, c] = [X0|_0], so X0 = a, _0 = [b, c]
- Therefore Y = a

```
Subst:        {Y = a, X0 = a, _0 = [b, c]}
Trail:        [Y, X0, _0]       // 3 new bindings
Goal list:    []                 // clause body is empty, goal resolved
```

**Goal list is empty --- SOLUTION FOUND: Y = a**

---

**Step 2: Backtrack for next solution**

The user asks for more solutions (`;`). The engine backtracks: pop CP1.

- Undo trail back to T0: unbind Y, X0, _0
- Reset var_counter to 2
- Take alternative: clause index 1
- No more alternatives in CP1, so no new choice point is pushed for *this* level

```
Subst:        {}
Trail:        []
CP Stack:     []
```

---

**Step 3: Try Clause 1 for `member(Y, [a, b, c])`**

Rename Clause 1: `member(X1, [_1|T1]) :- member(X1, T1).`
Unify goal `member(Y, [a, b, c])` with head `member(X1, [_1|T1])`:
- Y = X1
- [a, b, c] = [_1|T1], so _1 = a, T1 = [b, c]

```
Subst:        {Y = X1, _1 = a, T1 = [b, c]}
Trail:        [Y, _1, T1]
Goal list:    [member(X1, [b, c])]    // body of clause 1
Var counter:  4
```

Now resolve `member(X1, [b, c])`. Two clauses match again --- create a choice point.

---

**Step 4: Try Clause 0 for `member(X1, [b, c])`**

```
CP Stack:     [CP2 = {
                goals: [member(X1, [b, c])],
                alternatives: [1],
                predicate: member/2,
                trail_mark: T3,           // trail has 3 entries
                var_counter: 4,
                cut_barrier: false
              }]
```

Rename Clause 0: `member(X2, [X2|_2]).`
Unify `member(X1, [b, c])` with `member(X2, [X2|_2])`:
- X1 = X2
- [b, c] = [X2|_2], so X2 = b, _2 = [c]
- Therefore X1 = b, and since Y = X1, Y = b

```
Subst:        {Y = X1, X1 = b, _1 = a, T1 = [b,c], X2 = b, _2 = [c]}
Goal list:    []
```

**SOLUTION FOUND: Y = b**

---

**Step 5: Backtrack for next solution**

Pop CP2. Undo trail back to T3 (unbind X2, _2, and the X1=b binding). Reset var_counter to 4.

Take clause index 1 for `member(X1, [b, c])`.

```
Subst:        {Y = X1, _1 = a, T1 = [b, c]}
Trail:        [Y, _1, T1]
CP Stack:     []
```

---

**Step 6: Try Clause 1 for `member(X1, [b, c])`**

Rename Clause 1: `member(X3, [_3|T3]) :- member(X3, T3).`
Unify `member(X1, [b, c])` with `member(X3, [_3|T3])`:
- X1 = X3
- [b, c] = [_3|T3], so _3 = b, T3 = [c]

```
Goal list:    [member(X3, [c])]
```

Resolve `member(X3, [c])`. Two clauses match --- create a choice point.

---

**Step 7: Try Clause 0 for `member(X3, [c])`**

```
CP Stack:     [CP3 = {
                goals: [member(X3, [c])],
                alternatives: [1],
                predicate: member/2,
                trail_mark: T5,
                var_counter: 6,
                cut_barrier: false
              }]
```

Rename Clause 0: `member(X4, [X4|_4]).`
Unify `member(X3, [c])` with `member(X4, [X4|_4])`:
- X3 = X4 = c
- Therefore Y = X1 = X3 = c

```
Goal list:    []
```

**SOLUTION FOUND: Y = c**

---

**Step 8: Backtrack for next solution**

Pop CP3. Undo trail back to T5. Take clause index 1 for `member(X3, [c])`.

---

**Step 9: Try Clause 1 for `member(X3, [c])`**

Rename Clause 1: `member(X5, [_5|T5]) :- member(X5, T5).`
Unify `member(X3, [c])` with `member(X5, [_5|T5])`:
- X3 = X5
- [c] = [_5|T5], so _5 = c, T5 = []

```
Goal list:    [member(X5, [])]
```

Resolve `member(X5, [])`. **Zero clauses match** (neither clause head unifies with a goal whose second argument is `[]`).

Immediate failure. CP stack is empty.

**No more solutions.**

---

### Summary of Solutions

| Step | Solution | Choice points at discovery |
|------|----------|---------------------------|
| 1    | Y = a    | 1 (CP1)                   |
| 4    | Y = b    | 1 (CP2)                   |
| 7    | Y = c    | 1 (CP3)                   |

### Diagram: Search Tree

```
                    member(Y, [a, b, c])
                   /                     \
             Clause 0                   Clause 1
             Y = a                      member(Y, [b, c])
           SUCCESS                     /                \
                                 Clause 0              Clause 1
                                 Y = b                 member(Y, [c])
                               SUCCESS                /              \
                                                Clause 0            Clause 1
                                                Y = c               member(Y, [])
                                              SUCCESS               FAIL (no clauses)
```

Each branching node corresponds to a choice point. The engine traverses this tree left-to-right, depth-first. Choice points are the mechanism that records the unexplored right branches while the engine descends into the left branch.

### Cut Example

```prolog
first_member(X, L) :- member(X, L), !.

?- first_member(Y, [a, b, c]).
```

Here, `first_member/1` calls `member/2` and then cuts. The cut removes the choice point created by `member/2` (clause 1 alternative). Only `Y = a` is returned, and backtracking into `member` is prevented.

```
Step 1: Resolve first_member(Y, [a, b, c])
        -> body: member(Y, [a, b, c]), !
        -> choice point for first_member/2 itself: cut barrier = true

Step 2: Resolve member(Y, [a, b, c]) with Clause 0
        -> Y = a, choice point CP_member pushed (for clause 1)
        -> CP Stack: [CP_barrier(first_member), CP_member(member)]

Step 3: Resolve !
        -> Find barrier: CP_barrier at index 0
        -> Truncate stack to index 1 (barrier + 1)
        -> CP_member is removed
        -> CP Stack: [CP_barrier(first_member)]

Step 4: Goal list empty -> SUCCESS: Y = a
Step 5: Backtrack? Pop CP_barrier. No alternatives. Stack empty. Done.

Result: only Y = a.
```

The cut eliminated the choice point that would have let the engine try clause 1 of `member/2`, committing to the first solution.
