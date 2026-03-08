import { err, ok, type Result } from "../lib/result.ts";
import {
  FrontmatterRelationshipsSchema,
  type Relationship,
  type RelationshipType,
} from "../schema/index.ts";

export type FrontmatterData = {
  slug: string;
  title?: string;
  summary?: string;
  aliases?: string[];
  tags: string[];
  relationships: Relationship[];
  body: string;
};

export type FrontmatterError = { type: "frontmatter"; message: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function parseFrontmatter(raw: string): Result<FrontmatterData, FrontmatterError> {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return err({ type: "frontmatter", message: "No frontmatter found" });
  }

  const [, yamlBlock, body] = match;
  const parsed = parseYaml(yamlBlock!);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err({ type: "frontmatter", message: "Frontmatter is not a valid object" });
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.slug !== "string" || obj.slug.length === 0) {
    return err({ type: "frontmatter", message: "Missing required field: slug" });
  }

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : [];

  const relationships = normalizeRelationships(obj.relationships);

  const summary =
    typeof obj.summary === "string" && obj.summary.length > 0 ? obj.summary : undefined;
  const aliases = Array.isArray(obj.aliases)
    ? obj.aliases.filter((a): a is string => typeof a === "string")
    : undefined;

  return ok({
    slug: obj.slug,
    title: typeof obj.title === "string" ? obj.title : undefined,
    summary,
    aliases: aliases && aliases.length > 0 ? aliases : undefined,
    tags,
    relationships,
    body: body!,
  });
}

function normalizeRelationships(raw: unknown): Relationship[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  const parsed = FrontmatterRelationshipsSchema.safeParse(raw);
  if (!parsed.success) return [];

  const result: Relationship[] = [];
  for (const [type, targets] of Object.entries(parsed.data) as [
    RelationshipType,
    string | string[],
  ][]) {
    const targetList = Array.isArray(targets) ? targets : [targets];
    for (const target of targetList) {
      result.push({ target, type });
    }
  }
  return result;
}

export function parseYaml(yaml: string): unknown {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (keyMatch) {
      if (currentKey && currentArray) {
        result[currentKey] = currentArray;
        currentArray = null;
      }

      const [, key, value] = keyMatch;
      currentKey = key!;

      const trimmed = value!.trim();

      if (trimmed === "") {
        currentArray = null;
      } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const inner = trimmed.slice(1, -1);
        result[currentKey] = inner
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        currentKey = null;
      } else {
        result[currentKey] = stripQuotes(trimmed);
        currentKey = null;
      }
      continue;
    }

    const nestedKeyMatch = line.match(/^\s{2}(\w[\w-]*):\s*(.*)/);
    if (nestedKeyMatch && currentKey) {
      if (currentArray) {
        result[currentKey] = currentArray;
        currentArray = null;
      }
      if (typeof result[currentKey] !== "object" || Array.isArray(result[currentKey])) {
        result[currentKey] = {};
      }
      const [, nestedKey, nestedValue] = nestedKeyMatch;
      const trimmed = nestedValue!.trim();

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        (result[currentKey] as Record<string, unknown>)[nestedKey!] = trimmed
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } else {
        (result[currentKey] as Record<string, unknown>)[nestedKey!] = trimmed;
      }
      continue;
    }

    const arrayItemMatch = line.match(/^\s*-\s+(.*)/);
    if (arrayItemMatch && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(arrayItemMatch[1]!.trim());
    }
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
