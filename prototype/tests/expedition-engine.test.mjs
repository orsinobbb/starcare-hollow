import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPEDITION_FOCUS_MAX,
  canExcavate,
  compassClue,
  createExpeditionState,
  excavate,
  normalizeExpeditionState,
  tileKey
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
