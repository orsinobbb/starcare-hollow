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

test("clinic ships resident selection, station dispatch, and player-chosen skills", async () => {
  const html = await readFile(new URL("index.html", siteRootUrl), "utf8");
  const css = await readFile(new URL("styles.css", siteRootUrl), "utf8");
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");

  assert.match(html, /id="patient-list"/);
  assert.match(html, /id="selected-visit"/);
  assert.match(html, /id="station-list"/);
  assert.match(html, /id="skill-list"/);
  assert.doesNotMatch(html, /id="task-board"/);
  assert.match(css, /\.care-workspace/);
  assert.match(css, /\.station-action/);
  assert.match(css, /\.skill-card\.is-ready/);
  assert.match(app, /function serviceSelectedPatient/);
  assert.match(app, /function activateSkill/);
});

test("clinic uses ordinary buttons so the page remains scrollable on touch screens", async () => {
  const app = await readFile(new URL("src/app.js", siteRootUrl), "utf8");
  assert.match(app, /data-station-type/);
  assert.match(app, /data-skill-id/);
  assert.doesNotMatch(app, /pointerdown|pointermove|touchmove|preventDefault/);
});
