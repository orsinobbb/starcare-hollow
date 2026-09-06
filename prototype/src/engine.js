export const BOARD_COLUMNS = 7;
export const BOARD_ROWS = 6;
export const MIN_CHAIN = 3;

export const TASK_TYPES = Object.freeze([
  { id: "observe", label: "觀察", symbol: "◉" },
  { id: "brew", label: "調製", symbol: "❧" },
  { id: "care", label: "療護", symbol: "✚" },
  { id: "comfort", label: "安撫", symbol: "♥" }
]);

export const TASK_IDS = Object.freeze(TASK_TYPES.map((task) => task.id));

let nextCellId = 1;

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

export function makeCell(type, overrides = {}) {
  return {
    id: overrides.id ?? `orb-${nextCellId++}`,
    type,
    special: overrides.special ?? null,
    orientation: overrides.orientation ?? null,
    chaos: overrides.chaos ?? false
  };
}

export function indexToPoint(index, columns = BOARD_COLUMNS) {
  return { row: Math.floor(index / columns), column: index % columns };
}

export function pointToIndex(row, column, columns = BOARD_COLUMNS) {
  return row * columns + column;
}

export function isAdjacent(first, second, columns = BOARD_COLUMNS) {
  if (first === second || first < 0 || second < 0) return false;
  const a = indexToPoint(first, columns);
  const b = indexToPoint(second, columns);
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.column - b.column) <= 1;
}

export function getNeighbors(index, rows = BOARD_ROWS, columns = BOARD_COLUMNS) {
  const { row, column } = indexToPoint(index, columns);
  const neighbors = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) continue;
      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;
      if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
      neighbors.push(pointToIndex(nextRow, nextColumn, columns));
    }
  }
  return neighbors;
}

function normalizedWeights(weights = {}) {
  return TASK_IDS.map((type) => ({
    type,
    weight: Math.max(0.05, Number(weights[type]) || 1)
  }));
}

export function weightedType(rng, weights = {}) {
  const entries = normalizedWeights(weights);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return entries.at(-1).type;
}

export function findLegalPath(
  board,
  minimum = MIN_CHAIN,
  rows = BOARD_ROWS,
  columns = BOARD_COLUMNS
) {
  for (let start = 0; start < board.length; start += 1) {
    const startCell = board[start];
    if (!startCell || startCell.chaos || !startCell.type) continue;
    const stack = [{ index: start, path: [start] }];
    while (stack.length) {
      const current = stack.pop();
      if (current.path.length >= minimum) return current.path;
      for (const neighbor of getNeighbors(current.index, rows, columns)) {
        if (current.path.includes(neighbor)) continue;
        const cell = board[neighbor];
        if (!cell || cell.chaos || cell.type !== startCell.type) continue;
        stack.push({ index: neighbor, path: [...current.path, neighbor] });
      }
    }
  }
  return null;
}

export function ensurePlayable(
  board,
  rng,
  weights = {},
  rows = BOARD_ROWS,
  columns = BOARD_COLUMNS
) {
  if (findLegalPath(board, MIN_CHAIN, rows, columns)) return board;

  const candidates = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column <= columns - MIN_CHAIN; column += 1) {
      const indexes = Array.from(
        { length: MIN_CHAIN },
        (_, offset) => pointToIndex(row, column + offset, columns)
      );
      if (indexes.every((index) => board[index] && !board[index].chaos && !board[index].special)) {
        candidates.push(indexes);
      }
    }
  }

  const target = candidates[Math.floor(rng() * candidates.length)] ?? [0, 1, 2];
  const type = weightedType(rng, weights);
  for (const index of target) {
    board[index] = makeCell(type, { id: board[index]?.id });
  }
  return board;
}

export function createBoard({
  rng = createRng(),
  weights = {},
  rows = BOARD_ROWS,
  columns = BOARD_COLUMNS
} = {}) {
  const board = Array.from({ length: rows * columns }, () => makeCell(weightedType(rng, weights)));
  return ensurePlayable(board, rng, weights, rows, columns);
}

export function validatePath(
  board,
  path,
  minimum = MIN_CHAIN,
  columns = BOARD_COLUMNS
) {
  if (!Array.isArray(path) || path.length < minimum) {
    return { valid: false, reason: "至少連起 3 顆相同任務珠" };
  }
  if (new Set(path).size !== path.length) {
    return { valid: false, reason: "同一顆任務珠不能重複經過" };
  }
  const first = board[path[0]];
  if (!first || first.chaos || !first.type) {
    return { valid: false, reason: "混沌珠不能作為連線起點" };
  }
  for (let index = 0; index < path.length; index += 1) {
    const cell = board[path[index]];
    if (!cell || cell.chaos || cell.type !== first.type) {
      return { valid: false, reason: "只能連接相同符號" };
    }
    if (index > 0 && !isAdjacent(path[index - 1], path[index], columns)) {
      return { valid: false, reason: "任務珠必須彼此相鄰" };
    }
  }
  return { valid: true, type: first.type };
}

export function classifyChain(length) {
  if (length >= 13) return { kind: "perfect", label: "完美星核", multiplier: 1 };
  if (length >= 10) return { kind: "star", label: "星核", multiplier: 1 };
  if (length >= 7) return { kind: "resonance", label: "共鳴珠", multiplier: 2 };
  if (length >= 5) return { kind: "pulse", label: "脈衝珠", multiplier: 1 };
  return null;
}

function addPulseArea(removed, index, orientation, rows, columns) {
  const point = indexToPoint(index, columns);
  if (orientation === "vertical") {
    for (let row = 0; row < rows; row += 1) {
      removed.add(pointToIndex(row, point.column, columns));
    }
  } else {
    for (let column = 0; column < columns; column += 1) {
      removed.add(pointToIndex(point.row, column, columns));
    }
  }
}

function addStarArea(removed, index, rows, columns) {
  const point = indexToPoint(index, columns);
  for (let row = point.row - 1; row <= point.row + 1; row += 1) {
    for (let column = point.column - 1; column <= point.column + 1; column += 1) {
      if (row < 0 || row >= rows || column < 0 || column >= columns) continue;
      removed.add(pointToIndex(row, column, columns));
    }
  }
}

function collapseAndRefill(board, removed, rng, weights, rows, columns) {
  const nextBoard = Array(rows * columns).fill(null);
  for (let column = 0; column < columns; column += 1) {
    const survivors = [];
    for (let row = rows - 1; row >= 0; row -= 1) {
      const index = pointToIndex(row, column, columns);
      if (!removed.has(index) && board[index]) survivors.push(board[index]);
    }
    let destinationRow = rows - 1;
    for (const cell of survivors) {
      nextBoard[pointToIndex(destinationRow, column, columns)] = cell;
      destinationRow -= 1;
    }
    while (destinationRow >= 0) {
      nextBoard[pointToIndex(destinationRow, column, columns)] = makeCell(weightedType(rng, weights));
      destinationRow -= 1;
    }
  }
  return ensurePlayable(nextBoard, rng, weights, rows, columns);
}

export function resolveMove(board, path, {
  rng = createRng(),
  weights = {},
  rows = BOARD_ROWS,
  columns = BOARD_COLUMNS
} = {}) {
  const validation = validatePath(board, path, MIN_CHAIN, columns);
  if (!validation.valid) return { ...validation, board };

  const chainType = validation.type;
  const pathSet = new Set(path);
  const removed = new Set(path);
  const activated = [];
  const forceResolveTypes = new Set();
  let workMultiplier = 1;
  let freezeSeconds = 0;

  for (const index of path) {
    const cell = board[index];
    if (!cell.special) continue;
    activated.push(cell.special);
    if (cell.special === "pulse") {
      addPulseArea(removed, index, cell.orientation ?? "horizontal", rows, columns);
    } else if (cell.special === "resonance") {
      workMultiplier *= 2;
    } else if (cell.special === "star") {
      addStarArea(removed, index, rows, columns);
      freezeSeconds = Math.max(freezeSeconds, 1.5);
    } else if (cell.special === "perfect") {
      forceResolveTypes.add(cell.type);
    }
  }

  const createdSpecial = classifyChain(path.length);
  let anchorCell = null;
  if (createdSpecial) {
    const anchorIndex = path[0];
    anchorCell = board[anchorIndex];
    const first = indexToPoint(path[0], columns);
    const last = indexToPoint(path.at(-1), columns);
    const orientation = Math.abs(last.row - first.row) > Math.abs(last.column - first.column)
      ? "vertical"
      : "horizontal";
    anchorCell.special = createdSpecial.kind;
    anchorCell.orientation = createdSpecial.kind === "pulse" ? orientation : null;
    anchorCell.chaos = false;
    removed.delete(anchorIndex);
  }

  const initialRemoved = [...removed];
  for (const index of initialRemoved) {
    if (!board[index] || board[index].chaos) continue;
    for (const neighbor of getNeighbors(index, rows, columns)) {
      if (board[neighbor]?.chaos) removed.add(neighbor);
    }
  }

  const workByType = Object.fromEntries(TASK_IDS.map((type) => [type, 0]));
  workByType[chainType] = path.length;
  for (const index of removed) {
    if (pathSet.has(index)) continue;
    const cell = board[index];
    if (cell?.type && !cell.chaos) workByType[cell.type] += 1;
  }
  workByType[chainType] *= workMultiplier;

  const purified = [...removed].filter((index) => board[index]?.chaos).length;
  const nextBoard = collapseAndRefill(board, removed, rng, weights, rows, columns);
  const createdAt = anchorCell ? nextBoard.findIndex((cell) => cell.id === anchorCell.id) : -1;

  return {
    valid: true,
    board: nextBoard,
    chainType,
    chainLength: path.length,
    workByType,
    clearedCount: removed.size,
    purified,
    activated,
    createdSpecial,
    createdAt,
    forceResolveTypes: [...forceResolveTypes],
    freezeSeconds
  };
}

export function injectChaos(
  board,
  rng,
  preferredType = null,
  rows = BOARD_ROWS,
  columns = BOARD_COLUMNS
) {
  const eligible = board
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell && !cell.chaos && !cell.special);
  const preferred = eligible.filter(({ cell }) => cell.type === preferredType);
  const pool = preferred.length ? preferred : eligible;
  if (!pool.length) return { board, index: -1 };
  const target = pool[Math.floor(rng() * pool.length)].index;
  const nextBoard = [...board];
  nextBoard[target] = makeCell(null, { id: board[target].id, chaos: true });
  ensurePlayable(nextBoard, rng, {}, rows, columns);
  return { board: nextBoard, index: target };
}

export function jobUrgency(age, deadline) {
  const ratio = deadline > 0 ? age / deadline : 1;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.75) return "urgent";
  if (ratio >= 0.5) return "reminder";
  return "calm";
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
