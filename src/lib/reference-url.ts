import addFormats from "ajv-formats";

// Use the same public, full URI format as createPackValidator. WHATWG URL()
// alone accepts several strings that the pack's RFC URI format rejects.
const uriFormat = addFormats.get("uri", "full");
if (typeof uriFormat !== "function") throw new Error("Expected the installed full URI format to be callable");

/** Validate an absolute web reference without letting URL() repair malformed input. */
export const isHttpReferenceUrl = (value: string): boolean => {
  // URL() otherwise trims whitespace, drops controls and repairs missing slashes/backslashes.
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[\s\u0000-\u001f\u007f\u0085\\]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return false;
  if (uriFormat(value) !== true) return false;
  // Only one literal @ may delimit userinfo. Encoded %40 within userinfo is valid.
  if (authority.indexOf("@") !== authority.lastIndexOf("@")) return false;
  try {
    const url = new URL(value);
    // Parsing also rejects malformed hosts and nonnumeric/out-of-range ports.
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
};
