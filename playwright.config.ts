import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3210);

/**
 * End-to-end tests against the static export (`npm run build` first) with the
 * real compiler and VM WebAssembly.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] },
    },
  ],
  webServer: {
    command: `node scripts/serve-static.mjs out`,
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
