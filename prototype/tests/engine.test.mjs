import assert from "node:assert/strict";
import test from "node:test";

import {
  SKILL_CHARGE_MAX,
  TASK_IDS,
  addSkillCharge,
  advanceCooldowns,
  createRng,
  formatTime,
  jobUrgency,
  nextCareFlow,
  resolveService,
  selectServiceJob,
  shuffledIndexes
} from "../src/engine.js";

test("seeded visitor order is deterministic and complete", () => {
  const first = shuffledIndexes(8, createRng("same-town"));
  const second = shuffledIndexes(8, createRng("same-town"));
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("a selected resident keeps priority at the matching station", () => {
  const jobs = [
    { id: "a", patientId: "patient-a", type: "care", age: 8, deadline: 10, remaining: 4 },
    { id: "b", patientId: "patient-b", type: "care", age: 2, deadline: 10, remaining: 2 }
  ];
  assert.equal(selectServiceJob(jobs, "care", "patient-b")?.id, "b");
  assert.equal(selectServiceJob(jobs, "brew", "patient-b"), null);
});

test("without a selected match, the most urgent resident is served", () => {
  const jobs = [
    { id: "calm", patientId: "a", type: "observe", age: 2, deadline: 10, remaining: 2 },
    { id: "urgent", patientId: "b", type: "observe", age: 9, deadline: 10, remaining: 5 }
  ];
  assert.equal(selectServiceJob(jobs, "observe", "missing")?.id, "urgent");
});

test("service work completes without making remaining work negative", () => {
  assert.deepEqual(resolveService({ remaining: 5 }, 3), { workDone: 3, remaining: 2, completed: false });
  assert.deepEqual(resolveService({ remaining: 2 }, 3), { workDone: 2, remaining: 0, completed: true });
  assert.deepEqual(resolveService({ remaining: 2 }, -4), { workDone: 0, remaining: 2, completed: false });
});

test("all station cooldowns advance safely", () => {
  const result = advanceCooldowns({ observe: 1, brew: 0.2, care: 4, comfort: 0 }, 0.5);
  assert.deepEqual(Object.keys(result), TASK_IDS);
  assert.deepEqual(result, { observe: 0.5, brew: 0, care: 3.5, comfort: 0 });
});

test("care flow continues inside its window and resets outside it", () => {
  assert.equal(nextCareFlow(3, 10, 14), 4);
  assert.equal(nextCareFlow(3, 10, 16), 1);
  assert.equal(nextCareFlow(0, null, 2), 1);
});

test("skill charge grows by correct services and caps at full", () => {
  assert.equal(addSkillCharge(0), 25);
  assert.equal(addSkillCharge(75), SKILL_CHARGE_MAX);
  assert.equal(addSkillCharge(95, 30), SKILL_CHARGE_MAX);
  assert.equal(addSkillCharge(10, -10), 10);
});

test("urgency and clock formatting expose clear player-facing states", () => {
  assert.equal(jobUrgency(4, 10), "calm");
  assert.equal(jobUrgency(5, 10), "reminder");
  assert.equal(jobUrgency(8, 10), "urgent");
  assert.equal(jobUrgency(10, 10), "critical");
  assert.equal(formatTime(180), "3:00");
  assert.equal(formatTime(9.1), "0:10");
});
