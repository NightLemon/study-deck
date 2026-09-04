import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const installSample = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("link", { name: "导入第一个题库" }).click();
  await page.getByRole("button", { name: "安装合成示例" }).click();
  await expect(page.getByRole("status")).toContainText("已安装");
};

test("searches, filters, reveals answers and updates dashboard progress", async ({ page }, testInfo) => {
  await installSample(page);
  await page.getByRole("link", { name: "学习", exact: true }).click();

  const firstQuestion = page.locator(".question-card").first();
  await expect(firstQuestion).toContainText("为什么在优化低延迟路径前必须先定义延迟分位数？");
  await page.screenshot({ path: testInfo.outputPath("study-initial.png"), fullPage: false });
  await firstQuestion.getByRole("button", { name: "查看提示" }).click();
  await expect(firstQuestion.getByRole("heading", { name: "题目解读" })).toBeVisible();
  await firstQuestion.getByRole("button", { name: "揭示答案" }).click();
  await expect(firstQuestion.getByText("30 秒回答")).toBeVisible();
  await firstQuestion.getByRole("button", { name: "拓展与追问" }).click();
  await expect(firstQuestion.getByRole("heading", { name: "拓展思考" })).toBeVisible();
  await firstQuestion.getByRole("button", { name: "查看 PDF 原文与修订说明" }).click();
  await expect(firstQuestion.getByRole("heading", { name: "规范化后的 PDF 原文" })).toBeVisible();

  await firstQuestion.getByRole("button", { name: "收藏题目" }).click();
  await firstQuestion.getByRole("button", { name: "待复习" }).click();
  await page.getByRole("button", { name: "只看收藏" }).click();
  await expect(page.locator(".question-card")).toHaveCount(1);

  await page.getByRole("button", { name: "只看收藏" }).click();
  await page.getByLabel("搜索题库").fill("伪共享");
  await expect(page.getByText("一个结构体刚好等于 64 字节，是否意味着它一定不会产生伪共享？")).toBeVisible();
  await expect(page.locator(".question-card")).toHaveCount(1);
  await page.getByLabel("搜索题库").fill("");
  await page.getByLabel("按学习状态筛选").selectOption("review");
  await expect(page.locator(".question-card")).toHaveCount(1);

  const mobileMenu = page.locator(".curriculum-mobile-button");
  const curriculum = page.locator("aside.curriculum");
  if (testInfo.project.name === "mobile-webkit") {
    await expect(mobileMenu).toBeVisible();
    await expect(mobileMenu).toHaveAttribute("aria-expanded", "false");
    await mobileMenu.click();
    await expect(mobileMenu).toHaveAttribute("aria-expanded", "true");
    await expect(curriculum).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(curriculum.getByRole("button", { name: "关闭章节目录" })).toBeVisible();
    const drawerBox = await curriculum.boundingBox();
    expect(drawerBox?.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("drawer-open.png"), fullPage: false });
    await curriculum.getByRole("button", { name: /低延迟系统思维/ }).click();
    await expect(mobileMenu).toHaveAttribute("aria-expanded", "false");
    await mobileMenu.click();
    await expect(curriculum).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await curriculum.getByRole("button", { name: /测量与权衡/ }).click();
    await expect(mobileMenu).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await curriculum.boundingBox())?.x ?? 0).toBeLessThan(0);
  } else {
    await expect(mobileMenu).toBeHidden();
    await expect(curriculum).toBeVisible();
    await expect(curriculum.getByRole("button", { name: "关闭章节目录" })).toBeHidden();
  }

  await page.screenshot({ path: testInfo.outputPath("study-dense.png"), fullPage: false });
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);

  await page.getByRole("link", { name: "总览", exact: true }).click();
  const reviewStat = page.getByLabel("学习统计").locator("article").filter({ hasText: "待复习" });
  const favoriteStat = page.getByLabel("学习统计").locator("article").filter({ hasText: "已收藏" });
  await expect(reviewStat.locator("strong")).toHaveText("1");
  await expect(favoriteStat.locator("strong")).toHaveText("1");
});

test("rejects an invalid upgrade without changing the installed pack", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "事务错误路径只需在一个浏览器重复验证");
  await installSample(page);

  const samplePath = resolve(process.cwd(), "public", "sample-pack.json");
  const invalid = JSON.parse(await readFile(samplePath, "utf8"));
  invalid.pack.version = "1.1.0";
  invalid.pack.questionCount = 4;
  invalid.questions.push({ ...invalid.questions[0] });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "invalid-upgrade.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalid))
  });
  await expect(page.getByRole("status")).toContainText("重复题号");

  await page.getByRole("link", { name: "学习", exact: true }).click();
  await expect(page.locator(".question-card")).toHaveCount(3);
  await expect(page.getByText("为什么在优化低延迟路径前必须先定义延迟分位数？")).toBeVisible();
});

test("exports progress and restores it in replace mode", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "下载与恢复流程只需在一个浏览器重复验证");
  await installSample(page);
  await page.getByRole("link", { name: "学习", exact: true }).click();
  await page.getByRole("button", { name: "收藏题目" }).first().click();
  await page.getByRole("button", { name: "已掌握" }).first().click();
  await page.getByRole("link", { name: "题库", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出全部进度/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qd-study-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const progressPath = testInfo.outputPath("progress.json");
  await download.saveAs(progressPath);

  await page.getByLabel("进度导入模式").selectOption("replace");
  await page.locator('input[type="file"]').nth(1).setInputFiles(progressPath);
  await expect(page.getByRole("status")).toContainText("已覆盖 1 条学习记录");
});
