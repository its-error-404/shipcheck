/** Decision vocabulary shared by the ledger, tools, orchestrator and report. */
export const DECISIONS = ["PASS", "FAIL", "INSUFFICIENT_EVIDENCE"] as const;
export type Decision = (typeof DECISIONS)[number];

export const OVERALL_DECISIONS = ["BLOCKED", "NEEDS_REVIEW", "READY"] as const;
export type OverallDecision = (typeof OVERALL_DECISIONS)[number];

/** How a cited piece of evidence relates to the decision. */
export const STANCES = ["supports_pass", "supports_fail", "inconclusive", "not_applicable"] as const;
export type Stance = (typeof STANCES)[number];

export interface EvidenceCitation {
  issue_key: string;
  comment_id?: string;
  stance: Stance;
  why: string;
}

/** What an investigator submits through record_decision. */
export interface DecisionInput {
  requirement_key: string;
  decision: Decision;
  explanation: string;
  evidence: EvidenceCitation[];
  outstanding: string[];
  anomalies: string[];
}
