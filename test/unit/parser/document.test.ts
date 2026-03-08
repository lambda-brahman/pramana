import { test, expect, describe } from "bun:test";
import { parseDocument } from "../../../src/parser/document.ts";

describe("parseDocument", () => {
  test("parses a complete document", () => {
    const raw = `---
slug: order
tags: [entity, commerce]
relationships:
  depends-on: customer
---

# Order

An Order represents a purchase.

## Attributes
- lineItems: [[line-item]][]

## Rules
- Total from [[depends-on::line-item#pricing]]`;

    const result = parseDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const artifact = result.value;
    expect(artifact.slug).toBe("order");
    expect(artifact.title).toBe("Order");
    expect(artifact.tags).toEqual(["entity", "commerce"]);
    expect(artifact.sections).toHaveLength(2);
    expect(artifact.hash).toHaveLength(64);

    // Frontmatter relationship + 2 content wikilinks
    expect(artifact.relationships.length).toBeGreaterThanOrEqual(3);
    expect(artifact.relationships.some((r) => r.target === "customer" && r.type === "depends-on")).toBe(true);
    expect(artifact.relationships.some((r) => r.target === "line-item" && r.type === "relates-to")).toBe(true);
    expect(artifact.relationships.some((r) => r.target === "line-item#pricing" && r.type === "depends-on")).toBe(true);
  });

  test("uses slug as title when no H1", () => {
    const raw = `---
slug: no-title
---

Just content, no heading.`;

    const result = parseDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("no-title");
  });

  test("uses frontmatter title over H1", () => {
    const raw = `---
slug: test
title: FM Title
---

# H1 Title`;

    const result = parseDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("FM Title");
  });

  test("includes summary and aliases in artifact", () => {
    const raw = `---
slug: order
summary: "A customer's intent to purchase"
aliases: [purchase-order, PO]
tags: [entity]
---

# Order

Content.`;

    const result = parseDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("A customer's intent to purchase");
    expect(result.value.aliases).toEqual(["purchase-order", "PO"]);
  });

  test("omits summary and aliases when absent", () => {
    const raw = `---
slug: minimal
---

# Minimal`;

    const result = parseDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBeUndefined();
    expect(result.value.aliases).toBeUndefined();
  });

  test("produces deterministic hash", () => {
    const raw = `---
slug: hash-test
---

# Hash Test`;

    const r1 = parseDocument(raw);
    const r2 = parseDocument(raw);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.hash).toBe(r2.value.hash);
  });
});
