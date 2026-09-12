const RESULT_KINDS = new Set(["success", "discovery", "key", "complete"]);

function positiveInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function createActionResult({
  id,
  source,
  kind = "success",
  icon = "✦",
  title,
  detail = "",
  rewards = [],
  progress = null,
  nextAction = null,
  holdMs = 3000,
  canQueueNext = false
}) {
  if (!id || !source || !title) throw new TypeError("Action results require id, source and title.");
  if (!RESULT_KINDS.has(kind)) throw new TypeError(`Unsupported action result kind: ${kind}`);
  const normalizedRewards = rewards
    .map((reward) => ({
      id: String(reward.id ?? "reward"),
      icon: String(reward.icon ?? "+"),
      label: String(reward.label ?? reward.id ?? "獎勵"),
      amount: positiveInteger(reward.amount)
    }))
    .filter((reward) => reward.amount > 0);

  return Object.freeze({
    id: String(id),
    source: String(source),
    kind,
    icon: String(icon),
    title: String(title),
    detail: String(detail),
    rewards: Object.freeze(normalizedRewards.map(Object.freeze)),
    progress: progress ? Object.freeze({ ...progress }) : null,
    nextAction: nextAction ? Object.freeze({ ...nextAction }) : null,
    presentation: Object.freeze({
      holdMs: Math.max(800, Math.floor(Number(holdMs) || 3000)),
      canQueueNext: Boolean(canQueueNext)
    }),
    committed: true
  });
}

export function createExpeditionActionResult({ event, tile, digNumber, foundCount, totalCount, resourceMeta }) {
  const special = event.type === "discovery" ? event.discovery : event.type === "key" ? event.key : null;
  const rewards = Object.entries(event.reward ?? {}).map(([id, amount]) => ({
    id,
    amount,
    icon: resourceMeta[id]?.icon ?? "+",
    label: resourceMeta[id]?.label ?? id
  }));
  const kind = event.completed ? "complete" : event.type === "discovery" ? "discovery" : event.type === "key" ? "key" : "success";

  return createActionResult({
    id: `expedition:${event.mapId}:${tile.x}:${tile.y}:${digNumber}`,
    source: "expedition",
    kind,
    icon: special?.icon ?? event.terrain?.symbol ?? "✦",
    title: special ? `發現 ${special.name}` : `挖出 ${event.terrain?.name ?? "礦藏"}`,
    detail: special ? "新發現已記入收藏，所有獎勵也已收入背包。" : "成果已可靠收入背包，不必等待動畫才存檔。",
    rewards,
    progress: { current: foundCount, total: totalCount, label: "主要寶物" },
    nextAction: { label: "可直接點下一個發光星標，預約下一鏟" },
    holdMs: 3000,
    canQueueNext: true
  });
}

export function canQueueNextAction(stage, result) {
  return Boolean(result?.presentation?.canQueueNext) && (stage === "reward" || stage === "settle");
}
