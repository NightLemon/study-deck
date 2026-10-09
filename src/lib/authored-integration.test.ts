import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MarkdownContent } from "../components/MarkdownContent";
import { db } from "./db";
import { installPack, parsePackText } from "./pack-service";

it.skipIf(!process.env.INTERVIEW_PACK_PATH)("validates the private full pack and preserves every displayed source program", async () => {
  const filename = process.env.INTERVIEW_PACK_PATH!;
  const text = readFileSync(filename, "utf8");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(25 * 1024 * 1024);
  const pack = parsePackText(text);
  expect(pack.pack.id).toBe("cn.qdstudy.interview-coding-150");
  expect(pack.questions).toHaveLength(150);
  expect(pack.chapters).toHaveLength(20);
  expect(pack.questions.filter((q) => Number(q.chapterId) <= 10)).toHaveLength(75);
  const solutionRoot = resolve(dirname(filename), "../authored/interview-coding-150/solutions");
  for (const q of pack.questions) {
    expect(q.sourcePages).toBeUndefined();
    expect(q.review.status).toBe("reviewed");
    expect(q.revision?.followUps?.length).toBeGreaterThanOrEqual(2);
    const container = document.createElement("div");
    for (const [key, value] of Object.entries(q.original)) {
      expect(value.trim(), `${q.id}.${key}`).not.toBe("");
      container.innerHTML = renderToStaticMarkup(createElement(MarkdownContent, { children: value }));
      if (key === "answer") {
        for (const [language, extension] of [["cpp", "cpp"], ["python", "py"]]) {
          const displayed = container.querySelectorAll(`pre code.language-${language}`);
          expect(displayed, `${q.id} ${language}`).toHaveLength(1);
          const original = readFileSync(resolve(solutionRoot, `${q.id}.${extension}`), "utf8").replaceAll("\r\n", "\n");
          expect(displayed[0].textContent?.trimEnd(), `${q.id} ${language}`).toBe(original.trimEnd());
        }
      }
    }
  }
  await db.delete();
  await db.open();
  await installPack(pack);
  expect(await db.questions.where("packId").equals(pack.pack.id).count()).toBe(150);
}, 120_000);
