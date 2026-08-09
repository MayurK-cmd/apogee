export function createLock() {
  let lock = Promise.resolve();
  return async function acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const previous = lock;
    lock = next;
    await previous;
    return release;
  };
}
