import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("actual360 HTTP reference opens an isolated tab at the exact source URL", async ({ page, context }, testInfo) => {
  const path = process.env.HTTP_REFERENCE_OLD_PACK ?? process.env.INTERVIEW_GUIDE_PACK_PATH;
  test.skip(!path, "需要显式指定冻结的360题包");
  const bytes = await readFile(path!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("8e1f4a280030083c6ea8738b0f18154d0df67602d378c796be2a42ca16c4ac84");
  const pack = JSON.parse(bytes.toString("utf8"));
  const question = pack.questions.find((q: { id: string }) => q.id === "10.1.23");
  const reference = question.revision.references.find((r: { url: string }) => r.url.startsWith("http://"));
  expect(reference.url).toBe("http://joschu.net/blog/kl-approx.html");
  // This checks browser navigation/target/opener semantics with a deterministic
  // intercepted response; it does not assert remote availability or source text.
  await context.route(reference.url, route => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8",
    body: "<!doctype html><p id='navigation-fixture'>intercepted HTTP navigation fixture</p>"
  }));
  await page.goto("/#/packs");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "guide360.json", mimeType: "application/json", buffer: bytes
  });
  await expect(page.getByRole("status")).toContainText("共 360 题", { timeout: 15_000 });
  await page.goto(`/#/study?pack=${encodeURIComponent(pack.pack.id)}&question=10.1.23`);
  const originalUrl = page.url();
  const card = page.locator(".question-card");
  await expect(card).toContainText(question.original.prompt);
  await card.getByRole("button", { name: "拓展与追问" }).click();
  const link = card.locator(".reference-list").getByRole("link", { name: reference.title, exact: true });
  await expect(link).toHaveAttribute("href", reference.url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /\bnoopener\b/);
  await page.screenshot({ path: testInfo.outputPath("guide-http-reference.png"), fullPage: true });
  const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await expect(popup).toHaveURL(reference.url);
  await expect(popup.locator("#navigation-fixture")).toHaveText("intercepted HTTP navigation fixture");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page).toHaveURL(originalUrl);
  await popup.close();
});
