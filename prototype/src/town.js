import { APP_VERSION, SAVE_SCHEMA_VERSION } from "./version.js";
import { EXPEDITION_FOCUS_MAX, createExpeditionState, normalizeExpeditionState } from "./expedition-engine.js";

export const TOWN_SAVE_KEY = "starcare-hollow:town:v1";
export const TOWN_BACKUP_KEY = "starcare-hollow:town:backup";
export const TOWN_SCHEMA_VERSION = SAVE_SCHEMA_VERSION;
export const TOWN_GAME_VERSION = APP_VERSION;
export const DISTRICT_RESTORATION_GOAL = 30;
export const EXPEDITION_FOCUS_RESTORE = 6;
export const EXPEDITION_FOCUS_MOONLEAF_COST = 1;
export const COMMISSION_MOONLEAF_COST = 3;
export const MINIMUM_DAILY_WISHES_FOR_REST = 2;

export const RESOURCE_LABELS = {
  coins: "星幣",
  moonleaf: "月芽葉",
  timber: "暖木",
  starlight: "星砂"
};

export const BUILDINGS = {
  clinic: {
    name: "暖星小遊戲屋",
    maxLevel: 3,
    costs: {
      2: { coins: 120, moonleaf: 4 },
      3: { coins: 240, timber: 5, starlight: 4 }
    },
    benefit: (level) => `每場遊戲額外獲得 ${Math.max(0, level - 1) * 8} 星幣`
  },
  garden: {
    name: "月芽藥園",
    maxLevel: 3,
    costs: {
      2: { coins: 90, timber: 2 },
      3: { coins: 180, timber: 4, starlight: 3 }
    },
    benefit: (level) => `每日採收 ${level + 2} 片月芽葉・遠征暖茶補給`
  },
  workshop: {
    name: "回響工坊",
    maxLevel: 3,
    costs: {
      2: { coins: 110, timber: 3 },
      3: { coins: 210, moonleaf: 8, starlight: 3 }
    },
    benefit: (level) => `委託可獲得 ${35 + Math.max(0, level - 1) * 10} 星幣`
  }
};

export const DAILY_WISHES = [
  { id: "garden", title: "照料月芽藥園", detail: "採收一次今日藥草" },
  { id: "commission", title: "完成居民委託（選做）", detail: `交付 ${COMMISSION_MOONLEAF_COST} 片月芽葉，換建設材料` },
  { id: "clinic", title: "完成遊戲委託", detail: "完成一場小遊戲挑戰" }
];

const WISH_SYMBOLS = Object.freeze({
  garden: "🌿",
  commission: "🔨",
  clinic: "🃏"
});

export const COLLECTION_ITEMS = Object.freeze([
  {
    id: "founders-mark",
    icon: "✦",
    category: "鎮史",
    name: "初亮鎮印",
    detail: "你在暖燈坡點亮的第一枚印記。",
    hint: "建立小鎮存檔"
  },
  {
    id: "moonleaf-pressing",
    icon: "❧",
    category: "植物標本",
    name: "月芽壓花",
    detail: "第一批親手照料的月芽，葉脈仍留著晨光。",
    hint: "完成第一次藥園採收"
  },
  {
    id: "tobis-whistle",
    icon: "♫",
    category: "居民信物",
    name: "托比的暖木哨",
    detail: "托比為答謝材料而削成的小哨，聲音像回家的風。",
    hint: "完成第一次居民委託"
  },
  {
    id: "clinic-badge",
    icon: "✚",
    category: "遊戲紀錄",
    name: "暖星遊戲章",
    detail: "不論成績高低，這枚章記得你完成的第一場委託。",
    hint: "完成第一次小遊戲委託"
  },
  {
    id: "companion-charm",
    icon: "♡",
    category: "搭檔信物",
    name: "三心共鳴徽記",
    detail: "艾芙、賽恩與絨絨把第一次並肩施放技能的光留在這枚徽記裡。",
    hint: "在小遊戲中第一次施放搭檔技能"
  },
  {
    id: "restorer-pin",
    icon: "⚒",
    category: "城鎮徽記",
    name: "修繕者銅章",
    detail: "第一座升級設施留下的銅章，證明小鎮真的在成長。",
    hint: "完成第一次建築升級"
  },
  {
    id: "three-wish-medal",
    icon: "★",
    category: "星願紀念",
    name: "三願星章",
    detail: "採集、委託與照顧交會成的一日完整記憶。",
    hint: "第一次集齊三項今日星願"
  },
  {
    id: "lantern-keepsake",
    icon: "☼",
    category: "鎮景收藏",
    name: "重燃街燈",
    detail: "暖燈坡重新亮起的街燈縮影，見證第一段復甦。",
    hint: "讓暖燈坡修復度達到 10"
  },
  {
    id: "starsand-compass",
    icon: "✦",
    category: "遠征紀錄",
    name: "星砂羅盤針",
    detail: "第一次回應星脈的方向；它記得你挖下的第一格。",
    hint: "完成第一次星脈調查"
  },
  {
    id: "echo-vial-exhibit",
    icon: "⚗",
    category: "回聲博物間",
    name: "古療瓶展示牌",
    detail: "星砂群島的第一批主要寶物，終於有了能被看見的位置。",
    hint: "在星砂群島找到三件主要寶物"
  }
]);

const COLLECTION_BY_ID = Object.fromEntries(COLLECTION_ITEMS.map((item) => [item.id, item]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, fallback = 0, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function createDaily(day) {
  return {
    day,
    garden: false,
    commission: false,
    clinic: false,
    rewardClaimed: false
  };
}

export function createTownState() {
  return {
    schemaVersion: TOWN_SCHEMA_VERSION,
    day: 1,
    restoration: 0,
    resources: {
      coins: 90,
      moonleaf: 1,
      timber: 2,
      starlight: 0
    },
    buildings: {
      clinic: 1,
      garden: 1,
      workshop: 1
    },
    daily: createDaily(1),
    collections: {
      unlocked: ["founders-mark"]
    },
    lifetime: {
      shifts: 0,
      served: 0,
      pairsMatched: 0,
      harvests: 0,
      commissions: 0,
      upgrades: 0,
      dailyRewards: 0,
      skillUses: 0,
      expeditionDigs: 0,
      relicsFound: 0,
      completedExpeditions: 0
    },
    history: {
      rewardedShiftIds: []
    },
    expedition: createExpeditionState(),
    updatedAt: null
  };
}

export function normalizeTownState(raw) {
  const fallback = createTownState();
  if (
    !raw
    || typeof raw !== "object"
    || !Number.isInteger(raw.schemaVersion)
    || raw.schemaVersion < 1
    || raw.schemaVersion > TOWN_SCHEMA_VERSION
  ) return fallback;

  const day = integer(raw.day, 1, 1);
  const state = {
    ...fallback,
    day,
    restoration: integer(raw.restoration),
    resources: Object.fromEntries(
      Object.keys(fallback.resources).map((key) => [key, integer(raw.resources?.[key], fallback.resources[key])])
    ),
    buildings: Object.fromEntries(
      Object.entries(BUILDINGS).map(([key, building]) => [
        key,
        Math.min(building.maxLevel, integer(raw.buildings?.[key], 1, 1))
      ])
    ),
    daily: raw.daily?.day === day
      ? {
          day,
          garden: Boolean(raw.daily.garden),
          commission: Boolean(raw.daily.commission),
          clinic: Boolean(raw.daily.clinic),
          rewardClaimed: Boolean(raw.daily.rewardClaimed)
        }
      : createDaily(day),
    collections: {
      unlocked: Array.isArray(raw.collections?.unlocked)
        ? raw.collections.unlocked.filter((id) => COLLECTION_BY_ID[id])
        : []
    },
    lifetime: Object.fromEntries(
      Object.keys(fallback.lifetime).map((key) => [key, integer(raw.lifetime?.[key])])
    ),
    history: {
      rewardedShiftIds: Array.isArray(raw.history?.rewardedShiftIds)
        ? raw.history.rewardedShiftIds.filter((id) => typeof id === "string").slice(-40)
        : []
    },
    expedition: normalizeExpeditionState(raw.expedition),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };

  return syncCollectionProgress(state);
}

export function loadTownState(storage = globalThis.localStorage) {
  try {
    const serialized = storage?.getItem(TOWN_SAVE_KEY);
    if (!serialized) return createTownState();
    const parsed = JSON.parse(serialized);
    if (parsed?.profile && typeof parsed.profile === "object") {
      return normalizeTownState({
        ...parsed.profile,
        schemaVersion: parsed.schemaVersion ?? parsed.profile.schemaVersion,
        updatedAt: parsed.savedAt ?? parsed.profile.updatedAt
      });
    }
    return normalizeTownState(parsed);
  } catch {
    return createTownState();
  }
}

export function saveTownState(state, storage = globalThis.localStorage) {
  try {
    const serialized = JSON.stringify({
      schemaVersion: TOWN_SCHEMA_VERSION,
      gameVersion: TOWN_GAME_VERSION,
      savedAt: state.updatedAt ?? new Date().toISOString(),
      profile: state
    });
    const previous = storage?.getItem(TOWN_SAVE_KEY);
    if (previous && previous !== serialized) storage?.setItem(TOWN_BACKUP_KEY, previous);
    storage?.setItem(TOWN_SAVE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function completedWishCount(state) {
  return DAILY_WISHES.filter((wish) => state.daily[wish.id]).length;
}

export function canAfford(state, cost) {
  return Object.entries(cost).every(([resource, amount]) => state.resources[resource] >= amount);
}

export function formatCost(cost) {
  return Object.entries(cost)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
    .join(" · ");
}

function outcome(state, ok, message, delta = {}) {
  return { state, ok, message, delta };
}

export function collectionRequirementsMet(state, itemId) {
  if (itemId === "founders-mark") return true;
  if (itemId === "moonleaf-pressing") return state.lifetime.harvests >= 1;
  if (itemId === "tobis-whistle") return state.lifetime.commissions >= 1;
  if (itemId === "clinic-badge") return state.lifetime.shifts >= 1;
  if (itemId === "companion-charm") return state.lifetime.skillUses >= 1;
  if (itemId === "restorer-pin") return state.lifetime.upgrades >= 1;
  if (itemId === "three-wish-medal") return state.lifetime.dailyRewards >= 1;
  if (itemId === "lantern-keepsake") return state.restoration >= 10;
  if (itemId === "starsand-compass") return state.lifetime.expeditionDigs >= 1;
  if (itemId === "echo-vial-exhibit") return state.lifetime.relicsFound >= 3;
  return false;
}

export function syncCollectionProgress(state) {
  const unlocked = new Set(
    Array.isArray(state.collections?.unlocked)
      ? state.collections.unlocked.filter((id) => COLLECTION_BY_ID[id])
      : []
  );
  for (const item of COLLECTION_ITEMS) {
    if (collectionRequirementsMet(state, item.id)) unlocked.add(item.id);
  }
  state.collections = {
    unlocked: COLLECTION_ITEMS.filter((item) => unlocked.has(item.id)).map((item) => item.id)
  };
  return state;
}

function collectionOutcome(previous, next, message, delta = {}) {
  const previousIds = new Set(previous.collections?.unlocked ?? []);
  syncCollectionProgress(next);
  const collectionIds = next.collections.unlocked.filter((id) => !previousIds.has(id));
  return outcome(next, true, message, {
    ...delta,
    collections: collectionIds.length,
    collectionIds
  });
}

export function tendGarden(state) {
  if (state.daily.garden) return outcome(state, false, "今天的月芽已經照料完成，明日還會再長。");
  const next = clone(state);
  const amount = next.buildings.garden + 2;
  next.resources.moonleaf += amount;
  next.restoration += 1;
  next.daily.garden = true;
  next.lifetime.harvests += 1;
  return collectionOutcome(state, next, `採收到 ${amount} 片月芽葉，小鎮修復度也增加了。`, {
    moonleaf: amount,
    restoration: 1
  });
}

export function fulfillCommission(state) {
  if (state.daily.commission) return outcome(state, false, "今天的居民委託已經送達。");
  const cost = { moonleaf: COMMISSION_MOONLEAF_COST };
  if (!canAfford(state, cost)) return outcome(state, false, `還需要 ${COMMISSION_MOONLEAF_COST} 片月芽葉；這份委託可以留到明日，不會阻止你進入下一日。`);

  const next = clone(state);
  const coins = 35 + Math.max(0, next.buildings.workshop - 1) * 10;
  next.resources.moonleaf -= cost.moonleaf;
  next.resources.coins += coins;
  next.resources.timber += 1;
  next.restoration += 2;
  next.daily.commission = true;
  next.lifetime.commissions += 1;
  return collectionOutcome(state, next, `托比收到材料了：獲得 ${coins} 星幣與 1 份暖木。`, {
    coins,
    moonleaf: -cost.moonleaf,
    timber: 1,
    restoration: 2
  });
}

export function resupplyExpeditionFocus(state) {
  const focus = state.expedition?.focus ?? 0;
  if (focus >= EXPEDITION_FOCUS_MAX) {
    return outcome(state, false, "羅盤專注已充足；先把月芽葉留給下一段路。");
  }
  if (state.resources.moonleaf < EXPEDITION_FOCUS_MOONLEAF_COST) {
    return outcome(state, false, `需要 1 片月芽葉。到小鎮的月芽藥園採收；今日委託是選做，完成任 ${MINIMUM_DAILY_WISHES_FOR_REST} 項星願即可進入下一日。`);
  }

  const next = clone(state);
  const restored = Math.min(EXPEDITION_FOCUS_RESTORE, EXPEDITION_FOCUS_MAX - focus);
  next.resources.moonleaf -= EXPEDITION_FOCUS_MOONLEAF_COST;
  next.expedition = normalizeExpeditionState({
    ...next.expedition,
    focus: focus + restored
  });
  const commissionDeferred = !state.daily.commission && next.resources.moonleaf < COMMISSION_MOONLEAF_COST;
  return collectionOutcome(state, next, `月芽暖茶回到羅盤：遠征專注 +${restored}。${commissionDeferred ? " 今日委託材料不足，可留到明日處理。" : ""}`, {
    moonleaf: -EXPEDITION_FOCUS_MOONLEAF_COST,
    expeditionFocus: restored
  });
}

export function recordClinicShift(state, {
  id,
  completed,
  matched = 0,
  served = 0,
  stars = 0,
  score = 0,
  skillUses = 0
} = {}) {
  const shiftId = typeof id === "string" && id ? id : null;
  if (!shiftId) return outcome(state, false, "這次遊戲缺少識別碼，沒有發放獎勵。");
  if (state.history.rewardedShiftIds.includes(shiftId)) {
    return outcome(state, false, "這次遊戲的獎勵已經領取。");
  }

  const next = clone(state);
  const safeCompleted = integer(completed ?? served);
  const safeMatched = integer(matched);
  const safeStars = Math.min(3, integer(stars));
  const safeScore = integer(score);
  const safeSkillUses = integer(skillUses);
  const coins = 12 + safeCompleted * 12 + safeStars * 7 + Math.max(0, next.buildings.clinic - 1) * 8;
  const starlight = safeStars > 0 ? 1 + Math.floor(safeStars / 3) : 0;
  const firstClinicToday = !next.daily.clinic;
  const restoration = firstClinicToday ? 1 + safeStars : 0;

  next.resources.coins += coins;
  next.resources.starlight += starlight;
  next.restoration += restoration;
  next.daily.clinic = true;
  next.lifetime.shifts += 1;
  next.lifetime.served += safeCompleted;
  next.lifetime.pairsMatched += safeMatched;
  next.lifetime.skillUses += safeSkillUses;
  next.history.rewardedShiftIds.push(shiftId);
  next.history.rewardedShiftIds = next.history.rewardedShiftIds.slice(-40);

  return collectionOutcome(state, next, `遊戲成果已帶回小鎮：星幣 +${coins}${starlight ? `、星砂 +${starlight}` : ""}。`, {
    coins,
    starlight,
    restoration,
    score: safeScore,
    matched: safeMatched,
    skillUses: safeSkillUses
  });
}

export function recordExpeditionProgress(state, expedition, event = {}) {
  const next = clone(state);
  const normalized = normalizeExpeditionState(expedition);
  const previousFound = new Set(state.expedition?.foundTargetIds ?? []);
  const discoveries = normalized.foundTargetIds
    .filter((id) => !previousFound.has(id))
    .map((id) => normalized.targets.find((target) => target.id === id))
    .filter(Boolean);
  const becameComplete = normalized.completed && !state.expedition?.completed;

  next.expedition = normalized;
  if (event.type === "dig" || event.type === "discovery") next.lifetime.expeditionDigs += 1;
  next.lifetime.relicsFound += discoveries.length;
  if (becameComplete) next.lifetime.completedExpeditions += 1;

  const discoveryReward = discoveries.reduce((total, target) => ({
    coins: total.coins + target.reward.coins,
    starlight: total.starlight + target.reward.starlight
  }), { coins: 0, starlight: 0 });
  const reward = Object.fromEntries(
    Object.keys(next.resources).map((resource) => [
      resource,
      integer(event.reward?.[resource], discoveryReward[resource] ?? 0)
    ])
  );
  for (const [resource, amount] of Object.entries(reward)) next.resources[resource] += amount;

  const discoveryNames = discoveries.map((target) => target.name);
  const rewardText = formatCost(reward);
  const message = discoveryNames.length
    ? `遠征成果已收下：${discoveryNames.join("、")}；${rewardText}。`
    : `${event.message ?? "遠征地圖已自動保存。"} 獲得 ${rewardText}。`;
  return collectionOutcome(state, next, message, {
    ...reward,
    discoveries: discoveryNames,
    completed: becameComplete,
    expeditionDigs: event.type === "dig" || event.type === "discovery" ? 1 : 0
  });
}

export function claimDailyReward(state) {
  if (state.daily.rewardClaimed) return outcome(state, false, "今天的星願禮已經領取。");
  const completed = completedWishCount(state);
  if (completed < MINIMUM_DAILY_WISHES_FOR_REST) {
    return outcome(state, false, `完成任 ${MINIMUM_DAILY_WISHES_FOR_REST} 項星願後，就能領取歇息禮並進入下一日。`);
  }

  const next = clone(state);
  const fullDay = completed === DAILY_WISHES.length;
  const reward = fullDay
    ? { coins: 60, timber: 2, starlight: 1, restoration: 3 }
    : { coins: 25, timber: 1, starlight: 0, restoration: 1 };
  next.resources.coins += reward.coins;
  next.resources.timber += reward.timber;
  next.resources.starlight += reward.starlight;
  next.restoration += reward.restoration;
  next.daily.rewardClaimed = true;
  if (fullDay) next.lifetime.dailyRewards += 1;
  return collectionOutcome(state, next, fullDay
    ? "三枚星願章已集齊：獲得 60 星幣、2 份暖木與 1 份星砂。"
    : "兩項星願已完成：領取歇息禮並保留居民委託到明日。", reward);
}

export function advanceTownDay(state) {
  if (!state.daily.rewardClaimed) return outcome(state, false, "領取今日星願禮後，再安心前往明日。");
  const next = clone(state);
  next.day += 1;
  next.daily = createDaily(next.day);
  return outcome(next, true, `第 ${next.day} 日開始了，藥園與居民委託都已更新。`);
}

export function upgradeBuilding(state, buildingId) {
  const building = BUILDINGS[buildingId];
  if (!building) return outcome(state, false, "找不到這座建築。");
  const currentLevel = state.buildings[buildingId];
  if (currentLevel >= building.maxLevel) return outcome(state, false, `${building.name}已達目前最高等級。`);

  const nextLevel = currentLevel + 1;
  const cost = building.costs[nextLevel];
  if (!canAfford(state, cost)) return outcome(state, false, `升級還需要：${formatCost(cost)}。`);

  const next = clone(state);
  for (const [resource, amount] of Object.entries(cost)) next.resources[resource] -= amount;
  next.buildings[buildingId] = nextLevel;
  next.restoration += 2;
  next.lifetime.upgrades += 1;
  return collectionOutcome(state, next, `${building.name}升到 Lv.${nextLevel}，新的效果已永久生效。`, {
    restoration: 2,
    buildingId,
    level: nextLevel
  });
}

export function townStage(restoration) {
  if (restoration >= DISTRICT_RESTORATION_GOAL) {
    return { title: "暖燈坡已復甦", detail: "通往下一區的星橋開始發光。", rank: "繁花" };
  }
  if (restoration >= 20) return { title: "街角重新熱鬧", detail: "居民開始在廣場停留與交談。", rank: "新芽" };
  if (restoration >= 10) return { title: "暖燈逐盞點亮", detail: "藥園與工坊之間出現新的小徑。", rank: "微光" };
  return { title: "第一盞燈正亮起", detail: "完成遊戲與居民委託，讓暖燈坡逐步甦醒。", rank: "初亮" };
}

export function nextTownQuest(state) {
  const wishes = completedWishCount(state);
  if (state.daily.rewardClaimed) {
    return {
      id: "next-day",
      target: "plaza",
      step: "新的一天",
      title: "讓暖燈坡迎接新的晨光",
      detail: "今天的成果已妥善保存。進到明天後，藥園、遊戲委託與選做材料單都會重新準備好。",
      reward: "你保留所有資源、收藏與小鎮修復進度",
      action: "進入下一日"
    };
  }
  if (wishes >= MINIMUM_DAILY_WISHES_FOR_REST) {
    return {
      id: "rest",
      target: "plaza",
      step: "今日收尾",
      title: "先收下歇息禮，再決定要不要多玩一項",
      detail: "你已完成任兩項今日星願，可以安全進入下一日。第三項只是額外的完整修復獎勵，不是門票。",
      reward: "兩項：星幣 +25、暖木 +1；三項會升級成完整修復禮",
      action: "領取歇息禮"
    };
  }
  if (!state.daily.garden) {
    return {
      id: "garden",
      target: "garden",
      step: "第 1 步",
      title: "先到月芽藥園採收",
      detail: "月芽葉是這趟旅程的燃料：可以泡成暖茶，替遠征羅盤補回專注。",
      reward: `獲得 ${state.buildings.garden + 2} 片月芽葉，並點亮 1 點修復度`,
      action: "採收月芽葉"
    };
  }
  if (state.lifetime.expeditionDigs === 0) {
    return {
      id: "expedition",
      target: "expedition",
      step: "第 2 步",
      title: "帶挖礦者去找第一份星砂",
      detail: "在地圖上挑一個相鄰迷霧格。挖礦者會走過去、挖掘，並把每一格的材料清楚交給你。",
      reward: "每格都有材料；遺物還會成為永久收藏與額外大獎",
      action: "前往星脈遠征"
    };
  }
  if (!state.daily.clinic) {
    return {
      id: "clinic",
      target: "clinic",
      step: "第 3 步",
      title: "換個節奏，完成一局可愛配對",
      detail: "翻牌、配對與收納會輪流出現。完成一局就算今日遊戲委託，也能帶回小鎮資源。",
      reward: "獲得星幣、星砂與修復度；達成任兩項星願就可過夜",
      action: "進入小遊戲屋"
    };
  }
  return {
    id: "expedition",
    target: "expedition",
    step: "自由探索",
    title: "下一盞燈的線索藏在星砂群島",
    detail: "今天的必要事項都完成了。你可以繼續挖寶、收集遺物，或直接回到廣場收下歇息禮。",
    reward: "繼續收集材料，為下一次升級與修復做準備",
    action: "繼續挖寶"
  };
}

export function createTownController({ root = document, storage = globalThis.localStorage, onEnterClinic, onEnterExpedition, onNotify } = {}) {
  let state = loadTownState(storage);
  let recentCollectionIds = [];
  const notify = typeof onNotify === "function" ? onNotify : () => {};
  const enterClinic = typeof onEnterClinic === "function" ? onEnterClinic : () => {};
  const enterExpedition = typeof onEnterExpedition === "function" ? onEnterExpedition : () => {};
  const element = (selector) => root.querySelector(selector);

  const ui = {
    day: element("#town-day"),
    rank: element("#town-rank"),
    coins: element("#town-coins"),
    moonleaf: element("#town-moonleaf"),
    timber: element("#town-timber"),
    starlight: element("#town-starlight"),
    restoration: element("#town-restoration"),
    restorationBar: element("#town-restoration-bar"),
    stageTitle: element("#town-stage-title"),
    stageDetail: element("#town-stage-detail"),
    nextQuest: element("#town-next-quest"),
    nextQuestStep: element("#town-next-step"),
    nextQuestTitle: element("#town-next-title"),
    nextQuestDetail: element("#town-next-detail"),
    nextQuestReward: element("#town-next-reward"),
    nextQuestAction: element("#town-next-action"),
    wishList: element("#town-wish-list"),
    wishCount: element("#town-wish-count"),
    claimReward: element("#claim-town-reward"),
    nextDay: element("#next-town-day"),
    gardenAction: element("#garden-action"),
    commissionAction: element("#commission-action"),
    buildingGrid: element("#town-building-grid"),
    collectionGrid: element("#town-collection-grid"),
    collectionCount: element("#town-collection-count"),
    saveStatus: element("#save-status"),
    lifetime: element("#town-lifetime")
  };

  function persist() {
    state.updatedAt = new Date().toISOString();
    const saved = saveTownState(state, storage);
    if (ui.saveStatus) ui.saveStatus.textContent = saved ? "✓ 已自動儲存" : "⚠ 無法寫入本機存檔";
    return saved;
  }

  function commit(result) {
    if (!result.ok) {
      notify(result.message);
      return result;
    }
    state = result.state;
    recentCollectionIds = result.delta.collectionIds ?? [];
    persist();
    render();
    const collectionNames = recentCollectionIds.map((id) => COLLECTION_BY_ID[id]?.name).filter(Boolean);
    notify(collectionNames.length
      ? `${result.message} 新收藏「${collectionNames.join("、")}」已收入星願手札。`
      : result.message);
    recentCollectionIds = [];
    return result;
  }

  function renderBuildings() {
    for (const [buildingId, building] of Object.entries(BUILDINGS)) {
      const level = state.buildings[buildingId];
      const nextCost = building.costs[level + 1];
      const levelElement = element(`[data-building-level="${buildingId}"]`);
      const benefitElement = element(`[data-building-benefit="${buildingId}"]`);
      const costElement = element(`[data-building-cost="${buildingId}"]`);
      const upgradeButton = element(`[data-upgrade-building="${buildingId}"]`);
      if (levelElement) levelElement.textContent = `Lv.${level}`;
      if (benefitElement) benefitElement.textContent = building.benefit(level);
      if (costElement) costElement.textContent = nextCost ? `下次升級：${formatCost(nextCost)}` : "目前版本已滿級";
      if (upgradeButton) {
        upgradeButton.disabled = level >= building.maxLevel;
        upgradeButton.textContent = level >= building.maxLevel ? "已滿級" : `升級 Lv.${level + 1}`;
      }
    }
  }

  function renderWishes() {
    ui.wishList?.replaceChildren();
    for (const wish of DAILY_WISHES) {
      const completed = state.daily[wish.id];
      const item = document.createElement("li");
      item.className = completed ? "wish-item is-complete" : "wish-item";
      item.innerHTML = `<span class="wish-check" aria-hidden="true">${completed ? "✓" : WISH_SYMBOLS[wish.id]}</span><span><strong>${wish.title}</strong><small>${wish.detail}</small></span>`;
      ui.wishList?.append(item);
    }

    const count = completedWishCount(state);
    if (ui.wishCount) ui.wishCount.textContent = `${count} / ${DAILY_WISHES.length}`;
    if (ui.claimReward) {
      const fullDay = count === DAILY_WISHES.length;
      ui.claimReward.disabled = count < MINIMUM_DAILY_WISHES_FOR_REST || state.daily.rewardClaimed;
      ui.claimReward.textContent = state.daily.rewardClaimed
        ? "今日歇息禮已領取"
        : fullDay
        ? "領取三章修復禮"
        : "領取兩章歇息禮";
    }
    if (ui.nextDay) ui.nextDay.disabled = !state.daily.rewardClaimed;
  }

  function renderCollections() {
    ui.collectionGrid?.replaceChildren();
    const unlocked = new Set(state.collections.unlocked);
    for (const item of COLLECTION_ITEMS) {
      const isUnlocked = unlocked.has(item.id);
      const card = document.createElement("article");
      card.className = `collection-card ${isUnlocked ? "is-unlocked" : "is-locked"}`;
      if (recentCollectionIds.includes(item.id)) card.classList.add("is-new");
      card.dataset.collectionId = item.id;
      card.setAttribute("aria-label", isUnlocked ? `已收錄：${item.name}` : `尚未收錄：${item.hint}`);

      const icon = document.createElement("span");
      icon.className = "collection-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = isUnlocked ? item.icon : "?";

      const copy = document.createElement("div");
      copy.className = "collection-copy";
      const category = document.createElement("span");
      category.className = "collection-category";
      category.textContent = isUnlocked ? item.category : "尚待發現";
      const name = document.createElement("strong");
      name.textContent = isUnlocked ? item.name : "未收錄";
      const detail = document.createElement("small");
      detail.textContent = isUnlocked ? item.detail : item.hint;
      copy.append(category, name, detail);
      card.append(icon, copy);
      ui.collectionGrid?.append(card);
    }
    if (ui.collectionCount) ui.collectionCount.textContent = `${unlocked.size} / ${COLLECTION_ITEMS.length}`;
  }

  function render() {
    const stage = townStage(state.restoration);
    const restorationPercent = Math.min(100, (state.restoration / DISTRICT_RESTORATION_GOAL) * 100);
    if (ui.day) ui.day.textContent = `第 ${state.day} 日`;
    if (ui.rank) ui.rank.textContent = stage.rank;
    if (ui.coins) ui.coins.textContent = state.resources.coins.toLocaleString("zh-Hant");
    if (ui.moonleaf) ui.moonleaf.textContent = state.resources.moonleaf;
    if (ui.timber) ui.timber.textContent = state.resources.timber;
    if (ui.starlight) ui.starlight.textContent = state.resources.starlight;
    if (ui.restoration) ui.restoration.textContent = `${Math.min(state.restoration, DISTRICT_RESTORATION_GOAL)} / ${DISTRICT_RESTORATION_GOAL}`;
    if (ui.restorationBar) {
      ui.restorationBar.style.width = `${restorationPercent}%`;
      ui.restorationBar.parentElement?.setAttribute("aria-valuenow", String(Math.min(state.restoration, DISTRICT_RESTORATION_GOAL)));
    }
    if (ui.stageTitle) ui.stageTitle.textContent = stage.title;
    if (ui.stageDetail) ui.stageDetail.textContent = stage.detail;
    const quest = nextTownQuest(state);
    if (ui.nextQuest) ui.nextQuest.dataset.quest = quest.id;
    if (ui.nextQuestStep) ui.nextQuestStep.textContent = quest.step;
    if (ui.nextQuestTitle) ui.nextQuestTitle.textContent = quest.title;
    if (ui.nextQuestDetail) ui.nextQuestDetail.textContent = quest.detail;
    if (ui.nextQuestReward) ui.nextQuestReward.textContent = `完成後：${quest.reward}`;
    if (ui.nextQuestAction) ui.nextQuestAction.textContent = quest.action;
    for (const place of root.querySelectorAll("[data-town-place]")) {
      place.classList.toggle("is-next", place.dataset.townPlace === quest.target);
    }
    if (ui.gardenAction) {
      ui.gardenAction.disabled = state.daily.garden;
      ui.gardenAction.textContent = state.daily.garden ? "今日已採收" : `採收 ${state.buildings.garden + 2} 片月芽葉`;
    }
    if (ui.commissionAction) {
      ui.commissionAction.disabled = state.daily.commission;
      ui.commissionAction.textContent = state.daily.commission ? "今日已送達" : `交付 ${COMMISSION_MOONLEAF_COST} 片月芽葉（選做）`;
    }
    if (ui.lifetime) {
      ui.lifetime.textContent = `已完成 ${state.lifetime.shifts} 場 · 配成 ${state.lifetime.pairsMatched} 組 · 遠征 ${state.lifetime.expeditionDigs} 格`;
    }
    renderBuildings();
    renderWishes();
    renderCollections();
  }

  element("#enter-clinic")?.addEventListener("click", enterClinic);
  element("#clinic-building-action")?.addEventListener("click", enterClinic);
  element("#enter-expedition")?.addEventListener("click", enterExpedition);
  element("#expedition-building-action")?.addEventListener("click", enterExpedition);
  ui.nextQuestAction?.addEventListener("click", () => {
    const quest = nextTownQuest(state);
    if (quest.id === "garden") commit(tendGarden(state));
    else if (quest.id === "clinic") enterClinic();
    else if (quest.id === "expedition") enterExpedition();
    else if (quest.id === "rest") commit(claimDailyReward(state));
    else if (quest.id === "next-day") commit(advanceTownDay(state));
  });
  ui.gardenAction?.addEventListener("click", () => commit(tendGarden(state)));
  ui.commissionAction?.addEventListener("click", () => commit(fulfillCommission(state)));
  ui.claimReward?.addEventListener("click", () => commit(claimDailyReward(state)));
  ui.nextDay?.addEventListener("click", () => commit(advanceTownDay(state)));
  ui.buildingGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-upgrade-building]");
    if (button) commit(upgradeBuilding(state, button.dataset.upgradeBuilding));
  });

  render();
  if (ui.saveStatus) ui.saveStatus.textContent = state.updatedAt ? "✓ 已載入本機進度" : "✓ 新存檔已建立";

  return {
    render,
    snapshot: () => clone(state),
    recordShift: (summary) => commit(recordClinicShift(state, summary)),
    recordExpedition: (expedition, event) => commit(recordExpeditionProgress(state, expedition, event)),
    resupplyExpeditionFocus: () => commit(resupplyExpeditionFocus(state))
  };
}
