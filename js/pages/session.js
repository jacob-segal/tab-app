// Live session ("Strava for your night out") and the session recap.

import { html, useState, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import {
  Icon, CatIcon, MapView, PageHeader, EmptyState, toast, openSheet, confirmSheet,
} from '../ui.js';
import { CATEGORIES, DRINK_TYPES, CATEGORY_BY_ID } from '../config.js';
import {
  tabDayKey, weekdayLong, formatTime, formatDuration, formatDayLabel, isDayEditable, weekKeyOf,
} from '../time.js';
import { routeLengthM, formatDistance, clusterPins } from '../geomath.js';
import { totalsOf, stdDrinksOf, spendOf } from '../stats.js';
import { activeSession, sessionById, sessionLogs } from '../data.js';
import {
  updateSettings, deleteLog, discardSession, renameSession, upsertSpot, LockedDayError,
} from '../store.js';
import { quickLog, beginSession, finishSession, itemLabel, itemEmoji } from '../actions.js';
import { requestLocationPermission, geoSupported, isTrackingRoute } from '../geo.js';
import { navigate, back } from '../router.js';

const pad = n => String(n).padStart(2, '0');
function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}
const nightName = dayKey => `${weekdayLong(dayKey)} night`;
const pinsOf = logs => logs.filter(l => l.loc).map(l => ({ lat: l.loc.lat, lng: l.loc.lng, cat: l.cat, sub: l.sub }));

// ---- live -----------------------------------------------------------------------

export function LiveSessionPage() {
  const s = useStore();
  const t = useNow(1000);
  const [asking, setAsking] = useState(false);
  const ses = activeSession();
  const logs = ses ? sessionLogs(ses.id) : [];
  const counts = totalsOf(logs);
  const locOn = s.settings.locationEnabled;

  async function turnOnLocation() {
    if (!geoSupported()) { toast('Location needs HTTPS or localhost in this browser', { emoji: '🤷' }); return; }
    setAsking(true);
    const ok = await requestLocationPermission();
    setAsking(false);
    if (ok) { updateSettings({ locationEnabled: true }); toast('Location on — pins + route are live', { emoji: '📍' }); }
    else toast('Location was blocked — allow it in your browser settings', { emoji: '🚫' });
  }

  const close = () => back('/track');

  if (!ses) {
    const day = tabDayKey(t, s.settings.rolloverHour);
    return html`<div class="page no-tabbar pg-session">
      <div class="ss-top"><button class="icon-btn" onClick=${close} aria-label="Close"><${Icon} name="x" /></button></div>
      <div class="ss-start">
        <div class="ss-start-emoji">🌙</div>
        <div class="h1">Strava for your<br /><span class="grad-text">night out.</span></div>
        <p class="muted mt-12">Start a session when you head out. Everything you log counts toward <b>${nightName(day)}</b>, even if you’re still going at sunrise.</p>
        <div class="stack-8 mt-16">
          <div class="ss-point"><span>⏱️</span><span class="small">Live timer and a tally of just this session</span></div>
          <div class="ss-point"><span>📍</span><span class="small">With location on, each log drops a pin and your route gets drawn</span></div>
          <div class="ss-point"><span>🗺️</span><span class="small">Get a recap map of every stop when you end it</span></div>
        </div>
        <div class="card mt-16 row gap-12">
          <span class="cat-icon sm" style="--cat: ${locOn ? 'var(--good)' : 'var(--text-3)'}">📍</span>
          <div class="grow"><div class="bold small">Location ${locOn ? 'on' : 'off'}</div><div class="tiny faint">${locOn ? 'Pins + route will be recorded' : 'Optional — the session works without it'}</div></div>
          ${!locOn && html`<button class="btn btn-sm btn-outline" disabled=${asking} onClick=${turnOnLocation}>${asking ? '…' : 'Turn on'}</button>`}
        </div>
      </div>
      <div class="ss-cta"><button class="btn btn-primary btn-lg btn-block" onClick=${() => beginSession()}><${Icon} name="play" size=${18} /> Start session</button></div>
    </div>`;
  }

  const pins = pinsOf(logs);
  const recent = [...logs].reverse().slice(0, 5);
  const tracking = locOn && s.settings.trackRoute;

  function logDrink() {
    openSheet(closeSheet => html`<div class="ss-sheet">
      <div class="sheet-title">What are we drinking?</div>
      <div class="ss-drinks mt-12">
        ${DRINK_TYPES.map(d => html`<button key=${d.id} class="ss-drink cat-drinks" onClick=${() => { quickLog('drinks', d.id); closeSheet(); toast(`${d.emoji} ${d.label} logged`, { duration: 1600 }); }}>
          <span class="ss-drink-e">${d.emoji}</span><span class="bold">${d.label}</span>
        </button>`)}
      </div>
    </div>`);
  }

  function log(cat) {
    if (cat === 'drinks') return logDrink();
    const l = quickLog(cat, null);
    if (l) toast(`${CATEGORY_BY_ID[cat].emoji} ${itemLabel(cat)} logged`, { duration: 1600 });
  }

  function undo(l) {
    try { deleteLog(l.id); toast('Removed', { emoji: '↩️', duration: 1600 }); }
    catch (e) { toast(e instanceof LockedDayError ? 'That week already dropped — it’s locked 🔒' : 'Couldn’t remove that'); }
  }

  async function end() {
    const ok = await confirmSheet({ title: 'End session?', body: `${logs.length} thing${logs.length === 1 ? '' : 's'} logged over ${formatDuration(t - ses.start)}. You can still edit the day on the tracker.`, confirmLabel: 'End session' });
    if (ok) finishSession();
  }

  function more() {
    openSheet(c => html`<div class="stack-8">
      <div class="sheet-title">Session</div>
      <button class="btn btn-block btn-outline" onClick=${() => { c(); navigate('/track'); }}><${Icon} name="edit" size=${18} /> Open tracker</button>
      <button class="btn btn-block btn-danger" onClick=${async () => {
        c();
        const ok = await confirmSheet({ title: 'Discard this session?', body: 'This deletes the session and everything logged in it.', confirmLabel: 'Discard', danger: true });
        if (!ok) return;
        try { discardSession(ses.id); toast('Session discarded', { emoji: '🗑️' }); navigate('/track', { replace: true }); }
        catch { toast('That week already dropped — it’s locked 🔒'); }
      }}><${Icon} name="trash" size=${18} /> Discard session</button>
    </div>`);
  }

  return html`<div class="page no-tabbar pg-session live">
    <div class="ss-top">
      <button class="icon-btn" onClick=${close} aria-label="Minimize"><${Icon} name="chevron-down" /></button>
      <div class="ss-live-chip"><span class="live-dot"></span> LIVE</div>
      <button class="icon-btn" onClick=${more} aria-label="More"><${Icon} name="more" /></button>
    </div>

    <div class="ss-stage">
      ${locOn
        ? html`<${MapView} className="tall" follow=${true} route=${ses.route} pins=${pins} center=${ses.route[0] || null} />`
        : html`<div class="ss-nomap"><span>🌃</span><div class="small muted">Location’s off — no map tonight.</div>
            <button class="btn btn-sm btn-outline mt-8" disabled=${asking} onClick=${turnOnLocation}>Turn on location</button></div>`}
      <div class="ss-timer-card">
        <div class="ss-timer num">${clock(t - ses.start)}</div>
        <div class="small muted">Counts toward <b class="grad-text">${nightName(ses.dayKey)}</b></div>
        ${locOn && html`<div class="ss-gps tiny">${tracking
          ? (ses.route.length ? html`<span class="ss-gps-dot on"></span> ${ses.route.length} GPS point${ses.route.length === 1 ? '' : 's'} · ${formatDistance(routeLengthM(ses.route))}` : html`<span class="ss-gps-dot"></span> Waiting for GPS…`)
          : html`<span class="ss-gps-dot"></span> Pins only (route off)`}${tracking && !isTrackingRoute() ? ' · paused' : ''}</div>`}
      </div>
    </div>

    <div class="ss-grid">
      ${CATEGORIES.map(c => html`<button key=${c.id} class=${cx('ss-log', `cat-${c.id}`, counts.totals[c.id] > 0 && 'has')} onClick=${() => log(c.id)}>
        <span class="cat-icon lg">${c.emoji}</span>
        <span class="bold small">${c.label}</span>
        ${counts.totals[c.id] > 0 && html`<span class="ss-count num">${counts.totals[c.id]}</span>`}
      </button>`)}
    </div>

    <div class="card mt-16">
      <div class="spread"><span class="section-title">This session</span><span class="small faint">${logs.length} logged</span></div>
      ${recent.length === 0
        ? html`<p class="small muted mt-8">Nothing yet. Tap a button above when the first one goes down 🍻</p>`
        : html`<div class="list mt-4">${recent.map(l => html`<div class="list-item" key=${l.id}>
            <span class="ss-emoji">${itemEmoji(l.cat, l.sub)}</span>
            <div class="grow"><div class="primary small">${itemLabel(l.cat, l.sub)}</div><div class="secondary">${formatTime(l.ts)}${l.loc ? ' · 📍' : ''}</div></div>
            <button class="icon-btn sm" onClick=${() => undo(l)} aria-label="Undo"><${Icon} name="x" size=${16} /></button>
          </div>`)}</div>`}
    </div>

    <p class="tiny faint center mt-16">Friends see none of this until Monday’s drop 🤫</p>
    <div class="ss-cta"><button class="btn btn-white btn-lg btn-block" onClick=${end}><${Icon} name="stop" size=${16} /> End session</button></div>
  </div>`;
}

// ---- recap -----------------------------------------------------------------------

export function SessionRecapPage({ params }) {
  const s = useStore();
  const t = useNow(30000);
  const ses = sessionById(params.id);

  if (!ses) {
    return html`<div class="page pg-recap"><${PageHeader} title="Session" back="/you" />
      <${EmptyState} emoji="🫥" title="Session not found" body="It may have been discarded." action=${html`<button class="btn btn-primary" onClick=${() => navigate('/you?tab=sessions', { replace: true })}>See your sessions</button>`} /></div>`;
  }
  if (!ses.end) {
    return html`<div class="page pg-recap"><${PageHeader} title="Session" back="/you" />
      <${EmptyState} emoji="🔴" title="This session is still live" body="End it to see the recap." action=${html`<button class="btn btn-primary" onClick=${() => navigate('/session')}>Open live session</button>`} /></div>`;
  }

  const logs = sessionLogs(ses.id);
  const tot = totalsOf(logs);
  const std = stdDrinksOf(tot.drinkTypes, tot.totals.shots);
  const spend = spendOf(tot.totals, tot.drinkTypes, s.settings.prices);
  const pins = pinsOf(logs);
  const stops = clusterPins(pins, s.spots);
  const dist = routeLengthM(ses.route);
  const title = ses.name || `${nightName(ses.dayKey)} out`;
  const editable = isDayEditable(ses.dayKey, t, s.settings.rolloverHour);
  const hasMap = pins.length > 0 || ses.route.length > 1;
  const cats = CATEGORIES.filter(c => tot.totals[c.id] > 0);

  function rename() {
    let val = ses.name || '';
    openSheet(c => html`<div class="stack-12">
      <div class="sheet-title">Name this session</div>
      <input class="input" maxLength="40" placeholder=${`${nightName(ses.dayKey)} out`} value=${val} onInput=${e => { val = e.currentTarget.value; }} autofocus />
      <button class="btn btn-primary btn-block" onClick=${() => { renameSession(ses.id, val); c(); toast('Renamed', { emoji: '✏️' }); }}>Save</button>
    </div>`);
  }

  function nameStop(stop) {
    let val = stop.spotId ? stop.name : '';
    openSheet(c => html`<div class="stack-12">
      <div class="sheet-title">Name this spot</div>
      <p class="small muted">Friends see the name and a rough ~400 m area — never the exact spot.</p>
      <input class="input" maxLength="32" placeholder="e.g. Jordan’s place" value=${val} onInput=${e => { val = e.currentTarget.value; }} autofocus />
      <button class="btn btn-primary btn-block" onClick=${() => {
        if (!val.trim()) { toast('Give it a name first'); return; }
        upsertSpot({ id: stop.spotId || undefined, name: val, lat: stop.lat, lng: stop.lng }); c(); toast('Spot saved', { emoji: '📍' });
      }}>Save spot</button>
    </div>`);
  }

  async function del() {
    const ok = await confirmSheet({ title: 'Delete this session?', body: 'This removes the session and everything logged in it.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { discardSession(ses.id); toast('Session deleted', { emoji: '🗑️' }); navigate('/you?tab=sessions', { replace: true }); }
    catch { toast('That week already dropped — it’s locked 🔒'); }
  }

  const stopFor = l => (l.loc ? stops.find(st => Math.hypot(st.lat - l.loc.lat, st.lng - l.loc.lng) < 0.0012) : null);

  return html`<div class="page pg-recap">
    <${PageHeader} title=${title} subtitle=${formatDayLabel(ses.dayKey)} back="/you"
      right=${html`<button class="icon-btn" onClick=${rename} aria-label="Rename"><${Icon} name="edit" size=${18} /></button>`} />

    <div class="card-hero sr-hero">
      <div class="tiny sr-eyebrow">SESSION RECAP</div>
      <div class="h2 mt-4">${title}</div>
      <div class="small muted mt-4">${formatTime(ses.start)} – ${formatTime(ses.end)}</div>
      <div class="sr-stats">
        <div><b class="num">${formatDuration(ses.end - ses.start)}</b><span>time out</span></div>
        <div><b class="num">${tot.total}</b><span>logged</span></div>
        <div><b class="num">${dist > 0 ? formatDistance(dist) : '—'}</b><span>distance</span></div>
        <div><b class="num">${stops.length || '—'}</b><span>stops</span></div>
      </div>
    </div>

    <div class="mt-16">
      ${hasMap
        ? html`<${MapView} className="tall" route=${ses.route} pins=${pins} spots=${stops} />`
        : html`<div class="sr-nomap card center"><div style="font-size:32px">🗺️</div><div class="small muted mt-8">No map — location was off for this one.</div></div>`}
    </div>

    <div class="section">
      <div class="section-head"><h2 class="section-title">The damage</h2><span class="small faint">~${std} std drinks · ≈ $${spend}</span></div>
      ${cats.length === 0
        ? html`<div class="card small muted">Nothing logged. A quiet one 😇</div>`
        : html`<div class="sr-cats">${cats.map(c => html`<div key=${c.id} class=${cx('sr-cat', `cat-${c.id}`)}>
            <span class="cat-icon">${c.emoji}</span><div><b class="num">${tot.totals[c.id]}</b><span>${tot.totals[c.id] === 1 ? c.unit : c.unitPlural}</span></div>
          </div>`)}</div>`}
      ${tot.totals.drinks > 0 && html`<div class="row wrap gap-6 mt-12">${DRINK_TYPES.filter(d => tot.drinkTypes[d.id] > 0).map(d => html`<span key=${d.id} class="chip sm">${d.emoji} ${tot.drinkTypes[d.id]} ${d.label.toLowerCase()}</span>`)}</div>`}
    </div>

    ${stops.length > 0 && html`<div class="section">
      <div class="section-head"><h2 class="section-title">Stops</h2><span class="small faint">tap to name</span></div>
      <div class="card flush">${stops.map((st, i) => html`<button key=${i} class="sr-stop" onClick=${() => nameStop(st)}>
        <span class="sr-stop-n">${i + 1}</span>
        <div class="grow"><div class="bold">${st.name}</div><div class="tiny faint">${st.count} logged here</div></div>
        <${Icon} name="edit" size=${16} />
      </button>`)}</div>
    </div>`}

    <div class="section">
      <div class="section-head"><h2 class="section-title">Timeline</h2></div>
      <div class="card sr-timeline">
        ${logs.length === 0 && html`<div class="small muted">Nothing logged.</div>`}
        ${logs.map(l => {
          const st = stopFor(l);
          return html`<div class="sr-tl" key=${l.id}>
            <span class="sr-tl-time num">${formatTime(l.ts)}</span>
            <span class=${cx('sr-tl-dot', `cat-${l.cat}`)}></span>
            <span class="grow small">${itemEmoji(l.cat, l.sub)} ${itemLabel(l.cat, l.sub)}</span>
            ${st && html`<span class="tiny faint truncate" style="max-width:110px">📍 ${st.name}</span>`}
          </div>`;
        })}
      </div>
    </div>

    <div class="section">
      ${editable
        ? html`<button class="btn btn-danger btn-block" onClick=${del}><${Icon} name="trash" size=${18} /> Delete session</button>`
        : html`<div class="lock-note"><${Icon} name="lock" size=${16} /> Locked — this week already dropped. <button class="section-link" onClick=${() => navigate(`/drop/${weekKeyOf(ses.dayKey)}`)}>See drop</button></div>`}
    </div>
  </div>`;
}
