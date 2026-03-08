import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	formatDiagnostics,
	lintFileContent,
	lintGraph,
	lintSource,
	type LintReport,
} from "../../../src/cli/lint.ts";

describe("lintFileContent", () => {
	test("error on missing frontmatter", () => {
		const result = lintFileContent("test.md", "# Just a heading\n\nNo frontmatter.");
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]!.severity).toBe("error");
		expect(result.diagnostics[0]!.message).toContain("No frontmatter");
		expect(result.parsed).toBeUndefined();
	});

	test("error on invalid frontmatter object", () => {
		const raw = "---\njust a string\n---\nbody";
		const result = lintFileContent("test.md", raw);
		expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
		expect(result.parsed).toBeUndefined();
	});

	test("error on missing slug", () => {
		const raw = "---\ntags: [test]\n---\n\nContent.";
		const result = lintFileContent("test.md", raw);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]!.severity).toBe("error");
		expect(result.diagnostics[0]!.message).toContain("slug");
		expect(result.parsed).toBeUndefined();
	});

	test("no diagnostics on valid file", () => {
		const raw = `---
slug: order
summary: An order represents a purchase
tags: [entity, commerce]
relationships:
  depends-on: [customer]
---

# Order

An order depends on [[depends-on::customer]].
`;
		const result = lintFileContent("order.md", raw);
		expect(result.diagnostics).toHaveLength(0);
		expect(result.parsed).toBeDefined();
		expect(result.parsed!.slug).toBe("order");
		expect(result.parsed!.relationships).toHaveLength(2); // 1 FM + 1 wikilink
	});

	test("warn on non-array tags", () => {
		const raw = "---\nslug: test\ntags: entity\n---\n\nBody.";
		const result = lintFileContent("test.md", raw);
		const warns = result.diagnostics.filter((d) => d.severity === "warn");
		expect(warns).toHaveLength(1);
		expect(warns[0]!.message).toContain("not an array");
		expect(result.parsed).toBeDefined();
	});

	test("warn on unknown relationship type in frontmatter", () => {
		const raw = `---
slug: test
relationships:
  uses: [billing]
---

Body.
`;
		const result = lintFileContent("test.md", raw);
		const warns = result.diagnostics.filter((d) => d.severity === "warn");
		expect(warns.some((w) => w.message.includes('Unknown relationship type: "uses"'))).toBe(true);
		expect(result.parsed).toBeDefined();
	});

	test("warn on unknown wikilink type", () => {
		const raw = `---
slug: test
---

Content with [[uses::billing]].
`;
		const result = lintFileContent("test.md", raw);
		const warns = result.diagnostics.filter((d) => d.severity === "warn");
		expect(warns).toHaveLength(1);
		expect(warns[0]!.message).toContain('Unknown wikilink type "uses"');
		expect(warns[0]!.message).toContain("coerced");
		// Wikilink still collected as relates-to for graph checks
		expect(result.parsed!.relationships).toHaveLength(1);
		expect(result.parsed!.relationships[0]!.type).toBe("relates-to");
	});

	test("collects FM and wikilink relationships for graph checks", () => {
		const raw = `---
slug: order
summary: An order represents a purchase
relationships:
  depends-on: [customer, line-item]
---

# Order

Uses [[shipping-info]] and [[depends-on::payment]].
`;
		const result = lintFileContent("order.md", raw);
		expect(result.diagnostics).toHaveLength(0);
		expect(result.parsed!.relationships).toHaveLength(4);
		const targets = result.parsed!.relationships.map((r) => r.target);
		expect(targets).toContain("customer");
		expect(targets).toContain("line-item");
		expect(targets).toContain("shipping-info");
		expect(targets).toContain("payment");
	});

	test("info when summary is missing", () => {
		const raw = `---
slug: test
tags: [entity]
---

# Test
`;
		const result = lintFileContent("test.md", raw);
		const infos = result.diagnostics.filter((d) => d.severity === "info");
		expect(infos).toHaveLength(1);
		expect(infos[0]!.message).toContain("Missing summary");
	});

	test("no summary warning when summary is present", () => {
		const raw = `---
slug: test
summary: A test artifact
tags: [entity]
---

# Test
`;
		const result = lintFileContent("test.md", raw);
		const summaryInfos = result.diagnostics.filter((d) => d.message.includes("summary"));
		expect(summaryInfos).toHaveLength(0);
	});

	test("handles valid relationship types alongside unknown ones", () => {
		const raw = `---
slug: test
relationships:
  depends-on: [customer]
  uses: [billing]
---

Body.
`;
		const result = lintFileContent("test.md", raw);
		const warns = result.diagnostics.filter((d) => d.severity === "warn");
		expect(warns.some((w) => w.message.includes('"uses"'))).toBe(true);
		// Valid depends-on should still be collected
		expect(result.parsed!.relationships).toHaveLength(1);
		expect(result.parsed!.relationships[0]!.target).toBe("customer");
	});
});

describe("lintGraph", () => {
	test("detects dangling links", () => {
		const parsed = [
			{ file: "order.md", slug: "order", relationships: [{ target: "nonexistent", type: "depends-on" }] },
			{ file: "customer.md", slug: "customer", relationships: [] },
		];
		const diags = lintGraph(parsed);
		const errors = diags.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toContain("Dangling link");
		expect(errors[0]!.message).toContain("nonexistent");
	});

	test("detects duplicate slugs", () => {
		const parsed = [
			{ file: "a.md", slug: "order", relationships: [] },
			{ file: "b.md", slug: "order", relationships: [] },
		];
		const diags = lintGraph(parsed);
		const errors = diags.filter((d) => d.severity === "error");
		expect(errors.some((e) => e.message.includes("Duplicate slug"))).toBe(true);
	});

	test("detects orphan artifacts", () => {
		const parsed = [
			{ file: "order.md", slug: "order", relationships: [{ target: "customer", type: "depends-on" }] },
			{ file: "customer.md", slug: "customer", relationships: [] },
			{ file: "orphan.md", slug: "orphan", relationships: [] },
		];
		const diags = lintGraph(parsed);
		const infos = diags.filter((d) => d.severity === "info");
		expect(infos).toHaveLength(1);
		expect(infos[0]!.file).toBe("orphan.md");
		expect(infos[0]!.message).toContain("Orphan");
	});

	test("no diagnostics on healthy graph", () => {
		const parsed = [
			{ file: "order.md", slug: "order", relationships: [{ target: "customer", type: "depends-on" }] },
			{ file: "customer.md", slug: "customer", relationships: [{ target: "order", type: "relates-to" }] },
		];
		const diags = lintGraph(parsed);
		expect(diags).toHaveLength(0);
	});

	test("handles section references in targets", () => {
		const parsed = [
			{ file: "order.md", slug: "order", relationships: [{ target: "customer#billing", type: "depends-on" }] },
			{ file: "customer.md", slug: "customer", relationships: [] },
		];
		const diags = lintGraph(parsed);
		// customer#billing should resolve to customer slug — no dangling link
		expect(diags.filter((d) => d.severity === "error")).toHaveLength(0);
	});

	test("artifact with only inbound links is not orphan", () => {
		const parsed = [
			{ file: "order.md", slug: "order", relationships: [{ target: "customer", type: "depends-on" }] },
			{ file: "customer.md", slug: "customer", relationships: [] },
		];
		const diags = lintGraph(parsed);
		const infos = diags.filter((d) => d.severity === "info");
		// customer has inbound from order, so not orphan
		expect(infos).toHaveLength(0);
	});
});

describe("lintSource", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("lints a valid source directory", async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-lint-"));
		fs.writeFileSync(
			path.join(tmpDir, "order.md"),
			"---\nslug: order\ntags: [entity]\nrelationships:\n  depends-on: customer\n---\n\n# Order\n\nDepends on [[customer]].\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, "customer.md"),
			"---\nslug: customer\ntags: [entity]\n---\n\n# Customer\n",
		);

		const result = await lintSource(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files).toBe(2);
		expect(result.value.errors).toBe(0);
	});

	test("reports dangling links from source scan", async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-lint-"));
		fs.writeFileSync(
			path.join(tmpDir, "order.md"),
			"---\nslug: order\nrelationships:\n  depends-on: nonexistent\n---\n\n# Order\n",
		);

		const result = await lintSource(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.errors).toBeGreaterThan(0);
		expect(result.value.diagnostics.some((d) => d.message.includes("Dangling link"))).toBe(true);
	});

	test("skips _meta/ directory", async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-lint-"));
		fs.writeFileSync(
			path.join(tmpDir, "topic.md"),
			"---\nslug: topic\ntags: [test]\n---\n\n# Topic\n",
		);
		const metaDir = path.join(tmpDir, "_meta");
		fs.mkdirSync(metaDir, { recursive: true });
		fs.writeFileSync(
			path.join(metaDir, "agent.md"),
			"---\nname: agent\n---\n\nNot a knowledge artifact.\n",
		);

		const result = await lintSource(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files).toBe(1);
	});

	test("uses relative paths in diagnostics", async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, "tmp-lint-"));
		fs.writeFileSync(path.join(tmpDir, "bad.md"), "No frontmatter here.");

		const result = await lintSource(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.diagnostics[0]!.file).toBe("bad.md");
	});
});

describe("formatDiagnostics", () => {
	test("formats summary line correctly", () => {
		const report: LintReport = {
			files: 5,
			diagnostics: [],
			errors: 0,
			warnings: 0,
			infos: 0,
		};
		const output = formatDiagnostics(report);
		expect(output).toBe("5 files, 0 errors, 0 warnings, 0 info");
	});

	test("includes diagnostics with severity", () => {
		const report: LintReport = {
			files: 2,
			diagnostics: [
				{ severity: "error", file: "a.md", message: "No frontmatter found" },
				{ severity: "warn", file: "b.md", message: "Unknown type" },
			],
			errors: 1,
			warnings: 1,
			infos: 0,
		};
		const output = formatDiagnostics(report);
		expect(output).toContain("error  a.md  No frontmatter found");
		expect(output).toContain("warn   b.md  Unknown type");
		expect(output).toContain("2 files, 1 errors, 1 warnings, 0 info");
	});
});
