import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APP_VERSION, SAVE_SCHEMA_VERSION } from "../src/version.js";

const siteRootUrl = new URL("../", import.meta.url);
const siteRoot = fileURLToPath(siteRootUrl);

test("every local HTML asset is relative and exists in the Pages artifact", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const references = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !/^(?:#|https?:|data:|mailto:)/.test(reference));

  assert.ok(references.length >= 2, "Expected stylesheet and module references");
  for (const reference of references) {
    assert.ok(!reference.startsWith("/"), `${reference} must not be root-relative`);
    const assetUrl = new URL(reference, siteRootUrl);
    assetUrl.search = "";
    assetUrl.hash = "";
    await access(assetUrl);
  }
});

test("displayed app version stays aligned with package metadata", async () => {
  const packageJson = JSON.parse(await readFile(`${siteRoot}/package.json`, "utf8"));
  assert.equal(APP_VERSION, packageJson.version);
  assert.equal(Number.isInteger(SAVE_SCHEMA_VERSION), true);
  assert.ok(SAVE_SCHEMA_VERSION >= 1);
});

test("touch dragging prevents the task board from scrolling the page", async () => {
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(css, /\.board-wrap\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /html\.is-board-dragging[\s\S]*touch-action:\s*none/);
  assert.match(app, /touchmove", preventBoardTouchScroll, \{ capture: true, passive: false \}/);
  assert.match(app, /setBoardDragLock\(true\)/);
  assert.match(app, /clearPointerDrag\(\)/);
  assert.match(app, /event\.type === "pointercancel"/);
  assert.match(app, /window\.addEventListener\("blur", clearPointerDrag\)/);
});
