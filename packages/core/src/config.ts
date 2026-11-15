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
  JIRA_PROJECT_KEY: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "JIRA_PROJECT_KEY must be an uppercase project key").default("TYN"),
  JIRA_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
});
export type JiraConfig = z.infer<typeof JiraConfigSchema>;

export function loadJiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig {
  const parsed = JiraConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid Jira configuration (check your .env):\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
