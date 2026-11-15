import { z } from "zod";

/**
 * Environment configuration, validated with zod so misconfiguration fails at
 * startup with a readable message instead of mid-run. Secrets only ever come
 * from the environment / .env (never committed).
 */
export const JiraConfigSchema = z.object({
  JIRA_BASE_URL: z
    .string({ error: "JIRA_BASE_URL is not set (e.g. https://your-site.atlassian.net)" })
    .url("JIRA_BASE_URL must be a URL, e.g. https://your-site.atlassian.net")
    .transform((u) => u.replace(/\/+$/, "")),
  JIRA_EMAIL: z.string({ error: "JIRA_EMAIL is not set" }).email("JIRA_EMAIL must be your Atlassian account email"),
  JIRA_API_TOKEN: z.string({ error: "JIRA_API_TOKEN is not set" }).min(10, "JIRA_API_TOKEN is missing or too short"),
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
    .string({ error: "LLM_BASE_URL is not set (e.g. https://generativelanguage.googleapis.com/v1beta/openai/)" })
    .url("LLM_BASE_URL must be a URL"),
  LLM_API_KEY: z
    .string({ error: "LLM_API_KEY is not set (free key: https://aistudio.google.com → Get API key)" })
    .min(1),
  LLM_MODEL: z
    .string({ error: "LLM_MODEL is not set. Run `npm run verify-llm` to list the models your key can use." })
    .min(1),
  LLM_PROVIDER: z.string().optional(),
  LLM_RPM: z.coerce.number().int().min(0).default(8),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(8192),
  LLM_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
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
  /** Max model turns per investigation (lower = fewer requests; free tiers allow few per day). */
  AGENT_MAX_TURNS: z.coerce.number().int().min(4).max(60).default(20),
  /** Elide old tool results above this conversation size (chars); lower it for small local context windows. */
  AGENT_ELIDE_ABOVE_CHARS: z.coerce.number().int().min(8_000).default(60_000),
});
export type AssessConfig = z.infer<typeof AssessConfigSchema>;

export const loadAssessConfig = (env: NodeJS.ProcessEnv = process.env): AssessConfig =>
  AssessConfigSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));

/** Just enough to reach the provider (used by `verify-llm` to list models before LLM_MODEL is chosen). */
export const loadLlmConnection = (env: NodeJS.ProcessEnv = process.env) =>
  LlmConfigSchema.pick({ LLM_BASE_URL: true, LLM_API_KEY: true }).parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")),
  );
