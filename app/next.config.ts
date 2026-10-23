import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";

// `pnpm demo --lan` serves the app on every interface; Next's dev server only answers other hosts it's told about.
const lanIps =
  process.env.ONEUP_HOST === "0.0.0.0"
    ? Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => i!.address)
        // binding to every interface makes Next treat loopback as cross-origin too
        .concat(["127.0.0.1", "localhost"])
    : [];

// Next adds generated-type paths to its tsconfig. Keep isolated runs from editing the ordinary app config.
const isolatedTsconfig = process.env.ONEUP_NEXT_DIST ? `.oneup-tsconfig-${process.env.ONEUP_NEXT_DIST.replaceAll(".", "")}.json` : "tsconfig.json";
if (process.env.ONEUP_NEXT_DIST) {
  const base = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  base.include = ["next-env.d.ts", "src", `${process.env.ONEUP_NEXT_DIST}/types/**/*.ts`, `${process.env.ONEUP_NEXT_DIST}/dev/types/**/*.ts`];
  writeFileSync(isolatedTsconfig, JSON.stringify(base, null, 2));
}
const config: NextConfig = {
  typescript: { tsconfigPath: isolatedTsconfig },
  distDir: process.env.ONEUP_NEXT_DIST ?? ".next",
  transpilePackages: ["@oneup/sdk"],
  agentRules: false,
  allowedDevOrigins: lanIps,
  // the floating dev badge covers content on a phone and shows up in demo recordings
  devIndicators: false,
};

export default config;
