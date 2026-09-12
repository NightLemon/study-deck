import { expect, test, type Page } from "@playwright/test";
import type { QuestionPack } from "../src/lib/types";

const makePack = (): QuestionPack => ({
  schemaVersion: 1,
  pack: { id: "synthetic.directory", title: "目录测试", version: "1.0.0", locale: "zh-CN", questionCount: 3, license: { scope: "private-personal-use", redistribution: false }, source: { title: "合成题目", documentVersion: "1" } },
  chapters: [{ id: "1", title: "缓存与队列", order: 1, sections: [{ id: "1.1", title: "所有练习", order: 1 }] }],
  questions: ["缓存的作用是什么？", "队列关闭后怎样排空？", "怎样分析队列的等待竞争？"].map((prompt, i) => ({
    id: `1.1.${i + 1}`, chapterId: "1", sectionId: "1.1", order: i + 1,
    original: { prompt, interpretation: "合成提示", knowledge: "合成知识", answer: "合成答案", extension: "合成拓展" }, review: { status: "raw" }
  }))
});

async function upload(page: Page, pack: QuestionPack) {
  await page.getByRole("link", { name: "题库", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "directory.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(page.getByRole("status")).toContainText(`已安装「${pack.pack.title}」${pack.pack.version}`);
  await page.getByRole("link", { name: "学习", exact: true }).click();
}

async function chooseDirectory(page: Page, name: RegExp) {
  await expect(page.locator(".study-toolbar")).toBeVisible();
  const toggle = page.getByRole("button", { name: "☰ 章节目录" });
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  await page.getByRole("complementary", { name: "章节目录" }).getByRole("button", { name }).click();
}

test("directory difficulty selection composes with search and progress after regrouping", async ({ page }) => {
  await page.goto("/");
  const before = makePack();
  before.chapters.push({ id: "2", title: "文件处理", order: 2, sections: [{ id: "2.1", title: "基本操作", order: 1 }] });
  before.questions.push({ ...structuredClone(before.questions[0]), id: "2.1.1", chapterId: "2", sectionId: "2.1", order: 4 });
  before.pack.questionCount = 4;
  await upload(page, before);
  const moved = page.locator('[id="question-1.1.2"]');
  await moved.getByRole("button", { name: "收藏题目" }).click();
  await moved.getByRole("button", { name: "待复习", exact: true }).click();

  const after = structuredClone(before);
  after.pack.version = "1.1.0";
  after.chapters[0].sections = ["基础题", "中等题", "进阶题"].map((title, i) => ({ id: `1.${i + 1}`, title, order: i + 1 }));
  after.questions.filter(question => question.chapterId === "1").forEach((question, i) => { question.sectionId = `1.${i + 1}`; });
  await upload(page, after);
  await chooseDirectory(page, /缓存与队列/);
  await chooseDirectory(page, /文件处理/);
  await chooseDirectory(page, /基本操作/);
  await expect(page.locator('[id="question-2.1.1"]')).toBeVisible();
  await chooseDirectory(page, /缓存与队列/);
  await chooseDirectory(page, /中等题/);
  await expect(page.locator(".question-card")).toHaveCount(1);
  await expect(moved).toBeVisible();
  await expect(moved.getByRole("button", { name: "取消收藏" })).toBeVisible();
  await expect(moved.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
  await expect(moved.locator(".answer-panel")).toHaveCount(0);

  await page.getByLabel("搜索题库").fill("排空");
  await page.getByLabel("按学习状态筛选").selectOption("review");
  await page.getByRole("button", { name: "★ 只看收藏" }).click();
  await expect(moved).toBeVisible();
  await chooseDirectory(page, /基础题/);
  await expect(page.locator(".question-card")).toHaveCount(0);
  await chooseDirectory(page, /中等题/);
  await expect(moved).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/section=1.2/);
  await expect(page.locator(".question-card")).toHaveCount(1);
  await expect(moved.getByRole("button", { name: "取消收藏" })).toBeVisible();
  await expect(moved.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
  await chooseDirectory(page, /进阶题/);
  await expect(page.locator('[id="question-1.1.3"]')).toBeVisible();
  await expect(page.locator(".question-card")).toHaveCount(1);
  await chooseDirectory(page, /^全部题目$/);
  await expect(page.locator(".question-card")).toHaveCount(4);
});
