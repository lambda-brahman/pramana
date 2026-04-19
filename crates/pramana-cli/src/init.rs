use std::path::Path;

pub fn cmd_init(dir: &Path) -> i32 {
    if dir.exists() {
        eprintln!("Directory already exists: {}", dir.display());
        return 1;
    }

    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("Failed to create directory: {e}");
        return 1;
    }

    let sample = dir.join("getting-started.md");
    let content = r#"---
slug: getting-started
title: Getting Started
summary: Introduction to this knowledge base
tags:
  - onboarding
---

# Getting Started

Welcome to your new knowledge base.

## Adding Artifacts

Create `.md` files with YAML frontmatter:

```yaml
---
slug: my-artifact
title: My Artifact
summary: A brief description
tags:
  - example
---
```

## Linking Artifacts

Use wikilinks to connect artifacts: [[getting-started]]
"#;

    if let Err(e) = std::fs::write(&sample, content) {
        eprintln!("Failed to write sample artifact: {e}");
        return 1;
    }

    println!("Initialized knowledge base at {}", dir.display());
    println!("  Created {}", sample.display());
    println!("\nServe it with: pramana serve --source {}", dir.display());
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_fails_on_existing_dir() {
        let dir = std::env::temp_dir().join("pramana-test-init-existing");
        std::fs::create_dir_all(&dir).unwrap();
        let code = cmd_init(&dir);
        assert_eq!(code, 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn init_creates_knowledge_base() {
        let dir = std::env::temp_dir().join("pramana-test-init-new");
        let _ = std::fs::remove_dir_all(&dir);
        let code = cmd_init(&dir);
        assert_eq!(code, 0);
        assert!(dir.join("getting-started.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
