import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
// A fresh local database for every test run, outside the repository.
const database = `file:${join(tmpdir(), `agent-creations-e2e-${process.pid}-${Date.now()}.db`)}`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "corepack pnpm --filter @agents/web exec next dev --hostname 127.0.0.1 --port 3100",
    env: { NEXT_DIST_DIR: ".next-e2e", TURSO_DATABASE_URL: database, GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
