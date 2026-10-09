import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("PPR table headers and fractions remain unobscured while scrolling locally", async ({ page }, testInfo) => {
  const path = process.env.GUIDE_TABLE_PACK_PATH;
  test.skip(!path, "需要指定冻结的382题包");
  const bytes = await readFile(path!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("2c3fcfad2c9c4270eee54e05e7f71706645649a5ab4eee1c5524eecd2bd3f679");
  const pack = JSON.parse(bytes.toString("utf8"));
  const question = pack.questions.find((q: { original: { interpretation: string } }) => q.original.interpretation.includes("条目 ID：rag-024；"));
  expect(question).toBeTruthy();
  await page.goto("/#/packs");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "guide.json", mimeType: "application/json", buffer: bytes });
  await expect(page.getByRole("status")).toContainText("共 382 题", { timeout: 15_000 });
  await page.goto(`/#/study?pack=${encodeURIComponent(pack.pack.id)}&question=${encodeURIComponent(question.id)}`);
  const card = page.locator(".question-card");
  await card.getByRole("button", { name: "揭示答案", exact: true }).click();
  const region = card.locator(".answer-panel .markdown-table-scroll").nth(1);
  const table = region.locator("table");
  await region.scrollIntoViewIfNeeded();
  // Normal page scrolling places the table below the actual sticky toolbar.
  await region.evaluate((element) => {
    const toolbar = document.querySelector(".study-toolbar")!;
    window.scrollBy(0, element.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom - 10);
  });
  const assertHeader = async (name: string) => {
    const header = table.getByRole("columnheader", { name, exact: true });
    await expect(header).toBeInViewport();
    expect(await header.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === element || (top !== null && element.contains(top));
    })).toBe(true);
  };
  await assertHeader("p(A)");
  for (const value of ["9/16", "7/12"]) {
    const cell = table.getByRole("cell", { name: value, exact: true });
    expect(await cell.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getClientRects().length;
    })).toBe(1);
  }
  await page.screenshot({ path: testInfo.outputPath("ppr-left-viewport.png"), scale: "css" });
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await region.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
  await assertHeader("p(E)");
  await page.screenshot({ path: testInfo.outputPath("ppr-right-viewport.png"), scale: "css" });
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
