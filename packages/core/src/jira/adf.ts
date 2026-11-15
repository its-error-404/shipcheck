/**
 * Atlassian Document Format (ADF) helpers.
 *
 * Jira REST v3 requires ADF for descriptions and comments. We store each text
 * line as one paragraph so that textToAdf → adfToText round-trips exactly
 * (verified in tests against every comment in the dataset). The model never
 * sees ADF: tools always convert back to plain text.
 */
export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}

export interface AdfDoc {
  type: "doc";
  version: 1;
  content: AdfNode[];
}

export const textToAdf = (text: string): AdfDoc => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    version: 1,
    // Jira rejects empty text nodes, so an empty line is an empty paragraph.
    content: lines.map((line) => ({
      type: "paragraph",
      content: line.length > 0 ? [{ type: "text", text: line }] : [],
    })),
  };
};

const inlineText = (node: AdfNode): string => {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return String(node.attrs?.text ?? "");
  if (node.type === "inlineCard") return String(node.attrs?.url ?? "");
  return (node.content ?? []).map(inlineText).join("");
};

/** Converts ADF (or a plain string, for safety) to plain text, one block per line. */
export const adfToText = (doc: unknown): string => {
  if (doc == null) return "";
  if (typeof doc === "string") return doc;
  const root = doc as AdfNode;
  const blocks = root.content ?? [];
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading") {
      lines.push(inlineText(block));
    } else if (block.type === "codeBlock") {
      lines.push(inlineText(block));
    } else if (block.content) {
      // lists, panels, quotes, tables: flatten their children
      lines.push(adfToText({ type: "doc", content: block.content }));
    }
  }
  return lines.join("\n");
};
