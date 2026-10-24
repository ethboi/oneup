// Runs only against the disposable chain created by judge-ci.ts. No traces: local /api/config contains demo keys.
import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const fixturePath = process.env.ONEUP_BROWSER_FIXTURE;
if (!fixturePath || !resolve(fixturePath).includes("/.judge/ci-")) throw Error("Use pnpm test:judge:ci to create a fresh isolated browser fixture.");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.appUrl)) throw Error("Only a loopback judge app may be tested.");
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 180000,
  globalTimeout: 210000,
  expect: { timeout: 30000 },
  reporter: [["list"], ["./reporter.ts"]],
  outputDir: resolve(fixturePath, "../browser-private"),
  use: {
    browserName: "chromium", baseURL: fixture.appUrl,
    viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce",
    trace: "off", video: "off", screenshot: "off",
  },
});
