import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "sample-pack.json"],
      manifest: {
        name: "量化开发自学平台",
        short_name: "量化题库",
        description: "离线优先的量化开发与高性能 C++ 自学平台",
        theme_color: "#0b1821",
        background_color: "#f5f0e7",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,json,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html"
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
    restoreMocks: true
  }
});
