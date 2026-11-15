/** Agent-facing views of Jira data (plain text, importer metadata parsed out). */
export const LINK_DIRECTIONS = ["outgoing", "incoming"] as const;
export type LinkDirection = (typeof LINK_DIRECTIONS)[number];

export interface ScopeEntry {
  key: string;
  sourceId?: string;
  kind?: string;
  release?: string;
  summary: string;
  status?: string;
}

export interface IssueLinkView {
  key: string;
  sourceId?: string;
  summary: string;
  direction: LinkDirection;
}

export interface IssueView extends ScopeEntry {
  recordedStatus?: string;
  description: string;
  declaredLinks: string[];
  links: IssueLinkView[];
  hiddenLinks: number;
}

export interface CommentView {
  id: string;
  position?: number;
  total?: number;
  recordedAt?: string;
  actor?: string;
  role?: string;
  body: string;
}
