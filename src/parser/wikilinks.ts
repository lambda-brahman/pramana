import { type Relationship, type RelationshipType, RELATIONSHIP_TYPES, type Section } from "../schema/index.ts";

const WIKILINK_RE = /\[\[(?:([^:\]]+)::)?([^\]]+)\]\]/g;

export function parseWikilinks(body: string, sections: Section[]): Relationship[] {
  const lines = body.split("\n");
  const relationships: Relationship[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let match: RegExpExecArray | null;

    const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
    while ((match = re.exec(line)) !== null) {
      const rawType = match[1]?.trim() || "refs";
      const type = (RELATIONSHIP_TYPES as readonly string[]).includes(rawType)
        ? (rawType as RelationshipType)
        : "refs" as RelationshipType;
      const target = match[2]!.trim();
      const lineNum = i + 1;

      const section = findContainingSection(lineNum, sections);

      relationships.push({
        target,
        type,
        line: lineNum,
        ...(section ? { section } : {}),
      });
    }
  }

  return relationships;
}

function findContainingSection(line: number, sections: Section[]): string | undefined {
  let current: Section | undefined;
  for (const section of sections) {
    if (section.line <= line) {
      current = section;
    } else {
      break;
    }
  }
  return current?.id;
}
