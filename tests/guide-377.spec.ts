import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("frozen 372 to 377 keeps every old payload and renders all five new lessons", async ({ page }, testInfo) => {
  const oldPath = process.env.GUIDE_ADDITIONS_OLD_PACK;
  const newPath = process.env.GUIDE_ADDITIONS_NEW_PACK;
  test.skip(!oldPath || !newPath, "需要显式指定冻结的372和377题包");
  test.setTimeout(90_000);
  const oldBytes = await readFile(oldPath!);
  const newBytes = await readFile(newPath!);
  expect(createHash("sha256").update(oldBytes).digest("hex")).toBe("79edb310d87e51fc2e04582473e25ec76a206266f62a0178032debd7944a9976");
  expect(createHash("sha256").update(newBytes).digest("hex")).toBe("b02307e42e3ee032064edf668ebbb91e90ce2421018ed788769b4fc8af0ab896");
  const before = JSON.parse(oldBytes.toString("utf8"));
  const after = JSON.parse(newBytes.toString("utf8"));
  expect(after.schemaVersion).toBe(1);
  expect(after.pack.id).toBe(before.pack.id);
  expect(before.questions).toHaveLength(372);
  expect(after.questions).toHaveLength(377);
  const oldIds = new Set(before.questions.map((q: { id: string }) => q.id));
  const knowledgeId = (q: { original: { interpretation: string } }): string => q.original.interpretation.match(/条目 ID：([^；]+)/)![1];
  for (const old of before.questions) {
    expect(after.questions.find((q: { id: string }) => q.id === old.id)).toEqual(old);
  }
  const added = after.questions.filter((q: { id: string }) => !oldIds.has(q.id));
  expect(added).toHaveLength(5);
  expect(new Set(added.map(knowledgeId))).toEqual(new Set(["context-008", "context-009", "context-010", "ai-coding-041", "ai-coding-042"]));
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
  await upload(page, oldBytes, 372);
  const retained = before.questions[0];
  let card = await open(retained.id);
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  await upload(page, newBytes, 377);
  card = await open(retained.id);
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  const checkedQuestions = added;
  const formulaMarkers: Record<string, string[]> = {
    "context-009": ["operation_id", "outbox"],
    "context-010": ["拍摄日期未知", "OCR"],
    "ai-coding-041": ["PPL", "ignore_index"],
    "ai-coding-042": ["最小正规数", "subnormal", "+0.5", "−0.5"]
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
    const firstFollowUp = question.original.extension.split("**")[1];
    expect(firstFollowUp).toBeTruthy();
    expect((await extension.textContent())!.split(firstFollowUp).length - 1).toBe(1);
    expect(question.revision.followUps).toBeUndefined();
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  }
  await page.screenshot({ path: testInfo.outputPath("guide-added-answer-and-followups.png"), fullPage: true, scale: "css" });
  // Browser-only fixtures; no actual user mastery or personal attempts are recorded.
});
