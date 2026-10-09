import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("reviewed math grading lesson imports after382 and renders full boundaries", async ({ page }, testInfo) => {
  const oldPath = process.env.GUIDE_383_OLD_PACK;
  const newPath = process.env.GUIDE_383_NEW_PACK;
  test.skip(!oldPath || !newPath, "需要显式指定冻结382与383题包");
  test.setTimeout(90_000);
  const oldBytes = await readFile(oldPath!);
  const newBytes = await readFile(newPath!);
  expect(createHash("sha256").update(oldBytes).digest("hex")).toBe("2c3fcfad2c9c4270eee54e05e7f71706645649a5ab4eee1c5524eecd2bd3f679");
  expect(createHash("sha256").update(newBytes).digest("hex")).toBe("0d15fca3e0661a68dc30fd3d241da1308c3b5b1d3ee03c500c0e390dc8723e22");
  const before = JSON.parse(oldBytes.toString("utf8"));
  const after = JSON.parse(newBytes.toString("utf8"));
  expect(before.questions).toHaveLength(382);
  expect(after.questions).toHaveLength(383);
  expect(after.schemaVersion).toBe(1);
  expect(after.pack.id).toBe(before.pack.id);
  expect(after.chapters).toEqual(before.chapters);
  for (const old of before.questions) expect(after.questions.find((q: { id: string }) => q.id === old.id)).toEqual(old);
  const question = after.questions.find((q: { original: { interpretation: string } }) => q.original.interpretation.includes("条目 ID：evaluation-013；"));
  expect(question.id).toBe("5.1.13");
  const upload = async (bytes: Buffer, count: number) => {
    await page.goto("/#/packs");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "guide.json", mimeType: "application/json", buffer: bytes });
    await expect(page.getByRole("status")).toContainText(`共 ${count} 题`, { timeout: 15_000 });
  };
  const open = async (id: string) => {
    await page.goto(`/#/study?pack=${encodeURIComponent(after.pack.id)}&question=${encodeURIComponent(id)}`);
    const card = page.locator(".question-card");
    await expect(card).toHaveCount(1);
    return card;
  };
  await upload(oldBytes, 382);
  let card = await open(before.questions[0].id);
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await upload(newBytes, 383);
  card = await open(before.questions[0].id);
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  card = await open(question.id);
  await expect(card).toContainText(question.original.prompt);
  await card.getByRole("button", { name: "揭示答案", exact: true }).click();
  const answer = card.locator(".answer-panel");
  await expect(answer.locator(".quick-answer")).toContainText(question.revision.quickAnswer);
  await expect(answer.locator("em")).toHaveCount(0);
  await expect(answer).toContainText("伪代码");
  const code = question.original.answer.match(/```text\n([\s\S]*?)\n```/)![1];
  await expect(answer.locator("pre code")).toHaveCount(1);
  expect((await answer.locator("pre code").textContent())!.trimEnd()).toBe(code);
  for (const marker of ["Fraction(\"1.1\")", "|a-b|", "10⁻⁶", "x≠0", "2/60", "3/40", "3/100", "2/37"]) await expect(answer).toContainText(marker);
  for (const pitfall of question.revision.pitfalls.split("\n").filter(Boolean)) await expect(answer).toContainText(pitfall.replace(/^- /, ""));
  const region = answer.locator(".markdown-table-scroll");
  await expect(region).toHaveCount(1);
  await expect(region.locator("table tbody tr")).toHaveCount(3);
  await expect(region).toContainText("100 cm");
  await expect(region).toContainText("0.333333");
  await card.getByRole("button", { name: "拓展与追问", exact: true }).click();
  const extension = card.locator(".extension-panel");
  const followUps = [...question.original.extension.matchAll(/\*\*([^*]+)\*\*/g)].map((m: RegExpMatchArray) => m[1]);
  expect(followUps.length).toBeGreaterThanOrEqual(4);
  for (const heading of followUps) expect((await extension.textContent())!.split(heading).length - 1).toBe(1);
  for (const marker of ["1/3000000", "10000 cm²", "ungraded/ambiguous", "ungraded/unsupported", "闭卷设计八例"]) await expect(extension).toContainText(marker);
  const links = extension.locator(".reference-list a");
  await expect(links).toHaveCount(question.revision.references.length);
  for (let i = 0; i < question.revision.references.length; i++) {
    await expect(links.nth(i)).toHaveAttribute("href", question.revision.references[i].url);
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", /noopener/);
  }
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({ path: testInfo.outputPath("math-full.png"), fullPage: true, scale: "css" });
  await region.scrollIntoViewIfNeeded();
  if (testInfo.project.name === "mobile-webkit") {
    await region.evaluate((e) => { const toolbar = document.querySelector(".study-toolbar")!; window.scrollBy(0, e.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom - 10); });
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate((e) => { e.scrollLeft = 0; });
  }
  await page.screenshot({ path: testInfo.outputPath("math-table-viewport.png"), scale: "css" });
  // Fresh browser storage contains synthetic representative self-assessment, not user mastery.
});
