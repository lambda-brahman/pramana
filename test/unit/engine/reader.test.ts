import { test, expect, describe, beforeEach } from "bun:test";
import { SqlitePlugin } from "../../../src/storage/sqlite/index.ts";
import { Reader } from "../../../src/engine/reader.ts";
import type { KnowledgeArtifact } from "../../../src/schema/index.ts";

function makeArtifact(overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
  return {
    slug: "test",
    title: "Test",
    tags: ["entity"],
    relationships: [],
    sections: [],
    content: "# Test\n\nContent.",
    hash: "abc123",
    ...overrides,
  };
}

describe("Reader", () => {
  let storage: SqlitePlugin;
  let reader: Reader;

  beforeEach(() => {
    storage = new SqlitePlugin(":memory:");
    storage.initialize();
    reader = new Reader(storage, storage);
  });

  test("get returns artifact view", () => {
    storage.store(makeArtifact({ slug: "order", title: "Order" }));

    const result = reader.get("order");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.slug).toBe("order");
    expect(result.value!.inverseRelationships).toBeDefined();
  });

  test("get with section focus", () => {
    storage.store(
      makeArtifact({
        slug: "order",
        content: "# Order\n\n## Attributes\nSome attrs.\n\n## Rules\nSome rules.",
        sections: [
          { id: "attributes", heading: "Attributes", level: 2, line: 3 },
          { id: "rules", heading: "Rules", level: 2, line: 6 },
        ],
      })
    );

    const result = reader.get("order#attributes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value!.focusedSection).toBeDefined();
    expect(result.value!.focusedSection!.id).toBe("attributes");
    expect(result.value!.focusedSection!.content).toContain("Some attrs.");
  });

  test("get returns null for missing slug", () => {
    const result = reader.get("nonexistent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  test("traverse follows relationships", () => {
    storage.store(
      makeArtifact({
        slug: "order",
        relationships: [{ target: "customer", type: "depends-on" }],
      })
    );
    storage.store(makeArtifact({ slug: "customer", title: "Customer" }));

    const result = reader.traverse("order", "depends-on");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.slug).toBe("customer");
  });

  test("traverse with depth", () => {
    storage.store(
      makeArtifact({
        slug: "a",
        relationships: [{ target: "b", type: "relates-to" }],
      })
    );
    storage.store(
      makeArtifact({
        slug: "b",
        relationships: [{ target: "c", type: "relates-to" }],
      })
    );
    storage.store(makeArtifact({ slug: "c" }));

    const depth1 = reader.traverse("a", "relates-to", 1);
    expect(depth1.ok).toBe(true);
    if (!depth1.ok) return;
    expect(depth1.value).toHaveLength(1);

    const depth2 = reader.traverse("a", "relates-to", 2);
    expect(depth2.ok).toBe(true);
    if (!depth2.ok) return;
    expect(depth2.value).toHaveLength(2);
  });

  test("list with tag filter", () => {
    storage.store(makeArtifact({ slug: "a", tags: ["entity", "core"] }));
    storage.store(makeArtifact({ slug: "b", tags: ["value-object"] }));

    const result = reader.list({ tags: ["entity"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.slug).toBe("a");
  });

  test("search returns ranked results", () => {
    storage.store(
      makeArtifact({
        slug: "order",
        title: "Order",
        content: "A purchase intent.",
      })
    );

    const result = reader.search("purchase");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(1);
  });

  test("get includes inverse relationships", () => {
    storage.store(
      makeArtifact({
        slug: "order",
        relationships: [{ target: "customer", type: "depends-on" }],
      })
    );
    storage.store(makeArtifact({ slug: "customer" }));

    const result = reader.get("customer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value!.inverseRelationships).toHaveLength(1);
    expect(result.value!.inverseRelationships[0]!.target).toBe("order");
  });
});
