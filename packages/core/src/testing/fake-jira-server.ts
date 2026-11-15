/**
 * Serves FakeJira over real HTTP (dev/demo only): lets the CLI and the agent
 * run end-to-end without a Jira site. Never used for the submitted report.
 *   npm run fake-jira -- 4010
 */
import { createServer } from "node:http";
import { FakeJira } from "./fake-jira";

export function startFakeJiraServer(port: number, fake = new FakeJira()) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const { status, data } = fake.route((req.method ?? "GET").toUpperCase(), url.pathname, url.searchParams, raw ? JSON.parse(raw) : undefined);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === "" || data === undefined ? "" : JSON.stringify(data));
    });
  });
  return new Promise<{ fake: FakeJira; close: () => void }>((resolve) =>
    server.listen(port, () => resolve({ fake, close: () => server.close() })),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4010);
  startFakeJiraServer(port).then(() => console.log(`Fake Jira listening on http://localhost:${port} (project TYN)`));
}
