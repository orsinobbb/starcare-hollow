import {
  COMPANION_SKILLS,
  SKILL_CHARGE_MAX,
  TASK_IDS,
  TASK_TYPES,
  addSkillCharge,
  advanceCooldowns,
  createRng,
  formatTime,
  jobUrgency,
  nextCareFlow,
  resolveService,
  selectServiceJob,
  shuffledIndexes
} from "./engine.js";
import { createTownController } from "./town.js";
import { APP_VERSION } from "./version.js";

const $ = (selector) => document.querySelector(selector);
const taskById = Object.fromEntries(TASK_TYPES.map((task) => [task.id, task]));
const skillById = Object.fromEntries(COMPANION_SKILLS.map((skill) => [skill.id, skill]));

const DIFFICULTIES = {
  comfort: { label: "舒適", patienceRate: 0.7, urgencyRate: 0.75, canFail: false },
  standard: { label: "標準", patienceRate: 1, urgencyRate: 1, canFail: true },
  focus: { label: "專注", patienceRate: 1.15, urgencyRate: 1.1, canFail: true }
};

const PATIENT_TEMPLATES = [
  {
    name: "露米",
    portrait: "ʚɞ",
    palette: "rose",
    concern: "翅光發燙",
    patience: 100,
    steps: [{ type: "care", work: 4, label: "敷上冷光貼", deadline: 29 }]
  },
  {
    name: "波波",
    portrait: "☁",
    palette: "sky",
    concern: "雲絮失眠",
    patience: 104,
    steps: [
      { type: "observe", work: 4, label: "確認夢紋", deadline: 31 },
      { type: "comfort", work: 4, label: "安撫呼吸", deadline: 27 }
    ]
  },
  {
    name: "亞洛",
    portrait: "✦",
    palette: "indigo",
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
    portrait: "✿",
    palette: "lilac",
    concern: "花語焦慮",
    patience: 98,
    steps: [
      { type: "comfort", work: 5, label: "聽她說完", deadline: 25 },
      { type: "care", work: 5, label: "穩定花光", deadline: 29 }
    ]
  },
  {
    name: "塔塔",
    portrait: "❧",
    palette: "leaf",
    concern: "葉脈褪色",
    patience: 112,
    steps: [
      { type: "observe", work: 6, label: "檢查葉脈", deadline: 29 },
      { type: "brew", work: 6, label: "補充晨露", deadline: 27 }
    ]
  },
  {
    name: "諾伊",
    portrait: "☾",
    palette: "moon",
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
    portrait: "♧",
    palette: "mint",
    concern: "種子低鳴",
    patience: 101,
    steps: [
      { type: "brew", work: 5, label: "調製根露", deadline: 26 },
      { type: "comfort", work: 5, label: "喚醒低鳴", deadline: 26 }
    ]
  },
  {
    name: "卡洛",
    portrait: "◇",
    palette: "amber",
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
let soundEnabled = true;
let audioContext = null;
let lastFrameTime = 0;
let lastHudRender = 0;
let toastTimeout = null;
let helpReturnStatus = "briefing";
let currentShiftId = null;
let townController = null;

const elements = {
  goalValue: $("#goal-value"),
  waveValue: $("#wave-value"),
  timeValue: $("#time-value"),
  stabilityValue: $("#stability-value"),
  stabilityBar: $("#stability-bar"),
  patientList: $("#patient-list"),
  waitingCount: $("#waiting-count"),
  stationList: $("#station-list"),
  demandList: $("#demand-list"),
  selectedVisit: $("#selected-visit"),
  selectionSummary: $("#selection-summary"),
  selectionPreview: $("#selection-preview"),
  careFeedback: $("#care-feedback"),
  skillList: $("#skill-list"),
  skillCharge: $(".skill-charge"),
  skillChargeBar: $("#skill-charge-bar"),
  skillChargeValue: $("#skill-charge-value"),
  skillFeedback: $("#skill-feedback"),
  bestFlowValue: $("#best-flow-value"),
  skillsUsedValue: $("#skills-used-value"),
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
  townHud: $("#town-hud"),
  shiftHud: $("#shift-hud"),
  clinicControls: $("#clinic-controls"),
  townTab: $("#town-tab"),
  clinicTab: $("#clinic-tab")
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
    services: 0,
    tasksCompleted: 0,
    flow: 0,
    bestFlow: 0,
    lastServiceAt: null,
    skillCharge: 0,
    skillUses: 0,
    cooldowns: Object.fromEntries(TASK_IDS.map((type) => [type, 0])),
    patients: [],
    jobs: [],
    patientOrder: shuffledIndexes(PATIENT_TEMPLATES.length, rng),
    spawnIndex: 0,
    nextPatientId: 1,
    nextJobId: 1,
    selectedPatientId: null,
    freezeRemaining: 0,
    actionFeedback: null,
    actionFeedbackRemaining: 0,
    skillFlashId: null,
    skillFlashRemaining: 0,
    lastWorkedPatientId: null,
    lastWorkedType: null,
    message: "班次尚未開始",
    endedBy: null
  };
}

function activePatients() {
  return state.patients.filter((patient) => patient.status === "active");
}

function waitingPatients() {
  return state.patients.filter((patient) => patient.status === "waiting");
}

function patientById(patientId) {
  return state.patients.find((patient) => patient.id === patientId) ?? null;
}

function jobForPatient(patient) {
  return state.jobs.find((job) => job.patientId === patient.id) ?? null;
}

function demandForType(type) {
  return state.jobs
    .filter((job) => job.type === type)
    .reduce((sum, job) => sum + job.remaining, 0);
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
  elements.townView.hidden = !townActive;
  elements.clinicView.hidden = townActive;
  elements.townHud.hidden = !townActive;
  elements.shiftHud.hidden = townActive;
  elements.clinicControls.hidden = townActive;
  elements.townTab.toggleAttribute("aria-current", townActive);
  elements.clinicTab.toggleAttribute("aria-current", !townActive);
  if (townActive) elements.townTab.setAttribute("aria-current", "page");
  else elements.clinicTab.setAttribute("aria-current", "page");
  document.body.dataset.view = view;
}

function showTownView() {
  if (state.status === "running") {
    showToast("值班進行中；請先暫停並選擇返回小鎮。", 2200);
    return false;
  }
  elements.briefingModal.hidden = true;
  elements.helpModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  setActiveView("town");
  townController?.render();
  window.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

function showClinicView() {
  setActiveView("clinic");
  elements.briefingModal.hidden = state.status !== "briefing";
  elements.pauseModal.hidden = state.status !== "paused";
  elements.resultModal.hidden = state.status !== "result";
  window.scrollTo({ top: 0, behavior: "auto" });
  if (state.status === "briefing") $("#start-button").focus();
  return true;
}

function resetClinicToBriefing() {
  state = createInitialState("briefing");
  currentShiftId = null;
  elements.pauseButton.disabled = true;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  renderAll();
}

function leaveShiftForTown() {
  resetClinicToBriefing();
  showTownView();
  showToast("已返回小鎮；未完成的班次不會消耗任何資源。", 2400);
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

function playServiceSound(flow) {
  const base = Math.min(650, 360 + flow * 24);
  playTone(base, 0.1, 0.04, "triangle");
  window.setTimeout(() => playTone(base * 1.18, 0.12, 0.032, "triangle"), 70);
}

function playSkillSound() {
  playTone(520, 0.12, 0.045, "triangle");
  window.setTimeout(() => playTone(680, 0.15, 0.04, "triangle"), 90);
  window.setTimeout(() => playTone(840, 0.2, 0.035, "sine"), 180);
}

function spawnPatient() {
  const orderIndex = state.spawnIndex % state.patientOrder.length;
  const templateIndex = state.patientOrder[orderIndex];
  const template = PATIENT_TEMPLATES[templateIndex];
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
    if (!state.selectedPatientId) state.selectedPatientId = patient.id;
    announce(`${patient.name}來到療癒所，需要${taskById[patient.steps[0].type].label}。`);
  } else {
    announce(`${patient.name}已在候診區等候。`);
  }
}

function createJobForPatient(patient) {
  const step = patient.steps[patient.stepIndex];
  if (!step || patient.status !== "active") return;
  const difficulty = DIFFICULTIES[state.difficulty];
  state.jobs.push({
    id: `job-${state.nextJobId++}`,
    patientId: patient.id,
    type: step.type,
    label: step.label,
    total: step.work,
    remaining: step.work,
    age: 0,
    deadline: step.deadline / difficulty.urgencyRate,
    nextStrainAt: step.deadline / difficulty.urgencyRate,
    strainEvents: 0
  });
}

function ensureSelectedPatient() {
  const selected = patientById(state.selectedPatientId);
  if (selected?.status === "active" && jobForPatient(selected)) return selected;
  const next = activePatients()
    .map((patient) => ({ patient, job: jobForPatient(patient) }))
    .filter((entry) => entry.job)
    .sort((a, b) => {
      const patienceDifference = (a.patient.patience / a.patient.maxPatience) - (b.patient.patience / b.patient.maxPatience);
      return patienceDifference || (b.job.age / b.job.deadline) - (a.job.age / a.job.deadline);
    })[0]?.patient ?? null;
  state.selectedPatientId = next?.id ?? null;
  return next;
}

function fillActiveSlots() {
  while (activePatients().length < 4) {
    const next = waitingPatients()[0];
    if (!next) break;
    next.status = "active";
    createJobForPatient(next);
    announce(`${next.name}從候診區進入療癒所。`);
  }
  ensureSelectedPatient();
}

function completeJob(jobId) {
  const jobIndex = state.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) return null;
  const [job] = state.jobs.splice(jobIndex, 1);
  const patient = patientById(job.patientId);
  if (!patient || patient.status !== "active") return null;

  patient.stepIndex += 1;
  state.tasksCompleted += 1;
  state.score += 115;

  if (patient.stepIndex >= patient.steps.length) {
    patient.status = "served";
    state.served += 1;
    state.score += 260;
    state.stability = Math.min(100, state.stability + 4);
    if (state.selectedPatientId === patient.id) state.selectedPatientId = null;
    fillActiveSlots();
    return { patient, job, served: true, nextStep: null };
  }

  createJobForPatient(patient);
  return { patient, job, served: false, nextStep: patient.steps[patient.stepIndex] };
}

function departPatient(patient) {
  patient.status = "departed";
  state.jobs = state.jobs.filter((job) => job.patientId !== patient.id);
  state.departed += 1;
  state.stability = Math.max(0, state.stability - 13);
  if (state.selectedPatientId === patient.id) state.selectedPatientId = null;
  announce(`${patient.name}先回家休息；療癒所安定下降。`);
  fillActiveSlots();
}

function showActionFeedback(text, tone = "good") {
  state.actionFeedback = { text, tone };
  state.actionFeedbackRemaining = 0.9;
}

function selectPatient(patientId) {
  if (state.status !== "running") return false;
  const patient = patientById(patientId);
  const job = patient ? jobForPatient(patient) : null;
  if (!patient || patient.status !== "active" || !job) return false;
  state.selectedPatientId = patient.id;
  const task = taskById[job.type];
  announce(`已選擇${patient.name}；請安排${task.label}。`);
  renderDynamic();
  return true;
}

function serviceSelectedPatient(type) {
  if (state.status !== "running") return false;
  const patient = ensureSelectedPatient();
  if (!patient) {
    announce("目前沒有需要照顧的居民。 ");
    return false;
  }
  if (state.cooldowns[type] > 0) {
    announce(`${taskById[type].station}還需要 ${state.cooldowns[type].toFixed(1)} 秒準備。`);
    return false;
  }

  const currentJob = jobForPatient(patient);
  if (!currentJob || currentJob.type !== type) {
    const expected = currentJob ? taskById[currentJob.type] : null;
    state.flow = 0;
    showActionFeedback("需求不符", "miss");
    announce(expected
      ? `${patient.name}現在需要${expected.label}，請看她身上的${expected.symbol}標記。`
      : `${patient.name}目前不需要這項工作。`);
    renderDynamic();
    playTone(190, 0.09, 0.025, "sine");
    return false;
  }

  const job = selectServiceJob(state.jobs, type, patient.id);
  if (!job) return false;
  const station = taskById[type];
  const service = resolveService(job, station.power);
  const wasReady = state.skillCharge >= SKILL_CHARGE_MAX;
  job.remaining = service.remaining;
  state.cooldowns[type] = station.cooldown;
  state.services += 1;
  state.flow = nextCareFlow(state.flow, state.lastServiceAt, state.elapsed);
  state.lastServiceAt = state.elapsed;
  state.bestFlow = Math.max(state.bestFlow, state.flow);
  state.skillCharge = addSkillCharge(state.skillCharge);
  state.score += 45 + Math.min(8, state.flow) * 7;
  state.lastWorkedPatientId = patient.id;
  state.lastWorkedType = type;
  showActionFeedback(`${station.symbol} +${service.workDone} ${station.label}`, "good");

  if (service.completed) {
    const completion = completeJob(job.id);
    if (completion?.served) {
      announce(`${patient.name}恢復精神，安心離開療癒所。`);
    } else if (completion?.nextStep) {
      const nextTask = taskById[completion.nextStep.type];
      announce(`${patient.name}完成${job.label}，接著需要${nextTask.label}。`);
    }
  } else {
    announce(`${station.helper}替${patient.name}${station.action}，還差 ${job.remaining} 點。`);
  }

  if (!wasReady && state.skillCharge >= SKILL_CHARGE_MAX) {
    showToast("搭檔能量已滿！現在可以選一個技能。", 2600);
  }
  playServiceSound(state.flow);
  renderAll();
  return true;
}

function prioritizedJobs(limit = 2) {
  return [...state.jobs]
    .sort((a, b) => (b.age / Math.max(1, b.deadline)) - (a.age / Math.max(1, a.deadline)))
    .slice(0, limit);
}

function activateSkill(skillId) {
  if (state.status !== "running" || state.skillCharge < SKILL_CHARGE_MAX) return false;
  const skill = skillById[skillId];
  if (!skill) return false;
  const patients = activePatients();
  if (!patients.length) {
    announce("現在沒有來訪者，技能能量會替你保留。 ");
    return false;
  }

  let effect = "";
  if (skillId === "moon-bloom") {
    const targets = prioritizedJobs(2).map((job) => job.id);
    for (const jobId of targets) completeJob(jobId);
    effect = `完成 ${targets.length} 項最急迫工作`;
  } else if (skillId === "star-pause") {
    state.freezeRemaining = Math.max(state.freezeRemaining, 8);
    state.cooldowns = Object.fromEntries(TASK_IDS.map((type) => [type, 0]));
    effect = "耐心暫停 8 秒，工作站立即就緒";
  } else if (skillId === "cloud-hug") {
    let restored = 0;
    for (const patient of patients) {
      const before = patient.patience;
      patient.patience = Math.min(patient.maxPatience, patient.patience + patient.maxPatience * 0.35);
      restored += patient.patience - before;
    }
    state.stability = Math.min(100, state.stability + 10);
    effect = `全員恢復耐心，安定 +10`;
  }

  state.skillCharge = 0;
  state.skillUses += 1;
  state.score += 220;
  state.skillFlashId = skillId;
  state.skillFlashRemaining = 1.25;
  showActionFeedback(`${skill.symbol} ${skill.title}！`, "skill");
  ensureSelectedPatient();
  announce(`${skill.companion}施放「${skill.title}」：${effect}。`);
  showToast(`${skill.symbol} ${skill.title}！${effect}`, 2800);
  playSkillSound();
  renderAll();
  return true;
}

function processSpawns() {
  while (
    state.spawnIndex < SPAWN_FRACTIONS.length &&
    state.elapsed >= SPAWN_FRACTIONS[state.spawnIndex] * state.duration
  ) {
    spawnPatient();
    state.spawnIndex += 1;
  }
}

function updateJobsAndPatients(delta) {
  const difficulty = DIFFICULTIES[state.difficulty];
  for (const job of [...state.jobs]) {
    job.age += delta;
    if (job.age >= job.nextStrainAt) {
      job.strainEvents += 1;
      job.nextStrainAt += Math.max(11, job.deadline * 0.58);
      state.stability = Math.max(0, state.stability - (state.difficulty === "focus" ? 7 : 5));
      const patient = patientById(job.patientId);
      if (patient) announce(`${patient.name}等得有些不安；請重新判斷照顧順序。`);
    }
  }

  for (const patient of [...activePatients()]) {
    const job = jobForPatient(patient);
    const urgency = job ? jobUrgency(job.age, job.deadline) : "calm";
    const pressure = urgency === "critical" ? 0.3 : urgency === "urgent" ? 0.13 : 0;
    patient.patience -= delta * (0.62 + pressure) * difficulty.patienceRate;
    if (patient.patience <= 0) departPatient(patient);
  }
}

function tick(delta) {
  state.elapsed += delta;
  state.timeLeft = Math.max(0, state.duration - state.elapsed);
  state.wave = Math.min(3, Math.floor((state.elapsed / state.duration) * 3) + 1);
  state.cooldowns = advanceCooldowns(state.cooldowns, delta);
  state.actionFeedbackRemaining = Math.max(0, state.actionFeedbackRemaining - delta);
  state.skillFlashRemaining = Math.max(0, state.skillFlashRemaining - delta);
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
  // Keep controls stable long enough for touch, keyboard, and assistive-tech activation.
  // Immediate renders still happen after every player action; this interval is only for clocks and meters.
  if (timestamp - lastHudRender > 500) {
    renderDynamic();
    lastHudRender = timestamp;
  }
  window.requestAnimationFrame(frame);
}

function startGame({ keepDifficulty = false } = {}) {
  currentShiftId = globalThis.crypto?.randomUUID?.() ?? `shift-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const selectedDifficulty = keepDifficulty
    ? state.difficulty
    : document.querySelector('input[name="difficulty"]:checked')?.value ?? "standard";
  state = createInitialState("running");
  state.difficulty = selectedDifficulty;
  processSpawns();
  ensureSelectedPatient();
  elements.briefingModal.hidden = true;
  elements.pauseModal.hidden = true;
  elements.resultModal.hidden = true;
  elements.pauseButton.disabled = false;
  elements.pauseButton.textContent = "Ⅱ";
  elements.pauseButton.setAttribute("aria-label", "暫停");
  announce("先看耐心與需求，再把選中的居民交給正確工作站。 ");
  renderAll();
  playTone(440, 0.12, 0.04, "triangle");
  window.setTimeout(() => playTone(550, 0.14, 0.035, "triangle"), 90);
}

function pauseGame() {
  if (state.status !== "running") return;
  state.status = "paused";
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
  elements.patientList.querySelector(".patient-card.is-selected")?.focus();
}

function openHelp() {
  if (!elements.helpModal.hidden) return;
  helpReturnStatus = state.status;
  if (state.status === "running") state.status = "help";
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
  elements.pauseButton.disabled = true;
  renderAll();

  const stars = state.served === 0
    ? 0
    : state.served >= shiftGoal + 2 && state.stability >= 70
      ? 3
      : state.served >= shiftGoal
        ? 2
        : 1;
  const townReward = townController?.recordShift({
    id: currentShiftId,
    served: state.served,
    stars,
    score: state.score,
    skillUses: state.skillUses
  });
  $("#result-stars").textContent = `${"★ ".repeat(stars)}${"☆ ".repeat(3 - stars)}`.trim();
  $("#result-stars").setAttribute("aria-label", `本次獲得 ${stars} 星`);
  $("#result-title").textContent = reason === "stability"
    ? "先把燈火穩定下來"
    : state.served === 0
      ? "先熟悉療癒所的節奏"
      : "今天的燈還亮著";
  $("#result-served").textContent = state.served;
  $("#result-flow").textContent = state.bestFlow;
  $("#result-stability").textContent = Math.round(state.stability);
  $("#result-skills").textContent = state.skillUses;
  $("#result-score").textContent = state.score.toLocaleString("zh-Hant");

  let praise = `你讓 ${state.served} 位來訪者帶著安心回家。`;
  if (state.served === 0) praise = "這次還沒有完成療程；下一輪先選需求最急迫的居民。";
  else if (state.skillUses >= 2) praise = `你和搭檔合作施放了 ${state.skillUses} 次技能，整間療癒所都亮了起來。`;
  else if (state.bestFlow >= 6) praise = `連續 ${state.bestFlow} 次正確調度，讓照護節奏非常流暢。`;
  else if (state.stability >= 80) praise = "你把療癒所的節奏維持得非常安穩。";
  $("#result-praise").textContent = praise;

  let tip = "下一次先點橘框或紅框居民，再安排她需要的工作站。";
  if (state.skillUses === 0) tip = "四次正確照護會充滿技能槽；能量滿時記得選一位搭檔出手。";
  else if (state.served >= shiftGoal) tip = "目標完成。試著保留技能，在兩位居民同時危急時再施放。";
  $("#result-tip").textContent = tip;
  $("#result-town-reward").textContent = townReward?.message ?? "班次成果將在返回小鎮後保存。";

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
    const progressPercent = Math.max(0, Math.min(100, ((job.total - job.remaining) / job.total) * 100));
    const card = document.createElement("button");
    const selected = state.selectedPatientId === patient.id;
    const worked = state.lastWorkedPatientId === patient.id && state.actionFeedbackRemaining > 0;
    card.type = "button";
    card.className = `patient-card palette-${patient.palette}${selected ? " is-selected" : ""}${worked ? " is-treated" : ""}`;
    card.dataset.patientId = patient.id;
    card.dataset.status = status;
    card.disabled = state.status !== "running";
    card.setAttribute("aria-pressed", String(selected));
    card.setAttribute(
      "aria-label",
      `${patient.name}，${patient.concern}，需要${task.label} ${job.remaining} 點，耐心 ${Math.round(patiencePercent)}%${selected ? "，目前已選擇" : ""}`
    );
    card.innerHTML = `
      <span class="patient-topline">
        <span class="patient-avatar" aria-hidden="true"><span>${patient.portrait}</span><i>•ᴗ•</i></span>
        <span class="patient-copy">
          <strong class="patient-name">${patient.name} · ${patient.concern}</strong>
          <small class="patient-step">${job.label} · 還需 ${job.remaining}/${job.total}</small>
        </span>
        <span class="task-token type-${task.id}" aria-hidden="true">${task.symbol}</span>
      </span>
      <span class="work-progress" aria-hidden="true"><span style="width:${progressPercent}%"></span></span>
      <span class="patience-row">
        <span>耐心</span>
        <span class="patient-meter"><span style="width:${patiencePercent}%"></span></span>
        <strong>${Math.ceil(patiencePercent)}%</strong>
      </span>`;
    elements.patientList.append(card);
  }
}

function renderSelectedVisit() {
  const patient = ensureSelectedPatient();
  const job = patient ? jobForPatient(patient) : null;
  if (!patient || !job) {
    elements.selectionSummary.textContent = state.status === "briefing" ? "尚未開始班次" : "等待下一位來訪者";
    elements.selectionPreview.textContent = "完成照護會累積技能能量";
    elements.selectedVisit.className = "selected-visit is-empty";
    elements.selectedVisit.textContent = state.status === "briefing" ? "開始班次後，點選一位來訪者。" : "現在沒有需要安排的工作。";
    return;
  }

  const task = taskById[job.type];
  const status = currentPatientStatus(patient, job);
  elements.selectionSummary.textContent = `正在照顧 ${patient.name}`;
  elements.selectionPreview.textContent = `${job.label} · 還需 ${job.remaining} 點`;
  elements.selectedVisit.className = `selected-visit type-${task.id} is-${status}`;
  elements.selectedVisit.innerHTML = `
    <span class="focus-portrait palette-${patient.palette}" aria-hidden="true"><b>${patient.portrait}</b><i>•ᴗ•</i></span>
    <span class="focus-copy">
      <small>目前安排</small>
      <strong>${patient.name}需要「${job.label}」</strong>
      <span>尋找相同的 <b class="inline-task type-${task.id}">${task.symbol} ${task.label}</b> 工作站</span>
    </span>
    <span class="focus-step">${patient.stepIndex + 1} / ${patient.steps.length}</span>`;
}

function renderStations() {
  elements.stationList.replaceChildren();
  const selected = patientById(state.selectedPatientId);
  const selectedJob = selected ? jobForPatient(selected) : null;

  for (const type of TASK_IDS) {
    const task = taskById[type];
    const cooldown = state.cooldowns[type];
    const demand = demandForType(type);
    const readyRatio = 1 - Math.min(1, cooldown / task.cooldown);
    const matches = selectedJob?.type === type;
    const working = state.lastWorkedType === type && state.actionFeedbackRemaining > 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `station-action type-${type}${matches ? " is-match" : ""}${working ? " is-working" : ""}`;
    button.dataset.stationType = type;
    button.disabled = state.status !== "running" || !selectedJob || cooldown > 0;
    const statusText = cooldown > 0
      ? `準備中 ${cooldown.toFixed(1)} 秒`
      : !selectedJob
        ? "先選一位居民"
        : matches
          ? `${task.action} · 效果 +${task.power}`
          : "目前不是這項需求";
    button.setAttribute("aria-label", `${task.helper}的${task.station}，${statusText}，待辦 ${demand} 點`);
    button.innerHTML = `
      <span class="station-helper" aria-hidden="true"><b>${task.symbol}</b><i>•ᴗ•</i></span>
      <span class="station-copy">
        <small>${task.helper}負責</small>
        <strong>${task.station}</strong>
        <span>${statusText}</span>
      </span>
      <span class="station-demand">待辦 ${demand}</span>
      <span class="station-ready" aria-hidden="true"><span style="width:${readyRatio * 100}%"></span></span>`;
    elements.stationList.append(button);
  }
}

function renderDemand() {
  const demands = Object.fromEntries(TASK_IDS.map((type) => [type, demandForType(type)]));
  const topDemand = TASK_IDS.reduce((top, type) => demands[type] > demands[top] ? type : top, TASK_IDS[0]);
  elements.demandList.replaceChildren();

  for (const type of TASK_IDS) {
    const task = taskById[type];
    const row = document.createElement("div");
    row.className = `demand-row type-${type}${demands[type] > 0 && type === topDemand ? " is-top" : ""}`;
    row.innerHTML = `
      <span class="legend-token" aria-hidden="true">${task.symbol}</span>
      <span class="demand-copy"><strong>${task.label}</strong><small>${task.station}</small></span>
      <span class="demand-number">${demands[type]}</span>`;
    elements.demandList.append(row);
  }
}

function renderSkills() {
  const ready = state.skillCharge >= SKILL_CHARGE_MAX;
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
    button.disabled = state.status !== "running" || !ready || !activePatients().length;
    button.setAttribute("aria-label", `${skill.companion}的技能${skill.title}：${skill.detail}${ready ? "，可以施放" : `，能量 ${Math.round(state.skillCharge)}%`}`);
    button.innerHTML = `
      <span class="skill-portrait" aria-hidden="true"><b>${skill.symbol}</b><i>•ᴗ•</i></span>
      <span class="skill-copy"><small>${skill.companion}</small><strong>${skill.title}</strong><span>${skill.detail}</span></span>
      <span class="skill-state">${ready ? "施放" : `${Math.round(state.skillCharge)}%`}</span>`;
    elements.skillList.append(button);
  }
}

function renderFeedback() {
  const showAction = state.actionFeedback && state.actionFeedbackRemaining > 0;
  elements.careFeedback.hidden = !showAction;
  if (showAction) {
    elements.careFeedback.textContent = state.actionFeedback.text;
    elements.careFeedback.dataset.tone = state.actionFeedback.tone;
  }
  const activeSkill = state.skillFlashRemaining > 0 ? skillById[state.skillFlashId] : null;
  elements.skillFeedback.hidden = !activeSkill;
  if (activeSkill) elements.skillFeedback.textContent = `${activeSkill.symbol} ${activeSkill.title}！`;
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
  elements.bestFlowValue.textContent = state.bestFlow;
  elements.skillsUsedValue.textContent = state.skillUses;
  elements.scoreValue.textContent = state.score.toLocaleString("zh-Hant");
  elements.shiftMessage.textContent = state.freezeRemaining > 0
    ? `✦ 星時停駐中 · ${state.freezeRemaining.toFixed(1)} 秒`
    : state.message;
  renderPatients();
  renderSelectedVisit();
  renderStations();
  renderDemand();
  renderSkills();
  renderFeedback();
}

function renderSoundButton() {
  elements.toggleSound.setAttribute("aria-pressed", String(soundEnabled));
  elements.toggleSound.textContent = soundEnabled ? "♪" : "×";
  elements.toggleSound.setAttribute("aria-label", soundEnabled ? "關閉音效" : "開啟音效");
}

function renderAll() {
  renderDynamic();
  renderSoundButton();
}

function buildStaticHelp() {
  const list = $("#help-task-list");
  list.replaceChildren();
  for (const task of TASK_TYPES) {
    const item = document.createElement("div");
    item.className = `help-task type-${task.id}`;
    item.innerHTML = `
      <span class="legend-token" aria-hidden="true">${task.symbol}</span>
      <span><strong>${task.label}</strong><small>${task.helper} · ${task.station}</small></span>`;
    list.append(item);
  }
}

elements.patientList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-patient-id]");
  if (card) selectPatient(card.dataset.patientId);
});
elements.stationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-station-type]");
  if (button) serviceSelectedPatient(button.dataset.stationType);
});
elements.skillList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-skill-id]");
  if (button) activateSkill(button.dataset.skillId);
});
elements.townTab.addEventListener("click", showTownView);
elements.clinicTab.addEventListener("click", showClinicView);
$("#start-button").addEventListener("click", () => startGame());
$("#briefing-return-town").addEventListener("click", showTownView);
elements.pauseButton.addEventListener("click", () => {
  if (state.status === "running") pauseGame();
  else if (state.status === "paused") resumeGame();
});
$("#resume-button").addEventListener("click", resumeGame);
$("#restart-button").addEventListener("click", () => startGame({ keepDifficulty: true }));
$("#leave-shift-button").addEventListener("click", leaveShiftForTown);
$("#help-button").addEventListener("click", openHelp);
$("#close-help").addEventListener("click", closeHelp);
$("#resume-from-help").addEventListener("click", closeHelp);
elements.toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  renderSoundButton();
  if (soundEnabled) playTone(520, 0.1, 0.035, "triangle");
});
$("#retry-button").addEventListener("click", () => startGame({ keepDifficulty: true }));
$("#return-town-button").addEventListener("click", () => {
  resetClinicToBriefing();
  showTownView();
  showToast("班次成果已保存，小鎮也向前一步。", 2200);
});
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
  else if (state.status === "running") pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "running") pauseGame();
});

townController = createTownController({
  root: document,
  storage: window.localStorage,
  onEnterClinic: showClinicView,
  onNotify: showToast
});

if (params.get("debug") === "1") {
  window.__STARCARE_DEBUG__ = {
    snapshot: () => structuredClone(state),
    townSnapshot: () => townController.snapshot(),
    selectPatient,
    serve: serviceSelectedPatient,
    useSkill: activateSkill,
    endShift: () => endShift("debug"),
    start: () => startGame()
  };
}

buildStaticHelp();
document.documentElement.dataset.appVersion = APP_VERSION;
$("#version-label").textContent = `CORE v${APP_VERSION}`;
$("#start-button").textContent = `開始 ${formatTime(shiftDuration)} 班次`;
$("#briefing-goal").textContent = `目標：照顧完成 ${shiftGoal} 位來訪者`;
renderAll();
if (params.get("view") === "clinic") showClinicView();
else showTownView();
window.requestAnimationFrame(frame);
if (params.get("view") === "clinic") $("#start-button").focus();
else $("#enter-clinic").focus();
