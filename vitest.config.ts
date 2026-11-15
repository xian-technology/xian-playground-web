import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The sibling WebAssembly packages (@xian-tech/compiler, @xian-tech/vm) live
// outside this repo. In node-environment tests they stay external (Node >= 24
// imports .wasm natively); DOM tests load them through Vite, which must be
// allowed to read them.
const siblings = ["@xian-tech/compiler", "@xian-tech/vm"].map((name) =>
  realpathSync(fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url))),
);

export default defineConfig({
  server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), ...siblings] } },
  resolve: {
    // From the working directory, not this file: mutation tools run the suite
    // in a symlinked copy of the repo whose config resolves to the original.
    alias: { "@": join(process.cwd(), "src") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/components/playground/**/*.ts", "src/components/playground/**/*.tsx"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
