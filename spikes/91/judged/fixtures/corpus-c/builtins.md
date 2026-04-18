---
slug: builtins
title: Builtins
tags: [concept, core]
relationships:
  depends-on: [term, substitution, knowledge-base, resolution]
  relates-to: [repl]
---

# Builtins

## Intuitive Overview

Every predicate in a pure Prolog program is defined by clauses in the knowledge base. You write `parent(tom, bob).` and the system knows it. You write `ancestor(X, Y) :- parent(X, Y).` and the system can prove it by searching for clauses. The entire mechanism -- [[resolution]], [[substitution]], backtracking -- is designed around this one idea: knowledge is clauses, computation is search.

But clauses alone are not enough. You cannot define arithmetic inside the clause language -- there is no finite set of facts that captures `X is 2 + 3` for all possible numbers. You cannot print to the screen with unification. You cannot modify the knowledge base from within a running query using only the knowledge base itself. These capabilities require stepping outside the pure logic model and calling into the host language.

That is what builtins are: predicates whose behavior is implemented in Rust, not defined by clauses. When the resolver encounters a goal like `X is 2 + 3`, it does not search the knowledge base for `is/2` clauses. Instead, it recognizes `is/2` as a builtin, dispatches to a Rust function, and that function evaluates the arithmetic expression, binds `X` to `5`, and reports success or failure.

Builtins are the pragmatic escape hatch. They break the declarative model -- they have side effects, they depend on evaluation order, they may not behave logically under negation or backtracking. But they are what make Prolog a practical language rather than a theorem prover. Every real Prolog program uses them.

### The tension

There is an inherent tension in builtins. The rest of the engine is designed around algebraic properties: substitution is a monoid, unification computes a most general unifier, resolution is sound with respect to the logical semantics of clauses. Builtins participate in none of this. `write/1` has a side effect that cannot be undone on backtracking. `assert/1` mutates the knowledge base mid-proof. `is/2` eagerly evaluates an expression rather than unifying with it structurally.

The design response to this tension is containment: builtins are isolated behind a registry that maps predicate keys to Rust functions. The resolver checks this registry before searching the knowledge base. Inside a builtin function, the Rust code has full access to the solver state -- it can bind variables, evaluate terms, perform I/O, and mutate the knowledge base. Outside, the resolver treats the builtin's return value (success/failure) just like any other goal resolution.

### Why not define builtins as clauses?

Consider `X is 2 + 3`. To handle this as a clause, you would need either:

1. An infinite set of facts: `is(5, +(2, 3)). is(7, +(3, 4)). ...` -- impossible.
2. A meta-interpreter that pattern-matches on arithmetic expressions and recursively evaluates them -- possible, but slow, and it still requires a base case implemented in the host language (how do you add two machine integers in pure Prolog?).

The same argument applies to I/O (you need the host language's I/O primitives), to `assert/retract` (you need mutable access to the knowledge base's internal data structures), and to `cut` (you need to manipulate the resolver's choice point stack, which is not represented as a term).

## Formal Definition

### Builtin Predicate

A **builtin predicate** is a triple `(name, arity, implementation)` where:

- `name` is a string (or interned atom) identifying the predicate (e.g., `"is"`, `"write"`, `"="`)
- `arity` is a non-negative integer specifying the number of arguments
- `implementation` is a function `f: (args, solver_state) -> Result<BuiltinResult, BuiltinError>` that inspects and potentially modifies the solver state

### Predicate Key

A **predicate key** is a pair `(InternedAtom, u8)` -- the functor name and arity. This is the same key used for [[knowledge-base]] indexing. A predicate key uniquely identifies a predicate: `write/1` and `write/2` are distinct predicates.

### Dispatch Rule

During resolution, when the resolver selects a goal `G` with predicate key `k`:

```
if registry.is_builtin(k):
    result = registry.lookup(k)(args_of(G), solver)
    handle result (success/failure/error)
else:
    search knowledge base for clauses with head key k
```

Builtins take **strict priority** over user-defined clauses. If a predicate key is registered as a builtin, clauses with the same key in the knowledge base are ignored. This is a deliberate semantic choice that matches ISO Prolog behavior: you cannot redefine `is/2` by asserting clauses.

### Purity Classification

Builtins partition into two categories by their algebraic behavior:

| Category | Properties | Examples |
|----------|-----------|----------|
| **Pure** | No side effects, result depends only on arguments, safe under negation and backtracking | `=/2`, `\=/2`, `atom/1`, `var/1`, type-checking predicates |
| **Impure** | Side effects, evaluation order dependent, may not be safe under negation or backtracking | `write/1`, `assert/1`, `retract/1`, `is/2` (due to instantiation errors), `!` (cut) |

This classification is not enforced by the type system -- it is a semantic property that the implementor must track mentally. Pure builtins preserve the algebraic guarantees of the resolver; impure builtins may violate them. The distinction matters for reasoning about program correctness and for optimizations (pure builtins can be reordered; impure ones cannot).

## Categories of Builtins

### 1. Control Flow

Control flow builtins manipulate the resolver's search strategy rather than unifying or computing values.

**`true/0`** -- Always succeeds. The identity element for conjunction: `(A, true)` is equivalent to `A`. Trivial to implement but semantically important as the base case of recursive goal lists.

**`fail/0` (also `false/0`)** -- Always fails. Forces backtracking. The identity element for disjunction: `(A ; fail)` is equivalent to `A`. Useful as an explicit "this branch should not succeed" marker.

**`!/0` (cut)** -- Prune the search tree. When the resolver encounters `!`, it removes all choice points created since the parent goal was unified with the current clause's head. This commits to the current clause: no alternative clauses for the parent goal will be tried, even on backtracking.

Cut is the most dangerous control flow builtin because it breaks the completeness of the search. A program with cut may miss valid solutions. It exists for efficiency (avoiding redundant search in deterministic predicates) and for expressing if-then-else patterns:

```prolog
max(X, Y, X) :- X >= Y, !.
max(X, Y, Y).
```

Without the cut, the second clause would be tried even when the first succeeds, potentially producing a spurious second answer.

The implementation of cut requires the resolver to tag choice points with a "parent goal" marker, so that `!` knows which choice points to discard. This is the most significant interaction between a builtin and the resolver's internal state.

**`\+/1` (negation as failure)** -- `\+ Goal` succeeds if and only if `Goal` fails. This is **not** logical negation. It is an extralogical test: "can Goal be proven with the current knowledge base?" If Goal succeeds, `\+` fails; if Goal fails (finitely), `\+` succeeds.

Critical subtlety: `\+` does not produce bindings. Even if Goal partially binds variables before failing, those bindings are undone (via the [[trail]]). And if Goal succeeds, `\+` fails, so the bindings produced by Goal are also discarded. This means `\+ \+ Goal` ("double negation") succeeds whenever Goal succeeds but **loses all bindings** from Goal. It is a pure test, not a computation.

**`,(A, B)` (conjunction)** -- Solve A, then solve B. This is usually implicit in goal lists (`a, b, c` is a sequence of three goals), but it can be an explicit goal when conjunction is passed as a term (e.g., `call((a, b))`). The resolver handles conjunction by decomposing it into sequential goals.

**`;(A, B)` (disjunction)** -- Try A; if A fails, try B. Implemented by creating a choice point: one branch attempts A, the alternative branch attempts B. Like `\+`, disjunction can interact subtly with cut -- if A contains a cut, it does not prevent B from being tried (the cut only affects choice points within the scope of A's parent goal).

### 2. Unification

**`=/2`** -- `X = Y` unifies X and Y. This is the builtin form of the operation that pervades the entire engine. When written as an explicit goal, it invokes the same unification algorithm used implicitly during clause head matching.

Algebraically, `=/2` inherits all properties of unification: symmetry (`X = Y` iff `Y = X`), idempotence of the resulting substitution, and the computation of a most general unifier.

**`\=/2`** -- `X \= Y` succeeds iff X and Y do **not** unify. Implemented as `\+ X = Y`. Like negation as failure, it produces no bindings.

**`unify_with_occurs_check/2`** -- Unification with the occurs check explicitly enabled. In standard Prolog, `=/2` omits the occurs check for performance (allowing the creation of cyclic terms). This predicate guarantees that `X = f(X)` fails rather than producing an infinite term.

### 3. Arithmetic

Arithmetic builtins are where the term algebra meets numeric computation. The key semantic decision is **eager evaluation**: the expression `2 + 3` is not a term to be unified -- it is an instruction to compute `5`.

**`is/2`** -- `X is Expr` evaluates the arithmetic expression `Expr` and unifies the result with `X`.

The evaluation of `Expr` is a recursive walk over the term structure:

```
eval(N) = N                          when N is a number
eval(+(A, B)) = eval(A) + eval(B)    when + is the arithmetic functor
eval(-(A, B)) = eval(A) - eval(B)
eval(*(A, B)) = eval(A) * eval(B)
eval(/(A, B)) = eval(A) / eval(B)    (error if eval(B) = 0)
eval(mod(A, B)) = eval(A) mod eval(B)
eval(abs(A)) = |eval(A)|
eval(max(A, B)) = max(eval(A), eval(B))
eval(min(A, B)) = min(eval(A), eval(B))
eval(X) = ERROR                      when X is an unbound variable
eval(T) = ERROR                      when T is not a recognized arithmetic term
```

**Arithmetic comparison predicates**: These evaluate both sides and compare numerically:

| Predicate | Meaning |
|-----------|---------|
| `</2` | `A < B` -- `eval(A) < eval(B)` |
| `>/2` | `A > B` -- `eval(A) > eval(B)` |
| `=</2` | `A =< B` -- `eval(A) <= eval(B)` |
| `>=/2` | `A >= B` -- `eval(A) >= eval(B)` |
| `=:=/2` | `A =:= B` -- `eval(A) == eval(B)` (arithmetic equality) |
| `=\=/2` | `A =\= B` -- `eval(A) != eval(B)` (arithmetic inequality) |

Note the Prolog-specific `=<` rather than `<=`, inherited from Edinburgh Prolog to avoid ambiguity with arrow notation.

**Arithmetic operators**: `+/2`, `-/2`, `*/2`, `//2`, `mod/2`, `abs/1`, `max/2`, `min/2`. These are not predicates in the usual sense -- they are functors that appear inside arithmetic expressions parsed by `is/2` and the comparison predicates. They are never "called" as goals; they are recognized and evaluated during expression evaluation.

### 4. Type Checking

Type-checking predicates are the purest category of builtins. They inspect a term's structure and succeed or fail deterministically, with no side effects and no bindings.

| Predicate | Succeeds when |
|-----------|---------------|
| `var/1` | argument is an unbound variable |
| `nonvar/1` | argument is not an unbound variable (i.e., it is bound or is a non-variable term) |
| `atom/1` | argument is an atom |
| `number/1` | argument is a number (integer or float) |
| `integer/1` | argument is an integer |
| `float/1` | argument is a float |
| `compound/1` | argument is a compound term (functor with arity > 0) |
| `is_list/1` | argument is a proper list (nil-terminated chain of dot pairs) |

These predicates must resolve variable bindings via the substitution before inspecting the term. `var(X)` after `X = a` should fail, because `X` is bound to `a` (a non-variable). The implementation calls `walk` on the argument's variable (if it is one) to chase the binding chain to its terminus before testing.

`is_list/1` is the most expensive type check because it must traverse the entire list structure to verify nil-termination. A partial list like `[a | X]` where `X` is unbound will cause `is_list` to fail (or, depending on implementation, to raise an instantiation error).

### 5. I/O

I/O builtins are the most obviously impure category. They interact with the external world and cannot be undone on backtracking.

**`write/1`** -- Write a term to standard output. The term is printed in Prolog syntax: atoms as their name (quoted if necessary), numbers as numerals, compounds as `f(a, b)`, lists as `[a, b, c]`, and unbound variables as their internal name (e.g., `_G42` or `_0`).

**`writeln/1`** -- Write a term followed by a newline. Equivalent to `write(X), nl`.

**`nl/0`** -- Write a newline character to standard output.

**`read/1`** -- Read a term from standard input. The input must be a valid Prolog term followed by a dot (`.`). The read term is unified with the argument. This is a blocking operation.

Side effect irreversibility: if the resolver executes `write(hello)`, backtracks, and then succeeds along a different path, the word `hello` has already been printed. There is no mechanism to "unprint" it. Programs that mix I/O with backtracking must be designed carefully to avoid emitting spurious output.

### 6. Meta-programming (Dynamic Predicates)

These builtins modify the [[knowledge-base]] at runtime, blurring the distinction between code and data.

**`assert/1` (also `assertz/1`)** -- Add a clause to the **end** of the clause list for its predicate in the knowledge base. The argument is a term representing a clause: either a fact (`assert(likes(bob, pizza))`) or a rule (`assert((ancestor(X,Y) :- parent(X,Y)))`).

**`asserta/1`** -- Add a clause to the **beginning** of the clause list. This affects which clause is tried first during resolution.

**`retract/1`** -- Remove the first clause in the knowledge base that unifies with the argument. Backtracking into `retract` will remove successive matching clauses.

**`abolish/1`** -- Remove **all** clauses for a given predicate. The argument is typically a predicate indicator `Name/Arity` (e.g., `abolish(likes/2)`).

These predicates create a feedback loop: the program modifies the knowledge base that the program itself is querying. This makes reasoning about program behavior significantly harder.

### 7. Term Manipulation

Term manipulation builtins provide structural access to terms -- decomposing them into parts and reconstructing them from parts.

**`functor/3`** -- `functor(Term, Name, Arity)`. If Term is bound, decomposes it: Name is unified with the functor and Arity with the arity. If Term is unbound but Name and Arity are bound, constructs a new term (with fresh variable arguments if arity > 0).

**`arg/3`** -- `arg(N, Term, Arg)`. Unifies Arg with the Nth argument of compound term Term (1-indexed). Fails if N is out of range or Term is not a compound.

**`=../2` (univ)** -- `Term =.. List`. Converts between a term and a list representation. `f(a, b) =.. [f, a, b]` succeeds. `X =.. [g, 1]` binds X to `g(1)`. The list always has the functor as its first element, followed by the arguments.

**`copy_term/2`** -- `copy_term(Original, Copy)`. Creates a copy of Original with all variables replaced by fresh variables, preserving the structural relationships between variables. If `X` appears twice in Original, the corresponding positions in Copy will share the same fresh variable.

## Rust Type Sketch

```rust
use std::collections::HashMap;

/// Errors that builtins can produce. These are distinct from unification
/// failure (which is a normal control flow outcome). A BuiltinError
/// represents an illegal operation: wrong argument type, unbound variable
/// where a value was required, division by zero, etc.
#[derive(Debug, Clone)]
pub enum BuiltinError {
    /// An argument that should have been bound was an unbound variable.
    /// E.g., `X is Y` when Y is unbound.
    InstantiationError { argument_index: usize },

    /// An argument had the wrong type.
    /// E.g., `X is foo` where foo is an atom, not a number.
    TypeError {
        expected: &'static str,
        got: String,
        argument_index: usize,
    },

    /// An arithmetic operation produced an undefined result.
    /// E.g., division by zero.
    EvaluationError { operation: String, detail: String },

    /// A predicate received the wrong number of arguments.
    /// Should not occur if the registry is correctly populated, but
    /// provides a safety net.
    ArityMismatch { expected: u8, got: u8 },

    /// Attempted to modify a static (non-dynamic) predicate.
    PermissionError { operation: String, target: String },
}

/// The result of executing a builtin predicate.
///
/// Builtins do not return substitutions directly -- they modify the solver's
/// substitution in place (via bind operations). The return value indicates
/// only whether the builtin succeeded or failed.
pub enum BuiltinResult {
    /// The builtin succeeded. Any variable bindings have already been
    /// applied to the solver's substitution.
    Success,

    /// The builtin failed (e.g., a type check returned false, or
    /// two terms did not unify). This triggers normal backtracking.
    Failure,

    /// The builtin produced a cut. The resolver should discard choice
    /// points as specified by cut semantics.
    Cut,
}

/// The signature of a builtin implementation function.
///
/// The function receives the arguments as TermIds (already allocated in the
/// arena) and a mutable reference to the Solver, which provides access to:
/// - The term arena (for inspecting and allocating terms)
/// - The substitution (for binding variables and walking chains)
/// - The trail (for recording bindings so they can be undone)
/// - The knowledge base (for assert/retract)
/// - I/O handles (for read/write)
///
/// The function returns either a BuiltinResult (success/failure/cut) or
/// a BuiltinError (an illegal operation that should be reported to the user).
type BuiltinFn = fn(
    args: &[TermId],
    solver: &mut Solver,
) -> Result<BuiltinResult, BuiltinError>;

/// A predicate key: the unique identifier for a predicate.
/// Same type used by the knowledge base for clause indexing.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PredicateKey {
    pub name: InternedAtom,
    pub arity: u8,
}

/// Registry mapping predicate keys to builtin implementations.
///
/// The registry is populated at interpreter startup and is immutable
/// during query evaluation. This ensures that the set of builtins is
/// fixed -- user code cannot register new builtins at runtime (though
/// it can shadow them by asserting clauses, which the resolver will
/// ignore if the builtin takes priority).
pub struct BuiltinRegistry {
    builtins: HashMap<PredicateKey, BuiltinFn>,
}
```

### Design Rationale

**Why function pointers (`fn`) and not closures (`Box<dyn Fn>`)?** Builtins are stateless functions. They do not capture environment. Using bare `fn` pointers avoids heap allocation, dynamic dispatch overhead, and lifetime complexity. Each builtin is a plain function defined at module scope. If a builtin ever needs mutable state beyond what the `Solver` provides, that state should live in the `Solver`, not in the closure.

**Why `&[TermId]` for arguments?** Arguments are already allocated in the arena by the time the builtin is called. The resolver extracts the arguments from the compound goal term and passes them as a slice. This avoids re-allocation and makes arity checking a simple `args.len()` comparison.

**Why does `BuiltinFn` take `&mut Solver` and not individual components?** Builtins may need to access multiple solver subsystems: the arena (to inspect terms), the substitution (to bind variables), the trail (to record bindings), the knowledge base (for `assert`/`retract`), and I/O handles (for `write`/`read`). Passing the entire solver avoids proliferating parameters. The tradeoff is that builtins have broad access to solver internals, which requires discipline -- a builtin should only touch the subsystems it needs.

**Why `BuiltinResult::Cut` as a separate variant?** Cut is not simply "success." It is success with a side effect on the resolver's choice point stack. By signaling cut through the return type rather than through a flag on the solver, we make the control flow explicit and prevent the resolver from accidentally ignoring a cut signal.

## Operations

### Registry Operations

```rust
impl BuiltinRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        BuiltinRegistry {
            builtins: HashMap::new(),
        }
    }

    /// Register a builtin predicate.
    ///
    /// If a builtin with the same key already exists, it is silently
    /// overwritten. This allows the default registry to be customized.
    ///
    /// Typically called during interpreter initialization, not during
    /// query evaluation.
    pub fn register(&mut self, name: InternedAtom, arity: u8, f: BuiltinFn) {
        self.builtins.insert(PredicateKey { name, arity }, f);
    }

    /// Look up a builtin by predicate key.
    ///
    /// Returns `Some(f)` if the key is registered, `None` otherwise.
    /// O(1) amortized (hash map lookup).
    pub fn lookup(&self, key: PredicateKey) -> Option<BuiltinFn> {
        self.builtins.get(&key).copied()
    }

    /// Check whether a predicate key corresponds to a builtin.
    ///
    /// The resolver calls this before searching the knowledge base:
    /// if `is_builtin(key)` returns true, the knowledge base is not consulted.
    pub fn is_builtin(&self, key: PredicateKey) -> bool {
        self.builtins.contains_key(&key)
    }

    /// Create a registry pre-populated with the standard builtins.
    ///
    /// This is the primary constructor used during interpreter startup.
    pub fn standard(atoms: &mut AtomTable) -> Self {
        let mut reg = Self::new();

        // Control flow
        reg.register(atoms.intern("true"), 0, builtin_true);
        reg.register(atoms.intern("fail"), 0, builtin_fail);
        reg.register(atoms.intern("!"), 0, builtin_cut);

        // Unification
        reg.register(atoms.intern("="), 2, builtin_unify);
        reg.register(atoms.intern("\\="), 2, builtin_not_unifiable);

        // Arithmetic
        reg.register(atoms.intern("is"), 2, builtin_is);
        reg.register(atoms.intern("<"), 2, builtin_lt);
        reg.register(atoms.intern(">"), 2, builtin_gt);
        reg.register(atoms.intern("=<"), 2, builtin_lte);
        reg.register(atoms.intern(">="), 2, builtin_gte);
        reg.register(atoms.intern("=:="), 2, builtin_arith_eq);
        reg.register(atoms.intern("=\\="), 2, builtin_arith_neq);

        // Type checking
        reg.register(atoms.intern("var"), 1, builtin_var);
        reg.register(atoms.intern("nonvar"), 1, builtin_nonvar);
        reg.register(atoms.intern("atom"), 1, builtin_atom);
        reg.register(atoms.intern("number"), 1, builtin_number);
        reg.register(atoms.intern("integer"), 1, builtin_integer);
        reg.register(atoms.intern("float"), 1, builtin_float);
        reg.register(atoms.intern("compound"), 1, builtin_compound);
        reg.register(atoms.intern("is_list"), 1, builtin_is_list);

        // I/O
        reg.register(atoms.intern("write"), 1, builtin_write);
        reg.register(atoms.intern("writeln"), 1, builtin_writeln);
        reg.register(atoms.intern("nl"), 0, builtin_nl);
        reg.register(atoms.intern("read"), 1, builtin_read);

        // Dynamic predicates
        reg.register(atoms.intern("assert"), 1, builtin_assert);
        reg.register(atoms.intern("assertz"), 1, builtin_assert);
        reg.register(atoms.intern("asserta"), 1, builtin_asserta);
        reg.register(atoms.intern("retract"), 1, builtin_retract);
        reg.register(atoms.intern("abolish"), 1, builtin_abolish);

        // Term manipulation
        reg.register(atoms.intern("functor"), 3, builtin_functor);
        reg.register(atoms.intern("arg"), 3, builtin_arg);
        reg.register(atoms.intern("=.."), 2, builtin_univ);
        reg.register(atoms.intern("copy_term"), 2, builtin_copy_term);

        reg
    }
}
```

### Arithmetic Expression Evaluation

The core of `is/2` and the comparison predicates is a recursive expression evaluator. This is a standalone function, not a builtin itself, called by multiple builtins.

```rust
/// Evaluate an arithmetic expression represented as a term.
///
/// Walks the term structure, interpreting recognized functors as
/// arithmetic operations and atoms/numbers as values.
///
/// Returns the numeric result or an error if the expression contains
/// unbound variables, non-numeric atoms, or unrecognized functors.
fn eval_arith(
    term: TermId,
    arena: &TermArena,
    subst: &Substitution,
    atoms: &AtomTable,
) -> Result<f64, BuiltinError> {
    let resolved = subst.walk_term(term, arena);
    match arena.get(resolved) {
        TermNode::Number(n) => Ok(n),
        TermNode::Variable(_) => Err(BuiltinError::InstantiationError {
            argument_index: 0,
        }),
        TermNode::Compound { functor, args } => {
            let name = atoms.resolve(*functor);
            match (name, args.len()) {
                ("+", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    Ok(l + r)
                }
                ("-", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    Ok(l - r)
                }
                ("-", 1) => {
                    let v = eval_arith(args[0], arena, subst, atoms)?;
                    Ok(-v)
                }
                ("*", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    Ok(l * r)
                }
                ("/", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    if r == 0.0 {
                        Err(BuiltinError::EvaluationError {
                            operation: "division".into(),
                            detail: "division by zero".into(),
                        })
                    } else {
                        Ok(l / r)
                    }
                }
                ("mod", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    if r == 0.0 {
                        Err(BuiltinError::EvaluationError {
                            operation: "mod".into(),
                            detail: "division by zero".into(),
                        })
                    } else {
                        Ok(l % r)
                    }
                }
                ("abs", 1) => {
                    let v = eval_arith(args[0], arena, subst, atoms)?;
                    Ok(v.abs())
                }
                ("max", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    Ok(f64::max(l, r))
                }
                ("min", 2) => {
                    let l = eval_arith(args[0], arena, subst, atoms)?;
                    let r = eval_arith(args[1], arena, subst, atoms)?;
                    Ok(f64::min(l, r))
                }
                _ => Err(BuiltinError::TypeError {
                    expected: "arithmetic expression",
                    got: format!("{}/{}", name, args.len()),
                    argument_index: 0,
                }),
            }
        }
        TermNode::Atom(_) => Err(BuiltinError::TypeError {
            expected: "arithmetic expression",
            got: "atom".into(),
            argument_index: 0,
        }),
        TermNode::Nil => Err(BuiltinError::TypeError {
            expected: "arithmetic expression",
            got: "nil".into(),
            argument_index: 0,
        }),
    }
}
```

### Resolver Integration

The resolver's main loop must be extended to check the builtin registry before consulting the knowledge base.

```rust
// Inside the resolution loop, when processing goal `current_goal`:

let key = predicate_key_of(current_goal, arena);

if let Some(builtin_fn) = registry.lookup(key) {
    // Extract arguments from the compound goal term
    let args = match arena.get(current_goal) {
        TermNode::Compound { args, .. } => args.as_slice(),
        TermNode::Atom(_) => &[], // arity-0 builtins
        _ => unreachable!("goal must be atom or compound"),
    };

    match builtin_fn(args, solver) {
        Ok(BuiltinResult::Success) => {
            // Continue with next goal in the goal list
        }
        Ok(BuiltinResult::Failure) => {
            // Trigger backtracking
        }
        Ok(BuiltinResult::Cut) => {
            // Discard choice points, then continue with next goal
        }
        Err(e) => {
            // Report error to user, abort resolution
        }
    }
} else {
    // Search knowledge base for clauses with head key `key`
    // ... existing resolution logic ...
}
```

## Algebraic Properties

Builtins as a whole do not satisfy clean algebraic laws -- that is the nature of escape hatches. However, individual categories have specific properties that serve as testable invariants.

### Pure builtins preserve unification semantics

For any pure builtin `p`:

```
p(args) succeeds with substitution sigma
    implies
sigma is a valid extension of the current substitution (acyclic, idempotent closure yields the same result)
```

This holds for `=/2` (which is literally unification) and for type-checking predicates (which produce no bindings at all, so the substitution is trivially preserved).

### Arithmetic evaluation is a function

`eval_arith` is a **total function** on ground arithmetic terms: given a fully instantiated arithmetic expression with no division by zero, it produces exactly one numeric value. There is no backtracking, no nondeterminism, no choice points.

```
eval(E) = eval(E)                                  (determinism)
eval(E) = v  implies  eval(E) = v  at any point     (referential transparency for ground E)
```

This breaks down for non-ground expressions (instantiation error) and for division by zero (evaluation error).

### Type checks are decidable

For every type-checking predicate `p/1` and every ground term `t`:

```
exactly one of p(t) succeeds or p(t) fails
```

No type check diverges. No type check produces an error on a ground argument. This makes them safe to use anywhere in a goal list without affecting termination.

### Negation as failure double-negation property

```
\+ \+ G  succeeds  iff  G succeeds
\+ \+ G  produces no bindings  (even if G does)
```

This is the "ground test" pattern: `\+ \+ G` tests whether G is provable without committing to any particular proof's bindings.

### Assert/retract are not commutative

```
assert(p(a)), assert(p(b))  is NOT equivalent to  assert(p(b)), assert(p(a))
```

The order affects clause ordering in the knowledge base, which affects the order in which solutions are found by the resolver. Similarly, `retract` removes the **first** matching clause, so `retract(p(X)), retract(p(X))` removes the first two matching clauses, not an arbitrary pair.

### Write is monotonic in side effects

```
write(X), fail  has already printed X even though the goal fails
```

Side effects accumulate monotonically regardless of backtracking outcome. There is no "undo" for output. This is a fundamental property of impure builtins.

## Edge Cases

### 1. `X is Y` when Y is unbound

```prolog
?- X is Y.
```

`eval_arith` encounters `Y` as an unbound variable and must raise an `InstantiationError`. It cannot evaluate an expression it does not know. This is the most common error new Prolog programmers encounter.

The error should report which argument was unbound and where in the expression the unbound variable was found.

### 2. `assert` during resolution -- visibility of new clauses

```prolog
?- assert(likes(bob, pizza)), likes(bob, What).
```

The first goal asserts `likes(bob, pizza)` into the knowledge base. The second goal queries `likes(bob, What)`. The newly asserted clause **must be visible** to the second goal -- it was added before the second goal was resolved.

However, within a single predicate's resolution step, there is a subtlety: if a predicate `p` is being resolved and one of its body goals asserts a new clause for `p`, should the new clause be considered as a candidate for the current resolution of `p`? The standard answer is **no** -- the set of candidate clauses for a goal is fixed at the moment the goal is selected. New clauses affect future goals but not the current one.

Implementation: the resolver should capture the clause list (or an iterator snapshot) when a goal is selected, before executing any subgoals. Clauses asserted during subgoal execution will be present in the knowledge base but not in the captured snapshot.

### 3. `retract` during iteration

```prolog
?- retract(foo(X)), write(X), nl, fail.
```

This retracts and prints each `foo/1` clause in order, using backtracking (via `fail`) to retract successive clauses. The critical concern is that `retract` must not invalidate the resolver's traversal of the clause list.

If the knowledge base stores clauses in a `Vec`, removing an element during iteration can shift indices and cause skipped or duplicated clauses. Solutions:

- **Copy-on-retract**: Mark retracted clauses as deleted rather than removing them. Clean up lazily.
- **Clause list as linked list**: Removal is O(1) and does not invalidate other iterators.
- **Index stability**: Use a `Vec<Option<Clause>>` where retraction replaces the entry with `None`. Iteration skips `None` entries.

### 4. Double negation loses bindings

```prolog
?- \+ \+ member(X, [a, b, c]).
```

This succeeds (because `member(X, [a, b, c])` succeeds), but `X` remains unbound. The inner `\+` runs `member(X, [a, b, c])`, which succeeds and binds `X = a`. Because the inner `\+` *fails* when its goal succeeds, the bindings are undone. The outer `\+` then succeeds because its argument (the inner `\+`) failed.

The result: we know that `X` *can* be a member of `[a, b, c]`, but we do not know which member. This is intentional -- `\+ \+` is a ground provability test.

### 5. `write` on an unbound variable

```prolog
?- write(X).
```

`X` is unbound. The `write` builtin must print a representation of the variable, not crash. The standard approach is to print the variable's internal name, such as `_0` or `_G42`, depending on the naming scheme. The implementation walks the substitution to check if the variable is bound; if it reaches an unbound variable, it prints the variable identifier.

### 6. `cut` inside negation

```prolog
?- \+ (member(X, [a, b, c]), !).
```

The cut inside the negation scope cuts only the choice points created within the `\+` goal -- it does not cut the outer resolution. This is because `\+` runs its argument in a sandboxed context: it saves the current state, attempts the goal, and then either succeeds or fails based on the outcome. The cut's scope is limited to the sandboxed resolution.

If cut were allowed to escape the `\+` scope, it would violate the semantic contract of negation as failure (which is supposed to be a pure test).

### 7. `functor/3` in construction mode

```prolog
?- functor(T, f, 3).
```

`T` is unbound, `f` and `3` are ground. `functor/3` must construct a new term `f(_A, _B, _C)` with three fresh variable arguments and unify it with `T`. The fresh variables must be genuinely fresh -- they must not collide with any variable currently in scope.

Implementation: allocate three new `VarId`s using the solver's variable counter, construct the compound term in the arena, and unify with `T`.

### 8. Arithmetic with mixed integer and float types

```prolog
?- X is 3 + 2.5.
```

If the numeric representation distinguishes integers from floats, arithmetic operations must handle mixed-type cases. The standard approach: if either operand is a float, the result is a float. `3 + 2.5 = 5.5` (not `5`). Division of two integers (`7 / 2`) may produce either `3` (integer division) or `3.5` (float division), depending on the semantic decision. ISO Prolog uses `//` for integer division and `/` for float division.

For simplicity with the f64-only numeric representation in the current [[term]] sketch, this is not an issue -- everything is already a float.

### 9. `is/2` operator precedence

```prolog
?- X is 2 + 3 * 4.
```

The parser must respect standard arithmetic precedence: `*` binds tighter than `+`. The expression `2 + 3 * 4` is parsed as `+(2, *(3, 4))`, not as `*(+(2, 3), 4)`. `eval_arith` then evaluates `*(3, 4) = 12`, then `+(2, 12) = 14`. The result: `X = 14`.

This is a parser concern, not a builtin concern. By the time `eval_arith` sees the term, the precedence is already encoded in the tree structure. The builtin simply evaluates the tree recursively.

### 10. Backtracking into `retract`

```prolog
?- retract(foo(X)).
```

On first call, this retracts and returns the first `foo/1` clause. On backtracking, it retracts and returns the second, and so on. Each backtracking re-entry retracts a new clause. This means `retract/1` is a **nondeterministic** builtin -- it can produce multiple solutions via backtracking.

This is unusual for builtins (most are deterministic). The implementation must either create choice points internally or use a special protocol with the resolver to indicate that the builtin has more solutions available.

## Relationships

### Depends on: [[term]]

Every builtin receives its arguments as `TermId` values allocated in the [[term]] arena. Builtins inspect terms (via `arena.get()`), allocate new terms (via `arena.alloc()`), and construct compound terms for results. The `eval_arith` function recursively walks a term tree, interpreting compound term structure as arithmetic expressions.

The type-checking predicates (`var/1`, `atom/1`, etc.) directly pattern-match on `TermNode` variants. The `write/1` builtin must format terms for display, which requires traversing compound terms and resolving atoms through the `AtomTable`. Every builtin is intimately coupled to the term representation.

### Depends on: [[substitution]]

Builtins that bind variables (like `is/2`, `=/2`, `functor/3`) modify the [[substitution]]. Builtins that inspect terms must first walk the substitution to resolve variable bindings -- `var(X)` must check whether `X` is bound, which requires calling `subst.walk(X)`.

The `\+` builtin must save and restore the substitution state (using the [[trail]]) to implement negation as failure without leaking bindings.

### Depends on: [[knowledge-base]]

The `assert/1`, `retract/1`, and `abolish/1` builtins directly modify the knowledge base. They require mutable access to the clause storage, including the ability to add clauses at specific positions (beginning or end) and to remove matching clauses.

The builtin registry itself is a parallel data structure to the knowledge base: both map predicate keys to behavior. The resolver must check the registry first, then fall back to the knowledge base.

### Depends on: [[resolution]]

Cut (`!/0`) directly manipulates the resolver's choice point stack. Negation as failure (`\+/1`) runs a sub-resolution and inspects the outcome. Disjunction (`;/2`) creates choice points. These builtins are not merely *called by* the resolver -- they *control* it. This creates a bidirectional dependency: the resolver dispatches to builtins, and some builtins dispatch back to the resolver.

This mutual dependency is managed by having builtins communicate through the `Solver` interface rather than directly touching resolver internals. The `BuiltinResult` enum (especially the `Cut` variant) is the structured channel for this communication.

### Relates to: [[repl]]

The REPL is where builtins become user-visible. Error messages from `BuiltinError` are formatted and displayed by the REPL. I/O builtins (`write`, `read`) interact with the REPL's input and output streams. The `assert/retract` builtins allow users to modify the knowledge base interactively, which the REPL may want to reflect in its state display.

## Examples

### Example 1: Arithmetic evaluation -- `?- X is 2 + 3 * 4.`

The parser has already applied operator precedence. The goal term in the arena is:

```
is(X, +(2, *(3, 4)))
```

Expanded as arena entries:

```
TermArena:
  [0] Var(0)                                    -- X
  [1] Number(2.0)                               -- 2
  [2] Number(3.0)                               -- 3
  [3] Number(4.0)                               -- 4
  [4] Compound { functor: "*", args: [T3, T4] } -- *(3, 4)
  [5] Compound { functor: "+", args: [T1, T4] } -- +(2, *(3, 4))
  [6] Compound { functor: "is", args: [T0, T5] }-- is(X, +(2, *(3, 4)))
```

Resolution trace:

1. Resolver selects goal `is(X, +(2, *(3, 4)))` with key `(is, 2)`.
2. Registry lookup: `is/2` is a builtin. Dispatch to `builtin_is`.
3. `builtin_is` receives `args = [TermId(0), TermId(5)]`.
4. Walk `args[1]` through substitution: `TermId(5)` is `+(2, *(3, 4))`, not a variable. No substitution needed.
5. Call `eval_arith(TermId(5), ...)`:
   - `TermId(5)` is `+(2, *(3, 4))`. Functor `+`, arity 2.
   - Left: `eval_arith(TermId(1))` = `2.0`.
   - Right: `eval_arith(TermId(4))`:
     - `TermId(4)` is `*(3, 4)`. Functor `*`, arity 2.
     - Left: `eval_arith(TermId(2))` = `3.0`.
     - Right: `eval_arith(TermId(3))` = `4.0`.
     - Result: `3.0 * 4.0 = 12.0`.
   - Result: `2.0 + 12.0 = 14.0`.
6. Allocate `Number(14.0)` in arena as `TermId(7)`.
7. Walk `args[0]` through substitution: `TermId(0)` is `Var(0)`, unbound.
8. Unify `Var(0)` with `TermId(7)`: bind `Var(0) -> TermId(7)`. Trail push.
9. Return `BuiltinResult::Success`.

Result: `X = 14`.

### Example 2: Negation as failure -- `?- \+ member(d, [a, b, c]).`

```prolog
member(X, [X|_]).
member(X, [_|T]) :- member(X, T).
```

Resolution trace:

1. Resolver selects goal `\+(member(d, [a, b, c]))` with key `(\+, 1)`.
2. Registry lookup: `\+/1` is a builtin. Dispatch to `builtin_naf`.
3. `builtin_naf` saves current state:
   - Trail mark `m = trail.mark()`.
   - (The substitution is not cloned; the trail handles undo.)
4. `builtin_naf` initiates a sub-resolution for `member(d, [a, b, c])`.
5. Sub-resolution attempt:
   - Try Clause 1: `member(d, [d|_])`. Unify `d` with head of list `a`. Fails (`d != a`).
   - Try Clause 2: `member(d, [_|T]) :- member(d, T)`. Head unifies. Body goal: `member(d, [b, c])`.
   - Recurse: Try Clause 1 with `member(d, [b|_])`. Fails (`d != b`).
   - Recurse: Try Clause 2. Body goal: `member(d, [c])`.
   - Recurse: Try Clause 1 with `member(d, [c|_])`. Fails (`d != c`).
   - Recurse: Try Clause 2. Body goal: `member(d, [])`.
   - No clause heads match `member(d, [])`. Sub-resolution fails.
6. The sub-resolution produced no solution. `member(d, [a, b, c])` fails.
7. `builtin_naf` undoes any bindings made during the sub-resolution: `trail.undo(m, &mut subst)`.
8. Since the inner goal failed, `\+` **succeeds**. Return `BuiltinResult::Success`.

Result: `true`.

### Example 3: Dynamic assert and query -- `?- assert(likes(bob, pizza)), likes(bob, What).`

Resolution trace:

1. The goal list is `[assert(likes(bob, pizza)), likes(bob, What)]`.
2. Resolver selects the first goal: `assert(likes(bob, pizza))` with key `(assert, 1)`.
3. Registry lookup: `assert/1` is a builtin. Dispatch to `builtin_assert`.
4. `builtin_assert` receives `args = [TermId for likes(bob, pizza)]`.
5. Parse the argument as a clause: head = `likes(bob, pizza)`, body = `[]` (it is a fact).
6. Add the clause to the knowledge base at the **end** of `likes/2`'s clause list.
7. Return `BuiltinResult::Success`.
8. Resolver selects the second goal: `likes(bob, What)` with key `(likes, 2)`.
9. Registry lookup: `likes/2` is **not** a builtin. Search the knowledge base.
10. Knowledge base now contains `likes(bob, pizza).` (just asserted).
11. Rename clause variables (none in this case -- ground fact).
12. Unify `likes(bob, What)` with `likes(bob, pizza)`: bind `What -> pizza`.
13. Clause body is empty (fact). Goal list is now empty. Resolution succeeds.

Result: `What = pizza`.

### Example 4: Type checking -- `?- atom(foo), var(X), nonvar(foo).`

Resolution trace:

1. Goal list: `[atom(foo), var(X), nonvar(foo)]`.
2. Resolve `atom(foo)`:
   - Walk `foo` through substitution: `foo` is an atom (not a variable). No chain to follow.
   - Check: `arena.get(walked) == TermNode::Atom(_)`. Yes.
   - Return `BuiltinResult::Success`.
3. Resolve `var(X)`:
   - Walk `X` through substitution: `X` is `Var(0)`, unbound.
   - Check: is the walked result still a variable? Yes.
   - Return `BuiltinResult::Success`.
4. Resolve `nonvar(foo)`:
   - Walk `foo` through substitution: `foo` is `Atom(...)`.
   - Check: is the walked result NOT a variable? Correct.
   - Return `BuiltinResult::Success`.
5. Goal list empty. Resolution succeeds.

Result: `true`.

### Example 5: Cut for committed choice -- `?- max(3, 5, M).`

```prolog
max(X, Y, X) :- X >= Y, !.
max(_, Y, Y).
```

Resolution trace:

1. Goal: `max(3, 5, M)`.
2. Try Clause 1: `max(X, Y, X) :- X >= Y, !.`
   - Rename: `max(v1, v2, v1) :- v1 >= v2, !.`
   - Unify `max(3, 5, M)` with `max(v1, v2, v1)`:
     - `v1 = 3`, `v2 = 5`, `M = v1 = 3`.
   - **Create choice point** (Clause 2 is the alternative).
   - Body goals: `[v1 >= v2, !]` under substitution, i.e., `[3 >= 5, !]`.
   - Resolve `3 >= 5`: `eval_arith(3) = 3.0`, `eval_arith(5) = 5.0`. `3.0 >= 5.0` is false.
   - Return `BuiltinResult::Failure`. Backtrack.
3. Backtrack to choice point. Undo bindings (v1, v2, M).
4. Try Clause 2: `max(_, Y, Y).`
   - Rename: `max(v3, v4, v4).`
   - Unify `max(3, 5, M)` with `max(v3, v4, v4)`:
     - `v3 = 3`, `v4 = 5`, `M = v4 = 5`.
   - No choice point (no more clauses).
   - Body is empty (fact). Success.

Result: `M = 5`.

Now consider `?- max(7, 2, M).` where Clause 1 succeeds:

1. Goal: `max(7, 2, M)`.
2. Try Clause 1: rename, unify. `v1 = 7`, `v2 = 2`, `M = v1 = 7`.
3. **Create choice point** for Clause 2.
4. Body goals: `[7 >= 2, !]`.
5. Resolve `7 >= 2`: `7.0 >= 2.0` is true. `BuiltinResult::Success`.
6. Resolve `!`:
   - Return `BuiltinResult::Cut`.
   - Resolver discards the choice point for Clause 2.
7. Goal list empty. Resolution succeeds. No alternative answers.

Result: `M = 7`. Without the cut, Clause 2 would also be tried, producing a spurious `M = 2`.

## Appendix: Builtin Priority and Shadowing

A predicate key can appear in both the builtin registry and the knowledge base. The dispatch rule is:

```
builtin > user-defined clauses
```

If `is/2` is registered as a builtin, a user writing `assert((is(X, X) :- true)).` does not override the builtin. The asserted clause exists in the knowledge base but is never reached by the resolver.

This prevents users from accidentally or maliciously breaking the interpreter's core operations. It also means there is no way to "extend" a builtin with additional clauses. If custom behavior is needed, define a new predicate and delegate to the builtin:

```prolog
my_is(X, Expr) :- X is Expr.
```

Some Prolog implementations allow builtins to be overridden with a `redefine_system_predicate` directive. This is not supported in the current design for simplicity and safety.

## Appendix: Error Taxonomy

Builtin errors fall into a small number of categories, inspired by ISO Prolog's error classification:

| Error type | When it occurs | Example |
|-----------|---------------|---------|
| Instantiation error | Required argument is an unbound variable | `X is Y` (Y unbound) |
| Type error | Argument has wrong type | `X is foo` (foo is an atom, not a number) |
| Evaluation error | Arithmetic operation failed | `X is 1 / 0` |
| Permission error | Operation not allowed on target | `abolish(is/2)` (cannot abolish a builtin) |
| Existence error | Referenced predicate does not exist | `retract(nonexistent(X))` (no clauses to retract) |
| Arity mismatch | Wrong number of arguments | Should never occur if parsing is correct |

Each error must carry enough context for a meaningful error message: the predicate name, the argument index, the expected and actual types, and the source span (if available through the resolver).

## Appendix: Implementation Ordering

Builtins can be implemented incrementally. A suggested order based on dependencies:

1. **`true/0`, `fail/0`** -- trivial; needed for testing the resolver loop.
2. **`=/2`** -- delegates to the existing unification machinery.
3. **Type-checking predicates** (`var/1`, `atom/1`, etc.) -- pure, simple, testable in isolation.
4. **`is/2` and arithmetic comparisons** -- requires `eval_arith`; exercises the term traversal.
5. **`write/1`, `nl/0`** -- enables debugging output during development.
6. **`\+/1`** -- requires sub-resolution; a significant integration test.
7. **`!/0` (cut)** -- requires choice point manipulation; the hardest control flow builtin.
8. **`assert/1`, `retract/1`** -- requires mutable knowledge base access; test dynamic programs.
9. **`functor/3`, `arg/3`, `=../2`, `copy_term/2`** -- term manipulation; needed for meta-programming.
10. **`;/2` (disjunction)** -- requires choice point creation within a builtin.
11. **`read/1`** -- requires integrating the parser into the runtime; defer until the REPL is working.

This ordering ensures that each builtin can be tested as soon as it is implemented, using only previously implemented builtins.

## Appendix: Performance Characteristics

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Registry lookup | O(1) avg | O(1) | HashMap lookup on `PredicateKey` |
| Registry construction | O(n) | O(n) | n = number of builtins; done once at startup |
| `eval_arith` | O(d) | O(d) stack | d = depth of expression tree |
| `write/1` | O(s) | O(d) stack | s = size of term; d = depth for recursion |
| `var/1`, `atom/1`, etc. | O(c) | O(1) | c = chain length for substitution walk |
| `assert/1` | O(1) amort | O(clause size) | Append to Vec; clause is cloned into KB |
| `retract/1` | O(n) | O(1) | n = number of clauses for predicate (linear scan) |
| `copy_term/2` | O(t) | O(t) | t = number of term nodes in the copied term |
| `\+/1` | O(resolution) | O(resolution) | Cost of sub-resolution, bounded by the goal's search space |

The registry lookup is the only overhead added to every resolution step. At O(1) for a HashMap check, this is negligible compared to the cost of unification or clause retrieval.

## Appendix: Comparison with ISO Prolog

The builtins described here are a **subset** of ISO Prolog's built-in predicates (ISO/IEC 13211-1:1995). Key differences from the full ISO standard:

| Feature | ISO Prolog | This implementation |
|---------|-----------|-------------------|
| Exception system | `throw/1`, `catch/3` with structured error terms | `BuiltinError` enum; no in-language exception handling |
| Streams | Multi-stream I/O with `open/3`, `close/1` | Single stdin/stdout via `read/1`, `write/1` |
| Operator definitions | `op/3` for user-defined operators | Fixed operator set from the lexer |
| Module system | `module/2`, `use_module/1` | No modules |
| String handling | `atom_chars/2`, `atom_codes/2`, `char_code/2` | Not implemented (can be added later) |
| Findall/bagof/setof | Higher-order collection predicates | Not implemented (require significant resolver support) |
| `call/N` | Meta-call with variable predicates | Not implemented (requires term-to-goal conversion) |

The implementation focuses on the core builtins needed for a pedagogically complete interpreter. The ISO standard defines over 100 built-in predicates; we implement approximately 30. The architecture (registry + function pointers) makes it straightforward to add more as needed.
