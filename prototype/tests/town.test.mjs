import assert from "node:assert/strict";
import test from "node:test";

import {
  TOWN_BACKUP_KEY,
  TOWN_SAVE_KEY,
  advanceTownDay,
  claimDailyReward,
  createTownState,
  fulfillCommission,
  loadTownState,
  recordClinicShift,
  saveTownState,
  tendGarden,
  upgradeBuilding
} from "../src/town.js";

test("a new town starts with one coherent shared inventory", () => {
  const state = createTownState();
  assert.equal(state.day, 1);
  assert.deepEqual(state.resources, { coins: 90, moonleaf: 1, timber: 2, starlight: 0 });
  assert.deepEqual(state.buildings, { clinic: 1, garden: 1, workshop: 1 });
});

test("the garden can be harvested only once each town day", () => {
  const first = tendGarden(createTownState());
  assert.equal(first.ok, true);
  assert.equal(first.state.resources.moonleaf, 4);
  assert.equal(first.state.daily.garden, true);
  assert.equal(tendGarden(first.state).ok, false);
});

test("a resident commission spends leaves and feeds the shared economy", () => {
  const harvested = tendGarden(createTownState()).state;
  const delivered = fulfillCommission(harvested);
  assert.equal(delivered.ok, true);
  assert.equal(delivered.state.resources.moonleaf, 1);
  assert.equal(delivered.state.resources.coins, 125);
  assert.equal(delivered.state.resources.timber, 3);
  assert.equal(delivered.state.daily.commission, true);
});

test("a clinic shift rewards the town exactly once", () => {
  const state = createTownState();
  const first = recordClinicShift(state, { id: "shift-a", served: 3, stars: 2, score: 900 });
  const duplicate = recordClinicShift(first.state, { id: "shift-a", served: 3, stars: 2, score: 900 });
  assert.equal(first.ok, true);
  assert.equal(first.state.daily.clinic, true);
  assert.equal(first.delta.coins, 44);
  assert.equal(first.delta.starlight, 1);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.state.resources, first.state.resources);
});

test("three daily wishes unlock a reward and the next player-controlled day", () => {
  let state = tendGarden(createTownState()).state;
  state = fulfillCommission(state).state;
  state = recordClinicShift(state, { id: "shift-day-one", served: 1, stars: 1 }).state;

  const reward = claimDailyReward(state);
  assert.equal(reward.ok, true);
  assert.equal(reward.state.daily.rewardClaimed, true);

  const nextDay = advanceTownDay(reward.state);
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.state.day, 2);
  assert.equal(nextDay.state.daily.garden, false);
  assert.equal(nextDay.state.daily.commission, false);
  assert.equal(nextDay.state.daily.clinic, false);
});

test("building upgrades spend resources and permanently change their level", () => {
  const state = createTownState();
  const upgraded = upgradeBuilding(state, "garden");
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.state.buildings.garden, 2);
  assert.equal(upgraded.state.resources.coins, 0);
  assert.equal(upgraded.state.resources.timber, 0);
  assert.equal(upgraded.state.restoration, 2);
  assert.equal(state.buildings.garden, 1, "the original state stays immutable");
});

test("town saves round-trip and malformed saves fall back safely", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
  };
  const state = tendGarden(createTownState()).state;
  assert.equal(saveTownState(state, storage), true);
  assert.equal(loadTownState(storage).resources.moonleaf, 4);

  memory.set(TOWN_SAVE_KEY, "{broken");
  assert.deepEqual(loadTownState(storage), createTownState());
  assert.equal(saveTownState(createTownState(), storage), true);
  assert.equal(memory.get(TOWN_BACKUP_KEY), "{broken", "the unreadable payload is preserved before replacement");
});
