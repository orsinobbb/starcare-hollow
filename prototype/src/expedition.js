import { EXPEDITION_FOCUS_MAX, canExcavate, createExpeditionState, excavate, isInBounds, terrainAt } from "./expedition-engine.js";
import { EXPEDITION_FOCUS_MOONLEAF_COST, EXPEDITION_FOCUS_RESTORE } from "./town.js";
import { ExpeditionRenderer } from "./expedition-renderer.js";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createExpeditionController({ root = document, townController, onLeave = () => {}, onNotify = () => {} } = {}) {
  const element = (selector) => root.querySelector(selector);
  const canvas = element("#expedition-canvas");
  if (!canvas || !townController) return null;

  let state = townController.snapshot().expedition ?? createExpeditionState();
  let selectedTile = { x: 1, y: 0 };
  let isAnimating = false;
  const ui = {
    view: element("#expedition-view"),
    focus: element("#expedition-focus"),
    relics: element("#expedition-relics"),
    progress: element("#expedition-progress"),
    clueTitle: element("#expedition-clue-title"),
    clueDetail: element("#expedition-clue-detail"),
    selected: element("#expedition-selected"),
    selectedDetail: element("#expedition-selected-detail"),
    dig: element("#expedition-dig"),
    supplyDetail: element("#expedition-supply-detail"),
    supplySource: element("#expedition-supply-source"),
    resupply: element("#expedition-resupply"),
    log: element("#expedition-log"),
    compass: element("#expedition-compass"),
    stage: element("#expedition-stage"),
    controls: element("#expedition-map-controls")
  };

  const renderer = new ExpeditionRenderer(canvas, {
    onExcavate: (tile) => attemptExcavate(tile.x, tile.y),
    onFocusTile: (tile) => {
      selectedTile = tile;
      renderSelection();
    },
    onStage: ({ stage, event }) => {
      const stageCopy = {
        aim: ["⌁", "先讓鏟尖定位，準備翻開這一格。"],
        impact: ["✦", "鏟尖落下，地層正在鬆動。"],
        reveal: ["◌", `正在翻開${event.terrain.name}，請看清楚地表回應。`],
        discovery: ["✧", `星光浮現：${event.discovery?.name ?? "遺物"} 正在顯影！`],
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

  function renderSelection() {
    if (!isInBounds(state, selectedTile.x, selectedTile.y)) selectedTile = { x: 0, y: 0 };
    const terrain = selectedTerrain();
    const permission = canExcavate(state, selectedTile.x, selectedTile.y);
    if (ui.selected) ui.selected.textContent = `座標 ${selectedTile.x + 1} · ${selectedTile.y + 1}`;
    if (ui.selectedDetail) {
      ui.selectedDetail.textContent = isAnimating
        ? `${terrain.name} 正在翻開；成果即將在地圖上顯現。`
        : permission.ok
        ? `${terrain.name} · 調查消耗 ${terrain.cost} 專注`
        : permission.reason === "focus"
        ? `${permission.message} 月芽暖茶可回復專注。`
        : permission.message;
    }
    if (ui.dig) {
      ui.dig.disabled = isAnimating || !permission.ok;
      ui.dig.textContent = isAnimating ? "正在翻開地層…" : permission.ok ? `調查 ${terrain.name}（-${terrain.cost}）` : "此格目前不能調查";
    }
    if (ui.controls) {
      for (const button of ui.controls.querySelectorAll("button")) button.disabled = isAnimating;
    }
    canvas.setAttribute("aria-busy", String(isAnimating));
  }

  function renderSupply() {
    const moonleaf = townController.snapshot().resources.moonleaf;
    const missing = Math.max(0, EXPEDITION_FOCUS_MAX - state.focus);
    const restored = Math.min(EXPEDITION_FOCUS_RESTORE, missing);
    const full = missing === 0;
    const hasMoonleaf = moonleaf >= EXPEDITION_FOCUS_MOONLEAF_COST;
    if (ui.supplyDetail) {
      ui.supplyDetail.textContent = full
        ? "羅盤專注充足。把月芽葉留給下一段路；每一次調查仍會完整記入地圖。"
        : hasMoonleaf
        ? `目前有 ${moonleaf} 片月芽葉。現在補給可回復 ${restored} 點專注。`
        : "現在沒有月芽葉。回小鎮的月芽藥園採收；今日已採收時，完成星願並進入下一日。";
    }
    if (ui.supplySource) {
      ui.supplySource.textContent = `月芽葉 ${moonleaf} 片 · 小鎮 → 月芽藥園每日採收`;
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
    const found = state.foundTargetIds.length;
    if (ui.focus) ui.focus.textContent = `${state.focus} / ${EXPEDITION_FOCUS_MAX}`;
    if (ui.relics) ui.relics.textContent = `${found} / ${state.targets.length}`;
    if (ui.progress) ui.progress.textContent = `已調查 ${state.revealed.length} 格`;
    if (ui.clueTitle) ui.clueTitle.textContent = state.lastClue.title;
    if (ui.clueDetail) ui.clueDetail.textContent = state.lastClue.detail;
    if (ui.compass) ui.compass.dataset.clue = state.lastClue.level;
    canvas.setAttribute("aria-label", `星砂群島探索地圖。已調查 ${state.revealed.length} 格，找到 ${found} / ${state.targets.length} 件主要寶物。使用方向鍵移動選格，Enter 調查。`);
    renderer.setState(state);
    renderSelection();
    renderSupply();
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

  async function attemptExcavate(x, y) {
    if (isAnimating) return { ok: false, state, message: "正在完成這一格的挖掘演出。", event: null };
    const result = excavate(state, x, y);
    if (!result.ok) {
      if (ui.log) ui.log.textContent = result.message;
      onNotify(result.message);
      renderSelection();
      return result;
    }

    isAnimating = true;
    state = result.state;
    selectedTile = { x, y };
    renderer.setState(state);
    renderSelection();
    updateStage("aim", "⌁", "鏟尖正在定位；這次翻開會先呈現完整的地層反應。");
    if (ui.log) ui.log.textContent = `準備調查座標 ${x + 1} · ${y + 1}…`;
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
    return result;
  }

  function moveSelection(dx, dy) {
    if (isAnimating) return;
    selectedTile = {
      x: clamp(selectedTile.x + dx, 0, state.width - 1),
      y: clamp(selectedTile.y + dy, 0, state.height - 1)
    };
    renderer.setKeyboardTile(selectedTile.x, selectedTile.y);
    renderSelection();
  }

  element("#expedition-dig")?.addEventListener("click", () => attemptExcavate(selectedTile.x, selectedTile.y));
  ui.resupply?.addEventListener("click", resupplyFocus);
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
    },
    hide() {
      renderer.stop();
    },
    snapshot: () => structuredClone(state),
    excavate: attemptExcavate,
    resupply: resupplyFocus,
    destroy: () => renderer.destroy()
  };
}
