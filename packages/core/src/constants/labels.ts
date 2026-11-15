/** Jira label conventions used by the importer and the agent's tools (docs/04-data-mapping.md). */
export const LABEL_PREFIX = {
  source: "src-",
  kind: "kind-",
  release: "rel-",
} as const;

/** The manifest's own text states requirement records carry this label. */
export const REQUIREMENT_LABEL = "rr-requirement";
