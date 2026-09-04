import { expect, test } from "@playwright/test";

test("installs a local pack and keeps it available offline", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit on Windows cannot reliably reload while context offline");
  await page.goto("/");
  await page.getByRole("link", { name: "导入第一个题库" }).click();
  await page.getByRole("button", { name: "安装合成示例" }).click();
  await expect(page.getByRole("status")).toContainText("已安装");
  await page.getByRole("link", { name: "学习", exact: true }).click();
  await expect(page.getByText("为什么只重复阅读通常不如主动回忆有效？")).toBeVisible();
  await page.getByRole("button", { name: "揭示答案" }).first().click();
  await expect(page.getByText("参考答案").first()).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("为什么只重复阅读通常不如主动回忆有效？")).toBeVisible();
});
