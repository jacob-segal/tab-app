// Track — the daily-use screen. Pick a night, tap + every time, tap a number
// to set it exactly. Only per-day counts live here (plus your own live
// session); nothing week-to-date is ever shown before the drop.

import { html, useState, useRef, useMemo, useLayoutEffect, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import { navigate } from '../router.js';
import { CATEGORIES, CATEGORY_BY_ID, DRINK_TYPES, DRINK_TYPE_BY_ID, SESSION_IDLE_MS } from '../config.js';
import {
  editableDayKeys, isDayEditable, attributeDayKey, currentDayKey, lateNightInfo, pendingDropWeekKey,
  weekKeyOf, dropTs, formatDayLabel, relativeDayName, weekdayShort, weekdayLong, dayOfMonth,
  formatTime, formatDropMoment,
} from '../time.js';
import { totalsOf, stdDrinksOf } from '../stats.js';
import { logsForDay, activeSession, sessionLogs } from '../data.js';
import { setCount, LockedDayError, BACKFILL_TIMES } from '../store.js';
import { quickLog, quickUnlog, beginSession, itemLabel, itemEmoji } from '../actions.js';
import { Icon, CatIcon, PageHeader, Countdown, toast, openSheet } from '../ui.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COUNT = 99; // per item, per day, via the exact-count sheet
const LOCKED_MSG = 'That week already dropped — it’s locked 🔒';

// Alcohol up top, everything else below. Any new category falls into "smoke".
const BOOZE = new Set(['drinks', 'shots']);
const GROUPS = [
  { id: 'booze', title: 'Sips & shots', emoji: '🍻', cats: CATEGORIES.filter(c => BOOZE.has(c.id)) },
  { id: 'smoke', title: 'Smoke & snacks', emoji: '💨', cats: CATEGORIES.filter(c => !BOOZE.has(c.id)) },
].filter(g => g.cats.length > 0);

const TAGLINES = {
  shots: 'down the hatch',
  cigs: 'just a quick dart',
  joints: 'puff, puff, pass',
  edibles: 'kicks in… eventually',
  bong: 'rip count',
};

const pad2 = n => String(n).padStart(2, '0');
const fmtHour = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const plural = (n, one, many) => (n === 1 ? one : many);
const clampCount = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, n)) : 0;
};

// Tracks value changes so the number can pop (and show a floating +N).
// Mutating the ref during render is fine in Preact (no concurrent rendering).
function usePop(value) {
  const ref = useRef({ v: value, n: 0, dir: '', delta: 0 });
  const r = ref.current;
  if (r.v !== value) ref.current = { v: value, n: r.n + 1, dir: value > r.v ? 'bump' : 'dip', delta: value - r.v };
  return ref.current;
}

// ---- page ------------------------------------------------------------------------

export function TrackPage({ query = {} } = {}) {
  const s = useStore();
  const t = useNow(10000);
  const stripRef = useRef(null);
  const didScroll = useRef(false);
  const prevSel = useRef(null);
  const dirRef = useRef('');
  const [at, setAt] = useState('late'); // rough time for back-filled logs

  const rollover = s.settings.rolloverHour;
  const ses = activeSession();
  const todayKey = currentDayKey(t, rollover);
  const liveDay = attributeDayKey(t, rollover, ses);
  const days = editableDayKeys(t, rollover);
  const daysSig = days.join(',');
  const late = lateNightInfo(t, rollover);
  const pendingWeek = pendingDropWeekKey(t, rollover);

  // Which day are we editing? ?day= only if it's still editable.
  const asked = typeof query.day === 'string' && query.day ? query.day : null;
  const askedOk = !!asked && DAY_RE.test(asked) && days.includes(asked) && isDayEditable(asked, t, rollover);
  const selected = askedOk ? asked : liveDay;
  const askedProblem = asked && !askedOk && DAY_RE.test(asked) ? (asked > todayKey ? 'future' : 'locked') : null;

  // Which categories got logged on each strip day (for the chip dots).
  const dayCats = useMemo(() => {
    const inStrip = new Set(days);
    const m = {};
    for (const l of s.logs) {
      if (!inStrip.has(l.dayKey)) continue;
      if (!m[l.dayKey]) m[l.dayKey] = new Set();
      m[l.dayKey].add(l.cat);
    }
    return m;
  }, [s.logs, daysSig]);

  // Slide the cards in from the direction you moved.
  if (prevSel.current !== selected) {
    dirRef.current = prevSel.current == null ? '' : selected > prevSel.current ? 'fwd' : 'back';
    prevSel.current = selected;
  }

  // Keep the selected chip in view (instant on mount, smooth after).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const chip = strip.querySelector(`[data-day="${selected}"]`);
    if (!chip) return;
    const left = Math.max(0, chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2);
    const first = !didScroll.current;
    didScroll.current = true;
    try { strip.scrollTo({ left, behavior: first ? 'auto' : 'smooth' }); } catch { strip.scrollLeft = left; }
  }, [selected, daysSig]);

  // "Today" / "Tonight" (after midnight) / "Last night" / null
  const relOf = d => {
    const r = relativeDayName(d, todayKey);
    if (r === 'Today') return late.late ? 'Tonight' : 'Today';
    return r === 'Last night' ? r : null;
  };
  // 'tonight' / 'last night' / 'Wednesday' — for use mid-sentence.
  const phraseOf = d => { const r = relOf(d); return r ? r.toLowerCase() : weekdayLong(d); };
  const nightOf = d => `${weekdayLong(d)} night`;

  const pick = d => {
    const y = window.scrollY;
    // The live day gets the clean URL so it keeps following the clock.
    navigate(d === liveDay ? '/track' : `/track?day=${d}`, { replace: true });
    if (y) window.scrollTo(0, y); // navigate() scrolls to top; keep your place
  };

  // Selected day data — per-day only.
  const dayLogs = logsForDay(selected);
  const tot = totalsOf(dayLogs);
  const std = stdDrinksOf(tot.drinkTypes, tot.totals.shots);
  const lastAt = {};
  for (const l of dayLogs) if (!l.manual && (!lastAt[l.cat] || l.ts > lastAt[l.cat])) lastAt[l.cat] = l.ts;

  const isLive = selected === liveDay;
  const selRel = relOf(selected);
  const subtitle = `${formatDayLabel(selected)}${selRel ? ` · ${selRel}` : ''}`;
  const selWeek = weekKeyOf(selected);
  const cooking = !!pendingWeek && selWeek === pendingWeek;
  const sessionShift = !!ses && liveDay !== todayKey;

  const plus = (cat, sub = null) => quickLog(cat, sub, { dayKey: selected, at: isLive ? undefined : at });
  const minus = (cat, sub = null) => quickUnlog(cat, sub, selected, { undoToast: true });
  const edit = (cat, sub, current) => openCountSheet({ cat, sub, dayKey: selected, current, dayPhrase: phraseOf(selected), at: isLive ? undefined : at });

  // Day chips, with a thin divider where the cooking week meets this week.
  const stripItems = [];
  days.forEach((d, i) => {
    if (i > 0 && weekKeyOf(d) !== weekKeyOf(days[i - 1])) {
      stripItems.push(html`<span key=${`sep-${d}`} class="trk-sep" aria-hidden="true"></span>`);
    }
    const rel = relOf(d);
    const set = dayCats[d];
    const cats = set ? CATEGORIES.filter(c => set.has(c.id)).slice(0, 4) : [];
    stripItems.push(html`<button key=${d} data-day=${d}
        class=${cx('trk-day', d === selected && 'is-sel', d === todayKey && 'is-today', !!ses && d === liveDay && 'is-session')}
        onClick=${() => pick(d)} aria-pressed=${d === selected}
        aria-label=${`${formatDayLabel(d)}${rel ? `, ${rel}` : ''}${cats.length ? ', has logs' : ''}`}>
      ${rel && html`<span class="rel">${rel}</span>`}
      <span class="wd">${weekdayShort(d)}</span>
      <span class="dn">${dayOfMonth(d)}</span>
      <span class="dots" aria-hidden="true">${cats.map(c => html`<i key=${c.id} class=${`cat-${c.id}`}></i>`)}</span>
    </button>`);
  });

  const hushWhen = cooking ? 'today’s 12 PM drop' : weekdayShort(todayKey) === 'Mon' ? 'next Monday’s drop' : 'Monday’s drop';

  return html`<div class="page pg-track">
    <${PageHeader} title="Track" big subtitle=${subtitle}
      right=${html`<button class="icon-btn" onClick=${() => openInfoSheet(rollover)} aria-label="How tracking works"><${Icon} name="info" size=${20} /></button>`} />

    <div class="trk-body">
      ${askedProblem === 'locked' && html`<div class="lock-note trk-note">
        <${Icon} name="lock" size=${16} />
        <span class="grow">${formatDayLabel(asked)} already dropped, so it’s locked. Showing ${phraseOf(liveDay)} instead.</span>
        <button class="trk-note-link" onClick=${() => navigate(`/drop/${weekKeyOf(asked)}`)}>See drop</button>
      </div>`}
      ${askedProblem === 'future' && html`<div class="lock-note trk-note">
        <span aria-hidden="true">🔮</span>
        <span class="grow">Can’t log the future (yet). Showing ${phraseOf(liveDay)} instead.</span>
      </div>`}

      <div class="hscroll trk-days" ref=${stripRef} aria-label="Pick a day">
        <button class="trk-older" onClick=${() => navigate('/you')} aria-label="Older weeks already dropped and are locked. See your history">
          <span class="trk-older-lock" aria-hidden="true">🔒</span>
          <span>Older</span>
        </button>
        ${stripItems}
      </div>

      ${isLive && sessionShift && html`<div class="banner late trk-banner">
        <span class="trk-banner-icon"><span class="live-dot"></span></span>
        <div class="grow">
          <div class="trk-banner-title">Session live — everything counts toward ${nightOf(liveDay)}</div>
          <div class="trk-banner-sub">Even at <${NowTime} />. End it when you’re home.</div>
        </div>
      </div>`}
      ${isLive && !sessionShift && late.late && html`<div class="banner late trk-banner">
        <span class="trk-banner-icon"><${Icon} name="moon" size=${18} /></span>
        <div class="grow">
          <div class="trk-banner-title">It’s <${NowTime} /> — still counts as ${nightOf(late.tabDayKey)} 🌙</div>
          <div class="trk-banner-sub">Your day resets at ${fmtHour(rollover)}</div>
        </div>
      </div>`}
      ${cooking && html`<div class="banner trk-banner trk-cook">
        <span class="trk-banner-icon" aria-hidden="true">⏳</span>
        <div class="grow">
          <div class="trk-banner-title">Last call: this week drops ${formatDropMoment(dropTs(selWeek))}, then it locks 🔒</div>
          <div class="trk-banner-sub">Locks in <${Countdown} compact targetTs=${dropTs(selWeek)} /></div>
        </div>
      </div>`}

      <${SessionCard} ses=${ses} isLive=${isLive} late=${late.late} liveDay=${liveDay}
        rollover=${rollover} locationOn=${!!s.settings.locationEnabled} />

      ${s.logs.length === 0 && html`<div class="trk-hint">
        <span class="trk-hint-emoji" aria-hidden="true">👆</span>
        <div class="grow">
          <div class="bold">Tap + every time you crack one.</div>
          <div class="small muted">Tap a number to set it exactly. Fat-fingered a −? There’s an undo.</div>
        </div>
      </div>`}

      ${!isLive && html`<div class="card trk-when">
        <div class="trk-when-head">
          <span class="bold small">Adding to ${nightOf(selected)} — roughly when?</span>
          <span class="tiny faint">keeps Night Owl honest</span>
        </div>
        <div class="trk-when-opts" role="radiogroup" aria-label="Roughly when">
          ${BACKFILL_TIMES.map(b => html`<button key=${b.id} role="radio" aria-checked=${at === b.id}
              class=${cx('trk-when-opt', at === b.id && 'on')} onClick=${() => setAt(b.id)}>
            <span aria-hidden="true">${b.emoji}</span><b>${b.label}</b><small>${b.hint}</small>
          </button>`)}
        </div>
      </div>`}

      <div key=${selected} class=${cx('trk-groups', dirRef.current && `trk-in-${dirRef.current}`)}>
        ${GROUPS.map(g => html`<section key=${g.id} class="trk-group">
          <div class="trk-group-head"><h2 class="section-title">${g.emoji} ${g.title}</h2></div>
          <div class="trk-cards">
            ${g.cats.map(c => (c.id === 'drinks'
              ? html`<${DrinksCard} key=${c.id} total=${tot.totals.drinks} types=${tot.drinkTypes}
                  onPlus=${sub => plus('drinks', sub)} onMinus=${sub => minus('drinks', sub)}
                  onEdit=${(sub, cur) => edit('drinks', sub, cur)} />`
              : html`<${CatCard} key=${c.id} cat=${c.id} count=${tot.totals[c.id] || 0} lastTs=${lastAt[c.id] || null}
                  onPlus=${() => plus(c.id)} onMinus=${() => minus(c.id)}
                  onEdit=${() => edit(c.id, null, tot.totals[c.id] || 0)} />`))}
          </div>
        </section>`)}
      </div>

      <div class="trk-footer">
        ${tot.total > 0
          ? html`<span><b class="num">${tot.total}</b> ${plural(tot.total, 'thing', 'things')} logged</span>
              ${std > 0 && html`<span class="trk-dotsep" aria-hidden="true">·</span><span>~<b class="num">${std}</b> ${plural(std, 'std drink', 'std drinks')}</span>`}`
          : html`<span>Nothing on the tab for ${phraseOf(selected)}${isLive ? '… yet' : ' — a quiet one 😇'}</span>`}
      </div>

      <div class="trk-hush">Friends won’t see any of this until ${hushWhen} 🤫</div>
    </div>
  </div>`;
}

// ---- session card ------------------------------------------------------------------

function SessionCard({ ses, isLive, late, liveDay, rollover, locationOn }) {
  if (ses) {
    const n = sessionLogs(ses.id).length;
    return html`<button class="card card-grad clickable trk-live" onClick=${() => navigate('/session')} aria-label="Open live session">
      <div class="trk-live-top">
        <span class="trk-live-tag"><span class="live-dot"></span> Session live</span>
        <${Icon} name="chevron-right" size=${20} />
      </div>
      <div class="trk-live-row">
        <div class="trk-live-time"><${Elapsed} since=${ses.start} /></div>
        <div class="trk-live-meta">
          <div class="bold">${ses.name || `${weekdayLong(ses.dayKey)} night`}</div>
          <div class="small faint">${n} ${plural(n, 'thing', 'things')} logged${locationOn ? ' · 📍 mapping your spots' : ''}</div>
        </div>
      </div>
    </button>`;
  }
  if (!isLive) return null;
  return html`<div class="card card-night trk-go">
    <div class="trk-go-top">
      <span class="trk-go-emoji" aria-hidden="true">${late ? '🦉' : '🪩'}</span>
      <div class="grow">
        <div class="h3">${late ? 'Still out?' : 'Going out tonight?'}</div>
        <p class="small muted mt-4">Start a session and everything you log stays on ${weekdayLong(liveDay)} night — even past ${fmtHour(rollover)}.${locationOn ? ' We’ll pin your spots on a map, Strava-style.' : ''}</p>
      </div>
    </div>
    <div class="trk-go-actions">
      <button class="btn btn-primary" onClick=${() => { beginSession().catch(() => toast('Couldn’t start a session — try again')); }}>
        <${Icon} name="play" size=${16} /> Start session
      </button>
      ${locationOn
        ? html`<span class="tag good">📍 Location on</span>`
        : html`<button class="trk-go-loc" onClick=${() => navigate('/settings')}>📍 Map your spots? Turn on location</button>`}
    </div>
  </div>`;
}

/** Wall-clock time ("2:14 AM"), ticking on its own so the page doesn't have to. */
function NowTime() {
  const t = useNow(1000);
  return html`<span class="num">${formatTime(t)}</span>`;
}

function Elapsed({ since }) {
  const t = useNow(1000);
  const sec = Math.max(0, Math.floor((t - since) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return html`<span class="num">${h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${m}:${pad2(ss)}`}</span>`;
}

// ---- category cards ----------------------------------------------------------------

function CatCard({ cat, count, lastTs, onPlus, onMinus, onEdit }) {
  const c = CATEGORY_BY_ID[cat];
  const sub = lastTs ? `last one ${formatTime(lastTs)}` : TAGLINES[cat] || c.unitPlural;
  return html`<div class=${cx('trk-cat', `cat-${cat}`, count > 0 && 'on')}>
    <${CatIcon} cat=${cat} />
    <div class="grow">
      <div class="trk-cat-label truncate">${c.label}</div>
      <div class="trk-cat-sub truncate">${sub}</div>
    </div>
    <${CountStepper} value=${count} name=${c.label} item=${itemLabel(cat, null).toLowerCase()}
      onPlus=${onPlus} onMinus=${onMinus} onEdit=${onEdit} />
  </div>`;
}

function DrinksCard({ total, types, onPlus, onMinus, onEdit }) {
  const pop = usePop(total);
  const std = stdDrinksOf(types, 0);
  return html`<div class=${cx('trk-cat trk-drinks cat-drinks', total > 0 && 'on')}>
    <div class="trk-drinks-head">
      <${CatIcon} cat="drinks" />
      <div class="grow">
        <div class="trk-cat-label">Drinks</div>
        <div class="trk-cat-sub truncate">${total > 0 ? `≈ ${std} standard ${plural(std, 'drink', 'drinks')}` : 'pick your poison'}</div>
      </div>
      <div class=${cx('trk-drinks-total', total === 0 && 'zero')} aria-label=${`${total} ${plural(total, 'drink', 'drinks')}`}>
        <span key=${pop.n} class=${cx('v num', pop.dir)}>${total}</span>
        <span class="unit">${plural(total, 'drink', 'drinks')}</span>
      </div>
    </div>
    <div class="trk-subs">
      ${DRINK_TYPES.map(d => {
        const v = types[d.id] || 0;
        return html`<div key=${d.id} class=${cx('trk-sub', v > 0 && 'on')}>
          <span class="trk-sub-emoji" aria-hidden="true">${d.emoji}</span>
          <span class="grow truncate trk-sub-label">${d.label}</span>
          <${CountStepper} small value=${v} name=${d.label} item=${d.label.toLowerCase()}
            onPlus=${() => onPlus(d.id)} onMinus=${() => onMinus(d.id)} onEdit=${() => onEdit(d.id, v)} />
        </div>`;
      })}
    </div>
  </div>`;
}

/** − [count] + with a tappable count (opens the exact-count sheet) and a pop on change. */
function CountStepper({ value, name, item, onPlus, onMinus, onEdit, small = false }) {
  const pop = usePop(value);
  return html`<div class=${cx('trk-step', small && 'sm')}>
    <button class="trk-btn minus" onClick=${onMinus} disabled=${value <= 0} aria-label=${`Remove one ${item}`}>
      <${Icon} name="minus" size=${18} stroke=${2.6} />
    </button>
    <button class=${cx('trk-count', value === 0 && 'zero')} onClick=${onEdit} aria-label=${`${name}: ${value}. Tap to set an exact number`}>
      <span key=${pop.n} class=${cx('v num', pop.dir)}>${value}</span>
      ${pop.dir === 'bump' && html`<span key=${`f${pop.n}`} class="fly" aria-hidden="true">+${pop.delta}</span>`}
    </button>
    <button class="trk-btn plus" onClick=${onPlus} aria-label=${`Add one ${item}`}>
      <${Icon} name="plus" size=${small ? 18 : 22} stroke=${2.8} />
    </button>
  </div>`;
}

// ---- sheets ----------------------------------------------------------------------------

function openCountSheet(p) {
  openSheet(close => html`<${CountSheet} close=${close} ...${p} />`);
}

function CountSheet({ close, cat, sub, dayKey, current, dayPhrase, at }) {
  const [draft, setDraft] = useState(String(current));
  const n = clampCount(draft);
  const label = cat === 'drinks' ? (DRINK_TYPE_BY_ID[sub] && DRINK_TYPE_BY_ID[sub].label) || 'Drinks' : CATEGORY_BY_ID[cat].label;
  const emoji = itemEmoji(cat, sub);
  const bump = d => setDraft(String(Math.max(0, Math.min(MAX_COUNT, n + d))));

  const save = e => {
    if (e) e.preventDefault();
    if (n !== current) {
      try {
        setCount(dayKey, cat, sub, n, at);
        toast(`${label}: ${n} for ${dayPhrase}`, { emoji });
      } catch (err) {
        toast(err instanceof LockedDayError ? LOCKED_MSG : 'Couldn’t save that — try again');
      }
    }
    close();
  };

  return html`<form class=${cx('pg-track trk-sheet', `cat-${cat}`)} onSubmit=${save}>
    <div class="trk-sheet-head">
      <${CatIcon} cat=${cat} size="lg" emoji=${emoji} />
      <div class="grow">
        <div class="sheet-title">${label}</div>
        <div class="small faint">${formatDayLabel(dayKey)} · set the exact count</div>
      </div>
    </div>
    <div class="trk-big">
      <button type="button" class="trk-big-btn" onClick=${() => bump(-1)} disabled=${n <= 0} aria-label="One less">
        <${Icon} name="minus" size=${26} stroke=${2.6} />
      </button>
      <input class="trk-big-input num" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max=${MAX_COUNT}
        value=${draft} aria-label=${`${label} count`}
        onInput=${e => setDraft(e.currentTarget.value)}
        onFocus=${e => e.currentTarget.select()}
        onBlur=${() => setDraft(String(n))} />
      <button type="button" class="trk-big-btn plus" onClick=${() => bump(1)} disabled=${n >= MAX_COUNT} aria-label="One more">
        <${Icon} name="plus" size=${26} stroke=${2.8} />
      </button>
    </div>
    <div class="trk-sheet-was">${n === current ? `Currently ${current}` : html`${current} → <b>${n}</b>`}</div>
    <div class="stack-8">
      <button type="submit" class="btn btn-primary btn-lg btn-block">${n === current ? 'Done' : 'Save'}</button>
      <button type="button" class="btn btn-ghost btn-block" onClick=${close}>Cancel</button>
    </div>
  </form>`;
}

function openInfoSheet(rollover) {
  const idleH = Math.round(SESSION_IDLE_MS / 3600e3);
  const rules = [
    { k: 'night', emoji: '🌙', title: 'Nights, not dates', body: `Your day runs ${fmtHour(rollover)} → ${fmtHour(rollover)}. That 2 AM beer still counts toward the night before.` },
    { k: 'session', emoji: '🪩', title: 'Sessions keep the night together', body: `Start one when you head out and everything stays on that night until you end it. It auto-ends after ${idleH} h of quiet.` },
    { k: 'lock', emoji: '🔒', title: 'Fix it before the drop', body: 'Edit any day this week. Every week drops Monday 12 PM, then it locks for good.' },
    { k: 'hush', emoji: '🤫', title: 'Zero live status', body: 'Nobody sees a thing until the drop. Friends get your totals, spot names and a rough area map — never pins or your route.' },
  ];
  openSheet(close => html`<div class="pg-track trk-sheet">
    <div class="sheet-title">How Tab counts</div>
    <div class="trk-rules">
      ${rules.map(r => html`<div key=${r.k} class="trk-rule">
        <span class="trk-rule-emoji" aria-hidden="true">${r.emoji}</span>
        <div class="grow"><div class="bold">${r.title}</div><div class="small muted">${r.body}</div></div>
      </div>`)}
    </div>
    <div class="stack-8">
      <button class="btn btn-primary btn-lg btn-block" onClick=${close}>Got it</button>
      <button class="btn btn-ghost btn-block" onClick=${() => { close(); navigate('/settings'); }}>Change when my day resets</button>
    </div>
  </div>`);
}
