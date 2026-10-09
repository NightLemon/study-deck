import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import samplePack from "../../public/sample-pack.json";
import { MarkdownContent } from "../components/MarkdownContent";
import { parsePackText } from "./pack-service";
import { isHttpReferenceUrl } from "./reference-url";
import type { QuestionPack } from "./types";

const packWithReference = (url: string) => {
  const pack = JSON.parse(JSON.stringify(samplePack)) as QuestionPack;
  pack.questions[0].revision = { references: [{ title: "URI contract fixture", url }] };
  return JSON.stringify(pack);
};
const imports = (url: string) => {
  try { parsePackText(packWithReference(url)); return true; } catch { return false; }
};

describe("URI lexical agreement across actual consumers", () => {
  it("compares all byte-range characters in path, query and fragment against the actual pack validator", () => {
    expect(imports("http://example.com/valid")).toBe(true);
    for (let code = 0; code <= 255; code++) {
      for (const prefix of ["http://example.com/a", "http://example.com/?q=a", "http://example.com/#a"]) {
        const url = `${prefix}${String.fromCharCode(code)}b`;
        expect(isHttpReferenceUrl(url), JSON.stringify({ code, prefix })).toBe(imports(url));
      }
    }
  });

  it.each(["|", "^", "`", "[0]", "\u0086", "\ufffd", "中文"])("blocks schema-invalid raw path %j before Markdown normalization", (part) => {
    const url = `http://example.com/a${part}b`;
    expect(imports(url)).toBe(false);
    expect(isHttpReferenceUrl(url)).toBe(false);
    const { container } = render(<MarkdownContent>{`[probe](<${url}>)\n\n![picture][ref]\n\n[ref]: <${url}>`}</MarkdownContent>);
    expect(container.querySelector("a")?.getAttribute("href") ?? "").toBe("");
    expect(container.querySelector("img")?.getAttribute("src") ?? "").toBe("");
  });

  it.each(["&#0;", "&#xD800;", "&#x85;", "&#x110000;"])("rejects invalid numeric entities %s in links and reference images", (entity) => {
    const url = `http://example.com/a${entity}b`;
    const { container } = render(<MarkdownContent>{`[probe](<${url}>)\n\n![picture][ref]\n\n[ref]: <${url}>`}</MarkdownContent>);
    expect(container.querySelector("a")?.getAttribute("href") ?? "").toBe("");
    expect(container.querySelector("img")?.getAttribute("src") ?? "").toBe("");
  });

  it.each([
    "http://example.com/a%7Cb", "http://example.com/a%5Eb", "http://example.com/a%60b",
    "http://example.com/a%5B0%5D", "http://example.com/%E4%B8%AD%E6%96%87", "http://example.com/a%EF%BF%BDb",
    "HTTPS://[::1]:65535/a", "http://user%40name:p%40ss@example.com/a"
  ])("keeps valid encoded URI %s byte-for-byte in both consumers", (url) => {
    expect(imports(url)).toBe(true);
    expect(isHttpReferenceUrl(url)).toBe(true);
    const { container } = render(<MarkdownContent>{`[probe](<${url}>)`}</MarkdownContent>);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
  });
});
