import { APP_VERSION, SAVE_SCHEMA_VERSION } from "./version.js";

export const TOWN_SAVE_KEY = "starcare-hollow:town:v1";
export const TOWN_BACKUP_KEY = "starcare-hollow:town:backup";
export const TOWN_SCHEMA_VERSION = SAVE_SCHEMA_VERSION;
export const TOWN_GAME_VERSION = APP_VERSION;
export const DISTRICT_RESTORATION_GOAL = 30;

export const RESOURCE_LABELS = {
  coins: "星幣",
  moonleaf: "月芽葉",
  timber: "暖木",
  starlight: "星砂"
};

export const BUILDINGS = {
  clinic: {
    name: "暖星療癒所",
    maxLevel: 3,
    costs: {
      2: { coins: 120, moonleaf: 4 },
      3: { coins: 240, timber: 5, starlight: 4 }
    },
    benefit: (level) => `每次值班額外獲得 ${Math.max(0, level - 1) * 8} 星幣`
  },
  garden: {
    name: "月芽藥園",
    maxLevel: 3,
    costs: {
      2: { coins: 90, timber: 2 },
      3: { coins: 180, timber: 4, starlight: 3 }
    },
    benefit: (level) => `每日可採收 ${level + 2} 片月芽葉`
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
  { id: "commission", title: "完成居民委託", detail: "交付 3 片月芽葉" },
  { id: "clinic", title: "守住療癒所", detail: "完成一個診療班次" }
];

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
    category: "療癒紀錄",
    name: "暖星值班章",
    detail: "不論成績高低，這枚章記得你守過的一次班。",
    hint: "完成第一次療癒所值班"
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
      harvests: 0,
      commissions: 0,
      upgrades: 0,
      dailyRewards: 0
    },
    history: {
      rewardedShiftIds: []
    },
    updatedAt: null
  };
}

export function normalizeTownState(raw) {
  const fallback = createTownState();
  if (!raw || typeof raw !== "object" || ![1, TOWN_SCHEMA_VERSION].includes(raw.schemaVersion)) return fallback;

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
  if (itemId === "restorer-pin") return state.lifetime.upgrades >= 1;
  if (itemId === "three-wish-medal") return state.lifetime.dailyRewards >= 1;
  if (itemId === "lantern-keepsake") return state.restoration >= 10;
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
  const cost = { moonleaf: 3 };
  if (!canAfford(state, cost)) return outcome(state, false, "還需要 3 片月芽葉；先去藥園採收。");

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

export function recordClinicShift(state, { id, served = 0, stars = 0, score = 0 } = {}) {
  const shiftId = typeof id === "string" && id ? id : null;
  if (!shiftId) return outcome(state, false, "這次班次缺少識別碼，沒有重複發放獎勵。");
  if (state.history.rewardedShiftIds.includes(shiftId)) {
    return outcome(state, false, "這次班次的獎勵已經領取。");
  }

  const next = clone(state);
  const safeServed = integer(served);
  const safeStars = Math.min(3, integer(stars));
  const safeScore = integer(score);
  const coins = 12 + safeServed * 6 + safeStars * 7 + Math.max(0, next.buildings.clinic - 1) * 8;
  const starlight = safeStars > 0 ? 1 + Math.floor(safeStars / 3) : 0;
  const firstClinicToday = !next.daily.clinic;
  const restoration = firstClinicToday ? 1 + safeStars : 0;

  next.resources.coins += coins;
  next.resources.starlight += starlight;
  next.restoration += restoration;
  next.daily.clinic = true;
  next.lifetime.shifts += 1;
  next.lifetime.served += safeServed;
  next.history.rewardedShiftIds.push(shiftId);
  next.history.rewardedShiftIds = next.history.rewardedShiftIds.slice(-40);

  return collectionOutcome(state, next, `值班成果已帶回小鎮：星幣 +${coins}${starlight ? `、星砂 +${starlight}` : ""}。`, {
    coins,
    starlight,
    restoration,
    score: safeScore
  });
}

export function claimDailyReward(state) {
  if (state.daily.rewardClaimed) return outcome(state, false, "今天的星願禮已經領取。");
  if (completedWishCount(state) < DAILY_WISHES.length) {
    return outcome(state, false, "完成三項星願後，就能領取今天的修復禮。");
  }

  const next = clone(state);
  next.resources.coins += 60;
  next.resources.timber += 2;
  next.resources.starlight += 1;
  next.restoration += 3;
  next.daily.rewardClaimed = true;
  next.lifetime.dailyRewards += 1;
  return collectionOutcome(state, next, "三枚星願章已集齊：獲得 60 星幣、2 份暖木與 1 份星砂。", {
    coins: 60,
    timber: 2,
    starlight: 1,
    restoration: 3
  });
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
  return { title: "第一盞燈正亮起", detail: "照顧居民、完成委託，讓暖燈坡逐步甦醒。", rank: "初亮" };
}

export function createTownController({ root = document, storage = globalThis.localStorage, onEnterClinic, onNotify } = {}) {
  let state = loadTownState(storage);
  let recentCollectionIds = [];
  const notify = typeof onNotify === "function" ? onNotify : () => {};
  const enterClinic = typeof onEnterClinic === "function" ? onEnterClinic : () => {};
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
      item.innerHTML = `<span class="wish-check" aria-hidden="true">${completed ? "✓" : "✦"}</span><span><strong>${wish.title}</strong><small>${wish.detail}</small></span>`;
      ui.wishList?.append(item);
    }

    const count = completedWishCount(state);
    if (ui.wishCount) ui.wishCount.textContent = `${count} / ${DAILY_WISHES.length}`;
    if (ui.claimReward) {
      ui.claimReward.disabled = count < DAILY_WISHES.length || state.daily.rewardClaimed;
      ui.claimReward.textContent = state.daily.rewardClaimed ? "今日星願禮已領取" : "領取三章修復禮";
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
    if (ui.gardenAction) {
      ui.gardenAction.disabled = state.daily.garden;
      ui.gardenAction.textContent = state.daily.garden ? "今日已採收" : `採收 ${state.buildings.garden + 2} 片月芽葉`;
    }
    if (ui.commissionAction) {
      ui.commissionAction.disabled = state.daily.commission;
      ui.commissionAction.textContent = state.daily.commission ? "今日已送達" : "交付 3 片月芽葉";
    }
    if (ui.lifetime) {
      ui.lifetime.textContent = `已完成 ${state.lifetime.shifts} 班 · 照顧 ${state.lifetime.served} 位居民 · 升級 ${state.lifetime.upgrades} 次`;
    }
    renderBuildings();
    renderWishes();
    renderCollections();
  }

  element("#enter-clinic")?.addEventListener("click", enterClinic);
  element("#clinic-building-action")?.addEventListener("click", enterClinic);
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
    recordShift: (summary) => commit(recordClinicShift(state, summary))
  };
}
