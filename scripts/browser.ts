import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const bundle = await build({
  entryPoints: ["scripts/browser-entry.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "RDLSmoke",
  write: false,
  target: "es2022",
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = await page.evaluate("RDLSmoke.run()");
  assert.deepEqual(result, { roots: 1, passed: true });
  console.log(
    `Chromium browser analysis/edit/save passed; bundle ${bundle.outputFiles[0]!.contents.length} bytes.`,
  );
} finally {
  await browser.close();
}
