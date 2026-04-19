# Contributing to Pramana

## TUI: ratatui panic hook requirement

Any file that calls `ratatui::init()` **must** install a panic hook before it to
restore the terminal on panic. Without this, a panic leaves the terminal in raw
mode, requiring a manual `reset`.

Required pattern (see `crates/pramana-tui/src/app.rs`):

```rust
let prev_hook = std::panic::take_hook();
std::panic::set_hook(Box::new(move |info| {
    ratatui::restore();
    prev_hook(info);
}));

let mut terminal = ratatui::init();
```

CI enforces this: any `.rs` file containing `ratatui::init()` must also contain
`panic::set_hook`, or the build fails.
