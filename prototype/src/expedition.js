import { canExcavate, createExpeditionState, excavate, isInBounds, terrainAt } from "./expedition-engine.js";
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
    log: element("#expedition-log"),
    compass: element("#expedition-compass")
  };

  const renderer = new ExpeditionRenderer(canvas, {
    onExcavate: (tile) => attemptExcavate(tile.x, tile.y),
    onFocusTile: (tile) => {
      selectedTile = tile;
      renderSelection();
    }
  });

  function selectedTerrain() {
    return terrainAt(state, selectedTile.x, selectedTile.y);
  }

  function renderSelection() {
    if (!isInBounds(state, selectedTile.x, selectedTile.y)) selectedTile = { x: 0, y: 0 };
    const terrain = selectedTerrain();
    const permission = canExcavate(state, selectedTile.x, selectedTile.y);
    if (ui.selected) ui.selected.textContent = `座標 ${selectedTile.x + 1} · ${selectedTile.y + 1}`;
    if (ui.selectedDetail) {
      ui.selectedDetail.textContent = permission.ok
        ? `${terrain.name} · 調查消耗 ${terrain.cost} 專注`
        : permission.message;
    }
    if (ui.dig) {
      ui.dig.disabled = !permission.ok;
      ui.dig.textContent = permission.ok ? `調查 ${terrain.name}（-${terrain.cost}）` : "此格目前不能調查";
    }
  }

  function render() {
    const found = state.foundTargetIds.length;
    if (ui.focus) ui.focus.textContent = `${state.focus} / 30`;
    if (ui.relics) ui.relics.textContent = `${found} / ${state.targets.length}`;
    if (ui.progress) ui.progress.textContent = `已調查 ${state.revealed.length} 格`;
    if (ui.clueTitle) ui.clueTitle.textContent = state.lastClue.title;
    if (ui.clueDetail) ui.clueDetail.textContent = state.lastClue.detail;
    if (ui.compass) ui.compass.dataset.clue = state.lastClue.level;
    canvas.setAttribute("aria-label", `星砂群島探索地圖。已調查 ${state.revealed.length} 格，找到 ${found} / ${state.targets.length} 件主要寶物。使用方向鍵移動選格，Enter 調查。`);
    renderer.setState(state);
    renderSelection();
  }

  function attemptExcavate(x, y) {
    const result = excavate(state, x, y);
    if (!result.ok) {
      if (ui.log) ui.log.textContent = result.message;
      onNotify(result.message);
      renderSelection();
      return result;
    }

    state = result.state;
    selectedTile = { x, y };
    const townResult = townController.recordExpedition(state, { ...result.event, message: result.message });
    state = townResult.state.expedition;
    if (ui.log) ui.log.textContent = result.message;
    render();
    renderer.celebrate({ x, y }, result.event.type);
    if (result.event.completed) onNotify("星砂群島的主要寶物已全數找回；地圖與收藏都會永久保留。", 3200);
    return result;
  }

  function moveSelection(dx, dy) {
    selectedTile = {
      x: clamp(selectedTile.x + dx, 0, state.width - 1),
      y: clamp(selectedTile.y + dy, 0, state.height - 1)
    };
    renderer.setKeyboardTile(selectedTile.x, selectedTile.y);
    renderSelection();
  }

  element("#expedition-dig")?.addEventListener("click", () => attemptExcavate(selectedTile.x, selectedTile.y));
  element("#expedition-map-controls")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-expedition-move]");
    if (!button) return;
    const [dx, dy] = button.dataset.expeditionMove.split(",").map(Number);
    moveSelection(dx, dy);
  });
  element("#expedition-return")?.addEventListener("click", onLeave);

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
    destroy: () => renderer.destroy()
  };
}
