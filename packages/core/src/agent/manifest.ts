/**
 * Deterministic parsing of manifest and requirement text read from Jira.
 * The model identifies the manifest; code reads the target and rules from it.
 */
import { TargetSchema, type Target } from "../models/dataset";

const TARGET_LINE = /^Target:\s*(\{.*\})\s*$/m;
const MANDATORY_LINE = /^Mandatory:\s*(yes|no)\b/im;
const CRITERION_LINE = /^Acceptance criterion:\s*(.+)$/m;
const REQUIREMENT_ID_LINE = /^Requirement ID:\s*(\S+)/m;

/** Parses `Target: {...}` into a validated Target, or undefined if absent/invalid. */
export const parseTarget = (text: string): Target | undefined => {
  const match = TARGET_LINE.exec(text);
  if (!match) return undefined;
  try {
    const parsed = TargetSchema.safeParse(JSON.parse(match[1]!));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** `Mandatory: yes|no` → boolean; undefined when not stated (treated as mandatory, and flagged). */
export const parseMandatory = (text: string): boolean | undefined => {
  const match = MANDATORY_LINE.exec(text);
  return match ? match[1]!.toLowerCase() === "yes" : undefined;
};

export const parseCriterion = (text: string): string | undefined => CRITERION_LINE.exec(text)?.[1]?.trim();

export const parseRequirementId = (text: string): string | undefined => REQUIREMENT_ID_LINE.exec(text)?.[1];
