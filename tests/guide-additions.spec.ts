import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("frozen 360 to repaired 372 keeps records and displays additions and corrected formulas", async ({ page }, testInfo) => {
  const oldPath = process.env.GUIDE_ADDITIONS_OLD_PACK;
  const newPath = process.env.GUIDE_ADDITIONS_NEW_PACK;
  test.skip(!oldPath || !newPath, "需要显式指定冻结的360和372题包");
  test.setTimeout(90_000);
  const oldBytes = await readFile(oldPath!);
  const newBytes = await readFile(newPath!);
  expect(createHash("sha256").update(oldBytes).digest("hex")).toBe("f6514cd4432438e88da9b279543f024349e3265d8c3411ddd0a7f6cfe4473de4");
  expect(createHash("sha256").update(newBytes).digest("hex")).toBe("79edb310d87e51fc2e04582473e25ec76a206266f62a0178032debd7944a9976");
  const before = JSON.parse(oldBytes.toString("utf8"));
  const after = JSON.parse(newBytes.toString("utf8"));
  expect(after.schemaVersion).toBe(1);
  expect(after.pack.id).toBe(before.pack.id);
  expect(before.questions).toHaveLength(360);
  expect(after.questions).toHaveLength(372);
  const oldIds = new Set(before.questions.map((q: { id: string }) => q.id));
  const knowledgeId = (q: { original: { interpretation: string } }): string => q.original.interpretation.match(/条目 ID：([^；]+)/)![1];
  const correctedOld = new Set(["agent-rl-019", "ai-coding-011", "ai-coding-012", "ml-018", "multimodal-005", "multimodal-019"]);
  const seenCorrections: string[] = [];
  for (const old of before.questions) {
    const current = after.questions.find((q: { id: string }) => q.id === old.id);
    expect(current).toBeTruthy();
    if (correctedOld.has(knowledgeId(old))) {
      // Review220 permits only these prose fields; all other payload/identity stays exact.
      const comparable = structuredClone(current);
      if (knowledgeId(old) === "ai-coding-011") comparable.original.prompt = old.original.prompt;
      comparable.original.answer = old.original.answer;
      expect(comparable).toEqual(old);
      seenCorrections.push(knowledgeId(old));
    } else expect(current).toEqual(old);
  }
  expect(new Set(seenCorrections)).toEqual(correctedOld);
  const added = after.questions.filter((q: { id: string }) => !oldIds.has(q.id));
  expect(added).toHaveLength(12);
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
  await upload(page, oldBytes, 360);
  const retained = before.questions[0];
  let card = await open(retained.id);
  await card.getByRole("button", { name: "收藏题目", exact: true }).click();
  await card.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  await upload(page, newBytes, 372);
  card = await open(retained.id);
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "已掌握", exact: true })).toHaveClass(/active/);
  const checkedQuestions = after.questions.filter((q: { id: string; original: { interpretation: string } }) => !oldIds.has(q.id) || correctedOld.has(knowledgeId(q)));
  expect(checkedQuestions).toHaveLength(18);
  const formulaMarkers: Record<string, string[]> = {
    "agent-rl-019": ["r'_t=r_t+β[γΦ(h_{t+1})−Φ(h_t)]"],
    "ai-coding-011": ["[B,Tnew,Hq×D]", "[Hq×D,C]"],
    "ai-coding-012": ["Hq×D"],
    "ai-coding-040": ["sqrt(3)×std", "x×mask/(1-p)", "x×0"],
    "ml-018": ["p*=a q/[a q+b(1−q)]"],
    "multimodal-005": ["ᾱ_t=∏_{s=1}^t α_s"],
    "multimodal-019": ["G_ij=∂L/∂S_ij=(P_ij+C_ij−2δ_ij)/(2N)"]
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
    if (!oldIds.has(question.id)) expect(expectedCode.length).toBeGreaterThan(0);
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
  }
  await page.screenshot({ path: testInfo.outputPath("guide-added-answer-and-followups.png"), fullPage: true });
  // Browser-only fixtures; no actual user mastery or personal attempts are recorded.
});
