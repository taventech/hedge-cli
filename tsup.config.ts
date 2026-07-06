import { defineConfig } from "tsup";

// The vendored src/core is local source, so it bundles into the CLI
// automatically. commander stays a normal (public) runtime dependency: it is
// CommonJS and does not bundle cleanly into ESM, and depending on it is standard
// for a CLI. Node builtins stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  external: ["commander"],
  clean: true,
  dts: false,
  sourcemap: false,
});
