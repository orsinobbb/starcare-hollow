import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPEDITION_FOCUS_MAX,
  EXPEDITION_FOCUS_REGEN_INTERVAL_MS,
  canEnterDoor,
  canExcavate,
  compassClue,
  createExpeditionState,
  enterDoor,
  excavate,
  normalizeExpeditionState,
  recoverExpeditionFocus,
  regionAt,
  tileKey,
  visibilityAt
} from "../src/expedition-engine.js";

function sandPath(state, target) {
  let x = 0;
  let y = 0;
  const route = [];
  while (x !== target.x) {
    x += Math.sign(target.x - x);
    state.terrain[tileKey(x, y)] = "sand";
    route.push({ x, y });
  }
  while (y !== target.y) {
    y += Math.sign(target.y - y);
    state.terrain[tileKey(x, y)] = "sand";
    route.push({ x, y });
  }
  return route;
}

test("a seeded expedition always restores the same terrain and treasure placement", () => {
  const first = createExpeditionState("starsand-test");
  const second = createExpeditionState("starsand-test");
  assert.deepEqual(first.terrain, second.terrain);
  assert.deepEqual(first.targets, second.targets);
  assert.equal(first.focus, EXPEDITION_FOCUS_MAX);
  assert.deepEqual(first.revealed, ["0,0"]);
});

test("excavation is adjacency-gated and pays terrain focus only after a legal move", () => {
  const state = createExpeditionState("adjacent-test");
  assert.equal(canExcavate(state, 3, 3).ok, false);
  const permitted = canExcavate(state, 1, 0);
  assert.equal(permitted.ok, true);
  const result = excavate(state, 1, 0);
  assert.equal(result.ok, true);
  assert.equal(result.state.revealed.includes("1,0"), true);
  assert.equal(result.state.focus, EXPEDITION_FOCUS_MAX - permitted.terrain.cost);
  assert.equal(state.revealed.includes("1,0"), false, "the input state remains immutable");
  assert.deepEqual(result.event.reward, { coins: 4 }, "every ordinary grid gives a visible terrain reward");
});

test("focus recovers by real elapsed time, including time spent away from the island", () => {
  const state = createExpeditionState("rest-test", 1_000);
  state.focus = 26;
  state.focusUpdatedAt = 1_000;

  const beforeFirstPoint = recoverExpeditionFocus(state, 1_000 + EXPEDITION_FOCUS_REGEN_INTERVAL_MS - 1);
  assert.equal(beforeFirstPoint.recovered, 0);
  assert.equal(beforeFirstPoint.remainingMs, 1);

  const returned = recoverExpeditionFocus(state, 1_000 + EXPEDITION_FOCUS_REGEN_INTERVAL_MS * 3 + 500);
  assert.equal(returned.recovered, 3);
  assert.equal(returned.state.focus, 29);
  assert.equal(returned.remainingMs, EXPEDITION_FOCUS_REGEN_INTERVAL_MS - 500);
  assert.equal(state.focus, 26, "passive recovery never mutates the saved snapshot in place");
});

test("terrain rewards make every grid materially useful and relic rewards are extra", () => {
  const state = createExpeditionState("terrain-reward-test");
  state.terrain["1,0"] = "vine";
  const vine = excavate(state, 1, 0);
  assert.deepEqual(vine.event.reward, { coins: 6, moonleaf: 1 });

  const relicState = createExpeditionState("relic-reward-test");
  relicState.terrain["1,0"] = "crystal";
  relicState.targets[0] = { ...relicState.targets[0], x: 1, y: 0 };
  const relic = excavate(relicState, 1, 0);
  assert.deepEqual(relic.event.reward, { coins: 27, starlight: 2 }, "the relic adds to, rather than replaces, the grid reward");
});

test("a discovered relic produces a visible clue event and completes only after all targets", () => {
  let state = createExpeditionState("relic-test");
  state.targets = [
    { ...state.targets[0], x: 2, y: 0 },
    { ...state.targets[1], x: 7, y: 7 },
    { ...state.targets[2], x: 6, y: 7 }
  ];
  const target = state.targets[0];
  const route = sandPath(state, target);
  let lastEvent = null;
  for (const tile of route) {
    const result = excavate(state, tile.x, tile.y);
    assert.equal(result.ok, true);
    state = result.state;
    lastEvent = result.event;
  }
  assert.ok(state.foundTargetIds.includes(target.id));
  assert.equal(lastEvent.type, "discovery");
  assert.equal(lastEvent.discovery.id, target.id);
  assert.equal(state.completed, false);
  assert.equal(compassClue(state, target.x, target.y).level === "complete", false);
});

test("malformed expedition snapshots normalize to a safe playable map", () => {
  const migrated = normalizeExpeditionState({
    schemaVersion: 1,
    seed: "saved-map",
    focus: 999,
    terrain: { "0,0": "not-a-terrain" },
    revealed: ["0,0", "nope", "99,99"],
    foundTargetIds: ["unknown"]
  });
  assert.equal(migrated.focus, EXPEDITION_FOCUS_MAX);
  assert.deepEqual(migrated.revealed, ["0,0"]);
  assert.equal(migrated.foundTargetIds.length, 0);
  assert.equal(migrated.targets.length, 3);
});

test("a v1 save retains earned progress while adopting the coherent island geography", () => {
  const legacy = createExpeditionState("old-island");
  legacy.schemaVersion = 1;
  legacy.focus = 12;
  legacy.digs = 5;
  legacy.terrain["1,0"] = "crystal";
  legacy.revealed = ["0,0", "1,0", "1,1"];
  legacy.foundTargetIds = ["tide-shell"];

  const migrated = normalizeExpeditionState(legacy);

  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.focus, 12);
  assert.equal(migrated.digs, 5);
  assert.deepEqual(migrated.revealed, ["0,0", "1,0", "1,1"]);
  assert.deepEqual(migrated.foundTargetIds, ["tide-shell"]);
  assert.equal(migrated.terrain["1,0"], "sand", "old shuffled terrain becomes one continuous shore");
  assert.equal(regionAt(migrated, 3, 3).id, "grove");
  assert.equal(regionAt(migrated, 6, 3).id, "ridge");
});

test("keys open permanent doors and each mine floor keeps its own exploration progress", () => {
  let state = createExpeditionState("three-floor-route");
  const route = ["1,0", "2,0", "3,0", "4,0", "5,0", "6,0", "6,1"];
  state.revealed.push(...route);
  state.mapProgress["starfall-shaft"].revealed = [...state.revealed];
  state.focus = 30;

  const keyResult = excavate(state, 6, 2);
  assert.equal(keyResult.ok, true);
  assert.equal(keyResult.event.type, "key");
  assert.ok(keyResult.state.collectedKeyIds.includes("moonvine-key"));

  state = keyResult.state;
  state.revealed.push("6,3", "6,4");
  state.mapProgress["starfall-shaft"].revealed = [...state.revealed];
  assert.equal(canEnterDoor(state, 7, 4).ok, true);

  const entered = enterDoor(state, 7, 4);
  assert.equal(entered.ok, true);
  assert.equal(entered.state.activeMapId, "moonvine-gallery");
  assert.deepEqual(entered.state.revealed, ["0,0"]);
  assert.ok(entered.state.unlockedDoorIds.includes("moonvine-gate"));
  assert.ok(entered.state.mapProgress["starfall-shaft"].revealed.includes("6,2"));

  const returned = enterDoor(entered.state, 0, 0);
  assert.equal(returned.ok, true);
  assert.equal(returned.state.activeMapId, "starfall-shaft");
  assert.ok(returned.state.revealed.includes("6,2"));
});

test("a locked gate explains the missing key and exploration visibility has four clear states", () => {
  const state = createExpeditionState("visibility-layers");
  state.revealed.push("1,0", "6,4");
  state.mapProgress["starfall-shaft"].revealed = [...state.revealed];
  state.currentRunRevealed = ["1,0"];

  const locked = canEnterDoor(state, 7, 4);
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "key");
  assert.match(locked.message, /月藤鑰匙/);
  assert.equal(visibilityAt(state, 1, 0), "current");
  assert.equal(visibilityAt(state, 0, 0), "explored");
  assert.equal(visibilityAt(state, 2, 0), "shadow");
  assert.equal(visibilityAt(state, 7, 7), "dark");
});
