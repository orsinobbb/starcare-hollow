import {
  EXPEDITION_FOCUS_MAX,
  canExcavate,
  createExpeditionState,
  excavate,
  isInBounds,
  recoverExpeditionFocus,
  regionAt,
  terrainAt
} from "./expedition-engine.js";
import {
  COMMISSION_MOONLEAF_COST,
  EXPEDITION_FOCUS_MOONLEAF_COST,
  EXPEDITION_FOCUS_RESTORE,
  MINIMUM_DAILY_WISHES_FOR_REST
} from "./town.js";
import { ExpeditionRenderer } from "./expedition-renderer.js";

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
  let queuedTile = null;
  let recoveryTimer = null;
  const ui = {
    view: element("#expedition-view"),
    focus: element("#expedition-focus"),
    recovery: element("#expedition-recovery"),
    relics: element("#expedition-relics"),
    progress: element("#expedition-progress"),
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
    controls: element("#expedition-map-controls")
  };

  const renderer = new ExpeditionRenderer(canvas, {
    onExcavate: (tile) => requestExcavate(tile.x, tile.y),
    onFocusTile: (tile) => {
      selectedTile = tile;
      renderSelection();
    },
    onMove: ({ stage }) => {
      const copy = {
        walk: ["♟", "她正走向你指定的位置；途中仍可改目的地，或點亮起的星標開始挖掘。"],
        queued: ["◎", "移動位置已記住；這一鏟的成果完整顯現後，她就會出發。"],
        arrive: ["✦", "已到達指定位置。點空地可繼續走，點亮起的星標可開始挖掘。"]
      };
      const [icon, text] = copy[stage] ?? ["♟", "挖礦者正在移動。"];
      updateStage(stage, icon, text);
    },
    onStage: ({ stage, event }) => {
      const stageCopy = {
        walk: ["♟", "挖礦者正走向標記地點。"],
        aim: ["⌁", "先讓鏟尖定位，準備翻開眼前的地貌。"],
        impact: ["✦", "鏟尖落下，地層正在鬆動。"],
        reveal: ["◌", `正在翻開${event.terrain.name}，請看清楚地表回應。`],
        discovery: ["✧", `星光浮現：${event.discovery?.name ?? "遺物"} 正在顯影！`],
        reward: ["＋", `成果浮現：${formatReward(event.reward)} 正在交到你的行囊。`],
        settle: ["✓", "地層穩定中，遠征成果即將收下。"]
      };
      const [icon, text] = stageCopy[stage] ?? ["⌁", "遠征進行中。"];
      updateStage(stage, icon, text);
    }
  });

  function updateStage(stage, icon, text) {
    if (!ui.stage) return;
    ui.stage.dataset.stage = stage;
    ui.stage.innerHTML = `<span aria-hidden="true">${icon}</span><p>${text}</p>`;
  }

  function selectedTerrain() {
    return terrainAt(state, selectedTile.x, selectedTile.y);
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
    const permission = canExcavate(state, selectedTile.x, selectedTile.y);
    const focusRecovery = recoverExpeditionFocus(state);
    const location = locationNameFor(selectedTile.x, selectedTile.y);
    if (ui.selected) ui.selected.textContent = location;
    const queued = queuedTile && queuedTile.x === selectedTile.x && queuedTile.y === selectedTile.y;
    if (ui.selectedDetail) {
      ui.selectedDetail.textContent = isAnimating
        ? queued
          ? `${location} 已標記為下一鏟；目前這一鏟的獎勵正在完整顯現。`
          : `正在翻開地貌；現在可輕觸另一個可達星標，預約下一鏟。`
        : permission.ok
        ? `${terrain.name}地貌 · 踏查消耗 ${terrain.cost} 專注`
        : permission.reason === "focus"
        ? `${permission.message} ${countdownText(focusRecovery.remainingMs)} 後自然回復 +1；月芽暖茶只是在想立刻前進時的選用補給。`
        : permission.message;
    }
    if (ui.queue) {
      ui.queue.textContent = queuedTile
        ? `下一鏟：${locationNameFor(queuedTile.x, queuedTile.y)}（可改選另一個可達星標）`
        : isAnimating
        ? "下一鏟：現在可標記一個可達星標"
        : "下一鏟：尚未標記";
    }
    if (ui.dig) {
      ui.dig.disabled = !permission.ok;
      ui.dig.textContent = isAnimating
        ? permission.ok
          ? queued ? `已預約下一鏟：${terrain.name}` : `預約下一鏟：${terrain.name}（-${terrain.cost}）`
          : "這裡目前還不能前往"
        : permission.ok
        ? `前往${location.split(" · ")[1]}踏查（-${terrain.cost}）`
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

  function render() {
    const recovery = synchronizePassiveFocus();
    const found = state.foundTargetIds.length;
    if (ui.focus) ui.focus.textContent = `${state.focus} / ${EXPEDITION_FOCUS_MAX}`;
    renderRecovery(recovery);
    if (ui.relics) ui.relics.textContent = `${found} / ${state.targets.length}`;
    const explored = Math.max(0, state.revealed.length - 1);
    if (ui.progress) ui.progress.textContent = `已踏查 ${explored} 處`;
    if (ui.clueTitle) ui.clueTitle.textContent = state.lastClue.title;
    if (ui.clueDetail) ui.clueDetail.textContent = state.lastClue.detail;
    if (ui.compass) ui.compass.dataset.clue = state.lastClue.level;
    canvas.setAttribute("aria-label", `穹星礦場踏查地圖。已踏查 ${explored} 處，找到 ${found} / ${state.targets.length} 件主要遺物。輕觸空地可移動；輕觸亮起星標可挖掘。使用方向鍵選擇礦點，Enter 踏查。`);
    renderer.setState(state);
    renderSelection();
    renderSupply(recovery);
  }

  function resupplyFocus() {
    if (isAnimating) {
      onNotify("請先讓這一鏟的結果完整顯現，再補給羅盤。");
      return { ok: false, state, message: "挖掘演出進行中。" };
    }
    const result = townController.resupplyExpeditionFocus();
    if (result.ok) {
      state = result.state.expedition;
      renderer.setState(state);
      updateStage("supply", "❧", `月芽暖茶融入羅盤：專注回復 ${result.delta.expeditionFocus} 點。`);
      if (ui.log) ui.log.textContent = result.message;
    }
    render();
    return result;
  }

  function queueExcavation(x, y) {
    synchronizePassiveFocus();
    const permission = canExcavate(state, x, y);
    if (!permission.ok) {
      renderer.playReaction(permission.reason);
      const message = permission.reason === "focus"
        ? `${permission.message} ${countdownText(recoverExpeditionFocus(state).remainingMs)} 後自然回復 +1。`
        : permission.message;
      if (ui.log) ui.log.textContent = message;
      onNotify(message);
      return { ok: false, state, message, event: null };
    }
    queuedTile = { x, y };
    selectedTile = { x, y };
    renderer.setQueuedTile(queuedTile);
    updateStage("queued", "⌁", `下一鏟已標記：${locationNameFor(x, y)}。目前成果完整顯現後會立刻出發。`);
    if (ui.log) ui.log.textContent = `下一鏟已預約至${locationNameFor(x, y)}。`;
    renderSelection();
    return { ok: true, state, message: "下一鏟已標記。", event: null, queued: true };
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
    selectedTile = { x, y };
    renderer.setState(state);
    renderer.setQueuedTile(queuedTile);
    renderSelection();
    updateStage("aim", "⌁", "鏟尖正在定位；這次翻開會先呈現完整的地層反應。");
    if (ui.log) ui.log.textContent = `挖礦者正前往${locationNameFor(x, y)}…`;
    await renderer.playExcavation({ x, y }, result.event);

    const townResult = townController.recordExpedition(state, { ...result.event, message: result.message });
    state = townResult.state.expedition;
    isAnimating = false;
    render();
    if (ui.log) ui.log.textContent = result.message;
    updateStage("complete", result.event.type === "discovery" ? "✧" : "✓", result.event.type === "discovery"
      ? `已收下「${result.event.discovery.name}」；它已記入星願手札。`
      : `${result.event.terrain.name} 已保存，羅盤也已更新。`);
    onNotify(result.event.completed
      ? "星砂群島的主要寶物已全數找回；地圖與收藏都會永久保留。"
      : result.message, result.event.type === "discovery" ? 3200 : 1800);

    const nextTile = queuedTile;
    queuedTile = null;
    renderer.setQueuedTile(null);
    if (nextTile) {
      const permission = canExcavate(state, nextTile.x, nextTile.y);
      if (permission.ok) return beginExcavation(nextTile.x, nextTile.y);
      onNotify(`下一鏟的路徑已改變：${permission.message}`);
    }
    return result;
  }

  function requestExcavate(x, y) {
    synchronizePassiveFocus();
    if (isAnimating) return queueExcavation(x, y);
    return beginExcavation(x, y);
  }

  function moveSelection(dx, dy) {
    selectedTile = {
      x: clamp(selectedTile.x + dx, 0, state.width - 1),
      y: clamp(selectedTile.y + dy, 0, state.height - 1)
    };
    renderer.setKeyboardTile(selectedTile.x, selectedTile.y);
    renderSelection();
  }

  element("#expedition-dig")?.addEventListener("click", () => requestExcavate(selectedTile.x, selectedTile.y));
  ui.resupply?.addEventListener("click", resupplyFocus);
  ui.openSupply?.addEventListener("click", () => setSupplyOpen(true));
  ui.closeSupply?.addEventListener("click", () => setSupplyOpen(false));
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
