// Demo world: people, friend graph, groups, spots, and a deterministic
// generator for everyone's weekly activity. This stands in for a backend in
// v1 — swap data.js's calls to this module for API calls later.
// Pure module: no DOM, safe for tests.

import { HOME_AREA } from './config.js';
import { weekDays, tsAt, prevWeekKey } from './time.js';

// ---- seeded randomness ----------------------------------------------------

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seedStr) {
  let a = hashStr(seedStr) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Poisson sample (Knuth) — fine for small means.
function poisson(r, mean) {
  if (mean <= 0) return 0;
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L && k < 60);
  return k - 1;
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---- places (Nashville / Vanderbilt) --------------------------------------

export const DEMO_SPOTS = [
  { id: 'greek-row',   name: 'Greek Row',         lat: 36.1433, lng: -86.8047 },
  { id: 'kissam',      name: 'Kissam',            lat: 36.1467, lng: -86.8030 },
  { id: 'commons',     name: 'Commons Lawn',      lat: 36.1422, lng: -86.7977 },
  { id: 'west-end',    name: 'West End Apts',     lat: 36.1446, lng: -86.8126 },
  { id: 'midtown',     name: 'Midtown',           lat: 36.1512, lng: -86.7966 },
  { id: 'music-row',   name: 'Music Row',         lat: 36.1486, lng: -86.7924 },
  { id: 'hillsboro',   name: 'Hillsboro Village', lat: 36.1349, lng: -86.8004 },
  { id: 'centennial',  name: 'Centennial Park',   lat: 36.1492, lng: -86.8129 },
  { id: 'gulch',       name: 'The Gulch',         lat: 36.1524, lng: -86.7845 },
  { id: 'broadway',    name: 'Broadway',          lat: 36.1610, lng: -86.7771 },
  { id: '12-south',    name: '12 South',          lat: 36.1247, lng: -86.7897 },
  { id: 'east-nash',   name: 'East Nashville',    lat: 36.1758, lng: -86.7519 },
];
export const DEMO_SPOT_BY_ID = Object.fromEntries(DEMO_SPOTS.map(s => [s.id, s]));
export { HOME_AREA };

// ---- personas: mean units per "active night" and outing behaviour ---------

// rates: mean count per night out, per category / drink type.
// day: mean count on a non-going-out day (e.g. an afternoon bong rip).
const PERSONAS = {
  frat:       { out: 0.62, rates: { beer: 5, seltzer: 1, mixed: 1, wine: 0, other: 0.3, shots: 2.5, cigs: 1.5, joints: 0.3, edibles: 0,   bong: 0.5 }, day: { beer: 0.6 } },
  stoner:     { out: 0.35, rates: { beer: 1.5, seltzer: 0.3, mixed: 0.3, wine: 0, other: 0, shots: 0.4, cigs: 0.5, joints: 1.6, edibles: 0.4, bong: 3 },   day: { bong: 2.5, joints: 0.4, edibles: 0.15 } },
  smoker:     { out: 0.5,  rates: { beer: 2.5, seltzer: 0.5, mixed: 1.5, wine: 0.3, other: 0, shots: 1.2, cigs: 5, joints: 0.3, edibles: 0,   bong: 0 },     day: { cigs: 2.5 } },
  wine:       { out: 0.45, rates: { beer: 0.3, seltzer: 2, mixed: 1, wine: 2.5, other: 0, shots: 0.8, cigs: 0.1, joints: 0.2, edibles: 0.2, bong: 0 },     day: { wine: 0.3 } },
  light:      { out: 0.3,  rates: { beer: 1.2, seltzer: 1, mixed: 0.4, wine: 0.3, other: 0, shots: 0.3, cigs: 0, joints: 0.1, edibles: 0.05, bong: 0.1 }, day: {} },
  balanced:   { out: 0.45, rates: { beer: 2.5, seltzer: 1.2, mixed: 1, wine: 0.4, other: 0.2, shots: 1.2, cigs: 0.6, joints: 0.6, edibles: 0.2, bong: 1 },  day: { bong: 0.3 } },
  party:      { out: 0.7,  rates: { beer: 3.5, seltzer: 1.5, mixed: 2.5, wine: 0.3, other: 0.5, shots: 3.5, cigs: 2.5, joints: 1, edibles: 0.3, bong: 1.5 }, day: { cigs: 0.5, bong: 0.4 } },
  saint:      { out: 0.18, rates: { beer: 0.6, seltzer: 0.8, mixed: 0.2, wine: 0.4, other: 0, shots: 0.1, cigs: 0, joints: 0, edibles: 0, bong: 0 },        day: {} },
};

// Relative likelihood/intensity of going out by weekday (Mon..Sun).
const DAY_WEIGHT = [0.25, 0.3, 0.55, 1.05, 1.35, 1.5, 0.45];

// ---- people ---------------------------------------------------------------
// friends: ids of this person's friends (graph is made symmetric below).

const RAW_PEOPLE = [
  // The user's starting friends
  { id: 'maya',    name: 'Maya Chen',        handle: 'mayabee',     emoji: '🦋', hue: 320, persona: 'wine',     year: 'Junior',    hangouts: ['kissam', 'midtown', 'hillsboro'],    weeks: 20, loc: true,  friends: ['jordan', 'priya', 'sofia', 'ella', 'nina'] },
  { id: 'jordan',  name: 'Jordan Blake',     handle: 'jblake',      emoji: '🐐', hue: 30,  persona: 'frat',     year: 'Junior',    hangouts: ['greek-row', 'midtown', 'broadway'],   weeks: 22, loc: true,  friends: ['tyler', 'marcus', 'deshawn', 'cam', 'luke'] },
  { id: 'tyler',   name: 'Tyler Brooks',     handle: 'tbrooks',     emoji: '🦍', hue: 200, persona: 'party',    year: 'Senior',    hangouts: ['greek-row', 'broadway', 'gulch'],     weeks: 26, loc: true,  friends: ['jordan', 'marcus', 'cam', 'hunter'] },
  { id: 'priya',   name: 'Priya Patel',      handle: 'priyap',      emoji: '🌸', hue: 280, persona: 'light',    year: 'Sophomore', hangouts: ['commons', 'hillsboro', 'kissam'],     weeks: 12, loc: false, friends: ['maya', 'ella', 'grace', 'nina'] },
  { id: 'marcus',  name: 'Marcus Reed',      handle: 'marcusr',     emoji: '🐻', hue: 140, persona: 'stoner',   year: 'Junior',    hangouts: ['west-end', 'centennial', 'east-nash'], weeks: 18, loc: true,  friends: ['tyler', 'jordan', 'zoe', 'luke', 'dev'] },
  { id: 'sofia',   name: 'Sofia Alvarez',    handle: 'sofiaa',      emoji: '🌶️', hue: 5,   persona: 'smoker',   year: 'Senior',    hangouts: ['midtown', 'music-row', '12-south'],   weeks: 16, loc: true,  friends: ['maya', 'zoe', 'ava', 'hunter'] },
  { id: 'cam',     name: 'Cam Whitaker',     handle: 'camw',        emoji: '🦈', hue: 215, persona: 'balanced', year: 'Junior',    hangouts: ['greek-row', 'west-end', 'midtown'],   weeks: 9,  loc: true,  friends: ['jordan', 'tyler', 'luke', 'ben'] },
  { id: 'ella',    name: 'Ella Morgan',      handle: 'ellamo',      emoji: '🍓', hue: 350, persona: 'saint',    year: 'Sophomore', hangouts: ['commons', 'kissam', 'centennial'],    weeks: 14, loc: false, friends: ['maya', 'priya', 'grace'] },
  // Friends-of-friends (suggestions)
  { id: 'luke',    name: 'Luke Harrison',    handle: 'lukeh',       emoji: '🐺', hue: 190, persona: 'frat',     year: 'Sophomore', hangouts: ['greek-row', 'broadway'],              weeks: 10, loc: true,  friends: ['jordan', 'marcus', 'cam'] },
  { id: 'zoe',     name: 'Zoe Kim',          handle: 'zoekim',      emoji: '🌙', hue: 260, persona: 'stoner',   year: 'Junior',    hangouts: ['east-nash', 'west-end', '12-south'],  weeks: 15, loc: true,  friends: ['marcus', 'sofia', 'ava'] },
  { id: 'nina',    name: 'Nina Okafor',      handle: 'ninaok',      emoji: '🦚', hue: 170, persona: 'wine',     year: 'Senior',    hangouts: ['hillsboro', 'midtown', 'kissam'],     weeks: 11, loc: true,  friends: ['maya', 'priya'] },
  { id: 'deshawn', name: 'DeShawn Carter',   handle: 'dshawn',      emoji: '🦅', hue: 45,  persona: 'party',    year: 'Junior',    hangouts: ['broadway', 'gulch', 'midtown'],       weeks: 8,  loc: true,  friends: ['jordan'] },
  { id: 'grace',   name: 'Grace Liu',        handle: 'gracel',      emoji: '🐼', hue: 100, persona: 'light',    year: 'Freshman',  hangouts: ['commons', 'centennial'],              weeks: 4,  loc: false, friends: ['priya', 'ella'] },
  { id: 'hunter',  name: 'Hunter Price',     handle: 'hunterp',     emoji: '🦬', hue: 25,  persona: 'smoker',   year: 'Senior',    hangouts: ['music-row', 'broadway', 'gulch'],     weeks: 19, loc: true,  friends: ['tyler', 'sofia'] },
  { id: 'ava',     name: 'Ava Thompson',     handle: 'avat',        emoji: '🪩', hue: 300, persona: 'party',    year: 'Sophomore', hangouts: ['midtown', '12-south', 'gulch'],       weeks: 7,  loc: true,  friends: ['sofia', 'zoe'] },
  { id: 'dev',     name: 'Dev Raman',        handle: 'devr',        emoji: '🐙', hue: 230, persona: 'stoner',   year: 'Senior',    hangouts: ['west-end', 'centennial'],             weeks: 13, loc: false, friends: ['marcus'] },
  { id: 'ben',     name: 'Ben Castillo',     handle: 'bencast',     emoji: '🦊', hue: 15,  persona: 'balanced', year: 'Junior',    hangouts: ['greek-row', 'hillsboro'],             weeks: 6,  loc: true,  friends: ['cam'] },
  // Strangers (reachable by search only; some share hangouts → location suggestions)
  { id: 'olivia',  name: 'Olivia Grant',     handle: 'livgrant',    emoji: '🌻', hue: 55,  persona: 'wine',     year: 'Junior',    hangouts: ['kissam', 'midtown'],                  weeks: 9,  loc: true,  friends: ['sam'] },
  { id: 'sam',     name: 'Sam Nguyen',       handle: 'samn',        emoji: '🐸', hue: 120, persona: 'balanced', year: 'Sophomore', hangouts: ['greek-row', 'west-end'],              weeks: 5,  loc: true,  friends: ['olivia'] },
  { id: 'riley',   name: 'Riley Foster',     handle: 'rileyf',      emoji: '🦄', hue: 290, persona: 'party',    year: 'Freshman',  hangouts: ['broadway', 'gulch'],                  weeks: 3,  loc: true,  friends: [] },
  { id: 'noah',    name: 'Noah Bennett',     handle: 'noahb',       emoji: '🐢', hue: 160, persona: 'saint',    year: 'Senior',    hangouts: ['centennial', 'commons'],              weeks: 12, loc: false, friends: [] },
];

function buildPeople(raw) {
  const byId = Object.fromEntries(raw.map(p => [p.id, { ...p, friends: new Set(p.friends) }]));
  for (const p of Object.values(byId)) {
    for (const f of p.friends) if (byId[f]) byId[f].friends.add(p.id);
  }
  return raw.map(({ id }) => {
    const p = byId[id];
    return {
      id: p.id, name: p.name, handle: p.handle,
      avatar: { emoji: p.emoji, hue: p.hue },
      school: 'Vanderbilt', year: p.year,
      persona: p.persona,
      hangouts: p.hangouts,            // DEMO_SPOTS ids
      usesLocation: p.loc,
      joinedWeeksAgo: p.weeks,         // limits how much history exists
      friendIds: [...p.friends].filter(f => byId[f]),
    };
  });
}

export const PEOPLE = buildPeople(RAW_PEOPLE);
export const PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map(p => [p.id, p]));
export const personById = id => PEOPLE_BY_ID[id] || null;

// Initial social state for a new demo user.
export const DEMO_START_FRIENDS = ['maya', 'jordan', 'tyler', 'priya', 'marcus', 'sofia', 'cam', 'ella'];
export const DEMO_INCOMING_REQUESTS = ['nina', 'luke'];
export const DEMO_GROUPS = [
  { id: 'g-floor3', name: 'Floor 3 Degens', emoji: '🔥', memberIds: ['me', 'jordan', 'tyler', 'marcus', 'cam'] },
  { id: 'g-roomies', name: 'Roomies', emoji: '🏠', memberIds: ['me', 'maya', 'priya', 'ella'] },
  { id: 'g-sunday', name: 'Sunday Scaries', emoji: '😵‍💫', memberIds: ['me', 'sofia', 'maya', 'jordan', 'marcus', 'tyler'] },
];
// Persona used when generating the user's own demo history.
export const MY_DEMO = { id: 'me', persona: 'balanced', hangouts: ['greek-row', 'midtown', 'kissam', 'broadway'], usesLocation: true };

// ---- generator -------------------------------------------------------------

const jitter = (r, spot, meters = 45) => ({
  lat: spot.lat + ((r() - 0.5) * 2 * meters) / 111320,
  lng: spot.lng + ((r() - 0.5) * 2 * meters) / (111320 * Math.cos((spot.lat * Math.PI) / 180)),
});

// Expand persona rates into [{cat, sub}] items for one occasion.
function sampleItems(r, rates, scale) {
  const items = [];
  const add = (cat, sub, n) => { for (let i = 0; i < n; i++) items.push({ cat, sub }); };
  for (const sub of ['beer', 'seltzer', 'mixed', 'wine', 'other']) add('drinks', sub, poisson(r, (rates[sub] || 0) * scale));
  for (const cat of ['shots', 'cigs', 'joints', 'edibles', 'bong']) add(cat, null, poisson(r, (rates[cat] || 0) * scale));
  return items;
}

/**
 * Deterministically generate one person's logs & sessions for a week.
 * @param {object} person  { id, persona, hangouts, usesLocation }
 * @param {string} weekKey
 * @returns {{ logs: Array, sessions: Array }}
 */
export function generateWeek(person, weekKey, salt = '') {
  const r = rng(`${person.id}|${weekKey}${salt}`);
  const persona = PERSONAS[person.persona] || PERSONAS.balanced;
  const logs = [], sessions = [];
  // Week-level mood: dry week, normal, or a big week.
  const mood = r();
  const intensity = mood < 0.08 ? 0.15 : mood < 0.8 ? 0.7 + r() * 0.5 : 1.25 + r() * 0.45;
  let n = 0;
  const hangouts = (person.hangouts || []).map(id => DEMO_SPOT_BY_ID[id]).filter(Boolean);

  weekDays(weekKey).forEach((dayKey, i) => {
    const w = DAY_WEIGHT[i];
    const goesOut = r() < Math.min(0.95, persona.out * w * intensity * 1.1);

    // Daytime / low-key usage (not in a session)
    const dayItems = sampleItems(r, persona.day || {}, intensity * (0.6 + w * 0.4));
    for (const it of dayItems) {
      const hour = 13 + r() * 8; // 1 PM - 9 PM
      logs.push({ id: `${person.id}-${weekKey}-${n++}`, ...it, ts: tsAt(dayKey, Math.floor(hour), Math.floor((hour % 1) * 60)), dayKey, sessionId: null, loc: null, manual: false });
    }
    if (!goesOut) return;

    const items = sampleItems(r, persona.rates, w * intensity);
    if (!items.length) return;
    // Night out: starts 8–11 PM, lasts 2–6 h (often past midnight).
    const startH = 20 + r() * 3;
    const lenH = 2 + r() * 4 * Math.min(1.3, w);
    const start = tsAt(dayKey, Math.floor(startH), Math.floor((startH % 1) * 60));
    const end = start + lenH * 3600 * 1000;
    const withLoc = person.usesLocation && hangouts.length > 0 && r() < 0.8;
    const stops = withLoc ? Array.from({ length: 1 + Math.floor(r() * Math.min(3, hangouts.length)) }, () => pick(r, hangouts)) : [];
    const sessionId = withLoc || r() < 0.4 ? `${person.id}-${weekKey}-s${i}` : null;

    items.forEach((it, k) => {
      const frac = (k + r() * 0.8) / items.length;
      const ts = Math.round(start + frac * (end - start));
      const stop = stops.length ? stops[Math.min(stops.length - 1, Math.floor(frac * stops.length))] : null;
      logs.push({
        id: `${person.id}-${weekKey}-${n++}`, ...it, ts, dayKey,
        sessionId, loc: stop ? { ...jitter(r, stop), acc: 15 } : null, manual: false,
      });
    });

    if (sessionId) {
      const route = [];
      stops.forEach((s, k) => {
        const segStart = start + (k / stops.length) * (end - start);
        for (let j = 0; j < 4; j++) route.push({ ...jitter(r, s, 60), ts: Math.round(segStart + j * 5 * 60000) });
      });
      sessions.push({ id: sessionId, start, end, dayKey, name: null, route });
    }
  });
  logs.sort((a, b) => a.ts - b.ts);
  return { logs, sessions };
}

// Cache: generated weeks never change.
const weekCache = new Map();
export function demoWeek(personId, weekKey) {
  const key = `${personId}|${weekKey}`;
  if (!weekCache.has(key)) {
    const p = personById(personId);
    weekCache.set(key, p ? generateWeek(p, weekKey) : { logs: [], sessions: [] });
  }
  return weekCache.get(key);
}

/**
 * The user's own demo history: logs/sessions for `weeks` weeks ending with
 * `lastWeekKey` (inclusive), generated with MY_DEMO's persona. Ids are
 * prefixed 'demo-' so they can be cleared later.
 */
export function seedMyHistory(lastWeekKey, weeks = 6) {
  const logs = [], sessions = [];
  for (let i = 0; i < weeks; i++) {
    const wk = prevWeekKey(lastWeekKey, i);
    // Keep the seeded history believable: the most recent week (the first drop
    // the user sees) is a real night-out week; the rest aren't near-empty.
    const ok = x => (i === 0
      ? x.logs.length >= 18 && x.logs.length <= 70 && x.sessions.length > 0
      : x.logs.length >= 8 && x.logs.length <= 70);
    let g = generateWeek(MY_DEMO, wk);
    for (let salt = 1; salt < 30 && !ok(g); salt++) g = generateWeek(MY_DEMO, wk, `#${salt}`);
    logs.push(...g.logs.map(l => ({ ...l, id: `demo-${l.id}` })));
    sessions.push(...g.sessions.map(s => ({ ...s, id: `demo-${s.id}` })));
  }
  // Keep log.sessionId consistent with the renamed session ids.
  for (const l of logs) if (l.sessionId) l.sessionId = `demo-${l.sessionId}`;
  logs.sort((a, b) => a.ts - b.ts);
  sessions.sort((a, b) => a.start - b.start);
  return { logs, sessions };
}

