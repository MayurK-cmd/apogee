import test from "node:test";
import assert from "node:assert";
import { NotificationTargetManager } from "../../lib/util/notificationTargets.js";

test("NotificationTargetManager stores and retrieves notification target within TTL", () => {
  const manager = new NotificationTargetManager({
    ttlMs: 1000,
    maxCapacity: 5,
  });
  manager.set("notif-1", { tabId: 10, windowId: 1 });

  const target = manager.get("notif-1");
  assert.ok(target);
  assert.strictEqual(target.tabId, 10);
  assert.strictEqual(target.windowId, 1);
});

test("NotificationTargetManager expires entries after TTL elapses", (t) => {
  const manager = new NotificationTargetManager({ ttlMs: 50, maxCapacity: 5 });
  manager.set("notif-1", { helpUrl: "https://example.com/help" });

  const originalNow = Date.now;
  t.after(() => {
    Date.now = originalNow;
  });

  Date.now = () => originalNow() + 100;

  assert.strictEqual(manager.get("notif-1"), null);
  assert.strictEqual(manager.size, 0);
});

test("NotificationTargetManager evicts oldest entries when capacity is exceeded", () => {
  const manager = new NotificationTargetManager({
    ttlMs: 60000,
    maxCapacity: 3,
  });
  manager.set("id-1", { tabId: 1 });
  manager.set("id-2", { tabId: 2 });
  manager.set("id-3", { tabId: 3 });

  assert.strictEqual(manager.size, 3);
  assert.ok(manager.get("id-1"));

  manager.set("id-4", { tabId: 4 });

  assert.strictEqual(manager.size, 3);
  assert.strictEqual(manager.get("id-1"), null);
  assert.ok(manager.get("id-2"));
  assert.ok(manager.get("id-3"));
  assert.ok(manager.get("id-4"));
});

test("NotificationTargetManager delete and clear work as expected", () => {
  const manager = new NotificationTargetManager({
    ttlMs: 60000,
    maxCapacity: 10,
  });
  manager.set("id-1", { tabId: 1 });
  manager.set("id-2", { tabId: 2 });

  assert.strictEqual(manager.delete("id-1"), true);
  assert.strictEqual(manager.get("id-1"), null);
  assert.strictEqual(manager.size, 1);

  manager.clear();
  assert.strictEqual(manager.size, 0);
});
