import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: "npm run start:test",
    url: "http://127.0.0.1:9000/admin",
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:9000",
    extraHTTPHeaders: { Authorization: "Bearer dev-admin" },
    screenshot: "only-on-failure",
  },
});
