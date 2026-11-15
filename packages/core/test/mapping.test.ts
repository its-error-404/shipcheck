import { describe, expect, it } from "vitest";
import { adfToText, textToAdf } from "../src/jira/adf";
import { loadDataset } from "../src/import/dataset";
import {
  commentBodyFor,
  descriptionFor,
  labelsFor,
  parseDescription,
  parseImportedComment,
  summaryFor,
} from "../src/import/mapping";
import { jqlString, scopedJql } from "../src/jira/jql";
import { DATASET_PATH } from "./helpers";

describe("ADF round trip", () => {
  it("preserves every comment and description in the dataset exactly", async () => {
    const ds = await loadDataset(DATASET_PATH);
    let n = 0;
    for (const r of ds.records) {
      for (const c of r.comments) {
        expect(adfToText(textToAdf(c))).toBe(c);
        n++;
      }
      expect(adfToText(textToAdf(r.description))).toBe(r.description);
    }
    expect(n).toBe(2059);
  });

  it("keeps empty lines without creating empty text nodes", () => {
    const doc = textToAdf("a\n\nb");
    expect(doc.content[1]!.content).toEqual([]);
    expect(adfToText(doc)).toBe("a\n\nb");
  });
});

describe("record mapping", () => {
  const rec = {
    source_id: "REQ-08",
    kind: "requirement",
    summary: "Human handoff delivery",
    release: "R2.4",
    recorded_status: "Done",
    description: "Line 1\nLine 2",
    comments: ["c1", "c2"],
    links: ["REC-4076"],
  };

  it("builds summary and labels, incl. rr-requirement for requirements", () => {
    expect(summaryFor(rec)).toBe("[REQ-08] Human handoff delivery");
    expect(labelsFor(rec, "scope")).toEqual(["scope", "src-REQ-08", "kind-requirement", "rel-R2.4", "rr-requirement"]);
    expect(labelsFor({ ...rec, kind: "evidence" }, "scope")).not.toContain("rr-requirement");
  });

  it("writes a parseable metadata block and keeps the original description verbatim", () => {
    const d = descriptionFor(rec, "scope");
    const parsed = parseDescription(d);
    expect(parsed.meta["Recorded status"]).toBe("Done");
    expect(parsed.declaredLinks).toEqual(["REC-4076"]);
    expect(parsed.original).toBe("Line 1\nLine 2");
  });

  it("adds a separable n/N header to comments", () => {
    const body = commentBodyFor("REQ-08", 2, 5, "Recorded event x | actor A | role B\ntext");
    expect(parseImportedComment(body)).toEqual({
      index: 2,
      total: 5,
      sourceId: "REQ-08",
      original: "Recorded event x | actor A | role B\ntext",
    });
  });

  it("refuses to truncate oversized text", () => {
    expect(() => summaryFor({ ...rec, summary: "x".repeat(300) })).toThrow(/refusing to truncate/);
    expect(() => commentBodyFor("R", 1, 1, "x".repeat(40000))).toThrow(/limit/);
  });
});

describe("JQL scope", () => {
  it("always wraps the inner clause in the code-enforced scope", () => {
    expect(scopedJql("SHIP", "tyn-release-assessment-v2", 'labels = "x" OR text ~ "y"')).toBe(
      'project = "SHIP" AND labels = "tyn-release-assessment-v2" AND (labels = "x" OR text ~ "y")',
    );
    expect(jqlString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
