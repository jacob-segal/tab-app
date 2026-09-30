// UI-level actions: wrap store mutations with location, haptics, toasts and
// undo. Pages should call these rather than store.addLog/removeLog directly.

import { CATEGORY_BY_ID, DRINK_TYPE_BY_ID } from './config.js';
import {
  addLog, removeLog, restoreLog, setLogLocation, startSession, endSession, appendRoutePoint, adoptLogsIntoSession,
  getState, LockedDayError,
} from './store.js';
import { getPosition } from './geo.js';
import { toast } from './ui.js';
import { navigate } from './router.js';

const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

export function itemLabel(cat, sub) {
  if (cat === 'drinks' && sub) return DRINK_TYPE_BY_ID[sub]?.label || 'Drink';
  return CATEGORY_BY_ID[cat]?.label.replace(/s$/, '') || cat;
}
export function itemEmoji(cat, sub) {
  if (cat === 'drinks' && sub) return DRINK_TYPE_BY_ID[sub]?.emoji || '🍺';
  return CATEGORY_BY_ID[cat]?.emoji || '•';
}

/**
 * Log one item (tracker "+", session quick-log buttons).
 * @param {string} cat
 * @param {string|null} sub
 * @param {{dayKey?:string, at?:string}} [opts]  at: rough time for back-fills (store.BACKFILL_TIMES)
 * @returns {object|null} log, or null if the day is locked
 */
export function quickLog(cat, sub = null, opts = {}) {
  let log;
  try {
    log = addLog(cat, sub, { dayKey: opts.dayKey, at: opts.at });
  } catch (e) {
    if (e instanceof LockedDayError) { toast('That week already dropped — it’s locked 🔒'); return null; }
    throw e;
  }
  buzz();
  // Pin the location for live logs during a session (async, best-effort).
  const s = getState();
  if (log.sessionId && s.settings.locationEnabled) {
    getPosition({ timeout: 6000, maximumAge: 30000 }).then(pos => pos && setLogLocation(log.id, pos));
  }
  maybeNudgeSession(log);
  return log;
}

// ---- late-night session nudge ----------------------------------------------------
// Logging live after 9 PM with no session running → one toast per night
// suggesting a session. Starting it from the toast pulls in tonight's recent logs.
const NUDGE_KEY = 'tab.sessionNudge';
const NUDGE_FROM_HOUR = 21;

function maybeNudgeSession(log) {
  if (!log || log.manual || log.sessionId) return;
  const h = new Date(log.ts).getHours();
  const rollover = getState().settings.rolloverHour;
  if (!(h >= NUDGE_FROM_HOUR || h < rollover)) return;
  try {
    if (localStorage.getItem(NUDGE_KEY) === log.dayKey) return;
    localStorage.setItem(NUDGE_KEY, log.dayKey);
  } catch { return; }
  setTimeout(() => toast('Out tonight? Start a session to keep it all on one night + map your spots', {
    emoji: '🪩', duration: 7000,
    action: { label: 'Start', onClick: () => beginSession({ adoptSince: log.ts - 3 * 3600e3 }) },
  }), 600);
}

/**
 * Remove the latest matching log for a day, with an Undo toast.
 * @returns {object|null} removed log
 */
export function quickUnlog(cat, sub, dayKey, { undoToast = false } = {}) {
  let removed;
  try {
    removed = removeLog(cat, sub, dayKey);
  } catch (e) {
    if (e instanceof LockedDayError) { toast('That week already dropped — it’s locked 🔒'); return null; }
    throw e;
  }
  if (removed) {
    buzz(4);
    if (undoToast) toast(`Removed ${itemLabel(cat, sub).toLowerCase()}`, { action: { label: 'Undo', onClick: () => restoreLog(removed) } });
  }
  return removed;
}

/**
 * Start a session (grabbing a first GPS fix if location is on) and open the live view.
 * @param {{adoptSince?:number}} [opts]  pull tonight's un-sessioned live logs since this ts into it
 */
export async function beginSession({ adoptSince } = {}) {
  const ses = startSession({});
  if (adoptSince) {
    const n = adoptLogsIntoSession(ses.id, adoptSince);
    if (n > 0) toast(`Session started — pulled in ${n} thing${n === 1 ? '' : 's'} from earlier tonight`, { emoji: '🪩' });
  }
  navigate('/session');
  if (getState().settings.locationEnabled) {
    const loc = await getPosition({ timeout: 8000 });
    if (loc) appendRoutePoint(ses.id, loc); // seed the route with the starting point
  }
  return ses;
}

/** End the active session and open its recap. */
export function finishSession() {
  const s = getState();
  const id = s.activeSessionId;
  if (!id) return null;
  const ses = endSession(id);
  buzz(20);
  navigate(`/session/${id}`, { replace: true });
  return ses;
}
