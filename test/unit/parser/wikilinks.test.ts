import { test, expect, describe } from "bun:test";
import { parseWikilinks } from "../../../src/parser/wikilinks.ts";
import type { Section } from "../../../src/schema/index.ts";

describe("parseWikilinks", () => {
  const sections: Section[] = [
    { id: "attributes", heading: "Attributes", level: 2, line: 3 },
    { id: "rules", heading: "Rules", level: 2, line: 7 },
  ];

  test("parses simple wikilinks", () => {
    const body = `# Order

## Attributes
- lineItems: [[line-item]][] required`;

    const rels = parseWikilinks(body, sections);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toEqual({
      target: "line-item",
      type: "refs",
      line: 4,
      section: "attributes",
    });
  });

  test("parses typed wikilinks", () => {
    const body = `# Order

## Attributes
Some content.

## Rules
- Total from [[needs::line-item#pricing]] values`;

    const rels = parseWikilinks(body, sections);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toEqual({
      target: "line-item#pricing",
      type: "needs",
      line: 7,
      section: "rules",
    });
  });

  test("parses multiple wikilinks on same line", () => {
    const body = `Link to [[order]] and [[customer]] here.`;

    const rels = parseWikilinks(body, []);
    expect(rels).toHaveLength(2);
    expect(rels[0]!.target).toBe("order");
    expect(rels[1]!.target).toBe("customer");
  });

  test("handles empty body", () => {
    const rels = parseWikilinks("", []);
    expect(rels).toHaveLength(0);
  });

  test("assigns correct section context", () => {
    const body = `# Title

## Attributes
Link to [[target-a]]

## Rules
Link to [[target-b]]`;

    const rels = parseWikilinks(body, sections);
    expect(rels).toHaveLength(2);
    expect(rels[0]!.section).toBe("attributes");
    expect(rels[1]!.section).toBe("rules");
  });
});
