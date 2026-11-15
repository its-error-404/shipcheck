import { fileURLToPath } from "node:url";
import { createJiraHttp } from "../src/jira/http";
import { JiraWriter } from "../src/jira/client";
import { FakeJira } from "../src/testing/fake-jira";
import { MemoryTrace } from "../src/trace";

export const DATASET_PATH = fileURLToPath(new URL("../../../inputs/dataset.json", import.meta.url));

/** A real JiraWriter (real axios + interceptors) wired to the in-memory fake. */
export const fakeClient = (fake = new FakeJira()) => {
  const trace = new MemoryTrace();
  const sleeps: number[] = [];
  const http = createJiraHttp({
    baseUrl: "https://fake.atlassian.net",
    email: "me@example.com",
    apiToken: "token",
    trace,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  http.defaults.adapter = fake.adapter;
  return { fake, jira: new JiraWriter(http), trace, sleeps };
};
