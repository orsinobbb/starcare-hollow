import { createRng } from "./engine.js";

export const EXPEDITION_SCHEMA_VERSION = 1;
export const EXPEDITION_ID = "starsand-prototype";
export const EXPEDITION_WIDTH = 8;
export const EXPEDITION_HEIGHT = 8;
export const EXPEDITION_FOCUS_MAX = 30;

export const TERRAIN = Object.freeze({
  sand: { id: "sand", name: "星砂", cost: 1, symbol: "·" },
  vine: { id: "vine", name: "月藤", cost: 2, symbol: "⌇" },
  crystal: { id: "crystal", name: "晶岩", cost: 3, symbol: "✧" }
});

const TARGETS = Object.freeze([
  { id: "tide-shell", name: "潮音貝譜", icon: "♬", reward: { coins: 18, starlight: 1 } },
  { id: "cloud-tool", name: "雲航刻尺", icon: "⌁", reward: { coins: 18, starlight: 1 } },
  { id: "echo-vial", name: "古療瓶", icon: "⚗", reward: { coins: 24, starlight: 2 } }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

export function tileKey(x, y) {
  return `${x},${y}`;
}

export function parseTileKey(key) {
  const [x, y] = String(key).split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

export function isInBounds(state, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function terrainFor(rng, x, y) {
  if ((x === 0 && y === 0) || (x === 1 && y === 0) || (x === 0 && y === 1)) return "sand";
  const roll = rng();
  if (roll < 0.16) return "crystal";
  if (roll < 0.42) return "vine";
  return "sand";
}

function chooseTargets(rng, width, height) {
  const choices = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x + y >= 4 && !(x === width - 1 && y === height - 1)) choices.push({ x, y });
    }
  }

  const selected = [];
  for (const target of TARGETS) {
    const safeChoices = choices.filter((tile) => selected.every((chosen) => Math.abs(chosen.x - tile.x) + Math.abs(chosen.y - tile.y) >= 4));
    const pool = safeChoices.length ? safeChoices : choices;
    const index = Math.floor(rng() * pool.length);
    const tile = pool[index];
    selected.push({ ...target, x: tile.x, y: tile.y });
    choices.splice(choices.findIndex((choice) => choice.x === tile.x && choice.y === tile.y), 1);
  }
  return selected;
}

export function createExpeditionState(seed = "starsand-001") {
  const rng = createRng(seed);
  const terrain = {};
  for (let y = 0; y < EXPEDITION_HEIGHT; y += 1) {
    for (let x = 0; x < EXPEDITION_WIDTH; x += 1) terrain[tileKey(x, y)] = terrainFor(rng, x, y);
  }

  return {
    schemaVersion: EXPEDITION_SCHEMA_VERSION,
    id: EXPEDITION_ID,
    seed,
    width: EXPEDITION_WIDTH,
    height: EXPEDITION_HEIGHT,
    focus: EXPEDITION_FOCUS_MAX,
    terrain,
    targets: chooseTargets(rng, EXPEDITION_WIDTH, EXPEDITION_HEIGHT),
    revealed: [tileKey(0, 0)],
    foundTargetIds: [],
    digs: 0,
    completed: false,
    lastClue: {
      level: "silent",
      title: "羅盤待命",
      detail: "從起點相鄰的格子開始調查。",
      distance: null
    }
  };
}

function uniqueTileKeys(keys, width, height) {
  if (!Array.isArray(keys)) return [tileKey(0, 0)];
  const valid = new Set();
  for (const key of keys) {
    const tile = parseTileKey(key);
    if (tile && tile.x >= 0 && tile.x < width && tile.y >= 0 && tile.y < height) valid.add(tileKey(tile.x, tile.y));
  }
  valid.add(tileKey(0, 0));
  return [...valid];
}

export function normalizeExpeditionState(raw) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion > EXPEDITION_SCHEMA_VERSION) return createExpeditionState();
  const fallback = createExpeditionState(typeof raw.seed === "string" ? raw.seed : "starsand-001");
  const terrain = Object.fromEntries(
    Object.keys(fallback.terrain).map((key) => [key, TERRAIN[raw.terrain?.[key]] ? raw.terrain[key] : fallback.terrain[key]])
  );
  const validTargetIds = new Set(fallback.targets.map((target) => target.id));
  const sourceTargets = Array.isArray(raw.targets) && raw.targets.length === fallback.targets.length ? raw.targets : fallback.targets;
  const targets = sourceTargets.map((target, index) => {
    const original = fallback.targets[index];
    const x = integer(target?.x, original.x, 0);
    const y = integer(target?.y, original.y, 0);
    return {
      ...original,
      x: Math.min(fallback.width - 1, x),
      y: Math.min(fallback.height - 1, y)
    };
  });
  const foundTargetIds = Array.isArray(raw.foundTargetIds)
    ? [...new Set(raw.foundTargetIds.filter((id) => validTargetIds.has(id)))].slice(0, targets.length)
    : [];

  return {
    ...fallback,
    focus: Math.min(EXPEDITION_FOCUS_MAX, integer(raw.focus, fallback.focus)),
    terrain,
    targets,
    revealed: uniqueTileKeys(raw.revealed, fallback.width, fallback.height),
    foundTargetIds,
    digs: integer(raw.digs, 0),
    completed: foundTargetIds.length >= targets.length || Boolean(raw.completed),
    lastClue: raw.lastClue && typeof raw.lastClue === "object"
      ? {
          level: typeof raw.lastClue.level === "string" ? raw.lastClue.level : fallback.lastClue.level,
          title: typeof raw.lastClue.title === "string" ? raw.lastClue.title : fallback.lastClue.title,
          detail: typeof raw.lastClue.detail === "string" ? raw.lastClue.detail : fallback.lastClue.detail,
          distance: Number.isInteger(raw.lastClue.distance) ? raw.lastClue.distance : null
        }
      : fallback.lastClue
  };
}

export function terrainAt(state, x, y) {
  return TERRAIN[state.terrain[tileKey(x, y)]] ?? TERRAIN.sand;
}

export function isRevealed(state, x, y) {
  return state.revealed.includes(tileKey(x, y));
}

export function isAdjacentToRevealed(state, x, y) {
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ].some(([nextX, nextY]) => isInBounds(state, nextX, nextY) && isRevealed(state, nextX, nextY));
}

export function targetAt(state, x, y) {
  return state.targets.find((target) => target.x === x && target.y === y) ?? null;
}

export function remainingTargets(state) {
  const found = new Set(state.foundTargetIds);
  return state.targets.filter((target) => !found.has(target.id));
}

export function compassClue(state, x, y) {
  const remaining = remainingTargets(state);
  if (!remaining.length) {
    return { level: "complete", title: "星脈已平靜", detail: "這張地圖的三件主要寶物都已找到。", distance: null };
  }
  const distance = Math.min(...remaining.map((target) => Math.max(Math.abs(target.x - x), Math.abs(target.y - y))));
  if (distance === 0) return { level: "found", title: "星光迸發", detail: "你在這裡找到一件主要寶物。", distance };
  if (distance === 1) return { level: "near", title: "就在近旁", detail: "下一件主要寶物在八個相鄰格附近。", distance };
  if (distance === 2) return { level: "strong", title: "強烈共鳴", detail: "保持方向；寶物就在兩格內。", distance };
  if (distance === 3) return { level: "weak", title: "微弱回聲", detail: "這條路有訊號，但還需要再推進。", distance };
  return { level: "silent", title: "一片寂靜", detail: "附近沒有主要寶物，試著改變方向。", distance };
}

export function canExcavate(state, x, y) {
  if (!isInBounds(state, x, y)) return { ok: false, message: "那裡不在這座浮島上。" };
  if (state.completed) return { ok: false, message: "主要寶物都已尋回，這張地圖可以安心保存。" };
  if (isRevealed(state, x, y)) return { ok: false, message: "這一格已經調查過了。" };
  if (!isAdjacentToRevealed(state, x, y)) return { ok: false, message: "只能從已開啟格的上下左右繼續探索。" };
  const terrain = terrainAt(state, x, y);
  if (state.focus < terrain.cost) return { ok: false, reason: "focus", message: `調查${terrain.name}需要 ${terrain.cost} 點專注，目前專注不足。` };
  return { ok: true, terrain };
}

export function excavate(state, x, y) {
  const permission = canExcavate(state, x, y);
  if (!permission.ok) return { ok: false, state, message: permission.message, event: null };

  const next = clone(state);
  const terrain = permission.terrain;
  const key = tileKey(x, y);
  next.focus -= terrain.cost;
  next.revealed.push(key);
  next.digs += 1;

  const target = targetAt(next, x, y);
  let discovery = null;
  if (target && !next.foundTargetIds.includes(target.id)) {
    next.foundTargetIds.push(target.id);
    discovery = target;
  }
  next.completed = next.foundTargetIds.length === next.targets.length;
  next.lastClue = compassClue(next, x, y);

  const message = discovery
    ? `找到「${discovery.name}」！${next.completed ? " 三件主要寶物已全數定位。" : " 羅盤正在指向下一件寶物。"}`
    : `${terrain.name}已翻開：${next.lastClue.title}。`;

  return {
    ok: true,
    state: next,
    message,
    event: {
      type: discovery ? "discovery" : "dig",
      x,
      y,
      terrain,
      discovery,
      clue: next.lastClue,
      completed: next.completed
    }
  };
}

export function refillFocus(state, amount) {
  const next = clone(state);
  const before = next.focus;
  next.focus = Math.min(EXPEDITION_FOCUS_MAX, next.focus + integer(amount, 0));
  return { state: next, gained: next.focus - before };
}
