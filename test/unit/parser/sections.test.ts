import { test, expect, describe } from "bun:test";
import { parseSections } from "../../../src/parser/sections.ts";

describe("parseSections", () => {
  test("parses H2 and H3 headings", () => {
    const body = `# Title

## Attributes
Some content.

## Rules
More content.

### Sub Rule
Details.`;

    const sections = parseSections(body);
    expect(sections).toHaveLength(3);

    expect(sections[0]).toEqual({
      id: "attributes",
      heading: "Attributes",
      level: 2,
      line: 3,
    });

    expect(sections[1]).toEqual({
      id: "rules",
      heading: "Rules",
      level: 2,
      line: 6,
    });

    expect(sections[2]).toEqual({
      id: "sub-rule",
      heading: "Sub Rule",
      level: 3,
      line: 9,
    });
  });

  test("ignores H1 headings", () => {
    const body = `# Title Only`;
    const sections = parseSections(body);
    expect(sections).toHaveLength(0);
  });

  test("generates kebab-case ids", () => {
    const body = `## My Complex Heading Name`;
    const sections = parseSections(body);
    expect(sections[0]!.id).toBe("my-complex-heading-name");
  });

  test("handles empty body", () => {
    const sections = parseSections("");
    expect(sections).toHaveLength(0);
  });

  test("strips special characters from ids", () => {
    const body = `## Pricing & Discounts (v2)`;
    const sections = parseSections(body);
    expect(sections[0]!.id).toBe("pricing-discounts-v2");
  });
});
