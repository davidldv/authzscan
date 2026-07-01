import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // Inline the internal workspace packages (@authzscan/*); leave third-party
  // deps (commander, @anthropic-ai/sdk, zod, ts-morph, typescript) external
  // so npm installs them from the published `dependencies`.
  noExternal: [/^@authzscan\//],
  // ts-morph (used by @authzscan/inventory) is CJS and uses dynamic require()
  // for Node built-ins — it cannot be bundled into an ESM output. Keep it
  // (and typescript, which ts-morph/common loads the same way) external.
  external: ["ts-morph", "typescript", "@anthropic-ai/sdk", "zod"],
});
