// The app's single source of "now". Always use now() instead of Date.now()
// so the demo "time travel" setting (Settings → Demo tools) works everywhere.
// Pure module: no DOM.

let offsetMs = 0;
try {
  const v = Number(globalThis.sessionStorage && sessionStorage.getItem('tab.clockOffset'));
  if (Number.isFinite(v)) offsetMs = v;
} catch { /* storage unavailable */ }

const listeners = new Set();

export function now() { return Date.now() + offsetMs; }
export function clockOffset() { return offsetMs; }

export function setClockOffset(ms) {
  offsetMs = Number(ms) || 0;
  try { globalThis.sessionStorage && sessionStorage.setItem('tab.clockOffset', String(offsetMs)); } catch { /* ignore */ }
  listeners.forEach(fn => fn(offsetMs));
}

export function onClockChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
