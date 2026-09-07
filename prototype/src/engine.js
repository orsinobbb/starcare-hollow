export const TASK_TYPES = Object.freeze([
  {
    id: "observe",
    label: "觀察",
    symbol: "◉",
    station: "星紋觀測桌",
    helper: "賽恩",
    action: "讀取星紋",
    power: 3,
    cooldown: 1.5
  },
  {
    id: "brew",
    label: "調製",
    symbol: "❧",
    station: "月露調製台",
    helper: "艾芙",
    action: "調製月露",
    power: 3,
    cooldown: 1.9
  },
  {
    id: "care",
    label: "療護",
    symbol: "✚",
    station: "暖光診療床",
    helper: "米菈",
    action: "施作療護",
    power: 3,
    cooldown: 2.1
  },
  {
    id: "comfort",
    label: "安撫",
    symbol: "♥",
    station: "安心茶席",
    helper: "絨絨",
    action: "送上抱抱",
    power: 3,
    cooldown: 1.7
  }
]);

export const TASK_IDS = Object.freeze(TASK_TYPES.map((task) => task.id));

export const COMPANION_SKILLS = Object.freeze([
  {
    id: "moon-bloom",
    companion: "艾芙",
    title: "月芽盛放",
    symbol: "❧",
    detail: "立即完成兩項最急迫的工作"
  },
  {
    id: "star-pause",
    companion: "賽恩",
    title: "星時停駐",
    symbol: "✦",
    detail: "暫停耐心 8 秒，並重置所有工作站"
  },
  {
    id: "cloud-hug",
    companion: "絨絨",
    title: "安心抱抱",
    symbol: "♥",
    detail: "全員回復 35% 耐心與 10 點安定"
  }
]);

export const SKILL_CHARGE_MAX = 100;
export const SKILL_CHARGE_PER_SERVICE = 25;
export const FLOW_WINDOW_SECONDS = 5;

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

export function shuffledIndexes(length, rng = createRng()) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes;
}

export function jobUrgency(age, deadline) {
  const ratio = deadline > 0 ? age / deadline : 1;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.75) return "urgent";
  if (ratio >= 0.5) return "reminder";
  return "calm";
}

export function selectServiceJob(jobs, type, selectedPatientId = null) {
  const matching = jobs.filter((job) => job.type === type && job.remaining > 0);
  if (!matching.length) return null;
  const selected = selectedPatientId
    ? matching.find((job) => job.patientId === selectedPatientId)
    : null;
  if (selected) return selected;
  return [...matching].sort((a, b) => {
    const urgencyDifference = (b.age / Math.max(1, b.deadline)) - (a.age / Math.max(1, a.deadline));
    return urgencyDifference || a.remaining - b.remaining || String(a.id).localeCompare(String(b.id));
  })[0];
}

export function resolveService(job, power) {
  const safePower = Math.max(0, Number(power) || 0);
  const remaining = Math.max(0, Number(job?.remaining) || 0);
  const workDone = Math.min(remaining, safePower);
  return {
    workDone,
    remaining: remaining - workDone,
    completed: remaining > 0 && remaining - workDone === 0
  };
}

export function advanceCooldowns(cooldowns, delta) {
  const safeDelta = Math.max(0, Number(delta) || 0);
  return Object.fromEntries(
    TASK_IDS.map((type) => [type, Math.max(0, (Number(cooldowns?.[type]) || 0) - safeDelta)])
  );
}

export function nextCareFlow(currentFlow, lastServiceAt, now, windowSeconds = FLOW_WINDOW_SECONDS) {
  const current = Math.max(0, Number(currentFlow) || 0);
  const currentTime = Number(now) || 0;
  const previousTime = Number(lastServiceAt);
  if (!Number.isFinite(previousTime) || currentTime - previousTime > windowSeconds) return 1;
  return current + 1;
}

export function addSkillCharge(current, amount = SKILL_CHARGE_PER_SERVICE) {
  return Math.min(SKILL_CHARGE_MAX, Math.max(0, Number(current) || 0) + Math.max(0, Number(amount) || 0));
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
