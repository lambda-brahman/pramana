---
slug: resolution
title: Resolution
tags: [concept, core]
relationships:
  depends-on: [unification, knowledge-base, choice-point, trail, substitution, clause]
  relates-to: [builtins, repl]
---

# Resolution

## Intuitive Overview

SLD resolution is the inference engine -- the algorithm that answers queries. It is the beating heart of the Prolog execution model: the loop that takes a question and, through a sequence of unifications, clause lookups, and backtracking steps, either produces an answer or reports failure.

Given a query like `?- ancestor(X, bob).`, resolution works as follows:

1. **Select the leftmost goal.** The current goal list is `[ancestor(X, bob)]`. The leftmost goal is `ancestor(X, bob)`.
2. **Find all clauses whose head unifies with that goal.** Search the [[knowledge-base]] for clauses defining `ancestor/2`. Suppose there are two: `ancestor(X, Y) :- parent(X, Y).` and `ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).`
3. **Pick the first matching clause, create a choice point for the rest.** Try the first clause. Record the second clause in a [[choice-point]] so we can come back to it if the first leads to failure (or if the user asks for more solutions).
4. **Replace the goal with the clause's body.** After unifying `ancestor(X, bob)` with `ancestor(X', Y')` (where `X'` and `Y'` are freshly renamed variables), the body `parent(X', Y')` becomes the new goal list, with the [[substitution]] from unification applied.
5. **Repeat until no goals remain (success) or no clauses match (failure, triggering backtracking).**

This is a depth-first, left-to-right search through the space of all possible proofs. It is not the only search strategy (breadth-first would be complete), but it is the one Prolog chose -- and the one we implement here. The choice of DFS has profound consequences: it is fast and memory-efficient when the search tree is finite, but it can loop forever on left-recursive programs.

### What SLD stands for

**S**elective **L**inear **D**efinite resolution:

- **Selective**: We choose *which* goal to resolve next (leftmost, in our case). The choice is a parameter of the algorithm, not a fixed aspect of the logic.
- **Linear**: We maintain a single derivation at a time, exploring the proof tree one branch at a time. This is in contrast to, say, breadth-first strategies that maintain multiple partial derivations simultaneously.
- **Definite**: We restrict ourselves to definite clauses (Horn clauses with exactly one positive literal). This restriction is what makes SLD resolution sound and complete (modulo termination).

### Why this is the hardest module

Resolution ties everything together. It consumes [[clause]]s from the [[knowledge-base]], drives [[unification]], builds and applies [[substitution]]s, pushes entries onto the [[trail]], creates and destroys [[choice-point]]s, and manages variable freshness via offset-based renaming. Every other module in the interpreter exists in service of resolution. Getting resolution right means getting the interplay of all these subsystems right -- their interfaces, their invariants, their ordering constraints.

---

## Formal Definition

### SLD Derivation

An **SLD derivation** from a goal `G_0` using a knowledge base (program) `P` is a (possibly infinite) sequence:

```
G_0 -->(C_1, sigma_1) G_1 -->(C_2, sigma_2) G_2 --> ... -->(C_n, sigma_n) G_n
```

where:

- Each `G_i = ?- A_1, A_2, ..., A_k` is a goal (a conjunction of atoms).
- At each step, a goal atom `A_j` is **selected** from `G_i` (by our selection rule: always `j = 1`, the leftmost).
- `C_{i+1}` is a clause from `P` whose head unifies with `A_j` (after variable renaming).
- `sigma_{i+1}` is the most general unifier (MGU) of `A_j` and the head of `C_{i+1}`.
- `G_{i+1}` is obtained by replacing `A_j` with the body of `C_{i+1}` and applying `sigma_{i+1}` to the entire resulting goal.

### SLD Refutation

An **SLD refutation** is a finite derivation that ends in the **empty goal** `[]` (denoted `box`):

```
G_0 -->(C_1, sigma_1) G_1 -->(C_2, sigma_2) ... -->(C_n, sigma_n) box
```

A refutation proves that the original query is a logical consequence of the program.

### Computed Answer Substitution

The **computed answer** for an SLD refutation is the composition of all MGUs along the derivation, restricted to the variables of the original query:

```
theta = (sigma_1 . sigma_2 . ... . sigma_n) |_{vars(G_0)}
```

The restriction is essential: during resolution, many auxiliary variables are introduced by clause renaming. The user does not care about `X'` or `Z'` -- they asked about `X` and want to know what `X` equals. The restriction filters out all the internal machinery and presents only the answer.

### SLD Tree

The **SLD tree** for a query `G_0` and program `P` is the tree of all possible SLD derivations:

- The root is `G_0`.
- Each node is a goal list.
- The children of a node are all the goals obtainable by selecting the leftmost atom and resolving it with each clause in `P` (in program order).
- Leaf nodes are either `box` (success) or nodes with no children (failure -- no clause matches the selected goal).

Our DFS strategy explores this tree left-to-right, depth-first. Backtracking corresponds to returning to a node with unexplored children. The [[choice-point]] stack records these "nodes with unexplored children."

```
                        ?- ancestor(tom, ann)
                       /                      \
              clause 1 (base)            clause 2 (recursive)
                     |                         |
            ?- parent(tom, ann)     ?- parent(tom, Z), ancestor(Z, ann)
                     |                    /              \
                  FAIL             Z = bob          (no more)
                                     |
                              ?- ancestor(bob, ann)
                             /                      \
                    clause 1 (base)            clause 2 (recursive)
                           |                         |
                  ?- parent(bob, ann)     ?- parent(bob, Z'), ancestor(Z', ann)
                           |                         |
                       SUCCESS (box)              Z' = ann
                                                     |
                                              ?- ancestor(ann, ann)
                                                     |
                                                   FAIL
```

DFS explores the left branch first (`parent(tom, ann)` -- failure), then the right branch. Within the right branch, it finds `parent(tom, bob)`, resolves `ancestor(bob, ann)`, finds the base case `parent(bob, ann)`, and succeeds. The computed answer is `{X -> tom}` (though X was already `tom` in this example, since we queried a ground goal).

---

## The Resolution Loop

### Pseudocode

```
solve(goals, subst, trail, kb, var_counter, choice_points, cut_barrier):
    if goals is empty:
        return Success(subst restricted to query vars)

    goal = goals[0]
    rest = goals[1..]

    -- Handle builtins (cut, is/2, comparison, etc.)
    if goal is a builtin:
        return execute_builtin(goal, rest, subst, trail, kb, var_counter,
                               choice_points, cut_barrier)

    -- Look up candidate clauses by functor/arity
    clauses = kb.lookup(functor(goal), arity(goal))
    if clauses is empty:
        return Failure  -- triggers backtracking

    -- Try each candidate clause
    for i, clause in clauses.enumerate():
        -- Create choice point for untried alternatives
        if i < clauses.len() - 1:
            push_choice_point(
                goals,
                trail.mark(),
                clauses[i+1..],
                var_counter,
                cut_barrier,
            )

        -- Rename clause variables for freshness
        fresh_clause = clause.rename_vars(var_counter, &mut arena)
        var_counter += clause.num_vars

        -- Record trail position for potential undo
        mark = trail.mark()

        -- Attempt unification
        if unify(goal, fresh_clause.head, subst, trail, arena):
            -- Build new goal list: clause body ++ remaining goals
            new_goals = fresh_clause.body ++ rest

            -- Set cut barrier for this clause invocation
            new_cut_barrier = choice_points.len()

            -- Recurse
            result = solve(new_goals, subst, trail, kb, var_counter,
                           choice_points, new_cut_barrier)
            if result is Success:
                return result

        -- Unification failed (or recursive solve failed): undo and try next clause
        trail.undo(mark, subst)

    return Failure
```

### Key observations about the pseudocode

**Goal replacement.** When a clause `H :- B_1, ..., B_m` is selected and `H` unifies with the current goal, the goal is replaced by `B_1, ..., B_m`, prepended to the remaining goals. This is the fundamental operation of SLD resolution: decompose one goal into subgoals.

**The substitution is persistent (within a branch).** Unification extends the substitution; it does not create a new one. The same mutable substitution is threaded through the entire derivation. This is why the [[trail]] exists: to undo the extensions when backtracking.

**Variable renaming happens once per clause use.** Each time a clause is selected, its variables are renamed to fresh ones. This prevents variable capture between different uses of the same clause (or different clauses that happen to use the same variable names).

**Choice points are created for the *remaining* alternatives.** When there are N candidate clauses, the first is tried immediately. A choice point is created only if there are alternatives (i.e., N > 1). The choice point records enough state to resume from the next untried clause.

---

## Rust Type Sketch

```rust
/// The result of attempting to solve a goal list.
enum SolveResult {
    /// The goal list was solved. The substitution contains the answer,
    /// restricted to the original query variables.
    Success(Substitution),

    /// No (more) solutions exist. All branches have been exhausted.
    Failure,
}

/// The solver: owns the mutable state of the resolution process.
///
/// Lifetime `'kb` ties the solver to the knowledge base it queries.
/// The solver borrows the KB immutably — resolution never modifies
/// the program, only reads from it.
struct Solver<'kb> {
    /// The knowledge base (program). Borrowed immutably.
    kb: &'kb KnowledgeBase,

    /// The current substitution. Extended by unification, retracted by
    /// trail.undo() during backtracking.
    subst: Substitution,

    /// The undo log. Entries are pushed during unification and popped
    /// during backtracking.
    trail: Trail,

    /// Stack of choice points. Each records the state needed to resume
    /// from an untried alternative clause.
    choice_points: Vec<ChoicePoint>,

    /// Global variable counter. Incremented by clause.num_vars each
    /// time a clause is renamed. Ensures all variable ranges are
    /// disjoint across the entire derivation.
    var_counter: u32,

    /// The choice point stack depth at which the current clause was
    /// entered. Cut (!) removes all choice points above this index.
    cut_barrier: usize,

    /// The term arena. Owned by the solver (or borrowed mutably from
    /// an outer context). Variable renaming and some substitution
    /// operations allocate new terms here.
    arena: TermArena,
}

/// A choice point records everything needed to resume from an
/// untried alternative.
struct ChoicePoint {
    /// Trail length at the time this choice point was created.
    /// Passed to trail.undo() to retract bindings.
    trail_mark: TrailMark,

    /// The goal list to resume with (including the goal being resolved).
    goals: Vec<TermId>,

    /// The remaining untried clauses (as indices into the KB's clause
    /// list for the relevant functor/arity).
    remaining_clauses: Vec<usize>,

    /// The variable counter at the time of creation. Restored on
    /// backtracking so that subsequent clause renaming does not skip
    /// variable ranges.
    var_counter: u32,

    /// The cut barrier that was active when this choice point was
    /// created. Restored on backtracking.
    cut_barrier: usize,
}
```

### Design Rationale

**Why `Vec<ChoicePoint>` and not a linked list?** Choice points are managed in strict LIFO order. A `Vec` gives us O(1) push, O(1) pop, O(1) indexed access (needed for cut), and cache-friendly memory layout. A linked list offers nothing over a `Vec` for this access pattern and would scatter allocations across the heap.

**Why store `remaining_clauses: Vec<usize>` rather than a slice?** The clause list in the knowledge base is borrowed immutably by the solver. Storing indices into that list decouples the choice point's lifetime from the borrow. When backtracking, the solver uses these indices to resume iteration. An alternative is to store a raw pointer-and-length or a clause list iterator, but indices are simpler and avoid unsafe code.

**Why store `goals: Vec<TermId>` in the choice point?** On backtracking, we need to retry the *same goal* with a different clause. The goal list at the time the choice point was created must be preserved. Since the substitution is being modified and undone, we cannot reconstruct the goals from later state -- we must save them explicitly.

**Why store `var_counter` in the choice point?** When we backtrack, the variable ranges allocated for the failed branch are no longer in use. Restoring the counter allows those ranges to be reused, preventing unbounded growth of the variable space during long searches with many backtracks.

**Why the solver owns the arena?** Variable renaming (`clause.rename_vars`) allocates new terms. The arena must be mutable during resolution. Since the solver already coordinates all mutable state, it is natural for it to own the arena. An alternative is for the arena to live outside the solver and be passed in as `&mut TermArena`, but this adds a lifetime parameter without clear benefit.

---

## The Solver Interface

```rust
impl<'kb> Solver<'kb> {
    /// Create a new solver for a given knowledge base.
    ///
    /// The query's variables should already be allocated in the arena
    /// with VarIds [0, query.num_vars). The solver's var_counter is
    /// initialized to query.num_vars.
    fn new(kb: &'kb KnowledgeBase, arena: TermArena, query_num_vars: u32) -> Self {
        Solver {
            kb,
            subst: Substitution::empty(),
            trail: Trail::new(),
            choice_points: Vec::new(),
            var_counter: query_num_vars,
            cut_barrier: 0,
            arena,
        }
    }

    /// Solve a list of goals. Returns the first solution found, or
    /// Failure if no solution exists.
    ///
    /// This is the main entry point. For the initial call, `goals` is
    /// the query's goal list and `query_vars` identifies which
    /// variables to include in the answer.
    fn solve(&mut self, goals: &[TermId], query_vars: &[VarId]) -> SolveResult;

    /// Attempt to solve a single goal against the knowledge base.
    /// Handles clause lookup, variable renaming, unification, and
    /// recursive descent into clause bodies.
    fn solve_goal(
        &mut self,
        goal: TermId,
        rest: &[TermId],
        query_vars: &[VarId],
    ) -> SolveResult;

    /// Backtrack: pop the most recent choice point, undo trail entries,
    /// restore state, and return the next alternative to try.
    ///
    /// Returns None if the choice point stack is empty (no alternatives
    /// remain — the search is exhausted).
    fn backtrack(&mut self) -> Option<(Vec<TermId>, Vec<usize>)>;

    /// Request the next solution (called after a previous Success).
    /// Forces backtracking to find an alternative derivation.
    ///
    /// This is what the REPL calls when the user types `;`.
    fn next_solution(&mut self, query_vars: &[VarId]) -> SolveResult;

    /// Restrict the current substitution to the given query variables.
    /// Produces the answer substitution that the user sees.
    fn restrict_answer(&self, query_vars: &[VarId]) -> Substitution;
}
```

---

## Algebraic Properties

### Soundness

**If `solve` returns `Success(sigma)`, then `sigma(G_0)` is a logical consequence of the knowledge base.**

Formally: let `P` be the program (knowledge base) and `G_0` the original query. If the solver produces answer `sigma`, then `P |= sigma(G_0)`. In other words, we never claim something is true unless it genuinely follows from the program.

Soundness is guaranteed by the construction of SLD resolution: every derivation step uses a clause from the program, and every unification step computes a valid MGU. The composed substitution is the conjunction of all these valid inferences.

**This is a non-negotiable invariant.** If soundness fails, the interpreter is producing wrong answers -- the most catastrophic kind of bug.

### Completeness (relative to the SLD tree)

**For terminating programs, DFS finds all solutions via backtracking.**

More precisely: if the SLD tree is finite, then DFS will visit every leaf. Every successful leaf (refutation) will be reported as a solution. Every failed leaf will be exhausted. The user receives all solutions, in the order determined by the program's clause ordering and the left-to-right selection rule.

**DFS is incomplete in general.** If the SLD tree has an infinite branch to the left of a success node, DFS will descend into the infinite branch and never reach the success. This is the price of depth-first search. Breadth-first search would be complete, but uses O(b^d) space compared to DFS's O(d) space (where b is branching factor and d is depth).

**Example of incompleteness:**

```prolog
loop :- loop.
done.
?- loop ; done.
```

DFS will endlessly resolve `loop` via the first clause and never reach `done`. Reordering the clauses or the goals would fix this particular case, but the general problem is inherent to DFS.

### Answer Substitution Composition

The computed answer is the composition of all MGUs along the successful derivation path, restricted to the original query variables:

```
theta = (sigma_1 . sigma_2 . ... . sigma_n) |_{vars(G_0)}
```

Because [[substitution]] composition is **associative** (it forms a monoid), we can accumulate the answer incrementally: apply each MGU to the running substitution as we go, rather than collecting all MGUs and composing at the end. Our implementation does exactly this -- the `subst` field of the solver is the running composition.

### Backtracking Correctness

**Invariant (state restoration).** After backtracking to a choice point, the substitution, trail, variable counter, and cut barrier are identical to their values at the moment the choice point was created.

This follows from the [[trail]]'s undo semantics: `trail.undo(mark, &mut subst)` removes exactly the bindings added since `mark`, restoring the substitution to its state at mark time. The variable counter and cut barrier are saved and restored explicitly.

### Choice Point Ordering

**Invariant (LIFO discipline).** Choice points are created and consumed in strict stack order. A choice point is never consumed before all choice points created after it have been consumed or cut.

This is enforced by the `Vec<ChoicePoint>` representation and by the solver's control flow. Backtracking always pops the topmost choice point. Cut removes choice points from the top down to the cut barrier. No operation accesses a choice point in the middle of the stack without first removing all those above it.

---

## Cut Integration

### What cut does

The Prolog cut (`!`) is a control-flow primitive that prunes the search tree. When `!` is encountered as a goal, it:

1. Succeeds immediately (the goal `!` is trivially true).
2. Removes all choice points created since the current clause was entered.

The effect: after cut, if the current branch fails, backtracking does *not* try alternative clauses for the predicate that contained the cut. Instead, it jumps past the entire predicate, as if no other clauses existed.

### ISO standard cut semantics

Our cut follows the ISO Prolog standard (ISO/IEC 13211-1:1995):

- The **cut barrier** is the choice point stack depth at the moment the current clause was entered.
- When `!` is executed, all choice points with index >= cut_barrier are removed from the stack.
- The trail entries associated with those removed choice points are *not* undone. Cut does not undo bindings -- it merely prevents future backtracking from reaching those points.

### Implementation

```rust
/// Execute the cut: remove all choice points above the cut barrier.
fn execute_cut(&mut self) {
    // Truncate the choice point stack to the cut barrier.
    // Choice points at indices [cut_barrier, choice_points.len()) are removed.
    self.choice_points.truncate(self.cut_barrier);
}
```

The simplicity of this implementation belies the subtlety of cut's semantics. The key insight is that cut does not modify the substitution or trail -- it only modifies the *future search space* by removing alternatives.

### How the cut barrier is set

The cut barrier is set when the solver enters a new clause:

```rust
// Inside solve_goal, after selecting a clause and before recursing:
let new_cut_barrier = self.choice_points.len();
// ... recurse with new_cut_barrier as the active barrier ...
```

This ensures that cut within a clause body can only remove choice points created within *that particular clause invocation*, not choice points from enclosing goals.

### Cut examples

**Example 1: Cut in a guarded clause.**

```prolog
max(X, Y, X) :- X >= Y, !.
max(X, Y, Y).
```

Without cut: `?- max(3, 2, M)` produces `M = 3` (via clause 1) and then `M = 2` (via clause 2, which is wrong). With cut: after clause 1 succeeds and cut fires, clause 2 is never tried. Only the correct answer `M = 3` is returned.

**Example 2: Cut in the last clause -- no-op.**

```prolog
color(red).
color(green).
color(blue) :- !.
```

The cut in the third clause has no practical effect because there are no remaining clauses to cut away. It is semantically a no-op, though the engine still processes it (removing zero choice points from the stack).

**Example 3: Green vs. red cut.**

A *green cut* does not change the set of computed answers -- it only improves efficiency by pruning redundant branches. The `max/3` example above is a green cut.

A *red cut* changes the answers -- the program without cut would produce different (or additional) results. Red cuts are considered poor style because they make the program's meaning depend on operational semantics rather than pure logic.

---

## Operations

### `solve(goals, query_vars) -> SolveResult`

Main entry point. Processes a goal list left-to-right, recursively reducing each goal via clause resolution. Returns `Success(answer)` or `Failure`.

**Preconditions:**
- `goals` contains valid `TermId`s in the solver's arena.
- `query_vars` lists the `VarId`s that appear in the original query (for answer restriction).
- The solver's state is consistent: trail length matches the substitution's binding count, choice points have valid trail marks.

**Postconditions:**
- On `Success`: `answer` maps query variables to their bindings, fully walked (no intermediate variable chains).
- On `Failure`: the substitution and trail are in an indeterminate state (the caller should not inspect them).

### `solve_goal(goal, rest, query_vars) -> SolveResult`

Resolve a single goal. This is where clause lookup, variable renaming, choice point creation, unification, and recursive descent happen.

**Algorithm:**
1. Check if `goal` is a builtin. If so, dispatch to `execute_builtin`.
2. Look up `functor(goal)/arity(goal)` in the knowledge base.
3. If no clauses match, return `Failure`.
4. For each candidate clause:
   a. If alternatives remain, create a choice point.
   b. Rename the clause's variables with `var_counter` as offset.
   c. Mark the trail.
   d. Attempt to unify `goal` with the renamed clause's head.
   e. On unification success: prepend the clause's body to `rest`, recurse.
   f. On unification failure or recursive failure: undo trail, try next clause.
5. If all clauses exhausted, return `Failure`.

### `backtrack() -> Option<(Vec<TermId>, Vec<usize>)>`

Pop the topmost choice point, undo bindings, and return the restored goal list and remaining clause indices.

**Implementation sketch:**

```rust
fn backtrack(&mut self) -> Option<(Vec<TermId>, Vec<usize>)> {
    let cp = self.choice_points.pop()?;
    self.trail.undo(cp.trail_mark, &mut self.subst);
    self.var_counter = cp.var_counter;
    self.cut_barrier = cp.cut_barrier;
    Some((cp.goals, cp.remaining_clauses))
}
```

**Postconditions:**
- The substitution is restored to the state at choice point creation time.
- The trail is truncated to the choice point's mark.
- The variable counter is restored (variable ranges from the failed branch are abandoned).

### `next_solution(query_vars) -> SolveResult`

Force backtracking and attempt to find another solution. This is the entry point for the REPL's `;` command.

```rust
fn next_solution(&mut self, query_vars: &[VarId]) -> SolveResult {
    if let Some((goals, remaining_clauses)) = self.backtrack() {
        // Resume resolution with the next untried clause
        self.solve_remaining(&goals, &remaining_clauses, query_vars)
    } else {
        SolveResult::Failure
    }
}
```

### `restrict_answer(query_vars) -> Substitution`

Extract the answer: walk each query variable to its final binding and build a clean substitution containing only those bindings.

```rust
fn restrict_answer(&self, query_vars: &[VarId]) -> Substitution {
    let mut answer = Substitution::empty();
    for &var in query_vars {
        let walked = self.subst.walk(var, &self.arena);
        // Only include if the variable is actually bound to something
        // other than itself
        if !self.arena.is_var(walked, var) {
            answer.bind(var, walked);
        }
    }
    answer
}
```

### `rename_clause(clause, offset) -> Clause`

Delegates to `clause.rename_vars(offset, &mut arena)`. This is a thin wrapper that also advances the solver's `var_counter`:

```rust
fn rename_clause(&mut self, clause: &Clause) -> Clause {
    let fresh = clause.rename_vars(self.var_counter, &mut self.arena);
    self.var_counter += clause.num_vars;
    fresh
}
```

---

## Edge Cases

### 1. Empty query

```prolog
?- .
```

A query with zero goals. The empty conjunction is trivially true. `solve([])` returns `Success(empty substitution)` immediately. This is the base case of the resolution recursion and must not be optimized away or treated as an error.

### 2. No matching clauses

```prolog
?- unicorn(X).
```

If the knowledge base contains no clauses for `unicorn/1`, `solve_goal` returns `Failure` immediately. No choice point is created. Backtracking propagates to the enclosing context (if any).

### 3. Infinite recursion

```prolog
p :- p.
?- p.
```

The clause `p :- p.` creates a single candidate for the goal `p`. Resolution renames, unifies (trivially -- both are atoms), and replaces the goal `p` with the body `p`. This repeats forever. DFS does not detect this cycle.

**Mitigation strategies (not implemented, but noted):**
- Depth limit: fail after N resolution steps. Configurable, with a sensible default.
- Tabling (memoization): detect that the same goal has been encountered before and short-circuit. This is a substantial extension.
- Iterative deepening: start with a small depth limit and increase it. Combines DFS space efficiency with BFS completeness. Also a substantial extension.

For the pedagogical interpreter, a configurable depth limit is the pragmatic choice. It should be documented in the REPL and produce a clear error message.

### 4. Cut in the last clause (no-op cut)

```prolog
color(red).
color(green).
color(blue) :- !.
```

When `color(blue)` is the goal and the third clause is selected, the choice point stack has no remaining alternatives for `color/1`. Cut truncates the stack to the cut barrier, removing zero choice points. This is correct and should not be special-cased.

### 5. Cut with no active choice points

If `!` is the first goal in a top-level query and no choice points exist:

```prolog
?- !.
```

The cut barrier is 0, and the choice point stack is empty. `truncate(0)` is a no-op. Cut succeeds. The query succeeds trivially.

### 6. Multiple solutions and the REPL interaction

```prolog
color(red).
color(green).
color(blue).

?- color(X).
```

The first call to `solve` returns `Success({X/red})`. When the user types `;`, `next_solution` backtracks to the choice point for `color/1`, tries `color(green)`, and returns `Success({X/green})`. Another `;` yields `Success({X/blue})`. A final `;` yields `Failure` (no more choice points).

The solver must remain in a valid state after each `Success` so that `next_solution` can be called. This means choice points must be preserved across solution boundaries -- they are not cleaned up until explicitly consumed by backtracking or cut.

### 7. Variable renaming overflow

The `var_counter` is a `u32`. Each clause application increments it by `num_vars`. For a long-running resolution with many clause applications, the counter could theoretically overflow. At `num_vars = 3` per clause and `2^32 / 3 ~ 1.4 billion` clause applications, overflow is unlikely but not impossible for pathological inputs.

**Mitigation:** Check for overflow before incrementing. If overflow is detected, fail with a clear error rather than wrapping around (which would violate the freshness guarantee and could cause unsound results).

### 8. Goals containing builtins mixed with user predicates

```prolog
?- parent(X, bob), X \= tom.
```

The leftmost goal `parent(X, bob)` is a user predicate. After it succeeds with `X = tom`, the next goal `\=(tom, tom)` is a builtin. The resolution loop must dispatch builtins correctly, without looking them up in the knowledge base. The dispatch is based on the goal's functor: a table of builtin functors is checked before the KB lookup.

### 9. Deep goal stacks from long clause bodies

```prolog
big :- a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z.
```

When `big` is resolved, all 26 body goals are prepended to the remaining goals. If each of those goals itself expands to many subgoals, the goal list can grow large. This is not a stack overflow concern (the goal list is a `Vec`, not a recursive call), but it does consume memory proportional to the total number of pending goals.

The implementation should pass goal lists by slice reference (`&[TermId]`) where possible, avoiding unnecessary cloning. The `rest` parameter in `solve_goal` is a natural fit for this.

---

## Relationships

### Depends on: [[unification]]

Resolution's core operation is unifying a goal with a clause head. The unification module provides the `unify(t1, t2, subst, trail, arena) -> bool` function. Resolution does not know how unification works internally -- it only cares about the success/failure result and the side effect on the substitution and trail.

**Interface contract:**
- Unification is called with the current (mutable) substitution and trail.
- On success, the substitution is extended with new bindings and the trail records them.
- On failure, the substitution and trail are in a consistent state (no partial bindings leak).
- The MGU produced is idempotent: `dom(sigma) intersection ran(sigma) = {}`.

### Depends on: [[knowledge-base]]

Resolution looks up candidate clauses by functor and arity. The knowledge base provides `lookup(functor, arity) -> &[Clause]`, returning clauses in definition order. Resolution never modifies the knowledge base (in a pure interpreter; `assert/retract` builtins would change this).

**Interface contract:**
- Clauses are returned in definition order (first defined = first tried).
- The returned slice is valid for the duration of the resolution step (the KB is borrowed immutably by the solver).

### Depends on: [[choice-point]]

Choice points record the state needed to resume from untried alternatives. Resolution creates choice points when multiple clauses match a goal and consumes them during backtracking. The choice point's structure (trail mark, goals, remaining clauses, var counter, cut barrier) is dictated by resolution's needs.

### Depends on: [[trail]]

The trail enables backtracking by recording which variables were bound during unification. Resolution calls `trail.mark()` before attempting unification and `trail.undo(mark, subst)` when backtracking. The trail is a passive bookkeeping structure -- it does not drive control flow.

### Depends on: [[substitution]]

The substitution is the running record of all variable bindings discovered during the derivation. Resolution reads from it (via `walk`, to resolve variable chains) and writes to it (indirectly, through unification). The answer substitution is extracted from it (via `restrict_answer`).

### Depends on: [[clause]]

Clauses are the input data for resolution. The `Clause` struct's `head`, `body`, and `num_vars` fields are all consumed directly by the resolution loop. The `rename_vars` method is called on every clause application to ensure freshness.

### Relates to: [[builtins]]

Builtins are goals with special evaluation rules that bypass the normal clause-lookup mechanism. Examples: `!` (cut), `is/2` (arithmetic evaluation), `=/2` (explicit unification), `\=/2` (negation-as-failure for unification), comparison operators. Resolution dispatches builtins before consulting the knowledge base.

The builtin dispatch is a design boundary: resolution knows the *set* of builtin functors, but delegates their *implementation* to the builtins module. This keeps the resolution loop clean and makes it easy to add new builtins.

### Relates to: [[repl]]

The REPL is the user-facing interface to the resolver. It:
1. Parses a query from user input.
2. Creates a solver with the current knowledge base and the parsed query.
3. Calls `solve` and displays the result.
4. If the user types `;`, calls `next_solution` and displays the next result.
5. Repeats until the user types `.` (stop) or the solver returns `Failure`.

The REPL must hold on to the solver between solution requests, because the solver's internal state (choice points, trail, substitution) encodes the position in the SLD tree.

---

## Examples

### Worked Example: Complete Resolution of `?- ancestor(tom, ann).`

#### The program

```prolog
parent(tom, bob).                        % Clause C1
parent(bob, ann).                        % Clause C2
ancestor(X, Y) :- parent(X, Y).         % Clause C3 (num_vars = 2)
ancestor(X, Y) :- parent(X, Z),         % Clause C4 (num_vars = 3)
                  ancestor(Z, Y).
```

#### The query

```prolog
?- ancestor(tom, ann).
```

This is a ground query (no variables), but the resolution process still creates variables internally through clause renaming. The query has `num_vars = 0`, so `var_counter` starts at 0.

#### Step 1: Initial state

```
Goals:         [ancestor(tom, ann)]
Substitution:  {}
Trail:         []
Choice Points: []
var_counter:   0
cut_barrier:   0
```

Select the leftmost goal: `ancestor(tom, ann)`.
Lookup `ancestor/2` in KB: finds [C3, C4].

Two clauses match, so we create a choice point for C4 before trying C3.

#### Step 2: Create choice point, try C3

```
ChoicePoint #1:
    trail_mark:        0
    goals:             [ancestor(tom, ann)]
    remaining_clauses: [C4]
    var_counter:       0
    cut_barrier:       0
```

Rename C3 with offset 0: `ancestor(V0, V1) :- parent(V0, V1).`
Advance var_counter: 0 + 2 = 2.

Mark trail: mark = 0.

Unify `ancestor(tom, ann)` with `ancestor(V0, V1)`:
- Unify `tom` with `V0`: bind V0 -> tom. Trail push V0. Trail = [V0].
- Unify `ann` with `V1`: bind V1 -> ann. Trail push V1. Trail = [V0, V1].
- Unification succeeds.

```
Substitution:  {V0 -> tom, V1 -> ann}
Trail:         [V0, V1]
```

New goal list: clause body [parent(V0, V1)] ++ rest [] = [parent(V0, V1)].
Under the current substitution, `parent(V0, V1)` effectively means `parent(tom, ann)`.

Set new cut_barrier = 1 (choice_points.len() = 1).

#### Step 3: Resolve `parent(V0, V1)` (i.e., `parent(tom, ann)`)

Select the leftmost goal: `parent(V0, V1)`.
The substitution tells us V0 = tom, V1 = ann, so we are looking for `parent(tom, ann)`.
Lookup `parent/2` in KB: finds [C1, C2].

Try C1: `parent(tom, bob)`. This is a ground fact, num_vars = 0, no renaming needed.

Create choice point for C2:

```
ChoicePoint #2:
    trail_mark:        2
    goals:             [parent(V0, V1)]
    remaining_clauses: [C2]
    var_counter:       2
    cut_barrier:       1
```

Mark trail: mark = 2.

Unify `parent(V0, V1)` with `parent(tom, bob)`:
- Unify V0 with tom: V0 is already bound to tom. tom = tom. OK, no new binding.
- Unify V1 with bob: V1 is already bound to ann. ann != bob. **Unification fails.**

Trail.undo(2, subst): nothing to undo (no new bindings were made). Trail stays at [V0, V1].

Try C2: `parent(bob, ann)`. Ground fact, no renaming.

(C2 is the last clause, so no new choice point is needed. Pop ChoicePoint #2 conceptually, or rather, since C2 is the last we do not create a CP for it.)

Actually, let us be precise about the iteration. We created ChoicePoint #2 for C2 above. Now we need to backtrack to it.

**Correction to the flow:** The pseudocode iterates through clauses sequentially. With two clauses [C1, C2]:
- For i=0 (C1): i < 2-1, so create choice point for C2. Try C1. Unification fails. Undo. Continue loop.
- For i=1 (C2): i is not < 2-1, so no choice point. Try C2.

Let me redo this step cleanly.

Mark trail: mark = 2 (before trying C1).
Unify `parent(V0, V1)` with `parent(tom, bob)`: fails (V1=ann vs bob). Undo to mark 2 (no-op).

Mark trail: mark = 2 (before trying C2).
Unify `parent(V0, V1)` with `parent(bob, ann)`:
- Unify V0 with bob: V0 is bound to tom. tom != bob. **Unification fails.**

Trail.undo(2, subst): no-op. All parent/2 clauses exhausted. Return Failure.

#### Step 4: Failure propagates -- backtrack to Choice Point #1

`solve_goal` for `parent(V0, V1)` returned Failure. This means the recursive `solve` in Step 2 also returns Failure. We undo the trail to the mark from Step 2 (mark = 0):

```
trail.undo(0, subst):
    pop V1 -> unbind V1 (was ann)
    pop V0 -> unbind V0 (was tom)
```

```
Substitution:  {}
Trail:         []
```

Now the loop in `solve_goal` for the original `ancestor(tom, ann)` continues to the next clause, C4.

#### Step 5: Try C4

Rename C4 with offset 2: `ancestor(V2, V3) :- parent(V2, V4), ancestor(V4, V3).`
Advance var_counter: 2 + 3 = 5.

Mark trail: mark = 0.

Unify `ancestor(tom, ann)` with `ancestor(V2, V3)`:
- Unify tom with V2: bind V2 -> tom. Trail push V2. Trail = [V2].
- Unify ann with V3: bind V3 -> ann. Trail push V3. Trail = [V2, V3].
- Unification succeeds.

```
Substitution:  {V2 -> tom, V3 -> ann}
Trail:         [V2, V3]
```

New goal list: clause body [parent(V2, V4), ancestor(V4, V3)] ++ rest [] = [parent(V2, V4), ancestor(V4, V3)].

Under substitution: parent(tom, V4), ancestor(V4, ann).

Set new cut_barrier = 0 (choice_points.len() = 0, since ChoicePoint #1 was consumed).

#### Step 6: Resolve `parent(V2, V4)` (i.e., `parent(tom, V4)`)

Select leftmost: `parent(V2, V4)`.
Lookup `parent/2`: [C1, C2].

Try C1: `parent(tom, bob)`. Ground, no renaming.

Create choice point for C2:

```
ChoicePoint #3:
    trail_mark:        2
    goals:             [parent(V2, V4), ancestor(V4, V3)]
    remaining_clauses: [C2]
    var_counter:       5
    cut_barrier:       0
```

Mark trail: mark = 2.

Unify `parent(V2, V4)` with `parent(tom, bob)`:
- V2 is bound to tom. tom = tom. OK.
- V4 is unbound. Bind V4 -> bob. Trail push V4. Trail = [V2, V3, V4].

```
Substitution:  {V2 -> tom, V3 -> ann, V4 -> bob}
Trail:         [V2, V3, V4]
```

Unification succeeds. New goal list: fact body [] ++ rest [ancestor(V4, V3)] = [ancestor(V4, V3)].

Under substitution: ancestor(bob, ann).

#### Step 7: Resolve `ancestor(V4, V3)` (i.e., `ancestor(bob, ann)`)

Select leftmost: `ancestor(V4, V3)`.
Lookup `ancestor/2`: [C3, C4].

Create choice point for C4:

```
ChoicePoint #4:
    trail_mark:        3
    goals:             [ancestor(V4, V3)]
    remaining_clauses: [C4]
    var_counter:       5
    cut_barrier:       1 (choice_points.len() = 1 at this moment)
```

Rename C3 with offset 5: `ancestor(V5, V6) :- parent(V5, V6).`
Advance var_counter: 5 + 2 = 7.

Mark trail: mark = 3.

Unify `ancestor(V4, V3)` with `ancestor(V5, V6)`:
- V4 -> bob (walked). V5 is unbound. Bind V5 -> bob. Trail push V5.
- V3 -> ann (walked). V6 is unbound. Bind V6 -> ann. Trail push V6.

```
Substitution:  {V2 -> tom, V3 -> ann, V4 -> bob, V5 -> bob, V6 -> ann}
Trail:         [V2, V3, V4, V5, V6]
```

New goal list: [parent(V5, V6)] ++ [] = [parent(V5, V6)].

Under substitution: parent(bob, ann).

#### Step 8: Resolve `parent(V5, V6)` (i.e., `parent(bob, ann)`)

Select leftmost: `parent(V5, V6)`.
Lookup `parent/2`: [C1, C2].

Try C1: `parent(tom, bob)`.

Mark trail: mark = 5.

Unify `parent(V5, V6)` with `parent(tom, bob)`:
- V5 -> bob (walked). bob != tom. **Unification fails.**

Undo to mark 5 (no-op).

Try C2: `parent(bob, ann)`.

Mark trail: mark = 5.

Unify `parent(V5, V6)` with `parent(bob, ann)`:
- V5 -> bob (walked). bob = bob. OK.
- V6 -> ann (walked). ann = ann. OK.

Unification succeeds. No new bindings (all variables were already bound to the correct values).

New goal list: fact body [] ++ rest [] = []. **The goal list is empty.**

#### Step 9: Success

The goal list is empty. This is an SLD refutation. The query `ancestor(tom, ann)` has been proved.

Since the original query had no variables (num_vars = 0), the answer substitution is empty: `restrict_answer([]) = {}`.

The answer reported to the user is simply: **yes** (or `true`).

```
Final state:
    Goals:         []
    Substitution:  {V2 -> tom, V3 -> ann, V4 -> bob, V5 -> bob, V6 -> ann}
    Trail:         [V2, V3, V4, V5, V6]
    Choice Points: [CP#3, CP#4]  -- unexplored alternatives remain
```

Note that choice points remain on the stack. If the user types `;`, the solver would backtrack into these alternatives, but for a ground query they would all lead to failure (there is only one proof of `ancestor(tom, ann)` in this program).

#### Derivation Summary

```
G0: [ancestor(tom, ann)]
    -->(C4, {V2/tom, V3/ann})
G1: [parent(V2, V4), ancestor(V4, V3)]
    -->(C1, {V4/bob})
G2: [ancestor(V4, V3)]
    -->(C3, {V5/bob, V6/ann})
G3: [parent(V5, V6)]
    -->(C2, {})
G4: []     -- box (success)

Computed answer: {V2/tom, V3/ann, V4/bob, V5/bob, V6/ann} |_{} = {}
```

The derivation tried C3 first (Step 2-3), failed, and backtracked to try C4 (Step 5). Within C4, it resolved `parent(tom, V4)` to get V4 = bob, then resolved `ancestor(bob, ann)` using C3 again, which led to `parent(bob, ann)`, which matched C2. Success in four resolution steps after one backtrack.

### Worked Example: Multiple Solutions with `?- ancestor(tom, X).`

Using the same program, but now with a variable in the query.

#### Query: `?- ancestor(tom, X).`

`num_vars = 1` (X is Var(0)). `var_counter` starts at 1.

**First solution:** Resolution follows the same path as above but with a variable X. Trying C3 first:

- Rename C3 (offset 1): `ancestor(V1, V2) :- parent(V1, V2).`
- Unify `ancestor(tom, V0)` with `ancestor(V1, V2)`: V1 -> tom, V2 -> V0.
- Resolve `parent(V1, V2)` = `parent(tom, V0)`.
- Try C1: `parent(tom, bob)`. Unify: V0 -> bob.
- Goal list empty. **Success: X = bob.**

Answer: `restrict_answer([V0]) = {V0/bob}`, displayed as `X = bob`.

**Second solution (user types `;`):** Backtrack. Eventually reaches C4 path, resolves `ancestor(bob, V0)`, tries C3, resolves `parent(bob, ann)`, V0 -> ann.

Answer: `X = ann`.

**Third solution (user types `;`):** Further backtracking explores C4 recursively, but `ancestor(ann, _)` has no clauses matching -- neither `parent(ann, _)` exists.

Answer: `Failure` (no more solutions).

---

## Appendix: Iterative vs. Recursive Implementation

The pseudocode above is recursive: `solve` calls `solve_goal`, which calls `solve` recursively. This maps cleanly to the formal definition but risks stack overflow on deep derivations.

### Recursive approach (our initial choice)

```
solve -> solve_goal -> solve -> solve_goal -> ...
```

Each pending goal adds a frame to the Rust call stack. For a derivation of depth D, this requires O(D) stack space. Rust's default stack is 8 MB, and each frame is roughly 100-200 bytes, giving a limit of approximately 40,000-80,000 nested goals.

**Pros:** Simple. Direct correspondence to the formal definition. Easy to reason about correctness.
**Cons:** Stack overflow on deep derivations. Cannot be interrupted mid-computation.

### Iterative approach (future optimization)

Convert the recursion to an explicit loop with a goal stack (`Vec<TermId>`). The solver maintains the goal list as a mutable data structure and processes goals in a `while` loop.

```rust
fn solve_iterative(&mut self, query_vars: &[VarId]) -> SolveResult {
    while let Some(goal) = self.goal_stack.pop_front() {
        // ... resolve goal, push body goals, handle failure via backtrack ...
    }
    SolveResult::Success(self.restrict_answer(query_vars))
}
```

**Pros:** No stack overflow. Can be interrupted. Can instrument the loop (step counting, depth limits) trivially.
**Cons:** More complex control flow. The relationship between code and formal definition is less direct.

**Recommendation:** Start with the recursive approach for clarity. If stack depth becomes a practical concern, convert to iterative. The Rust type sketch above supports both -- the `Solver` struct's fields are the explicit state that the iterative version would manipulate.

---

## Appendix: Relationship Between Resolution and the WAM

The Warren Abstract Machine (WAM) is a compilation target for Prolog that implements SLD resolution through an instruction set rather than an interpreter loop. Key correspondences:

| Resolution concept | WAM equivalent |
|---|---|
| Goal selection | Instruction pointer advances through compiled clause body |
| Clause lookup | Indexing instructions (`switch_on_term`, `try`, `retry`, `trust`) |
| Variable renaming | Environment allocation on the stack; no explicit renaming |
| Choice point creation | `try_me_else` / `retry_me_else` / `trust_me` instructions |
| Backtracking | `fail` instruction triggers choice point restoration |
| Cut | `cut` instruction adjusts the `B` (backtrack) register |
| Substitution | Heap-allocated variable cells with trailing |
| Trail | WAM trail area (same concept, different representation) |

Our interpreter implements the same logical operations as the WAM but at a higher level of abstraction. The WAM compiles away the clause lookup and goal iteration into a flat instruction sequence; we perform these operations dynamically. This is slower but far easier to understand, modify, and debug.

---

## Appendix: Complexity Analysis

### Time complexity

Let:
- `n` = number of goals in the query
- `c` = average number of candidate clauses per goal
- `d` = depth of the SLD tree (maximum derivation length)
- `u` = cost of a single unification (proportional to term size)
- `r` = cost of variable renaming per clause (proportional to term size)

**Per derivation step:** O(u + r) for unification and renaming, plus O(1) for choice point management.

**Total for one solution:** O(d * (u + r)) in the best case (no backtracking).

**Total for exhaustive search:** O(c^d * (u + r)) in the worst case (every branch is explored). This is exponential in derivation depth -- the same exponential that makes SAT solving hard. Backtracking cannot escape the fundamental combinatorial explosion of the search space.

### Space complexity

- **Substitution:** O(b) where b = total bindings in the deepest branch.
- **Trail:** O(b), mirroring the substitution.
- **Choice point stack:** O(d), one per pending alternative.
- **Goal stack (iterative):** O(n * d) in the worst case (each step can expand to n subgoals).
- **Arena:** O(d * r) for renamed terms.
- **Total:** O(d * (b + r + n)), linear in derivation depth.

The critical advantage of DFS over BFS: space is O(d) (linear in depth) rather than O(c^d) (exponential in depth). This is why Prolog chose DFS despite its incompleteness.

---

## Appendix: Soundness Argument (Sketch)

We argue informally that the implementation is sound -- that is, every computed answer is a logical consequence of the program.

**Base case.** If the goal list is empty, we return `Success(empty)`. The empty conjunction is trivially true, so any restriction of the substitution to query variables is a valid answer.

**Inductive step.** Suppose we select goal `A` and resolve it with clause `H :- B_1, ..., B_m` (after renaming). Unification produces MGU `sigma` such that `sigma(A) = sigma(H)`. The new goal list is `sigma(B_1), ..., sigma(B_m), sigma(rest)`.

By the soundness of unification, `sigma(A) = sigma(H)` holds. By the definition of the clause, `H` follows from `B_1, ..., B_m`. Therefore, if we can prove `sigma(B_i)` for all `i`, we can conclude `sigma(H)`, and hence `sigma(A)`.

By induction on derivation length, if the recursive call to `solve` succeeds with answer `theta`, then `theta(sigma(B_i))` holds for all `i`. Composing substitutions: `(theta . sigma)(A) = theta(sigma(A)) = theta(sigma(H))`, which is a consequence of the clause and the established body goals. Therefore the computed answer is sound.

**Cut does not affect soundness.** Cut only prunes unexplored branches -- it never causes the solver to claim a false conclusion. It may cause the solver to *miss* valid answers (affecting completeness), but it cannot produce invalid ones.

---

## Appendix: Future Extensions

### Negation as failure

`\+ Goal` succeeds if `Goal` fails, and fails if `Goal` succeeds. Implementation: create an isolated sub-solver, attempt to solve `Goal`. If it fails, `\+` succeeds (with no bindings). If it succeeds, `\+` fails (discarding any bindings from the sub-solver).

**Semantic subtlety:** Negation as failure is not logical negation. It operates under the closed-world assumption: anything not provable is assumed false. This is sound for ground goals but can produce unexpected results for goals with unbound variables.

### Assert/retract

`assert(Clause)` adds a clause to the knowledge base at runtime. `retract(Clause)` removes one. These break the immutability assumption of our solver (the KB is borrowed immutably). Supporting them requires either:
- Making the KB `RefCell<KnowledgeBase>` for interior mutability, or
- Using a transaction log that replays modifications after each resolution step.

### Tabling (memoization)

Cache the results of goals so that re-encountering the same goal returns cached answers instead of re-proving. This makes DFS complete for a class of programs (those without infinite terms) and can dramatically improve performance for overlapping subproblems. It is a substantial extension that affects the choice point mechanism and the substitution lifecycle.

### Constraint logic programming

Replace the substitution (which maps variables to concrete terms) with a constraint store (which records relationships between variables). Unification becomes constraint solving. This generalization subsumes standard Prolog and enables richer reasoning, but requires a fundamentally different substitution representation.
