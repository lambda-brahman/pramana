import { err, ok, type Result } from "../lib/result.ts";
import type { KnowledgeArtifact, Relationship, Section } from "../schema/index.ts";
import type {
  SearchResult,
  StorageError,
  StorageReader,
  StorageSearcher,
} from "../storage/interface.ts";

export type ArtifactView = {
  slug: string;
  title: string;
  tags: string[];
  relationships: Relationship[];
  inverseRelationships: Relationship[];
  sections: Section[];
  content: string;
  hash: string;
  focusedSection?: { id: string; heading: string; content: string };
};

export type ListFilter = {
  tags?: string[];
};

export type EngineError = { type: "engine"; message: string };

export class Reader {
  constructor(
    private storage: StorageReader,
    private searcher: StorageSearcher,
  ) {}

  get(slugWithSection: string): Result<ArtifactView | null, EngineError> {
    const [slug, sectionId] = splitSlugSection(slugWithSection);

    const result = this.storage.get(slug!);
    if (!result.ok) return mapError(result);
    if (!result.value) return ok(null);

    return ok(toView(result.value, this.storage, sectionId));
  }

  search(query: string): Result<SearchResult[], EngineError> {
    const result = this.searcher.search(query);
    if (!result.ok) return mapError(result);
    return ok(result.value);
  }

  traverse(from: string, relType?: string, depth: number = 1): Result<ArtifactView[], EngineError> {
    const visited = new Set<string>();
    const results: ArtifactView[] = [];
    const queue: Array<{ slug: string; currentDepth: number }> = [{ slug: from, currentDepth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.slug) || item.currentDepth >= depth) continue;
      visited.add(item.slug);

      const relsResult = this.storage.getRelationships(item.slug);
      if (!relsResult.ok) return mapError(relsResult);

      const rels = relType ? relsResult.value.filter((r) => r.type === relType) : relsResult.value;

      for (const rel of rels) {
        const targetSlug = rel.target.split("#")[0]!;
        if (visited.has(targetSlug)) continue;

        const artifact = this.storage.get(targetSlug);
        if (!artifact.ok) return mapError(artifact);
        if (!artifact.value) continue;

        results.push(toView(artifact.value, this.storage));
        queue.push({ slug: targetSlug, currentDepth: item.currentDepth + 1 });
      }
    }

    return ok(results);
  }

  list(filter?: ListFilter): Result<ArtifactView[], EngineError> {
    const result = this.storage.list(filter ? { tags: filter.tags } : undefined);
    if (!result.ok) return mapError(result);

    return ok(result.value.map((a) => toView(a, this.storage)));
  }
}

function splitSlugSection(input: string): [string, string | undefined] {
  const idx = input.indexOf("#");
  if (idx === -1) return [input, undefined];
  return [input.slice(0, idx), input.slice(idx + 1)];
}

function toView(
  artifact: KnowledgeArtifact,
  storage: StorageReader,
  sectionId?: string,
): ArtifactView {
  const inverseResult = storage.getInverse(artifact.slug);
  const inverseRelationships = inverseResult.ok ? inverseResult.value : [];

  const view: ArtifactView = {
    slug: artifact.slug,
    title: artifact.title,
    tags: artifact.tags,
    relationships: artifact.relationships,
    inverseRelationships,
    sections: artifact.sections,
    content: artifact.content,
    hash: artifact.hash,
  };

  if (sectionId) {
    const section = artifact.sections.find((s) => s.id === sectionId);
    if (section) {
      view.focusedSection = {
        id: section.id,
        heading: section.heading,
        content: extractSectionContent(artifact.content, section, artifact.sections),
      };
    }
  }

  return view;
}

function extractSectionContent(content: string, section: Section, allSections: Section[]): string {
  const lines = content.split("\n");
  const startLine = section.line;

  const nextSection = allSections.find((s) => s.line > section.line && s.level <= section.level);
  const endLine = nextSection ? nextSection.line - 1 : lines.length;

  return lines.slice(startLine, endLine).join("\n").trim();
}

function mapError(result: { ok: false; error: StorageError }): Result<never, EngineError> {
  return err({ type: "engine", message: result.error.message });
}
