import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("PDF-derived Markdown", () => {
  it("shows escaped C++ template arguments while still skipping HTML", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`std::vector\<int\> 与 std::atomic\<bool\>，比较 x \< y。

<script>window.untrusted = true</script>`}</MarkdownContent>
    );
    expect(screen.getByText("std::vector<int> 与 std::atomic<bool>，比较 x < y。")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });

  it("preserves short closing lines and Chinese comments inside one code block", () => {
    const { container } = render(
      <MarkdownContent>{'```cpp\n// 中文注释\nstruct S {\n    int n;\n};\n```'}</MarkdownContent>
    );
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toBe("// 中文注释\nstruct S {\n    int n;\n};\n");
  });

  it("keeps repaired lambda and reserved identifiers visible without consuming Markdown syntax", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`lambda \[\]() 与 \_\_attribute\_\_((packed))，**重点** 和 ` +
        '`__attribute__ []()`'}</MarkdownContent>
    );
    expect(container.textContent).toBe("lambda []() 与 __attribute__((packed))，重点 和 __attribute__ []()");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toHaveTextContent("重点");
    expect(container.querySelector("code")).toHaveTextContent("__attribute__ []()");
  });

  it("renders commands separately and retains Unicode mathematical notation", () => {
    const { container } = render(
      <MarkdownContent>{"perf record -e cache-misses -g ./program\n\nperf report\n\nO(n²), μ₄/σ⁴-3, Σx³"}</MarkdownContent>
    );
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "perf record -e cache-misses -g ./program", "perf report", "O(n²), μ₄/σ⁴-3, Σx³"
    ]);
  });

  it("renders a numbered list after prose with its restored nested item", () => {
    const { container } = render(
      <MarkdownContent>{"前一段测试设计。\n\n4. 持久化策略\n    - 测试同步刷盘。"}</MarkdownContent>
    );
    expect(container.querySelector("ol")).toHaveAttribute("start", "4");
    expect(container.querySelector("ol > li > ul > li")).toHaveTextContent("测试同步刷盘。");
  });
});

describe("Markdown destinations before URI encoding", () => {
  const invalid = [
    "http://example.com/a b", "http://example.com/a\u00a0b", "http://example.com/a\u0001b",
    "http://example.com/a\u0000b", "http://example.com/a\u0085b", "http://example.com/a\\b",
    "http://example.com/%zz", "http://example.com/%", "http://example.com/%2",
    "http://user@@example.com/a", "http://%5b::1%5d/a"
  ];
  const explicitForms = [
    (url: string) => `[来源](<${url}>)`,
    (url: string) => `[来源][source]\n\n[source]: <${url}>`,
    (url: string) => `[source][]\n\n[source]: <${url}>`,
    (url: string) => `[source]\n\n[source]: <${url}>`
  ];
  it.each(invalid)("blocks malformed inline and all reference-definition forms: %j", (url) => {
    for (const form of explicitForms) {
      const { container, unmount } = render(<MarkdownContent>{form(url)}</MarkdownContent>);
      expect([...container.querySelectorAll("a")].filter((link) => link.getAttribute("href")), form(url)).toHaveLength(0);
      unmount();
    }
  });

  it.each(invalid.filter((url) => !/[\s\u0085]/u.test(url)))("blocks malformed autolink and GFM literal destinations: %j", (url) => {
    for (const source of [`<${url}>`, url]) {
      const { container, unmount } = render(<MarkdownContent>{source}</MarkdownContent>);
      expect([...container.querySelectorAll("a")].filter((link) => link.getAttribute("href")), source).toHaveLength(0);
      unmount();
    }
  });

  it.each([
    "http://joschu.net/blog/kl-approx.html", "http://[::1]:8080/source",
    "http://user%40name:p%40ss@example.com/a", "http://user%40name@[::1]:8080/a",
    "http://example.com/a%20b", "http://example.com/a%5Cb", "http://example.com/%25zz",
    "http://example.com/a%00b", "http://example.com/a%C2%A0b"
  ])("preserves valid raw IPv6 and intentionally percent-encoded destinations: %s", (url) => {
    for (const source of [...explicitForms.map((form) => form(url)), `<${url}>`]) {
      const { container, unmount } = render(<MarkdownContent>{source}</MarkdownContent>);
      expect(container.querySelector("a"), source).toHaveAttribute("href", url);
      unmount();
    }
  });

  it("preserves GFM autolinks and ordinary text after a URL boundary", () => {
    const { container } = render(<MarkdownContent>{"http://example.com/a%20b and http://example.com/a b"}</MarkdownContent>);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href")))
      .toEqual(["http://example.com/a%20b", "http://example.com/a"]);
    expect(container).toHaveTextContent(" b");
  });

  it("retains first-definition semantics and safely ignores an unsafe duplicate definition", () => {
    const { container } = render(<MarkdownContent>{"[source]\n\n[source]: <http://[::1]/a>\n[source]: <http://example.com/%zz>"}</MarkdownContent>);
    expect(container.querySelector("a")).toHaveAttribute("href", "http://[::1]/a");
  });

  it("does not let a later valid definition override an unsafe first definition", () => {
    const { container } = render(<MarkdownContent>{"[source]\n\n[source]: <http://example.com/%zz>\n[source]: <http://[::1]/a>"}</MarkdownContent>);
    expect(container.querySelector("a")).not.toHaveAttribute("href", "http://[::1]/a");
    expect(container.querySelector("a")?.getAttribute("href")).toBeFalsy();
  });

  it("checks decoded character references before they can become encoded destinations", () => {
    for (const destination of ["http://example.com/a&#32;b", "http://example.com/a&nbsp;b", "http://example.com/&#37;zz"]) {
      const { container, unmount } = render(<MarkdownContent>{`[来源](<${destination}>)`}</MarkdownContent>);
      expect(container.querySelector("a")?.getAttribute("href")).toBeFalsy();
      unmount();
    }
  });

  it("applies the same pre-encoding check to inline and referenced image URLs", () => {
    for (const destination of ["http://example.com/a b", "http://example.com/a\\b", "http://example.com/%zz", "http://%5b::1%5d/a"]) {
      const { container, unmount } = render(<MarkdownContent>{`![来源](<${destination}>)\n\n![source]\n\n[source]: <${destination}>`}</MarkdownContent>);
      expect([...container.querySelectorAll("img")].filter((img) => img.getAttribute("src"))).toHaveLength(0);
      unmount();
    }
    const { container } = render(<MarkdownContent>{"![来源](<http://[::1]/a%20b>)\n\n![source]\n\n[source]: <http://example.com/a%5Cb>"}</MarkdownContent>);
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src")))
      .toEqual(["http://[::1]/a%20b", "http://example.com/a%5Cb"]);
  });
});

describe("reference links", () => {
  it.each([
    "http://joschu.net/blog/kl-approx.html", "https://example.com/source",
    "HTTP://example.com:8080/source", "HTTPS://example.com/source",
    "http://[::1]:65535/source", "https://example.com/a%20b", "#source"
  ])("keeps a valid source or local anchor clickable: %s", (url) => {
    const { container } = render(<MarkdownContent>{`[来源](<${url}>)`}</MarkdownContent>);
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it.each([
    "javascript:alert(1)", "data:text/html,test", "file:///tmp/source", "ftp://example.com/source",
    "//example.com/source", "/source", "http://", "https://", "http:///source",
    "https:example.com", "https:/example.com", "https://?query", "https://#fragment",
    "http://example.com:65536/source", "https://example.com:-1/source", "http://example.com:abc/source",
    "http://[invalid]/source", "https://exa%20mple.com/source", "https://example.com\\source"
  ])("does not expose an unsafe or malformed Markdown destination: %s", (url) => {
    const { container } = render(<MarkdownContent>{`[来源](<${url}>)`}</MarkdownContent>);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href")).filter(Boolean)).toEqual([]);
  });
});
