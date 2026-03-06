---
slug: builder
title: Builder
tags: [engine, module]
relationships:
  depends-on: [engine, parser, storage-interface, build-report, sqlite-storage]
---

# Builder

The write-path component of the [[engine]]. Scans a source directory for Markdown files and ingests them into storage.

## Build process

1. Glob for `**/*.md` in the source directory using `Bun.Glob`
2. For each file, call `parseDocumentFromFile` from the [[parser]]
3. Store successful artifacts via the [[storage-interface]]
4. Collect failures into the build report

## Build report

Returns a [[build-report]] with total, succeeded, and failed counts. The [[cli]] prints a summary line and lists any failures to stderr.
