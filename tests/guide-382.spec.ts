import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("frozen 379 to 382 keeps every old payload and renders three new lessons", async ({ page }, testInfo) => {
  const oldPath = process.env.GUIDE_ADDITIONS_OLD_PACK;
  const newPath = process.env.GUIDE_ADDITIONS_NEW_PACK;
  test.skip(!oldPath || !newPath, "需要显式指定冻结的379和382题包");
  test.setTimeout(90_000);
  const oldBytes = await readFile(oldPath!);
  const newBytes = await readFile(newPath!);
  expect(createHash("sha256").update(oldBytes).digest("hex")).toBe("17d81dcc95903e42a02b5a62ca924ca64f406ff103bb4c83d9ddbc9ac6effa4b");
  expect(createHash("sha256").update(newBytes).digest("hex")).toBe("2c3fcfad2c9c4270eee54e05e7f71706645649a5ab4eee1c5524eecd2bd3f679");
  const before = JSON.parse(oldBytes.toString("utf8"));
  const after = JSON.parse(newBytes.toString("utf8"));
  expect(after.schemaVersion).toBe(1);
  expect(after.pack.id).toBe(before.pack.id);
  expect(before.questions).toHaveLength(379);
  expect(after.questions).toHaveLength(382);
  const oldIds = new Set(before.questions.map((q: { id: string }) => q.id));
  const knowledgeId = (q: { original: { interpretation: string } }): string => q.original.interpretation.match(/条目 ID：([^；]+)/)![1];
  for (const old of before.questions) {
    expect(after.questions.find((q: { id: string }) => q.id === old.id)).toEqual(old);
  }
  const added = after.questions.filter((q: { id: string }) => !oldIds.has(q.id));
  expect(added).toHaveLength(3);
  expect(new Set(added.map(knowledgeId))).toEqual(new Set(["context-013", "rag-024", "agent-rl-020"]));
  const upload = async (target: Page, bytes: Buffer, count: number) => {
    await target.goto("/#/packs");
    await target.locator('input[type="file"]').first().setInputFiles({ name: "guide.json", mimeType: "application/json", buffer: bytes });
    await expect(target.getByRole("status")).toContainText(`共 ${count} 题`, { timeout: 15_000 });
  };
  const open = async (id: string) => {
    await page.goto(`/#/study?pack=${encodeURIComponent(after.pack.id)}&question=${encodeURIComponent(id)}`);
    const card = page.locator(".question-card");
    await expect(card).toHaveCount(1);
    return card;
  };
  await upload(page, oldBytes, 379);
  const retained = before.questions[0];
  let card = await open(retained.id);
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  await upload(page, newBytes, 382);
  card = await open(retained.id);
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  const checkedQuestions = added;
  const formulaMarkers: Record<string, string[]> = {
    "context-013": ["4,000", "50%", "request_heartbeat=true", "recall"],
    "rag-024": ["7/12", "11/12", "specificity", "M[i,j]"],
    "agent-rl-020": ["r_q", "UNKNOWN", "INFEASIBLE", "L≤z*≤b"]
  };
  for (const question of checkedQuestions) {
    card = await open(question.id);
    await expect(card).toContainText(question.original.prompt);
    await card.getByRole("button", { name: "查看提示", exact: true }).click();
    await expect(card.locator(".hint-panel pre")).toHaveCount(0);
    await card.getByRole("button", { name: "揭示答案", exact: true }).click();
    await expect(card.locator(".answer-panel .quick-answer")).toContainText(question.revision.quickAnswer);
    await expect(card.locator(".answer-panel em")).toHaveCount(0);
    for (const marker of formulaMarkers[knowledgeId(question)] ?? []) await expect(card.locator(".answer-panel")).toContainText(marker);
    const expectedCode = [...question.original.answer.matchAll(/```python\n([\s\S]*?)\n```/g)].map((match: RegExpMatchArray) => match[1]);
    if (knowledgeId(question).startsWith("ai-coding-")) expect(expectedCode.length).toBe(1);
    else expect(expectedCode.length).toBe(0);
    const actualCode = card.locator(".answer-panel pre code");
    await expect(actualCode).toHaveCount(expectedCode.length);
    for (let i = 0; i < expectedCode.length; i++) {
      expect((await actualCode.nth(i).textContent())!.trimEnd()).toBe(expectedCode[i].trimEnd());
    }
    await card.getByRole("button", { name: "拓展与追问", exact: true }).click();
    const extension = card.locator(".extension-panel");
    const extensionMarkers: Record<string, string[]> = { "rag-024": ["3/2", "df(A)仍为1"], "agent-rl-020": ["1/6", "16.67%"] };
    for (const marker of extensionMarkers[knowledgeId(question)] ?? []) await expect(extension).toContainText(marker);
    const firstFollowUp = question.original.extension.split("**")[1];
    expect(firstFollowUp).toBeTruthy();
    expect((await extension.textContent())!.split(firstFollowUp).length - 1).toBe(1);
    expect(question.revision.followUps).toBeUndefined();
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    if (knowledgeId(question) === "rag-024") {
      const pprTable = card.locator(".answer-panel table").nth(1);
      for (const value of ["p(A)", "9/16", "7/12"]) {
        const cell = pprTable.getByRole(value.startsWith("p(") ? "columnheader" : "cell", { name: value, exact: true });
        await expect(cell).toHaveCount(1);
        const lineRects = await cell.evaluate((element) => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getClientRects().length;
        });
        expect(lineRects).toBe(1);
      }
      if (testInfo.project.name === "mobile-webkit") {
        const scrollRegion = card.locator(".answer-panel .markdown-table-scroll").nth(1);
        await expect(scrollRegion).toHaveAttribute("tabindex", "0");
        await scrollRegion.scrollIntoViewIfNeeded();
        const initial = await scrollRegion.evaluate((e) => ({ client: e.clientWidth, scroll: e.scrollWidth }));
        expect(initial.scroll).toBeGreaterThan(initial.client);
        await scrollRegion.screenshot({ path: testInfo.outputPath("rag-ppr-table-left.png"), scale: "css" });
        await scrollRegion.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scrollRegion.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
        await scrollRegion.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
        await expect(pprTable.getByRole("columnheader", { name: "p(E)", exact: true })).toBeInViewport();
        await scrollRegion.screenshot({ path: testInfo.outputPath("rag-ppr-table-right.png"), scale: "css" });
        await scrollRegion.evaluate((e) => { e.scrollLeft = 0; });
        const pageWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
        expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${knowledgeId(question)}-full.png`), fullPage: true, scale: "css" });
    await page.screenshot({ path: testInfo.outputPath(`${knowledgeId(question)}-viewport.png`), fullPage: false, scale: "css" });
  }
  await page.screenshot({ path: testInfo.outputPath("guide-added-answer-and-followups.png"), fullPage: true, scale: "css" });
  // Browser-only fixtures; no actual user mastery or personal attempts are recorded.
});
