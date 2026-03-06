---
slug: engine
title: Engine
tags: [engine, module]
relationships:
  depends-on: [pramana, builder, reader]
---

# Engine

The engine module contains the [[builder]] (write path) and [[reader]] (read path). These are wired together in the [[cli]] at startup.

## Lifecycle

1. The [[builder]] scans a source directory and ingests all Markdown files into storage
2. The [[reader]] is constructed with storage references and serves queries
3. The storage is in-memory, so all data lives for the duration of the process
