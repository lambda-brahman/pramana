---
slug: builder
title: Builder
tags: [module, engine]
relationships:
  part-of: engine
  uses: [parser, storage-interface]
  produces: build-report
---

# Builder

The write-path component of the [[engine]]. Scans a source directory for Markdown files and ingests them into storage.

## Build process

1. Glob for `**/*.md` in the source directory using `Bun.Glob`
2. For each file, call `parseDocumentFromFile` from the [[parser]]
3. Store successful artifacts via the [[storage-interface]]
4. Collect failures into the build report

## Build report

Returns a `BuildReport` with:

- **total** — number of files found
- **succeeded** — number successfully ingested
- **failed** — array of `{ file, error }` for each failure

The [[cli]] prints a summary line and lists any failures to stderr.
