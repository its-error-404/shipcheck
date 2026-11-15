import { z } from "zod";
import { TOOL_LIMITS } from "../constants/tools";
import type { Target } from "../models/dataset";
import type { EvidenceLedger } from "../ledger";
import type { TraceSink } from "../trace";
import type { ScopedJiraView } from "./jira-view";

/** Everything a tool may touch. Note: no JiraWriter anywhere in here. */
export interface ToolContext {
  view: ScopedJiraView;
  target: Target;
  ledger: EvidenceLedger;
  trace: TraceSink;
  /** The requirement this investigation is assigned (investigation phase only). */
  requirementKey?: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** Set by terminal tools (submit_plan / record_decision) once accepted: ends the loop. */
  terminal?: unknown;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export const defineTool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> => {
  return def;
};

export const capped = (text: string, hint = "Result truncated; narrow the query or page with offset."): string => {
  if (text.length <= TOOL_LIMITS.maxResultChars) return text;
  return `${text.slice(0, TOOL_LIMITS.maxResultChars)}\n… [${hint}]`;
};

export const toolError = (message: string, hint?: string): ToolResult => ({
  content: `ERROR: ${message}${hint ? `\nHINT: ${hint}` : ""}`,
  isError: true,
});

/**
 * JSON Schema for the LLM's tool definition. Stripped of keywords that some
 * OpenAI-compatible providers (e.g. Gemini) reject.
 */
export const toolJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "additionalProperties" || k === "default") continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(js) as Record<string, unknown>;
};
