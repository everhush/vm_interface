import { defineConfig } from "vite-plus";
import vinext from "vinext";

export default defineConfig({
  plugins: process.env.VITEST ? [] : [vinext()],
  test: {
    include: ["tests/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
  lint: {
    ignorePatterns: ["dist/**", ".vinext/**", ".next/**", "node_modules/**", ".output/**", "evidence/**"],
    options: { typeAware: true, typeCheck: true },
    rules: { "no-unused-vars": "error", "typescript/no-explicit-any": "error" },
  },
  fmt: {
    ignorePatterns: ["dist/**", ".vinext/**", ".next/**", "node_modules/**", ".output/**", "evidence/**", "package-lock.json", "docs/**", "LICENSE", "NOTICE", "CHANGELOG.md", "showcases/**"],
    sortPackageJson: false,
  },
});
