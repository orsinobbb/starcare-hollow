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

test("the installable game identity ships with local icons and an update-safe service worker", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", siteRootUrl), "utf8"));
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");
  const serviceWorker = await readFile(new URL("sw.js", siteRootUrl), "utf8");

  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/assets\/icons\/apple-touch-icon\.png"/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.icons.some((icon) => icon.purpose === "maskable"), true);
  await Promise.all(manifest.icons.map((icon) => access(new URL(icon.src, siteRootUrl))));
  await access(new URL("assets/icons/apple-touch-icon.png", siteRootUrl));
  await access(new URL("assets/icons/favicon-32.png", siteRootUrl));
  assert.match(app, /navigator\.serviceWorker\.register\("\.\/sw\.js"\)/);
  assert.match(serviceWorker, /starcare-shell-v0\.14\.0/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
});

test("town shell, controller, and versioned save contract ship together", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const town = await readFile(new URL("src/town.js", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(html, /id="town-view"/);
  assert.match(html, /id="clinic-view"/);
  assert.match(html, /id="town-map"/);
  assert.match(html, /id="town-wish-list"/);
  assert.match(html, /id="town-collection-grid"/);
  assert.match(html, /id="town-next-quest"/);
  assert.match(html, /id="town-next-action"/);
  assert.match(html, /class="town-loop"/);
  assert.match(html, /現在就做這一件事/);
  assert.match(html, /data-town-place="garden"/);
  assert.match(html, /data-town-place="expedition"/);
  assert.match(html, /移動途中可隨時改道/);
  assert.match(css, /\.town-building\.is-next/);
  assert.match(css, /@keyframes\s+town-next-pulse/);
  assert.match(town, /export function nextTownQuest/);
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

test("the immersive town dock cannot inherit a mobile top edge and stretch across the screen", async () => {
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");

  assert.match(css, /html body\[data-view="town"\] \.world-nav \{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*auto;[\s\S]*?bottom:/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?html body\[data-view="town"\] \.world-nav \{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*76px;/);
  assert.match(css, /html body\[data-view="town"\] \.save-status \{ display:\s*none; \}/);
});

test("town landmarks keep a stable touch target while guidance glow animates separately", async () => {
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");

  assert.match(css, /\.town-place-hitbox\s*\{[\s\S]*?touch-action:\s*manipulation/);
  assert.match(css, /\.town-building:not\(\.is-open\):hover\s*\{[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(css, /\.town-building\.is-next:not\(\.is-open\)\s*\{\s*animation:\s*none/);
  assert.match(css, /\.town-building\.is-next:not\(\.is-open\)::before\s*\{\s*animation:\s*town-landmark-glow/);
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
  assert.match(html, /id="expedition-mission"/);
  assert.match(html, /id="expedition-mission-toggle"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="expedition-mission-details"[^>]*hidden/);
  assert.match(html, /id="expedition-objective-title"/);
  assert.match(html, /id="expedition-tutorial"[^>]*role="dialog"/);
  assert.match(html, /id="expedition-tutorial-start"/);
  assert.match(html, /id="expedition-help"/);
  assert.match(html, /id="expedition-player-level"/);
  assert.match(html, /id="expedition-player-focus-bar"/);
  assert.match(html, /id="expedition-open-bag"/);
  assert.match(html, /id="expedition-bag-panel"[^>]*role="dialog"/);
  assert.match(html, /id="expedition-open-collection"/);
  assert.match(html, /id="expedition-collection-panel"[^>]*role="dialog"/);
  assert.match(html, /id="expedition-complete-overlay"[^>]*role="dialog"/);
  assert.match(html, /id="town-tutorial"[^>]*role="dialog"/);
  assert.match(css, /#expedition-canvas[\s\S]*touch-action:\s*none/);
  assert.match(css, /#expedition-canvas[\s\S]*height:\s*clamp/);
  assert.match(app, /createExpeditionController/);
  assert.match(renderer, /devicePixelRatio/);
  assert.match(renderer, /FIXED_STEP_SECONDS/);
  assert.match(renderer, /MAX_PARTICLES/);
  assert.match(renderer, /EXCAVATION_TIMELINE/);
  assert.match(renderer, /playExcavation/);
  assert.match(renderer, /excavationTimer/);
  assert.match(renderer, /drawMiner/);
  assert.match(renderer, /requestMovement/);
  assert.match(renderer, /drawMovementTarget/);
  assert.match(renderer, /playReaction/);
  assert.match(renderer, /this\.isSelectable\(tile\.x, tile\.y\)/);
  assert.match(renderer, /drawRewardPopup/);
  assert.match(renderer, /drawSpade/);
  assert.match(renderer, /drawExcavationOverlay/);
  assert.match(renderer, /點此挖掘/);
  assert.match(css, /\.expedition-stage/);
  assert.match(css, /@keyframes\s+expedition-stage-impact/);
  assert.match(css, /@keyframes\s+reward-reveal/);
  assert.match(css, /@keyframes\s+loot-to-hud/);
  assert.match(css, /@keyframes\s+complete-crown/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.expedition-stage > span/);
  assert.match(controller, /isAnimating/);
  assert.match(renderer, /rerouting\s*\?\s*"reroute"\s*:\s*"walk"/);
  assert.match(renderer, /stage:\s*"locked"/);
  assert.match(controller, /requestExcavate/);
  assert.match(controller, /onMove/);
  assert.match(controller, /輕觸空地可移動/);
  assert.match(controller, /成果已入帳 · 可點另一個發光星標預約下一鏟/);
  assert.match(controller, /canQueueNextAction/);
  assert.match(controller, /queuedExcavation/);
  assert.match(controller, /showReward/);
  assert.match(controller, /flyLoot/);
  assert.match(controller, /waitForAnimationSafely/);
  assert.match(controller, /renderer\.finishExcavation/);
  assert.match(controller, /renderer\.finishDoorTransition/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /resupplyExpeditionFocus/);
  assert.match(controller, /月芽暖茶/);
  assert.match(controller, /renderMission/);
  assert.match(controller, /nextPlayableTarget/);
  const excavationFlow = controller.match(/async function beginExcavation[\s\S]*?\n  function requestExcavate/)?.[0] ?? "";
  assert.doesNotMatch(excavationFlow, /renderer\.guideToTile\(/, "成果入袋後不得自動移動鏡頭");
  assert.match(controller, /鏡頭穩定原則：成果入袋只能更新 HUD 與提示/);
  assert.match(html, /成果入袋只更新背包與提示，不會拉走鏡頭/);
  assert.match(controller, /starcare-expedition-tutorial-v1/);
  assert.match(expedition, /createExpeditionState/);
  assert.match(expedition, /compassClue/);
});
