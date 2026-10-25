import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  // Keep browser-test artifacts separate from a running dev server and builds.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: [
    "@agents/spec",
    "@agents/exporters",
    "@agents/pi-runner",
    "@agents/jev",
  ],
  webpack(config) {
    const imageRule = config.module.rules.find((rule: { test?: RegExp }) =>
      rule.test?.test?.(".svg"),
    );
    if (imageRule) imageRule.exclude = /\.svg$/i;
    config.module.rules.push({
      test: /\.svg$/i,
      use: [
        {
          loader: "@svgr/webpack",
          options: { svgo: false, dimensions: false },
        },
      ],
    });
    return config;
  },
};
export default config;
