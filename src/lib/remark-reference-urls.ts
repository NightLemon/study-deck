import { isHttpReferenceUrl } from "./reference-url";

// Only the MDAST fields used here; no runtime or type-only dependency is required.
interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown>; [key: string]: unknown };
}

/** Check parsed Markdown destinations before mdast-to-hast percent-encodes them. */
export const remarkReferenceUrls = () => (tree: unknown, file: { value: unknown }) => {
  const source = String(file.value);
  const nodes: MarkdownNode[] = [];
  const pending = [tree as MarkdownNode];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    if (node.children) pending.push(...[...node.children].reverse());
  }

  const checkedUrl = (node: MarkdownNode) => {
    const { start, end } = node.position ?? {};
    // CommonMark replaces literal NUL with U+FFFD even before the MDAST URL exists.
    // A corrupted source node must not become a valid destination through that repair.
    if (start?.offset !== undefined && end?.offset !== undefined &&
        source.slice(start.offset, end.offset).includes("\u0000")) return "";
    const url = node.url ?? "";
    return isHttpReferenceUrl(url) || url.startsWith("#") ? url : "";
  };

  // Match CommonMark/mdast-to-hast: identifiers are case-insensitive, first definition wins.
  const definitions = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === "definition") {
      const id = String(node.identifier).toUpperCase();
      if (!definitions.has(id)) definitions.set(id, checkedUrl(node));
    }
  }

  for (const node of nodes) {
    const isImage = node.type === "image" || node.type === "imageReference";
    const isReference = node.type === "linkReference" || node.type === "imageReference";
    if (!isImage && node.type !== "link" && node.type !== "linkReference") continue;
    const url = isReference ? definitions.get(String(node.identifier).toUpperCase()) : checkedUrl(node);
    if (url === undefined) continue; // An unresolved reference stays ordinary Markdown text.
    // hProperties runs after mdast-to-hast normalization. Pass only the checked original
    // destination through it, preserving legal IPv6 without decoding or repairing input.
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [isImage ? "src" : "href"]: url } };
  }
};
