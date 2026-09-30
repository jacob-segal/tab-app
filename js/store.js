// App state: shape, persistence (localStorage), and every mutation.
// Pure module (no DOM besides guarded localStorage) — safe for tests.
//
// State shape
// {
//   v: 1,
//   onboarded: boolean,
//   me: { id:'me', name, handle, avatar:{emoji,hue}, school, joinedAt },
//   settings: { rolloverHour, locationEnabled, trackRoute, autoNameSpots, keepAwake, prices:{...}, demoMode },
//   logs:     [{ id, cat, sub, ts, dayKey, sessionId, loc:{lat,lng,acc}|null, manual }],
//   sessions: [{ id, start, end|null, dayKey, name|null, route:[{lat,lng,ts}] }],
//   activeSessionId: string|null,
//   spots:    [{ id, name, lat, lng }],            // named places (for naming clusters)
//   friends:  [userId],
//   requests: { incoming:[{id, at}], outgoing:[{id, at}] },
//   groups:   [{ id, name, emoji, memberIds:['me',...], createdAt, inviteCode }],
//   seenDrops: { [weekKey]: true },                // story reveal already watched
//   dismissedSuggestions: [userId],
// }
// Updates are immutable: every mutation replaces the arrays/objects it touches,
// so reference equality can be used for memoization.

import {
  STORAGE_KEY, DEFAULT_PRICES, DEFAULT_ROLLOVER_HOUR, CATEGORY_IDS, DRINK_TYPE_IDS,
  SESSION_IDLE_MS, SESSION_MAX_MS, ROUTE_MIN_STEP_M, ROUTE_MIN_INTERVAL_MS,
} from './config.js';
import {
  tabDayKey, attributeDayKey, isDayEditable, tsAt, currentDayKey, latestDroppedWeekKey, prevWeekKey,
  droppedWeekKeys, weekStartTs,
} from './time.js';
import { distanceM } from './geomath.js';
import {
  DEMO_START_FRIENDS, DEMO_INCOMING_REQUESTS, DEMO_GROUPS, DEMO_SPOTS, seedMyHistory, personById,
} from './demo.js';
import { now } from './clock.js';

// ---- ids --------------------------------------------------------------------
let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${now().toString(36)}-${(idCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---- defaults -------------------------------------------------------------

export function defaultState() {
  return {
    v: 1,
    onboarded: false,
    me: { id: 'me', name: '', handle: '', avatar: { emoji: '😎', hue: 265 }, school: 'Vanderbilt', joinedAt: now() },
    settings: {
      rolloverHour: DEFAULT_ROLLOVER_HOUR,
      locationEnabled: false,
      trackRoute: true,
      autoNameSpots: false,
      keepAwake: true,
      prices: { ...DEFAULT_PRICES },
      demoMode: true,
    },
    logs: [],
    sessions: [],
    activeSessionId: null,
    spots: [],
    friends: [],
    requests: { incoming: [], outgoing: [] },
    groups: [],
    seenDrops: {},
    dismissedSuggestions: [],
  };
}

// ---- persistence ------------------------------------------------------------

let memoryFallback = null;
function readStorage() {
  try {
    const raw = globalThis.localStorage ? localStorage.getItem(STORAGE_KEY) : memoryFallback;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeStorage(s) {
  const raw = JSON.stringify(s);
  try {
    if (globalThis.localStorage) localStorage.setItem(STORAGE_KEY, raw);
    else memoryFallback = raw;
  } catch { memoryFallback = raw; }
}

// Fill in any missing fields (forward-compatible loads).
function migrate(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d, ...s,
    me: { ...d.me, ...(s.me || {}) },
    settings: { ...d.settings, ...(s.settings || {}), prices: { ...DEFAULT_PRICES, ...((s.settings || {}).prices || {}) } },
    requests: { ...d.requests, ...(s.requests || {}) },
  };
}

// ---- store core ---------------------------------------------------------------

let state = migrate(readStorage());
const listeners = new Set();

export const getState = () => state;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// setState(patch | (state) => newState). Persists and notifies.
export function setState(update) {
  const next = typeof update === 'function' ? update(state) : { ...state, ...update };
  if (!next || next === state) return state;
  state = next;
  writeStorage(state);
  listeners.forEach(fn => fn(state));
  return state;
}

// Replace everything (import / reset / tests).
export function replaceState(s) { state = migrate(s); writeStorage(state); listeners.forEach(fn => fn(state)); }

// Test helper: reset to defaults without persistence side-effects on other tabs.
export function resetAll() { replaceState(defaultState()); }

const rollover = () => state.settings.rolloverHour;

// ---- onboarding / demo ----------------------------------------------------------

/**
 * @param {{name, handle, avatar, demo:boolean, locationEnabled:boolean}} p
 */
export function completeOnboarding({ name, handle, avatar, demo = true, locationEnabled = false }) {
  const t = now();
  setState(s => {
    let next = {
      ...s,
      onboarded: true,
      me: { ...s.me, name: name.trim(), handle: handle.trim().replace(/^@/, '').toLowerCase(), avatar: avatar || s.me.avatar, joinedAt: t },
      settings: { ...s.settings, demoMode: !!demo, locationEnabled: !!locationEnabled },
    };
    if (demo) next = withDemoData(next, t);
    return next;
  });
}

// Seed friends, groups, requests, named spots and 6 weeks of the user's history.
function withDemoData(s, t) {
  const latest = latestDroppedWeekKey(t, s.settings.rolloverHour);
  const history = seedMyHistory(latest, 6);
  const older = droppedWeekKeys(t, 6, s.settings.rolloverHour).slice(1);
  return {
    ...s,
    me: { ...s.me, joinedAt: weekStartTs(prevWeekKey(latest, 5), s.settings.rolloverHour) },
    logs: [...s.logs.filter(l => !String(l.id).startsWith('demo-')), ...history.logs].sort((a, b) => a.ts - b.ts),
    sessions: [...s.sessions.filter(x => !String(x.id).startsWith('demo-')), ...history.sessions],
    spots: mergeSpots(s.spots, DEMO_SPOTS.map(x => ({ ...x }))),
    friends: [...new Set([...s.friends, ...DEMO_START_FRIENDS])],
    requests: { incoming: DEMO_INCOMING_REQUESTS.map(id => ({ id, at: t - 3600e3 })), outgoing: [] },
    groups: DEMO_GROUPS.map(g => ({ ...g, memberIds: [...g.memberIds], createdAt: t, inviteCode: inviteCode() })),
    seenDrops: Object.fromEntries(older.map(w => [w, true])), // latest drop still to reveal
  };
}

function mergeSpots(existing, extra) {
  const ids = new Set(existing.map(x => x.id));
  return [...existing, ...extra.filter(x => !ids.has(x.id))];
}

// Remove seeded data (keeps real logs, sessions, profile, settings).
export function clearDemoData() {
  setState(s => ({
    ...s,
    logs: s.logs.filter(l => !String(l.id).startsWith('demo-')),
    sessions: s.sessions.filter(x => !String(x.id).startsWith('demo-')),
    friends: [], requests: { incoming: [], outgoing: [] }, groups: [], dismissedSuggestions: [],
    settings: { ...s.settings, demoMode: false },
  }));
}

export function loadDemoData() { setState(s => withDemoData({ ...s, settings: { ...s.settings, demoMode: true } }, now())); }

// Delete all of the user's logs & sessions (keeps profile/friends).
export function clearMyLogs() { setState(s => ({ ...s, logs: [], sessions: [], activeSessionId: null })); }

export const inviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// ---- logging -------------------------------------------------------------------

export class LockedDayError extends Error {
  constructor(dayKey) { super(`That day is locked (its drop already came out).`); this.dayKey = dayKey; }
}

function validCat(cat, sub) {
  if (!CATEGORY_IDS.includes(cat)) throw new Error(`Unknown category ${cat}`);
  if (cat === 'drinks' && !DRINK_TYPE_IDS.includes(sub)) throw new Error(`Drinks need a type`);
}

// Rough times of night for back-filled logs (hour of the tab day; 26 = 2 AM next morning).
export const BACKFILL_TIMES = [
  { id: 'early', label: 'Early', hint: '~8 PM', emoji: '🌆', hour: 20 },
  { id: 'late', label: 'Late', hint: '~11 PM', emoji: '🌙', hour: 23 },
  { id: 'after2', label: 'After 2 AM', hint: '~2 AM', emoji: '🦉', hour: 26 },
];
const backfillHour = at => (BACKFILL_TIMES.find(b => b.id === at) || BACKFILL_TIMES[1]).hour;

export const activeSession = (s = state) => (s.activeSessionId ? s.sessions.find(x => x.id === s.activeSessionId) || null : null);

/**
 * Log one item.
 * - No dayKey: "log it now" — attributed via rollover + active session.
 * - dayKey: editing a specific day from the tracker. If it's the day the
 *   active session counts toward (or today with no session), it's a live log
 *   (ts = now, joins the session). Otherwise it's a manual back-fill
 *   (no session, no location) stamped at a rough time of night: opts.at is
 *   one of BACKFILL_TIMES ('early' ≈ 8 PM, 'late' ≈ 11 PM, 'after2' ≈ 2 AM).
 * @param {string} cat
 * @param {string|null} sub   drink type for cat === 'drinks'
 * @param {{dayKey?:string, loc?:{lat,lng,acc}, at?:string}} [opts]
 * @returns {object} the new log
 */
export function addLog(cat, sub = null, opts = {}) {
  validCat(cat, sub);
  const t = now();
  const session = activeSession();
  const liveDay = attributeDayKey(t, rollover(), session);
  const dayKey = opts.dayKey || liveDay;
  if (!isDayEditable(dayKey, t, rollover())) throw new LockedDayError(dayKey);

  const live = dayKey === liveDay;
  const sameDay = state.logs.filter(l => l.dayKey === dayKey).length;
  const log = {
    id: uid('log'),
    cat, sub: cat === 'drinks' ? sub : null,
    ts: live ? t : Math.min(t, tsAt(dayKey, backfillHour(opts.at)) + sameDay * 60 * 1000),
    dayKey,
    sessionId: live && session ? session.id : null,
    loc: live && opts.loc ? { lat: opts.loc.lat, lng: opts.loc.lng, acc: opts.loc.acc ?? null } : null,
    manual: !live,
  };
  setState(s => ({ ...s, logs: [...s.logs, log] }));
  return log;
}

// Attach a location to a log after the fact (geolocation resolves async).
export function setLogLocation(logId, loc) {
  if (!loc) return;
  setState(s => ({ ...s, logs: s.logs.map(l => (l.id === logId ? { ...l, loc: { lat: loc.lat, lng: loc.lng, acc: loc.acc ?? null } } : l)) }));
}

/**
 * Remove the most recent matching log for a day ("minus" on the tracker).
 * @returns {object|null} the removed log
 */
export function removeLog(cat, sub, dayKey) {
  const t = now();
  if (!isDayEditable(dayKey, t, rollover())) throw new LockedDayError(dayKey);
  const matches = state.logs.filter(l => l.dayKey === dayKey && l.cat === cat && (cat !== 'drinks' || l.sub === sub));
  if (!matches.length) return null;
  const victim = matches.reduce((a, b) => (b.ts >= a.ts ? b : a));
  setState(s => ({ ...s, logs: s.logs.filter(l => l.id !== victim.id) }));
  return victim;
}

// Set a day's count for one category/sub-type to exactly n.
// `at` = rough time for back-filled logs (see BACKFILL_TIMES).
export function setCount(dayKey, cat, sub, n, at) {
  const target = Math.max(0, Math.floor(n));
  const count = () => state.logs.filter(l => l.dayKey === dayKey && l.cat === cat && (cat !== 'drinks' || l.sub === sub)).length;
  let guard = 500;
  while (count() < target && guard--) addLog(cat, sub, { dayKey, at });
  while (count() > target && guard--) removeLog(cat, sub, dayKey);
}

export function deleteLog(logId) {
  const log = state.logs.find(l => l.id === logId);
  if (!log) return;
  if (!isDayEditable(log.dayKey, now(), rollover())) throw new LockedDayError(log.dayKey);
  setState(s => ({ ...s, logs: s.logs.filter(l => l.id !== logId) }));
}

// Restore a removed log (undo).
export function restoreLog(log) {
  if (!log || state.logs.some(l => l.id === log.id)) return;
  if (!isDayEditable(log.dayKey, now(), rollover())) throw new LockedDayError(log.dayKey);
  setState(s => ({ ...s, logs: [...s.logs, log].sort((a, b) => a.ts - b.ts) }));
}

// ---- sessions ---------------------------------------------------------------------

/** Start a night-out session. @returns session */
export function startSession({ loc = null, name = null } = {}) {
  const existing = activeSession();
  if (existing) return existing;
  const t = now();
  const session = {
    id: uid('ses'), start: t, end: null,
    dayKey: tabDayKey(t, rollover()),
    name,
    route: loc ? [{ lat: loc.lat, lng: loc.lng, ts: t }] : [],
  };
  setState(s => ({ ...s, sessions: [...s.sessions, session], activeSessionId: session.id }));
  return session;
}

/** Add a GPS point to a session's route (ignores jitter / too-frequent points). @returns boolean added */
export function appendRoutePoint(sessionId, pt) {
  const ses = state.sessions.find(x => x.id === sessionId);
  if (!ses || ses.end || !pt) return false;
  const last = ses.route[ses.route.length - 1];
  const ts = pt.ts || now();
  if (last && (distanceM(last, pt) < ROUTE_MIN_STEP_M || ts - last.ts < ROUTE_MIN_INTERVAL_MS)) return false;
  const point = { lat: pt.lat, lng: pt.lng, ts };
  setState(s => ({ ...s, sessions: s.sessions.map(x => (x.id === sessionId ? { ...x, route: [...x.route, point] } : x)) }));
  return true;
}

// Last time something was logged in the session (or its start).
export function sessionLastActivity(ses, s = state) {
  let t = ses.start;
  for (const l of s.logs) if (l.sessionId === ses.id && l.ts > t) t = l.ts;
  return t;
}

/** End a session. @returns the ended session */
export function endSession(sessionId = state.activeSessionId, endTs = null) {
  const ses = state.sessions.find(x => x.id === sessionId);
  if (!ses) return null;
  const end = endTs ?? now();
  setState(s => ({
    ...s,
    sessions: s.sessions.map(x => (x.id === sessionId ? { ...x, end: x.end || end } : x)),
    activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
  }));
  return state.sessions.find(x => x.id === sessionId);
}

/**
 * Auto-end the active session if it's gone idle (SESSION_IDLE_MS since last
 * log) or run too long (SESSION_MAX_MS). Call on app start and on a timer.
 * @returns the auto-ended session, or null
 */
export function checkSessionTimeout() {
  const ses = activeSession();
  if (!ses) return null;
  const t = now();
  const last = sessionLastActivity(ses);
  if (t - last > SESSION_IDLE_MS || t - ses.start > SESSION_MAX_MS) {
    return endSession(ses.id, Math.min(t, Math.max(last + 30 * 60 * 1000, ses.start + 60 * 1000)));
  }
  return null;
}

/**
 * Pull recent live logs (same tab day, not in any session, logged since
 * `sinceTs`) into a session — used when you start one right after logging.
 * @returns {number} how many logs were adopted
 */
export function adoptLogsIntoSession(sessionId, sinceTs) {
  const ses = state.sessions.find(x => x.id === sessionId);
  if (!ses) return 0;
  const ids = new Set(state.logs.filter(l => !l.sessionId && !l.manual && l.dayKey === ses.dayKey && l.ts >= sinceTs).map(l => l.id));
  if (!ids.size) return 0;
  setState(s => ({ ...s, logs: s.logs.map(l => (ids.has(l.id) ? { ...l, sessionId } : l)) }));
  return ids.size;
}

export function renameSession(sessionId, name) {
  setState(s => ({ ...s, sessions: s.sessions.map(x => (x.id === sessionId ? { ...x, name: (name || '').trim() || null } : x)) }));
}

// Delete a session and every log in it (only if its day is still editable).
export function discardSession(sessionId) {
  const ses = state.sessions.find(x => x.id === sessionId);
  if (!ses) return;
  if (!isDayEditable(ses.dayKey, now(), rollover())) throw new LockedDayError(ses.dayKey);
  setState(s => ({
    ...s,
    sessions: s.sessions.filter(x => x.id !== sessionId),
    logs: s.logs.filter(l => l.sessionId !== sessionId),
    activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
  }));
}

// ---- spots --------------------------------------------------------------------------

export function upsertSpot({ id, name, lat, lng }) {
  const spot = { id: id || uid('spot'), name: name.trim(), lat, lng };
  setState(s => ({ ...s, spots: s.spots.some(x => x.id === spot.id) ? s.spots.map(x => (x.id === spot.id ? spot : x)) : [...s.spots, spot] }));
  return spot;
}
export function deleteSpot(id) { setState(s => ({ ...s, spots: s.spots.filter(x => x.id !== id) })); }

// ---- profile & settings --------------------------------------------------------------

export function updateProfile(patch) { setState(s => ({ ...s, me: { ...s.me, ...patch } })); }
export function updateSettings(patch) { setState(s => ({ ...s, settings: { ...s.settings, ...patch } })); }
export function updatePrices(patch) { setState(s => ({ ...s, settings: { ...s.settings, prices: { ...s.settings.prices, ...patch } } })); }

// ---- friends ---------------------------------------------------------------------------

export function sendFriendRequest(userId) {
  if (state.friends.includes(userId) || state.requests.outgoing.some(r => r.id === userId)) return;
  // If they already requested you, sending back = accept.
  if (state.requests.incoming.some(r => r.id === userId)) return acceptFriendRequest(userId);
  setState(s => ({ ...s, requests: { ...s.requests, outgoing: [...s.requests.outgoing, { id: userId, at: now() }] } }));
}
export function cancelFriendRequest(userId) {
  setState(s => ({ ...s, requests: { ...s.requests, outgoing: s.requests.outgoing.filter(r => r.id !== userId) } }));
}
export function acceptFriendRequest(userId) {
  setState(s => ({
    ...s,
    friends: s.friends.includes(userId) ? s.friends : [...s.friends, userId],
    requests: { incoming: s.requests.incoming.filter(r => r.id !== userId), outgoing: s.requests.outgoing.filter(r => r.id !== userId) },
  }));
}
export function declineFriendRequest(userId) {
  setState(s => ({ ...s, requests: { ...s.requests, incoming: s.requests.incoming.filter(r => r.id !== userId) } }));
}
export function removeFriend(userId) {
  setState(s => ({
    ...s,
    friends: s.friends.filter(f => f !== userId),
    groups: s.groups.map(g => ({ ...g, memberIds: g.memberIds.filter(m => m !== userId) })),
  }));
}
export function dismissSuggestion(userId) {
  setState(s => ({ ...s, dismissedSuggestions: [...new Set([...s.dismissedSuggestions, userId])] }));
}

/**
 * Demo only: outgoing requests older than `afterMs` get accepted.
 * @returns {string[]} ids that were accepted
 */
export function resolveDemoRequests(afterMs = 6000) {
  if (!state.settings.demoMode) return [];
  const t = now();
  const ready = state.requests.outgoing.filter(r => t - r.at >= afterMs && personById(r.id)).map(r => r.id);
  ready.forEach(acceptFriendRequest);
  return ready;
}

// ---- groups -----------------------------------------------------------------------------

export function createGroup({ name, emoji = '🍻', memberIds = [] }) {
  const g = { id: uid('grp'), name: name.trim(), emoji, memberIds: ['me', ...memberIds.filter(m => m !== 'me')], createdAt: now(), inviteCode: inviteCode() };
  setState(s => ({ ...s, groups: [...s.groups, g] }));
  return g;
}
export function updateGroup(groupId, patch) {
  setState(s => ({ ...s, groups: s.groups.map(g => (g.id === groupId ? { ...g, ...patch, memberIds: patch.memberIds ? ['me', ...patch.memberIds.filter(m => m !== 'me')] : g.memberIds } : g)) }));
}
export function leaveGroup(groupId) { setState(s => ({ ...s, groups: s.groups.filter(g => g.id !== groupId) })); }

// ---- drops ---------------------------------------------------------------------------------

export function markDropSeen(weekKey) { setState(s => ({ ...s, seenDrops: { ...s.seenDrops, [weekKey]: true } })); }

// ---- import / export ---------------------------------------------------------------------------

export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.v !== 1) throw new Error('Not a Tab backup file');
  replaceState(parsed);
}

// Convenience for the tracker.
export const todayKey = () => currentDayKey(now(), rollover());
