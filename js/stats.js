// Weekly statistics, Tab Score, awards, trends, leaderboards.
// Pure module: no DOM, safe for tests.
//
// Log shape (see store.js):
//   { id, cat, sub, ts, dayKey, sessionId, loc: {lat,lng,acc}|null, manual }
// Session shape:
//   { id, start, end, dayKey, name, route: [{lat,lng,ts}] }

import {
  CATEGORY_IDS, DRINK_TYPE_IDS, STD_DRINKS, DEFAULT_PRICES, SCORE_WEIGHTS, CATEGORY_BY_ID,
} from './config.js';
import { weekDays, tsAt, weekdayLong } from './time.js';
import { clusterPins, routeLengthM } from './geomath.js';

export const emptyTotals = () => Object.fromEntries(CATEGORY_IDS.map(c => [c, 0]));
export const emptyDrinkTypes = () => Object.fromEntries(DRINK_TYPE_IDS.map(d => [d, 0]));

const round1 = n => Math.round(n * 10) / 10;

export function sumTotals(totals) {
  return CATEGORY_IDS.reduce((s, c) => s + (totals[c] || 0), 0);
}

export function tabScore(totals) {
  return round1(CATEGORY_IDS.reduce((s, c) => s + (totals[c] || 0) * SCORE_WEIGHTS[c], 0));
}

export function stdDrinksOf(drinkTypes, shots) {
  let s = (shots || 0) * STD_DRINKS.shot;
  for (const d of DRINK_TYPE_IDS) s += (drinkTypes[d] || 0) * STD_DRINKS[d];
  return round1(s);
}

export function spendOf(totals, drinkTypes, prices = DEFAULT_PRICES) {
  const p = { ...DEFAULT_PRICES, ...(prices || {}) };
  let s = 0;
  for (const d of DRINK_TYPE_IDS) s += (drinkTypes[d] || 0) * p[d];
  for (const c of CATEGORY_IDS) if (c !== 'drinks') s += (totals[c] || 0) * p[c];
  return Math.round(s);
}

// Totals for an arbitrary list of logs.
export function totalsOf(logs) {
  const totals = emptyTotals(), drinkTypes = emptyDrinkTypes();
  for (const l of logs || []) {
    if (!(l.cat in totals)) continue;
    totals[l.cat] += 1;
    if (l.cat === 'drinks') drinkTypes[l.sub in drinkTypes ? l.sub : 'other'] += 1;
  }
  return { totals, drinkTypes, total: sumTotals(totals), score: tabScore(totals) };
}

// Minutes after the tab day started (rollover). Larger = later in the night.
function lateness(log, rolloverHour) {
  return (log.ts - tsAt(log.dayKey, rolloverHour)) / 60000;
}

/**
 * Compute a week's stats from raw logs.
 * @param {object} p
 * @param {string} p.weekKey
 * @param {Array}  p.logs         all logs (any week; filtered here by dayKey)
 * @param {Array} [p.sessions]    all sessions (filtered by dayKey)
 * @param {object}[p.prices]
 * @param {Array} [p.knownSpots]  [{id,name,lat,lng}] for naming clusters
 * @param {number}[p.rolloverHour]
 */
export function computeWeekStats({ weekKey, logs, sessions = [], prices, knownSpots = [], rolloverHour = 6 }) {
  const days = weekDays(weekKey);
  const daySet = new Set(days);
  const weekLogs = (logs || []).filter(l => daySet.has(l.dayKey));
  const { totals, drinkTypes, total, score } = totalsOf(weekLogs);

  const byDay = days.map(dayKey => {
    const t = totalsOf(weekLogs.filter(l => l.dayKey === dayKey));
    return { dayKey, totals: t.totals, drinkTypes: t.drinkTypes, total: t.total, score: t.score };
  });

  let busiestDay = null;
  for (const d of byDay) if (d.total > 0 && (!busiestDay || d.score > busiestDay.score)) busiestDay = d;

  const pins = weekLogs.filter(l => l.loc && typeof l.loc.lat === 'number')
    .map(l => ({ lat: l.loc.lat, lng: l.loc.lng, ts: l.ts, cat: l.cat, sub: l.sub || null, sessionId: l.sessionId || null }));
  const spots = clusterPins(pins, knownSpots);

  const weekSessions = (sessions || [])
    .filter(s => daySet.has(s.dayKey))
    .map(s => {
      const sl = weekLogs.filter(l => l.sessionId === s.id);
      const t = totalsOf(sl);
      return {
        id: s.id, name: s.name || null, dayKey: s.dayKey, start: s.start, end: s.end,
        durationMs: (s.end || s.start) - s.start,
        distanceM: routeLengthM(s.route),
        pinCount: sl.filter(l => l.loc).length,
        totals: t.totals, total: t.total, score: t.score,
      };
    })
    .sort((a, b) => a.start - b.start);

  let latestLog = null;
  for (const l of weekLogs) if (!latestLog || lateness(l, rolloverHour) > lateness(latestLog, rolloverHour)) latestLog = l;

  return {
    weekKey,
    totals, drinkTypes, total, score,
    stdDrinks: stdDrinksOf(drinkTypes, totals.shots),
    spend: spendOf(totals, drinkTypes, prices),
    byDay,
    activeDays: byDay.filter(d => d.total > 0).length,
    busiestDay: busiestDay ? { dayKey: busiestDay.dayKey, total: busiestDay.total, score: busiestDay.score, totals: busiestDay.totals } : null,
    latestLog: latestLog ? { ts: latestLog.ts, dayKey: latestLog.dayKey, cat: latestLog.cat } : null,
    sessions: weekSessions,
    spots,
    pins,
    logCount: weekLogs.length,
  };
}

// ---- trends ---------------------------------------------------------------

/**
 * Compare a week to the previous week and to the average of up to 4 prior weeks.
 * @param {object} current  WeekStats
 * @param {Array}  prior    WeekStats[] newest first (index 0 = previous week); nulls allowed
 * @returns {{ byCat: {[cat]: {value, prev, delta, avg, vsAvgPct}}, score: {...}, total: {...} }}
 */
export function computeTrends(current, prior) {
  const prev = (prior || [])[0] || null;
  const window = (prior || []).slice(0, 4).filter(Boolean);
  const avgOf = get => (window.length ? round1(window.reduce((s, w) => s + get(w), 0) / window.length) : null);
  const row = get => {
    const value = get(current);
    const p = prev ? get(prev) : null;
    const avg = avgOf(get);
    return {
      value,
      prev: p,
      delta: p === null ? null : round1(value - p),
      avg,
      vsAvgPct: avg ? Math.round(((value - avg) / avg) * 100) : null,
    };
  };
  const byCat = Object.fromEntries(CATEGORY_IDS.map(c => [c, row(w => w.totals[c])]));
  return { byCat, score: row(w => w.score), total: row(w => w.total), stdDrinks: row(w => w.stdDrinks), spend: row(w => w.spend) };
}

// ---- leaderboards ---------------------------------------------------------

/**
 * @param {Array<{userId, stats}>} members  stats may be null (excluded)
 * @param {string} metric  a category id, or 'score' | 'total' | 'stdDrinks' | 'spend'
 * @returns {Array<{userId, value, rank}>} desc, dense-ranked (ties share a rank)
 */
export function leaderboard(members, metric = 'score') {
  const get = s => (CATEGORY_IDS.includes(metric) ? s.totals[metric] : s[metric]) || 0;
  const rows = members.filter(m => m && m.stats).map(m => ({ userId: m.userId, value: get(m.stats) }))
    .sort((a, b) => b.value - a.value || String(a.userId).localeCompare(String(b.userId)));
  let rank = 0, last = null;
  rows.forEach((r, i) => { if (r.value !== last) { rank = i + 1; last = r.value; } r.rank = rank; });
  return rows;
}

// ---- awards ---------------------------------------------------------------

// Each award: { id, emoji, title, blurb, metric(stats) -> number, mode: 'max'|'min', label(value) }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pts = v => plural(v, 'pt', 'pts');
const catLabel = c => v => plural(v, CATEGORY_BY_ID[c].unit, CATEGORY_BY_ID[c].unitPlural);

export const AWARDS = [
  { id: 'mvp', emoji: '👑', title: 'Tab MVP', blurb: 'Highest Tab Score of the week', metric: s => s.score, mode: 'max', label: pts },
  { id: 'tap-drainer', emoji: '🍻', title: 'Tap Drainer', blurb: 'Most drinks', metric: s => s.totals.drinks, mode: 'max', label: catLabel('drinks') },
  { id: 'shot-caller', emoji: '🎯', title: 'Shot Caller', blurb: 'Most shots', metric: s => s.totals.shots, mode: 'max', label: catLabel('shots') },
  { id: 'chimney', emoji: '🏭', title: 'The Chimney', blurb: 'Most cigarettes', metric: s => s.totals.cigs, mode: 'max', label: catLabel('cigs') },
  { id: 'joint-venture', emoji: '🌿', title: 'Joint Venture', blurb: 'Most joints', metric: s => s.totals.joints, mode: 'max', label: catLabel('joints') },
  { id: 'baked-goods', emoji: '🧁', title: 'Baked Goods', blurb: 'Most edibles', metric: s => s.totals.edibles, mode: 'max', label: catLabel('edibles') },
  { id: 'cloud-chaser', emoji: '☁️', title: 'Cloud Chaser', blurb: 'Most bong hits', metric: s => s.totals.bong, mode: 'max', label: catLabel('bong') },
  { id: 'wine-mom', emoji: '🍷', title: 'Wine Mom', blurb: 'Most glasses of wine', metric: s => s.drinkTypes.wine, mode: 'max', label: v => plural(v, 'glass', 'glasses') },
  { id: 'seltzer-szn', emoji: '🫧', title: 'Seltzer SZN', blurb: 'Most seltzers', metric: s => s.drinkTypes.seltzer, mode: 'max', label: v => plural(v, 'seltzer', 'seltzers') },
  { id: 'big-night', emoji: '💥', title: 'One Night Wonder', blurb: 'Biggest single night', metric: s => (s.busiestDay ? s.busiestDay.score : 0), mode: 'max',
    label: v => `${pts(v)} in one night` },
  { id: 'night-owl', emoji: '🦉', title: 'Night Owl', blurb: 'Latest log of the week', metric: s => (s.latestLog ? (s.latestLog.ts - tsAt(s.latestLog.dayKey, 0)) / 60000 : 0), mode: 'max',
    label: v => { const mins = Math.round(v) % 1440; const h = Math.floor(mins / 60), m = mins % 60; const h12 = h % 12 === 0 ? 12 : h % 12; return `Last log ${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; } },
  { id: 'every-day', emoji: '📅', title: 'Daily Grind', blurb: 'Most active days', metric: s => s.activeDays, mode: 'max', label: v => plural(v, 'day', 'days') },
  { id: 'road-warrior', emoji: '🗺️', title: 'Road Warrior', blurb: 'Most spots hit', metric: s => s.spots.length, mode: 'max', label: v => plural(v, 'spot', 'spots') },
  { id: 'choir-boy', emoji: '😇', title: 'Choir Boy', blurb: 'Lowest Tab Score', metric: s => s.score, mode: 'min', label: pts },
];

/**
 * Hand out awards across a group for one week.
 * An award is only given if at least 2 members have stats, and for 'max'
 * awards only when the top value is > 0. Ties share the award.
 * @param {Array<{userId, stats}>} members
 * @returns {Array<{id, emoji, title, blurb, winnerIds, value, valueLabel}>}
 */
export function computeAwards(members) {
  const ms = members.filter(m => m && m.stats);
  if (ms.length < 2) return [];
  const out = [];
  for (const a of AWARDS) {
    const vals = ms.map(m => ({ userId: m.userId, v: a.metric(m.stats) }));
    const target = a.mode === 'max' ? Math.max(...vals.map(x => x.v)) : Math.min(...vals.map(x => x.v));
    if (a.mode === 'max' && !(target > 0)) continue;
    const winners = vals.filter(x => x.v === target).map(x => x.userId);
    if (a.mode === 'min' && winners.length === ms.length) continue; // everyone tied: meaningless
    if (a.id === 'night-owl' && ms.every(m => !m.stats.latestLog)) continue;
    out.push({ id: a.id, emoji: a.emoji, title: a.title, blurb: a.blurb, winnerIds: winners, value: target, valueLabel: a.label(round1(target)) });
  }
  return out;
}

// Awards a single user won within a group for a week.
export function awardsFor(userId, awards) {
  return (awards || []).filter(a => a.winnerIds.includes(userId));
}

// ---- small helpers for copy -----------------------------------------------

export function busiestNightLabel(stats) {
  return stats && stats.busiestDay ? `${weekdayLong(stats.busiestDay.dayKey)} night` : null;
}

// Categories with a non-zero total, highest first.
export function topCategories(stats) {
  return CATEGORY_IDS.filter(c => stats.totals[c] > 0).sort((a, b) => stats.totals[b] - stats.totals[a]);
}
