// Deliberately small, credential-free public evidence; never export network traces or storage state.
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourceIdentity } from "../artifacts.ts";
export default class JudgeReporter implements Reporter {
  private tests: { name: string; status: string; durationMs: number }[] = [];
  onTestEnd(test: TestCase, result: TestResult) { this.tests.push({ name: test.titlePath().filter(Boolean).join(" / "), status: result.status, durationMs: result.duration }); }
  onEnd(result: FullResult) {
    const output = process.env.ONEUP_JUDGE_BROWSER_OUTPUT;
    if (!output) throw Error("Missing judge browser output directory");
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, "browser.json"), JSON.stringify({
      source: sourceIdentity(), checkedAt: new Date().toISOString(), scope: "Chromium browser actions plus independent read-only chain assertions",
      status: result.status, durationMs: result.duration, tests: this.tests,
      actions: ["open prepared recovery Life", "switch demo account", "list in UI", "buy in UI", "claim in UI", "refresh ownership", "former-owner UI restrictions"],
      excluded: ["real wallet signature", "public testnet", "organic demand", "unprepared browser trading/liquidation"],
      sensitiveArtifactsOmitted: ["localnet config", "private keys", "browser storage", "network traces"],
    }, null, 2));
  }
}
