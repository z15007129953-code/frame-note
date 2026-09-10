import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4310",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  timeout: 60000,
});
