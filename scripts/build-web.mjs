import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(new URL("../web/vendor/", import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["browser/markdown.mjs", "browser/grid.mjs"],
  outdir: "web/vendor",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
});
await copyFile(
  new URL("../node_modules/tabulator-tables/dist/css/tabulator.min.css", import.meta.url),
  new URL("../web/vendor/grid.css", import.meta.url),
);
