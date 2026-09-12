import assert from "node:assert/strict";
import test from "node:test";

import { canQueueNextAction, createActionResult, createExpeditionActionResult } from "../src/action-result.js";

test("action results expose a committed, immutable presentation contract", () => {
  const result = createActionResult({
    id: "memory:1",
    source: "matching",
    title: "配對成功",
    rewards: [{ id: "starlight", icon: "✧", label: "星光", amount: 2 }],
    canQueueNext: true
  });

  assert.equal(result.committed, true);
  assert.equal(result.presentation.holdMs, 3000);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rewards), true);
  assert.equal(canQueueNextAction("impact", result), false);
  assert.equal(canQueueNextAction("reward", result), true);
  assert.equal(canQueueNextAction("settle", result), true);
});

test("expedition result describes treasure, inventory rewards and collection progress", () => {
  const result = createExpeditionActionResult({
    event: {
      type: "discovery",
      mapId: "fallen-well",
      terrain: { name: "月岩", symbol: "◇" },
      discovery: { name: "星潮杯", icon: "🏺" },
      reward: { coins: 3, starlight: 1 },
      completed: false
    },
    tile: { x: 2, y: 3 },
    digNumber: 7,
    foundCount: 1,
    totalCount: 3,
    resourceMeta: {
      coins: { icon: "✦", label: "星幣" },
      starlight: { icon: "✧", label: "星光" }
    }
  });

  assert.equal(result.kind, "discovery");
  assert.equal(result.title, "發現 星潮杯");
  assert.deepEqual(result.progress, { current: 1, total: 3, label: "主要寶物" });
  assert.deepEqual(result.rewards.map(({ id, amount }) => [id, amount]), [["coins", 3], ["starlight", 1]]);
});
