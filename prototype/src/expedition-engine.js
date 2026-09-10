export const EXPEDITION_SCHEMA_VERSION = 4;
export const EXPEDITION_ID = "starsand-prototype";
export const EXPEDITION_WIDTH = 8;
export const EXPEDITION_HEIGHT = 8;
export const EXPEDITION_FOCUS_MAX = 30;
export const EXPEDITION_FOCUS_REGEN_INTERVAL_MS = 5 * 60 * 1000;

export const TERRAIN = Object.freeze({
  sand: { id: "sand", name: "星砂淺層", cost: 1, symbol: "·", reward: { coins: 4 } },
  vine: { id: "vine", name: "月藤礦脈", cost: 2, symbol: "⌇", reward: { coins: 6, moonleaf: 1 } },
  crystal: { id: "crystal", name: "星晶岩脈", cost: 3, symbol: "✧", reward: { coins: 9, starlight: 1 } }
});

const TARGETS = Object.freeze([
  { id: "tide-shell", mapId: "starfall-shaft", name: "潮音貝譜", icon: "♬", reward: { coins: 18, starlight: 1 }, x: 3, y: 1 },
  { id: "cloud-tool", mapId: "moonvine-gallery", name: "雲航刻尺", icon: "⌁", reward: { coins: 18, starlight: 1 }, x: 5, y: 4 },
  { id: "echo-vial", mapId: "crystal-sanctum", name: "古療瓶", icon: "⚗", reward: { coins: 24, starlight: 2 }, x: 6, y: 6 }
]);

export const EXPEDITION_MAPS = Object.freeze({
  "starfall-shaft": {
    id: "starfall-shaft", name: "落星礦井", shortName: "第一層", entry: { x: 0, y: 0 },
    key: { id: "moonvine-key", name: "月藤鑰匙", icon: "🔑", x: 6, y: 2 },
    doors: [{ id: "moonvine-gate", name: "月藤石門", x: 7, y: 4, keyId: "moonvine-key", toMapId: "moonvine-gallery" }]
  },
  "moonvine-gallery": {
    id: "moonvine-gallery", name: "月藤迴廊", shortName: "第二層", entry: { x: 0, y: 0 },
    key: { id: "crystal-key", name: "星晶鑰匙", icon: "🔑", x: 6, y: 5 },
    doors: [
      { id: "shaft-return", name: "回程升降梯", x: 0, y: 0, keyId: null, toMapId: "starfall-shaft" },
      { id: "crystal-gate", name: "星晶封門", x: 7, y: 6, keyId: "crystal-key", toMapId: "crystal-sanctum" }
    ]
  },
  "crystal-sanctum": {
    id: "crystal-sanctum", name: "星晶秘庫", shortName: "第三層", entry: { x: 0, y: 0 }, key: null,
    doors: [{ id: "gallery-return", name: "回程星門", x: 0, y: 0, keyId: null, toMapId: "moonvine-gallery" }]
  }
});

export const EXPEDITION_REGIONS = Object.freeze({
  shore: { id: "shore", name: "雲舟礦場", terrain: "sand", landmark: "入口營地" },
  grove: { id: "grove", name: "月藤坑道", terrain: "vine", landmark: "藤根支坑" },
  ridge: { id: "ridge", name: "星晶礦層", terrain: "crystal", landmark: "碎星斷崖" }
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const integer = (value, fallback, minimum = 0) => Number.isFinite(Number(value)) ? Math.max(minimum, Math.floor(Number(value))) : fallback;

function combineRewards(...rewards) {
  const next = {};
  for (const reward of rewards) for (const [resource, amount] of Object.entries(reward ?? {})) {
    const safeAmount = integer(amount, 0);
    if (safeAmount > 0) next[resource] = (next[resource] ?? 0) + safeAmount;
  }
  return next;
}

export function tileKey(x, y) { return `${x},${y}`; }

export function parseTileKey(key) {
  const [x, y] = String(key).split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

export function isInBounds(state, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function regionIdFor(x, y, mapId = "starfall-shaft") {
  if (mapId === "moonvine-gallery") {
    if (x >= 6 || y >= 6) return "ridge";
    if (x >= 2 || y >= 2) return "grove";
    return "shore";
  }
  if (mapId === "crystal-sanctum") return x + y < 3 ? "grove" : "ridge";
  if (x >= 6 || (x >= 5 && y >= 3) || (x === 5 && y === 7)) return "ridge";
  if ((x >= 2 && y >= 2) || (x >= 3 && y === 1) || (x === 1 && y >= 5)) return "grove";
  return "shore";
}

function terrainMap(mapId) {
  const terrain = {};
  for (let y = 0; y < EXPEDITION_HEIGHT; y += 1) for (let x = 0; x < EXPEDITION_WIDTH; x += 1) {
    terrain[tileKey(x, y)] = EXPEDITION_REGIONS[regionIdFor(x, y, mapId)].terrain;
  }
  return terrain;
}

export function activeMap(state) { return EXPEDITION_MAPS[state?.activeMapId] ?? EXPEDITION_MAPS["starfall-shaft"]; }

export function regionAt(state, x, y) {
  if (!isInBounds(state, x, y)) return EXPEDITION_REGIONS.shore;
  const terrainId = state.terrain?.[tileKey(x, y)];
  return Object.values(EXPEDITION_REGIONS).find((region) => region.terrain === terrainId)
    ?? EXPEDITION_REGIONS[regionIdFor(x, y, state.activeMapId)];
}

function uniqueTileKeys(keys) {
  const valid = new Set();
  for (const key of Array.isArray(keys) ? keys : []) {
    const tile = parseTileKey(key);
    if (tile && tile.x >= 0 && tile.x < EXPEDITION_WIDTH && tile.y >= 0 && tile.y < EXPEDITION_HEIGHT) valid.add(tileKey(tile.x, tile.y));
  }
  valid.add(tileKey(0, 0));
  return [...valid];
}

const baseMapProgress = () => Object.fromEntries(Object.keys(EXPEDITION_MAPS).map((mapId) => [mapId, { revealed: [tileKey(0, 0)] }]));

function projectActiveMap(state) {
  const mapId = EXPEDITION_MAPS[state.activeMapId] ? state.activeMapId : "starfall-shaft";
  state.activeMapId = mapId;
  state.width = EXPEDITION_WIDTH;
  state.height = EXPEDITION_HEIGHT;
  state.terrain = terrainMap(mapId);
  // Keep the projected compatibility field independent. This avoids shared
  // references leaking through structured saves while mapProgress remains the
  // source of truth for each floor.
  state.revealed = [...state.mapProgress[mapId].revealed];
  return state;
}

export function createExpeditionState(seed = "starsand-001", now = Date.now()) {
  return projectActiveMap({
    schemaVersion: EXPEDITION_SCHEMA_VERSION, id: EXPEDITION_ID, seed,
    width: EXPEDITION_WIDTH, height: EXPEDITION_HEIGHT,
    focus: EXPEDITION_FOCUS_MAX, focusUpdatedAt: Math.max(0, Math.floor(Number(now) || Date.now())),
    activeMapId: "starfall-shaft", mapProgress: baseMapProgress(), terrain: {}, targets: TARGETS.map((target) => ({ ...target })), revealed: [],
    foundTargetIds: [], collectedKeyIds: [], unlockedDoorIds: [], visitedMapIds: ["starfall-shaft"], digs: 0, completed: false,
    lastClue: { level: "silent", title: "羅盤待命", detail: "從入口營地旁亮起的礦點開始踏查。", distance: null }
  });
}

export function normalizeExpeditionState(raw) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion > EXPEDITION_SCHEMA_VERSION) return createExpeditionState();
  const fallback = createExpeditionState(typeof raw.seed === "string" ? raw.seed : "starsand-001");
  const activeMapId = EXPEDITION_MAPS[raw.activeMapId] ? raw.activeMapId : "starfall-shaft";
  const mapProgress = baseMapProgress();
  for (const mapId of Object.keys(EXPEDITION_MAPS)) {
    const source = raw.schemaVersion >= 4 ? raw.mapProgress?.[mapId]?.revealed : mapId === "starfall-shaft" ? raw.revealed : null;
    mapProgress[mapId].revealed = uniqueTileKeys(source);
  }
  const validTargetIds = new Set(fallback.targets.map((target) => target.id));
  const validKeyIds = new Set(Object.values(EXPEDITION_MAPS).map((map) => map.key?.id).filter(Boolean));
  const validDoorIds = new Set(Object.values(EXPEDITION_MAPS).flatMap((map) => map.doors.map((door) => door.id)));
  const foundTargetIds = Array.isArray(raw.foundTargetIds) ? [...new Set(raw.foundTargetIds.filter((id) => validTargetIds.has(id)))] : [];
  const collectedKeyIds = new Set(Array.isArray(raw.collectedKeyIds) ? raw.collectedKeyIds.filter((id) => validKeyIds.has(id)) : []);
  // A revealed key tile means the excavation already happened. Older saves did
  // not record keys, and an interrupted write could also omit this inventory
  // entry. Rebuild it from permanent map progress so a completed floor can
  // never become an unwinnable dead end.
  for (const [mapId, map] of Object.entries(EXPEDITION_MAPS)) {
    if (map.key && mapProgress[mapId].revealed.includes(tileKey(map.key.x, map.key.y))) collectedKeyIds.add(map.key.id);
  }
  const state = {
    ...fallback,
    focus: Math.min(EXPEDITION_FOCUS_MAX, integer(raw.focus, fallback.focus)),
    focusUpdatedAt: integer(raw.focusUpdatedAt, fallback.focusUpdatedAt),
    activeMapId, mapProgress, foundTargetIds,
    collectedKeyIds: [...collectedKeyIds],
    unlockedDoorIds: Array.isArray(raw.unlockedDoorIds) ? [...new Set(raw.unlockedDoorIds.filter((id) => validDoorIds.has(id)))] : [],
    visitedMapIds: Array.isArray(raw.visitedMapIds) ? [...new Set(raw.visitedMapIds.filter((id) => EXPEDITION_MAPS[id]))] : ["starfall-shaft"],
    digs: integer(raw.digs, 0), completed: foundTargetIds.length >= fallback.targets.length || Boolean(raw.completed),
    lastClue: raw.lastClue && typeof raw.lastClue === "object" ? {
      level: typeof raw.lastClue.level === "string" ? raw.lastClue.level : fallback.lastClue.level,
      title: typeof raw.lastClue.title === "string" ? raw.lastClue.title : fallback.lastClue.title,
      detail: typeof raw.lastClue.detail === "string" ? raw.lastClue.detail : fallback.lastClue.detail,
      distance: Number.isInteger(raw.lastClue.distance) ? raw.lastClue.distance : null
    } : fallback.lastClue
  };
  if (!state.visitedMapIds.includes(activeMapId)) state.visitedMapIds.push(activeMapId);
  return projectActiveMap(state);
}

export function recoverExpeditionFocus(state, now = Date.now()) {
  const current = Math.min(EXPEDITION_FOCUS_MAX, integer(state?.focus, EXPEDITION_FOCUS_MAX));
  const currentTime = Math.max(0, Math.floor(Number(now) || Date.now()));
  const updatedAt = integer(state?.focusUpdatedAt, currentTime);
  if (current >= EXPEDITION_FOCUS_MAX) return { state, recovered: 0, remainingMs: 0, nextRecoveryAt: null };
  const elapsed = Math.max(0, currentTime - updatedAt);
  const recovered = Math.min(EXPEDITION_FOCUS_MAX - current, Math.floor(elapsed / EXPEDITION_FOCUS_REGEN_INTERVAL_MS));
  const nextFocus = current + recovered;
  const nextUpdatedAt = nextFocus >= EXPEDITION_FOCUS_MAX ? currentTime : updatedAt + recovered * EXPEDITION_FOCUS_REGEN_INTERVAL_MS;
  const remainingMs = nextFocus >= EXPEDITION_FOCUS_MAX ? 0 : Math.max(0, EXPEDITION_FOCUS_REGEN_INTERVAL_MS - Math.max(0, currentTime - nextUpdatedAt));
  return {
    state: recovered > 0 ? { ...state, focus: nextFocus, focusUpdatedAt: nextUpdatedAt } : state,
    recovered,
    remainingMs,
    nextRecoveryAt: nextFocus >= EXPEDITION_FOCUS_MAX ? null : nextUpdatedAt + EXPEDITION_FOCUS_REGEN_INTERVAL_MS
  };
}

export function terrainAt(state, x, y) { return TERRAIN[state.terrain?.[tileKey(x, y)]] ?? TERRAIN.sand; }
export function isRevealed(state, x, y) { return state.revealed.includes(tileKey(x, y)); }
export function isAdjacentToRevealed(state, x, y) {
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => isInBounds(state, nx, ny) && isRevealed(state, nx, ny));
}

export function visibilityAt(state, x, y) {
  const key = tileKey(x, y);
  if (Array.isArray(state.currentRunRevealed) && state.currentRunRevealed.includes(key)) return "current";
  if (isRevealed(state, x, y)) return "explored";
  if (isAdjacentToRevealed(state, x, y)) return "shadow";
  return "dark";
}

export function targetAt(state, x, y) {
  return state.targets.find((target) => target.mapId === state.activeMapId && target.x === x && target.y === y) ?? null;
}
export function keyAt(state, x, y) {
  const key = activeMap(state).key;
  return key && key.x === x && key.y === y ? key : null;
}
export function doorAt(state, x, y) { return activeMap(state).doors.find((door) => door.x === x && door.y === y) ?? null; }
export function remainingTargets(state) {
  const found = new Set(state.foundTargetIds);
  return state.targets.filter((target) => target.mapId === state.activeMapId && !found.has(target.id));
}

export function compassClue(state, x, y) {
  const remaining = remainingTargets(state);
  if (!remaining.length) return state.foundTargetIds.length < state.targets.length
    ? { level: "gate", title: "羅盤指向石門", detail: "這一層的主遺物已找到；尋找鑰匙並前往發光的門。", distance: null }
    : { level: "complete", title: "星脈已平靜", detail: "三層礦區的主要寶物都已找回。", distance: null };
  const distance = Math.min(...remaining.map((target) => Math.max(Math.abs(target.x - x), Math.abs(target.y - y))));
  if (distance === 0) return { level: "found", title: "星光迸發", detail: "你在這裡找到一件主要寶物。", distance };
  if (distance === 1) return { level: "near", title: "就在近旁", detail: "下一件主要寶物在相鄰礦點附近。", distance };
  if (distance === 2) return { level: "strong", title: "強烈共鳴", detail: "保持方向；寶物就在兩步內。", distance };
  if (distance === 3) return { level: "weak", title: "微弱回聲", detail: "這條路有訊號，但還需要再推進。", distance };
  return { level: "silent", title: "一片寂靜", detail: "附近沒有主要寶物，試著改變方向。", distance };
}

export function canExcavate(state, x, y) {
  if (!isInBounds(state, x, y)) return { ok: false, message: "那裡不在這座礦場範圍內。" };
  const door = doorAt(state, x, y);
  if (door) return { ok: false, reason: "door", message: `這裡是「${door.name}」，請靠近並開門。` };
  if (isRevealed(state, x, y)) return { ok: false, message: "這一處已經調查過了。" };
  if (!isAdjacentToRevealed(state, x, y)) return { ok: false, message: "前方仍在黑暗中；先從亮起的相鄰礦點推進。" };
  const terrain = terrainAt(state, x, y);
  if (state.focus < terrain.cost) return { ok: false, reason: "focus", message: `調查${terrain.name}需要 ${terrain.cost} 點專注，目前專注不足。` };
  return { ok: true, terrain };
}

export function canEnterDoor(state, x, y) {
  const door = doorAt(state, x, y);
  if (!door) return { ok: false, message: "這裡沒有可進入的門。" };
  if (!isRevealed(state, x, y) && !isAdjacentToRevealed(state, x, y)) return { ok: false, reason: "distance", message: "石門還藏在黑暗中；先挖到它旁邊。" };
  if (door.keyId && !state.collectedKeyIds.includes(door.keyId)) {
    const required = Object.values(EXPEDITION_MAPS).map((map) => map.key).find((key) => key?.id === door.keyId);
    return { ok: false, reason: "key", door, message: `「${door.name}」鎖住了；本層藏著${required?.name ?? "對應鑰匙"}。` };
  }
  return { ok: true, door };
}

export function enterDoor(state, x, y) {
  const permission = canEnterDoor(state, x, y);
  if (!permission.ok) return { ok: false, state, message: permission.message, reason: permission.reason, event: null };
  const next = clone(state);
  const door = permission.door;
  if (!next.unlockedDoorIds.includes(door.id)) next.unlockedDoorIds.push(door.id);
  next.activeMapId = door.toMapId;
  if (!next.visitedMapIds.includes(door.toMapId)) next.visitedMapIds.push(door.toMapId);
  projectActiveMap(next);
  next.lastClue = compassClue(next, 0, 0);
  const destination = activeMap(next);
  return { ok: true, state: next, message: `${door.name}已開啟，進入${destination.name}。這一層的探索進度會永久保留。`, event: { type: "door", door, fromMapId: state.activeMapId, toMapId: door.toMapId, destination } };
}

export function excavate(state, x, y, now = Date.now()) {
  const activeState = recoverExpeditionFocus(state, now).state;
  const permission = canExcavate(activeState, x, y);
  if (!permission.ok) return { ok: false, state: activeState, message: permission.message, reason: permission.reason, event: null };
  const next = clone(activeState);
  const terrain = permission.terrain;
  const tile = tileKey(x, y);
  next.focus -= terrain.cost;
  next.focusUpdatedAt = Math.max(0, Math.floor(Number(now) || Date.now()));
  next.revealed.push(tile);
  next.mapProgress[next.activeMapId].revealed = [...next.revealed];
  next.digs += 1;
  const target = targetAt(next, x, y);
  const foundKey = keyAt(next, x, y);
  const discovery = target && !next.foundTargetIds.includes(target.id) ? target : null;
  const keyDiscovery = foundKey && !next.collectedKeyIds.includes(foundKey.id) ? foundKey : null;
  if (discovery) next.foundTargetIds.push(discovery.id);
  if (keyDiscovery) next.collectedKeyIds.push(keyDiscovery.id);
  const newlyCompleted = !activeState.completed && next.foundTargetIds.length === next.targets.length;
  next.completed = next.foundTargetIds.length === next.targets.length;
  next.lastClue = compassClue(next, x, y);
  const reward = combineRewards(terrain.reward, discovery?.reward);
  const message = keyDiscovery
    ? `挖到「${keyDiscovery.name}」！鑰匙已掛進行囊，現在可以前往本層石門。`
    : discovery
    ? `找到「${discovery.name}」！${newlyCompleted ? " 三層主要寶物已全數定位。" : " 羅盤正在指向下一段旅程。"}`
    : `${terrain.name}已翻開：${next.lastClue.title}。`;
  return {
    ok: true, state: next, message,
    event: { type: keyDiscovery ? "key" : discovery ? "discovery" : "dig", x, y, mapId: next.activeMapId, terrain, discovery, key: keyDiscovery, reward, clue: next.lastClue, completed: newlyCompleted }
  };
}

export function refillFocus(state, amount) {
  const next = clone(state);
  const before = next.focus;
  next.focus = Math.min(EXPEDITION_FOCUS_MAX, next.focus + integer(amount, 0));
  if (next.focus > before) next.focusUpdatedAt = Date.now();
  return { state: next, gained: next.focus - before };
}
