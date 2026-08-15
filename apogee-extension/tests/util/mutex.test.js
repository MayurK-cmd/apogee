import test from "node:test";
import assert from "node:assert";
import { createLock } from "../../lib/util/mutex.js";

test("acquire and release: a second acquire resolves after the first is released", async () => {
  const acquire = createLock();
  const release1 = await acquire();
  release1();
  const release2 = await acquire();
  release2();
});

test("waiting: second caller does not proceed until first releases", async () => {
  const acquire = createLock();
  const order = [];

  const release1 = await acquire();
  order.push("enter-1");

  const second = acquire().then((release2) => {
    order.push("enter-2");
    release2();
  });

  // Second caller hasn't entered yet because we still hold the lock.
  await Promise.resolve();
  assert.deepStrictEqual(order, ["enter-1"]);

  order.push("exit-1");
  release1();

  await second;
  assert.deepStrictEqual(order, ["enter-1", "exit-1", "enter-2"]);
});

test("try/finally: if the critical section throws, next caller still gets the lock", async () => {
  const acquire = createLock();
  const order = [];

  // First caller throws inside the critical section but releases in finally.
  try {
    const release = await acquire();
    try {
      order.push("enter-1");
      throw new Error("boom");
    } finally {
      release();
    }
  } catch {
    order.push("threw-1");
  }

  // Second caller should still be able to acquire.
  const release2 = await acquire();
  order.push("enter-2");
  release2();

  assert.deepStrictEqual(order, ["enter-1", "threw-1", "enter-2"]);
});

test("ordering: multiple waiters are served in FIFO order", async () => {
  const acquire = createLock();
  const order = [];

  const release1 = await acquire();

  const p2 = acquire().then((release) => {
    order.push("2");
    release();
  });
  const p3 = acquire().then((release) => {
    order.push("3");
    release();
  });
  const p4 = acquire().then((release) => {
    order.push("4");
    release();
  });

  release1();
  await Promise.all([p2, p3, p4]);

  assert.deepStrictEqual(order, ["2", "3", "4"]);
});
