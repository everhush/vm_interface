import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["postgres", "drizzle-orm", "rfb2", "ws"],
  poweredByHeader: false,
};

export default config;
