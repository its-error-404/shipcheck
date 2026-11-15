/** Every trace event type, in one place (docs/14-trace-metrics.md). */
export const TRACE_EVENTS = {
  jiraHttp: "jira_http",
  jiraRetry: "jira_retry",
  jiraError: "jira_error",
  importComplete: "import_complete",
  llmCall: "llm_call",
  llmRetry: "llm_retry",
  llmError: "llm_error",
  agentStart: "agent_start",
  agentStop: "agent_stop",
  toolCall: "tool_call",
  budgetWarning: "budget_warning",
  contextElided: "context_elided",
  runStart: "run_start",
  runPhase: "run_phase",
  runEnd: "run_end",
  requirementResult: "requirement_result",
} as const;

export type TraceEventType = (typeof TRACE_EVENTS)[keyof typeof TRACE_EVENTS];
