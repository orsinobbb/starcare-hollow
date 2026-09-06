import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  classifyChain,
  createBoard,
  createRng,
  findLegalPath,
  formatTime,
  injectChaos,
  isAdjacent,
  jobUrgency,
  makeCell,
  resolveMove,
  validatePath
} from "../src/engine.js";

function solidBoard(type = "care") {
  return Array.from({ length: BOARD_COLUMNS * BOARD_ROWS }, (_, index) => makeCell(type, { id: `fixed-${index}` }));
}

test("seeded board generation is deterministic and playable", () => {
  const first = createBoard({ rng: createRng("same-seed") });
  const second = createBoard({ rng: createRng("same-seed") });
  assert.deepEqual(first.map((cell) => cell.type), second.map((cell) => cell.type));
  assert.equal(first.length, 42);
  assert.ok(findLegalPath(first));
});

test("adjacency supports diagonals without wrapping rows", () => {
  assert.equal(isAdjacent(0, 1), true);
  assert.equal(isAdjacent(0, 8), true);
  assert.equal(isAdjacent(6, 7), false);
  assert.equal(isAdjacent(8, 8), false);
});

test("path validation rejects repeated and mixed cells", () => {
  const board = solidBoard("observe");
  board[2] = makeCell("brew", { id: "mixed" });
  assert.equal(validatePath(board, [0, 1, 2]).valid, false);
  assert.equal(validatePath(board, [0, 1, 0]).valid, false);
  assert.equal(validatePath(board, [0, 1]).valid, false);
});

test("chain thresholds map to the four special orb tiers", () => {
  assert.equal(classifyChain(4), null);
  assert.equal(classifyChain(5).kind, "pulse");
  assert.equal(classifyChain(7).kind, "resonance");
  assert.equal(classifyChain(10).kind, "star");
  assert.equal(classifyChain(13).kind, "perfect");
});

test("five-chain produces a pulse orb and preserves board size", () => {
  const board = solidBoard("care");
  const result = resolveMove(board, [0, 1, 2, 3, 4], { rng: createRng("pulse-test") });
  assert.equal(result.valid, true);
  assert.equal(result.createdSpecial.kind, "pulse");
  assert.equal(result.workByType.care, 5);
  assert.equal(result.board.length, 42);
  assert.equal(result.board.filter((cell) => cell.special === "pulse").length, 1);
});

test("an activated resonance orb doubles primary work", () => {
  const board = solidBoard("brew");
  board[0].special = "resonance";
  const result = resolveMove(board, [0, 1, 2], { rng: createRng("resonance-test") });
  assert.equal(result.valid, true);
  assert.deepEqual(result.activated, ["resonance"]);
  assert.equal(result.workByType.brew, 6);
});

test("pulse clears its line and a neighboring chaos orb is purified", () => {
  const board = solidBoard("comfort");
  board[0].special = "pulse";
  board[0].orientation = "horizontal";
  board[9] = makeCell(null, { id: "chaos", chaos: true });
  const result = resolveMove(board, [0, 1, 8], { rng: createRng("chaos-test") });
  assert.equal(result.valid, true);
  assert.ok(result.clearedCount >= BOARD_COLUMNS);
  assert.equal(result.purified, 1);
  assert.equal(result.board.some((cell) => cell.id === "chaos"), false);
});

test("chaos injection replaces a normal orb while keeping a legal move", () => {
  const board = solidBoard("observe");
  const result = injectChaos(board, createRng("inject"), "observe");
  assert.ok(result.index >= 0);
  assert.equal(result.board[result.index].chaos, true);
  assert.ok(findLegalPath(result.board));
});

test("urgency and clock formatting expose clear player-facing states", () => {
  assert.equal(jobUrgency(4, 10), "calm");
  assert.equal(jobUrgency(5, 10), "reminder");
  assert.equal(jobUrgency(8, 10), "urgent");
  assert.equal(jobUrgency(10, 10), "critical");
  assert.equal(formatTime(180), "3:00");
  assert.equal(formatTime(9.1), "0:10");
});
