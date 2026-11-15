/** Tool output and paging limits (docs/DESIGN.md). */
export const TOOL_LIMITS = {
  maxResultChars: 6_000,
  searchDefault: 15,
  searchMax: 25,
  sourceIdsMax: 25,
  searchTextMax: 200,
  commentsDefault: 15,
  commentsMax: 30,
  containsMax: 100,
  /** Minimum run of near-identical comments that gets collapsed. */
  collapseMinRun: 3,
  collapseExampleChars: 160,
  previewChars: 300,
} as const;
