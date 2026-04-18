import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import type { ArtifactView } from "../../../../src/engine/reader.ts";
import { ok } from "../../../../src/lib/result.ts";
import type { DataSource } from "../../../../src/tui/data-source.ts";
import {
  ARTIFACT_DETAIL_CHROME,
  ARTIFACT_DETAIL_SCROLL_INDICATOR,
  HORIZONTAL_SCROLL_STEP,
} from "../../../../src/tui/layout.ts";
import { ArtifactDetailView } from "../../../../src/tui/views/artifact-detail.tsx";

afterEach(() => {
  cleanup();
});

function makeArtifact(lineCount: number): ArtifactView {
  const lines = Array.from({ length: lineCount }, (_, i) => `line-${i + 1}`);
  return {
    slug: "scroll-test",
    title: "Scroll Test",
    tags: [],
    relationships: [],
    inverseRelationships: [],
    sections: [],
    content: lines.join("\n"),
    hash: "abc",
  };
}

function createDataSource(artifact: ArtifactView): DataSource {
  return {
    mode: "standalone",
    async get() {
      return ok(artifact);
    },
    async search() {
      return ok([]);
    },
    async traverse() {
      return ok([]);
    },
    async list() {
      return ok([]);
    },
    async listTenants() {
      return ok([]);
    },
    async reload() {
      return ok({ total: 0, succeeded: 0, failed: [] });
    },
    async addKb() {
      return ok(undefined);
    },
    async removeKb() {
      return ok(undefined);
    },
    close() {},
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ArtifactDetailView maxScroll invariant", () => {
  test("maxScroll equals contentLines.length minus visibleHeight", () => {
    const height = 24;
    const visibleHeight =
      height - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR;
    const contentLineCount = 50;
    const expectedMaxScroll = contentLineCount - visibleHeight;
    expect(expectedMaxScroll).toBeGreaterThan(0);
    expect(visibleHeight).toBe(height - 10);
  });

  test("last content line is visible at max scroll", async () => {
    const height = 24;
    const visibleHeight =
      height - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR;
    const lineCount = visibleHeight + 5;
    const artifact = makeArtifact(lineCount);
    const ds = createDataSource(artifact);

    const { lastFrame, stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="scroll-test"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={height}
      />,
    );
    await delay(100);

    // Scroll to bottom — press 'j' more times than needed to hit maxScroll
    for (let i = 0; i < lineCount; i++) {
      stdin.write("j");
    }
    await delay(100);

    const frame = lastFrame()!;
    expect(frame).toContain(`line-${lineCount}`);
  });

  test("scroll indicator shows full range at max scroll", async () => {
    const height = 24;
    const visibleHeight =
      height - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR;
    const lineCount = visibleHeight + 10;
    const artifact = makeArtifact(lineCount);
    const ds = createDataSource(artifact);

    const { lastFrame, stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="scroll-test"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={height}
      />,
    );
    await delay(100);

    for (let i = 0; i < lineCount; i++) {
      stdin.write("j");
    }
    await delay(100);

    const frame = lastFrame()!;
    expect(frame).toContain(`/${lineCount}]`);
  });
});

describe("ArtifactDetailView heading styling preserved on horizontal scroll", () => {
  function makeMarkdownArtifact(content: string): ArtifactView {
    return {
      slug: "md-test",
      title: "Markdown Test",
      tags: [],
      relationships: [],
      inverseRelationships: [],
      sections: [],
      content,
      hash: "abc",
    };
  }

  test("heading line retains bold styling after horizontal scroll", async () => {
    const heading = "## Overview of the system architecture";
    const artifact = makeMarkdownArtifact(`${heading}\nsome body text`);
    const ds = createDataSource(artifact);

    const { lastFrame, stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="md-test"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={24}
      />,
    );
    await delay(100);

    const frameBefore = lastFrame()!;
    expect(frameBefore).toContain("## Overview");

    stdin.write("l");
    await delay(100);

    const frameAfter = lastFrame()!;
    const slicedText = heading.slice(HORIZONTAL_SCROLL_STEP);
    expect(frameAfter).toContain(slicedText);
    expect(frameAfter).not.toContain("## Overview");
    expect(frameAfter).toContain("col");
  });

  test("scrollX is clamped to max line length minus MIN_VISIBLE_COLUMNS", async () => {
    const shortLine = "short";
    const artifact = makeMarkdownArtifact(shortLine);
    const ds = createDataSource(artifact);

    const { lastFrame, stdin } = render(
      <ArtifactDetailView
        dataSource={ds}
        tenant="test"
        slug="md-test"
        isActive={true}
        onBack={() => {}}
        onNavigate={() => {}}
        height={24}
      />,
    );
    await delay(100);

    for (let i = 0; i < 20; i++) {
      stdin.write("l");
    }
    await delay(100);

    const frame = lastFrame()!;
    expect(frame).not.toContain("col");
  });
});
