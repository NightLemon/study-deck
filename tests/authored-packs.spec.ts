import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { QuestionPack } from "../src/lib/types";

const sample = async (): Promise<QuestionPack> => JSON.parse(await readFile("public/sample-pack.json", "utf8"));
const upload = async (page: Page, pack: QuestionPack) => {
  await page.getByRole("link", { name: "题库", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "local-pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(page.getByRole("status")).toContainText(`已安装「${pack.pack.title}」${pack.pack.version}`, { timeout: 30_000 });
  await expect(page.getByLabel("切换当前题库")).toHaveValue(pack.pack.id);
};

test("supports mixed sources, hides answers and resets reveal state across packs", async ({ page }) => {
  const first = await sample();
  first.pack.id = "synthetic.mixed";
  delete first.questions[0].sourcePages;
  first.questions[0].original.prompt = "合成选择题\n\n**A.** 等待\n\n**B.** 取消";
  first.questions[0].original.answer = "正确选项：B。\n\n| 条件 | 行为 |\n|---|---|\n| 已取消 | 停止后续工作 |\n\n```text\nif remaining < 0: stop()\n```";
  first.questions[0].revision = { quickAnswer: "合成速答只应在揭示后显示", followUps: ["如何回收？"], references: [{ title: "合成参考", url: "https://example.com/" }] };
  await page.goto("/");
  await upload(page, first);
  await page.getByRole("link", { name: "学习", exact: true }).click();
  const card = page.locator(".question-card").first();
  await expect(card.locator(".source-page")).toHaveCount(0);
  await expect(page.locator(".question-card").nth(1).locator(".source-page")).toBeVisible();
  await expect(card).not.toContainText("正确选项");
  await expect(card).not.toContainText("合成速答");
  await card.getByRole("button", { name: "查看提示" }).click();
  await expect(card).not.toContainText("正确选项");
  await card.getByRole("button", { name: "揭示答案" }).click();
  await expect(card).toContainText("正确选项：B");
  await expect(card.locator("table")).toHaveCount(1);
  await expect(card.locator("pre code")).toHaveText("if remaining < 0: stop()\n");
  await card.getByRole("button", { name: "查看原始内容与来源说明" }).click();
  await expect(card.getByRole("heading", { name: "原始内容与来源说明" })).toBeVisible();
  await card.getByRole("button", { name: "收藏题目" }).click();
  await card.getByRole("button", { name: "待复习", exact: true }).click();

  const second = structuredClone(first);
  second.pack.id = "synthetic.second";
  second.pack.title = "第二组合成题库";
  await upload(page, second);
  await page.getByRole("link", { name: "学习", exact: true }).click();
  await page.locator(".question-card").first().getByRole("button", { name: "揭示答案" }).click();
  await page.getByLabel("切换当前题库").selectOption(first.pack.id);
  await expect(card).not.toContainText("正确选项");
  await expect(card.getByRole("button", { name: "取消收藏" })).toBeVisible();
  first.pack.version = "1.0.1";
  await upload(page, first);
  await page.getByRole("link", { name: "学习", exact: true }).click();
  await page.reload();
  await expect(card.getByRole("button", { name: "取消收藏" })).toBeVisible();
  await expect(card.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
});

test("long code scrolls inside the card without widening the page", async ({ page }) => {
  const pack = await sample();
  pack.pack.id = "synthetic.long-code";
  pack.questions[0].original.answer = "```text\n" + "payload_".repeat(100) + "\n```";
  await page.goto("/");
  await upload(page, pack);
  await page.getByRole("link", { name: "学习", exact: true }).click();
  const card = page.locator(".question-card").first();
  await card.getByRole("button", { name: "揭示答案" }).click();
  const pre = card.locator("pre");
  await expect(pre).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await pre.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await pre.evaluate(node => { node.scrollLeft = 100; return node.scrollLeft; })).toBeGreaterThan(0);
});

// Full private content is read from explicit local paths; never committed to this repository.
const externalPaths: string[] = process.env.STUDY_PACK_PATHS ? JSON.parse(process.env.STUDY_PACK_PATHS) : [];
test("imports and exercises all explicitly supplied local packs", async ({ page }, testInfo) => {
  test.skip(externalPaths.length === 0, "No private local pack paths supplied");
  test.setTimeout(180_000);
  await page.goto("/");
  const packs: QuestionPack[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const file of externalPaths) {
    const pack: QuestionPack = JSON.parse(await readFile(file, "utf8"));
    packs.push(pack);
    await upload(page, pack);
    await page.getByRole("link", { name: "学习", exact: true }).click();
    await expect(page.locator(".result-heading")).toContainText(`${pack.questions.length} 道题`);
    const card = page.locator(".question-card").first();
    await expect(card.locator(".question-id")).toHaveText(pack.questions[0].id);
    await expect(card.locator(".source-page")).toHaveCount(pack.questions[0].sourcePages ? 1 : 0);
    await expect(card.locator(".answer-panel")).toHaveCount(0);
    for (const name of ["查看提示", "揭示答案", "拓展与追问"]) await card.getByRole("button", { name }).click();
    await expect(card.locator(".answer-panel")).toBeVisible();
    if (pack.questions[0].revision || pack.questions[0].review.notes?.length) {
      await card.getByRole("button", { name: pack.questions[0].sourcePages ? "查看 PDF 原文与修订说明" : "查看原始内容与来源说明" }).click();
      await expect(card.locator(".original-panel")).toBeVisible();
    }
    await card.getByRole("button", { name: "收藏题目" }).click();
    await card.getByRole("button", { name: "待复习", exact: true }).click();
    const keyword = pack.questions[0].original.prompt.match(/[\u4e00-\u9fff]{2,6}/)?.[0];
    expect(keyword).toBeTruthy();
    await page.getByLabel("搜索题库").fill(keyword!);
    await expect(page.locator(".question-card").first()).toContainText(keyword!);
    await page.getByLabel("搜索题库").fill("一个不存在的题目关键词xyz987");
    await expect(page.locator(".question-card")).toHaveCount(0);
    await page.getByLabel("搜索题库").fill("");
    const upgrade = structuredClone(pack);
    const version = upgrade.pack.version.split(".");
    version[2] = String(Number(version[2]) + 1);
    upgrade.pack.version = version.join(".");
    await upload(page, upgrade);
    await page.getByRole("link", { name: "学习", exact: true }).click();
    await page.reload();
    await expect(card.getByRole("button", { name: "取消收藏" })).toBeVisible();
    await expect(card.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
  }
  for (const pack of packs) {
    await page.getByLabel("切换当前题库").selectOption(pack.pack.id);
    await expect(page.locator(".result-heading")).toContainText(`${pack.questions.length} 道题`);
    await expect(page.locator(".question-card").first().getByRole("button", { name: "取消收藏" })).toBeVisible();
    await expect(page.locator(".question-card").first().locator(".answer-panel")).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath("local-pack-study.png"), fullPage: false });
  const finalCard = page.locator(".question-card").first();
  await finalCard.getByRole("button", { name: "揭示答案" }).click();
  await finalCard.getByRole("heading", { name: "参考答案", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("local-pack-answer.png"), fullPage: false });
  expect(errors).toEqual([]);
});
