// Read-only queries over the store + demo world. Pages should get all
// people/stats data through here (this is the seam where a real backend
// plugs in later).
//
// PRIVACY CONTRACT (enforced here, not in pages):
// - weekStats() returns null for any week that hasn't dropped yet, for
//   everyone including 'me' (pass {allowUndropped:true} only for the user's
//   own per-session recap — never for friends).
// - Other users' stats never include exact coordinates: pins = [], spots =
//   [{name,count}], plus `areas` = [{name,count,lat,lng,radiusM}] snapped to a
//   ~400 m grid for the blurred "rough map" (never a pin or a route).
// Pure module (no DOM) — safe for tests.

import { CATEGORY_IDS } from './config.js';
import {
  isDropped, latestDroppedWeekKey, prevWeekKey, weekKeyOf, tabDayKey, currentWeekKey,
} from './time.js';
import { computeWeekStats, computeTrends, computeAwards, leaderboard, totalsOf } from './stats.js';
import { nearestSpot } from './geomath.js';
import { PEOPLE, personById, demoWeek, DEMO_SPOTS, DEMO_SPOT_BY_ID, MY_DEMO } from './demo.js';
import { getState } from './store.js';
import { now } from './clock.js';

const MAX_HISTORY_WEEKS = 26;

// ---- people -----------------------------------------------------------------------

/** @returns {{id,name,handle,avatar:{emoji,hue},school,year?,isMe:boolean, ...}|null} */
export function getUser(id) {
  if (id === 'me') {
    const me = getState().me;
    return { ...me, id: 'me', name: me.name || 'You', handle: me.handle || 'you', isMe: true, year: null };
  }
  const p = personById(id);
  return p ? { ...p, isMe: false } : null;
}

export const firstName = id => (id === 'me' ? 'You' : (getUser(id)?.name || '?').split(' ')[0]);
export const displayName = id => (id === 'me' ? 'You' : getUser(id)?.name || 'Unknown');

export const friendIds = () => getState().friends.filter(id => personById(id));
export const listFriends = () => friendIds().map(getUser).sort((a, b) => a.name.localeCompare(b.name));
export const isFriend = id => getState().friends.includes(id);

/** 'friend' | 'outgoing' | 'incoming' | 'none' | 'me' */
export function relationTo(id) {
  if (id === 'me') return 'me';
  const s = getState();
  if (s.friends.includes(id)) return 'friend';
  if (s.requests.outgoing.some(r => r.id === id)) return 'outgoing';
  if (s.requests.incoming.some(r => r.id === id)) return 'incoming';
  return 'none';
}

export const incomingRequests = () => getState().requests.incoming.map(r => ({ ...r, user: getUser(r.id) })).filter(r => r.user);
export const outgoingRequests = () => getState().requests.outgoing.map(r => ({ ...r, user: getUser(r.id) })).filter(r => r.user);

// Mutual friends between the user and someone else.
export function mutualFriendIds(id) {
  const p = personById(id);
  if (!p) return [];
  const mine = new Set(friendIds());
  return p.friendIds.filter(f => mine.has(f));
}

/** Search the directory by name or handle. */
export function searchPeople(query) {
  const q = (query || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  return PEOPLE.filter(p => p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q)).map(p => getUser(p.id));
}

// ---- places --------------------------------------------------------------------------

/** DEMO_SPOTS ids the user has logged near (last 8 weeks), else the demo persona's hangouts. */
export function mySpotIds() {
  const s = getState();
  const since = now() - 8 * 7 * 24 * 3600e3;
  const ids = new Set();
  for (const l of s.logs) {
    if (!l.loc || l.ts < since) continue;
    const near = nearestSpot(l.loc, DEMO_SPOTS, 250);
    if (near) ids.add(near.id);
  }
  if (!ids.size && s.settings.demoMode) MY_DEMO.hangouts.forEach(h => ids.add(h));
  return [...ids];
}

export const spotName = spotId => DEMO_SPOT_BY_ID[spotId]?.name || spotId;

// ---- suggestions -------------------------------------------------------------------------

/**
 * People you may know: mutual friends and shared hangouts.
 * @returns {Array<{user, mutualIds:string[], sharedSpotIds:string[], score:number, reasons:string[]}>}
 */
export function suggestions() {
  const s = getState();
  const excluded = new Set([...s.friends, ...s.dismissedSuggestions, ...s.requests.outgoing.map(r => r.id), ...s.requests.incoming.map(r => r.id)]);
  const mySpots = new Set(mySpotIds());
  return PEOPLE.filter(p => !excluded.has(p.id))
    .map(p => {
      const mutualIds = mutualFriendIds(p.id);
      const sharedSpotIds = p.hangouts.filter(h => mySpots.has(h));
      const score = mutualIds.length * 3 + sharedSpotIds.length * 2;
      const reasons = [];
      if (mutualIds.length) reasons.push(`${mutualIds.length} mutual friend${mutualIds.length === 1 ? '' : 's'}`);
      if (sharedSpotIds.length) reasons.push(`Also goes to ${sharedSpotIds.slice(0, 2).map(spotName).join(' & ')}`);
      return { user: getUser(p.id), mutualIds, sharedSpotIds, score, reasons };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name));
}

// ---- weeks ----------------------------------------------------------------------------------

/** Earliest weekKey a user has data for. */
export function joinedWeekKey(userId) {
  const s = getState();
  const rollover = s.settings.rolloverHour;
  if (userId === 'me') {
    let first = s.me.joinedAt;
    for (const l of s.logs) if (l.ts < first) first = l.ts;
    return weekKeyOf(tabDayKey(first, rollover));
  }
  const p = personById(userId);
  if (!p) return null;
  return prevWeekKey(latestDroppedWeekKey(now(), rollover), Math.max(0, p.joinedWeeksAgo - 1));
}

/** Dropped weekKeys a user has, newest first. */
export function droppedWeeks(userId, max = MAX_HISTORY_WEEKS) {
  const first = joinedWeekKey(userId);
  if (!first) return [];
  const out = [];
  for (let w = latestDroppedWeekKey(now(), getState().settings.rolloverHour); w >= first && out.length < max; w = prevWeekKey(w)) out.push(w);
  return out;
}

export const latestDropWeek = () => latestDroppedWeekKey(now(), getState().settings.rolloverHour);
export const thisWeek = () => currentWeekKey(now(), getState().settings.rolloverHour);

// Memo for the user's own stats, invalidated when inputs change by reference.
let myCache = new Map(), myCacheRefs = [];
function myWeekStatsRaw(weekKey) {
  const s = getState();
  const refs = [s.logs, s.sessions, s.settings.prices, s.spots, s.settings.rolloverHour];
  if (refs.some((r, i) => r !== myCacheRefs[i])) { myCache = new Map(); myCacheRefs = refs; }
  if (!myCache.has(weekKey)) {
    myCache.set(weekKey, computeWeekStats({
      weekKey, logs: s.logs, sessions: s.sessions, prices: s.settings.prices, knownSpots: s.spots, rolloverHour: s.settings.rolloverHour,
    }));
  }
  return myCache.get(weekKey);
}

const otherCache = new Map();

// Snap to a ~400 m grid so a friend's map shows the neighborhood, not the door.
const AREA_GRID_DEG = 0.004;
const AREA_RADIUS_M = 450;
const snap = v => Math.round(v / AREA_GRID_DEG) * AREA_GRID_DEG;
function roughAreas(spots) {
  const byCell = new Map();
  for (const sp of spots || []) {
    if (typeof sp.lat !== 'number') continue;
    const lat = snap(sp.lat), lng = snap(sp.lng), k = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cell = byCell.get(k) || { name: sp.name, count: 0, lat, lng, radiusM: AREA_RADIUS_M };
    cell.count += sp.count;
    byCell.set(k, cell);
  }
  return [...byCell.values()].sort((a, b) => b.count - a.count);
}
function otherWeekStatsRaw(userId, weekKey) {
  const key = `${userId}|${weekKey}`;
  if (!otherCache.has(key)) {
    const { logs, sessions } = demoWeek(userId, weekKey);
    const st = computeWeekStats({ weekKey, logs, sessions, knownSpots: DEMO_SPOTS, rolloverHour: 6 });
    // Strip exact coordinates — friends see spot names and a rough area only.
    otherCache.set(key, {
      ...st,
      pins: [],
      spots: st.spots.map(x => ({ name: x.name, count: x.count })),
      areas: roughAreas(st.spots),
    });
  }
  return otherCache.get(key);
}

/**
 * A user's stats for a week, or null if not dropped / before they joined.
 * @param {string} userId  'me' or a person id
 * @param {string} weekKey
 * @param {{allowUndropped?:boolean}} [opts]  only valid for 'me'
 */
export function weekStats(userId, weekKey, opts = {}) {
  if (!weekKey) return null;
  const dropped = isDropped(weekKey, now());
  if (!dropped && !(opts.allowUndropped && userId === 'me')) return null;
  const first = joinedWeekKey(userId);
  if (!first || weekKey < first) return null;
  if (userId === 'me') return myWeekStatsRaw(weekKey);
  if (!personById(userId)) return null;
  return otherWeekStatsRaw(userId, weekKey);
}

/** Current week + up to 4 prior weeks → trends. null if the week isn't available. */
export function trendsFor(userId, weekKey) {
  const cur = weekStats(userId, weekKey);
  if (!cur) return null;
  const prior = [1, 2, 3, 4].map(i => weekStats(userId, prevWeekKey(weekKey, i)));
  return computeTrends(cur, prior);
}

/** [{userId, stats}] for several users (stats may be null). */
export const membersStats = (userIds, weekKey) => userIds.map(userId => ({ userId, stats: weekStats(userId, weekKey) }));

/** The user + all friends for a week. */
export const circleIds = () => ['me', ...friendIds()];

/**
 * Everything needed to render a comparison board for a set of users.
 * @returns {{ members, awards, boards: {[metric]: [{userId,value,rank}]} }}
 */
export function compareWeek(userIds, weekKey) {
  const members = membersStats(userIds, weekKey);
  const metrics = ['score', ...CATEGORY_IDS, 'stdDrinks', 'spend'];
  const boards = Object.fromEntries(metrics.map(m => [m, leaderboard(members, m)]));
  return { members, awards: computeAwards(members), boards };
}

/** Rank of a user on a board, e.g. {rank:2, of:9}. */
export function rankOn(board, userId) {
  const row = board.find(r => r.userId === userId);
  return row ? { rank: row.rank, of: board.length, value: row.value } : null;
}

// ---- groups ------------------------------------------------------------------------------------

export const listGroups = () => getState().groups;
export const groupById = id => getState().groups.find(g => g.id === id) || null;
export const groupsWith = userId => getState().groups.filter(g => g.memberIds.includes(userId));
/** Members as users (drops unknown ids). */
export const groupMembers = g => g.memberIds.map(getUser).filter(Boolean);
export const groupWeek = (groupId, weekKey) => {
  const g = groupById(groupId);
  return g ? compareWeek(g.memberIds.filter(id => id === 'me' || personById(id)), weekKey) : null;
};

// ---- the user's own logs --------------------------------------------------------------------------

export const logsForDay = dayKey => getState().logs.filter(l => l.dayKey === dayKey);
/** {totals, drinkTypes, total, score} for one day of the user's own logs. */
export const dayTotals = dayKey => totalsOf(logsForDay(dayKey));

export const sessionById = id => getState().sessions.find(x => x.id === id) || null;
export const sessionLogs = id => getState().logs.filter(l => l.sessionId === id).sort((a, b) => a.ts - b.ts);
export const activeSession = () => {
  const s = getState();
  return s.activeSessionId ? s.sessions.find(x => x.id === s.activeSessionId) || null : null;
};
/** The user's finished sessions, newest first. */
export const mySessions = () => getState().sessions.filter(x => x.end).sort((a, b) => b.start - a.start);

/** Has the user got an unseen dropped week (story not yet watched)? */
export function unseenDrop() {
  const w = latestDropWeek();
  const s = getState();
  return s.seenDrops[w] || !weekStats('me', w) ? null : w;
}
