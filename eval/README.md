# Evaluation data

`npm run evaluate -- runs/<runId>` scores a run against `eval/expected-<release>.json`.

The expected-outcome file is **not committed** (git-ignored) so the public repository does not publish an answer key for the assessment dataset. Create it locally in this format:

```json
{
  "release": "R2.4",
  "overall": "BLOCKED | NEEDS_REVIEW | READY",
  "requirements": {
    "REQ-01": { "decision": "PASS | FAIL | INSUFFICIENT_EVIDENCE", "key_evidence": "optional note" }
  }
}
```

The agent never reads this file; it is used only to measure the agent's decisions.
