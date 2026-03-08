import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { Builder } from "../../../src/engine/builder.ts";
import { SqlitePlugin } from "../../../src/storage/sqlite/index.ts";

describe("Builder", () => {
  let tmpDir: string;
  let storage: SqlitePlugin;

  afterEach(() => {
    storage?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("_meta/ files are skipped during build", async () => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-builder-"));

    // Create a regular artifact
    fs.writeFileSync(
      path.join(tmpDir, "topic.md"),
      [
        "---",
        "slug: topic",
        "title: Topic",
        "tags: [test]",
        "---",
        "",
        "# Topic",
        "",
        "Some content.",
        "",
      ].join("\n"),
    );

    // Create _meta/ directory with an author agent file
    const metaDir = path.join(tmpDir, "_meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, "author-api-docs.md"),
      [
        "---",
        "name: author-api-docs",
        "description: API documentation author agent",
        "model: inherit",
        "---",
        "",
        "You are an API documentation expert.",
        "",
      ].join("\n"),
    );

    storage = new SqlitePlugin(":memory:");
    storage.initialize();

    const builder = new Builder(storage);
    const result = await builder.build(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the regular artifact should be ingested
      expect(result.value.total).toBe(1);
      expect(result.value.succeeded).toBe(1);
      expect(result.value.failed).toHaveLength(0);
    }

    // Verify the _meta file was not stored
    const getResult = storage.get("author-api-docs");
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value).toBeNull();
    }
  });

  test("regular files still ingested when _meta/ exists", async () => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-builder-"));

    // Create two regular artifacts
    fs.writeFileSync(
      path.join(tmpDir, "first.md"),
      ["---", "slug: first", "title: First", "tags: [test]", "---", "", "# First", ""].join("\n"),
    );
    fs.writeFileSync(
      path.join(tmpDir, "second.md"),
      ["---", "slug: second", "title: Second", "tags: [test]", "---", "", "# Second", ""].join("\n"),
    );

    // Create _meta/ with a file
    const metaDir = path.join(tmpDir, "_meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, "author-tutorial.md"),
      ["---", "name: author-tutorial", "description: Tutorial author", "model: inherit", "---", "", "Write tutorials.", ""].join("\n"),
    );

    storage = new SqlitePlugin(":memory:");
    storage.initialize();

    const builder = new Builder(storage);
    const result = await builder.build(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(2);
      expect(result.value.succeeded).toBe(2);
    }
  });
});
