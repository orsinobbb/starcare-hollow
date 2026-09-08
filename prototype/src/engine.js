export const CARD_FAMILIES = Object.freeze([
  { id: "cloud", name: "絨絨", symbol: "☁", palette: "sky" },
  { id: "moon", name: "月芽", symbol: "☾", palette: "moon" },
  { id: "flower", name: "花鈴", symbol: "✿", palette: "rose" },
  { id: "star", name: "星仔", symbol: "✦", palette: "indigo" },
  { id: "leaf", name: "葉寶", symbol: "❧", palette: "leaf" },
  { id: "crystal", name: "晶晶", symbol: "◇", palette: "amber" },
  { id: "bird", name: "啾啾", symbol: "♧", palette: "mint" },
  { id: "heart", name: "暖暖", symbol: "♥", palette: "coral" }
]);

export const MINI_GAME_MODES = Object.freeze([
  {
    id: "memory",
    title: "翻牌記憶",
    shortTitle: "翻牌",
    symbol: "▣",
    detail: "翻開兩張卡，找出藏在背面的相同夥伴。"
  },
  {
    id: "quick-pair",
    title: "雙雙消除",
    shortTitle: "雙雙消",
    symbol: "◈",
    detail: "所有圖案都看得見，快速找出兩個相同夥伴。"
  },
  {
    id: "triple-pack",
    title: "三件收納",
    shortTitle: "三件收納",
    symbol: "≋",
    detail: "把相同的三件物品放進托盤，自動完成一組收納。"
  }
]);

export const COMPANION_SKILLS = Object.freeze([
  {
    id: "moon-peek",
    companion: "艾芙",
    title: "月芽提示",
    symbol: "❧",
    detail: "標出一組可完成的配對；翻牌時額外透視全部卡片。"
  },
  {
    id: "star-match",
    companion: "賽恩",
    title: "星引共鳴",
    symbol: "✦",
    detail: "立即完成一組配對或三件收納。"
  },
  {
    id: "cloud-time",
    companion: "絨絨",
    title: "安心時刻",
    symbol: "♥",
    detail: "增加 15 秒，並保護下一次失誤不扣分。"
  }
]);

export const SKILL_CHARGE_MAX = 100;
export const SKILL_CHARGE_PER_MATCH = 25;

export function hashSeed(value) {
  const input = String(value ?? "starcare");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function createRng(seed = "starcare") {
  let state = hashSeed(seed);
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(values, rng = createRng()) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function selectedFamilies(count, rng) {
  const safeCount = Math.max(1, Math.min(CARD_FAMILIES.length, Math.floor(Number(count) || 1)));
  return shuffle(CARD_FAMILIES, rng).slice(0, safeCount);
}

export function createPairDeck(pairCount, rng = createRng()) {
  const families = selectedFamilies(pairCount, rng);
  const cards = families.flatMap((family) => [0, 1].map((copy) => ({
    id: `${family.id}-${copy}`,
    familyId: family.id,
    name: family.name,
    symbol: family.symbol,
    palette: family.palette,
    state: "idle"
  })));
  return shuffle(cards, rng);
}

export function createTripleDeck(groupCount, rng = createRng()) {
  const families = selectedFamilies(groupCount, rng);
  const cards = families.flatMap((family) => [0, 1, 2].map((copy) => ({
    id: `${family.id}-${copy}`,
    familyId: family.id,
    name: family.name,
    symbol: family.symbol,
    palette: family.palette,
    state: "idle"
  })));
  return shuffle(cards, rng);
}

export function isMatchingGroup(cards, size = 2) {
  if (!Array.isArray(cards) || cards.length !== size) return false;
  return cards.every((card) => card && card.familyId === cards[0].familyId);
}

export function findAvailableGroup(cards, size = 2) {
  const groups = new Map();
  for (const card of cards ?? []) {
    if (!card || card.state === "matched") continue;
    const group = groups.get(card.familyId) ?? [];
    group.push(card.id);
    groups.set(card.familyId, group);
    if (group.length >= size) return group.slice(0, size);
  }
  return [];
}

export function insertTrayCard(tray, card) {
  const next = [...(tray ?? [])];
  const lastFamilyIndex = next.reduce(
    (found, item, index) => item.familyId === card.familyId ? index : found,
    -1
  );
  const insertAt = lastFamilyIndex >= 0 ? lastFamilyIndex + 1 : next.length;
  next.splice(insertAt, 0, card);
  return next;
}

export function resolveTray(tray, groupSize = 3) {
  const next = [...(tray ?? [])];
  const counts = new Map();
  for (const card of next) counts.set(card.familyId, (counts.get(card.familyId) ?? 0) + 1);
  const familyId = [...counts.entries()].find(([, count]) => count >= groupSize)?.[0] ?? null;
  if (!familyId) return { tray: next, clearedFamilyId: null, clearedIds: [] };

  const clearedIds = [];
  const remaining = [];
  for (const card of next) {
    if (card.familyId === familyId && clearedIds.length < groupSize) clearedIds.push(card.id);
    else remaining.push(card);
  }
  return { tray: remaining, clearedFamilyId: familyId, clearedIds };
}

export function modeForRound(choice, roundNumber) {
  if (MINI_GAME_MODES.some((mode) => mode.id === choice)) return choice;
  const index = Math.max(0, Math.floor(Number(roundNumber) || 1) - 1) % MINI_GAME_MODES.length;
  return MINI_GAME_MODES[index].id;
}

export function addSkillCharge(current, amount = SKILL_CHARGE_PER_MATCH) {
  return Math.min(SKILL_CHARGE_MAX, Math.max(0, Number(current) || 0) + Math.max(0, Number(amount) || 0));
}

export function nextCombo(current, wasCorrect) {
  return wasCorrect ? Math.max(0, Math.floor(Number(current) || 0)) + 1 : 0;
}

export function scoreForMatch(combo, groupSize = 2) {
  const safeCombo = Math.max(1, Math.floor(Number(combo) || 1));
  const safeGroupSize = groupSize === 3 ? 3 : 2;
  return 80 + safeGroupSize * 20 + Math.min(10, safeCombo) * 15;
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
