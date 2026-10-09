import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("presentation upgrade keeps self-assessment and shows full answers and follow-ups once", async ({ page }, testInfo) => {
  const oldPath = process.env.GUIDE_PRESENTATION_OLD_PACK;
  const newPath = process.env.GUIDE_PRESENTATION_NEW_PACK;
  test.skip(!oldPath || !newPath, "需要显式指定新旧360题包");
  test.setTimeout(60_000);
  const oldBytes = await readFile(oldPath!);
  const newBytes = await readFile(newPath!);
  expect(createHash("sha256").update(oldBytes).digest("hex")).toBe("8e1f4a280030083c6ea8738b0f18154d0df67602d378c796be2a42ca16c4ac84");
  expect(createHash("sha256").update(newBytes).digest("hex")).toBe("f6514cd4432438e88da9b279543f024349e3265d8c3411ddd0a7f6cfe4473de4");
  const before = JSON.parse(oldBytes.toString("utf8"));
  const after = JSON.parse(newBytes.toString("utf8"));
  expect(after.pack.id).toBe(before.pack.id);
  expect(after.questions.map((q: { id: string }) => q.id)).toEqual(before.questions.map((q: { id: string }) => q.id));
  const upload = async (target: Page, bytes: Buffer) => {
    await target.goto("/#/packs");
    await target.locator('input[type="file"]').first().setInputFiles({ name: "guide.json", mimeType: "application/json", buffer: bytes });
    await expect(target.getByRole("status")).toContainText("共 360 题", { timeout: 15_000 });
  };
  const open = async (id: string) => {
    await page.goto(`/#/study?pack=${encodeURIComponent(after.pack.id)}&question=${id}`);
    await expect(page.locator(".question-card")).toHaveCount(1);
    return page.locator(".question-card");
  };
  await upload(page, oldBytes);
  let card = await open("10.1.23");
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  await upload(page, newBytes);
  card = await open("10.1.23");
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  const question = after.questions.find((q: { id: string }) => q.id === "10.1.23");
  await card.getByRole("button", { name: "拓展与追问" }).click();
  const extension = card.locator(".extension-panel");
  const firstFollowUp = question.original.extension.split("**")[1];
  expect((await extension.textContent())!.split(firstFollowUp).length - 1).toBe(1);
  expect(question.revision.followUps).toBeUndefined();
  await expect(extension.getByRole("link", { name: /John Schulman/ })).toHaveAttribute("href", "http://joschu.net/blog/kl-approx.html");
  await page.screenshot({ path: testInfo.outputPath("guide-followups-once.png"), fullPage: true });
  const coding = after.questions.find((q: { original: { answer: string } }) => q.original.answer.includes("```python"));
  expect(coding).toBeTruthy();
  card = await open(coding.id);
  await card.getByRole("button", { name: "查看提示" }).click();
  await expect(card.locator(".hint-panel")).toContainText(coding.original.knowledge);
  await expect(card.locator(".hint-panel pre")).toHaveCount(0);
  await card.getByRole("button", { name: "揭示答案" }).click();
  await expect(card.locator(".answer-panel .quick-answer")).toContainText(coding.revision.quickAnswer);
  await expect(card.locator(".answer-panel pre code").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("guide-full-answer-code.png"), fullPage: true });
  // These are isolated UI fixtures, including the retained manual self-assessment.
  // They never record that the user mastered the question or completed practice.
});
