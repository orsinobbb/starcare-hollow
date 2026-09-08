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

test("the game keeps a stable viewport and successful pairs celebrate without blocking the next choice", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container\s*\(max-width:\s*360px\)/);
  assert.match(css, /minmax\(44px,\s*1fr\)/);
  assert.match(css, /\.match-card\.is-match-success/);
  assert.match(css, /@keyframes\s+matched-card-exit/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.match-card\.is-match-success/);
  assert.match(app, /MATCH_CELEBRATION_SECONDS/);
  assert.match(app, /successCelebrations/);
  assert.match(app, /beginSuccessCelebration/);
  assert.match(app, /你可以繼續找下一組/);
});

test("the expedition ships a mobile canvas surface with isolated gestures and deterministic state", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");
  const renderer = await readFile(new URL("src/expedition-renderer.js", siteRootUrl), "utf8");
  const controller = await readFile(new URL("src/expedition.js", siteRootUrl), "utf8");
  const expedition = await readFile(new URL("src/expedition-engine.js", siteRootUrl), "utf8");

  assert.match(html, /id="expedition-view"/);
  assert.match(html, /id="expedition-canvas"[^>]*tabindex="0"/);
  assert.match(html, /id="expedition-stage"[^>]*role="status"/);
  assert.match(html, /id="expedition-map-help"/);
  assert.match(html, /id="expedition-queue"/);
  assert.match(html, /id="expedition-resupply"/);
  assert.match(css, /#expedition-canvas[\s\S]*touch-action:\s*none/);
  assert.match(css, /#expedition-canvas[\s\S]*height:\s*clamp/);
  assert.match(app, /createExpeditionController/);
  assert.match(renderer, /devicePixelRatio/);
  assert.match(renderer, /FIXED_STEP_SECONDS/);
  assert.match(renderer, /MAX_PARTICLES/);
  assert.match(renderer, /EXCAVATION_TIMELINE/);
  assert.match(renderer, /playExcavation/);
  assert.match(renderer, /setQueuedTile/);
  assert.match(renderer, /drawMiner/);
  assert.match(renderer, /drawRewardPopup/);
  assert.match(renderer, /drawSpade/);
  assert.match(renderer, /drawExcavationOverlay/);
  assert.match(css, /\.expedition-stage/);
  assert.match(css, /@keyframes\s+expedition-stage-impact/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.expedition-stage > span/);
  assert.match(controller, /isAnimating/);
  assert.match(controller, /queueExcavation/);
  assert.match(controller, /requestExcavate/);
  assert.match(controller, /下一鏟/);
  assert.match(controller, /await renderer\.playExcavation/);
  assert.match(controller, /resupplyExpeditionFocus/);
  assert.match(controller, /月芽暖茶/);
  assert.match(expedition, /createExpeditionState/);
  assert.match(expedition, /compassClue/);
});
