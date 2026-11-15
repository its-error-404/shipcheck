import type { z } from "zod";
import { checkScope, getComments, getIssue, searchIssues } from "./jira-tools";
import { recordDecision, submitPlan } from "./terminal";
import { toolError, toolJsonSchema, type ToolContext, type ToolDef, type ToolResult } from "./types";

export const DISCOVERY_TOOLS: ToolDef[] = [searchIssues, getIssue, getComments, submitPlan] as ToolDef[];
export const INVESTIGATION_TOOLS: ToolDef[] = [searchIssues, getIssue, getComments, checkScope, recordDecision] as ToolDef[];

/** Provider-neutral tool spec handed to the LLM adapter. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const toolSpecs = (tools: ToolDef[]): ToolSpec[] =>
  tools.map((t) => ({ name: t.name, description: t.description, parameters: toolJsonSchema(t.schema) }));

/** Validates raw model arguments with zod, runs the tool, never throws for model mistakes. */
export async function executeTool(tools: ToolDef[], name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return toolError(`Unknown tool '${name}'.`, `Available tools: ${tools.map((t) => t.name).join(", ")}`);
  const parsed = (tool.schema as z.ZodType).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    return toolError(`Invalid arguments for ${name}: ${issues}`);
  }
  return tool.run(parsed.data, ctx);
}
