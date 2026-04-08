import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: "50%",
  retries: 0,
  tsconfig: "./tests/tsconfig.json",
  use: {
    // No browser needed — we only use Playwright Test as a runner
  },
});