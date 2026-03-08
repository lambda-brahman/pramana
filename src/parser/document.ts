import { sha256 } from "../lib/hash.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { type KnowledgeArtifact, KnowledgeArtifactSchema } from "../schema/index.ts";
import { type FrontmatterError, parseFrontmatter } from "./frontmatter.ts";
import { parseSections } from "./sections.ts";
import { parseWikilinks } from "./wikilinks.ts";

export type DocumentError =
  | FrontmatterError
  | { type: "read"; message: string }
  | { type: "validation"; message: string };

const TITLE_RE = /^#\s+(.+)$/m;

export function parseDocument(raw: string): Result<KnowledgeArtifact, DocumentError> {
  const fm = parseFrontmatter(raw);
  if (!fm.ok) return fm;

  const {
    slug,
    title: fmTitle,
    summary,
    aliases,
    tags,
    relationships: fmRelationships,
    body,
  } = fm.value;

  const titleMatch = body.match(TITLE_RE);
  const title = fmTitle || titleMatch?.[1]?.trim() || slug;

  const sections = parseSections(body);
  const contentRelationships = parseWikilinks(body, sections);
  const relationships = [...fmRelationships, ...contentRelationships];

  const hash = sha256(raw);

  const artifact = {
    slug,
    title,
    ...(summary ? { summary } : {}),
    ...(aliases ? { aliases } : {}),
    tags,
    relationships,
    sections,
    content: body,
    hash,
  };

  const validated = KnowledgeArtifactSchema.safeParse(artifact);
  if (!validated.success) {
    return err({ type: "validation", message: validated.error.message });
  }

  return ok(validated.data);
}

export async function parseDocumentFromFile(
  filePath: string,
): Promise<Result<KnowledgeArtifact, DocumentError>> {
  try {
    const file = Bun.file(filePath);
    const raw = (await file.text()).replaceAll("\r\n", "\n");
    return parseDocument(raw);
  } catch (e) {
    return err({
      type: "read",
      message: `Failed to read ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
