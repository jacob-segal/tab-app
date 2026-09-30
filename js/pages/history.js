// "You" tab: profile card + history of the user's own dropped weeks, sessions
// and spots. Route: /you (?tab=weeks|sessions|spots). Root class: .pg-you
//
// Privacy rules honoured here:
// - The current week (and a "cooking" week) never show any numbers — only a
//   countdown to their drop. Season tiles, trends, lifetime totals, ranks and
//   awards are built exclusively from weeks that already dropped
//   (data.weekStats returns null otherwise, and we never ask for undropped).
// - Spots/pins also only come from dropped weeks, so the map can't leak
//   this week's activity before Monday noon.

import { html, useState, useMemo, useRef, useEffect, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import { navigate } from '../router.js';
import { now } from '../clock.js';
import { CATEGORY_BY_ID, CATEGORY_IDS } from '../config.js';
import {
  weekKeyOf, prevWeekKey, addDays, dropTs, isDropped, weekStartTs, weekEndTs, pendingDropWeekKey,
  currentWeekKey, currentDayKey, latestDroppedWeekKey, daysBetween, dateFromDayKey, formatDropMoment,
  formatDayLabel, formatShortDate, formatDuration, formatTime, formatWeekRange, weekLabel, weekdayLong,
  weekdayShort, dayOfMonth,
} from '../time.js';
import {
  getUser, friendIds, listGroups, droppedWeeks, weekStats, circleIds, compareWeek, rankOn,
  mySessions, activeSession, unseenDrop,
} from '../data.js';
import { awardsFor, topCategories } from '../stats.js';
import { clusterPins, distanceM, routeLengthM, formatDistance } from '../geomath.js';
import {
  Icon, Avatar, PageHeader, Section, EmptyState, Segmented, Delta, Countdown, MetricPicker, METRICS,
  MapView, Link, Bar, weekTitle, openSheet, toast,
} from '../ui.js';
import { beginSession } from '../actions.js';
import { getState, upsertSpot } from '../store.js';

// ---- constants & helpers ---------------------------------------------------------------

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TAB_OPTIONS = [
  { value: 'weeks', label: 'Weeks' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'spots', label: 'Spots' },
];
const TAB_IDS = TAB_OPTIONS.map(o => o.value);
const TREND_METRICS = METRICS.filter(m => m.id === 'score' || CATEGORY_IDS.includes(m.id));
const TREND_WEEKS = 12;
const LIST_PREVIEW = 8;
const MAP_PIN_CAP = 300;
// Decorative "blurred chart" behind the No-peeking label. Fixed shapes, NOT data.
const VEIL = [38, 62, 30, 78, 52, 94, 68];

const round1 = n => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtInt = n => Math.round(n || 0).toLocaleString('en-US');
const hasLoc = l => !!(l && l.loc && typeof l.loc.lat === 'number' && typeof l.loc.lng === 'number');
const valueOf = (st, metric) => (metric === 'score' ? st.score || 0 : (st.totals && st.totals[metric]) || 0);
const sessionTitle = ses => ses.name || `${weekdayLong(ses.dayKey)} night`;

function fmtVal(metric, v) {
  const r = round1(v || 0);
  if (metric === 'score') return String(r);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function sinceLabel(ts) {
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

// Index of the cluster nearest to a point (clusters from geomath.clusterPins).
function nearestIndex(clusters, p) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < clusters.length; i++) {
    const d = distanceM(clusters[i], p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Re-render once at `ts` (next rollover / drop) so rows flip exactly on time. */
function useWakeAt(ts, tick) {
  const [, force] = useState(0);
  useEffect(() => {
    const ms = ts - now();
    if (!(ms > 0) || ms > 0x7fffffff) return undefined;
    const id = setTimeout(() => force(n => n + 1), ms + 250);
    return () => clearTimeout(id);
  }, [ts, tick]);
}

// ---- data builders (memoised in the page) -------------------------------------------------

// Dropped weeks only: rows for the list + season aggregates.
function buildWeeks() {
  const keys = droppedWeeks('me');
  const circle = circleIds();
  const rows = [];
  for (const w of keys) {
    const st = weekStats('me', w);
    if (!st) continue;
    const prev = weekStats('me', prevWeekKey(w)); // null before the user's first week
    let rank = null, awards = [];
    if (circle.length > 1) {
      const cmp = compareWeek(circle, w);
      const r = rankOn(cmp.boards.score, 'me');
      if (r && r.of > 1) rank = r;
      awards = awardsFor('me', cmp.awards);
    }
    rows.push({
      w, st,
      delta: prev ? round1(st.score - prev.score) : null,
      top: topCategories(st).slice(0, 3),
      rank, awards,
    });
  }

  const totals = Object.fromEntries(CATEGORY_IDS.map(c => [c, 0]));
  let scoreSum = 0, sessions = 0, spend = 0, std = 0, dry = 0, best = null;
  for (const r of rows) {
    scoreSum += r.st.score || 0;
    sessions += (r.st.sessions || []).length;
    spend += r.st.spend || 0;
    std += r.st.stdDrinks || 0;
    if (!r.st.logCount) dry++;
    for (const c of CATEGORY_IDS) totals[c] += r.st.totals[c] || 0;
    if (r.st.score > 0 && (!best || r.st.score > best.score)) best = { w: r.w, score: r.st.score };
  }
  return {
    rows,
    season: {
      weeks: rows.length,
      avg: rows.length ? round1(scoreSum / rows.length) : 0,
      best, sessions, totals, dry,
      spend: Math.round(spend),
      stdDrinks: round1(std),
    },
  };
}

// Stops of one session in visit order (named ones only for the label).
function stopsOf(logs, knownSpots) {
  const pins = logs.filter(hasLoc).sort((a, b) => a.ts - b.ts).map(l => ({ lat: l.loc.lat, lng: l.loc.lng }));
  const clusters = clusterPins(pins, knownSpots);
  const order = [];
  for (const p of pins) {
    const i = nearestIndex(clusters, p);
    if (i >= 0 && !order.includes(i)) order.push(i);
  }
  return { count: clusters.length, names: order.map(i => clusters[i]).filter(c => c.spotId).map(c => c.name) };
}

// Finished sessions grouped by week, newest first.
function buildSessions(s) {
  const bySession = new Map();
  for (const l of s.logs) {
    if (!l.sessionId) continue;
    if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, []);
    bySession.get(l.sessionId).push(l);
  }
  const groups = new Map();
  for (const ses of mySessions()) {
    const wk = weekKeyOf(ses.dayKey);
    if (!groups.has(wk)) groups.set(wk, []);
    const logs = bySession.get(ses.id) || [];
    const stops = stopsOf(logs, s.spots);
    groups.get(wk).push({
      ses,
      items: logs.length,
      stops: stops.count,
      stopNames: stops.names,
      distanceM: routeLengthM(ses.route || []),
      durationMs: Math.max(0, (ses.end || ses.start) - ses.start),
    });
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([wk, items]) => ({ wk, items }));
}

// All-time spots from located logs in DROPPED weeks.
function buildSpots(s) {
  const t = now();
  const located = s.logs.filter(hasLoc);
  const revealed = located.filter(l => isDropped(weekKeyOf(l.dayKey), t));
  const hidden = located.length - revealed.length;
  const pins = revealed
    .map(l => ({ lat: l.loc.lat, lng: l.loc.lng, ts: l.ts, cat: l.cat, sub: l.sub || null, dayKey: l.dayKey }))
    .sort((a, b) => a.ts - b.ts);

  const clusters = clusterPins(pins, s.spots);
  const agg = clusters.map(c => ({ name: c.name, spotId: c.spotId, lat: c.lat, lng: c.lng, logs: 0, nights: new Map(), lastTs: 0, lastDayKey: null }));
  const nightsAll = new Set();
  for (const p of pins) {
    const i = nearestIndex(agg, p);
    if (i < 0) continue;
    const c = agg[i];
    c.logs++;
    nightsAll.add(p.dayKey);
    const n = c.nights.get(p.dayKey) || { dayKey: p.dayKey, count: 0, cats: {} };
    n.count++;
    n.cats[p.cat] = (n.cats[p.cat] || 0) + 1;
    c.nights.set(p.dayKey, n);
    if (p.ts >= c.lastTs) { c.lastTs = p.ts; c.lastDayKey = p.dayKey; }
  }
  let mystery = 0;
  const spots = agg
    .filter(c => c.logs > 0)
    .map(c => ({
      ...c,
      visits: c.nights.size,
      nights: [...c.nights.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1)),
    }))
    .sort((a, b) => b.visits - a.visits || b.logs - a.logs || b.lastTs - a.lastTs)
    .map(c => (c.spotId ? c : { ...c, name: `Mystery spot ${++mystery}` }))
    .map((c, i) => ({ ...c, key: c.spotId || `m-${i}-${c.lat.toFixed(5)}` }));

  return {
    spots,
    hidden,
    nights: nightsAll.size,
    mapSpots: spots.map(x => ({ lat: x.lat, lng: x.lng, name: x.name, count: x.visits })),
    mapPins: pins.slice(-MAP_PIN_CAP),
  };
}

// ---- page -------------------------------------------------------------------------------

export function HistoryPage({ query = {} } = {}) {
  const s = useStore();
  const tick = useNow(30000);
  const segRef = useRef(null);

  const T = now();
  const rollover = s.settings.rolloverHour;
  const thisKey = currentWeekKey(T, rollover);
  const pendingKey = pendingDropWeekKey(T, rollover);
  const latestKey = latestDroppedWeekKey(T, rollover);
  useWakeAt(pendingKey ? dropTs(pendingKey) : weekEndTs(thisKey, rollover), tick);

  const tab = TAB_IDS.includes(query.tab) ? query.tab : 'weeks';
  const weeks = useMemo(() => buildWeeks(), [s, latestKey]);
  const sessions = useMemo(() => (tab === 'sessions' ? buildSessions(s) : null), [s, tab]);
  const spots = useMemo(() => (tab === 'spots' ? buildSpots(s) : null), [s, latestKey, tab]);

  const setTab = v => {
    if (v === tab) return;
    const y = window.scrollY;
    navigate(v === 'weeks' ? '/you' : `/you?tab=${v}`, { replace: true });
    // navigate() jumps to the top; keep the user near the tabs instead.
    requestAnimationFrame(() => {
      const el = segRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo(0, Math.max(0, Math.min(y, top)));
    });
  };

  const me = getUser('me');
  const nextDropAt = dropTs(pendingKey || thisKey);

  return html`<div class="page pg-you">
    <${PageHeader} title="You" big
      right=${html`<button class="icon-btn" aria-label="Settings" onClick=${() => navigate('/settings')}><${Icon} name="settings" /></button>`} />

    <${ProfileCard} me=${me} nFriends=${friendIds().length} nGroups=${listGroups().length} nDrops=${weeks.rows.length} />

    <div class="yo-seg" ref=${segRef}>
      <${Segmented} options=${TAB_OPTIONS} value=${tab} onChange=${setTab} />
    </div>

    ${tab === 'weeks' && html`<${WeeksTab} weeks=${weeks} thisKey=${thisKey} pendingKey=${pendingKey} T=${T} rollover=${rollover} />`}
    ${tab === 'sessions' && sessions && html`<${SessionsTab} groups=${sessions} thisKey=${thisKey} pendingKey=${pendingKey} T=${T} />`}
    ${tab === 'spots' && spots && html`<${SpotsTab} data=${spots} locationOn=${!!s.settings.locationEnabled} nextDropAt=${nextDropAt} />`}
  </div>`;
}

// ---- profile ----------------------------------------------------------------------------

function ProfileCard({ me, nFriends, nGroups, nDrops }) {
  const since = sinceLabel(me.joinedAt);
  return html`<div class="card card-night yo-profile">
    <div class="yo-id">
      <${Avatar} user=${me} size="lg" ring />
      <div class="grow">
        <div class="yo-name truncate">${me.name}</div>
        <div class="yo-handle truncate">@${me.handle}${me.school ? ` · ${me.school}` : ''}</div>
        ${since && html`<div class="yo-since"><${Icon} name="calendar" size=${13} /> On Tab since ${since}</div>`}
      </div>
    </div>
    <div class="yo-counts">
      <button class="yo-count" onClick=${() => navigate(nFriends > 0 ? '/crew' : '/crew/add')}>
        <b class="num">${nFriends}</b><span>${nFriends === 0 ? 'add friends' : nFriends === 1 ? 'friend' : 'friends'}</span>
      </button>
      <button class="yo-count" onClick=${() => navigate('/crew?tab=groups')}>
        <b class="num">${nGroups}</b><span>${nGroups === 1 ? 'group' : 'groups'}</span>
      </button>
      <div class="yo-count is-static">
        <b class="num">${nDrops}</b><span>${nDrops === 1 ? 'drop' : 'drops'}</span>
      </div>
    </div>
  </div>`;
}

// ---- weeks tab ----------------------------------------------------------------------------

function WeeksTab({ weeks, thisKey, pendingKey, T, rollover }) {
  const [metric, setMetric] = useState('score');
  const [showAll, setShowAll] = useState(false);
  const { rows, season } = weeks;
  const unseen = unseenDrop();
  const listed = showAll ? rows : rows.slice(0, LIST_PREVIEW);
  const firstDropAt = dropTs(pendingKey || thisKey);

  return html`<div class="yo-body">
    <div class="stack-12">
      <${NowCard} thisKey=${thisKey} T=${T} rollover=${rollover} />
      ${pendingKey && html`<${CookingCard} weekKey=${pendingKey} />`}
    </div>

    ${rows.length === 0
      ? html`<div class="card yo-empty mt-16">
          <${EmptyState} emoji="🎁" title=${`Your first drop lands ${formatDropMoment(firstDropAt)}`}
            body="Log your nights all week. Monday at noon it all drops at once — your totals, your Tab Score and where you land in the crew."
            action=${html`<button class="btn btn-primary" onClick=${() => navigate('/track')}><${Icon} name="plus" size=${18} /> Start tracking</button>`} />
        </div>`
      : html`
        <${Section} title="Season so far">
          <${SeasonTiles} season=${season} />
          <${LifetimeCard} season=${season} />
        </${Section}>

        ${rows.length >= 2 && html`<${Section} title="Trend">
          <${MetricPicker} value=${metric} onChange=${setMetric} metrics=${TREND_METRICS} />
          <${TrendChart} rows=${rows.slice(0, TREND_WEEKS).reverse()} metric=${metric} />
        </${Section}>`}

        <${Section} title=${`Past drops · ${rows.length}`}>
          <div class="stack-8">
            ${listed.map(r => html`<${WeekRow} key=${r.w} row=${r} unseen=${r.w === unseen} />`)}
          </div>
          ${rows.length > LIST_PREVIEW && !showAll && html`<button class="btn btn-outline btn-block mt-12" onClick=${() => setShowAll(true)}>
            Show all ${rows.length} weeks <${Icon} name="chevron-down" size=${16} />
          </button>`}
        </${Section}>
      `}
  </div>`;
}

function NowCard({ thisKey, T, rollover }) {
  const drop = dropTs(thisKey);
  const start = weekStartTs(thisKey, rollover);
  const pct = clamp(((T - start) / Math.max(1, drop - start)) * 100, 0, 100);
  const dayN = clamp(daysBetween(thisKey, currentDayKey(T, rollover)) + 1, 1, 7);
  return html`<${Link} to="/track" className="card yo-now">
    <div class="yo-now-top">
      <span class="yo-kicker"><i class="yo-pulse"></i>This week · in progress</span>
      <span class="yo-dayn">Day ${dayN} of 7</span>
    </div>
    <div class="yo-now-title">${weekTitle(thisKey)}</div>
    <div class="yo-veil" aria-hidden="true">
      ${VEIL.map((h, i) => html`<i key=${i} style=${`height:${h}%`}></i>`)}
    </div>
    <div class="yo-veil-label">No peeking 🙈</div>
    <div class="yo-now-drop">
      <span>Drops <b>${formatDropMoment(drop)}</b></span>
      <${Countdown} targetTs=${drop} compact />
    </div>
    <div class="yo-progress" aria-hidden="true"><i style=${`width:${pct}%`}></i></div>
  </${Link}>`;
}

function CookingCard({ weekKey }) {
  const drop = dropTs(weekKey);
  const lastDay = addDays(weekKey, 6);
  return html`<${Link} to=${`/track?day=${lastDay}`} className="card clickable yo-cooking">
    <span class="yo-cook-emoji" aria-hidden="true">🍳</span>
    <div class="grow">
      <div class="bold">${weekLabel(weekKey)} · cooking 🍳</div>
      <div class="small muted">drops in <${Countdown} targetTs=${drop} compact /></div>
      <div class="tiny faint mt-4">Still editable till noon — forgot a ${weekdayLong(lastDay)} drink?</div>
    </div>
    <${Icon} name="chevron-right" size=${18} />
  </${Link}>`;
}

function SeasonTiles({ season }) {
  return html`<div class="grid-2 yo-tiles">
    <div class="stat-tile">
      <span class="yo-tile-emoji" aria-hidden="true">📅</span>
      <div class="value num">${season.weeks}</div>
      <div class="label">weeks tracked</div>
    </div>
    <div class="stat-tile">
      <span class="yo-tile-emoji" aria-hidden="true">📊</span>
      <div class="value num">${fmtVal('score', season.avg)}</div>
      <div class="label">avg Tab Score</div>
    </div>
    ${season.best
      ? html`<${Link} to=${`/drop/${season.best.w}`} className="stat-tile yo-best">
          <span class="yo-tile-emoji" aria-hidden="true">🔥</span>
          <div class="value num grad-text">${fmtVal('score', season.best.score)}</div>
          <div class="label">best week</div>
          <div class="tiny faint mt-4">${formatWeekRange(season.best.w)}</div>
        </${Link}>`
      : html`<div class="stat-tile">
          <span class="yo-tile-emoji" aria-hidden="true">😇</span>
          <div class="value faint">—</div>
          <div class="label">best week</div>
          <div class="tiny faint mt-4">All dry so far</div>
        </div>`}
    <div class="stat-tile">
      <span class="yo-tile-emoji" aria-hidden="true">🗺️</span>
      <div class="value num">${season.sessions}</div>
      <div class="label">${season.sessions === 1 ? 'session' : 'sessions'}</div>
    </div>
  </div>`;
}

function LifetimeCard({ season }) {
  return html`<div class="card yo-lifetime">
    <div class="yo-lifetime-head">
      <span class="bold">Lifetime tab 🧾</span>
      <span class="tiny faint">every dropped week, added up</span>
    </div>
    <div class="yo-lifetime-grid">
      ${CATEGORY_IDS.map(c => {
        const v = season.totals[c] || 0;
        const cat = CATEGORY_BY_ID[c];
        return html`<div key=${c} class=${cx('yo-cstat', `cat-${c}`, v === 0 && 'is-zero')}>
          <span class="yo-cemoji" aria-hidden="true">${cat.emoji}</span>
          <b class="num">${fmtInt(v)}</b>
          <span class="yo-cunit">${v === 1 ? cat.unit : cat.unitPlural}</span>
        </div>`;
      })}
    </div>
    <div class="yo-lifetime-foot">
      <span>≈ <b>$${fmtInt(season.spend)}</b> spent</span>
      <span><b>${fmtVal('stdDrinks', season.stdDrinks)}</b> std drinks</span>
      ${season.dry > 0 && html`<span><b>${season.dry}</b> dry ${season.dry === 1 ? 'week' : 'weeks'} 🌵</span>`}
    </div>
  </div>`;
}

/** Vertical bars for dropped weeks, oldest → newest. rows: [{w, st}] (≥ 2). */
function TrendChart({ rows, metric }) {
  const cat = CATEGORY_IDS.includes(metric) ? metric : null;
  const vals = rows.map(r => valueOf(r.st, metric));
  const n = vals.length;
  const max = Math.max(0, ...vals);
  const last = vals[n - 1];
  const prior = vals.slice(0, -1);
  const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const pct = avg > 0 ? Math.round(((last - avg) / avg) * 100) : null;
  const bestIdx = max > 0 ? vals.lastIndexOf(max) : -1;
  const scale = v => (max > 0 ? (v / max) * 80 : 0); // leave headroom for value labels
  const unit = cat ? CATEGORY_BY_ID[cat].unitPlural : 'Tab Score';
  const showVal = i => n <= 8 || i === n - 1 || i === bestIdx;

  return html`<div class=${cx('card yo-trend mt-12', cat ? `cat-${cat}` : 'is-score')}>
    <div class="yo-trend-head">
      <div class="grow">
        <div class="yo-trend-big num">${fmtVal(metric, last)}</div>
        <div class="tiny faint">${unit} · ${weekLabel(rows[n - 1].w)}</div>
      </div>
      <div class="yo-trend-vs">
        ${pct === null ? html`<span class="delta faint">—</span>` : html`<${Delta} delta=${pct} suffix="%" />`}
        <div class="tiny faint">vs your avg of ${fmtVal(metric, avg)}</div>
      </div>
    </div>
    <div class="yo-plot">
      ${max > 0 && avg > 0 && html`<div class="yo-avg" style=${`bottom:${scale(avg)}%`}><span>avg</span></div>`}
      ${rows.map((r, i) => html`<button key=${r.w} class=${cx('yo-col', i === n - 1 && 'is-latest', i === bestIdx && 'is-best')}
          onClick=${() => navigate(`/drop/${r.w}`)} aria-label=${`${weekTitle(r.w)}: ${fmtVal(metric, vals[i])} ${unit}`}>
        <span class="yo-val num">${showVal(i) ? fmtVal(metric, vals[i]) : ''}</span>
        <i class="yo-bar" style=${`height:${scale(vals[i])}%; animation-delay:${i * 35}ms`}></i>
      </button>`)}
    </div>
    <div class="yo-xaxis" aria-hidden="true">
      ${rows.map((r, i) => {
        const d = dateFromDayKey(r.w);
        const p = i > 0 ? dateFromDayKey(rows[i - 1].w) : null;
        const showMonth = !p || p.getMonth() !== d.getMonth();
        return html`<span key=${r.w} class=${cx('yo-xl', i === n - 1 && 'is-latest')}><b>${d.getDate()}</b><em>${showMonth ? MONTHS_SHORT[d.getMonth()] : ' '}</em></span>`;
      })}
    </div>
  </div>`;
}

function WeekRow({ row, unseen }) {
  const { w, st, delta, top, rank, awards } = row;
  const dry = !st.logCount;
  return html`<${Link} to=${`/drop/${w}`} className=${cx('card yo-week', unseen ? 'is-new' : 'clickable')}>
    <div class="yo-week-main">
      <div class="yo-week-titlerow">
        <span class="yo-week-title truncate">${weekTitle(w)}</span>
        ${unseen && html`<span class="tag brand">NEW ✨</span>`}
      </div>
      <div class="yo-chips">
        ${dry
          ? html`<span class="yo-dry">Dry week 🌵</span>`
          : top.map(c => html`<span key=${c} class=${`yo-catchip cat-${c}`}>${CATEGORY_BY_ID[c].emoji} ${st.totals[c]}</span>`)}
      </div>
      ${(rank || awards.length > 0) && html`<div class="yo-meta">
        ${rank && html`<span>${rank.rank === 1 ? '👑 ' : ''}#${rank.rank} of ${rank.of} in your crew</span>`}
        ${awards.length > 0 && html`<span>🏆 ${plural(awards.length, 'award')}</span>`}
      </div>`}
    </div>
    <div class="yo-week-score">
      <b class="num">${fmtVal('score', st.score)}</b>
      <span class="yo-week-unit">score</span>
      <${Delta} delta=${delta} />
    </div>
    <${Icon} name="chevron-right" size=${18} className="yo-chev" />
  </${Link}>`;
}

// ---- sessions tab ---------------------------------------------------------------------------

const startSession = () => { beginSession().catch(() => toast('Couldn’t start a session', { emoji: '😵' })); };

function SessionsTab({ groups, thisKey, pendingKey, T }) {
  const live = activeSession();
  return html`<div class="yo-body">
    ${live
      ? html`<${Link} to="/session" className="card clickable yo-live">
          <span class="live-dot"></span>
          <div class="grow">
            <div class="bold">Session live</div>
            <div class="small muted truncate">${sessionTitle(live)} · ${formatDuration(T - live.start)} and counting</div>
          </div>
          <${Icon} name="chevron-right" size=${18} />
        </${Link}>`
      : groups.length > 0 && html`<button class="card clickable yo-start" onClick=${startSession}>
          <span class="yo-start-icon"><${Icon} name="play" size=${16} /></span>
          <span class="grow">
            <span class="bold yo-block">Heading out?</span>
            <span class="small muted yo-block">Start a session — logs stick to tonight, even at 3 AM</span>
          </span>
        </button>`}

    ${groups.length === 0
      ? html`<div class="card yo-empty mt-16">
          <${EmptyState} emoji="🗺️" title="No sessions yet"
            body="A session is your night out, start to finish. Everything you log counts toward the night you started — even at 3 AM. Location on? Tab maps your route and stops, Strava-style (friends only ever see spot names)."
            action=${live
              ? html`<button class="btn btn-primary" onClick=${() => navigate('/session')}>Back to your session</button>`
              : html`<button class="btn btn-primary" onClick=${startSession}><${Icon} name="play" size=${16} /> Start a session</button>`} />
        </div>`
      : groups.map(g => html`<section key=${g.wk} class="section">
          <div class="section-head">
            <h2 class="section-title">${weekTitle(g.wk)}</h2>
            ${g.wk === thisKey
              ? html`<span class="tag">in progress</span>`
              : g.wk === pendingKey
                ? html`<span class="tag warn">cooking 🍳</span>`
                : html`<${Link} to=${`/drop/${g.wk}`} className="section-link">See drop</${Link}>`}
          </div>
          <div class="stack-8">
            ${g.items.map(it => html`<${SessionRow} key=${it.ses.id} item=${it} />`)}
          </div>
        </section>`)}
  </div>`;
}

function SessionRow({ item }) {
  const { ses, items, stops, stopNames, distanceM: dist, durationMs } = item;
  const where = stopNames.length ? ` · ${stopNames.slice(0, 2).join(' → ')}${stopNames.length > 2 ? ' …' : ''}` : '';
  return html`<${Link} to=${`/session/${ses.id}`} className="card clickable yo-ses">
    <${SessionThumb} ses=${ses} />
    <div class="grow">
      <div class="yo-ses-title truncate">${sessionTitle(ses)}</div>
      <div class="small faint truncate">${formatDayLabel(ses.dayKey)} · ${formatTime(ses.start)}${where}</div>
      <div class="yo-ses-meta">
        <span><${Icon} name="clock" size=${13} /> ${formatDuration(durationMs)}</span>
        <span><${Icon} name="zap" size=${13} /> ${plural(items, 'item')}</span>
        ${stops > 0 && html`<span><${Icon} name="map-pin" size=${13} /> ${plural(stops, 'stop')}</span>`}
        ${dist >= 30 && html`<span><${Icon} name="navigation" size=${13} /> ${formatDistance(dist)}</span>`}
      </div>
    </div>
    <${Icon} name="chevron-right" size=${18} className="yo-chev" />
  </${Link}>`;
}

/** Tiny route drawing (own sessions only), else a date tile. */
function SessionThumb({ ses }) {
  const pts = (ses.route || []).filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number');
  if (pts.length >= 2) {
    const k = Math.cos((pts[0].lat * Math.PI) / 180);
    const xs = pts.map(p => p.lng * k), ys = pts.map(p => -p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const S = 52, pad = 9, sc = (S - pad * 2) / span;
    const ox = (S - (maxX - minX) * sc) / 2, oy = (S - (maxY - minY) * sc) / 2;
    const P = xs.map((x, i) => [ox + (x - minX) * sc, oy + (ys[i] - minY) * sc]);
    const d = P.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const [sx, sy] = P[0], [ex, ey] = P[P.length - 1];
    return html`<span class="yo-thumb is-route" aria-hidden="true">
      <svg viewBox="0 0 52 52" width="52" height="52">
        <polyline points=${d} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx=${sx.toFixed(1)} cy=${sy.toFixed(1)} r="3" class="yo-thumb-start" />
        <circle cx=${ex.toFixed(1)} cy=${ey.toFixed(1)} r="3.5" class="yo-thumb-end" />
      </svg>
    </span>`;
  }
  return html`<span class="yo-thumb is-date" aria-hidden="true"><em>${weekdayShort(ses.dayKey)}</em><b>${dayOfMonth(ses.dayKey)}</b></span>`;
}

// ---- spots tab ------------------------------------------------------------------------------

function SpotsTab({ data, locationOn, nextDropAt }) {
  const { spots, hidden, nights, mapSpots, mapPins } = data;

  if (!spots.length) {
    let empty;
    if (hidden > 0) {
      empty = html`<${EmptyState} emoji="🍳" title="Your spots are cooking"
        body=${`This week’s pins land with the drop, ${formatDropMoment(nextDropAt)}. No peeking.`} />`;
    } else if (!locationOn) {
      empty = html`<${EmptyState} emoji="📍" title="Map your nights"
        body="Turn on location and every log during a session drops a pin — Strava for your nights out. Your top spots show up here after each drop. Friends only ever see spot names, never where you actually were."
        action=${html`<button class="btn btn-primary" onClick=${() => navigate('/settings')}><${Icon} name="map-pin" size=${16} /> Turn on location</button>`} />`;
    } else {
      empty = html`<${EmptyState} emoji="🧭" title="No pins yet"
        body="Location’s on — now start a session next time you head out. Every log gets pinned to where you are, and your spots show up here after the drop."
        action=${html`<button class="btn btn-primary" onClick=${startSession}><${Icon} name="play" size=${16} /> Start a session</button>`} />`;
    }
    return html`<div class="yo-body"><div class="card yo-empty">${empty}</div></div>`;
  }

  const topVisits = spots[0].visits;
  const open = sp => openSheet(close => html`<${SpotSheet} spot=${sp} close=${close} />`, { title: sp.name });

  return html`<div class="yo-body">
    <div class="grid-2">
      <div class="stat-tile"><div class="value num">${spots.length}</div><div class="label">${spots.length === 1 ? 'spot' : 'spots'}</div></div>
      <div class="stat-tile"><div class="value num">${nights}</div><div class="label">${nights === 1 ? 'night mapped' : 'nights mapped'}</div></div>
    </div>
    <div class="mt-12"><${MapView} className="tall" spots=${mapSpots} pins=${mapPins} /></div>
    ${hidden > 0 && html`<div class="yo-note">🙈 This week’s pins land with the drop, ${formatDropMoment(nextDropAt)}.</div>`}
    ${!locationOn && html`<${Link} to="/settings" className="banner yo-locbanner mt-12">
      <span aria-hidden="true">📍</span>
      <span class="grow small">Location’s off — new nights won’t get pinned.</span>
      <span class="section-link">Turn on</span>
    </${Link}>`}

    <${Section} title="Top spots · all time">
      <div class="list">
        ${spots.map((sp, i) => html`<div key=${sp.key} class="list-item clickable yo-spot" role="button" tabindex="0"
            onClick=${() => open(sp)}
            onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(sp); } }}>
          <span class=${cx('rank', i < 3 && `r${i + 1}`)}>${i + 1}</span>
          <span class="yo-spot-pin" aria-hidden="true">${sp.spotId ? '📍' : '❓'}</span>
          <div class="grow">
            <div class="primary truncate">${sp.name}</div>
            <div class="secondary truncate">Last visited ${formatShortDate(sp.lastDayKey)} · ${plural(sp.logs, 'log')}</div>
            <${Bar} value=${sp.visits} max=${topVisits} />
          </div>
          <div class="yo-spot-count"><b class="num">${sp.visits}</b><span>${sp.visits === 1 ? 'visit' : 'visits'}</span></div>
        </div>`)}
      </div>
    </${Section}>
  </div>`;
}

// Bottom sheet for one spot: nights there + (re)name it.
// Rendered by SheetHost outside the page, so it carries its own .pg-you root.
function SpotSheet({ spot, close }) {
  const [name, setName] = useState(spot.spotId ? spot.name : '');
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== spot.name;

  const save = () => {
    if (!canSave) return;
    const known = spot.spotId ? getState().spots.find(x => x.id === spot.spotId) : null;
    upsertSpot({
      id: known ? known.id : undefined,
      name: trimmed.slice(0, 40),
      lat: known ? known.lat : spot.lat,
      lng: known ? known.lng : spot.lng,
    });
    toast(`Saved as ${trimmed.slice(0, 40)}`, { emoji: '📍' });
    close();
  };
  const openNight = dayKey => { close(); navigate(`/drop/${weekKeyOf(dayKey)}`); };

  return html`<div class="pg-you yo-sheet">
    <div class="small muted">${plural(spot.visits, 'visit')} · ${plural(spot.logs, 'log')} · last ${formatDayLabel(spot.lastDayKey)}</div>
    <div class="list mt-12">
      ${spot.nights.slice(0, 12).map(nt => html`<div key=${nt.dayKey} class="list-item clickable" role="button" tabindex="0"
          onClick=${() => openNight(nt.dayKey)}
          onKeyDown=${e => { if (e.key === 'Enter') openNight(nt.dayKey); }}>
        <div class="grow">
          <div class="primary">${weekdayLong(nt.dayKey)} night</div>
          <div class="secondary">${formatDayLabel(nt.dayKey)}</div>
        </div>
        <span class="yo-night-cats">
          ${CATEGORY_IDS.filter(c => nt.cats[c] > 0).slice(0, 3).map(c => html`<span key=${c} class=${`cat-${c}`}>${CATEGORY_BY_ID[c].emoji}${nt.cats[c]}</span>`)}
        </span>
        <${Icon} name="chevron-right" size=${16} />
      </div>`)}
    </div>
    ${spot.nights.length > 12 && html`<div class="tiny faint mt-8">+ ${plural(spot.nights.length - 12, 'older night')}</div>`}
    <div class="field mt-16">
      <label for="yo-spot-name">${spot.spotId ? 'Rename this spot' : 'Name this spot'}</label>
      <div class="yo-name-row">
        <input id="yo-spot-name" class="input" value=${name} maxlength="40" placeholder="e.g. Jake’s basement" autocomplete="off"
          onInput=${e => setName(e.currentTarget.value)}
          onKeyDown=${e => { if (e.key === 'Enter') save(); }} />
        <button class="btn btn-primary" disabled=${!canSave} onClick=${save}>Save</button>
      </div>
      <div class="tiny faint">Friends see the name and a rough ~400 m area — never the pin.</div>
    </div>
  </div>`;
}
