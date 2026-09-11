import {
  EXPEDITION_FOCUS_MAX,
  EXPEDITION_MAPS,
  activeMap,
  canEnterDoor,
  canExcavate,
  createExpeditionState,
  doorAt,
  enterDoor,
  excavate,
  isInBounds,
  isRevealed,
  recoverExpeditionFocus,
  regionAt,
  terrainAt,
  tileKey
} from "./expedition-engine.js";
import {
  COMMISSION_MOONLEAF_COST,
  EXPEDITION_FOCUS_MOONLEAF_COST,
  EXPEDITION_FOCUS_RESTORE,
  MINIMUM_DAILY_WISHES_FOR_REST
} from "./town.js";
import { ExpeditionRenderer } from "./expedition-renderer.js";

const EXPEDITION_TUTORIAL_KEY = "starcare-expedition-tutorial-v1";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function countdownText(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function createExpeditionController({ root = document, townController, onLeave = () => {}, onNotify = () => {} } = {}) {
  const element = (selector) => root.querySelector(selector);
  const canvas = element("#expedition-canvas");
  if (!canvas || !townController) return null;

  let state = townController.snapshot().expedition ?? createExpeditionState();
  let selectedTile = { x: 1, y: 0 };
  let isAnimating = false;
  let recoveryTimer = null;
  const currentRunByMap = new Map();
  const ui = {
    view: element("#expedition-view"),
    focus: element("#expedition-focus"),
    recovery: element("#expedition-recovery"),
    relics: element("#expedition-relics"),
    progress: element("#expedition-progress"),
    mapName: element("#expedition-map-name"),
    keys: element("#expedition-keys"),
    clueTitle: element("#expedition-clue-title"),
    clueDetail: element("#expedition-clue-detail"),
    selected: element("#expedition-selected"),
    selectedDetail: element("#expedition-selected-detail"),
    queue: element("#expedition-queue"),
    dig: element("#expedition-dig"),
    supplyDetail: element("#expedition-supply-detail"),
    supplySource: element("#expedition-supply-source"),
    resupply: element("#expedition-resupply"),
    supplyPanel: element("#expedition-supply-panel"),
    openSupply: element("#expedition-open-supply"),
    closeSupply: element("#expedition-close-supply"),
    log: element("#expedition-log"),
    compass: element("#expedition-compass"),
    stage: element("#expedition-stage"),
    controls: element("#expedition-map-controls"),
    mission: element("#expedition-mission"),
    objectiveTitle: element("#expedition-objective-title"),
    objectiveDetail: element("#expedition-objective-detail"),
    stepDig: element("#expedition-step-dig"),
    stepKey: element("#expedition-step-key"),
    stepDoor: element("#expedition-step-door"),
    tutorial: element("#expedition-tutorial"),
    tutorialStart: element("#expedition-tutorial-start"),
    help: element("#expedition-help"),
    playerLevel: element("#expedition-player-level"),
    playerXpBar: element("#expedition-player-xp-bar"),
    playerFocusBar: element("#expedition-player-focus-bar"),
    resourceCoins: element("#expedition-resource-coins b"),
    resourceMoonleaf: element("#expedition-resource-moonleaf b"),
    resourceTimber: element("#expedition-resource-timber b"),
    resourceStarlight: element("#expedition-resource-starlight b"),
    openBag: element("#expedition-open-bag"),
    bagPanel: element("#expedition-bag-panel"),
    closeBag: element("#expedition-close-bag"),
    bagGrid: element("#expedition-bag-grid"),
    keyGrid: element("#expedition-key-grid"),
    openCollection: element("#expedition-open-collection"),
    collectionPanel: element("#expedition-collection-panel"),
    closeCollection: element("#expedition-close-collection"),
    collectionSummary: element("#expedition-collection-summary"),
    collectionGrid: element("#expedition-collection-grid"),
    rewardCard: element("#expedition-reward-card"),
    rewardIcon: element("#expedition-reward-icon"),
    rewardTitle: element("#expedition-reward-title"),
    rewardDetail: element("#expedition-reward-detail"),
    lootLayer: element("#expedition-loot-flight-layer"),
    completeOverlay: element("#expedition-complete-overlay"),
    completeRelics: element("#expedition-complete-relics"),
    completeClose: element("#expedition-complete-close")
  };

  const renderer = new ExpeditionRenderer(canvas, {
    onExcavate: (tile) => requestExcavate(tile.x, tile.y),
    onEnterDoor: (tile) => requestDoor(tile.x, tile.y),
    onFocusTile: (tile) => {
      selectedTile = tile;
      renderSelection();
    },
    onMove: ({ stage, destination }) => {
      let [icon, text] = {
        walk: ["♟", "正前往指定位置；移動途中點別處，可以立即改道。"],
        reroute: ["↝", "收到新指令，已轉向新的目的地。"],
        locked: ["⛏", "正在挖掘，現在不能移動。成果收入背包後即可繼續。"]
      }[stage] ?? ["♟", "挖礦者正在移動。"];
      if (stage === "arrive" && destination) {
        const x = clamp(Math.round(destination.x), 0, state.width - 1);
        const y = clamp(Math.round(destination.y), 0, state.height - 1);
        selectedTile = { x, y };
        const revealed = isRevealed(state, x, y);
        const permission = canExcavate(state, x, y);
        [icon, text] = revealed
          ? ["✓", `已抵達${locationNameFor(x, y)}：這裡已挖掘，地貌已保存，不必重挖。`]
          : permission.ok
          ? ["✦", `已抵達${locationNameFor(x, y)}：這裡尚未挖掘，點發光星標開始落鏟。`]
          : ["◎", `已抵達${locationNameFor(x, y)}；請尋找鄰近的發光星標。`];
        renderSelection();
      }
      updateStage(stage, icon, text);
    },
    onStage: ({ stage, event, tile }) => {
      const stageCopy = {
        walk: ["♟", "挖礦者正走向標記地點。"],
        aim: ["⌁", "先讓鏟尖定位，準備翻開眼前的地貌。"],
        impact: ["✦", "鏟尖落下，地層正在鬆動。"],
        reveal: ["◌", `正在翻開${event.terrain.name}，請看清楚地表回應。`],
        discovery: ["✧", `星光浮現：${event.discovery?.name ?? "遺物"} 正在顯影！`],
        key: ["🔑", `${event.key?.name ?? "鑰匙"}從土層升起，石門的鎖紋正與它共鳴！`],
        door: ["門", "鑰匙與石門共鳴；通往下一層的道路正在展開。"],
        reward: ["＋", `成果浮現：${formatReward(event.reward)} 正在交到你的行囊。`],
        settle: ["✓", "地層穩定中，遠征成果即將收下。"]
      };
      const [icon, text] = stageCopy[stage] ?? ["⌁", "遠征進行中。"];
      updateStage(stage, icon, text);
      if (stage === "reward") showReward(event, tile);
      if (stage === "settle") hideReward();
    }
  });

  function updateStage(stage, icon, text) {
    if (!ui.stage) return;
    ui.stage.dataset.stage = stage;
    ui.stage.innerHTML = `<span aria-hidden="true">${icon}</span><p>${text}</p>`;
  }

  const resourceMeta = {
    coins: { icon: "✦", label: "星幣" },
    moonleaf: { icon: "🌿", label: "月芽葉" },
    timber: { icon: "▰", label: "暖木" },
    starlight: { icon: "✧", label: "星光" }
  };

  function setOverlay(panel, open, focusTarget) {
    if (!panel) return;
    panel.hidden = !open;
    if (open) window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), 0);
    else canvas.focus({ preventScroll: true });
  }

  function renderBag(town = townController.snapshot()) {
    if (ui.bagGrid) ui.bagGrid.innerHTML = Object.entries(resourceMeta).map(([id, meta]) => `
      <article data-resource="${id}"><span aria-hidden="true">${meta.icon}</span><strong>${town.resources[id] ?? 0}</strong><small>${meta.label}</small></article>
    `).join("");
    if (ui.keyGrid) {
      const keys = Object.values(EXPEDITION_MAPS).map((map) => map.key).filter(Boolean);
      ui.keyGrid.innerHTML = keys.map((key) => {
        const found = state.collectedKeyIds.includes(key.id);
        return `<article class="${found ? "is-found" : "is-unknown"}"><span aria-hidden="true">${found ? key.icon : "?"}</span><div><strong>${found ? key.name : "尚未發現的鑰匙"}</strong><small>${found ? "永久持有，不會消耗" : "在礦層中繼續探索"}</small></div></article>`;
      }).join("");
    }
  }

  function renderCollection() {
    const found = new Set(state.foundTargetIds);
    if (ui.collectionSummary) ui.collectionSummary.textContent = `已找到 ${found.size} / ${state.targets.length} 件主要寶物`;
    if (ui.collectionGrid) ui.collectionGrid.innerHTML = state.targets.map((target, index) => {
      const collected = found.has(target.id);
      return `<article class="${collected ? "is-found" : "is-unknown"}"><span aria-hidden="true">${collected ? target.icon : "?"}</span><div><small>寶物 ${index + 1}</small><strong>${collected ? target.name : "未知寶物"}</strong><p>${collected ? "已永久收入星脈寶物簿" : "輪廓仍被星霧遮住"}</p></div></article>`;
    }).join("");
  }

  function flyLoot(icon, tile, target) {
    if (!ui.lootLayer || !tile || !target) return;
    const from = renderer.tileClientPosition(tile.x, tile.y);
    const rect = target.getBoundingClientRect();
    const loot = document.createElement("span");
    loot.className = "expedition-loot-flight";
    loot.textContent = icon;
    loot.style.setProperty("--loot-x", `${from.x}px`);
    loot.style.setProperty("--loot-y", `${from.y}px`);
    loot.style.setProperty("--loot-dx", `${rect.left + rect.width / 2 - from.x}px`);
    loot.style.setProperty("--loot-dy", `${rect.top + rect.height / 2 - from.y}px`);
    ui.lootLayer.append(loot);
    loot.addEventListener("animationend", () => loot.remove(), { once: true });
  }

  function showReward(event, tile) {
    if (!ui.rewardCard || ui.rewardCard.dataset.eventId === `${state.digs}:${tile?.x}:${tile?.y}`) return;
    ui.rewardCard.dataset.eventId = `${state.digs}:${tile?.x}:${tile?.y}`;
    const special = event.type === "discovery" ? event.discovery : event.type === "key" ? event.key : null;
    ui.rewardIcon.textContent = special?.icon ?? event.terrain.symbol ?? "✦";
    ui.rewardTitle.textContent = special ? `發現 ${special.name}` : `挖出 ${event.terrain.name}`;
    ui.rewardDetail.textContent = `${formatReward(event.reward)} · 將自動收入背包`;
    ui.rewardCard.hidden = false;
    ui.rewardCard.classList.remove("is-showing");
    void ui.rewardCard.offsetWidth;
    ui.rewardCard.classList.add("is-showing");
    window.setTimeout(() => {
      if (special) flyLoot(special.icon, tile, event.type === "discovery" ? ui.openCollection : ui.openBag);
      for (const [resource, amount] of Object.entries(event.reward ?? {})) {
        const target = element(`#expedition-resource-${resource}`) ?? ui.openBag;
        const meta = resourceMeta[resource] ?? { icon: "+" };
        for (let index = 0; index < Math.min(3, amount); index += 1) {
          window.setTimeout(() => flyLoot(meta.icon, tile, target), index * 110);
        }
      }
    }, 1450);
  }

  function hideReward() {
    if (!ui.rewardCard) return;
    ui.rewardCard.hidden = true;
    ui.rewardCard.classList.remove("is-showing");
    delete ui.rewardCard.dataset.eventId;
  }

  function showCollectionComplete() {
    if (!ui.completeOverlay) return;
    ui.completeRelics.innerHTML = state.targets.map((target) => `<span>${target.icon}<small>${target.name}</small></span>`).join("");
    setOverlay(ui.completeOverlay, true, ui.completeClose);
  }

  function selectedTerrain() {
    return terrainAt(state, selectedTile.x, selectedTile.y);
  }

  function renderedState() {
    return {
      ...state,
      currentRunRevealed: [...(currentRunByMap.get(state.activeMapId) ?? [])]
    };
  }

  function locationNameFor(x, y) {
    const region = regionAt(state, x, y);
    const localities = {
      shore: ["入口營地", "潮痕淺層", "貝礦堆", "暖砂礦帶", "潮池礦壁"],
      grove: ["藤根坑道", "月藤支脈", "螢葉支坑", "露珠礦室", "花蔭斷層"],
      ridge: ["碎星斷崖", "晶脈坡", "雲階岩壁", "回聲礦脈", "高地望台"]
    };
    const names = localities[region.id] ?? localities.shore;
    const locality = names[(x * 3 + y * 5) % names.length];
    return `${region.name} · ${locality}`;
  }

  function formatReward(reward = {}) {
    const labels = { coins: "星幣", moonleaf: "月芽葉", timber: "暖木", starlight: "星光" };
    const text = Object.entries(reward)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([resource, amount]) => `${labels[resource] ?? resource} +${amount}`)
      .join(" · ");
    return text || "小鎮材料";
  }

  function synchronizePassiveFocus(now = Date.now()) {
    const recovery = recoverExpeditionFocus(state, now);
    if (recovery.recovered > 0) {
      const result = townController.recordExpedition(recovery.state, {
        type: "focus-recovery",
        recovered: recovery.recovered,
        message: `羅盤隨時間回復 ${recovery.recovered} 點專注。`
      });
      state = result.state.expedition;
      // Recalculate the countdown against the persisted state, while keeping
      // the earned amount for the caller so the renderer can refresh the HUD.
      return { ...recoverExpeditionFocus(state, now), recovered: recovery.recovered };
    }
    return recovery;
  }

  function renderRecovery(recovery = synchronizePassiveFocus()) {
    if (!ui.recovery) return;
    ui.recovery.textContent = state.focus >= EXPEDITION_FOCUS_MAX
      ? "專注充足"
      : `${countdownText(recovery.remainingMs)} 後回復 +1`;
  }

  function setSupplyOpen(open) {
    if (!ui.supplyPanel) return;
    ui.supplyPanel.hidden = !open;
    ui.openSupply?.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      window.setTimeout(() => ui.resupply?.focus({ preventScroll: true }), 0);
    } else {
      canvas.focus({ preventScroll: true });
    }
  }

  function renderSelection() {
    if (!isInBounds(state, selectedTile.x, selectedTile.y)) selectedTile = { x: 0, y: 0 };
    const terrain = selectedTerrain();
    const door = doorAt(state, selectedTile.x, selectedTile.y);
    const doorPermission = door ? canEnterDoor(state, selectedTile.x, selectedTile.y) : null;
    const permission = canExcavate(state, selectedTile.x, selectedTile.y);
    const focusRecovery = recoverExpeditionFocus(state);
    const location = locationNameFor(selectedTile.x, selectedTile.y);
    if (ui.selected) ui.selected.textContent = door ? `${activeMap(state).name} · ${door.name}` : location;
    if (ui.selectedDetail) {
      ui.selectedDetail.textContent = door
        ? doorPermission.ok
          ? `石門已可開啟；進入後，本層進度與鑰匙都會永久保留。`
          : doorPermission.message
        : isAnimating
        ? `鏟尖已落下，現在不能移動或改挖別處；成果收入背包後即可繼續。`
        : permission.ok
        ? `${terrain.name}地貌 · 踏查消耗 ${terrain.cost} 專注`
        : permission.reason === "focus"
        ? `${permission.message} ${countdownText(focusRecovery.remainingMs)} 後自然回復 +1；月芽暖茶只是在想立刻前進時的選用補給。`
        : permission.message;
    }
    if (ui.queue) {
      ui.queue.textContent = isAnimating
        ? "目前狀態：挖掘鎖定 · 三秒成果入袋後恢復操作"
        : "移動規則：走路途中點別處會立即改道；抵達後再決定是否挖掘";
    }
    if (ui.dig) {
      ui.dig.disabled = isAnimating || (door ? !doorPermission.ok : !permission.ok);
      ui.dig.textContent = door
        ? doorPermission.ok
          ? isAnimating ? `挖掘中，暫時不能開門` : `開啟${door.name}`
          : `需要鑰匙才能開門`
        : isAnimating
        ? "⛏ 挖掘中 · 等待成果收入背包"
        : permission.ok
        ? `⛏ 挖掘「${location.split(" · ")[1]}」（-${terrain.cost} 專注）`
        : "這裡目前還不能踏查";
    }
    canvas.setAttribute("aria-busy", String(isAnimating));
  }

  function renderSupply(recovery = synchronizePassiveFocus()) {
    const town = townController.snapshot();
    const moonleaf = town.resources.moonleaf;
    const missing = Math.max(0, EXPEDITION_FOCUS_MAX - state.focus);
    const restored = Math.min(EXPEDITION_FOCUS_RESTORE, missing);
    const full = missing === 0;
    const hasMoonleaf = moonleaf >= EXPEDITION_FOCUS_MOONLEAF_COST;
    const commissionPending = !town.daily.commission;
    const teaDefersCommission = commissionPending && moonleaf - EXPEDITION_FOCUS_MOONLEAF_COST < COMMISSION_MOONLEAF_COST;
    if (ui.supplyDetail) {
      ui.supplyDetail.textContent = full
        ? "羅盤專注充足。每 5 分鐘會自然回復 1 點；把月芽葉留給想立刻多走一段路的時候。"
        : hasMoonleaf
        ? `自然回復：${countdownText(recovery.remainingMs)} 後 +1。你有 ${moonleaf} 片月芽葉，若現在想繼續，可即時回復 ${restored} 點。${teaDefersCommission ? ` 飲用後今日居民委託會改由明日處理；完成任 ${MINIMUM_DAILY_WISHES_FOR_REST} 項星願仍可休息。` : commissionPending ? " 飲用後仍保有今日委託材料。" : " 今日委託已送達，可安心補給。"}`
        : `自然回復：${countdownText(recovery.remainingMs)} 後 +1。現在沒有月芽葉也不會卡關；等候回復即可，或回小鎮的月芽藥園採收。今日委託是選做。`;
    }
    if (ui.supplySource) {
      ui.supplySource.textContent = `月芽葉 ${moonleaf} 片 · ${commissionPending ? `居民委託需要 ${COMMISSION_MOONLEAF_COST} 片（可留明日）` : "今日委託已送達"}`;
    }
    if (ui.resupply) {
      ui.resupply.disabled = isAnimating || full || !hasMoonleaf;
      ui.resupply.textContent = full
        ? "羅盤專注已充足"
        : !hasMoonleaf
        ? "需要 1 片月芽葉"
        : `飲用月芽暖茶（-1 月芽葉，+${restored} 專注）`;
    }
  }

  function completedFloorExit() {
    if (state.completed) return null;
    const testState = { ...state, focus: EXPEDITION_FOCUS_MAX };
    for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) {
      if (canExcavate(testState, x, y).ok) return null;
    }
    const availableDoors = activeMap(state).doors.filter((door) => canEnterDoor(state, door.x, door.y).ok);
    return availableDoors.find((door) => !state.visitedMapIds.includes(door.toMapId)) ?? availableDoors[0] ?? null;
  }

  function nextPlayableTarget() {
    const map = activeMap(state);
    const keyCollected = !map.key || state.collectedKeyIds.includes(map.key.id);
    if (keyCollected) {
      const door = map.doors.find((item) => canEnterDoor(state, item.x, item.y).ok);
      if (door) return { x: door.x, y: door.y, type: "door", name: door.name };
    }
    const testState = { ...state, focus: EXPEDITION_FOCUS_MAX };
    for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) {
      if (canExcavate(testState, x, y).ok) return { x, y, type: "dig", name: locationNameFor(x, y) };
    }
    return null;
  }

  function setGoalState(element, value) {
    if (element) element.dataset.state = value;
  }

  function renderMission() {
    const map = activeMap(state);
    const explored = Math.max(0, state.revealed.length - 1);
    const keyCollected = !map.key || state.collectedKeyIds.includes(map.key.id);
    const doorUnlocked = map.doors.some((door) => state.unlockedDoorIds.includes(door.id));
    const availableDoor = map.doors.find((door) => canEnterDoor(state, door.x, door.y).ok);
    let title = `在${map.name}尋找線索`;
    let detail = "點擊發光的星標挖掘；每一格都有材料、線索或寶物。";

    if (state.completed) {
      title = "主要寶物已全數尋回";
      detail = "遠征完成。成果已永久收進星願手札，可以安心返回小鎮。";
    } else if (map.key && !keyCollected) {
      title = explored === 0 ? `第一步：挖開發光星標` : `繼續挖掘，找出${map.key.name}`;
      detail = explored === 0
        ? "點地圖上的發光星標，或按下方黃色「挖掘」按鈕；挖礦者會走過去並帶回獎勵。"
        : "羅盤會提示寶物遠近；只有發光星標是目前可挖的位置。";
    } else if (availableDoor) {
      title = `鑰匙到手：開啟${availableDoor.name}`;
      detail = "點擊地圖上發光的石門，前往下一個礦層。";
    } else if (map.key) {
      title = `向${map.doors[0]?.name ?? "石門"}前進`;
      detail = "鑰匙已找到；繼續挖亮起的星標，開通前往石門的路。";
    } else {
      title = "搜索星晶秘庫的最後寶物";
      detail = "繼續挖掘發光星標；找到主寶物後即可完成遠征。";
    }

    if (state.focus <= 0 && !state.completed) {
      detail = `專注已用完，${countdownText(recoverExpeditionFocus(state).remainingMs)} 後自然回復 1 點；也可按上方「補給」。`;
    }
    if (ui.objectiveTitle) ui.objectiveTitle.textContent = title;
    if (ui.objectiveDetail) ui.objectiveDetail.textContent = detail;
    setGoalState(ui.stepDig, explored > 0 ? "done" : "current");
    setGoalState(ui.stepKey, keyCollected ? "done" : explored > 0 ? "current" : "pending");
    setGoalState(ui.stepDoor, doorUnlocked || state.completed ? "done" : keyCollected ? "current" : "pending");
  }

  function tutorialSeen() {
    try { return window.localStorage.getItem(EXPEDITION_TUTORIAL_KEY) === "seen"; }
    catch { return false; }
  }

  function setTutorialOpen(open) {
    if (!ui.tutorial) return;
    ui.tutorial.hidden = !open;
    if (open) window.setTimeout(() => ui.tutorialStart?.focus({ preventScroll: true }), 0);
    else canvas.focus({ preventScroll: true });
  }

  function beginGuidedPlay() {
    try { window.localStorage.setItem(EXPEDITION_TUTORIAL_KEY, "seen"); } catch {}
    setTutorialOpen(false);
    const target = nextPlayableTarget();
    if (!target) return;
    selectedTile = { x: target.x, y: target.y };
    renderer.guideToTile(target.x, target.y);
    updateStage("guide", target.type === "door" ? "門" : "☝", target.type === "door"
      ? `點擊發光的${target.name}，前往下一層。`
      : "鏡頭已帶到第一個礦點。點地圖上的發光星標，或按下方黃色「挖掘」按鈕。");
    renderSelection();
  }

  function guideReturningPlayer() {
    const target = nextPlayableTarget();
    if (!target) return;
    selectedTile = { x: target.x, y: target.y };
    renderer.guideToTile(target.x, target.y);
    updateStage("guide", target.type === "door" ? "門" : "☝", target.type === "door"
      ? `下一步：點擊發光的${target.name}，前往下一層。`
      : "下一個可挖位置已經為你亮起。點發光星標，或按下方黃色「挖掘」按鈕。");
    renderSelection();
  }

  function render() {
    const recovery = synchronizePassiveFocus();
    const town = townController.snapshot();
    const found = state.foundTargetIds.length;
    if (ui.focus) ui.focus.textContent = `${state.focus} / ${EXPEDITION_FOCUS_MAX}`;
    if (ui.playerFocusBar) ui.playerFocusBar.style.width = `${(state.focus / EXPEDITION_FOCUS_MAX) * 100}%`;
    const level = 1 + Math.floor(state.digs / 6);
    if (ui.playerLevel) ui.playerLevel.textContent = `Lv.${level}`;
    if (ui.playerXpBar) ui.playerXpBar.style.width = `${((state.digs % 6) / 6) * 100}%`;
    if (ui.resourceCoins) ui.resourceCoins.textContent = town.resources.coins.toLocaleString("zh-Hant");
    if (ui.resourceMoonleaf) ui.resourceMoonleaf.textContent = town.resources.moonleaf;
    if (ui.resourceTimber) ui.resourceTimber.textContent = town.resources.timber;
    if (ui.resourceStarlight) ui.resourceStarlight.textContent = town.resources.starlight;
    renderRecovery(recovery);
    if (ui.relics) ui.relics.textContent = `${found} / ${state.targets.length}`;
    const map = activeMap(state);
    const keyTotal = Object.values(EXPEDITION_MAPS).filter((item) => item.key).length;
    if (ui.mapName) ui.mapName.textContent = `${map.shortName} · ${map.name}`;
    if (ui.keys) ui.keys.textContent = `鑰匙 ${state.collectedKeyIds.length} / ${keyTotal}`;
    const explored = Math.max(0, state.revealed.length - 1);
    if (ui.progress) ui.progress.textContent = `已踏查 ${explored} 處`;
    if (ui.clueTitle) ui.clueTitle.textContent = state.lastClue.title;
    if (ui.clueDetail) ui.clueDetail.textContent = state.lastClue.detail;
    if (ui.compass) ui.compass.dataset.clue = state.lastClue.level;
    renderMission();
    canvas.setAttribute("aria-label", `穹星礦場踏查地圖。已踏查 ${explored} 處，找到 ${found} / ${state.targets.length} 件主要遺物。輕觸空地可移動；輕觸亮起星標可挖掘。使用方向鍵選擇礦點，Enter 踏查。`);
    renderer.setState(renderedState());
    const exit = !isAnimating ? completedFloorExit() : null;
    if (exit && (selectedTile.x !== exit.x || selectedTile.y !== exit.y)) {
      selectedTile = { x: exit.x, y: exit.y };
      renderer.guideToTile(exit.x, exit.y);
      updateStage("exit", "門", `本層已完整踏查；${exit.name}正在發光，請開門前往下一層。`);
      if (ui.log) ui.log.textContent = `已經沒有遺漏的礦點。下一步：開啟${exit.name}。`;
    }
    renderSelection();
    renderSupply(recovery);
    renderBag(town);
    renderCollection();
  }

  function resupplyFocus() {
    if (isAnimating) {
      onNotify("請先讓這一鏟的結果完整顯現，再補給羅盤。");
      return { ok: false, state, message: "挖掘演出進行中。" };
    }
    const result = townController.resupplyExpeditionFocus();
    if (result.ok) {
      state = result.state.expedition;
      renderer.setState(renderedState());
      updateStage("supply", "❧", `月芽暖茶融入羅盤：專注回復 ${result.delta.expeditionFocus} 點。`);
      if (ui.log) ui.log.textContent = result.message;
    }
    render();
    return result;
  }

  function rejectDuringExcavation() {
    const message = "鏟尖已落下，現在不能移動或改挖別處；三秒成果收入背包後即可繼續。";
    renderer.playReaction("blocked");
    updateStage("locked", "⛏", message);
    if (ui.log) ui.log.textContent = message;
    onNotify(message, 1800);
    return { ok: false, state, message, event: null };
  }

  async function beginExcavation(x, y) {
    const result = excavate(state, x, y);
    if (!result.ok) {
      renderer.playReaction(result.reason);
      if (ui.log) ui.log.textContent = result.message;
      onNotify(result.message);
      renderSelection();
      return result;
    }

    isAnimating = true;
    state = result.state;
    if (!currentRunByMap.has(state.activeMapId)) currentRunByMap.set(state.activeMapId, new Set());
    currentRunByMap.get(state.activeMapId).add(tileKey(x, y));
    selectedTile = { x, y };
    renderer.setState(renderedState());
    renderSelection();
    updateStage("aim", "⌁", "鏟尖正在定位；這次翻開會先呈現完整的地層反應。");
    if (ui.log) ui.log.textContent = `挖礦者正前往${locationNameFor(x, y)}…`;
    await renderer.playExcavation({ x, y }, result.event);

    const townResult = townController.recordExpedition(state, { ...result.event, message: result.message });
    state = townResult.state.expedition;
    isAnimating = false;
    render();
    if (ui.log) ui.log.textContent = result.message;
    const upcoming = nextPlayableTarget();
    const nextHint = upcoming
      ? ` 下一個可探索點是${locationNameFor(upcoming.x, upcoming.y)}；等你親自點選後才會移動。`
      : "";
    updateStage("complete", result.event.type === "discovery" ? "✧" : result.event.type === "key" ? "🔑" : "✓",
      result.event.type === "discovery"
        ? `已收下「${result.event.discovery.name}」；它已記入星願手札。${nextHint}`
        : result.event.type === "key"
        ? `已取得「${result.event.key.name}」；現在可前往本層石門。${nextHint}`
        : `${result.event.terrain.name} 已保存，羅盤也已更新。${nextHint}`);
    onNotify(result.event.completed
      ? "星砂群島的主要寶物已全數找回；地圖與收藏都會永久保留。"
      : result.message, result.event.type === "discovery" ? 3200 : 1800);
    if (result.event.completed) showCollectionComplete();
    // 鏡頭穩定原則：成果入袋只能更新 HUD 與提示，不得改變選取格或鏡頭。
    // 下一步必須由玩家親自點選；guideToTile 僅保留給明確按下的教學／提示操作。
    return result;
  }

  function requestExcavate(x, y) {
    synchronizePassiveFocus();
    if (isAnimating) return rejectDuringExcavation();
    return beginExcavation(x, y);
  }

  async function requestDoor(x, y) {
    if (isAnimating) return rejectDuringExcavation();
    const result = enterDoor(state, x, y);
    if (!result.ok) {
      renderer.playReaction(result.reason);
      if (ui.log) ui.log.textContent = result.message;
      onNotify(result.message);
      renderSelection();
      return result;
    }
    isAnimating = true;
    updateStage("door", "門", `挖礦者正走向${result.event.door.name}；鑰匙不會被消耗。`);
    await renderer.playDoorTransition({ x, y }, result.event);
    const townResult = townController.recordExpedition(result.state, { ...result.event, message: result.message });
    state = townResult.state.expedition;
    selectedTile = { ...activeMap(state).entry };
    isAnimating = false;
    renderer.setState(renderedState());
    render();
    updateStage("complete", "✦", `已抵達${activeMap(state).name}；黑暗、邊界陰影與已探索區域會分層顯示。`);
    if (ui.log) ui.log.textContent = result.message;
    onNotify(result.message, 2600);
    return result;
  }

  function requestSelectedAction() {
    return doorAt(state, selectedTile.x, selectedTile.y)
      ? requestDoor(selectedTile.x, selectedTile.y)
      : requestExcavate(selectedTile.x, selectedTile.y);
  }

  function moveSelection(dx, dy) {
    selectedTile = {
      x: clamp(selectedTile.x + dx, 0, state.width - 1),
      y: clamp(selectedTile.y + dy, 0, state.height - 1)
    };
    renderer.setKeyboardTile(selectedTile.x, selectedTile.y);
    renderSelection();
  }

  element("#expedition-dig")?.addEventListener("click", requestSelectedAction);
  ui.resupply?.addEventListener("click", resupplyFocus);
  ui.openSupply?.addEventListener("click", () => setSupplyOpen(true));
  ui.closeSupply?.addEventListener("click", () => setSupplyOpen(false));
  ui.help?.addEventListener("click", () => setTutorialOpen(true));
  ui.tutorialStart?.addEventListener("click", beginGuidedPlay);
  ui.openBag?.addEventListener("click", () => {
    renderBag();
    setOverlay(ui.bagPanel, true, ui.closeBag);
  });
  ui.closeBag?.addEventListener("click", () => setOverlay(ui.bagPanel, false));
  ui.openCollection?.addEventListener("click", () => {
    renderCollection();
    setOverlay(ui.collectionPanel, true, ui.closeCollection);
  });
  ui.closeCollection?.addEventListener("click", () => setOverlay(ui.collectionPanel, false));
  ui.completeClose?.addEventListener("click", () => setOverlay(ui.completeOverlay, false));
  root.addEventListener?.("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!ui.completeOverlay?.hidden) setOverlay(ui.completeOverlay, false);
    else if (!ui.collectionPanel?.hidden) setOverlay(ui.collectionPanel, false);
    else if (!ui.bagPanel?.hidden) setOverlay(ui.bagPanel, false);
  });
  element("#expedition-map-controls")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-expedition-move]");
    if (!button) return;
    const [dx, dy] = button.dataset.expeditionMove.split(",").map(Number);
    moveSelection(dx, dy);
  });
  element("#expedition-return")?.addEventListener("click", () => {
    if (isAnimating) {
      onNotify("請先讓這一鏟的結果完整顯現。");
      return;
    }
    onLeave();
  });

  render();

  return {
    show() {
      renderer.resize();
      renderer.start();
      render();
      if (!tutorialSeen()) setTutorialOpen(true);
      else guideReturningPlayer();
      if (!recoveryTimer) recoveryTimer = window.setInterval(() => {
        const recovery = synchronizePassiveFocus();
        renderRecovery(recovery);
        if (recovery.recovered > 0) render();
      }, 1000);
    },
    hide() {
      renderer.stop();
      if (recoveryTimer) window.clearInterval(recoveryTimer);
      recoveryTimer = null;
    },
    snapshot: () => structuredClone(state),
    excavate: requestExcavate,
    resupply: resupplyFocus,
    destroy: () => {
      if (recoveryTimer) window.clearInterval(recoveryTimer);
      renderer.destroy();
    }
  };
}
