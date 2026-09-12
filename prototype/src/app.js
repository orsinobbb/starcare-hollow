import {
  COMPANION_SKILLS,
  MINI_GAME_MODES,
  SKILL_CHARGE_MAX,
  addSkillCharge,
  createPairDeck,
  createRng,
  createTripleDeck,
  findAvailableGroup,
  formatTime,
  insertTrayCard,
  isMatchingGroup,
  modeForRound,
  nextCombo,
  resolveTray,
  scoreForMatch
} from "./engine.js";
import { createTownController } from "./town.js";
import { createExpeditionController } from "./expedition.js";
import { APP_VERSION } from "./version.js";

const $ = (selector) => document.querySelector(selector);
const modeById = Object.fromEntries(MINI_GAME_MODES.map((mode) => [mode.id, mode]));
const skillById = Object.fromEntries(COMPANION_SKILLS.map((skill) => [skill.id, skill]));

const DIFFICULTIES = {
  comfort: { label: "舒適", pairCount: 4, quickPairCount: 5, tripleCount: 4, preview: 2.8, mistakePenalty: 0 },
  standard: { label: "標準", pairCount: 6, quickPairCount: 7, tripleCount: 5, preview: 2.1, mistakePenalty: 1 },
  focus: { label: "專注", pairCount: 8, quickPairCount: 8, tripleCount: 6, preview: 1.4, mistakePenalty: 2 }
};

const MATCH_CELEBRATION_SECONDS = 0.9;

const params = new URLSearchParams(window.location.search);
const gameDuration = Math.max(15, Math.min(600, Number(params.get("duration")) || 120));
const gameGoal = Math.max(1, Math.min(12, Number(params.get("goal")) || 3));
let seed = params.get("seed") || "warm-lantern-05";
let rng = createRng(seed);
let state = createInitialState("briefing");
let soundEnabled = true;
let audioContext = null;
let lastFrameTime = 0;
let lastHudRender = 0;
let toastTimeout = null;
let helpReturnStatus = "briefing";
let currentShiftId = null;
let townController = null;
let expeditionController = null;

const elements = {
  goalValue: $("#goal-value"),
  roundValue: $("#round-value"),
  timeValue: $("#time-value"),
  mistakeValue: $("#mistake-value"),
  mistakeBar: $("#mistake-bar"),
  modeRoute: $("#mode-route"),
  modeEyebrow: $("#mode-eyebrow"),
  gameTitle: $("#game-title"),
  roundProgress: $("#round-progress"),
  roundRule: $("#round-rule"),
  previewBanner: $("#preview-banner"),
  gameBoard: $("#game-board"),
  trayArea: $("#tray-area"),
  collectionTray: $("#collection-tray"),
  gameFeedback: $("#game-feedback"),
  skillList: $("#skill-list"),
  skillCharge: $(".skill-charge"),
  skillChargeBar: $("#skill-charge-bar"),
  skillChargeValue: $("#skill-charge-value"),
  skillFeedback: $("#skill-feedback"),
  bestComboValue: $("#best-combo-value"),
  matchedValue: $("#matched-value"),
  scoreValue: $("#score-value"),
  shiftMessage: $("#shift-message"),
  briefingModal: $("#briefing-modal"),
  helpModal: $("#help-modal"),
  pauseModal: $("#pause-modal"),
  resultModal: $("#result-modal"),
  pauseButton: $("#pause-button"),
  toggleSound: $("#toggle-sound"),
  toast: $("#toast"),
  townView: $("#town-view"),
  clinicView: $("#clinic-view"),
  expeditionView: $("#expedition-view"),
  townHud: $("#town-hud"),
  shiftHud: $("#shift-hud"),
  expeditionHud: $("#expedition-hud"),
  clinicControls: $("#clinic-controls"),
  townTab: $("#town-tab"),
  clinicTab: $("#clinic-tab"),
  expeditionTab: $("#expedition-tab")
};

function createInitialState(status = "briefing", choices = {}) {
  return {
    status,
    difficulty: choices.difficulty ?? "standard",
    modeChoice: choices.modeChoice ?? "rotation",
    currentMode: "memory",
    duration: gameDuration,
    timeLeft: gameDuration,
    completed: 0,
    round: 1,
    score: 0,
    matched: 0,
    mistakes: 0,
    combo: 0,
    bestCombo: 0,
    skillCharge: 0,
    skillUses: 0,
    shield: 0,
    cards: [],
    tray: [],
    firstCardId: null,
    secondCardId: null,
    locked: false,
    compareRemaining: 0,
    successCelebrations: [],
    completeAfterCelebration: false,
    previewRemaining: 0,
    revealRemaining: 0,
    hintIds: [],
    hintRemaining: 0,
    transitionRemaining: 0,
    actionFeedback: null,
    actionFeedbackTone: "good",
    actionFeedbackRemaining: 0,
    skillFlashId: null,
    skillFlashRemaining: 0,
    message: "委託尚未開始",
    endedBy: null
  };
}

function selectedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function currentMode() {
  return modeById[state.currentMode] ?? MINI_GAME_MODES[0];
}

function announce(message) {
  state.message = message;
  elements.shiftMessage.textContent = message;
}

function showToast(message, duration = 2400) {
  window.clearTimeout(toastTimeout);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.classList.remove("pop-in");
  void elements.toast.offsetWidth;
  elements.toast.classList.add("pop-in");
  toastTimeout = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function setActiveView(view) {
  const townActive = view === "town";
  const clinicActive = view === "clinic";
  const expeditionActive = view === "expedition";
  elements.townView.hidden = !townActive;
  elements.clinicView.hidden = !clinicActive;
  elements.expeditionView.hidden = !expeditionActive;
  elements.townHud.hidden = !townActive;
  elements.shiftHud.hidden = !clinicActive;
  elements.expeditionHud.hidden = !expeditionActive;
  elements.clinicControls.hidden = !clinicActive;
  for (const tab of [elements.townTab, elements.clinicTab, elements.expeditionTab]) tab.removeAttribute("aria-current");
  ({ town: elements.townTab, clinic: elements.clinicTab, expedition: elements.expeditionTab }[view]).setAttribute("aria-current", "page");
  document.body.dataset.view = view;
}

function showTownView() {
  if (state.status === "running" || state.status === "help") {
    showToast("小遊戲進行中；請先暫停再返回小鎮。", 2200);
    return false;
  }
  elements.briefingModal.hidden = true;
  elements.helpModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  expeditionController?.hide();
  setActiveView("town");
  townController?.render();
  window.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

function showClinicView() {
  expeditionController?.hide();
  setActiveView("clinic");
  elements.briefingModal.hidden = state.status !== "briefing";
  elements.pauseModal.hidden = state.status !== "paused";
  elements.resultModal.hidden = state.status !== "result";
  window.scrollTo({ top: 0, behavior: "auto" });
  if (state.status === "briefing") $("#start-button").focus();
  return true;
}

function showExpeditionView() {
  if (state.status === "running" || state.status === "help") {
    showToast("小遊戲進行中；請先暫停再前往遠征。", 2200);
    return false;
  }
  elements.briefingModal.hidden = true;
  elements.helpModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  setActiveView("expedition");
  window.scrollTo({ top: 0, behavior: "auto" });
  expeditionController?.show();
  return true;
}

function resetClinicToBriefing() {
  state = createInitialState("briefing", state);
  currentShiftId = null;
  elements.pauseButton.disabled = true;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  renderAll();
}

function leaveShiftForTown() {
  resetClinicToBriefing();
  showTownView();
  showToast("已返回小鎮；未完成的委託不會消耗任何資源。", 2400);
}

function playTone(frequency, duration = 0.08, volume = 0.035, wave = "sine") {
  if (!soundEnabled) return;
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    soundEnabled = false;
    renderSoundButton();
  }
}

function playMatchSound(combo) {
  const base = Math.min(720, 390 + combo * 30);
  playTone(base, 0.09, 0.04, "triangle");
  window.setTimeout(() => playTone(base * 1.22, 0.13, 0.032, "triangle"), 65);
}

function playSkillSound() {
  playTone(520, 0.12, 0.045, "triangle");
  window.setTimeout(() => playTone(680, 0.15, 0.04, "triangle"), 90);
  window.setTimeout(() => playTone(840, 0.2, 0.035, "sine"), 180);
}

function boardCounts(modeId = state.currentMode) {
  const settings = DIFFICULTIES[state.difficulty];
  if (modeId === "quick-pair") return settings.quickPairCount;
  if (modeId === "triple-pack") return settings.tripleCount;
  return settings.pairCount;
}

function setupRound() {
  state.round = state.completed + 1;
  state.currentMode = modeForRound(state.modeChoice, state.round);
  const count = boardCounts();
  state.cards = state.currentMode === "triple-pack"
    ? createTripleDeck(count, rng)
    : createPairDeck(count, rng);
  state.tray = [];
  state.firstCardId = null;
  state.secondCardId = null;
  state.locked = false;
  state.compareRemaining = 0;
  state.successCelebrations = [];
  state.completeAfterCelebration = false;
  state.previewRemaining = state.currentMode === "memory" ? DIFFICULTIES[state.difficulty].preview : 0;
  state.revealRemaining = 0;
  state.hintIds = [];
  state.hintRemaining = 0;
  state.transitionRemaining = 0;
  const mode = currentMode();
  announce(`${mode.symbol} 第 ${state.round} 關：${mode.title}`);
}

function cardById(cardId) {
  return state.cards.find((card) => card.id === cardId) ?? null;
}

function visibleCards() {
  return state.cards.filter((card) => card.state !== "matched" && card.state !== "in-tray");
}

function isCardCelebrating(cardId) {
  return state.successCelebrations.some((celebration) => celebration.ids.includes(cardId));
}

function cardIsFaceUp(card) {
  if (state.currentMode !== "memory") return true;
  return state.previewRemaining > 0
    || state.revealRemaining > 0
    || isCardCelebrating(card.id)
    || card.id === state.firstCardId
    || card.id === state.secondCardId;
}

function showActionFeedback(text, tone = "good", seconds = 1.1) {
  state.actionFeedback = text;
  state.actionFeedbackTone = tone;
  state.actionFeedbackRemaining = seconds;
  renderFeedback();
}

function applyMistake(message) {
  state.mistakes += 1;
  state.combo = nextCombo(state.combo, false);
  if (state.shield > 0) {
    state.shield -= 1;
    showActionFeedback(`♥ 安心護盾接住了失誤：${message}`, "shield", 1.5);
    return;
  }
  const penalty = DIFFICULTIES[state.difficulty].mistakePenalty;
  state.timeLeft = Math.max(0, state.timeLeft - penalty);
  state.score = Math.max(0, state.score - 15);
  showActionFeedback(`${message}${penalty ? `，時間 -${penalty} 秒` : "，再試一次"}`, "miss", 1.4);
  playTone(230, 0.12, 0.025, "sine");
}

function awardMatch(groupSize, label = "配對成功") {
  state.combo = nextCombo(state.combo, true);
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.matched += 1;
  state.score += scoreForMatch(state.combo, groupSize);
  state.skillCharge = addSkillCharge(state.skillCharge);
  showActionFeedback(`✓ ${label} · 連續 ${state.combo}`, "match", MATCH_CELEBRATION_SECONDS);
  playMatchSound(state.combo);
}

function beginSuccessCelebration(cards, label, groupSize) {
  for (const card of cards) card.state = "matched";
  state.successCelebrations.push({
    ids: cards.map((card) => card.id),
    remaining: MATCH_CELEBRATION_SECONDS
  });
  state.firstCardId = null;
  state.secondCardId = null;
  state.locked = false;
  awardMatch(groupSize, label);
  announce(`${label}！這組正在化成星光；你可以繼續找下一組。`);
  if (boardIsComplete()) state.completeAfterCelebration = true;
}

function tickSuccessCelebrations(delta) {
  if (!state.successCelebrations.length) return;
  const previousCount = state.successCelebrations.length;
  state.successCelebrations = state.successCelebrations
    .map((celebration) => ({ ...celebration, remaining: Math.max(0, celebration.remaining - delta) }))
    .filter((celebration) => celebration.remaining > 0);

  if (state.successCelebrations.length !== previousCount) renderBoard();
  if (state.completeAfterCelebration && state.successCelebrations.length === 0) {
    state.completeAfterCelebration = false;
    completeRoundIfNeeded();
  }
}

function boardIsComplete() {
  return state.cards.length > 0
    && state.cards.every((card) => card.state === "matched")
    && state.tray.length === 0;
}

function completeRoundIfNeeded() {
  if (!boardIsComplete() || state.transitionRemaining > 0) return false;
  state.completed += 1;
  state.score += 220 + Math.round(state.timeLeft * 2);
  state.transitionRemaining = 0.9;
  state.locked = true;
  announce(`完成第 ${state.completed} 個委託！星光正送回小鎮。`);
  showActionFeedback("✦ 關卡完成！", "complete", 1.2);
  playTone(620, 0.14, 0.045, "triangle");
  window.setTimeout(() => playTone(820, 0.18, 0.035, "triangle"), 90);
  return true;
}

function handlePairCard(card) {
  if (!state.firstCardId) {
    state.firstCardId = card.id;
    announce(`已選擇 ${card.name}，再找一張相同的牌。`);
    playTone(420, 0.06, 0.025, "triangle");
    return;
  }

  if (state.firstCardId === card.id) return;
  const first = cardById(state.firstCardId);
  state.secondCardId = card.id;

  if (isMatchingGroup([first, card], 2)) {
    beginSuccessCelebration([first, card], `${card.name}找到同伴`, 2);
    return;
  }

  state.locked = true;
  applyMistake(`${first.name}和${card.name}不是同一組`);
  state.compareRemaining = state.currentMode === "memory" ? 0.72 : 0.42;
}

function handleTripleCard(card) {
  card.state = "in-tray";
  state.tray = insertTrayCard(state.tray, card);
  const result = resolveTray(state.tray, 3);
  state.tray = result.tray;

  if (result.clearedFamilyId) {
    const clearedCards = result.clearedIds.map(cardById).filter(Boolean);
    beginSuccessCelebration(clearedCards, `${card.name}完成三件收納`, 3);
    return;
  }

  playTone(430 + state.tray.length * 30, 0.06, 0.025, "triangle");
  announce(`托盤已有 ${state.tray.length} / 7 件，湊齊三件相同物品就會收好。`);
  if (state.tray.length >= 7) {
    applyMistake("托盤放滿了");
    for (const trayCard of state.tray) {
      const original = cardById(trayCard.id);
      if (original) original.state = "idle";
    }
    state.tray = [];
  }
}

function handleCard(cardId) {
  if (state.status !== "running" || state.locked || state.previewRemaining > 0 || state.transitionRemaining > 0) return;
  const card = cardById(cardId);
  if (!card || card.state === "matched" || card.state === "in-tray") return;

  if (state.currentMode === "triple-pack") handleTripleCard(card);
  else handlePairCard(card);
  renderAll();
}

function autoCompleteGroup() {
  const groupSize = state.currentMode === "triple-pack" ? 3 : 2;
  const ids = findAvailableGroup(state.cards, groupSize);
  if (!ids.length) return false;
  const cards = ids.map(cardById).filter(Boolean);
  if (groupSize === 2) {
    state.firstCardId = cards[0]?.id ?? null;
    state.secondCardId = cards[1]?.id ?? null;
    state.compareRemaining = 0;
    beginSuccessCelebration(cards, "星引完成一組", 2);
    return true;
  }
  state.tray = state.tray.filter((card) => !ids.includes(card.id));
  beginSuccessCelebration(cards, "星引完成一組", groupSize);
  return true;
}

function activateSkill(skillId) {
  if (state.status !== "running" || state.skillCharge < SKILL_CHARGE_MAX || state.transitionRemaining > 0) return;
  const skill = skillById[skillId];
  if (!skill) return;
  const groupSize = state.currentMode === "triple-pack" ? 3 : 2;
  const available = findAvailableGroup(state.cards, groupSize);
  if (skillId !== "cloud-time" && !available.length) return;

  state.skillCharge = 0;
  state.skillUses += 1;
  state.skillFlashId = skillId;
  state.skillFlashRemaining = 1.2;

  if (skillId === "moon-peek") {
    state.hintIds = available;
    state.hintRemaining = 3;
    if (state.currentMode === "memory") state.revealRemaining = 3;
    showActionFeedback("❧ 月芽提示：答案正在發光", "skill", 2.5);
  } else if (skillId === "star-match") {
    autoCompleteGroup();
    showActionFeedback("✦ 星引共鳴：自動完成一組", "skill", 1.8);
  } else if (skillId === "cloud-time") {
    state.timeLeft = Math.min(state.duration + 30, state.timeLeft + 15);
    state.shield = 1;
    showActionFeedback("♥ 安心時刻：時間 +15 秒，並獲得一次護盾", "skill", 2.2);
  }

  announce(`${skill.companion}施放「${skill.title}」！`);
  playSkillSound();
  renderAll();
}

function tick(delta) {
  if (state.status !== "running") return;

  if (state.actionFeedbackRemaining > 0) {
    state.actionFeedbackRemaining = Math.max(0, state.actionFeedbackRemaining - delta);
    if (state.actionFeedbackRemaining === 0) {
      state.actionFeedback = null;
      renderFeedback();
    }
  }
  if (state.skillFlashRemaining > 0) {
    state.skillFlashRemaining = Math.max(0, state.skillFlashRemaining - delta);
    if (state.skillFlashRemaining === 0) renderSkills();
  }
  if (state.hintRemaining > 0) {
    const previous = state.hintRemaining;
    state.hintRemaining = Math.max(0, state.hintRemaining - delta);
    if (previous > 0 && state.hintRemaining === 0) {
      state.hintIds = [];
      renderBoard();
    }
  }
  if (state.revealRemaining > 0) {
    const previous = state.revealRemaining;
    state.revealRemaining = Math.max(0, state.revealRemaining - delta);
    if (previous > 0 && state.revealRemaining === 0) renderBoard();
  }

  tickSuccessCelebrations(delta);

  if (state.transitionRemaining > 0) {
    state.transitionRemaining = Math.max(0, state.transitionRemaining - delta);
    if (state.transitionRemaining === 0) {
      if (state.completed >= gameGoal) endShift("goal");
      else {
        setupRound();
        renderAll();
      }
    }
    return;
  }

  if (state.previewRemaining > 0) {
    const previous = state.previewRemaining;
    state.previewRemaining = Math.max(0, state.previewRemaining - delta);
    if (previous > 0 && state.previewRemaining === 0) {
      announce("卡片蓋好了，找出相同的可愛夥伴吧！");
      renderBoard();
      renderRoundInfo();
    }
    return;
  }

  if (state.compareRemaining > 0) {
    state.compareRemaining = Math.max(0, state.compareRemaining - delta);
    if (state.compareRemaining === 0) {
      state.firstCardId = null;
      state.secondCardId = null;
      state.locked = false;
      renderBoard();
    }
  }

  state.timeLeft = Math.max(0, state.timeLeft - delta);
  if (state.timeLeft === 0) endShift("time");
}

function frame(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const delta = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
  lastFrameTime = timestamp;
  tick(delta);
  if (timestamp - lastHudRender > 120) {
    renderHud();
    lastHudRender = timestamp;
  }
  window.requestAnimationFrame(frame);
}

function startGame({ keepChoices = false } = {}) {
  const choices = keepChoices
    ? state
    : {
        difficulty: selectedRadio("difficulty", "standard"),
        modeChoice: selectedRadio("game-mode", "rotation")
      };
  rng = createRng(seed);
  state = createInitialState("running", choices);
  currentShiftId = `${Date.now()}-${seed}-${Math.floor(rng() * 1_000_000)}`;
  setupRound();
  elements.briefingModal.hidden = true;
  elements.helpModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  elements.pauseButton.disabled = false;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  lastFrameTime = performance.now();
  renderAll();
  playTone(460, 0.12, 0.035, "triangle");
}

function pauseGame() {
  if (state.status !== "running") return;
  state.status = "paused";
  elements.pauseModal.hidden = false;
  elements.pauseButton.textContent = "▶";
  elements.pauseButton.setAttribute("aria-label", "繼續");
  $("#resume-button").focus();
  renderBoard();
}

function resumeGame() {
  if (state.status !== "paused") return;
  state.status = "running";
  elements.pauseModal.hidden = true;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  lastFrameTime = performance.now();
  renderBoard();
  elements.pauseButton.focus();
}

function openHelp() {
  helpReturnStatus = state.status;
  if (state.status === "running") state.status = "help";
  elements.helpModal.hidden = false;
  renderBoard();
  $("#close-help").focus();
}

function closeHelp() {
  elements.helpModal.hidden = true;
  if (state.status === "help") state.status = helpReturnStatus === "running" ? "running" : helpReturnStatus;
  lastFrameTime = performance.now();
  renderBoard();
  $("#help-button").focus();
}

function endShift(reason) {
  if (state.status === "result") return;
  state.status = "result";
  state.endedBy = reason;
  elements.pauseButton.disabled = true;

  const stars = state.completed >= gameGoal
    ? state.mistakes <= 2 ? 3 : 2
    : state.completed >= Math.max(1, Math.ceil(gameGoal / 2))
      ? 2
      : state.matched > 0 ? 1 : 0;
  const townReward = townController?.recordShift({
    id: currentShiftId,
    completed: state.completed,
    matched: state.matched,
    served: state.completed,
    stars,
    score: state.score,
    skillUses: state.skillUses
  });

  $("#result-stars").textContent = `${"★ ".repeat(stars)}${"☆ ".repeat(3 - stars)}`.trim();
  $("#result-stars").setAttribute("aria-label", `本次獲得 ${stars} 星`);
  $("#result-title").textContent = state.completed >= gameGoal ? "今日委託全部完成" : "星光進度已保存";
  $("#result-completed").textContent = `${state.completed} / ${gameGoal}`;
  $("#result-combo").textContent = state.bestCombo;
  $("#result-matched").textContent = state.matched;
  $("#result-skills").textContent = state.skillUses;
  $("#result-score").textContent = state.score.toLocaleString("zh-Hant");

  let praise = `你完成了 ${state.completed} 關、配成 ${state.matched} 組可愛夥伴。`;
  if (state.matched === 0) praise = "這次先熟悉了規則；所有牌都能慢慢看，不必急。";
  else if (state.skillUses >= 2) praise = `你主動安排了 ${state.skillUses} 次搭檔技能，時機掌握得很好。`;
  else if (state.bestCombo >= 5) praise = `連續 ${state.bestCombo} 組正確配對，整間小屋都亮了起來。`;
  $("#result-praise").textContent = praise;
  $("#result-tip").textContent = state.skillUses === 0
    ? "完成四組會充滿技能槽；能量滿時記得選一位搭檔出手。"
    : "下次可在開始前鎖定單一玩法，也可以繼續挑戰驚喜輪替。";
  $("#result-town-reward").textContent = townReward?.message ?? "委託成果將在返回小鎮後保存。";

  renderAll();
  elements.resultModal.hidden = false;
  $("#retry-button").focus();
  playTone(stars >= 2 ? 620 : 430, 0.2, 0.04, "triangle");
}

function renderHud() {
  elements.goalValue.textContent = `${state.completed} / ${gameGoal}`;
  elements.roundValue.textContent = currentMode().shortTitle;
  elements.timeValue.textContent = formatTime(state.timeLeft);
  elements.mistakeValue.textContent = state.mistakes;
  elements.mistakeBar.style.width = `${Math.min(100, state.mistakes * 14)}%`;
  elements.bestComboValue.textContent = state.bestCombo;
  elements.matchedValue.textContent = state.matched;
  elements.scoreValue.textContent = state.score.toLocaleString("zh-Hant");
  elements.shiftMessage.textContent = state.message;
}

function renderRoute() {
  elements.modeRoute.replaceChildren();
  const route = Array.from({ length: gameGoal }, (_, index) => modeForRound(state.modeChoice, index + 1));
  for (const [index, modeId] of route.entries()) {
    const mode = modeById[modeId];
    const item = document.createElement("div");
    const complete = index < state.completed;
    const active = index === state.completed && state.status !== "result";
    item.className = `route-step${complete ? " is-complete" : ""}${active ? " is-active" : ""}`;
    item.innerHTML = `<span>${complete ? "✓" : mode.symbol}</span><div><small>第 ${index + 1} 關</small><strong>${mode.shortTitle}</strong></div>`;
    elements.modeRoute.append(item);
  }
}

function renderRoundInfo() {
  const mode = currentMode();
  const remaining = state.cards.filter((card) => card.state !== "matched").length;
  elements.modeEyebrow.textContent = `${mode.symbol} ${mode.title}`;
  elements.gameTitle.textContent = mode.id === "memory"
    ? "翻開兩張，找出相同夥伴"
    : mode.id === "quick-pair"
      ? "看準圖案，兩個一起消除"
      : "湊齊三件，清空收納托盤";
  elements.roundProgress.textContent = state.status === "briefing"
    ? "等待開始"
    : `第 ${Math.min(state.round, gameGoal)} / ${gameGoal} 關 · 剩 ${remaining} 張`;
  elements.roundRule.textContent = mode.detail;
  elements.previewBanner.hidden = !(state.currentMode === "memory" && state.previewRemaining > 0);
  if (!elements.previewBanner.hidden) elements.previewBanner.textContent = `先記住位置 · ${Math.ceil(state.previewRemaining)} 秒後蓋牌`;
}

function renderBoard() {
  elements.gameBoard.replaceChildren();
  elements.gameBoard.dataset.mode = state.currentMode;
  elements.gameBoard.dataset.count = String(state.cards.length);
  const blocked = state.status !== "running" || state.locked || state.previewRemaining > 0 || state.transitionRemaining > 0;

  for (const card of state.cards) {
    const button = document.createElement("button");
    const faceUp = cardIsFaceUp(card);
    const celebrating = isCardCelebrating(card.id);
    const removed = (card.state === "matched" || card.state === "in-tray") && !celebrating;
    const selected = card.id === state.firstCardId || card.id === state.secondCardId;
    const hinted = state.hintIds.includes(card.id) && state.hintRemaining > 0;
    button.type = "button";
    button.dataset.cardId = card.id;
    button.className = `match-card palette-${card.palette}${faceUp ? " is-face-up" : ""}${selected ? " is-selected" : ""}${celebrating ? " is-match-success" : ""}${removed ? " is-removed" : ""}${hinted ? " is-hint" : ""}`;
    button.disabled = blocked || removed;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", celebrating
      ? `配對成功：${card.name}`
      : removed
      ? `已完成：${card.name}`
      : faceUp ? `${card.name}${selected ? "，已選取" : ""}` : "尚未翻開的星願卡");
    button.innerHTML = `
      <span class="match-card-inner">
        <span class="match-card-back" aria-hidden="true"><b>✦</b><i>•ᴗ•</i></span>
        <span class="match-card-front" aria-hidden="true"><b class="card-character family-${card.familyId}"></b><i>${card.name}</i></span>
      </span>
      <span class="match-success-mark" aria-hidden="true"><b>✓</b><i>配對成功</i></span>`;
    elements.gameBoard.append(button);
  }
}

function renderTray() {
  const active = state.currentMode === "triple-pack";
  elements.trayArea.hidden = !active;
  elements.collectionTray.replaceChildren();
  if (!active) return;
  for (let index = 0; index < 7; index += 1) {
    const slot = document.createElement("span");
    const card = state.tray[index];
    slot.className = `tray-slot${card ? ` palette-${card.palette} is-filled` : ""}`;
    slot.setAttribute("aria-label", card ? `${card.name}在托盤第 ${index + 1} 格` : `托盤第 ${index + 1} 格為空`);
    slot.innerHTML = card ? `<b aria-hidden="true">${card.symbol}</b>` : "";
    elements.collectionTray.append(slot);
  }
}

function renderSkills() {
  const ready = state.skillCharge >= SKILL_CHARGE_MAX && state.status === "running" && state.transitionRemaining === 0;
  elements.skillChargeValue.textContent = `${Math.round(state.skillCharge)}%`;
  elements.skillChargeBar.style.width = `${state.skillCharge}%`;
  elements.skillCharge.setAttribute("aria-valuenow", String(Math.round(state.skillCharge)));
  elements.skillCharge.classList.toggle("is-ready", ready);
  elements.skillList.replaceChildren();

  for (const skill of COMPANION_SKILLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.skillId = skill.id;
    button.className = `skill-card skill-${skill.id}${ready ? " is-ready" : ""}${state.skillFlashId === skill.id && state.skillFlashRemaining > 0 ? " is-casting" : ""}`;
    button.disabled = !ready;
    const accessibleDetail = skill.detail.replace(/[。.]+$/, "");
    button.setAttribute("aria-label", `${skill.companion}的技能${skill.title}：${accessibleDetail}${ready ? "，可以施放" : `，能量 ${Math.round(state.skillCharge)}%`}`);
    button.innerHTML = `
      <span class="skill-portrait" aria-hidden="true"><b>${skill.symbol}</b><i>•ᴗ•</i></span>
      <span class="skill-copy"><small>${skill.companion}</small><strong>${skill.title}</strong><span>${skill.detail}</span></span>
      <span class="skill-state">${ready ? "施放" : `${Math.round(state.skillCharge)}%`}</span>`;
    elements.skillList.append(button);
  }

  const activeSkill = state.skillFlashRemaining > 0 ? skillById[state.skillFlashId] : null;
  elements.skillFeedback.hidden = !activeSkill;
  if (activeSkill) elements.skillFeedback.textContent = `${activeSkill.symbol} ${activeSkill.title}！`;
}

function renderFeedback() {
  elements.gameFeedback.hidden = !state.actionFeedback;
  elements.gameFeedback.className = `care-feedback tone-${state.actionFeedbackTone}`;
  if (state.actionFeedback) elements.gameFeedback.textContent = state.actionFeedback;
}

function renderSoundButton() {
  elements.toggleSound.textContent = soundEnabled ? "♪" : "×";
  elements.toggleSound.setAttribute("aria-pressed", String(soundEnabled));
  elements.toggleSound.setAttribute("aria-label", soundEnabled ? "關閉音效" : "開啟音效");
}

function renderAll() {
  renderHud();
  renderRoute();
  renderRoundInfo();
  renderBoard();
  renderTray();
  renderSkills();
  renderFeedback();
  renderSoundButton();
}

function buildStaticHelp() {
  const list = $("#help-mode-list");
  list.replaceChildren();
  for (const mode of MINI_GAME_MODES) {
    const item = document.createElement("div");
    item.className = "help-task";
    item.innerHTML = `<span class="legend-token" aria-hidden="true">${mode.symbol}</span><span><strong>${mode.title}</strong><small>${mode.detail}</small></span>`;
    list.append(item);
  }
}

elements.gameBoard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-card-id]");
  if (button) handleCard(button.dataset.cardId);
});
elements.skillList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-skill-id]");
  if (button) activateSkill(button.dataset.skillId);
});
elements.townTab.addEventListener("click", showTownView);
elements.clinicTab.addEventListener("click", showClinicView);
elements.expeditionTab.addEventListener("click", showExpeditionView);
$("#start-button").addEventListener("click", () => startGame());
$("#briefing-return-town").addEventListener("click", showTownView);
elements.pauseButton.addEventListener("click", () => {
  if (state.status === "running") pauseGame();
  else if (state.status === "paused") resumeGame();
});
$("#resume-button").addEventListener("click", resumeGame);
$("#restart-button").addEventListener("click", () => startGame({ keepChoices: true }));
$("#leave-shift-button").addEventListener("click", leaveShiftForTown);
$("#help-button").addEventListener("click", openHelp);
$("#close-help").addEventListener("click", closeHelp);
$("#resume-from-help").addEventListener("click", closeHelp);
elements.toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  renderSoundButton();
  if (soundEnabled) playTone(520, 0.1, 0.035, "triangle");
});
$("#retry-button").addEventListener("click", () => startGame({ keepChoices: true }));
$("#return-town-button").addEventListener("click", () => {
  resetClinicToBriefing();
  showTownView();
  showToast("小遊戲成果已保存，小鎮也向前一步。", 2200);
});
$("#new-seed-button").addEventListener("click", () => {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  seed = `game-${random[0]}`;
  startGame({ keepChoices: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.helpModal.hidden) closeHelp();
  else if (state.status === "paused") resumeGame();
  else if (state.status === "running") pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "running") pauseGame();
  if (document.hidden) expeditionController?.hide();
  else if (document.body.dataset.view === "expedition") expeditionController?.show();
});

townController = createTownController({
  root: document,
  storage: window.localStorage,
  onEnterClinic: showClinicView,
  onEnterExpedition: showExpeditionView,
  onNotify: showToast
});

expeditionController = createExpeditionController({
  root: document,
  townController,
  onLeave: showTownView,
  onNotify: showToast
});

if (params.get("debug") === "1") {
  window.__STARCARE_DEBUG__ = {
    snapshot: () => structuredClone(state),
    townSnapshot: () => townController.snapshot(),
    expeditionSnapshot: () => expeditionController.snapshot(),
    excavate: (x, y) => expeditionController.excavate(x, y),
    clickCard: handleCard,
    matchOne: autoCompleteGroup,
    useSkill: activateSkill,
    endShift: () => endShift("debug"),
    start: () => startGame()
  };
}

buildStaticHelp();
document.documentElement.dataset.appVersion = APP_VERSION;
$("#version-label").textContent = `CORE v${APP_VERSION}`;
$("#start-button").textContent = `開始 ${formatTime(gameDuration)} 委託`;
$("#briefing-goal").textContent = `目標：完成 ${gameGoal} 個短關卡`;
renderAll();
if (params.get("view") === "clinic") showClinicView();
else if (params.get("view") === "expedition") showExpeditionView();
else showTownView();
window.requestAnimationFrame(frame);
if (params.get("view") === "clinic") $("#start-button").focus();
else if (params.get("view") === "expedition") $("#expedition-canvas").focus();
else $("#enter-clinic").focus();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("星癒小鎮離線服務未啟用：", error);
    });
  }, { once: true });
}
