import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const importText = async (page: Page, text: string, name = "authored.json") => {
  await page.goto("/#/packs");
  await page.locator('input[type="file"]').first().setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(text)
  });
  // WebKit takes about five seconds to replace the full IndexedDB collection.
  // Await the actual completion notice, including for files up to 25 MB.
  await expect(page.getByRole("status")).toContainText("已安装", { timeout: 30_000 });
  await page.getByRole("link", { name: "学习", exact: true }).click();
};

test("authored pack shows general provenance, both languages and keeps progress on upgrade", async ({ page }) => {
  const pack = JSON.parse(await readFile(resolve("public/sample-pack.json"), "utf8"));
  pack.pack.id = "test.authored";
  pack.pack.title = "原创编程学习库（150 题 · C++17 与 Python 双语言参考实现）";
  pack.pack.questionCount = 1;
  pack.questions = [pack.questions[0]];
  const question = pack.questions[0];
  delete question.sourcePages;
  question.original.prompt = "### 双语言算法练习\n\n来源：原创练习。实现两数求和。";
  question.original.answer = "C++17\n\n```cpp\nint add(int a, int b) { return a + b; }\n```\n\nPython 3\n\n```python\ndef add(a, b):\n    return a + b\n```";
  question.revision = { references: [{ title: "技术参考：Python", url: "https://docs.python.org/3/" }] };
  await importText(page, JSON.stringify(pack));
  const pageWidths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(pageWidths.document).toBeLessThanOrEqual(pageWidths.viewport);
  const card = page.locator(".question-card").first();
  await expect(card.locator(".source-page")).toHaveCount(0);
  await card.getByRole("button", { name: "揭示答案" }).click();
  await expect(card.locator("code.language-cpp")).toContainText("return a + b;");
  await expect(card.locator("code.language-python")).toContainText("return a + b");
  await card.getByRole("button", { name: "拓展与追问" }).click();
  await expect(card.getByRole("link", { name: "技术参考：Python" })).toHaveAttribute("href", "https://docs.python.org/3/");
  await card.getByRole("button", { name: "查看原始内容与修订说明" }).click();
  await expect(card.getByRole("heading", { name: "原始学习内容" })).toBeVisible();
  await card.getByRole("button", { name: "收藏题目" }).click();
  await card.getByRole("button", { name: "待复习", exact: true }).click();

  pack.pack.version = "1.0.1";
  question.original.prompt += "\n\n修订后的题意。";
  await importText(page, JSON.stringify(pack), "authored-upgrade.json");
  await expect(card).toContainText("修订后的题意");
  await expect(card.getByRole("button", { name: "取消收藏" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);

  const second = structuredClone(pack);
  second.pack.id = "test.authored-second";
  second.pack.title = "独立的第二份学习库";
  await importText(page, JSON.stringify(second), "second-library.json");
  const switcher = page.getByRole("combobox", { name: "切换当前题库" });
  await expect(switcher).toHaveValue(second.pack.id);
  await expect(card.getByRole("button", { name: "收藏题目" })).toBeVisible();
  await page.reload();
  await expect(switcher).toHaveValue(second.pack.id);
  await switcher.selectOption(pack.pack.id);
  await expect(card.getByRole("button", { name: "取消收藏" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
});

// The private full pack is supplied by the local content verification command.
// Public platform CI always runs the synthetic compatibility test above.
test("full interview library imports and works on desktop and mobile", async ({ page }, testInfo) => {
  test.skip(!process.env.INTERVIEW_PACK_PATH, "Set INTERVIEW_PACK_PATH to the private authored pack for delivery acceptance.");
  test.setTimeout(90_000);
  const text = await readFile(process.env.INTERVIEW_PACK_PATH!, "utf8");
  const pack = JSON.parse(text);
  expect(pack.questions).toHaveLength(150);
  expect(pack.chapters).toHaveLength(20);
  await importText(page, text, "interview-coding-150-1.0.0.json");
  await expect(page.locator(".curriculum-title")).toContainText("150 题");
  await expect(page.locator(".source-page")).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "搜索题库" });
  await search.fill("两数之和");
  const algorithm = page.locator('[id="question-1.1.1"]');
  await expect(algorithm).toBeVisible();
  await algorithm.getByRole("button", { name: "揭示答案" }).click();
  await expect(algorithm.locator(".answer-panel code.language-cpp")).toContainText("main");
  await expect(algorithm.locator(".answer-panel code.language-python")).toContainText("__main__");
  await algorithm.getByRole("button", { name: "拓展与追问" }).click();
  await expect(algorithm.locator('.reference-list a[href="https://leetcode.com/problems/two-sum/"]')).toBeVisible();
  await algorithm.getByRole("button", { name: "收藏题目" }).click();
  await algorithm.getByRole("button", { name: "待复习", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("full-pack-algorithm.png"), fullPage: false });

  await search.fill("SPSC");
  const systems = page.locator('[id="question-15.1.5"]');
  await expect(systems).toBeVisible();
  await systems.getByRole("button", { name: "揭示答案" }).click();
  await expect(systems.locator(".answer-panel code.language-cpp")).toBeVisible();
  await expect(systems.locator(".answer-panel code.language-python")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("full-pack-systems.png"), fullPage: false });
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  const mobileToggle = page.getByRole("button", { name: "☰ 章节目录" });
  if (testInfo.project.name === "mobile-webkit") await mobileToggle.click();
  await page.getByRole("button", { name: /20.*时间/ }).click();
  if (testInfo.project.name === "mobile-webkit") await expect(mobileToggle).toHaveAttribute("aria-expanded", "false");
  await search.fill("");
  await expect(page.locator(".question-card")).toHaveCount(7);
  await page.screenshot({ path: testInfo.outputPath("full-pack-curriculum.png"), fullPage: false });

  // Reinstall the actual complete file and check the saved state survives.
  await importText(page, text, "interview-reinstall.json");
  await search.fill("两数之和");
  await expect(algorithm.getByRole("button", { name: "取消收藏" })).toHaveAttribute("aria-pressed", "true");
  await expect(algorithm.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);

  // Upgrade a complete in-memory copy; the delivered 1.0.0 file stays untouched.
  pack.pack.version = "1.0.1";
  pack.questions[0].original.prompt += "\n\n完整题库升级测试标记。";
  await importText(page, JSON.stringify(pack), "interview-upgrade-qa.json");
  await search.fill("两数之和");
  await expect(algorithm).toContainText("完整题库升级测试标记");
  await expect(algorithm.getByRole("button", { name: "取消收藏" })).toHaveAttribute("aria-pressed", "true");
  await expect(algorithm.getByRole("button", { name: "待复习", exact: true })).toHaveClass(/active/);
});
