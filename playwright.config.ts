import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:41731",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 41731 --strictPort",
    url: "http://127.0.0.1:41731",
    reuseExistingServer: false
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 14"] } }
  ]
});
