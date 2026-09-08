import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APP_VERSION, SAVE_SCHEMA_VERSION } from "../src/version.js";
import { TOWN_GAME_VERSION, TOWN_SAVE_KEY, TOWN_SCHEMA_VERSION } from "../src/town.js";

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
  assert.equal(TOWN_GAME_VERSION, APP_VERSION);
  assert.equal(TOWN_SCHEMA_VERSION, SAVE_SCHEMA_VERSION);
  assert.equal(Number.isInteger(SAVE_SCHEMA_VERSION), true);
  assert.ok(SAVE_SCHEMA_VERSION >= 1);
});

test("town shell, controller, and versioned save contract ship together", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(html, /id="town-view"/);
  assert.match(html, /id="clinic-view"/);
  assert.match(html, /id="town-map"/);
  assert.match(html, /id="town-wish-list"/);
  assert.match(html, /id="town-collection-grid"/);
  assert.match(app, /createTownController/);
  assert.match(app, /townController\?\.recordShift/);
  assert.match(TOWN_SAVE_KEY, /:v1$/);
});

test("game house ships three short-game modes and player-chosen skills", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(html, /id="game-board"/);
  assert.match(html, /id="collection-tray"/);
  assert.match(html, /name="game-mode" value="memory"/);
  assert.match(html, /name="game-mode" value="quick-pair"/);
  assert.match(html, /name="game-mode" value="triple-pack"/);
  assert.match(html, /id="skill-list"/);
  assert.doesNotMatch(html, /id="task-board"/);
  assert.doesNotMatch(html, /id="patient-list"|id="station-list"/);
  assert.match(css, /\.minigame-workspace/);
  assert.match(css, /\.match-card/);
  assert.match(css, /assets\/card-companions-v1\.jpg/);
  assert.match(css, /\.collection-tray/);
  assert.match(css, /\.skill-card\.is-ready/);
  assert.match(app, /function handleCard/);
  assert.match(app, /function handleTripleCard/);
  assert.match(app, /function activateSkill/);
  await access(new URL("assets/card-companions-v1.jpg", siteRootUrl));
});

test("clinic uses ordinary buttons so the page remains scrollable on touch screens", async () => {
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");
  assert.match(app, /data-card-id/);
  assert.match(app, /data-skill-id/);
  assert.doesNotMatch(app, /pointerdown|pointermove|touchmove|preventDefault/);
});

test("zoom reflows without disabling accessibility and matches celebrate before removal", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container\s*\(max-width:\s*360px\)/);
  assert.match(css, /minmax\(44px,\s*1fr\)/);
  assert.match(css, /\.match-card\.is-match-success/);
  assert.match(css, /@keyframes\s+matched-card-exit/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.match-card\.is-match-success/);
  assert.match(app, /MATCH_CELEBRATION_SECONDS/);
  assert.match(app, /beginPairCelebration/);
  assert.match(app, /配對成功：/);
});
