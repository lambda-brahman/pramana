import { test, expect, describe, beforeEach } from "bun:test";
import { SqlitePlugin } from "../../../src/storage/sqlite/index.ts";
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

describe("SqlitePlugin", () => {
  let db: SqlitePlugin;

  beforeEach(() => {
    db = new SqlitePlugin(":memory:");
    const init = db.initialize();
    expect(init.ok).toBe(true);
  });

  test("store and get artifact", () => {
    const artifact = makeArtifact();
    const stored = db.store(artifact);
    expect(stored.ok).toBe(true);

    const got = db.get("test");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).not.toBeNull();
    expect(got.value!.slug).toBe("test");
    expect(got.value!.title).toBe("Test");
    expect(got.value!.tags).toEqual(["entity"]);
  });

  test("get returns null for missing slug", () => {
    const got = db.get("nonexistent");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).toBeNull();
  });

  test("store with relationships", () => {
    const artifact = makeArtifact({
      relationships: [
        { target: "other", type: "needs" },
        { target: "another", type: "has", line: 5, section: "attributes" },
      ],
    });
    db.store(artifact);

    const rels = db.getRelationships("test");
    expect(rels.ok).toBe(true);
    if (!rels.ok) return;
    expect(rels.value).toHaveLength(2);
    expect(rels.value[0]!.target).toBe("other");
    expect(rels.value[1]!.line).toBe(5);
  });

  test("store with sections", () => {
    const artifact = makeArtifact({
      sections: [
        { id: "attrs", heading: "Attributes", level: 2, line: 3 },
        { id: "rules", heading: "Rules", level: 2, line: 7 },
      ],
    });
    db.store(artifact);

    const got = db.get("test");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value!.sections).toHaveLength(2);
    expect(got.value!.sections[0]!.id).toBe("attrs");
  });

  test("list all artifacts", () => {
    db.store(makeArtifact({ slug: "a", tags: ["entity"] }));
    db.store(makeArtifact({ slug: "b", tags: ["value-object"] }));

    const listed = db.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);
  });

  test("list with tag filter", () => {
    db.store(makeArtifact({ slug: "a", tags: ["entity", "core"] }));
    db.store(makeArtifact({ slug: "b", tags: ["value-object"] }));

    const listed = db.list({ tags: ["entity"] });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]!.slug).toBe("a");
  });

  test("list with multiple tag filter (AND)", () => {
    db.store(makeArtifact({ slug: "a", tags: ["entity", "core"] }));
    db.store(makeArtifact({ slug: "b", tags: ["entity"] }));

    const listed = db.list({ tags: ["entity", "core"] });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]!.slug).toBe("a");
  });

  test("inverse relationships", () => {
    db.store(
      makeArtifact({
        slug: "order",
        relationships: [{ target: "customer", type: "needs" }],
      })
    );
    db.store(makeArtifact({ slug: "customer" }));

    const inverse = db.getInverse("customer");
    expect(inverse.ok).toBe(true);
    if (!inverse.ok) return;
    expect(inverse.value).toHaveLength(1);
    expect(inverse.value[0]!.target).toBe("order");
    expect(inverse.value[0]!.type).toBe("needs");
  });

  test("FTS search", () => {
    db.store(
      makeArtifact({
        slug: "order",
        title: "Order",
        content: "An Order represents a customer's intent to purchase.",
      })
    );
    db.store(
      makeArtifact({
        slug: "customer",
        title: "Customer",
        content: "A registered user.",
      })
    );

    const results = db.search("purchase intent");
    expect(results.ok).toBe(true);
    if (!results.ok) return;
    expect(results.value.length).toBeGreaterThanOrEqual(1);
    expect(results.value[0]!.slug).toBe("order");
  });

  test("upsert replaces existing artifact", () => {
    db.store(makeArtifact({ slug: "test", title: "V1" }));
    db.store(makeArtifact({ slug: "test", title: "V2" }));

    const got = db.get("test");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value!.title).toBe("V2");
  });
});
