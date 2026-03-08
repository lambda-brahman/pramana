import { Glob } from "bun";
import { err, ok, type Result } from "../lib/result.ts";
import { parseYaml } from "../parser/frontmatter.ts";
import { FrontmatterRelationshipsSchema, RELATIONSHIP_TYPES } from "../schema/index.ts";

export type Severity = "error" | "warn" | "info";

export type LintDiagnostic = {
  severity: Severity;
  file: string;
  message: string;
};

export type LintReport = {
  files: number;
  diagnostics: LintDiagnostic[];
  errors: number;
  warnings: number;
  infos: number;
};

export type LintError = { type: "lint"; message: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const WIKILINK_RE = /\[\[(?:([^:\]]+)::)?([^\]]+)\]\]/g;

type ParsedFileInfo = {
  file: string;
  slug: string;
  relationships: Array<{ target: string; type: string }>;
};

type FileLintResult = {
  diagnostics: LintDiagnostic[];
  parsed?: ParsedFileInfo;
};

export function lintFileContent(file: string, raw: string): FileLintResult {
  const diagnostics: LintDiagnostic[] = [];

  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    diagnostics.push({ severity: "error", file, message: "No frontmatter found" });
    return { diagnostics };
  }

  const [, yamlBlock, body] = match;
  const parsed = parseYaml(yamlBlock!);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push({ severity: "error", file, message: "Frontmatter is not a valid object" });
    return { diagnostics };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.slug !== "string" || obj.slug.length === 0) {
    diagnostics.push({ severity: "error", file, message: "Missing required field: slug" });
    return { diagnostics };
  }
  const slug = obj.slug;

  // Tags check
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      diagnostics.push({ severity: "warn", file, message: "Tags field is not an array" });
    } else {
      const nonStrings = obj.tags.filter((t) => typeof t !== "string");
      if (nonStrings.length > 0) {
        diagnostics.push({
          severity: "warn",
          file,
          message: `Non-string tags filtered: ${nonStrings.map(String).join(", ")}`,
        });
      }
    }
  }

  // Frontmatter relationships check
  const relationships: Array<{ target: string; type: string }> = [];

  if (obj.relationships !== undefined) {
    if (
      typeof obj.relationships !== "object" ||
      Array.isArray(obj.relationships) ||
      obj.relationships === null
    ) {
      diagnostics.push({
        severity: "warn",
        file,
        message: "Relationships field should be an object mapping types to targets",
      });
    } else {
      const relObj = obj.relationships as Record<string, unknown>;
      const validEntries: Record<string, unknown> = {};

      for (const key of Object.keys(relObj)) {
        if (!(RELATIONSHIP_TYPES as readonly string[]).includes(key)) {
          diagnostics.push({
            severity: "warn",
            file,
            message: `Unknown relationship type: "${key}"`,
          });
        } else {
          validEntries[key] = relObj[key];
        }
      }

      const parseResult = FrontmatterRelationshipsSchema.safeParse(validEntries);
      if (!parseResult.success) {
        diagnostics.push({
          severity: "warn",
          file,
          message: "Frontmatter relationships failed to parse",
        });
      } else {
        for (const [type, targets] of Object.entries(parseResult.data)) {
          const targetList = Array.isArray(targets) ? targets : [targets];
          for (const target of targetList) {
            relationships.push({ target, type });
          }
        }
      }
    }
  }

  // Wikilink type check
  const fmLineCount = yamlBlock!.split("\n").length + 2;
  const lines = body!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
    let wlMatch: RegExpExecArray | null = null;
    while ((wlMatch = re.exec(line)) !== null) {
      const rawType = wlMatch[1]?.trim();
      const target = wlMatch[2]!.trim();
      const absLine = fmLineCount + i + 1;

      if (rawType && !(RELATIONSHIP_TYPES as readonly string[]).includes(rawType)) {
        diagnostics.push({
          severity: "warn",
          file,
          message: `Unknown wikilink type "${rawType}" at line ${absLine}, coerced to "relates-to"`,
        });
      }

      const resolvedType =
        rawType && (RELATIONSHIP_TYPES as readonly string[]).includes(rawType)
          ? rawType
          : "relates-to";
      relationships.push({ target, type: resolvedType });
    }
  }

  return { diagnostics, parsed: { file, slug, relationships } };
}

export function lintGraph(
  parsedFiles: Array<{
    file: string;
    slug: string;
    relationships: Array<{ target: string; type: string }>;
  }>,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const allSlugs = new Set(parsedFiles.map((f) => f.slug));
  const slugToFiles = new Map<string, string[]>();
  const referencedSlugs = new Set<string>();

  for (const pf of parsedFiles) {
    const existing = slugToFiles.get(pf.slug) ?? [];
    existing.push(pf.file);
    slugToFiles.set(pf.slug, existing);
  }

  // Duplicate slugs
  for (const [slug, files] of slugToFiles) {
    if (files.length > 1) {
      diagnostics.push({
        severity: "error",
        file: files.join(", "),
        message: `Duplicate slug: "${slug}"`,
      });
    }
  }

  // Dangling links
  for (const pf of parsedFiles) {
    for (const rel of pf.relationships) {
      const targetSlug = rel.target.split("#")[0]!;
      referencedSlugs.add(targetSlug);
      if (!allSlugs.has(targetSlug)) {
        diagnostics.push({
          severity: "error",
          file: pf.file,
          message: `Dangling link: ${rel.type} → "${rel.target}" (slug not found)`,
        });
      }
    }
  }

  // Orphan artifacts
  for (const pf of parsedFiles) {
    const hasOutbound = pf.relationships.length > 0;
    const hasInbound = referencedSlugs.has(pf.slug);
    if (!hasOutbound && !hasInbound) {
      diagnostics.push({
        severity: "info",
        file: pf.file,
        message: "Orphan artifact: no inbound or outbound relationships",
      });
    }
  }

  return diagnostics;
}

export async function lintSource(sourceDir: string): Promise<Result<LintReport, LintError>> {
  try {
    const glob = new Glob("**/*.md");
    const files: string[] = [];

    for await (const file of glob.scan({ cwd: sourceDir, absolute: true })) {
      const relative = file.slice(sourceDir.length + 1);
      if (relative.startsWith("_meta/") || relative.startsWith("_meta\\")) continue;
      files.push(file);
    }

    const diagnostics: LintDiagnostic[] = [];
    const parsedFiles: ParsedFileInfo[] = [];

    for (const file of files) {
      const raw = (await Bun.file(file).text()).replaceAll("\r\n", "\n");
      const relPath = file.slice(sourceDir.length + 1);
      const result = lintFileContent(relPath, raw);
      diagnostics.push(...result.diagnostics);
      if (result.parsed) {
        parsedFiles.push(result.parsed);
      }
    }

    const graphDiags = lintGraph(parsedFiles);
    diagnostics.push(...graphDiags);

    return ok(buildReport(files.length, diagnostics));
  } catch (e) {
    return err({
      type: "lint",
      message: `Lint failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export async function lintFromDaemon(
  port: string,
  tenant: string,
): Promise<Result<LintReport, LintError>> {
  try {
    const res = await fetch(`http://localhost:${port}/v1/${tenant}/list`);
    if (!res.ok) {
      return err({ type: "lint", message: `Daemon returned ${res.status}` });
    }

    const artifacts = (await res.json()) as Array<{
      slug: string;
      relationships: Array<{ target: string; type: string }>;
    }>;

    const parsedFiles = artifacts.map((a) => ({
      file: a.slug,
      slug: a.slug,
      relationships: a.relationships,
    }));

    const diagnostics = lintGraph(parsedFiles);
    return ok(buildReport(artifacts.length, diagnostics));
  } catch (e) {
    return err({
      type: "lint",
      message: `Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

function buildReport(files: number, diagnostics: LintDiagnostic[]): LintReport {
  return {
    files,
    diagnostics,
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warn").length,
    infos: diagnostics.filter((d) => d.severity === "info").length,
  };
}

export function formatDiagnostics(report: LintReport): string {
  const lines: string[] = [];

  for (const d of report.diagnostics) {
    const severity = d.severity.padEnd(5);
    lines.push(`${severity}  ${d.file}  ${d.message}`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("");
  }

  lines.push(
    `${report.files} files, ${report.errors} errors, ${report.warnings} warnings, ${report.infos} info`,
  );

  return lines.join("\n");
}
