import { Box, Text, useInput } from "ink";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ArtifactView } from "../../engine/reader.ts";
import type { DataSource } from "../data-source.ts";
import {
  ARTIFACT_DETAIL_CHROME,
  ARTIFACT_DETAIL_SCROLL_INDICATOR,
  HORIZONTAL_SCROLL_STEP,
} from "../layout.ts";
import { theme } from "../theme.ts";

type Panel = "content" | "relationships" | "sections";

type Props = {
  dataSource: DataSource;
  tenant: string;
  slug: string;
  isActive: boolean;
  onBack: () => void;
  onNavigate: (slug: string) => void;
  height: number;
};

export function ArtifactDetailView({
  dataSource,
  tenant,
  slug,
  isActive,
  onBack,
  onNavigate,
  height,
}: Props) {
  const [artifact, setArtifact] = useState<ArtifactView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("content");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [relIndex, setRelIndex] = useState(0);
  const [scrollX, setScrollX] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setScrollOffset(0);
    setRelIndex(0);
    setScrollX(0);
    const result = await dataSource.get(tenant, slug);
    if (result.ok) {
      setArtifact(result.value);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [dataSource, tenant, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const allRels = artifact
    ? [
        ...artifact.relationships.map((r) => ({ ...r, direction: "out" as const })),
        ...artifact.inverseRelationships.map((r) => ({ ...r, direction: "in" as const })),
      ]
    : [];

  useInput(
    (input, key) => {
      if (key.escape) {
        onBack();
        return;
      }

      if (key.tab) {
        const panels: Panel[] = ["content", "relationships", "sections"];
        const idx = panels.indexOf(panel);
        setPanel(panels[(idx + 1) % panels.length]!);
        setScrollX(0);
        return;
      }

      if (panel === "content") {
        const contentLines = artifact?.content.split("\n") ?? [];
        const maxScroll = Math.max(
          0,
          contentLines.length -
            (height - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR),
        );
        if (input === "j" || key.downArrow) {
          setScrollOffset((s) => Math.min(s + 1, maxScroll));
        } else if (input === "k" || key.upArrow) {
          setScrollOffset((s) => Math.max(s - 1, 0));
        } else if (input === "d") {
          setScrollOffset((s) => Math.min(s + Math.floor(height / 2), maxScroll));
        } else if (input === "u") {
          setScrollOffset((s) => Math.max(s - Math.floor(height / 2), 0));
        } else if (input === "h" || key.leftArrow) {
          setScrollX((x) => Math.max(x - HORIZONTAL_SCROLL_STEP, 0));
        } else if (input === "l" || key.rightArrow) {
          setScrollX((x) => x + HORIZONTAL_SCROLL_STEP);
        } else if (input === "0") {
          setScrollX(0);
        }
      }

      if (panel === "relationships") {
        if (input === "j" || key.downArrow) {
          setRelIndex((i) => Math.min(i + 1, allRels.length - 1));
        } else if (input === "k" || key.upArrow) {
          setRelIndex((i) => Math.max(i - 1, 0));
        } else if (key.return) {
          const rel = allRels[relIndex];
          if (rel) {
            onNavigate(rel.target.split("#")[0]!);
          }
        }
      }

      if (panel === "sections") {
        if (input === "j" || key.downArrow) {
          setRelIndex((i) => Math.min(i + 1, (artifact?.sections.length ?? 1) - 1));
        } else if (input === "k" || key.upArrow) {
          setRelIndex((i) => Math.max(i - 1, 0));
        } else if (key.return && artifact) {
          const section = artifact.sections[relIndex];
          if (section) {
            const lineIdx = section.line - 1;
            setScrollOffset(lineIdx);
            setPanel("content");
          }
        }
      }
    },
    { isActive },
  );

  if (loading) return <Text color={theme.muted}>Loading {slug}...</Text>;
  if (error) return <Text color={theme.error}>Error: {error}</Text>;
  if (!artifact) return <Text color={theme.error}>Not found: {slug}</Text>;

  const contentLines = artifact.content.split("\n");
  const visibleHeight = height - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR;
  const visibleContent = contentLines.slice(scrollOffset, scrollOffset + visibleHeight);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.primary}>
          {artifact.title}
        </Text>
        <Box>
          <Text color={theme.muted}>slug: {artifact.slug}</Text>
          {artifact.tags.length > 0 && <Text color={theme.tag}> [{artifact.tags.join(", ")}]</Text>}
        </Box>
      </Box>

      {/* Panel tabs */}
      <Box marginBottom={1}>
        {(["content", "relationships", "sections"] as Panel[]).map((p) => (
          <Box key={p} marginRight={2}>
            <Text
              bold={panel === p}
              color={panel === p ? theme.accent : theme.muted}
              underline={panel === p}
            >
              {p}
              {p === "relationships" ? ` (${allRels.length})` : ""}
              {p === "sections" ? ` (${artifact.sections.length})` : ""}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Panel content */}
      {panel === "content" && (
        <Box flexDirection="column">
          {visibleContent.map((line, i) => {
            const lineNum = scrollOffset + i;
            const displayLine = scrollX > 0 ? line.slice(scrollX) : line;
            return (
              <Box key={`L${lineNum}`}>
                <Text wrap="truncate">{renderContentLine(displayLine)}</Text>
              </Box>
            );
          })}
          {(contentLines.length > visibleHeight || scrollX > 0) && (
            <Text color={theme.muted}>
              [{scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, contentLines.length)}/
              {contentLines.length}]{scrollX > 0 ? ` col ${scrollX + 1}` : ""}
            </Text>
          )}
        </Box>
      )}

      {panel === "relationships" && (
        <Box flexDirection="column">
          {allRels.length === 0 ? (
            <Text color={theme.muted}>No relationships</Text>
          ) : (
            allRels.map((rel, i) => (
              <Box key={`${rel.direction}-${rel.target}-${rel.type}`}>
                <Text
                  color={i === relIndex ? theme.selected : undefined}
                  backgroundColor={i === relIndex ? theme.selectedBg : undefined}
                  bold={i === relIndex}
                >
                  {" "}
                </Text>
                <Text color={rel.direction === "out" ? theme.dependsOn : theme.relatesTo}>
                  {rel.direction === "out" ? " \u2192" : " \u2190"}{" "}
                </Text>
                <Text color={rel.type === "depends-on" ? theme.dependsOn : theme.relatesTo}>
                  [{rel.type}]{" "}
                </Text>
                <Text
                  color={i === relIndex ? theme.selected : undefined}
                  backgroundColor={i === relIndex ? theme.selectedBg : undefined}
                >
                  {rel.target}
                </Text>
              </Box>
            ))
          )}
          {allRels.length > 0 && (
            <Box marginTop={1}>
              <Text>
                <Text color={theme.hintKey}>[Enter]</Text>
                <Text color={theme.hintDesc}> follow relationship</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {panel === "sections" && (
        <Box flexDirection="column">
          {artifact.sections.length === 0 ? (
            <Text color={theme.muted}>No sections</Text>
          ) : (
            artifact.sections.map((sec, i) => (
              <Box key={sec.id}>
                <Text
                  color={i === relIndex ? theme.selected : undefined}
                  backgroundColor={i === relIndex ? theme.selectedBg : undefined}
                  bold={i === relIndex}
                >
                  {" "}
                </Text>
                <Text color={theme.muted}>{"  ".repeat(sec.level - 2)}</Text>
                <Text
                  color={i === relIndex ? theme.selected : undefined}
                  backgroundColor={i === relIndex ? theme.selectedBg : undefined}
                >
                  {sec.heading}
                </Text>
                <Text color={theme.muted}> (line {sec.line})</Text>
              </Box>
            ))
          )}
          {artifact.sections.length > 0 && (
            <Box marginTop={1}>
              <Text>
                <Text color={theme.hintKey}>[Enter]</Text>
                <Text color={theme.hintDesc}> jump to section</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text>
          <Text color={theme.hintKey}>[Esc]</Text>
          <Text color={theme.hintDesc}> back </Text>
          <Text color={theme.hintKey}>[Tab]</Text>
          <Text color={theme.hintDesc}> switch panel </Text>
          <Text color={theme.hintKey}>[j/k]</Text>
          <Text color={theme.hintDesc}> scroll </Text>
          <Text color={theme.hintKey}>[d/u]</Text>
          <Text color={theme.hintDesc}> half-page </Text>
          <Text color={theme.hintKey}>[h/l]</Text>
          <Text color={theme.hintDesc}> pan</Text>
        </Text>
      </Box>
    </Box>
  );
}

function renderContentLine(line: string): ReactNode {
  // Headings
  if (line.startsWith("### ")) {
    return (
      <Text color={theme.heading3} bold>
        {line}
      </Text>
    );
  }
  if (line.startsWith("## ")) {
    return (
      <Text color={theme.heading2} bold>
        {line}
      </Text>
    );
  }
  if (line.startsWith("# ")) {
    return (
      <Text color={theme.heading1} bold>
        {line}
      </Text>
    );
  }

  // Render inline formatting
  return renderInline(line);
}

function renderInline(text: string): ReactNode {
  // Match code spans, bold, italic, and wikilinks
  const parts: ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Code spans: `...`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(
        <Text key={`c${keyIdx++}`} color={theme.code}>
          `{codeMatch[2]}`
        </Text>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **...**
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*/);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(boldMatch[1]);
      parts.push(
        <Text key={`b${keyIdx++}`} bold>
          {boldMatch[2]}
        </Text>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Wikilinks: [[...]]
    const wikiMatch = remaining.match(/^(.*?)\[\[([^\]]+)\]\]/);
    if (wikiMatch) {
      if (wikiMatch[1]) parts.push(wikiMatch[1]);
      parts.push(<Text key={`w${keyIdx++}`} color={theme.link}>{`[[${wikiMatch[2]}]]`}</Text>);
      remaining = remaining.slice(wikiMatch[0].length);
      continue;
    }

    // No more patterns — emit remaining text
    parts.push(remaining);
    break;
  }

  if (parts.length === 1) return parts[0];
  return <Text>{parts}</Text>;
}
