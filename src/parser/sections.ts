import type { Section } from "../schema/index.ts";

const HEADING_RE = /^(#{2,3})\s+(.+)$/;

export function parseSections(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(HEADING_RE);
    if (match) {
      const [, hashes, heading] = match;
      sections.push({
        id: toKebabCase(heading!),
        heading: heading!.trim(),
        level: hashes!.length,
        line: i + 1,
      });
    }
  }

  return sections;
}

function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
