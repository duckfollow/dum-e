import test from "node:test";
import assert from "node:assert/strict";
import {
  beginActivity,
  getActivities,
  subscribeActivities,
} from "./activity.ts";

test("concurrent requests remain visible until each completes, including out-of-order cleanup", () => {
  const finishQuery = beginActivity("Running SQL…");
  const finishDetails = beginActivity("Loading table details…");
  try {
    assert.equal(getActivities().length, 2);
    finishDetails();
    assert.equal(getActivities().length, 1);
    assert.equal(getActivities()[0].label, "Running SQL…");
    finishDetails();
    assert.equal(getActivities().length, 1);
    finishQuery();
    assert.equal(getActivities().length, 0);
  } finally {
    finishQuery();
    finishDetails();
  }
});

test("activity snapshots stay stable between changes and stopped subscriptions are not notified", () => {
  let notifications = 0;
  const unsubscribe = subscribeActivities(() => notifications++);
  const before = getActivities();
  const finish = beginActivity("Sorting data…");
  try {
    const active = getActivities();
    assert.notEqual(before, active);
    assert.equal(active, getActivities());
    assert.equal(notifications, 1);
    unsubscribe();
    finish();
    assert.equal(notifications, 1);
    assert.equal(getActivities().length, 0);
  } finally {
    unsubscribe();
    finish();
  }
});
