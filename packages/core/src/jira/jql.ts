/** JQL helpers. All scope filtering is built here, in code, never by the model. */

/** Quotes a JQL string literal, escaping backslashes and double quotes. */
export const jqlString = (value: string): string => {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

/** `project = KEY AND labels = "scope"`, optionally AND-ed with an inner clause. */
export const scopedJql = (projectKey: string, scopeLabel: string, inner?: string): string => {
  const scope = `project = ${jqlString(projectKey)} AND labels = ${jqlString(scopeLabel)}`;
  return inner && inner.trim() ? `${scope} AND (${inner})` : scope;
};
