import { describe, expect, test } from "bun:test";
import {
  APP_CHROME_LINES,
  ARTIFACT_DETAIL_CHROME,
  ARTIFACT_DETAIL_SCROLL_INDICATOR,
  ARTIFACT_LIST_CHROME,
  ARTIFACT_LIST_FILTER_LINES,
  GRAPH_CHROME,
  KB_LIST_CHROME,
  KB_LIST_FORM_LINES,
  SEARCH_CHROME,
  SEARCH_RESULT_COUNT_LINES,
} from "../../../src/tui/layout.ts";

describe("layout constants", () => {
  const allConstants = [
    APP_CHROME_LINES,
    KB_LIST_CHROME,
    KB_LIST_FORM_LINES,
    ARTIFACT_LIST_CHROME,
    ARTIFACT_LIST_FILTER_LINES,
    ARTIFACT_DETAIL_CHROME,
    ARTIFACT_DETAIL_SCROLL_INDICATOR,
    SEARCH_CHROME,
    SEARCH_RESULT_COUNT_LINES,
    GRAPH_CHROME,
  ];

  test("all constants are positive integers", () => {
    for (const c of allConstants) {
      expect(c).toBeGreaterThan(0);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  test("each view fits in minimum terminal height (24 rows)", () => {
    const minHeight = 24;
    const minContent = minHeight - APP_CHROME_LINES;

    expect(minContent - KB_LIST_CHROME).toBeGreaterThan(0);
    expect(minContent - KB_LIST_CHROME - KB_LIST_FORM_LINES).toBeGreaterThan(0);
    expect(minContent - ARTIFACT_LIST_CHROME).toBeGreaterThan(0);
    expect(minContent - ARTIFACT_LIST_CHROME - ARTIFACT_LIST_FILTER_LINES).toBeGreaterThan(0);
    expect(minContent - ARTIFACT_DETAIL_CHROME - ARTIFACT_DETAIL_SCROLL_INDICATOR).toBeGreaterThan(0);
    expect(minContent - SEARCH_CHROME - SEARCH_RESULT_COUNT_LINES).toBeGreaterThan(0);
    expect(minContent - GRAPH_CHROME).toBeGreaterThan(0);
  });

  test("app chrome accounts for breadcrumb and status bar", () => {
    expect(APP_CHROME_LINES).toBe(3);
  });
});
