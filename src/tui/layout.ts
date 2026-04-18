// ⚠️  These constants are hand-counted from the JSX tree of each view.
// When you add/remove margins, borders, or chrome elements in a view component,
// update the corresponding constant here AND the comment breakdown.
// See #43 (render tests) and #47 (constant drift detection) for automation tracking.
// Vertical lines consumed by app chrome (breadcrumb + status bar with border-top)
export const APP_CHROME_LINES = 3;

// Per-view chrome: lines consumed by border + title + footer (excluding scrollable content)
// border(2) + title+margin(2) + hintMargin+hints(2) = 6
export const KB_LIST_CHROME = 6;
export const KB_LIST_FORM_LINES = 3;

// border(2) + title+margin(2) + hintMargin+hints(2) = 6
export const ARTIFACT_LIST_CHROME = 6;
export const ARTIFACT_LIST_FILTER_LINES = 2;

// border(2) + header(2)+margin(1) + tabs+margin(2) + hintMargin+hints(2) = 9
export const ARTIFACT_DETAIL_CHROME = 9;
export const ARTIFACT_DETAIL_SCROLL_INDICATOR = 1;

// border(2) + search+margin(2) + hintMargin+hints(2) = 6
// result-count+margin(2) is added dynamically when results are present
export const SEARCH_CHROME = 6;
export const SEARCH_RESULT_COUNT_LINES = 2;

// border(2) + title+margin(2) + rootNode(1) + hintMargin+hints(2) = 7
export const GRAPH_CHROME = 7;

export const HORIZONTAL_SCROLL_STEP = 10;
export const MIN_VISIBLE_COLUMNS = 10;
