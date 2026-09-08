import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTION_ITEMS,
  TOWN_BACKUP_KEY,
  TOWN_SAVE_KEY,
  TOWN_SCHEMA_VERSION,
  advanceTownDay,
  claimDailyReward,
  createTownState,
  fulfillCommission,
  loadTownState,
  recordClinicShift,
  recordExpeditionProgress,
  saveTownState,
  tendGarden,
  upgradeBuilding
} from "../src/town.js";
import { excavate } from "../src/expedition-engine.js";

test("a new town starts with one coherent shared inventory", () => {
  const state = createTownState();
  assert.equal(state.day, 1);
  assert.deepEqual(state.resources, { coins: 90, moonleaf: 1, timber: 2, starlight: 0 });
  assert.deepEqual(state.buildings, { clinic: 1, garden: 1, workshop: 1 });
  assert.deepEqual(state.collections.unlocked, ["founders-mark"]);
});

test("town actions unlock permanent collectibles rather than only currencies", () => {
  let state = createTownState();
  const harvest = tendGarden(state);
  assert.deepEqual(harvest.delta.collectionIds, ["moonleaf-pressing"]);
  state = harvest.state;

  const commission = fulfillCommission(state);
  assert.deepEqual(commission.delta.collectionIds, ["tobis-whistle"]);
  state = commission.state;

  const shift = recordClinicShift(state, { id: "collection-shift", completed: 1, matched: 4, stars: 1, skillUses: 1 });
  assert.deepEqual(shift.delta.collectionIds, ["clinic-badge", "companion-charm"]);
  state = shift.state;

  const upgrade = upgradeBuilding(state, "garden");
  assert.deepEqual(upgrade.delta.collectionIds, ["restorer-pin"]);
  state = upgrade.state;

  const reward = claimDailyReward(state);
  assert.deepEqual(reward.delta.collectionIds, ["three-wish-medal", "lantern-keepsake"]);
  assert.equal(reward.state.collections.unlocked.length, COLLECTION_ITEMS.length - 2);
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

test("a mini-game session rewards the town exactly once", () => {
  const state = createTownState();
  const first = recordClinicShift(state, { id: "shift-a", completed: 3, matched: 15, stars: 2, score: 900 });
  const duplicate = recordClinicShift(first.state, { id: "shift-a", completed: 3, matched: 15, stars: 2, score: 900 });
  assert.equal(first.ok, true);
  assert.equal(first.state.daily.clinic, true);
  assert.equal(first.delta.coins, 62);
  assert.equal(first.delta.starlight, 1);
  assert.equal(first.state.lifetime.pairsMatched, 15);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.state.resources, first.state.resources);
});

test("using a companion skill becomes permanent collection progress", () => {
  const result = recordClinicShift(createTownState(), {
    id: "skill-shift",
    completed: 1,
    matched: 4,
    stars: 1,
    skillUses: 2
  });
  assert.equal(result.state.lifetime.skillUses, 2);
  assert.ok(result.state.collections.unlocked.includes("companion-charm"));
  assert.equal(result.delta.skillUses, 2);
});

test("three daily wishes unlock a reward and the next player-controlled day", () => {
  let state = tendGarden(createTownState()).state;
  state = fulfillCommission(state).state;
  state = recordClinicShift(state, { id: "shift-day-one", completed: 1, matched: 4, stars: 1 }).state;

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

test("an expedition discovery persists with the town and becomes permanent collection progress", () => {
  const town = createTownState();
  const expedition = structuredClone(town.expedition);
  const firstTarget = expedition.targets[0];
  firstTarget.x = 1;
  firstTarget.y = 0;
  expedition.terrain["1,0"] = "sand";
  const excavation = excavate(expedition, 1, 0);
  const result = recordExpeditionProgress(town, excavation.state, excavation.event);

  assert.equal(result.ok, true);
  assert.equal(result.state.lifetime.expeditionDigs, 1);
  assert.equal(result.state.lifetime.relicsFound, 1);
  assert.equal(result.state.resources.coins, 108);
  assert.equal(result.state.resources.starlight, 1);
  assert.ok(result.state.collections.unlocked.includes("starsand-compass"));
  assert.equal(town.expedition.foundTargetIds.length, 0, "the previous town snapshot stays immutable");
});

test("schema v1 saves migrate without losing progress and infer collectibles", () => {
  const legacy = createTownState();
  legacy.schemaVersion = 1;
  legacy.restoration = 12;
  legacy.lifetime.harvests = 3;
  legacy.lifetime.shifts = 2;
  delete legacy.lifetime.dailyRewards;
  delete legacy.lifetime.skillUses;
  delete legacy.lifetime.pairsMatched;
  delete legacy.lifetime.expeditionDigs;
  delete legacy.lifetime.relicsFound;
  delete legacy.lifetime.completedExpeditions;
  delete legacy.collections;
  delete legacy.expedition;

  const payload = JSON.stringify({ schemaVersion: 1, gameVersion: "0.2.0", profile: legacy });
  const storage = { getItem: () => payload, setItem: () => {} };
  const migrated = loadTownState(storage);

  assert.equal(migrated.schemaVersion, TOWN_SCHEMA_VERSION);
  assert.equal(migrated.restoration, 12);
  assert.equal(migrated.lifetime.dailyRewards, 0);
  assert.equal(migrated.lifetime.skillUses, 0);
  assert.equal(migrated.lifetime.pairsMatched, 0);
  assert.equal(migrated.lifetime.expeditionDigs, 0);
  assert.equal(migrated.expedition.revealed.includes("0,0"), true);
  assert.ok(migrated.collections.unlocked.includes("moonleaf-pressing"));
  assert.ok(migrated.collections.unlocked.includes("clinic-badge"));
  assert.ok(migrated.collections.unlocked.includes("lantern-keepsake"));
});
