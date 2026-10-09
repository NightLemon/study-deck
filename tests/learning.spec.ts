import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const installSample = async (page: Page) => {
  await page.goto("/#/packs");
  await page.getByRole("button", { name: "安装合成示例" }).click();
  await expect(page.getByRole("status")).toContainText("已安装");
  await page.getByRole("link", { name: "学习", exact: true }).click();
};

test("records self-assessed attempts, latches hint use and shows due review without changing mastered state", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00Z"));
  await installSample(page);
  const card = page.locator(".question-card").first();
  await card.getByLabel("集合名称", { exact: true }).fill("面试重点");
  await card.getByRole("button", { name: "加入集合" }).click();
  await expect(card.getByRole("status")).toContainText("已加入集合");
  await card.getByRole("button", { name: "开始闭卷尝试" }).click();
  await card.getByLabel("闭卷回答", { exact: true }).fill("先明确输入和约束，再写自己的解法。");
  await card.getByLabel("自评结果", { exact: true }).selectOption("correct");
  await card.getByLabel("实践证据", { exact: false }).fill("https://example.com/practice\n<script>这只是我的文字</script>");
  await card.getByRole("button", { name: "保存尝试", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("尝试已保存");
  await expect(card.getByRole("button", { name: "未学", exact: true })).toHaveClass(/active/);
  await expect(card.locator(".attempt-entry")).toContainText("间隔 1 天");

  await card.getByRole("button", { name: "开始闭卷尝试" }).click();
  await card.getByLabel("闭卷回答", { exact: true }).fill("这次使用了提示。");
  await card.getByRole("button", { name: "查看提示", exact: true }).click();
  const hint = card.getByLabel("本次使用了提示或看过参考内容", { exact: true });
  await expect(hint).toBeChecked(); await expect(hint).toBeDisabled();
  await card.getByRole("button", { name: "收起提示", exact: true }).click();
  await expect(hint).toBeChecked();
  await card.getByLabel("自评结果", { exact: true }).selectOption("correct");
  await card.getByRole("button", { name: "保存尝试", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("尝试已保存");
  await expect(card.locator(".attempt-entry")).toContainText("间隔 1 天");

  await page.getByRole("link", { name: "学习记录", exact: true }).click();
  await page.getByRole("tab", { name: /尝试记录/ }).click();
  await expect(page.getByRole("region", { name: "尝试记录列表" }).locator("article")).toHaveCount(2);
  await page.getByText("查看回答、错因与实践证据", { exact: true }).last().click();
  await expect(page.getByText("https://example.com/practice\n<script>这只是我的文字</script>", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /目标集合/ }).click();
  await expect(page.getByRole("heading", { name: "面试重点", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开这道题 →", exact: true })).toHaveCount(1);
  await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
  await page.reload();
  await expect(page.getByRole("region", { name: "到期复习列表" })).toContainText("今天到期");
});

test("backs up new tables and restores them before installing a pack", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "下载恢复在 Chromium 验证，核心交互另覆盖移动端");
  await installSample(page);
  const card = page.locator(".question-card").first();
  await card.getByLabel("集合名称", { exact: true }).fill("可恢复集合");
  await card.getByRole("button", { name: "加入集合" }).click();
  await expect(card.getByRole("status")).toContainText("已加入集合");
  await card.getByRole("button", { name: "开始闭卷尝试" }).click();
  await card.getByLabel("闭卷回答", { exact: true }).fill("我遗漏了异常分支。");
  await card.getByLabel("错因或补充说明", { exact: false }).fill("没有考虑无效输入");
  await card.getByRole("button", { name: "保存尝试", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("尝试已保存");
  await page.getByRole("link", { name: "题库", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部进度/ }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath("learning-progress.json");
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.schemaVersion).toBe(2);
  expect(backup.attempts).toHaveLength(1);
  expect(backup.members).toHaveLength(1);

  // A fresh isolated browser context has no installed packs or personal data.
  const context = await page.context().browser()!.newContext();
  const fresh = await context.newPage();
  await fresh.goto("http://127.0.0.1:41731/#/packs");
  await fresh.getByLabel("进度导入模式").selectOption("replace");
  await fresh.locator('input[type="file"]').nth(1).setInputFiles(path);
  await expect(fresh.getByRole("status")).toContainText("已覆盖");
  await fresh.getByRole("link", { name: "学习记录", exact: true }).click();
  await fresh.getByRole("tab", { name: /目标集合/ }).click();
  await expect(fresh.getByText("题目尚未安装，个人记录已保留。导入相同题库及题号后即可继续。", { exact: true })).toBeVisible();
  await fresh.getByRole("link", { name: "题库", exact: true }).click();
  await fresh.getByRole("button", { name: "安装合成示例" }).click();
  await expect(fresh.getByRole("status")).toContainText("已安装");
  await fresh.getByRole("link", { name: "学习记录", exact: true }).click();
  await fresh.getByRole("tab", { name: /目标集合/ }).click();
  await fresh.getByRole("link", { name: "打开这道题 →", exact: true }).click();
  await expect(fresh.locator(".question-card")).toHaveCount(1);
  await expect(fresh.locator(".attempt-entry")).toContainText("间隔 1 天");
  await context.close();
});

test("explicit question links never substitute an identical ID from another pack", async ({ page }) => {
  await installSample(page);
  const sample = JSON.parse(await readFile(resolve(process.cwd(), "public/sample-pack.json"), "utf8"));
  const card = page.locator(".question-card").first();
  await card.getByLabel("集合名称", { exact: true }).fill("第一题库目标");
  await card.getByRole("button", { name: "加入集合" }).click();
  await expect(card.getByRole("status")).toContainText("已加入集合");
  await page.getByRole("link", { name: "题库", exact: true }).click();
  const other = structuredClone(sample);
  other.pack.id = "other.practice.pack"; other.pack.title = "另一份题库";
  other.questions[0].original.prompt = "另一题库的同题号"; delete other.questions[0].revision;
  await page.locator('input[type="file"]').first().setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) });
  await expect(page.getByRole("status")).toContainText("已安装");
  await expect(page.getByLabel("切换当前题库")).toHaveValue(other.pack.id);
  await page.getByRole("link", { name: "学习记录", exact: true }).click();
  await page.getByRole("tab", { name: /目标集合/ }).click();
  await page.getByRole("link", { name: "打开这道题 →", exact: true }).click();
  await expect(page.getByLabel("切换当前题库")).toHaveValue(sample.pack.id);
  await expect(page.locator(".question-card")).toHaveCount(1);
  await expect(page.locator(".question-card")).not.toContainText("另一题库的同题号");
  await page.goto(`/#/study?pack=missing.pack&question=${sample.questions[0].id}`);
  await expect(page.getByRole("heading", { name: "指定题库尚未安装" })).toBeVisible();
  await expect(page.locator(".question-card")).toHaveCount(0);
});
