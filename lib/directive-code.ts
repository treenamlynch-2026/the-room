import { fromMarkdown } from "mdast-util-from-markdown";
type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];

/** Remove actionable tags from Markdown examples before the directive parser runs.
 * This is quotation hardening, not a defense against plain-text prompt injection.
 */
export function stripCodeDirectives(text: string): string {
  const ranges: [number, number][] = [];
  function visit(node: MarkdownNode) {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
    } else if ("children" in node) {
      for (const child of node.children) visit(child as MarkdownNode);
    }
  }
  for (const node of fromMarkdown(text).children) visit(node);
  // Work backwards so replacements cannot invalidate the parser's original offsets.
  let out = text;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    const code = out.slice(start, end).replace(/\[\[(?:APPROVE|DECISION:[\s\S]*?|CANON:[\s\S]*?|\/CANON)\]\]/g, "");
    out = out.slice(0, start) + code + out.slice(end);
  }
  return out;
}
