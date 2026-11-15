import { describe, expect, it } from "vitest";
import { JiraAuthError, JiraUnavailableError, JiraNotFoundError } from "../src/jira/errors";
import { parseRetryAfter } from "../src/jira/http";
import { textToAdf } from "../src/jira/adf";
import { fakeClient } from "./helpers";

describe("Jira HTTP retry policy", () => {
  it("waits for Retry-After on 429, then succeeds", async () => {
    const { fake, jira, sleeps, trace } = fakeClient();
    fake.fail({
      match: (m, p) => m === "GET" && p.endsWith("/myself"),
      status: 429,
      times: 2,
      headers: { "retry-after": "3" },
    });
    const me = await jira.myself();
    expect(me.displayName).toBe("Fake Importer");
    expect(sleeps).toEqual([3000, 3000]);
    expect(trace.events.filter((e) => e.type === "jira_retry")).toHaveLength(2);
  });

  it("backs off exponentially on 503 for writes (not processed)", async () => {
    const { fake, jira, sleeps } = fakeClient();
    const issue = fake.seedIssue("x", []);
    fake.fail({ match: (m, p) => m === "POST" && p.endsWith("/comment"), status: 503, times: 2 });
    await jira.addComment(issue.key, textToAdf("hello"));
    expect(issue.comments).toHaveLength(1);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThanOrEqual(1000); // 2nd attempt base 2000ms * jitter(0.5..1)
  });

  it("does NOT retry a write that timed out (could duplicate)", async () => {
    const { fake, jira } = fakeClient();
    const issue = fake.seedIssue("x", []);
    fake.fail({ match: (m, p) => m === "POST" && p.endsWith("/comment"), status: 0, times: 1, applyThenFail: true });
    await expect(jira.addComment(issue.key, textToAdf("hello"))).rejects.toBeInstanceOf(JiraUnavailableError);
    expect(issue.comments).toHaveLength(1); // saved once, never duplicated
  });

  it("retries reads after network errors", async () => {
    const { fake, jira } = fakeClient();
    fake.fail({ match: (m, p) => m === "GET" && p.endsWith("/myself"), status: 0, times: 1 });
    await expect(jira.myself()).resolves.toBeTruthy();
  });

  it("retries POST /search/jql because it is marked idempotent", async () => {
    const { fake, jira } = fakeClient();
    fake.seedIssue("a", ["scope"]);
    fake.fail({ match: (m, p) => p.endsWith("/search/jql"), status: 502, times: 1 });
    expect(await jira.searchAll('project = "TYN" AND labels = "scope"', ["summary"])).toHaveLength(1);
  });

  it("never retries 401 and explains the fix", async () => {
    const { fake, jira, sleeps } = fakeClient();
    fake.fail({ match: () => true, status: 401, times: 1 });
    const err = await jira.myself().catch((e) => e);
    expect(err).toBeInstanceOf(JiraAuthError);
    expect(err.message).toMatch(/JIRA_API_TOKEN/);
    expect(sleeps).toHaveLength(0);
  });

  it("maps 404 to JiraNotFoundError", async () => {
    const { jira } = fakeClient();
    await expect(jira.getIssue("TYN-999", ["summary"])).rejects.toBeInstanceOf(JiraNotFoundError);
  });

  it("gives up after max retries", async () => {
    const { fake, jira, sleeps } = fakeClient();
    fake.fail({ match: () => true, status: 503, times: 99 });
    await expect(jira.myself()).rejects.toBeInstanceOf(JiraUnavailableError);
    expect(sleeps).toHaveLength(5);
  });

  it("parses Retry-After in seconds and HTTP-date forms", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    const now = Date.parse("2026-11-15T00:00:00Z");
    expect(parseRetryAfter("Sun, 15 Nov 2026 00:00:10 GMT", now)).toBe(10000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

describe("search paging", () => {
  it("follows nextPageToken across pages", async () => {
    const { fake, jira } = fakeClient();
    for (let i = 0; i < 250; i++) fake.seedIssue(`issue ${i}`, ["scope"]);
    fake.seedIssue("other", ["unrelated"]);
    const all = await jira.searchAll('project = "TYN" AND labels = "scope"', ["summary"]);
    expect(all).toHaveLength(250);
    expect(fake.requests.filter((r) => r.path.endsWith("/search/jql"))).toHaveLength(3);
  });
});
