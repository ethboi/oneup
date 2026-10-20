import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@oneup/sdk"],
  agentRules: false,
};

export default config;
