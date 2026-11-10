/**
 * Runs write transactions one at a time inside this process.
 *
 * Each transaction uses its own SQLite connection and waits for the write lock
 * inside one of the (only 4) threads Node dedicates to SQLite. If more than 4
 * transactions wait at the same time, the one holding the lock cannot get a
 * thread to finish and release it, and the others fail with SQLITE_BUSY.
 * Queueing the transactions avoids it.
 *
 * Usage: await runExclusive(() => doTransaction());
 */
let tail = Promise.resolve();

export const runExclusive = task => {
    const result = tail.then(task);
    // The queue keeps going even if a task fails.
    tail = result.then(() => {}, () => {});
    return result;
};
