import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  TASK_TYPES,
  TASK_IDS,
  classifyChain,
  createBoard,
  createRng,
  findLegalPath,
  formatTime,
  indexToPoint,
  injectChaos,
  isAdjacent,
  jobUrgency,
  resolveMove
} from "./engine.js";
import { APP_VERSION } from "./version.js";

const $ = (selector) => document.querySelector(selector);
const taskById = Object.fromEntries(TASK_TYPES.map((task) => [task.id, task]));

const STATIONS = {
  observe: { name: "星紋觀測桌", idle: "等待觀察工作" },
  brew: { name: "月露調製台", idle: "等待調製工作" },
  care: { name: "暖光診療床", idle: "等待療護工作" },
  comfort: { name: "安心茶席", idle: "等待安撫工作" }
};

const SPECIALS = {
  pulse: { badge: "↔", label: "脈衝珠" },
  resonance: { badge: "×2", label: "共鳴珠" },
  star: { badge: "★", label: "星核" },
  perfect: { badge: "✦", label: "完美星核" }
};

const DIFFICULTIES = {
  comfort: { label: "舒適", patienceRate: 0.7, urgencyRate: 0.75, canFail: false },
  standard: { label: "標準", patienceRate: 1, urgencyRate: 1, canFail: true },
  focus: { label: "專注", patienceRate: 1.15, urgencyRate: 1.1, canFail: true }
};

const PATIENT_TEMPLATES = [
  {
    name: "露米",
    initial: "露",
    concern: "翅光發燙",
    patience: 100,
    steps: [
      { type: "care", work: 4, label: "敷上冷光貼", deadline: 29 }
    ]
  },
  {
    name: "波波",
    initial: "波",
    concern: "雲絮失眠",
    patience: 104,
    steps: [
      { type: "observe", work: 4, label: "確認夢紋", deadline: 31 },
      { type: "comfort", work: 4, label: "安撫呼吸", deadline: 27 }
    ]
  },
  {
    name: "亞洛",
    initial: "亞",
    concern: "星砂咳嗽",
    patience: 108,
    steps: [
      { type: "observe", work: 5, label: "聽診星律", deadline: 30 },
      { type: "brew", work: 5, label: "調製葉露", deadline: 26 },
      { type: "care", work: 4, label: "完成療護", deadline: 26 }
    ]
  },
  {
    name: "米菈",
    initial: "米",
    concern: "花語焦慮",
    patience: 98,
    steps: [
      { type: "comfort", work: 5, label: "聽她說完", deadline: 25 },
      { type: "care", work: 5, label: "穩定花光", deadline: 29 }
    ]
  },
  {
    name: "塔塔",
    initial: "塔",
    concern: "葉脈褪色",
    patience: 112,
    steps: [
      { type: "observe", work: 6, label: "檢查葉脈", deadline: 29 },
      { type: "brew", work: 6, label: "補充晨露", deadline: 27 }
    ]
  },
  {
    name: "諾伊",
    initial: "諾",
    concern: "月潮暈眩",
    patience: 106,
    steps: [
      { type: "comfort", work: 4, label: "引導呼吸", deadline: 26 },
      { type: "observe", work: 5, label: "觀測月潮", deadline: 28 },
      { type: "care", work: 5, label: "平衡星光", deadline: 26 }
    ]
  },
  {
    name: "菲芽",
    initial: "菲",
    concern: "種子低鳴",
    patience: 101,
    steps: [
      { type: "brew", work: 5, label: "調製根露", deadline: 26 },
      { type: "comfort", work: 5, label: "喚醒低鳴", deadline: 26 }
    ]
  },
  {
    name: "卡洛",
    initial: "卡",
    concern: "晶屑擦傷",
    patience: 105,
    steps: [
      { type: "care", work: 6, label: "清理晶屑", deadline: 25 },
      { type: "brew", work: 5, label: "塗上葉膏", deadline: 27 }
    ]
  }
];

const SPAWN_FRACTIONS = [0, 0, 0.14, 0.28, 0.43, 0.59, 0.75, 0.88];
const params = new URLSearchParams(window.location.search);
const shiftDuration = Math.max(10, Math.min(600, Number(params.get("duration")) || 180));
const shiftGoal = Math.max(1, Math.min(20, Number(params.get("goal")) || 5));
let seed = params.get("seed") || "warm-lantern-01";
let rng = createRng(seed);
let state = createInitialState("briefing");
let selection = [];
let focusedIndex = 0;
let pointerDragging = false;
let pointerId = null;
let tapMode = false;
let soundEnabled = true;
let audioContext = null;
let lastFrameTime = 0;
let lastHudRender = 0;
let toastTimeout = null;
let helpReturnStatus = "briefing";

const elements = {
  board: $("#task-board"),
  boardWrap: $("#board-wrap"),
  pathLayer: $("#path-layer"),
  finishChain: $("#finish-chain"),
  cancelChain: $("#cancel-chain"),
  chainSummary: $("#chain-summary"),
  chainPreview: $("#chain-preview"),
  inputHint: $("#input-hint"),
  goalValue: $("#goal-value"),
  waveValue: $("#wave-value"),
  timeValue: $("#time-value"),
  stabilityValue: $("#stability-value"),
  stabilityBar: $("#stability-bar"),
  patientList: $("#patient-list"),
  waitingCount: $("#waiting-count"),
  stationList: $("#station-list"),
  demandList: $("#demand-list"),
  echoList: $("#echo-list"),
  longestValue: $("#longest-value"),
  purifiedValue: $("#purified-value"),
  scoreValue: $("#score-value"),
  shiftMessage: $("#shift-message"),
  briefingModal: $("#briefing-modal"),
  helpModal: $("#help-modal"),
  pauseModal: $("#pause-modal"),
  resultModal: $("#result-modal"),
  pauseButton: $("#pause-button"),
  toggleInput: $("#toggle-input"),
  toggleSound: $("#toggle-sound"),
  toast: $("#toast")
};

function createInitialState(status = "briefing") {
  rng = createRng(seed);
  return {
    status,
    difficulty: "standard",
    duration: shiftDuration,
    timeLeft: shiftDuration,
    elapsed: 0,
    wave: 1,
    stability: 100,
    score: 0,
    served: 0,
    departed: 0,
    moves: 0,
    longest: 0,
    purified: 0,
    board: createBoard({ rng }),
    patients: [],
    jobs: [],
    echo: Object.fromEntries(TASK_IDS.map((type) => [type, 0])),
    spawnIndex: 0,
    nextPatientId: 1,
    nextJobId: 1,
    freezeRemaining: 0,
    message: "班次尚未開始",
    firstSpecialShown: false,
    endedBy: null
  };
}

function activePatients() {
  return state.patients.filter((patient) => patient.status === "active");
}

function waitingPatients() {
  return state.patients.filter((patient) => patient.status === "waiting");
}

function jobForPatient(patient) {
  return state.jobs.find((job) => job.patientId === patient.id) ?? null;
}

function demandForType(type) {
  return state.jobs
    .filter((job) => job.type === type)
    .reduce((sum, job) => sum + job.remaining, 0);
}

function demandWeights() {
  return Object.fromEntries(
    TASK_IDS.map((type) => [type, 1 + Math.min(2.2, demandForType(type) / 7)])
  );
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

function playResolveSound(length) {
  const base = Math.min(650, 330 + length * 20);
  playTone(base, 0.12, 0.045, "triangle");
  window.setTimeout(() => playTone(base * 1.25, 0.16, 0.035, "triangle"), 70);
}

function spawnPatient(templateIndex) {
  const template = PATIENT_TEMPLATES[templateIndex % PATIENT_TEMPLATES.length];
  const patient = {
    id: `patient-${state.nextPatientId++}`,
    ...template,
    steps: template.steps.map((step) => ({ ...step })),
    maxPatience: template.patience,
    patience: template.patience,
    stepIndex: 0,
    status: activePatients().length < 4 ? "active" : "waiting"
  };
  state.patients.push(patient);
  if (patient.status === "active") {
    createJobForPatient(patient);
    announce(`${patient.name}來到療癒所，需要${taskById[patient.steps[0].type].label}。`);
  } else {
    announce(`${patient.name}已在候診區等候。`);
  }
}

function createJobForPatient(patient) {
  const step = patient.steps[patient.stepIndex];
  if (!step || patient.status !== "active") return;
  const difficulty = DIFFICULTIES[state.difficulty];
  const job = {
    id: `job-${state.nextJobId++}`,
    patientId: patient.id,
    type: step.type,
    label: step.label,
    total: step.work,
    remaining: step.work,
    age: 0,
    deadline: step.deadline / difficulty.urgencyRate,
    nextChaosAt: step.deadline / difficulty.urgencyRate,
    chaosEvents: 0
  };
  state.jobs.push(job);

  const echoUsed = Math.min(state.echo[job.type], job.remaining);
  if (echoUsed > 0) {
    state.echo[job.type] -= echoUsed;
    job.remaining -= echoUsed;
  }
  if (job.remaining <= 0) completeJob(job.id, true);
}

function completeJob(jobId, fromEcho = false) {
  const jobIndex = state.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) return;
  const [job] = state.jobs.splice(jobIndex, 1);
  const patient = state.patients.find((candidate) => candidate.id === job.patientId);
  if (!patient || patient.status !== "active") return;

  patient.stepIndex += 1;
  state.score += 115;

  if (patient.stepIndex >= patient.steps.length) {
    patient.status = "served";
    state.served += 1;
    state.score += 260;
    state.stability = Math.min(100, state.stability + 4);
    announce(`${patient.name}恢復精神，安心離開療癒所。`);
    playTone(660, 0.18, 0.04, "triangle");
    fillActiveSlots();
    return;
  }

  createJobForPatient(patient);
  const nextStep = patient.steps[patient.stepIndex];
  if (!fromEcho) {
    announce(`${patient.name}完成一個步驟，接著需要${taskById[nextStep.type].label}。`);
  }
}

function fillActiveSlots() {
  while (activePatients().length < 4) {
    const next = waitingPatients()[0];
    if (!next) break;
    next.status = "active";
    createJobForPatient(next);
    announce(`${next.name}從候診區進入療癒所。`);
  }
}

function departPatient(patient) {
  patient.status = "departed";
  state.jobs = state.jobs.filter((job) => job.patientId !== patient.id);
  state.departed += 1;
  state.stability = Math.max(0, state.stability - 13);
  announce(`${patient.name}先回家休息；療癒所安定下降。`);
  fillActiveSlots();
}

function applyWork(type, points) {
  let remainingPoints = Math.max(0, points);
  let completed = 0;
  let spent = 0;

  while (remainingPoints > 0) {
    const candidate = state.jobs
      .filter((job) => job.type === type)
      .sort((a, b) => (b.age / b.deadline) - (a.age / a.deadline))[0];
    if (!candidate) break;
    const used = Math.min(remainingPoints, candidate.remaining);
    candidate.remaining -= used;
    remainingPoints -= used;
    spent += used;
    if (candidate.remaining <= 0) {
      completed += 1;
      completeJob(candidate.id);
    }
  }

  if (remainingPoints > 0) {
    const capacity = Math.max(0, 5 - state.echo[type]);
    const stored = Math.min(capacity, remainingPoints);
    state.echo[type] += stored;
    remainingPoints -= stored;
  }

  return { completed, spent, overflow: remainingPoints };
}

function forceResolveType(type) {
  const matchingIds = state.jobs.filter((job) => job.type === type).map((job) => job.id);
  for (const jobId of matchingIds) completeJob(jobId);
  return matchingIds.length;
}

function restorePatience(points) {
  const patient = activePatients().sort((a, b) => a.patience - b.patience)[0];
  if (!patient) return 0;
  const before = patient.patience;
  patient.patience = Math.min(patient.maxPatience, patient.patience + Math.min(12, points * 1.25));
  return Math.round(patient.patience - before);
}

function processSpawns() {
  while (
    state.spawnIndex < SPAWN_FRACTIONS.length &&
    state.elapsed >= SPAWN_FRACTIONS[state.spawnIndex] * state.duration
  ) {
    spawnPatient(state.spawnIndex);
    state.spawnIndex += 1;
  }
}

function updateJobsAndPatients(delta) {
  const difficulty = DIFFICULTIES[state.difficulty];
  let boardChanged = false;

  for (const job of [...state.jobs]) {
    job.age += delta;
    if (job.age >= job.nextChaosAt) {
      job.chaosEvents += 1;
      job.nextChaosAt += Math.max(11, job.deadline * 0.58);
      state.stability = Math.max(0, state.stability - (state.difficulty === "focus" ? 7 : 5));
      const injected = injectChaos(state.board, rng, job.type);
      state.board = injected.board;
      boardChanged ||= injected.index >= 0;
      announce(`${taskById[job.type].label}工作陷入混沌，清除紫色阻礙旁的任務珠。`);
    }
  }

  for (const patient of [...activePatients()]) {
    const job = jobForPatient(patient);
    const urgency = job ? jobUrgency(job.age, job.deadline) : "calm";
    const pressure = urgency === "critical" ? 0.3 : urgency === "urgent" ? 0.13 : 0;
    patient.patience -= delta * (0.62 + pressure) * difficulty.patienceRate;
    if (patient.patience <= 0) departPatient(patient);
  }

  if (boardChanged) renderBoard();
}

function tick(delta) {
  state.elapsed += delta;
  state.timeLeft = Math.max(0, state.duration - state.elapsed);
  state.wave = Math.min(3, Math.floor((state.elapsed / state.duration) * 3) + 1);
  processSpawns();

  if (state.freezeRemaining > 0) {
    state.freezeRemaining = Math.max(0, state.freezeRemaining - delta);
  } else {
    updateJobsAndPatients(delta);
  }

  if (state.timeLeft <= 0) {
    endShift("time");
  } else if (state.stability <= 0 && DIFFICULTIES[state.difficulty].canFail) {
    endShift("stability");
  }
}

function frame(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const delta = Math.min(0.12, Math.max(0, (timestamp - lastFrameTime) / 1000));
  lastFrameTime = timestamp;

  if (state.status === "running") tick(delta);
  if (timestamp - lastHudRender > 90) {
    renderDynamic();
    lastHudRender = timestamp;
  }
  window.requestAnimationFrame(frame);
}

function startGame({ keepDifficulty = false } = {}) {
  const selectedDifficulty = keepDifficulty
    ? state.difficulty
    : document.querySelector('input[name="difficulty"]:checked')?.value ?? "standard";
  state = createInitialState("running");
  state.difficulty = selectedDifficulty;
  selection = [];
  focusedIndex = 0;
  processSpawns();
  elements.briefingModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  elements.pauseButton.disabled = false;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  announce("先看病患需求，再從盤面連起至少三顆相同符號。 ");
  renderAll();
  playTone(440, 0.12, 0.04, "triangle");
  window.setTimeout(() => playTone(550, 0.14, 0.035, "triangle"), 90);
}

function pauseGame() {
  if (state.status !== "running") return;
  state.status = "paused";
  cancelSelection(false);
  elements.pauseModal.hidden = false;
  elements.pauseButton.textContent = "▶";
  elements.pauseButton.setAttribute("aria-label", "繼續");
  renderDynamic();
  $("#resume-button").focus();
}

function resumeGame() {
  if (state.status !== "paused") return;
  state.status = "running";
  elements.pauseModal.hidden = true;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  lastFrameTime = performance.now();
  renderDynamic();
  elements.board.querySelector(`[data-index="${focusedIndex}"]`)?.focus();
}

function openHelp() {
  if (!elements.helpModal.hidden) return;
  helpReturnStatus = state.status;
  if (state.status === "running") state.status = "help";
  cancelSelection(false);
  elements.helpModal.hidden = false;
  renderDynamic();
  $("#close-help").focus();
}

function closeHelp() {
  if (elements.helpModal.hidden) return;
  elements.helpModal.hidden = true;
  if (state.status === "help") state.status = helpReturnStatus === "running" ? "running" : helpReturnStatus;
  lastFrameTime = performance.now();
  renderDynamic();
  $("#help-button").focus();
}

function endShift(reason) {
  if (state.status === "result") return;
  state.status = "result";
  state.endedBy = reason;
  selection = [];
  elements.pauseButton.disabled = true;
  renderAll();

  const stars = state.served === 0
    ? 0
    : state.served >= shiftGoal + 2 && state.stability >= 70
      ? 3
      : state.served >= shiftGoal
        ? 2
        : 1;
  $("#result-stars").textContent = `${"★ ".repeat(stars)}${"☆ ".repeat(3 - stars)}`.trim();
  $("#result-stars").setAttribute("aria-label", `本次獲得 ${stars} 星`);
  $("#result-title").textContent = reason === "stability"
    ? "先把燈火穩定下來"
    : state.served === 0
      ? "先熟悉療癒所的節奏"
      : "今天的燈還亮著";
  $("#result-served").textContent = state.served;
  $("#result-longest").textContent = state.longest;
  $("#result-stability").textContent = Math.round(state.stability);
  $("#result-score").textContent = state.score.toLocaleString("zh-Hant");

  let praise = `你讓 ${state.served} 位來訪者帶著安心回家。`;
  if (state.served === 0) praise = "這次還沒有完成療程；下一輪從最急迫的需求開始。";
  else if (state.longest >= 10) praise = `漂亮的 ${state.longest} 連鎖讓整間療癒所重新流動起來。`;
  else if (state.purified >= 3) praise = `你在壓力中仍淨化了 ${state.purified} 顆混沌珠。`;
  else if (state.stability >= 80) praise = "你把療癒所的節奏維持得非常安穩。";
  $("#result-praise").textContent = praise;

  let tip = "下一次可先處理橘框或紅框病患，能避免工作轉成混沌。";
  if (state.longest < 5) tip = "試著繞出 5 連；留下的脈衝珠能幫忙處理下一波。";
  else if (state.served >= shiftGoal) tip = "目標完成。下一步可以挑戰 7 連共鳴珠，累積更多回響。";
  $("#result-tip").textContent = tip;

  elements.resultModal.hidden = false;
  $("#retry-button").focus();
  playTone(stars >= 2 ? 600 : 420, 0.2, 0.04, "triangle");
}

function currentPatientStatus(patient, job) {
  const patienceRatio = patient.patience / patient.maxPatience;
  const urgency = job ? jobUrgency(job.age, job.deadline) : "calm";
  if (patienceRatio <= 0.24 || urgency === "critical") return "critical";
  if (patienceRatio <= 0.45 || urgency === "urgent") return "urgent";
  return urgency;
}

function renderPatients() {
  const patients = activePatients();
  elements.waitingCount.textContent = `候診 ${waitingPatients().length}`;
  elements.patientList.replaceChildren();

  if (!patients.length) {
    const empty = document.createElement("div");
    empty.className = "empty-patients";
    empty.textContent = state.status === "briefing" ? "開始班次後，來訪者會出現在這裡。" : "候診區暫時安靜下來了。";
    elements.patientList.append(empty);
    return;
  }

  for (const patient of patients) {
    const job = jobForPatient(patient);
    if (!job) continue;
    const task = taskById[job.type];
    const status = currentPatientStatus(patient, job);
    const patiencePercent = Math.max(0, Math.min(100, (patient.patience / patient.maxPatience) * 100));
    const card = document.createElement("article");
    card.className = "patient-card";
    card.dataset.status = status;
    card.setAttribute(
      "aria-label",
      `${patient.name}，${patient.concern}，需要${task.label} ${job.remaining} 點，耐心 ${Math.round(patiencePercent)}%`
    );
    card.innerHTML = `
      <div class="patient-topline">
        <span class="patient-avatar" aria-hidden="true">${patient.initial}</span>
        <span>
          <strong class="patient-name">${patient.name} · ${patient.concern}</strong>
          <small class="patient-step">${job.label} · ${job.remaining}/${job.total}</small>
        </span>
        <span class="task-token type-${task.id}" aria-hidden="true">${task.symbol}</span>
      </div>
      <div class="patience-row">
        <span>耐心</span>
        <span class="patient-meter"><span style="width:${patiencePercent}%"></span></span>
        <strong>${Math.ceil(patiencePercent)}%</strong>
      </div>`;
    elements.patientList.append(card);
  }
}

function renderStations() {
  elements.stationList.replaceChildren();
  for (const type of TASK_IDS) {
    const task = taskById[type];
    const jobs = state.jobs.filter((job) => job.type === type);
    const demand = jobs.reduce((sum, job) => sum + job.remaining, 0);
    const worstUrgency = jobs.reduce((worst, job) => {
      const current = jobUrgency(job.age, job.deadline);
      const rank = { calm: 0, reminder: 1, urgent: 2, critical: 3 };
      return rank[current] > rank[worst] ? current : worst;
    }, "calm");
    const card = document.createElement("article");
    card.className = `station-card type-${type}${worstUrgency === "urgent" ? " is-urgent" : ""}${worstUrgency === "critical" ? " is-critical" : ""}`;
    const stateLabel = !demand
      ? STATIONS[type].idle
      : worstUrgency === "critical"
        ? "危急：即將產生混沌"
        : worstUrgency === "urgent"
          ? "急迫工作"
          : `${jobs.length} 項進行中`;
    card.innerHTML = `
      <div class="station-top">
        <span class="station-symbol" aria-hidden="true">${task.symbol}</span>
        <strong class="station-count">${demand}</strong>
      </div>
      <span class="station-name">${STATIONS[type].name}</span>
      <div class="station-meter" aria-hidden="true"><span style="width:${Math.min(100, demand / 14 * 100)}%"></span></div>
      <small class="station-state">${stateLabel}</small>`;
    elements.stationList.append(card);
  }
}

function renderDemandAndEcho() {
  const demands = Object.fromEntries(TASK_IDS.map((type) => [type, demandForType(type)]));
  const topDemand = TASK_IDS.reduce((top, type) => demands[type] > demands[top] ? type : top, TASK_IDS[0]);
  elements.demandList.replaceChildren();
  elements.echoList.replaceChildren();

  for (const type of TASK_IDS) {
    const task = taskById[type];
    const demandRow = document.createElement("div");
    demandRow.className = `demand-row type-${type}${demands[type] > 0 && type === topDemand ? " is-top" : ""}`;
    demandRow.innerHTML = `
      <span class="legend-token" aria-hidden="true">${task.symbol}</span>
      <span class="demand-copy"><strong>${task.label}</strong><small>${STATIONS[type].name}</small></span>
      <span class="demand-number">${demands[type]}</span>`;
    elements.demandList.append(demandRow);

    const echoRow = document.createElement("div");
    echoRow.className = `echo-row type-${type}`;
    echoRow.innerHTML = `
      <span class="legend-token" aria-hidden="true">${task.symbol}</span>
      <span class="echo-copy">
        <strong>${task.label}</strong>
        <span class="echo-meter" aria-hidden="true"><span style="width:${state.echo[type] / 5 * 100}%"></span></span>
      </span>
      <span class="echo-number">${state.echo[type]}/5</span>`;
    elements.echoList.append(echoRow);
  }
}

function renderDynamic() {
  elements.goalValue.textContent = `${state.served} / ${shiftGoal}`;
  elements.waveValue.textContent = `${state.wave} / 3`;
  elements.timeValue.textContent = formatTime(state.timeLeft);
  elements.stabilityValue.textContent = Math.round(state.stability);
  elements.stabilityBar.style.width = `${Math.max(0, state.stability)}%`;
  elements.stabilityBar.style.background = state.stability <= 25 ? "var(--danger)" : state.stability <= 55 ? "#ffb574" : "var(--success)";
  $(".hud-time").classList.toggle("is-warning", state.timeLeft <= 30 && state.timeLeft > 10);
  $(".hud-time").classList.toggle("is-critical", state.timeLeft <= 10);
  $(".hud-stability").classList.toggle("is-warning", state.stability <= 55 && state.stability > 25);
  $(".hud-stability").classList.toggle("is-critical", state.stability <= 25);
  elements.longestValue.textContent = state.longest;
  elements.purifiedValue.textContent = state.purified;
  elements.scoreValue.textContent = state.score.toLocaleString("zh-Hant");
  elements.shiftMessage.textContent = state.freezeRemaining > 0
    ? `星核暫停耐心 ${state.freezeRemaining.toFixed(1)} 秒`
    : state.message;
  elements.boardWrap.classList.toggle("is-locked", state.status !== "running");
  renderPatients();
  renderStations();
  renderDemandAndEcho();
}

function renderSoundButton() {
  elements.toggleSound.setAttribute("aria-pressed", String(soundEnabled));
  elements.toggleSound.textContent = soundEnabled ? "♪" : "×";
  elements.toggleSound.setAttribute("aria-label", soundEnabled ? "關閉音效" : "開啟音效");
}

function orbLabel(cell, index) {
  const point = indexToPoint(index);
  if (cell.chaos) return `第 ${point.row + 1} 列第 ${point.column + 1} 欄，混沌珠；清除旁邊任務珠來淨化`;
  const task = taskById[cell.type];
  const special = cell.special ? `，${SPECIALS[cell.special].label}` : "";
  return `第 ${point.row + 1} 列第 ${point.column + 1} 欄，${task.label}${special}`;
}

function renderBoard() {
  const hadBoardFocus = elements.board.contains(document.activeElement);
  elements.board.replaceChildren();
  state.board.forEach((cell, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cell.chaos ? "orb is-chaos" : `orb type-${cell.type}`;
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-rowindex", String(Math.floor(index / BOARD_COLUMNS) + 1));
    button.setAttribute("aria-colindex", String((index % BOARD_COLUMNS) + 1));
    button.setAttribute("aria-label", orbLabel(cell, index));
    button.tabIndex = index === focusedIndex ? 0 : -1;
    button.disabled = state.status !== "running";

    const symbol = document.createElement("span");
    symbol.className = "orb-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = cell.chaos ? "⌁" : taskById[cell.type].symbol;
    button.append(symbol);

    if (cell.special) {
      button.classList.add("has-special");
      const badge = document.createElement("span");
      badge.className = "orb-special";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = SPECIALS[cell.special].badge;
      button.append(badge);
    }
    elements.board.append(button);
  });
  updateSelectionVisuals();
  if (hadBoardFocus) elements.board.querySelector(`[data-index="${focusedIndex}"]`)?.focus();
}

function renderPath() {
  elements.pathLayer.replaceChildren();
  if (selection.length < 2) return;
  const wrapRect = elements.boardWrap.getBoundingClientRect();
  const points = selection.map((index) => {
    const orb = elements.board.querySelector(`[data-index="${index}"]`);
    if (!orb) return null;
    const rect = orb.getBoundingClientRect();
    return `${rect.left - wrapRect.left + rect.width / 2},${rect.top - wrapRect.top + rect.height / 2}`;
  }).filter(Boolean).join(" ");
  const task = taskById[state.board[selection[0]]?.type];
  if (!points || !task) return;
  elements.pathLayer.setAttribute("viewBox", `0 0 ${wrapRect.width} ${wrapRect.height}`);
  const namespace = "http://www.w3.org/2000/svg";
  const back = document.createElementNS(namespace, "polyline");
  back.setAttribute("points", points);
  back.setAttribute("class", "path-line-back");
  const front = document.createElementNS(namespace, "polyline");
  front.setAttribute("points", points);
  front.setAttribute("class", "path-line");
  front.style.color = `var(--${task.id})`;
  elements.pathLayer.append(back, front);
}

function updateSelectionVisuals() {
  elements.board.querySelectorAll(".orb").forEach((orb) => {
    const index = Number(orb.dataset.index);
    orb.classList.toggle("is-selected", selection.includes(index));
    orb.classList.toggle("is-start", selection[0] === index);
    orb.setAttribute("aria-selected", String(selection.includes(index)));
  });

  const length = selection.length;
  const cell = length ? state.board[selection[0]] : null;
  const task = cell?.type ? taskById[cell.type] : null;
  const special = classifyChain(length);
  if (!length || !task) {
    elements.chainSummary.textContent = "尚未選取";
    elements.chainPreview.textContent = "5 顆開始生成特殊珠";
  } else if (length < 3) {
    elements.chainSummary.textContent = `${task.label} ${length} / 3`;
    elements.chainPreview.textContent = "再連相同符號";
  } else {
    elements.chainSummary.textContent = `${task.label} +${length}`;
    elements.chainPreview.textContent = special ? `將生成：${special.label}` : "有效連線 · 5 顆生成脈衝珠";
  }
  elements.finishChain.disabled = state.status !== "running" || length < 3;
  elements.cancelChain.disabled = !length;
  window.requestAnimationFrame(renderPath);
}

function renderAll() {
  renderBoard();
  renderDynamic();
  renderSoundButton();
}

function selectCell(index) {
  if (state.status !== "running") return false;
  const cell = state.board[index];
  if (!cell || cell.chaos) {
    announce("混沌珠不能直接連線；清除它旁邊的任務珠。 ");
    return false;
  }

  if (!selection.length) {
    selection = [index];
  } else if (selection.length > 1 && index === selection.at(-2)) {
    selection.pop();
  } else {
    const first = state.board[selection[0]];
    const lastIndex = selection.at(-1);
    if (selection.includes(index)) return false;
    if (cell.type !== first.type || !isAdjacent(lastIndex, index)) {
      return false;
    }
    selection.push(index);
  }
  focusedIndex = index;
  playTone(270 * (1.075 ** Math.min(selection.length - 1, 10)), 0.07, 0.025, "sine");
  updateSelectionVisuals();
  return true;
}

function cancelSelection(withMessage = true) {
  if (!selection.length) return;
  selection = [];
  if (withMessage) announce("已取消這條連線，沒有消耗任何資源。 ");
  updateSelectionVisuals();
}

function resolveSelection() {
  if (state.status !== "running") return false;
  if (selection.length < 3) {
    announce("至少需要三顆相同任務珠。 ");
    cancelSelection(false);
    return false;
  }

  const path = [...selection];
  const result = resolveMove(state.board, path, { rng, weights: demandWeights() });
  if (!result.valid) {
    announce(result.reason);
    cancelSelection(false);
    return false;
  }

  state.board = result.board;
  state.moves += 1;
  state.longest = Math.max(state.longest, result.chainLength);
  state.purified += result.purified;
  state.freezeRemaining = Math.max(state.freezeRemaining, result.freezeSeconds);
  state.score += result.chainLength * 12 + Math.max(0, result.clearedCount - result.chainLength) * 5 + result.purified * 45;

  let completed = 0;
  for (const type of TASK_IDS) {
    const points = result.workByType[type];
    if (points > 0) completed += applyWork(type, points).completed;
  }
  for (const type of result.forceResolveTypes) completed += forceResolveType(type);

  const comfortPoints = result.workByType.comfort;
  const restored = comfortPoints > 0 ? restorePatience(comfortPoints) : 0;
  const task = taskById[result.chainType];
  const specialText = result.createdSpecial ? `，留下${result.createdSpecial.label}` : "";
  const purifiedText = result.purified ? `，淨化 ${result.purified} 顆混沌` : "";
  const completeText = completed ? `，完成 ${completed} 項工作` : "";
  const comfortText = restored ? `，回復 ${restored}% 耐心` : "";
  announce(`${result.chainLength} 連${task.label}${completeText}${specialText}${purifiedText}${comfortText}。`);

  if (result.createdSpecial && !state.firstSpecialShown) {
    state.firstSpecialShown = true;
    showToast(`${result.createdSpecial.label}已留在起點；下次把它連進路徑就會啟動。`, 3200);
  }
  if (result.activated.length) {
    showToast(`啟動 ${result.activated.map((kind) => SPECIALS[kind].label).join("＋")}！`);
  }

  selection = [];
  playResolveSound(result.chainLength);
  renderAll();
  return true;
}

function pointerIndex(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".orb");
  if (!target || !elements.board.contains(target)) return null;
  return Number(target.dataset.index);
}

function onPointerDown(event) {
  if (tapMode || state.status !== "running" || event.button > 0) return;
  const orb = event.target.closest(".orb");
  if (!orb || orb.disabled) return;
  event.preventDefault();
  selection = [];
  pointerDragging = true;
  pointerId = event.pointerId;
  elements.board.setPointerCapture?.(event.pointerId);
  selectCell(Number(orb.dataset.index));
}

function onPointerMove(event) {
  if (!pointerDragging || event.pointerId !== pointerId) return;
  event.preventDefault();
  const index = pointerIndex(event);
  if (index !== null && index !== selection.at(-1)) selectCell(index);
}

function onPointerEnd(event) {
  if (!pointerDragging || event.pointerId !== pointerId) return;
  event.preventDefault();
  pointerDragging = false;
  try {
    elements.board.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture can already be released if the browser cancelled the gesture.
  }
  pointerId = null;
  resolveSelection();
}

function moveFocus(key) {
  const point = indexToPoint(focusedIndex);
  let row = point.row;
  let column = point.column;
  if (key === "ArrowUp") row = Math.max(0, row - 1);
  if (key === "ArrowDown") row = Math.min(BOARD_ROWS - 1, row + 1);
  if (key === "ArrowLeft") column = Math.max(0, column - 1);
  if (key === "ArrowRight") column = Math.min(BOARD_COLUMNS - 1, column + 1);
  focusedIndex = row * BOARD_COLUMNS + column;
  elements.board.querySelectorAll(".orb").forEach((orb) => {
    orb.tabIndex = Number(orb.dataset.index) === focusedIndex ? 0 : -1;
  });
  elements.board.querySelector(`[data-index="${focusedIndex}"]`)?.focus();
}

function buildStaticHelp() {
  const list = $("#help-task-list");
  for (const task of TASK_TYPES) {
    const item = document.createElement("div");
    item.className = `help-task type-${task.id}`;
    item.innerHTML = `
      <span class="legend-token" aria-hidden="true">${task.symbol}</span>
      <span><strong>${task.label}</strong><span>${STATIONS[task.id].name}</span></span>`;
    list.append(item);
  }
  $("#start-button").textContent = `開始 ${formatTime(shiftDuration)} 班次`;
  $("#briefing-modal .modal-actions p").textContent = `目標：照顧完成 ${shiftGoal} 位來訪者`;
}

elements.board.addEventListener("pointerdown", onPointerDown);
elements.board.addEventListener("pointermove", onPointerMove);
elements.board.addEventListener("pointerup", onPointerEnd);
elements.board.addEventListener("pointercancel", onPointerEnd);
elements.board.addEventListener("focusin", (event) => {
  const orb = event.target.closest?.(".orb");
  if (orb) focusedIndex = Number(orb.dataset.index);
});
elements.board.addEventListener("click", (event) => {
  if (!tapMode || state.status !== "running") return;
  const orb = event.target.closest(".orb");
  if (orb && !orb.disabled) selectCell(Number(orb.dataset.index));
});
elements.board.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    moveFocus(event.key);
  } else if (event.key === " ") {
    event.preventDefault();
    selectCell(focusedIndex);
  } else if (event.key === "Enter") {
    event.preventDefault();
    selection.length ? resolveSelection() : selectCell(focusedIndex);
  } else if (event.key === "Escape" && selection.length) {
    event.preventDefault();
    event.stopPropagation();
    cancelSelection();
  }
});

elements.finishChain.addEventListener("click", resolveSelection);
elements.cancelChain.addEventListener("click", () => cancelSelection());
$("#start-button").addEventListener("click", () => startGame());
elements.pauseButton.addEventListener("click", () => {
  if (state.status === "running") pauseGame();
  else if (state.status === "paused") resumeGame();
});
$("#resume-button").addEventListener("click", resumeGame);
$("#restart-button").addEventListener("click", () => startGame({ keepDifficulty: true }));
$("#help-button").addEventListener("click", openHelp);
$("#close-help").addEventListener("click", closeHelp);
$("#resume-from-help").addEventListener("click", closeHelp);
elements.toggleInput.addEventListener("click", () => {
  tapMode = !tapMode;
  cancelSelection(false);
  elements.toggleInput.setAttribute("aria-pressed", String(tapMode));
  elements.toggleInput.textContent = `點選模式：${tapMode ? "開" : "關"}`;
  elements.inputHint.textContent = tapMode
    ? "逐顆點選相同符號，再按「完成連線」"
    : "滑鼠／觸控：按住拖曳 · 鍵盤：空白選取、Enter 完成";
  showToast(tapMode ? "點選模式已開啟" : "拖曳模式已開啟", 1400);
});
elements.toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  renderSoundButton();
  if (soundEnabled) playTone(520, 0.1, 0.035, "triangle");
});
$("#retry-button").addEventListener("click", () => startGame({ keepDifficulty: true }));
$("#new-seed-button").addEventListener("click", () => {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  seed = `shift-${random[0]}`;
  startGame({ keepDifficulty: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.helpModal.hidden) closeHelp();
  else if (state.status === "paused") resumeGame();
  else if (state.status === "running" && !selection.length) pauseGame();
});
window.addEventListener("resize", renderPath);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "running") pauseGame();
});

if (params.get("debug") === "1") {
  window.__STARCARE_DEBUG__ = {
    snapshot: () => structuredClone({ ...state, board: state.board.map((cell) => ({ ...cell })) }),
    legalPath: () => findLegalPath(state.board),
    playLegalMove: () => {
      const path = findLegalPath(state.board);
      if (!path) return false;
      selection = path;
      return resolveSelection();
    },
    endShift: () => endShift("debug"),
    start: () => startGame()
  };
}

buildStaticHelp();
document.documentElement.dataset.appVersion = APP_VERSION;
$("#version-label").textContent = `GRAYBOX v${APP_VERSION}`;
renderAll();
window.requestAnimationFrame(frame);
$("#start-button").focus();
