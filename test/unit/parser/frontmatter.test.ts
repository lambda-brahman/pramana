import { test, expect, describe } from "bun:test";
import { parseFrontmatter } from "../../../src/parser/frontmatter.ts";

describe("parseFrontmatter", () => {
  test("parses slug, tags, and relationships", () => {
    const raw = `---
slug: order
tags: [entity, commerce, core]
relationships:
  needs: customer
  has: [line-item, shipping-info]
---

# Order

Content here.`;

    const result = parseFrontmatter(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.slug).toBe("order");
    expect(result.value.tags).toEqual(["entity", "commerce", "core"]);
    expect(result.value.relationships).toHaveLength(3);
    expect(result.value.relationships).toContainEqual({
      target: "customer",
      type: "needs",
    });
    expect(result.value.relationships).toContainEqual({
      target: "line-item",
      type: "has",
    });
    expect(result.value.relationships).toContainEqual({
      target: "shipping-info",
      type: "has",
    });
  });

  test("returns error when no frontmatter", () => {
    const result = parseFrontmatter("# Just a heading\n\nNo frontmatter.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("frontmatter");
  });

  test("returns error when slug is missing", () => {
    const raw = `---
tags: [test]
---

Content.`;

    const result = parseFrontmatter(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("slug");
  });

  test("handles empty tags", () => {
    const raw = `---
slug: minimal
---

# Minimal`;

    const result = parseFrontmatter(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags).toEqual([]);
    expect(result.value.relationships).toEqual([]);
  });

  test("extracts title from frontmatter", () => {
    const raw = `---
slug: test
title: Custom Title
---

# Different Title`;

    const result = parseFrontmatter(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Custom Title");
  });

  test("preserves body content", () => {
    const raw = `---
slug: test
---

# Title

Body content here.`;

    const result = parseFrontmatter(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.body).toContain("Body content here.");
  });
});
