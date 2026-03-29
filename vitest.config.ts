import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "tests/mocks/obsidian.ts"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/ui/**", "src/settings/**", "src/obsidian/**", "src/types/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup.ts"],
  },
});
