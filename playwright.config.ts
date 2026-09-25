import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: "node dist/index.js --test-dashboard",
    url: "http://127.0.0.1:9100/admin",
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:9100",
    extraHTTPHeaders: { Authorization: "Bearer dev-admin" },
    screenshot: "only-on-failure",
  },
});
