import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

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

const config: NextConfig = {
  transpilePackages: ["@oneup/sdk"],
  agentRules: false,
  allowedDevOrigins: lanIps,
  // the floating dev badge covers content on a phone and shows up in demo recordings
  devIndicators: false,
};

export default config;
