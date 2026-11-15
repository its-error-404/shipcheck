/** What the evidence ledger remembers about everything shown to the model. */
export interface LedgerIssue {
  key: string;
  sourceId?: string;
  summary?: string;
  kind?: string;
}

export interface LedgerComment {
  id: string;
  issueKey: string;
  sourceId?: string;
  position?: number;
  total?: number;
  recordedAt?: string;
  actor?: string;
  role?: string;
  body: string;
  /** True if it was only shown inside a collapsed run of near-duplicates. */
  collapsed: boolean;
}
