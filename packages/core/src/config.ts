import { z } from "zod";

/**
 * Environment configuration, validated with zod so misconfiguration fails at
 * startup with a readable message instead of mid-run. Secrets only ever come
 * from the environment / .env (never committed).
 */
export const JiraConfigSchema = z.object({
  JIRA_BASE_URL: z
    .string()
    .url("JIRA_BASE_URL must be a URL, e.g. https://your-site.atlassian.net")
    .transform((u) => u.replace(/\/+$/, "")),
  JIRA_EMAIL: z.string().email("JIRA_EMAIL must be your Atlassian account email"),
  JIRA_API_TOKEN: z.string().min(10, "JIRA_API_TOKEN is missing or too short"),
  JIRA_PROJECT_KEY: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]+$/, "JIRA_PROJECT_KEY must be an uppercase project key")
    .default("TYN"),
  JIRA_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
});
export type JiraConfig = z.infer<typeof JiraConfigSchema>;

export const loadJiraConfig = (env: NodeJS.ProcessEnv = process.env): JiraConfig => {
  const parsed = JiraConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid Jira configuration (check your .env):\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

/** LLM configuration (docs/09-llm-adapter.md). Any OpenAI-compatible endpoint. */
export const LlmConfigSchema = z.object({
  LLM_BASE_URL: z
    .string()
    .url("LLM_BASE_URL must be a URL, e.g. https://generativelanguage.googleapis.com/v1beta/openai/"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is missing"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is missing (e.g. the Gemini Flash model name from AI Studio)"),
  LLM_PROVIDER: z.string().optional(),
  LLM_RPM: z.coerce.number().int().min(0).default(8),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(8192),
  LLM_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const loadLlmConfig = (env: NodeJS.ProcessEnv = process.env): LlmConfig => {
  // Treat empty strings in .env as "not set" so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = LlmConfigSchema.safeParse(cleaned);
  if (!parsed.success)
    throw new Error(`Invalid LLM configuration (check your .env):\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
};

/** Assessment defaults (overridable by CLI flags). */
export const AssessConfigSchema = z.object({
  ASSESS_SCOPE_LABEL: z.string().default("tyn-release-assessment-v2"),
  ASSESS_RELEASE: z.string().default("R2.4"),
  ASSESS_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
});
export type AssessConfig = z.infer<typeof AssessConfigSchema>;

export const loadAssessConfig = (env: NodeJS.ProcessEnv = process.env): AssessConfig =>
  AssessConfigSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
