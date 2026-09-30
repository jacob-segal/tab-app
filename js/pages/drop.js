// Drop pages.
//   /drop, /drop/:weekKey      → DropPage       (your week, crew compare; teaser if not dropped)
//   /drop/:weekKey/story       → DropStoryPage  (full-screen Wrapped-style reveal)
//
// Product rules honoured here:
// - Nothing about a week (not even your own totals) is shown before its drop:
//   the teaser renders no stats, and weekStats() returns null anyway.
// - Friends never get coordinates: maps only use the user's own pins.
// - Time always comes from clock.now().

import { html, useState, useEffect, useLayoutEffect, useMemo, useRef, cx } from '../lib.js';
import { CATEGORY_BY_ID, CATEGORY_IDS, DRINK_TYPES } from '../config.js';
import {
  weekStats, trendsFor, compareWeek, rankOn, circleIds, getUser, friendIds, latestDropWeek, droppedWeeks,
  unseenDrop, groupsWith, joinedWeekKey,
} from '../data.js';
import {
  isDropped, dropTs, weekLabel, formatWeekRange, formatDropMoment, weekKeyOf, dateFromDayKey, dayKeyFromDate,
  weekdayLong, formatTime, nextDrop, pendingDropWeekKey, currentWeekKey, addDays, latestDroppedWeekKey, formatShortDate,
} from '../time.js';
import { topCategories, awardsFor } from '../stats.js';
import { getState, markDropSeen } from '../store.js';
import { useStore, useNow } from '../hooks.js';
import { navigate } from '../router.js';
import { now } from '../clock.js';
import {
  Icon, Avatar, PageHeader, Section, EmptyState, Countdown, MetricPicker, Leaderboard, AwardCard, WeekPicker,
  weekTitle, DayBars, MapView, shareText, formatMetric,
} from '../ui.js';
import { WeekSummary } from '../components/week-summary.js';

// ---- helpers ----------------------------------------------------------------------

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Canonical weekKey (a Monday) for a 'YYYY-MM-DD' string, or null if it's junk. */
function normWeek(raw) {
  if (!raw || !WEEK_RE.test(raw)) return null;
  const d = dateFromDayKey(raw);
  // Reject dates that roll over (2026-02-31, 2026-13-45) or map to 19xx (0000-01-01).
  if (Number.isNaN(d.getTime()) || dayKeyFromDate(d) !== raw) return null;
  return weekKeyOf(raw);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "Mon 12 PM · Oct 5" */
const dropWhen = ts => `${formatDropMoment(ts)} · ${formatShortDate(dayKeyFromDate(new Date(ts)))}`;
const catCount = (cat, n) => plural(n, CATEGORY_BY_ID[cat].unit, CATEGORY_BY_ID[cat].unitPlural);
const prefersReducedMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};
/** Font-size (in container-width units) that keeps `str` on one line. */
const fitStyle = (str, maxCqw, k = 150) => `--fit:${Math.min(maxCqw, k / Math.max(1, String(str).length)).toFixed(2)}`;

function shareDrop(w, stats, rank) {
  const top = topCategories(stats)[0];
  const topTxt = top ? `${catCount(top, stats.totals[top])} ${CATEGORY_BY_ID[top].emoji}` : 'absolutely nothing 😇';
  const rankTxt = rank && rank.of > 1 ? ` · #${rank.rank} of ${rank.of} in my crew` : '';
  shareText({
    title: `My ${weekLabel(w)} Tab`,
    text: `My ${weekLabel(w)} Tab 🧾 ${formatMetric('score', stats.score)} pts${rankTxt} · top category: ${topTxt}. Get on Tab and let's compare.`,
  });
}

// Remember the picked leaderboard metric across week switches (page remounts per path).
let lastMetric = 'score';

// ---- small building blocks ----------------------------------------------------------

function EmptyCrew() {
  return html`<div class="card dp-empty-crew">
    <${EmptyState} emoji="🫂" title="It’s lonely at the top"
      body="Add friends to see who really ran up the tab this week."
      action=${html`<button class="btn btn-primary" onClick=${() => navigate('/crew/add')}><${Icon} name="user-plus" size=${18} /> Add friends</button>`} />
  </div>`;
}

function CrewBoard({ cmp, w, metric, onMetric }) {
  const board = (cmp && cmp.boards[metric]) || [];
  return html`<div class="dp-metrics"><${MetricPicker} value=${metric} onChange=${onMetric} /></div>
    <div class="card dp-board mt-8">
      <${Leaderboard} board=${board} metric=${metric} getUser=${getUser}
        onSelect=${id => { if (id !== 'me') navigate(`/u/${id}/week/${w}`); }} />
    </div>`;
}

/** Renders nothing; calls onRoll when a new drop lands (e.g. Monday 12 PM) so the page re-reads. */
function DropWatcher({ rollover, onRoll }) {
  const t = useNow(1000);
  const latest = latestDroppedWeekKey(t, rollover);
  const first = useRef(latest);
  useEffect(() => {
    if (latest !== first.current) { first.current = latest; onRoll && onRoll(); }
  }, [latest]);
  return null;
}

/** "Next drop · Week 41 · Mon 12 PM · 4d 3h 12m". Calls onRoll when a new drop lands. */
function NextDropCard({ rollover, onRoll }) {
  const t = useNow(1000);
  const nd = nextDrop(t, rollover);
  const first = useRef(nd.weekKey);
  useEffect(() => {
    if (nd.weekKey !== first.current) { first.current = nd.weekKey; onRoll && onRoll(); }
  }, [nd.weekKey]);
  return html`<div class="card dp-next">
    <span class="dp-next-ico"><${Icon} name="gift" size=${20} /></span>
    <div class="grow">
      <div class="dp-next-kicker">Next drop · ${weekLabel(nd.weekKey)}</div>
      <div class="small muted">${nd.cooking ? `Today ${formatTime(nd.ts)} · cooking now 🍳` : dropWhen(nd.ts)}</div>
    </div>
    <div class="dp-next-count"><${Countdown} targetTs=${nd.ts} compact /></div>
  </div>`;
}

// ---- teaser (week not dropped) ------------------------------------------------------------

function Teaser({ w, rollover, onDropped }) {
  const t = useNow(1000);
  const target = dropTs(w);
  const ready = t >= target;
  useEffect(() => { if (ready) onDropped(); }, [ready]);

  const future = w > currentWeekKey(t, rollover);
  const cooking = pendingDropWeekKey(t, rollover) === w;
  const latest = latestDropWeek();
  const canRewatch = latest !== w && !!weekStats('me', latest);

  if (future) {
    return html`<div class="page pg-drop">
      <${PageHeader} title="The drop" subtitle=${weekTitle(w)} back="/drop" />
      <${EmptyState} emoji="🔮" title="That week hasn’t happened yet" body="Go live it first. We’ll be here."
        action=${html`<button class="btn btn-primary" onClick=${() => navigate('/drop', { replace: true })}>Latest drop</button>`} />
    </div>`;
  }

  return html`<div class="page pg-drop">
    <${PageHeader} title="The drop" subtitle=${weekTitle(w)} />
    <div class="dp-teaser">
      <span class="dp-seal"><${Icon} name="lock" size=${13} stroke=${2.6} /> ${cooking ? 'Plating now' : 'Sealed'}</span>
      <h1 class="dp-teaser-title">${weekLabel(w)} is cooking 🍳</h1>
      <p class="dp-teaser-sub">Drops ${dropWhen(target)} — for you and the whole crew at once.</p>
      <${Countdown} targetTs=${target} />
      <div class="dp-ghosts" aria-hidden="true">
        <div class="dp-ghost"><b>??</b><span>Tab Score</span></div>
        <div class="dp-ghost"><b>#?</b><span>Crew rank</span></div>
        <div class="dp-ghost"><b>?</b><span>Awards</span></div>
      </div>
      <p class="dp-peek">No peeking — not even you 🙈</p>
    </div>

    <div class="lock-note mt-16">
      <${Icon} name=${cooking ? 'edit' : 'moon'} size=${16} />
      <span>${cooking
        ? 'Last week’s still editable until the drop. Forgot a round? Fix it before it locks.'
        : 'Everything you log this week lands here. Nobody sees a thing until the drop.'}</span>
    </div>

    <div class="stack-8 mt-16">
      <button class="btn btn-primary btn-lg btn-block"
        onClick=${() => navigate(cooking ? `/track?day=${addDays(w, 6)}` : '/track')}>
        <${Icon} name=${cooking ? 'edit' : 'plus'} size=${18} /> ${cooking ? 'Fix last week' : 'Log tonight'}
      </button>
      ${canRewatch && html`<button class="btn btn-outline btn-block" onClick=${() => navigate(`/drop/${latest}`)}>
        <${Icon} name="history" size=${18} /> Rewatch ${weekLabel(latest)}
      </button>`}
    </div>
  </div>`;
}

// ---- drop page -----------------------------------------------------------------------------

export function DropPage({ params }) {
  const s = useStore();
  const [, bump] = useState(0);
  const [metric, setMetricState] = useState(lastMetric);
  const setMetric = m => { lastMetric = m; setMetricState(m); };

  const raw = params && params.weekKey;
  const parsed = raw ? normWeek(raw) : null;
  const w = raw ? parsed : latestDropWeek();
  const dropped = !!w && isDropped(w, now());
  const stats = dropped ? weekStats('me', w) : null;
  const hasStats = !!stats;
  const cmp = useMemo(() => (dropped ? compareWeek(circleIds(), w) : null), [s, w, dropped]);

  // Canonicalise odd-but-valid keys (e.g. a Wednesday) to the week's Monday.
  useEffect(() => {
    if (raw && parsed && parsed !== raw) navigate(`/drop/${parsed}`, { replace: true });
  }, [raw, parsed]);

  const rollover = s.settings.rolloverHour;
  const refresh = () => bump(n => n + 1);

  if (!w) {
    return html`<div class="page pg-drop">
      <${PageHeader} title="The drop" back="/drop" />
      <${EmptyState} emoji="🤔" title="That week doesn’t exist" body="Wrong link? Happens to the best of us."
        action=${html`<button class="btn btn-primary" onClick=${() => navigate('/drop', { replace: true })}>Latest drop</button>`} />
    </div>`;
  }

  if (!dropped) return html`<${Teaser} w=${w} rollover=${rollover} onDropped=${refresh} />`;

  const weeks = droppedWeeks('me');
  const hasFriends = friendIds().length > 0;
  const picker = weeks.length > 1 && html`<div class="dp-weeks">
    <${WeekPicker} weeks=${weeks} value=${w} onChange=${k => navigate(`/drop/${k}`, { replace: true })} />
  </div>`;

  // Dropped, but the user wasn't on Tab yet → crew-only view.
  if (!hasStats) {
    const noDrops = weeks.length === 0;
    const jw = joinedWeekKey('me');
    const firstTs = jw ? dropTs(jw) : nextDrop(now(), rollover).ts;
    return html`<div class="page pg-drop">
      <${DropWatcher} rollover=${rollover} onRoll=${refresh} />
      <${PageHeader} title="The drop" subtitle=${weekTitle(w)} />
      ${picker}
      <div class="card dp-newbie">
        <span class="dp-newbie-emoji" aria-hidden="true">👋</span>
        <div class="grow">
          <div class="h3">You weren’t on Tab yet — here’s how the crew did</div>
          <p class="small muted mt-4">${noDrops
            ? 'Log your nights and you’re in the next drop.'
            : `This was before your first week on Tab${jw ? ` (${weekLabel(jw)})` : ''}. Your own stats start there.`}</p>
          ${!noDrops && html`<button class="btn btn-outline btn-sm dp-newbie-btn mt-12" onClick=${() => navigate(`/drop/${weeks[0]}`, { replace: true })}>
            <${Icon} name="gift" size=${16} /> Your latest drop
          </button>`}
        </div>
      </div>
      ${noDrops && jw && html`<div class="card-hero dp-first mt-12">
        <div class="dp-first-kicker">Your first drop · ${weekLabel(jw)}</div>
        <div class="dp-first-title">${dropWhen(firstTs)}</div>
        <div class="mt-12"><${Countdown} targetTs=${firstTs} /></div>
        <button class="btn btn-white btn-block mt-16" onClick=${() => navigate('/track')}><${Icon} name="plus" size=${18} /> Start logging</button>
      </div>`}
      <${Section} title="How the crew did">
        ${hasFriends ? html`<${CrewBoard} cmp=${cmp} w=${w} metric=${metric} onMetric=${setMetric} />` : html`<${EmptyCrew} />`}
      </${Section}>
    </div>`;
  }

  const unseen = unseenDrop() === w;
  const rank = rankOn(cmp.boards.score, 'me');
  const groups = groupsWith('me');
  const share = () => shareDrop(w, stats, rank);
  const openStory = () => navigate(`/drop/${w}/story`);

  return html`<div class="page pg-drop">
    <${PageHeader} title="Your drop" subtitle=${weekTitle(w)}
      right=${html`<button class="icon-btn" onClick=${share} aria-label="Share your drop"><${Icon} name="share" size=${20} /></button>`} />

    ${unseen && html`<button class="dp-cta" onClick=${openStory}>
      <span class="dp-cta-shine" aria-hidden="true"></span>
      <span class="grow dp-cta-text">
        <span class="dp-cta-kicker">${weekLabel(w)} just dropped</span>
        <span class="dp-cta-title">Watch your drop ▶</span>
        <span class="dp-cta-sub">Your recap is ready. Sound on, shame off.</span>
      </span>
      <span class="dp-cta-play"><${Icon} name="play" size=${24} /></span>
    </button>`}

    ${picker}

    ${!unseen && html`<div class="dp-replay">
      <button class="btn btn-outline btn-sm dp-replay-btn" onClick=${openStory}><${Icon} name="play" size=${14} /> Replay story</button>
    </div>`}

    <div class="mt-16"><${WeekSummary} userId="me" weekKey=${w} /></div>

    <${Section} title="vs your crew" action=${hasFriends ? 'Crew' : null} onAction=${() => navigate('/crew')}>
      ${hasFriends ? html`<${CrewBoard} cmp=${cmp} w=${w} metric=${metric} onMetric=${setMetric} />` : html`<${EmptyCrew} />`}
    </${Section}>

    ${cmp.awards.length > 0 && html`<${Section} title="Crew awards">
      <div class="dp-awards">${cmp.awards.map(a => html`<${AwardCard} key=${a.id} award=${a} getUser=${getUser} />`)}</div>
    </${Section}>`}

    <${Section} title="Your groups" action=${groups.length > 0 ? 'New' : null} onAction=${() => navigate('/groups/new')}>
      ${groups.length > 0
        ? html`<div class="hscroll dp-groups">
            ${groups.map(g => html`<button class="chip dp-group" key=${g.id} onClick=${() => navigate(`/groups/${g.id}?week=${w}`)}>
              <span aria-hidden="true">${g.emoji}</span>${g.name}<${Icon} name="chevron-right" size=${14} />
            </button>`)}
          </div>`
        : html`<button class="chip dp-group" onClick=${() => navigate('/groups/new')}><${Icon} name="plus" size=${14} /> Start a group</button>`}
    </${Section}>

    <${NextDropCard} rollover=${rollover} onRoll=${refresh} />

    <button class="btn btn-primary btn-lg btn-block mt-16" onClick=${share}>
      <${Icon} name="share" size=${18} /> Share your drop
    </button>
  </div>`;
}

// =============================================================================================
// Story
// =============================================================================================

const SLIDE_MS = 6500;
const HOLD_MS = 350; // press longer than this = hold-to-pause, not a tap

/** Animated number that counts up from 0 once mounted. */
function CountUp({ to, decimals = 0, duration = 1100, delay = 0 }) {
  const target = Number(to) || 0;
  const [v, setV] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion() || target === 0) { setV(target); return undefined; }
    let raf = 0, start = null, dead = false;
    const step = ts => {
      if (dead) return;
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(step); }, delay);
    return () => { dead = true; clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [target]);
  const f = 10 ** decimals;
  const shown = decimals > 0 ? (Math.round(v * f) / f).toFixed(decimals) : String(Math.round(v));
  return html`<span class="num">${shown}</span>`;
}

/**
 * Segmented progress bars. Fills are driven imperatively with rAF (no re-render
 * per frame, and unaffected by the global reduced-motion CSS override).
 */
function StoryProgress({ count, index, cycle, paused, duration, onDone }) {
  const wrap = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const fills = el.querySelectorAll('i');
    fills.forEach((f, k) => { f.style.transform = `scaleX(${k < index ? 1 : 0})`; });
    const active = fills[index];
    let raf = 0, last = null, elapsed = 0, fired = false;
    const step = ts => {
      if (last === null) last = ts;
      const dt = Math.min(100, ts - last); // cap jumps after tab switches
      last = ts;
      if (!pausedRef.current) elapsed += dt;
      const p = Math.min(1, elapsed / duration);
      if (active) active.style.transform = `scaleX(${p})`;
      if (p >= 1) {
        if (!fired) { fired = true; doneRef.current && doneRef.current(); }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [index, cycle, duration, count]);

  return html`<div class="st-bars" ref=${wrap}>
    ${Array.from({ length: count }, (_, k) => html`<span class="st-seg" key=${k}><i></i></span>`)}
  </div>`;
}

// ---- slide copy ----------------------------------------------------------------------------

function rankQuip(rank) {
  if (!rank) return 'No crew to rank against yet. Add friends and make it a competition 👀';
  if (rank.rank === 1) return 'Crown’s yours. Tab MVP, baby 👑';
  if (rank.rank === rank.of) return 'Dead last. Choir boy energy 😇';
  if (rank.rank === 2) return 'So close to the crown you can taste it 🥈';
  if (rank.rank === 3) return 'Bronze. Still on the podium 🥉';
  return rank.rank <= Math.ceil(rank.of / 2) ? 'Top half. Respectable chaos 😮‍💨' : 'Bottom half. Pacing yourself, or…? 🐢';
}

const DRINK_QUIPS = {
  beer: 'Beer loyalist. Simple, effective 🍺',
  seltzer: 'Seltzer szn never ended 🫧',
  wine: 'Classy or sad — the jury’s still out 🍷',
  mixed: 'Your bartender knows your order 🍹',
  other: 'Mystery cup enjoyer 🥤',
};

function trendQuip(pct, basis) {
  const a = Math.abs(pct);
  if (pct <= -30) return `Down ${a}% from ${basis}. Growth? 🌱`;
  if (pct <= -10) return `Down ${a}% from ${basis}. Easing off the gas 🧘`;
  if (pct < 10) return `Right around ${basis}. Consistent, if nothing else 📏`;
  if (pct < 40) return `Up ${a}% on ${basis}. Busy week 👀`;
  return `Up ${a}%. Who hurt you?`;
}

// ---- slides --------------------------------------------------------------------------------

function IntroSlide({ c }) {
  const { w, stats } = c;
  const wk = weekLabel(w);
  return html`<div class="st-slide st-intro">
    <div class="st-kicker a-rise">Your weekly drop is here</div>
    <div class="st-intro-title">
      <span class="a-rise" style="--d:120ms">Your</span>
      <span class="st-fit st-intro-week a-pop" style=${`${fitStyle(wk, 30, 165)};--d:220ms`}>${wk}</span>
      <span class="a-rise" style="--d:380ms">Tab 🧾</span>
    </div>
    <div class="st-range a-rise" style="--d:520ms">${formatWeekRange(w)}</div>
    <p class="st-sub a-rise" style="--d:700ms">${stats.logCount > 0
      ? `7 nights. ${plural(stats.logCount, 'log', 'logs')}. Let’s see the receipts.`
      : '7 nights. Zero logs. Let’s see… anything? 👀'}</p>
    <div class="st-hint a-fade" style="--d:1400ms">tap to continue · hold to pause</div>
  </div>`;
}

function ScoreSlide({ c }) {
  const { stats, rank, trends } = c;
  const str = formatMetric('score', stats.score);
  const dec = Number.isInteger(stats.score) ? 0 : 1;
  const d = trends ? trends.score.delta : null;
  return html`<div class="st-slide st-center">
    <div class="st-kicker a-rise">Your Tab Score</div>
    <div class="st-huge st-fit a-pop" style=${`${fitStyle(str, 40)};--d:120ms`}><${CountUp} to=${stats.score} decimals=${dec} delay=${150} duration=${1400} /></div>
    <div class="st-pts a-rise" style="--d:300ms">points</div>
    ${rank && html`<div class="st-pill a-rise" style="--d:1100ms">#${rank.rank} of ${rank.of} in your crew</div>`}
    <p class="st-sub a-rise" style="--d:1300ms">${rankQuip(rank)}</p>
    ${typeof d === 'number' && d !== 0 && html`<div class="st-foot a-rise" style="--d:1500ms">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts vs last week</div>`}
  </div>`;
}

function DamageSlide({ c }) {
  const { stats } = c;
  const cats = topCategories(stats);
  if (!cats.length) {
    return html`<div class="st-slide st-center">
      <div class="st-kicker a-rise">The damage</div>
      <div class="st-huge a-pop" style="font-size:140px;--d:120ms">0</div>
      <div class="st-title a-rise" style="--d:350ms">A completely clean week.</div>
      <p class="st-sub a-rise" style="--d:500ms">Who even are you? 😇</p>
    </div>`;
  }
  const two = cats.length > 3;
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">The damage</div>
    <div class="st-title a-rise" style="--d:80ms"><${CountUp} to=${stats.total} delay=${100} /> ${stats.total === 1 ? 'thing' : 'things'} logged</div>
    <div class=${cx('st-damage', two && 'two')}>
      ${cats.map((cat, k) => {
        const d = 260 + k * 130;
        const n = stats.totals[cat];
        return html`<div class=${cx('st-dmg a-rise', `cat-${cat}`)} key=${cat} style=${`--d:${d}ms`}>
          <span class="st-dmg-emoji" aria-hidden="true">${CATEGORY_BY_ID[cat].emoji}</span>
          <span class="st-dmg-num"><${CountUp} to=${n} delay=${d} /></span>
          <span class="st-dmg-lbl">${n === 1 ? CATEGORY_BY_ID[cat].unit : CATEGORY_BY_ID[cat].unitPlural}</span>
        </div>`;
      })}
    </div>
    ${stats.totals.drinks === 0 && stats.spend > 0 && html`<div class="st-foot a-rise" style=${`--d:${300 + cats.length * 130}ms`}>≈ $${stats.spend} spent 💸</div>`}
  </div>`;
}

function DrinksSlide({ c }) {
  const { stats } = c;
  const types = DRINK_TYPES.filter(d => (stats.drinkTypes[d.id] || 0) > 0)
    .sort((a, b) => stats.drinkTypes[b.id] - stats.drinkTypes[a.id]);
  const max = Math.max(1, ...types.map(d => stats.drinkTypes[d.id]));
  const fav = types[0];
  const n = stats.totals.drinks;
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">Drinks</div>
    <div class="st-bignum a-pop" style="--d:80ms"><${CountUp} to=${n} delay=${100} /><span> ${n === 1 ? 'drink' : 'drinks'}</span></div>
    ${fav && html`<p class="st-sub a-rise" style="--d:250ms">${DRINK_QUIPS[fav.id]}</p>`}
    <div class="st-types">
      ${types.map((d, k) => html`<div class="st-type a-rise" key=${d.id} style=${`--d:${380 + k * 110}ms`}>
        <span class="st-type-emoji" aria-hidden="true">${d.emoji}</span>
        <div class="grow">
          <div class="st-type-top"><span>${d.label}</span><b class="num">${stats.drinkTypes[d.id]}</b></div>
          <div class="st-track"><i class="a-grow" style=${`width:${Math.max(4, (stats.drinkTypes[d.id] / max) * 100)}%;--d:${480 + k * 110}ms`}></i></div>
        </div>
      </div>`)}
    </div>
    <div class="st-chips a-rise" style=${`--d:${520 + types.length * 110}ms`}>
      <span class="st-chip">🧪 ${formatMetric('stdDrinks', stats.stdDrinks)} std drinks</span>
      <span class="st-chip">💸 ≈ $${stats.spend} spent</span>
    </div>
  </div>`;
}

function BusiestSlide({ c }) {
  const { stats } = c;
  const b = stats.busiestDay;
  const name = weekdayLong(b.dayKey);
  const late = stats.latestLog;
  let lateTxt = null;
  if (late) {
    // Past midnight (or past rollover inside a session) the calendar date moves on
    // but the log still belongs to the night it started.
    const afterMidnight = dayKeyFromDate(new Date(late.ts)) !== late.dayKey;
    lateTxt = afterMidnight
      ? `Latest log: ${formatTime(late.ts)} — still counted as ${weekdayLong(late.dayKey)} night 🌙`
      : `Latest log: ${formatTime(late.ts)} on ${weekdayLong(late.dayKey)} 🦉`;
  }
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">Your busiest night</div>
    <div class="st-day st-fit a-pop" style=${`${fitStyle(name, 28)};--d:120ms`}>${name}</div>
    <p class="st-sub a-rise" style="--d:300ms">${plural(b.total, 'thing', 'things')} · ${formatMetric('score', b.score)} pts in one night</p>
    <div class="st-chart a-rise" style="--d:480ms"><${DayBars} byDay=${stats.byDay} highlightDayKey=${b.dayKey} /></div>
    ${lateTxt && html`<div class="st-foot a-rise" style="--d:700ms">${lateTxt}</div>`}
  </div>`;
}

function TrendsSlide({ c }) {
  const t = c.trends;
  const sc = t.score;
  const useAvg = sc.vsAvgPct !== null && sc.vsAvgPct !== undefined;
  const pct = useAvg ? sc.vsAvgPct : (sc.prev ? Math.round(((sc.value - sc.prev) / sc.prev) * 100) : null);
  const basis = useAvg ? 'your average' : 'last week'; // the 4-week label lives on the stat card below
  const movers = CATEGORY_IDS.map(cat => ({ cat, d: t.byCat[cat].delta })).filter(x => typeof x.d === 'number' && x.d !== 0);
  const upM = movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d)[0];
  const downM = movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d)[0];
  const big = pct !== null
    ? `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%`
    : `${sc.delta > 0 ? '+' : sc.delta < 0 ? '−' : '±'}${Math.abs(sc.delta || 0)}`;
  const quip = pct !== null ? trendQuip(pct, basis)
    : sc.delta > 0 ? 'From zero to this. Welcome back 👋' : 'Steady as she goes 📏';
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">Trends</div>
    <div class="st-huge st-fit a-pop" style=${`${fitStyle(big, 34)};--d:120ms`}>${big}</div>
    <p class="st-sub st-sub-lg a-rise" style="--d:320ms">${quip}</p>
    <div class="st-stats a-rise" style="--d:520ms">
      ${sc.prev !== null && html`<div class="st-stat">
        <span>vs last week</span>
        <b class="num">${sc.delta > 0 ? '▲ ' : sc.delta < 0 ? '▼ ' : ''}${Math.abs(sc.delta)}</b>
        <em>pts (was ${formatMetric('score', sc.prev)})</em>
      </div>`}
      ${sc.avg !== null && html`<div class="st-stat">
        <span>4-week avg</span>
        <b class="num">${formatMetric('score', sc.avg)}</b>
        <em>pts per week</em>
      </div>`}
    </div>
    ${(upM || downM) && html`<div class="st-movers a-rise" style="--d:700ms">
      ${upM && html`<div class="st-mover"><span>Biggest jump</span><b>${CATEGORY_BY_ID[upM.cat].emoji} ${CATEGORY_BY_ID[upM.cat].label} +${upM.d}</b></div>`}
      ${downM && html`<div class="st-mover"><span>Biggest drop</span><b>${CATEGORY_BY_ID[downM.cat].emoji} ${CATEGORY_BY_ID[downM.cat].label} −${Math.abs(downM.d)}</b></div>`}
    </div>`}
  </div>`;
}

function AwardsSlide({ c }) {
  const mine = awardsFor('me', c.cmp.awards);
  if (!mine.length) {
    return html`<div class="st-slide st-center">
      <div class="st-kicker a-rise">Hardware</div>
      <div class="st-emoji-huge a-pop" style="--d:120ms">🫥</div>
      <div class="st-title a-rise" style="--d:320ms">No hardware this week</div>
      <p class="st-sub a-rise" style="--d:480ms">Somebody’s gotta be the audience. ${plural(c.cmp.awards.length, 'award', 'awards')} went to the crew.</p>
    </div>`;
  }
  const shown = mine.slice(0, 4);
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">Hardware</div>
    <div class="st-title a-rise" style="--d:80ms">You took home ${plural(mine.length, 'award', 'awards')} 🏆</div>
    <div class="st-awards">
      ${shown.map((a, k) => html`<div class="st-award a-rise" key=${a.id} style=${`--d:${260 + k * 160}ms`}>
        <span class="st-award-emoji" aria-hidden="true">${a.emoji}</span>
        <div class="grow">
          <div class="st-award-title">${a.title}${a.winnerIds.length > 1 && html` <span class="st-tie">tie</span>`}</div>
          <div class="st-award-blurb">${a.blurb} · ${a.valueLabel}</div>
        </div>
      </div>`)}
    </div>
    ${mine.length > shown.length && html`<div class="st-foot a-rise" style="--d:1000ms">+${mine.length - shown.length} more in your full drop</div>`}
  </div>`;
}

function SpotsSlide({ c }) {
  const { stats } = c;
  const spots = stats.spots.slice(0, 4);
  const hasMap = stats.pins.length > 0;
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">Where you went</div>
    <div class="st-title a-rise" style="--d:80ms">${plural(stats.spots.length, 'spot', 'spots')} hit</div>
    ${hasMap && html`<div class="st-map a-rise" style="--d:200ms"><${MapView} pins=${stats.pins} spots=${stats.spots} interactive=${false} /></div>`}
    <div class="st-spots">
      ${spots.map((sp, k) => html`<div class="st-spot a-rise" key=${`${sp.name}-${k}`} style=${`--d:${360 + k * 110}ms`}>
        <span class="st-spot-rank">${k + 1}</span>
        <span class="grow truncate">${sp.name}</span>
        <b class="num">${plural(sp.count, 'log', 'logs')}</b>
      </div>`)}
    </div>
  </div>`;
}

function CrewSlide({ c }) {
  const { board } = c;
  const top = board.slice(0, 5);
  const meRow = board.find(r => r.userId === 'me');
  const meInTop = top.some(r => r.userId === 'me');
  const max = Math.max(1, ...board.map(r => r.value));
  const row = (r, k) => {
    const u = getUser(r.userId);
    if (!u) return null;
    return html`<div class=${cx('st-crew-row a-rise', r.userId === 'me' && 'me')} key=${r.userId}
        style=${`--d:${220 + k * 120}ms;--w:${Math.round((r.value / max) * 100)}%`}>
      <span class="st-crew-rank">${r.rank}</span>
      <${Avatar} user=${u} size="sm" />
      <span class="grow truncate st-crew-name">${u.isMe ? 'You' : u.name.split(' ')[0]}</span>
      <b class="num">${formatMetric('score', r.value)}</b>
    </div>`;
  };
  return html`<div class="st-slide">
    <div class="st-kicker a-rise">The standings</div>
    <div class="st-title a-rise" style="--d:80ms">Your crew, ranked</div>
    <div class="st-crew">
      ${top.map(row)}
      ${!meInTop && meRow && html`<div class="st-crew-gap a-rise" key="gap" style=${`--d:${220 + top.length * 120}ms`}>···</div>`}
      ${!meInTop && meRow && row(meRow, top.length + 1)}
    </div>
    <div class="st-foot a-rise" style="--d:1100ms">By Tab Score · ${plural(board.length, 'person', 'people')} dropped this week</div>
  </div>`;
}

function OutroSlide({ c, onFull, onShare }) {
  const { w, stats, rank, rollover } = c;
  const top = topCategories(stats)[0];
  return html`<div class="st-slide st-center st-outro">
    <div class="st-kicker a-rise">${weekLabel(w)} · ${formatWeekRange(w)}</div>
    <div class="st-outro-title a-pop" style="--d:100ms">That’s your tab.</div>
    <div class="st-receipt a-rise" style="--d:320ms">
      <div class="st-r-head">TAB · ${weekLabel(w).toUpperCase()}</div>
      <div class="st-r-row"><span>Things logged</span><b>${stats.total}</b></div>
      ${top && html`<div class="st-r-row"><span>Top category</span><b>${CATEGORY_BY_ID[top].emoji} ${stats.totals[top]}</b></div>`}
      <div class="st-r-row"><span>Est. spent</span><b>$${stats.spend}</b></div>
      ${rank && html`<div class="st-r-row"><span>Crew rank</span><b>#${rank.rank}/${rank.of}</b></div>`}
      <div class="st-r-total"><span>TAB SCORE</span><b>${formatMetric('score', stats.score)}</b></div>
      <div class="st-r-foot">no refunds · see you next week</div>
    </div>
    <div class="st-actions a-rise" style="--d:560ms">
      <button class="btn btn-white btn-lg btn-block" onClick=${onFull}>See full drop</button>
      <button class="btn btn-lg btn-block st-btn-ghost" onClick=${onShare}><${Icon} name="share" size=${18} /> Share</button>
    </div>
    <div class="st-next a-fade" style="--d:900ms">Next drop in <${Countdown} targetTs=${nextDrop(now(), rollover).ts} compact /></div>
  </div>`;
}

// ---- story data -----------------------------------------------------------------------------

function buildCtx(w, rollover) {
  const stats = weekStats('me', w);
  if (!stats) return null;
  const trends = trendsFor('me', w);
  const cmp = compareWeek(circleIds(), w);
  const board = cmp.boards.score;
  const rank = board.length > 1 ? rankOn(board, 'me') : null;
  return { w, stats, trends, cmp, board, rank, rollover };
}

function slideList(c, actions) {
  const { stats, trends, cmp, board } = c;
  const out = [
    { id: 'intro', bg: 'g-intro', C: IntroSlide },
    { id: 'score', bg: 'g-score', C: ScoreSlide },
    { id: 'damage', bg: 'g-damage', C: DamageSlide },
  ];
  if (stats.totals.drinks > 0) out.push({ id: 'drinks', bg: 'g-drinks', C: DrinksSlide });
  if (stats.busiestDay) out.push({ id: 'busiest', bg: 'g-night', C: BusiestSlide });
  if (trends && (trends.score.prev !== null || trends.score.avg !== null)) out.push({ id: 'trends', bg: 'g-trends', C: TrendsSlide });
  if (cmp.awards.length > 0) out.push({ id: 'awards', bg: 'g-awards', C: AwardsSlide });
  if (stats.spots.length > 0) out.push({ id: 'spots', bg: 'g-spots', C: SpotsSlide });
  if (board.length > 1) out.push({ id: 'crew', bg: 'g-crew', C: CrewSlide, dur: 7500 });
  out.push({ id: 'outro', bg: 'g-outro', C: OutroSlide, props: actions });
  return out;
}

// ---- story page -----------------------------------------------------------------------------

export function DropStoryPage({ params }) {
  const s = useStore();
  const raw = params && params.weekKey;
  const w = normWeek(raw);
  const dropped = !!w && isDropped(w, now());
  const ok = dropped && !!weekStats('me', w);
  const rollover = s.settings.rolloverHour;
  const ctx = useMemo(() => (ok ? buildCtx(w, rollover) : null), [s, w, ok]);

  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [held, setHeld] = useState(false);       // finger down → paused
  const [holding, setHolding] = useState(false); // long hold → hide chrome
  const [manualPause, setManualPause] = useState(false);
  const rootRef = useRef(null);
  const press = useRef(null);
  const holdTimer = useRef(0);

  const close = () => {
    if (ok && !getState().seenDrops[w]) markDropSeen(w);
    navigate(w ? `/drop/${w}` : '/drop', { replace: true });
  };
  const share = () => { if (ctx) shareDrop(w, ctx.stats, ctx.rank); };
  const slides = ctx ? slideList(ctx, { onFull: close, onShare: share }) : [];
  const total = slides.length;
  const i = Math.min(index, Math.max(0, total - 1));

  const idxRef = useRef(i);
  idxRef.current = i;
  const totalRef = useRef(total);
  totalRef.current = total;
  const closeRef = useRef(close);
  closeRef.current = close;

  const next = () => { const k = idxRef.current; if (k >= totalRef.current - 1) closeRef.current(); else setIndex(k + 1); };
  const prev = () => { const k = idxRef.current; if (k <= 0) setCycle(n => n + 1); else setIndex(k - 1); };
  const autoNext = () => { const k = idxRef.current; if (k < totalRef.current - 1) setIndex(k + 1); };
  const navRef = useRef({ next, prev });
  navRef.current = { next, prev };

  // Not dropped / no stats / junk key → back to the drop page (which shows the right state).
  useEffect(() => {
    if (!ok) navigate(w ? `/drop/${w}` : '/drop', { replace: true });
    else if (raw !== w) navigate(`/drop/${w}/story`, { replace: true });
  }, [ok, w, raw]);

  // Reaching the outro counts as having watched it.
  useEffect(() => {
    if (ok && total > 0 && i === total - 1 && !getState().seenDrops[w]) markDropSeen(w);
  }, [ok, i, total, w]);

  // Keyboard: ← → to step, Esc to close, Space to pause.
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); navRef.current.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); navRef.current.prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      else if (e.key === ' ' && !(e.target && e.target.closest && e.target.closest('button, a, input'))) {
        e.preventDefault(); setManualPause(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const endPress = () => {
    clearTimeout(holdTimer.current);
    setHeld(false);
    setHolding(false);
  };
  const onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('button, a, input')) return;
    press.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    setHeld(true);
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHolding(true), HOLD_MS);
  };
  const onUp = e => {
    const p = press.current;
    press.current = null;
    endPress();
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) { closeRef.current(); return; }     // swipe down
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { (dx < 0 ? next : prev)(); return; } // swipe
    if (e.timeStamp - p.t >= HOLD_MS) return;                                        // it was a hold
    const rect = rootRef.current ? rootRef.current.getBoundingClientRect() : { left: 0, width: window.innerWidth };
    if ((p.x - rect.left) / Math.max(1, rect.width) < 1 / 3) prev(); else next();
  };
  const onCancel = () => { if (press.current) { press.current = null; endPress(); } };

  if (!ok || !ctx || !total) return html`<div class="pg-story" aria-busy="true"></div>`;

  const slide = slides[i];
  const paused = held || manualPause;
  const Slide = slide.C;

  return html`<div class=${cx('pg-story', holding && 'holding', manualPause && 'paused')} ref=${rootRef}
      role="dialog" aria-modal="true" aria-label=${`${weekLabel(w)} drop story, slide ${i + 1} of ${total}`}
      onPointerDown=${onDown} onPointerUp=${onUp} onPointerCancel=${onCancel} onPointerLeave=${onCancel}
      onContextMenu=${e => e.preventDefault()}>
    ${slides.map((sl, k) => html`<div key=${sl.id} class=${cx('st-bg', sl.bg, k === i && 'on')} aria-hidden="true"></div>`)}
    <div class="st-grain" aria-hidden="true"></div>

    <div class="st-top">
      <${StoryProgress} count=${total} index=${i} cycle=${cycle} paused=${paused} duration=${slide.dur || SLIDE_MS} onDone=${autoNext} />
      <div class="st-head">
        <span class="st-brand"><span class="st-logo">tab</span>${weekLabel(w)} drop</span>
        <div class="row gap-6">
          <button class="st-icon" onClick=${() => setManualPause(p => !p)} aria-label=${manualPause ? 'Resume story' : 'Pause story'}>
            ${manualPause
              ? html`<${Icon} name="play" size=${16} />`
              : html`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="4.5" height="16" rx="1.2" /><rect x="14.5" y="4" width="4.5" height="16" rx="1.2" /></svg>`}
          </button>
          <button class="st-icon" onClick=${close} aria-label="Close story"><${Icon} name="x" size=${22} /></button>
        </div>
      </div>
    </div>

    <div class="st-body" key=${`${slide.id}:${cycle}`}>
      <${Slide} c=${ctx} ...${slide.props || {}} />
    </div>
    ${manualPause && html`<div class="st-paused-badge" aria-hidden="true">Paused</div>`}
  </div>`;
}
