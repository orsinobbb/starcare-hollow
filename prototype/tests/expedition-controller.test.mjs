import test from "node:test";
import assert from "node:assert/strict";

import { waitForAnimationSafely } from "../src/expedition.js";

test("expedition animation guard completes an ordinary animation", async () => {
  const result = await waitForAnimationSafely(() => Promise.resolve(), 50);

  assert.deepEqual(result, { status: "completed" });
});

test("expedition animation guard releases the controller after a rejected animation", async () => {
  const failure = new Error("renderer interrupted");
  const result = await waitForAnimationSafely(() => Promise.reject(failure), 50);

  assert.equal(result.status, "failed");
  assert.equal(result.error, failure);
});

test("expedition animation guard releases the controller when an animation never settles", async () => {
  const result = await waitForAnimationSafely(() => new Promise(() => {}), 10);

  assert.deepEqual(result, { status: "timeout" });
});
