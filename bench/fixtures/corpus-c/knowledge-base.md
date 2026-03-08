---
slug: knowledge-base
title: Knowledge Base
tags: [concept, core]
relationships:
  depends-on: [clause, term]
  relates-to: [resolution, builtins]
---

# Knowledge Base

## Intuitive Overview

A Prolog program is a collection of statements: facts like `parent(tom, bob).` and rules like `ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).` When a query arrives -- say `?- ancestor(tom, ann)` -- the interpreter needs to find every clause whose head could potentially match. It does not scan the entire program linearly; it uses the **knowledge base** as a structured index to jump straight to the relevant clauses.

The knowledge base is, at its core, a **multi-map** from predicate indicators to ordered clause lists:

```
(functor, arity)  -->  [Clause_1, Clause_2, ..., Clause_n]
```

The key insight is that two pieces of information completely determine which clauses are relevant to a goal: the **functor name** (e.g. `parent`, `ancestor`) and the **arity** (number of arguments). A goal `parent(X, bob)` can only unify with heads that are also `parent/2` -- never with `parent/3` or `likes/2`. This is the predicate indicator, written `parent/2` in standard Prolog notation.

Within each predicate, **clause order matters**. Prolog's depth-first search tries clauses top-to-bottom, so the order in which clauses were inserted determines the execution semantics. Reordering `parent/2` clauses changes which answers are found first, whether infinite loops occur, and (in the presence of cut) which answers are found at all.

Think of the knowledge base as a filing cabinet. Each drawer is labeled with a predicate indicator (`parent/2`, `ancestor/2`). Inside each drawer, the clauses are stacked in order. When the resolver needs to prove a goal, it pulls the right drawer and works through the stack from top to bottom.

## Formal Definition

**Definition.** A *knowledge base* $K$ is a finite map:

$$K : \mathcal{P} \rightharpoonup \text{Clause}^*$$

where $\mathcal{P}$ is the set of predicate indicators $p/n$ (functor name $p$, arity $n \in \{0, 1, \ldots, 255\}$), and $\text{Clause}^*$ denotes finite ordered sequences of definite clauses.

**Predicate indicator.** A predicate indicator is a pair $(p, n)$ where $p$ is an atom (the functor name) and $n$ is a non-negative integer (the arity). Examples: `parent/2`, `likes/2`, `happy/1`, `true/0`.

**Definite clause.** Each clause in the knowledge base is a definite clause of the form:

$$H \leftarrow B_1, B_2, \ldots, B_m \quad (m \geq 0)$$

When $m = 0$, the clause is a **fact**. When $m > 0$, it is a **rule**. The head $H$ determines the predicate indicator under which the clause is stored: if $H = p(t_1, \ldots, t_n)$, then the clause belongs to $K(p/n)$.

**Clause order significance.** For any predicate indicator $p/n$, the sequence $K(p/n) = [C_1, C_2, \ldots, C_k]$ is ordered. During SLD resolution with a depth-first search strategy, $C_1$ is tried first. This ordering is a semantic choice, not merely an implementation detail -- it determines the search tree's shape.

**Domain restriction.** $K$ is a partial function: $\text{dom}(K) \subseteq \mathcal{P}$. A predicate indicator not in $\text{dom}(K)$ has no clauses; querying it yields immediate failure (not an error).

## Algebraic Laws and Invariants

### Structural Invariants

**INV-1: Key consistency.** Every clause stored under key $(p, n)$ has a head with functor $p$ and arity $n$.

$$\forall (p, n) \in \text{dom}(K),\ \forall C \in K(p, n): \text{functor}(\text{head}(C)) = p \land \text{arity}(\text{head}(C)) = n$$

This is the fundamental well-formedness condition. It must hold after every mutation.

**INV-2: Clause order preservation.** The sequence $K(p/n)$ preserves insertion order. If clause $C_i$ was inserted before $C_j$ (and neither is removed), then $C_i$ appears before $C_j$ in the sequence.

**INV-3: Non-empty domain compaction.** If $K(p/n) = []$ (empty sequence), then $(p/n) \notin \text{dom}(K)$ -- empty entries are removed. (This is a representational choice, not a logical necessity, but it simplifies domain queries.)

### Algebraic Properties

**Monotonic extension (under assertion).** Adding a clause to $K$ can only increase the set of successful queries or add new answer substitutions. Formally, if $K \subseteq K'$ (meaning every clause in $K$ appears in $K'$ at the same position), then every SLD refutation in $K$ has a corresponding refutation in $K'$.

**Note:** This monotonicity is with respect to *provability*, not *observational behavior*. In a DFS strategy with cut, adding clauses can change which answers are observed, because new clauses may be tried before reaching a cut that prunes alternatives.

**Non-monotonic retraction.** Removing a clause can make previously successful queries fail. Retraction breaks monotonicity -- this is inherent and unavoidable.

**Idempotence of lookup.** Lookup is a pure read operation: calling `lookup` any number of times with the same arguments yields the same result, provided no mutation intervenes.

$$\text{lookup}(K, p, n) = \text{lookup}(K, p, n) \quad \text{(referential transparency)}$$

**Commutativity of independent assertions.** If clauses $C_1$ and $C_2$ have different predicate indicators, the order of assertion does not matter:

$$\text{assert}(\text{assert}(K, C_1), C_2) = \text{assert}(\text{assert}(K, C_2), C_1) \quad \text{when } \text{key}(C_1) \neq \text{key}(C_2)$$

**Non-commutativity of same-predicate assertions.** If $C_1$ and $C_2$ share a predicate indicator, assertion order matters:

$$\text{assertz}(\text{assertz}(K, C_1), C_2) \neq \text{assertz}(\text{assertz}(K, C_2), C_1) \quad \text{(generally)}$$

because the clause sequence $[C_1, C_2]$ differs from $[C_2, C_1]$, which affects DFS resolution order.

## Rust Type Sketch

### Design Rationale

The knowledge base has three responsibilities:

1. **Storage**: Hold all clauses, grouped by predicate indicator.
2. **Lookup**: Given a functor and arity, return the relevant clause list in O(1).
3. **Mutation**: Support `assert` and `retract` for dynamic predicates.

We use a `HashMap` for the index because predicate lookup must be fast -- it happens at every resolution step. The key is a `(InternedAtom, u8)` pair: the interned atom avoids string comparison during lookup, and `u8` caps arity at 255 (Prolog implementations typically limit arity; ISO Prolog requires at least 255).

The knowledge base **owns** or **shares** two global resources: the `TermArena` (all terms live here, referenced by `TermId`) and the `AtomTable` (string interning for atom names). These are threaded through because clauses reference terms via arena indices, and functor names are interned atoms.

```rust
use std::collections::HashMap;

/// A predicate indicator: (functor, arity).
/// The functor is an interned atom (cheap to copy, compare, hash).
/// Arity is u8: max 255 arguments, matching ISO Prolog's minimum requirement.
type PredicateKey = (InternedAtom, u8);

/// The interpreter's clause database.
///
/// Clauses are grouped by predicate indicator and stored in order.
/// The arena and atom table are shared resources: all terms in all
/// clauses reference slots in `arena`, and all functor/atom names
/// are interned in `atoms`.
struct KnowledgeBase {
    /// The primary index: predicate indicator -> ordered clause list.
    clauses: HashMap<PredicateKey, Vec<Clause>>,

    /// Shared term arena. All TermId values in all Clauses point here.
    arena: TermArena,

    /// Shared atom interner. All InternedAtom values resolve here.
    atoms: AtomTable,
}
```

### Why arena + indices?

Terms in Prolog are tree-structured (a compound term contains sub-terms). Storing them as `enum Term { Atom(...), Var(...), Compound(String, Vec<Term>) }` would require recursive heap allocation and make copying expensive. Instead:

- All terms live in a flat `TermArena` (a `Vec<TermData>`).
- Each term is referenced by a `TermId` (an index into the arena).
- Copying a term reference is just copying a `u32`/`usize`.
- Structural sharing is free: two clauses can share sub-terms by pointing to the same arena slot.

This is the standard arena-allocation pattern in Rust compilers and interpreters (rustc uses it pervasively via `ty::TyCtxt`).

### Why `u8` for arity?

- ISO Prolog mandates support for at least arity 255.
- Most real predicates have arity 0-10. Using `u8` saves memory in the key and makes hashing faster.
- If arity > 255 is ever needed, this is the one place to change it.

## Operations

### `new() -> Self`

Construct an empty knowledge base with initialized (but empty) arena and atom table.

```rust
impl KnowledgeBase {
    fn new() -> Self {
        KnowledgeBase {
            clauses: HashMap::new(),
            arena: TermArena::new(),
            atoms: AtomTable::new(),
        }
    }
}
```

**Postcondition:** `self.clauses.is_empty() && self.arena.is_empty()`

### `add_clause(&mut self, clause: Clause)`

Append a clause to the end of its predicate's clause list. This is `assertz` semantics (the default for loading a program).

```rust
fn add_clause(&mut self, clause: Clause) {
    let key = clause.predicate_key(); // extracts (functor, arity) from head
    self.clauses.entry(key).or_default().push(clause);
}
```

**Precondition:** The clause's terms must already be allocated in `self.arena`, and its functor must already be interned in `self.atoms`.

**Postcondition:** `self.lookup(key.0, key.1).last() == Some(&clause)` -- the clause appears at the end.

**Complexity:** Amortized O(1) (HashMap insert + Vec push).

### `lookup(&self, functor: InternedAtom, arity: u8) -> &[Clause]`

Return all clauses for the given predicate indicator, in order. Returns an empty slice if no clauses exist.

```rust
fn lookup(&self, functor: InternedAtom, arity: u8) -> &[Clause] {
    self.clauses
        .get(&(functor, arity))
        .map(|v| v.as_slice())
        .unwrap_or(&[])
}
```

**Key design decision:** Returns `&[Clause]` (a borrowed slice), not a cloned `Vec`. This avoids allocation on every lookup -- critical because lookup is called at every resolution step.

**Returning an empty slice for missing predicates** is deliberate. In Prolog, querying an undefined predicate simply fails (produces no answers). Some Prolog systems raise an error for undefined predicates; if we want that behavior, it should be enforced at the resolution layer, not here. The knowledge base is a pure data structure; policy belongs elsewhere.

**Complexity:** O(1) expected (HashMap lookup).

### `assert_first(&mut self, clause: Clause)` -- asserta/1

Insert a clause at the **beginning** of its predicate's clause list.

```rust
fn assert_first(&mut self, clause: Clause) {
    let key = clause.predicate_key();
    self.clauses.entry(key).or_default().insert(0, clause);
}
```

**Postcondition:** `self.lookup(key.0, key.1).first() == Some(&clause)`.

**Complexity:** O(n) where n is the number of existing clauses for that predicate (due to `Vec::insert(0, ...)`). This is acceptable because `asserta` is infrequent in practice. If profiling shows this is hot, a `VecDeque` can be substituted.

### `assert_last(&mut self, clause: Clause)` -- assertz/1

Insert a clause at the **end** of its predicate's clause list. Semantically identical to `add_clause`, but named to parallel `assert_first` for the builtins layer.

```rust
fn assert_last(&mut self, clause: Clause) {
    self.add_clause(clause);
}
```

**Complexity:** Amortized O(1).

### `retract(&mut self, key: PredicateKey, index: usize)`

Remove the clause at the given index within the predicate's clause list.

```rust
fn retract(&mut self, key: PredicateKey, index: usize) {
    if let Some(clause_list) = self.clauses.get_mut(&key) {
        if index < clause_list.len() {
            clause_list.remove(index);
        }
        if clause_list.is_empty() {
            self.clauses.remove(&key);  // maintain INV-3
        }
    }
}
```

**Postcondition:** The clause that was at `index` is gone. All clauses after it shift left by one. If the predicate's clause list becomes empty, the key is removed entirely (INV-3).

**Complexity:** O(n) due to `Vec::remove`.

**Open question:** `retract/1` in Prolog takes a clause template and removes the *first matching* clause. The `index`-based API here is lower-level; the matching logic belongs in the builtins layer that implements `retract/1`. See [[relates-to::builtins]].

### `from_program(clauses: Vec<Clause>) -> Self`

Bulk-load a parsed program. Preserves the source order of clauses.

```rust
fn from_program(clauses: Vec<Clause>, arena: TermArena, atoms: AtomTable) -> Self {
    let mut kb = KnowledgeBase {
        clauses: HashMap::new(),
        arena,
        atoms,
    };
    for clause in clauses {
        kb.add_clause(clause);
    }
    kb
}
```

**Precondition:** All terms in all clauses reference valid slots in `arena`. All atoms are interned in `atoms`.

**Complexity:** O(n) where n is the total number of clauses.

## Edge Cases

### 1. Lookup on an undefined predicate

```rust
let result = kb.lookup(atom_id_for("unicorn"), 3);
assert!(result.is_empty()); // not an error -- just no clauses
```

An undefined predicate yields an empty slice. The resolution engine treats this as immediate failure for the goal. This is a deliberate design choice: the knowledge base does not enforce "predicate must be declared" -- that policy, if desired, belongs in a higher layer (e.g., a `check_undefined_predicate` flag in the resolver).

### 2. Duplicate clauses

```prolog
likes(bob, pizza).
likes(bob, pizza).
```

These are stored as two distinct entries in the `likes/2` clause list. During resolution, both will be tried, producing the same answer substitution twice. This matches standard Prolog behavior. Deduplication is not the knowledge base's job.

### 3. Retracting from an empty or nonexistent predicate

```rust
kb.retract((atom_id_for("ghost"), 1), 0);
// No-op: the predicate has no clauses, nothing to remove.
```

This should not panic. The implementation guards against it with `if let Some(...)`.

### 4. Dynamic modification during resolution

This is the most subtle edge case. Consider:

```prolog
go :- assert(go_helper(1)), go_helper(X), write(X).
```

If `assert` adds a clause to a predicate while the resolver is iterating over that predicate's clause list, the iterator may be invalidated (in Rust terms, this would violate the borrow checker: `lookup` returns `&[Clause]`, but `assert` needs `&mut self`).

**Mitigation strategies:**

| Strategy | Tradeoff |
|----------|----------|
| Clone the clause list before iterating | Simple but allocates on every resolution step |
| Use `Rc<Vec<Clause>>` with copy-on-write | Avoids cloning unless mutation happens |
| Snapshot the knowledge base per query | Clean semantics but high memory cost |
| Index-based iteration (track position as `usize`) | No borrow conflict but must handle shifting indices on retract |

The recommended approach for a pedagogical interpreter is **clone-on-lookup**: when the resolver begins processing a goal, it clones the relevant clause list. This is simple, correct, and avoids all borrow-checker issues. Performance can be improved later with COW (`Rc<[Clause]>` + clone-on-write) if profiling warrants it.

### 5. Very large clause sets for a single predicate

A predicate with millions of clauses (e.g., a large fact table) makes linear scanning expensive. Prolog systems optimize this with **first-argument indexing**: building a secondary index on the first argument of the head. This is out of scope for the initial implementation but is a natural extension point. The knowledge base's API (`lookup` returns a slice) does not preclude adding indexing later -- the indexed lookup would return a sub-slice.

### 6. Arity zero predicates

```prolog
halt.
true.
```

These are facts with arity 0: `halt/0`, `true/0`. The key is `(interned("halt"), 0)`. This works naturally with the `(InternedAtom, u8)` key type -- no special case needed.

### 7. Same functor, different arities

```prolog
foo(a).
foo(a, b).
foo(a, b, c).
```

These define three separate predicates: `foo/1`, `foo/2`, `foo/3`. They are stored under different keys and are completely independent. This is standard Prolog behavior and falls out naturally from the `(functor, arity)` key design.

## Relationships

### Depends On

- **[[clause]]**: The knowledge base stores `Clause` values. A clause consists of a head (a term) and a body (a sequence of goals/terms). The knowledge base extracts the predicate key from the clause's head. Without a well-defined `Clause` type, the knowledge base cannot function.

- **[[term]]**: Clauses contain terms, and terms live in the `TermArena`. The knowledge base owns (or shares a reference to) the arena. The `InternedAtom` type used in `PredicateKey` comes from the term/atom representation layer. The arena + index representation decision (using `TermId` instead of recursive `Box<Term>`) directly shapes how the knowledge base stores and retrieves clause data.

### Relates To

- **[[resolution]]**: The SLD resolution engine is the primary *consumer* of the knowledge base. At each resolution step, the engine calls `lookup` to find candidate clauses for unification with the current goal. The resolution engine determines the *traversal strategy* (DFS, BFS); the knowledge base provides the *data*. The clause ordering in the knowledge base directly determines the DFS search tree's left-to-right structure.

- **[[builtins]]**: The `assert/1`, `asserta/1`, `assertz/1`, and `retract/1` built-in predicates modify the knowledge base at runtime. These builtins bridge the gap between pure logical inference (which treats the knowledge base as immutable) and Prolog's meta-programming capabilities (which treat the clause database as mutable state). The knowledge base provides the mutation API; the builtins layer provides the Prolog-level interface and argument matching.

## Examples

### Program

```prolog
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
```

### Atom Interning (AtomTable state after loading)

```
AtomTable {
    "tom"      -> InternedAtom(0),
    "bob"      -> InternedAtom(1),
    "liz"      -> InternedAtom(2),
    "ann"      -> InternedAtom(3),
    "parent"   -> InternedAtom(4),
    "ancestor" -> InternedAtom(5),
}
```

### Term Arena (simplified)

Each term is allocated in the arena and referenced by `TermId`. Variable names like `X`, `Y`, `Z` become `TermData::Var` entries.

```
TermArena [
    0: Atom(InternedAtom(0)),           // tom
    1: Atom(InternedAtom(1)),           // bob
    2: Atom(InternedAtom(2)),           // liz
    3: Atom(InternedAtom(3)),           // ann
    4: Compound(InternedAtom(4), [0,1]) // parent(tom, bob)
    5: Compound(InternedAtom(4), [0,2]) // parent(tom, liz)
    6: Compound(InternedAtom(4), [1,3]) // parent(bob, ann)
    7: Var(0),                          // X  (in ancestor clause 1)
    8: Var(1),                          // Y  (in ancestor clause 1)
    9: Compound(InternedAtom(4), [7,8]) // parent(X, Y)  -- head of ancestor rule 1
   10: Compound(InternedAtom(5), [7,8]) // ancestor(X, Y) -- head of ancestor rule 1
   11: Var(2),                          // X  (in ancestor clause 2)
   12: Var(3),                          // Y  (in ancestor clause 2)
   13: Var(4),                          // Z  (in ancestor clause 2)
   14: Compound(InternedAtom(4),[11,13])// parent(X, Z)  -- body goal 1 of rule 2
   15: Compound(InternedAtom(5),[13,12])// ancestor(Z, Y) -- body goal 2 of rule 2
   16: Compound(InternedAtom(5),[11,12])// ancestor(X, Y) -- head of ancestor rule 2
]
```

Note that variables in each clause get distinct `Var` ids. This is essential: during unification, variables from different clauses must be independent. A fresh renaming (or clause-local variable numbering) ensures this.

### Resulting HashMap Structure

```
KnowledgeBase.clauses = {

    (InternedAtom(4), 2) => [          // parent/2
        Clause {                       // parent(tom, bob).
            head: TermId(4),           //   head = parent(tom, bob)
            body: [],                  //   fact (no body)
        },
        Clause {                       // parent(tom, liz).
            head: TermId(5),           //   head = parent(tom, liz)
            body: [],                  //   fact
        },
        Clause {                       // parent(bob, ann).
            head: TermId(6),           //   head = parent(bob, ann)
            body: [],                  //   fact
        },
    ],

    (InternedAtom(5), 2) => [          // ancestor/2
        Clause {                       // ancestor(X, Y) :- parent(X, Y).
            head: TermId(10),          //   head = ancestor(X, Y)
            body: [TermId(9)],         //   body = [parent(X, Y)]
        },
        Clause {                       // ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
            head: TermId(16),          //   head = ancestor(X, Y)
            body: [TermId(14),         //   body = [parent(X, Z),
                   TermId(15)],        //           ancestor(Z, Y)]
        },
    ],

}
```

### Walkthrough: Query Resolution

Given the query `?- ancestor(tom, ann)`:

1. The resolver extracts the predicate indicator: `ancestor/2`, i.e., key `(InternedAtom(5), 2)`.
2. `kb.lookup(InternedAtom(5), 2)` returns the slice of two clauses.
3. **Clause 1** is tried first (DFS, clause order): `ancestor(X, Y) :- parent(X, Y)`.
   - Unify `ancestor(tom, ann)` with `ancestor(X, Y)`: succeeds with `{X/tom, Y/ann}`.
   - Subgoal: `parent(tom, ann)`.
   - `kb.lookup(InternedAtom(4), 2)` returns three clauses for `parent/2`.
   - Try `parent(tom, bob)`: unification fails (`ann != bob`).
   - Try `parent(tom, liz)`: unification fails (`ann != liz`).
   - Try `parent(bob, ann)`: unification fails (`tom != bob`).
   - All three fail. Backtrack to clause 2.
4. **Clause 2** is tried: `ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y)`.
   - Unify `ancestor(tom, ann)` with `ancestor(X, Y)`: succeeds with `{X/tom, Y/ann}`.
   - Subgoal 1: `parent(tom, Z)`.
   - Try `parent(tom, bob)`: succeeds with `{Z/bob}`.
   - Subgoal 2: `ancestor(bob, ann)`.
   - Recurse: lookup `ancestor/2`, try clause 1: `ancestor(X', Y') :- parent(X', Y')`.
     - Unify: `{X'/bob, Y'/ann}`. Subgoal: `parent(bob, ann)`.
     - Try `parent(bob, ann)`: **succeeds**.
   - The query `?- ancestor(tom, ann)` succeeds.

This walkthrough illustrates how clause order (parent facts tried top-to-bottom, ancestor rules tried rule-1 then rule-2) and the knowledge base's lookup mechanism drive the entire resolution process.
