import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_FAMILIES,
  MINI_GAME_MODES,
  SKILL_CHARGE_MAX,
  addSkillCharge,
  createPairDeck,
  createRng,
  createTripleDeck,
  findAvailableGroup,
  formatTime,
  insertTrayCard,
  isMatchingGroup,
  modeForRound,
  nextCombo,
  resolveTray,
  scoreForMatch,
  shuffle
} from "../src/engine.js";

test("seeded shuffles are deterministic without losing entries", () => {
  const source = [1, 2, 3, 4, 5, 6];
  const first = shuffle(source, createRng("same-town"));
  const second = shuffle(source, createRng("same-town"));
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort((a, b) => a - b), source);
  assert.deepEqual(source, [1, 2, 3, 4, 5, 6]);
});

test("pair deck contains exactly two of every selected cute character", () => {
  const deck = createPairDeck(6, createRng("pair-test"));
  assert.equal(deck.length, 12);
  const counts = Object.groupBy(deck, (card) => card.familyId);
  assert.equal(Object.keys(counts).length, 6);
  assert.ok(Object.values(counts).every((cards) => cards.length === 2));
  assert.ok(deck.every((card) => card.name && card.symbol && card.state === "idle"));
});

test("triple deck contains exactly three of every selected item", () => {
  const deck = createTripleDeck(5, createRng("tray-test"));
  assert.equal(deck.length, 15);
  const counts = Object.groupBy(deck, (card) => card.familyId);
  assert.equal(Object.keys(counts).length, 5);
  assert.ok(Object.values(counts).every((cards) => cards.length === 3));
  assert.ok(Object.keys(counts).every((id) => CARD_FAMILIES.some((family) => family.id === id)));
});

test("matching checks require the requested group size and family", () => {
  const cloud = { familyId: "cloud" };
  const moon = { familyId: "moon" };
  assert.equal(isMatchingGroup([cloud, cloud], 2), true);
  assert.equal(isMatchingGroup([cloud, moon], 2), false);
  assert.equal(isMatchingGroup([cloud, cloud], 3), false);
});

test("available group ignores completed cards", () => {
  const cards = [
    { id: "a1", familyId: "a", state: "matched" },
    { id: "a2", familyId: "a", state: "idle" },
    { id: "b1", familyId: "b", state: "idle" },
    { id: "b2", familyId: "b", state: "idle" }
  ];
  assert.deepEqual(findAvailableGroup(cards, 2), ["b1", "b2"]);
});

test("tray groups matching items together and clears a triple", () => {
  const leaf1 = { id: "l1", familyId: "leaf" };
  const leaf2 = { id: "l2", familyId: "leaf" };
  const leaf3 = { id: "l3", familyId: "leaf" };
  const star = { id: "s1", familyId: "star" };
  let tray = insertTrayCard([leaf1, star], leaf2);
  assert.deepEqual(tray.map((card) => card.id), ["l1", "l2", "s1"]);
  tray = insertTrayCard(tray, leaf3);
  const result = resolveTray(tray);
  assert.equal(result.clearedFamilyId, "leaf");
  assert.deepEqual(result.clearedIds, ["l1", "l2", "l3"]);
  assert.deepEqual(result.tray.map((card) => card.id), ["s1"]);
});

test("rotation visits all mini-game modes in order and fixed choices stay fixed", () => {
  assert.deepEqual([1, 2, 3, 4].map((round) => modeForRound("rotation", round)), [
    "memory",
    "quick-pair",
    "triple-pack",
    "memory"
  ]);
  assert.equal(modeForRound("quick-pair", 3), "quick-pair");
  assert.equal(MINI_GAME_MODES.length, 3);
});

test("combo, score, charge, and clock calculations are bounded", () => {
  assert.equal(nextCombo(3, true), 4);
  assert.equal(nextCombo(3, false), 0);
  assert.ok(scoreForMatch(5, 3) > scoreForMatch(1, 2));
  assert.equal(addSkillCharge(0), 25);
  assert.equal(addSkillCharge(90), SKILL_CHARGE_MAX);
  assert.equal(addSkillCharge(10, -20), 10);
  assert.equal(formatTime(120), "2:00");
  assert.equal(formatTime(9.1), "0:10");
});
