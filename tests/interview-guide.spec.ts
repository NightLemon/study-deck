import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// This is the evolving local guide, separate from INTERVIEW_PACK_PATH's 150-question fixture.
const guidePath = process.env.INTERVIEW_GUIDE_PACK_PATH;
const loadGuide = async () => JSON.parse(await readFile(guidePath!, "utf8"));
const upload = async (page: Page, pack: Awaited<ReturnType<typeof loadGuide>>) => {
  await page.goto("/#/packs");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "interview-guide.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack))
  });
  // Large authored packs may spend several seconds committing to WebKit IndexedDB.
  await expect(page.getByRole("status")).toContainText(`共 ${pack.pack.questionCount} 题`, { timeout: 15_000 });
};
const openQuestion = async (page: Page, packId: string, questionId: string) => {
  await page.goto(`/#/study?pack=${encodeURIComponent(packId)}&question=${encodeURIComponent(questionId)}`);
  const card = page.locator(".question-card");
  await expect(card).toHaveCount(1);
  return card;
};

test("imports the actual generated guide and opens every chapter using stable mapped question IDs", async ({ page }, testInfo) => {
  test.skip(!guidePath, "配置 INTERVIEW_GUIDE_PACK_PATH 后验证实际生成包");
  test.setTimeout(60_000);
  const pack = await loadGuide();
  expect(pack.schemaVersion).toBe(1);
  expect(pack.questions.length).toBe(pack.pack.questionCount);
  expect(new Set(pack.questions.map((q: { id: string }) => q.id)).size).toBe(pack.questions.length);
  for (const q of pack.questions) expect(q.id).toMatch(/^\d+\.\d+\.\d+$/);
  await upload(page, pack);
  for (const chapter of pack.chapters) {
    const question = pack.questions.find((q: { chapterId: string }) => q.chapterId === chapter.id)!;
    const card = await openQuestion(page, pack.pack.id, question.id);
    await expect(card).toContainText(question.original.prompt);
  }
  await page.screenshot({ path: testInfo.outputPath("guide-last-chapter.png"), fullPage: true });
});

test("actual guide preserves favorites, manual mastery and practice evidence through missing IDs and backup restore", async ({ page, browserName }, testInfo) => {
  test.skip(!guidePath, "配置 INTERVIEW_GUIDE_PACK_PATH 后验证实际生成包");
  test.skip(browserName !== "chromium", "完整下载恢复另在 Chromium 验证");
  test.setTimeout(60_000);
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00Z"));
  const pack = await loadGuide();
  const q = pack.questions[0];
  await upload(page, pack);
  let card = await openQuestion(page, pack.pack.id, q.id);
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await card.getByLabel("集合名称", { exact: true }).fill("自动化隔离测试集合");
  await card.getByRole("button", { name: "加入集合", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("已加入集合");
  await card.getByRole("button", { name: "开始闭卷尝试", exact: true }).click();
  await card.getByLabel("闭卷回答", { exact: true }).fill("自动化测试回答，不代表个人掌握。");
  await card.getByLabel("自评结果", { exact: true }).selectOption("correct");
  await card.getByLabel("实践证据", { exact: false }).fill("fixture://isolated-browser-test");
  await card.getByRole("button", { name: "保存尝试", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("尝试已保存");

  const upgrade = structuredClone(pack);
  upgrade.pack.version = "0.1.1";
  upgrade.questions = upgrade.questions.filter((item: { id: string }) => item.id !== q.id);
  upgrade.pack.questionCount = upgrade.questions.length;
  await upload(page, upgrade);
  await page.getByRole("link", { name: "学习记录", exact: true }).click();
  await page.getByRole("tab", { name: /目标集合/ }).click();
  await expect(page.getByText("题目尚未安装，个人记录已保留。导入相同题库及题号后即可继续。", { exact: true })).toBeVisible();
  await upload(page, pack);
  card = await openQuestion(page, pack.pack.id, q.id);
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  await expect(card.locator(".attempt-entry")).toContainText("间隔 1 天");

  await page.goto("/#/packs");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部进度/ }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("guide-progress.json");
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.schemaVersion).toBe(2);
  expect(backup.attempts).toHaveLength(1);
  expect(backup.members).toHaveLength(1);
  expect(backup.states.find((s: { questionId: string }) => s.questionId === q.id)).toMatchObject({favorite:true,status:"mastered"});
  const context = await page.context().browser()!.newContext({ baseURL: "http://127.0.0.1:41731" });
  try {
    const fresh = await context.newPage();
    await fresh.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await fresh.goto("/#/packs");
    await fresh.getByLabel("进度导入模式").selectOption("replace");
    await fresh.locator('input[type="file"]').nth(1).setInputFiles(backupPath);
    await expect(fresh.getByRole("status")).toContainText("已覆盖");
    await upload(fresh, pack);
    card = await openQuestion(fresh, pack.pack.id, q.id);
    await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
    await expect(card.locator(".attempt-entry")).toContainText("间隔 1 天");
    await fresh.getByRole("link", { name: "学习记录", exact: true }).click();
    await expect(fresh.getByRole("region", { name: "到期复习列表" })).toContainText("今天到期");
    await fresh.getByRole("tab", { name: /尝试记录/ }).click();
    await fresh.getByText("查看回答、错因与实践证据", { exact: true }).click();
    await expect(fresh.getByText("fixture://isolated-browser-test", { exact: true })).toBeVisible();
    await fresh.screenshot({ path: testInfo.outputPath("guide-restored-evidence.png"), fullPage: true });
  } finally { await context.close(); }
});
