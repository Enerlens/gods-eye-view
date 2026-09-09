/**
 * whenIdle — run a task once the boot burst has drained, with a bounded wait.
 *
 * Two things on this page are deliberately paid for AFTER the globe rather
 * than before it: the star field's 848 kB of textures (`starfield.js`) and the
 * 360 kB voice stack (`voice/lazyVoice.js`). Both want the same schedule, and
 * both want it for the same reason — the work is real, nobody is waiting on
 * it, and doing it during boot would put it in front of the one thing somebody
 * IS waiting on.
 *
 * `requestIdleCallback` alone is not enough: a tab that never goes idle would
 * never run the task at all, so the timeout is the contract and the idle
 * window is the optimisation. Safari has no `requestIdleCallback`, hence the
 * fallback.
 *
 * @param {() => void} task
 * @param {number} timeoutMs Upper bound on the wait, in milliseconds.
 * @returns {() => void} Cancels the pending task.
 */
export function whenIdle(task, timeoutMs) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(handle);
}
