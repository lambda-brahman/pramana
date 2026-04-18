---
slug: substitution
title: Substitution
tags: [concept, core]
relationships:
  depends-on: [term]
  relates-to: [unification, trail]
---

# Substitution

## Intuitive Overview

A substitution is a finite mapping from variables to terms. It answers the question: **"what do we know about each variable so far?"**

During unification, every time we discover that variable `X` must equal some term `t`, we record the binding `X -> t` in a substitution. During resolution, substitutions accumulate across proof steps until, at the end of a successful derivation, we can read off the answer: the substitution applied to the original query variables gives us the computed result.

Think of a substitution as a notebook of constraints. Each entry says "variable X stands for term t." Applying the substitution to a term is like reading a draft aloud and replacing every placeholder with the value you wrote down. If the value itself contains placeholders, you keep replacing until there is nothing left to expand.

The algebraic punchline: substitutions compose, and that composition is associative with the empty substitution as identity. This makes `(Substitution, compose, empty)` a **monoid** -- a fact that is not decorative but load-bearing. It means we can freely group and reorder composition steps, pipeline substitutions through transformations, and test each law as an executable property.

## Formal Definition

A substitution is a function from variables to terms that differs from the identity on only finitely many variables.

**Notation.** We write a substitution as:

```
sigma = {X1/t1, X2/t2, ..., Xn/tn}
```

where each `Xi` is a variable and each `ti` is a term, and `Xi != ti` for all `i` (we never store the identity mapping).

**Domain and range.**

```
dom(sigma) = { X | sigma(X) != X }
ran(sigma) = U { vars(sigma(X)) | X in dom(sigma) }
```

`dom(sigma)` is the set of variables that sigma actually changes. `ran(sigma)` is the set of variables that appear in the terms those variables map to. These two sets interact in important ways:

- If `dom(sigma) ∩ ran(sigma) = {}`, the substitution is called **idempotent**. Applying it twice gives the same result as applying it once: `sigma(sigma(t)) = sigma(t)` for all terms `t`.
- Most General Unifiers (MGUs) are always idempotent (or can be made so). This is a critical invariant for correctness.

**Application to terms.** Substitution application is defined recursively on term structure:

```
sigma(X)             = sigma(X)          if X in dom(sigma)
sigma(X)             = X                 if X not in dom(sigma)
sigma(f(t1,...,tn))  = f(sigma(t1), ..., sigma(tn))
```

Application walks the term tree. At every leaf, if the leaf is a variable in the domain, it is replaced by the bound term. Compound terms are rebuilt with their children substituted. Constants and functors pass through unchanged.

## Algebraic Laws

These laws are **critical** -- they become property tests that guard the correctness of the implementation.

### 1. Identity

The empty substitution `epsilon` (the one with `dom(epsilon) = {}`) is the identity element for composition:

```
epsilon . sigma = sigma = sigma . epsilon
```

for all substitutions `sigma`.

### 2. Associativity

Composition is associative:

```
(sigma1 . sigma2) . sigma3 = sigma1 . (sigma2 . sigma3)
```

for all substitutions `sigma1`, `sigma2`, `sigma3`.

### 3. Monoid

Laws 1 and 2 together establish that `(Substitution, ., epsilon)` forms a **monoid**.

### 4. Application distributes over composition

The defining equation of composition -- the reason we define it the way we do:

```
(sigma1 . sigma2)(t) = sigma1(sigma2(t))
```

for all terms `t`. Composition is defined so that composing two substitutions and then applying is the same as applying one after the other.

Note the order: `sigma1 . sigma2` means "apply `sigma2` first, then `sigma1`." This follows the standard mathematical convention for function composition (read right to left), which is the opposite of the order you might expect if you think of it as a pipeline.

### 5. Idempotence of MGU

If `sigma` is a Most General Unifier, then:

```
sigma(sigma(t)) = sigma(t)
```

for all terms `t`. Equivalently, `dom(sigma) ∩ ran(sigma) = {}`.

This is not a law of substitutions in general -- it is a law of *well-formed* MGUs produced by a correct unification algorithm. It serves as a strong post-condition check.

### 6. Singleton composition

A useful derived law for testing. If `sigma = {X/t}` is a singleton and `tau` is any substitution:

```
(sigma . tau)(X) = sigma(tau(X))
```

and for any variable `Y != X` not in `dom(sigma)`:

```
(sigma . tau)(Y) = sigma(tau(Y)) = tau(Y)  if Y not in dom(sigma)
```

### Property Test Summary

| Law | Property | QuickCheck strategy |
|-----|----------|-------------------|
| Identity (left) | `compose(empty, s) == s` | Generate random substitution `s` |
| Identity (right) | `compose(s, empty) == s` | Generate random substitution `s` |
| Associativity | `compose(compose(s1, s2), s3) == compose(s1, compose(s2, s3))` | Generate three random substitutions |
| Application distributes | `apply(compose(s1, s2), t) == apply(s1, apply(s2, t))` | Generate two substitutions, one random term |
| Idempotence of MGU | `apply(mgu, apply(mgu, t)) == apply(mgu, t)` | Generate two unifiable terms, compute MGU |

## Rust Type Sketch

```rust
use std::collections::HashMap;

/// A finite mapping from variables to terms.
///
/// Invariant: no variable maps to itself. If `bindings` contains
/// the key `v`, then `bindings[v]` refers to a term that is not
/// simply the variable `v`.
///
/// Invariant: all TermId values reference live entries in the
/// TermArena that was used to construct them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Substitution {
    bindings: HashMap<VarId, TermId>,
}
```

### Why `HashMap<VarId, TermId>`?

Several representations were considered:

| Representation | Lookup | Compose | Memory | Notes |
|---------------|--------|---------|--------|-------|
| `HashMap<VarId, TermId>` | O(1) avg | O(n+m) | Moderate | Simple, explicit, cache-unfriendly |
| `Vec<Option<TermId>>` indexed by VarId | O(1) worst | O(max(n,m)) | Sparse waste | Fast but wastes memory if VarId space is large |
| Persistent/immutable map | O(log n) | O(n log m) | Shared structure | Good for backtracking, slower lookup |
| Union-Find | O(alpha(n)) amortized | N/A (different model) | Compact | Standard in WAM, but conflates substitution with unification |

We choose `HashMap` because:

1. **Explicitness**: The substitution is a self-contained value. It does not depend on mutable global state. This makes it easy to reason about, clone, compare, and test.
2. **Pedagogical clarity**: The code reads as a direct transliteration of the mathematical definition.
3. **Adequate performance**: For a teaching interpreter, O(1) amortized lookup is more than sufficient. We are not building a WAM.
4. **Composition is straightforward**: Merge two HashMaps with the correct priority rule.

### Why arena + indices for terms?

Terms are recursive tree structures. In Rust, recursive types require indirection (`Box`, `Rc`, or arena allocation). We use arena allocation with `TermId(u32)` indices because:

- **No lifetime pollution**: `TermId` is `Copy`. Substitution does not need lifetime parameters.
- **Structural sharing**: Multiple substitutions can refer to the same sub-terms without cloning.
- **Cache locality**: Arena-allocated terms are contiguous in memory.
- **Deterministic cleanup**: The arena owns all terms; dropping the arena frees everything.

The tradeoff: `apply` must allocate new compound terms in the arena when it rebuilds a term with substituted children. This means `apply` takes `&mut TermArena` (or `&TermArena` if the arena uses interior mutability).

### Variable renaming: offset-based

Fresh variables are generated by adding a global offset to the original variable's id:

```rust
/// Generate a fresh copy of `var` that does not collide with any
/// variable allocated so far.
fn freshen(var: VarId, offset: u32) -> VarId {
    VarId(var.0 + offset)
}
```

This is simpler than maintaining a "next fresh variable" counter per-variable and avoids the need for a renaming substitution. The offset is bumped by the maximum VarId in the clause being renamed, guaranteeing no collisions.

## Operations

### `empty() -> Substitution`

Returns the identity substitution `epsilon` with no bindings.

```rust
impl Substitution {
    pub fn empty() -> Self {
        Substitution {
            bindings: HashMap::new(),
        }
    }
}
```

**Post-conditions**: `is_empty() == true`, `domain()` yields nothing.

---

### `bind(var: VarId, term: TermId) -> Substitution`

Creates a singleton substitution `{var/term}`.

```rust
impl Substitution {
    pub fn bind(var: VarId, term: TermId) -> Self {
        let mut bindings = HashMap::new();
        // Enforce invariant: do not store X/X
        if !arena.is_var(term, var) {
            bindings.insert(var, term);
        }
        Substitution { bindings }
    }
}
```

**Pre-condition**: `term` is a valid `TermId` in the current arena.

**Post-condition**: If `term` is the variable `var` itself, returns `empty()`. Otherwise, `lookup(var) == Some(term)`.

**Note**: The occurs-check is *not* performed here. That is the responsibility of the unification algorithm. `bind` is a dumb recording operation.

---

### `lookup(var: VarId) -> Option<TermId>`

Direct lookup: does the substitution have an entry for this variable?

```rust
pub fn lookup(&self, var: VarId) -> Option<TermId> {
    self.bindings.get(&var).copied()
}
```

Returns `None` if the variable is unbound. Does **not** follow chains.

---

### `walk(var: VarId, arena: &TermArena) -> TermId`

Follow the binding chain to its end. If `X -> Y` and `Y -> f(a)`, then `walk(X) = f(a)`.

```rust
pub fn walk(&self, var: VarId, arena: &TermArena) -> TermId {
    let mut current = var;
    loop {
        match self.lookup(current) {
            Some(term_id) => {
                match arena.get(term_id) {
                    Term::Var(next_var) => {
                        current = next_var;
                        // Continue walking
                    }
                    _ => return term_id, // Reached a non-variable term
                }
            }
            None => {
                // Variable is unbound; return it as-is
                return arena.var_term(current);
            }
        }
    }
}
```

**Termination**: `walk` terminates if there are no circular binding chains. The occurs check in unification prevents cycles, so `walk` will always reach either an unbound variable or a non-variable term in finitely many steps.

**Performance note**: Long chains can degrade performance. In production systems, path compression (updating intermediate bindings to point directly to the final target) is used. For our pedagogical interpreter this is unnecessary, but the option exists.

---

### `apply(term: TermId, arena: &mut TermArena) -> TermId`

Apply this substitution to a term, producing a new term in the arena.

```rust
pub fn apply(&self, term: TermId, arena: &mut TermArena) -> TermId {
    match arena.get(term) {
        Term::Var(v) => {
            match self.lookup(v) {
                Some(bound_term) => self.apply(bound_term, arena), // recursive
                None => term, // unbound variable, return as-is
            }
        }
        Term::Atom(_) => term, // atoms are ground, unchanged
        Term::Compound(functor, args) => {
            let new_args: Vec<TermId> = args
                .iter()
                .map(|arg| self.apply(*arg, arena))
                .collect();
            // Only allocate a new term if something actually changed
            if new_args == args {
                term
            } else {
                arena.compound(functor, new_args)
            }
        }
    }
}
```

**Key subtlety**: When we encounter a variable that is bound, we apply the substitution to the bound term recursively. This handles the case where the bound term itself contains variables that are also in the substitution's domain (the "g(f(Y), a)" example below).

**Optimization**: The equality check `new_args == args` avoids allocating a structurally identical term. For ground terms or terms whose variables are all unbound, `apply` returns the original `TermId` without allocation.

**Termination**: Application terminates if the substitution is acyclic (no chain `X -> ... -> X`). An acyclic substitution applied to a finite term produces a finite term in finite time. The occurs check guarantees acyclicity.

---

### `compose(self, other: Substitution, arena: &mut TermArena) -> Substitution`

Compute `self . other`, the composition. Semantics: `(self . other)(t) = self(other(t))`.

```rust
pub fn compose(self, other: Substitution, arena: &mut TermArena) -> Substitution {
    let mut result: HashMap<VarId, TermId> = HashMap::new();

    // Step 1: For each binding Y/t in `other`, apply `self` to t.
    for (var, term) in &other.bindings {
        let applied = self.apply(*term, arena);
        // Enforce invariant: do not store X/X
        if !arena.is_var(applied, *var) {
            result.insert(*var, applied);
        }
    }

    // Step 2: Add bindings from `self` whose variables are NOT in
    // dom(other). self's bindings for variables already in other
    // are "shadowed" — other gets to those variables first.
    for (var, term) in &self.bindings {
        result.entry(*var).or_insert(*term);
    }

    Substitution { bindings: result }
}
```

**Why this algorithm is correct.** Consider `(sigma1 . sigma2)(X)`:

- If `X in dom(sigma2)`: We first apply `sigma2`, getting `sigma2(X) = t`. Then apply `sigma1` to `t`. So the result is `sigma1(t)`. This is Step 1.
- If `X not in dom(sigma2)` but `X in dom(sigma1)`: `sigma2` acts as identity on `X`, so we get `sigma1(X)`. This is Step 2.
- If `X` is in neither domain: Both act as identity, so `X` maps to itself, which we do not store.

**Associativity verification.** Because `compose` faithfully implements the equation `(s1 . s2)(t) = s1(s2(t))`, and function composition is associative, our `compose` is associative. But trust no proof -- write the property test.

---

### `domain() -> impl Iterator<Item = VarId>`

```rust
pub fn domain(&self) -> impl Iterator<Item = VarId> + '_ {
    self.bindings.keys().copied()
}
```

---

### `is_empty() -> bool`

```rust
pub fn is_empty(&self) -> bool {
    self.bindings.is_empty()
}
```

## Edge Cases

### 1. Binding a variable to itself (`X/X`)

**Scenario**: Unification discovers that `X` must equal `X`. Trivially true.

**Handling**: The `bind` constructor detects this and returns an empty substitution. The invariant `bindings` never contains a self-mapping is maintained globally. This prevents `walk` from entering a trivial infinite loop and keeps `is_empty` semantically correct.

**Test**: `Substitution::bind(X, arena.var_term(X)).is_empty() == true`

### 2. Circular bindings (`X -> Y -> X`)

**Scenario**: A buggy unification algorithm produces `{X/Y, Y/X}`.

**Handling**: This should never happen. The **occurs check** during unification prevents creating a binding `X/t` when `X` appears in `t` (directly or transitively). If it does happen, `walk` will loop forever and `apply` will not terminate.

**Defence in depth**: In debug builds, `walk` could maintain a visited set and panic on revisit. In release builds, a fuel/step counter can provide a hard bound.

**Test**: Assert that unifying `X` with `f(X)` either fails or raises an occurs-check error, never produces a substitution.

### 3. Composing with the empty substitution

**Scenario**: `compose(sigma, empty)` or `compose(empty, sigma)`.

**Handling**: By the identity law, both should return `sigma` unchanged. The implementation handles this naturally: Step 1 iterates over empty bindings (does nothing), Step 2 copies `self`'s bindings. And vice versa.

**Test**: Property test for both left and right identity.

### 4. Applying to a ground term

**Scenario**: `sigma.apply(t, arena)` where `t` contains no variables.

**Handling**: `apply` recurses through the term tree, finds no variables in the domain, and returns the original `TermId` without allocating anything. This is the optimization in the `Compound` case where we check `new_args == args`.

**Test**: `apply(any_substitution, ground_term) == ground_term`

### 5. Very long binding chains

**Scenario**: `{X0/X1, X1/X2, X2/X3, ..., X999/a}`. Walking `X0` requires 1000 steps.

**Handling**: `walk` follows the chain iteratively (not recursively), so there is no stack overflow risk. Performance is O(chain length). For the pedagogical interpreter this is acceptable.

**Mitigation for production**: Path compression. After walking `X0` to `a`, update `X0 -> a`, `X1 -> a`, etc. This is a union-find optimization. We do not implement it, but note the design space.

**Test**: Construct a chain of length 1000, verify `walk` returns the correct terminal term.

### 6. Overlapping domains in composition

**Scenario**: `compose({X/a}, {X/b})`. Both substitutions bind `X`.

**Handling**: By the composition semantics, `(s1 . s2)(X) = s1(s2(X)) = s1(b) = b` (since `b` is a constant, `s1` does not change it). The implementation in Step 1 applies `s1` to `b` (getting `b`), stores `X -> b`. Step 2 tries to insert `X -> a` but `entry().or_insert()` does not overwrite. Result: `{X/b}`. This is correct.

**Test**: `compose({X/a}, {X/b}).lookup(X) == Some(b_id)` -- the "inner" substitution's binding wins, after being transformed by the outer.

### 7. Non-idempotent substitution

**Scenario**: `sigma = {X/Y, Y/a}`. Then `sigma(X) = Y` (direct lookup), but `sigma(sigma(X)) = sigma(Y) = a`. So `sigma` is not idempotent: `sigma(sigma(X)) != sigma(X)`.

**Handling**: Our `apply` function recursively applies, so `apply(sigma, X)` actually yields `a` -- it replaces `X` with `Y`, then replaces `Y` with `a`. This means our `apply` effectively computes the *transitive closure* of the substitution. The result: `apply` on this non-idempotent substitution behaves as if the substitution were idempotent. This is by design.

**Clarification**: The mathematical definition of substitution application (`sigma(X) = the term that X maps to`) and our implementation (`apply` which chases chains) differ. Our `apply` corresponds to applying the *idempotent closure* of the substitution. This is the correct behavior for a Prolog-style system where you want fully resolved answers.

**Test**: `apply({X/Y, Y/a}, X) == a`

## Relationships

### Depends on: `term`

Substitution is parameterized by the term representation. Every `TermId` in the substitution's bindings references a node in the `TermArena`. Without the term module, substitution has no meaning -- it maps variables to *something*, and that something is terms.

The `apply` and `compose` operations require access to the arena to:
- Inspect term structure (is it a variable? a compound?)
- Allocate new compound terms when rebuilding with substituted children

### Relates to: `unification`

Unification is the primary *producer* of substitutions. The unification algorithm takes two terms and returns either a substitution (the MGU) or failure. The substitution module provides the building blocks; unification provides the algorithm that assembles them.

Key contract between the two modules:
- Unification must perform the occurs check before calling `bind`, ensuring acyclicity.
- The MGU produced by unification should be idempotent (or at least, our `apply` should behave as if it were).
- Unification builds substitutions incrementally using `bind` and `compose`.

### Relates to: `trail`

In a backtracking search (SLD resolution), we need to *undo* substitution bindings when a branch fails. The trail records which bindings were added at each choice point, so they can be retracted.

The trail does not change the substitution's semantics -- it provides an undo mechanism layered on top. Two implementation strategies:

1. **Persistent substitution**: Use an immutable/persistent data structure. Backtracking means restoring a previous version. No trail needed.
2. **Mutable substitution + trail**: Use a mutable HashMap. The trail records `(VarId, Option<TermId>)` pairs -- the previous value (or absence) before binding. On backtrack, replay the trail in reverse.

We choose strategy 2 for now (mutable + trail) because it is simpler and mirrors classical Prolog implementations. The substitution module itself is unaware of the trail; trail is a separate concern.

## Examples

### Example 1: Basic application

Given the term arena containing:

```
TermId(0) = Var(X)       // variable X
TermId(1) = Var(Y)       // variable Y
TermId(2) = Atom("a")    // constant a
TermId(3) = Compound("f", [TermId(1)])   // f(Y)
TermId(4) = Compound("g", [TermId(0), TermId(1)])  // g(X, Y)
```

And the substitution:

```
sigma = {X/f(Y), Y/a}
      = {VarId(X) -> TermId(3), VarId(Y) -> TermId(2)}
```

**Apply `sigma` to `g(X, Y)` (TermId 4):**

```
apply(sigma, g(X, Y))
  = Compound("g", [apply(sigma, X), apply(sigma, Y)])

  apply(sigma, X):
    X is Var, lookup(X) = Some(TermId(3)) = f(Y)
    Recurse: apply(sigma, f(Y))
      = Compound("f", [apply(sigma, Y)])

      apply(sigma, Y):
        Y is Var, lookup(Y) = Some(TermId(2)) = a
        Recurse: apply(sigma, a)
          a is Atom, return TermId(2)
        return TermId(2)    // Y -> a

      return arena.compound("f", [TermId(2)])   // f(a) — new TermId(5)

    return TermId(5)    // X -> f(Y) -> f(a)

  apply(sigma, Y):
    Y is Var, lookup(Y) = Some(TermId(2)) = a
    Recurse: apply(sigma, a)
      a is Atom, return TermId(2)
    return TermId(2)    // Y -> a

  return arena.compound("g", [TermId(5), TermId(2)])   // g(f(a), a) — new TermId(6)
```

**Result**: `g(X, Y)` under `sigma` becomes `g(f(a), a)`.

Note that the naive, non-recursive approach would yield `g(f(Y), a)` -- the `Y` inside `f(Y)` would not be resolved. Our recursive `apply` correctly produces the fully resolved `g(f(a), a)`.

### Example 2: Composition

```
sigma1 = {X/a}
sigma2 = {Y/X}
```

Compute `sigma1 . sigma2`:

**Step 1**: For each binding in `sigma2`, apply `sigma1`:
- `Y -> X`: `apply(sigma1, X)` = `a` (since `sigma1` binds X to a)
- So `Y -> a` in the result.

**Step 2**: Add bindings from `sigma1` not already in result:
- `X -> a`: `X` is not in result (result has `Y`), so add it.

**Result**: `sigma1 . sigma2 = {Y/a, X/a}`

**Verification**: `(sigma1 . sigma2)(Y)` should equal `sigma1(sigma2(Y)) = sigma1(X) = a`. Check: our result maps `Y -> a`. Correct.

### Example 3: Composition with overlapping domains

```
sigma1 = {X/a, Y/b}
sigma2 = {X/f(Y)}
```

Compute `sigma1 . sigma2`:

**Step 1**: Apply `sigma1` to each binding in `sigma2`:
- `X -> f(Y)`: `apply(sigma1, f(Y))` = `f(b)` (since `sigma1` maps Y to b)
- So `X -> f(b)` in the result.

**Step 2**: Add bindings from `sigma1` not in result:
- `X -> a`: `X` is already in result, skip.
- `Y -> b`: `Y` is not in result, add.

**Result**: `sigma1 . sigma2 = {X/f(b), Y/b}`

**Verification**: `(sigma1 . sigma2)(X)` should be `sigma1(sigma2(X)) = sigma1(f(Y)) = f(b)`. Check: result maps `X -> f(b)`. Correct.

### Example 4: Walk through a binding chain

```
sigma = {X/Y, Y/Z, Z/f(a)}
```

`walk(X)`:
- `lookup(X) = Some(Y)`. Y is a variable.
- `lookup(Y) = Some(Z)`. Z is a variable.
- `lookup(Z) = Some(f(a))`. `f(a)` is a compound term, not a variable.
- Return `f(a)`.

Three hops. In a production system with path compression, after this walk, we would update `X -> f(a)` and `Y -> f(a)` to shortcut future walks.

### Example 5: Identity law demonstration

```
sigma = {X/f(a), Y/b}

compose(sigma, empty):
  Step 1: empty has no bindings. Nothing to do.
  Step 2: Add sigma's bindings. Result = {X/f(a), Y/b}.
  Result == sigma. Identity law (right) holds.

compose(empty, sigma):
  Step 1: For each binding in sigma, apply empty:
    X -> f(a): apply(empty, f(a)) = f(a). Store X -> f(a).
    Y -> b:    apply(empty, b)    = b.    Store Y -> b.
  Step 2: empty has no bindings. Nothing to add.
  Result = {X/f(a), Y/b} == sigma. Identity law (left) holds.
```
