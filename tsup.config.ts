import { builtinModules } from "node:module";
import { defineConfig } from "tsup";

export default defineConfig({
  // MiniRouter is deployed as a standalone HTTP service. Keep the build entry
  // aligned with the executable that actually exists in this repository.
  entry: ["src/server/serve.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node22",
  splitting: false,
  noExternal: [/^(?!better-sqlite3).*/],
  external: [...builtinModules.flatMap((m) => [m, `node:${m}`]), "better-sqlite3"],
});
