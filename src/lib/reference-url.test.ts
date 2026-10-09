import { describe, expect, it } from "vitest";
import { isHttpReferenceUrl } from "./reference-url";

describe("unrepaired HTTP reference syntax", () => {
  it.each([
    "http://example.com/a%20b", "http://example.com/a%5Cb", "http://example.com/%25zz",
    "http://example.com/a%00b", "https://[::1]:65535/a", "http://user%40name:p%40ss@example.com/a",
    "http://user%40name@[::1]:8080/a", "http://example.com/a@b?value=@#@"
  ])("accepts correctly encoded URL syntax: %s", (url) => {
    expect(isHttpReferenceUrl(url)).toBe(true);
  });

  it.each([
    "http://example.com/%zz", "http://example.com/%", "http://example.com/%2", "http://example.com/?q=%g0",
    "http://example.com/#%", "http://user%@example.com/a", "http://user@@example.com/a",
    "http://user:pass@@example.com/a", "http://user%40@@example.com/a", "http://%5b::1%5d/a",
    "http://example.com/a b", "http://example.com/a\u00a0b", "http://example.com/a\u0001b",
    "http://example.com/a\u0000b", "http://example.com/a\u0085b", "http://example.com/a\\b"
  ])("rejects malformed syntax before a URL parser can repair it: %j", (url) => {
    expect(isHttpReferenceUrl(url)).toBe(false);
  });
});
