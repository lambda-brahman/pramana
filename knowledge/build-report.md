---
slug: build-report
title: Build Report
tags: [engine, type]
relationships:
  of: builder
---

# Build Report

Returned by the [[builder]] after ingesting a source directory.

## Fields

- **total** — number of Markdown files found
- **succeeded** — number successfully parsed and stored
- **failed** — array of `{ file, error }` entries

## Usage

The [[cli]] uses the build report to print an ingestion summary to stderr:

```
Ingested 12/14 files (2 failed)
  ✗ path/to/bad.md: Missing required field: slug
  ✗ path/to/other.md: No frontmatter found
```
