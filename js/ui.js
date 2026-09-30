// Shared UI components. Import what you need:
//   import { Icon, Avatar, PageHeader, Stepper, toast, openSheet, ... } from '../ui.js';

import { html, render, useState, useEffect, useRef, useMemo, cx } from './lib.js';
import { CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS } from './config.js';
import { countdownParts, weekdayShort, formatWeekRange, weekLabel } from './time.js';
import { boundsOf } from './geomath.js';
import { useNow } from './hooks.js';
import { back as routerBack, navigate } from './router.js';

// ---- icons -------------------------------------------------------------------
// Feather-style 24px stroke icons.
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  play: 'M5 3l14 9-14 9V3z',
  stop: 'M6 6h12v12H6z',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  navigation: 'M3 11l19-9-9 19-2-8-8-2z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2',
  chart: 'M18 20V10M12 20V4M6 20v-6',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14h1M14 20h1M17 17h4v4h-4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
};

/** <Icon name="home" size=22 /> */
export function Icon({ name, size = 22, stroke = 2, className = '', style = '' }) {
  const d = ICONS[name] || ICONS.info;
  const fill = name === 'play' || name === 'stop' ? 'currentColor' : 'none';
  return html`<svg class=${className} style=${style} width=${size} height=${size} viewBox="0 0 24 24" fill=${fill}
    stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d=${d} />
  </svg>`;
}

// ---- avatars & category icons --------------------------------------------------------

/** <Avatar user=${user} size="md" ring /> — user: {avatar:{emoji,hue}, name} */
export function Avatar({ user, size = 'md', ring = false, onClick }) {
  const a = (user && user.avatar) || { emoji: '🙂', hue: 250 };
  return html`<span class=${cx('avatar', size, ring && 'ring')} style=${`--hue:${a.hue}`} onClick=${onClick}
    role=${onClick ? 'button' : undefined} aria-label=${user ? user.name : 'avatar'}>${a.emoji}</span>`;
}

export function AvatarStack({ users, max = 4, size = 'sm' }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return html`<span class="avatar-stack">
    ${shown.map(u => html`<${Avatar} user=${u} size=${size} />`)}
    ${extra > 0 && html`<span class=${cx('avatar', size)} style="--hue:240; filter:saturate(0)"><span style="font-size:11px;font-weight:800">+${extra}</span></span>`}
  </span>`;
}

/** Rounded tinted emoji tile for a category. size: 'sm' | '' | 'lg' */
export function CatIcon({ cat, size = '', emoji }) {
  const c = CATEGORY_BY_ID[cat];
  return html`<span class=${cx('cat-icon', size, `cat-${cat}`)}>${emoji || (c && c.emoji)}</span>`;
}

// ---- layout ---------------------------------------------------------------------------

/**
 * Sticky page header.
 * @param {{title, subtitle?, back?: string|boolean, right?, big?: boolean}} p
 *   back: true => router back (fallback '/'), string => fallback path
 */
export function PageHeader({ title, subtitle, back, right, big = false }) {
  const onBack = () => routerBack(typeof back === 'string' ? back : '/');
  return html`<header class="page-header">
    ${back && html`<button class="icon-btn" onClick=${onBack} aria-label="Back"><${Icon} name="chevron-left" /></button>`}
    <div class="grow">
      <div class=${cx('title', big && 'big')}>${title}</div>
      ${subtitle && html`<div class="subtitle">${subtitle}</div>`}
    </div>
    ${right}
  </header>`;
}

/** Section with a small uppercase title and optional action link. */
export function Section({ title, action, onAction, children, className = '' }) {
  return html`<section class=${cx('section', className)}>
    ${(title || action) && html`<div class="section-head">
      <h2 class="section-title">${title}</h2>
      ${action && html`<button class="section-link" onClick=${onAction}>${action}</button>`}
    </div>`}
    ${children}
  </section>`;
}

export function EmptyState({ emoji = '🫙', title, body, action }) {
  return html`<div class="empty">
    <div class="emoji">${emoji}</div>
    ${title && html`<div class="h3">${title}</div>`}
    ${body && html`<p class="small muted">${body}</p>`}
    ${action && html`<div class="mt-16">${action}</div>`}
  </div>`;
}

// ---- controls ---------------------------------------------------------------------------

/** − count + */
export function Stepper({ value, onMinus, onPlus, cat, size = '', disabled = false, label = '' }) {
  return html`<div class=${cx('stepper', size, cat && `cat-${cat}`)}>
    <button onClick=${onMinus} disabled=${disabled || value <= 0} aria-label=${`Remove ${label}`}><${Icon} name="minus" size=${18} stroke=${2.6} /></button>
    <span class="count" aria-live="polite">${value}</span>
    <button class="plus" onClick=${onPlus} disabled=${disabled} aria-label=${`Add ${label}`}><${Icon} name="plus" size=${18} stroke=${2.6} /></button>
  </div>`;
}

/** options: [{value, label}] */
export function Segmented({ options, value, onChange }) {
  return html`<div class="segmented" role="tablist">
    ${options.map(o => html`<button role="tab" aria-selected=${o.value === value} class=${cx(o.value === value && 'active')} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Switch({ checked, onChange, label }) {
  return html`<label class="switch" aria-label=${label}>
    <input type="checkbox" checked=${checked} onChange=${e => onChange(e.currentTarget.checked)} />
    <span></span>
  </label>`;
}

/** Progress bar. value/max, optional category color. */
export function Bar({ value, max, cat, thick = false }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  return html`<div class=${cx('bar', thick && 'thick', cat && `cat-${cat}`)}><i style=${`width:${pct}%`}></i></div>`;
}

/** "+3" / "−2" colored text. More consumption = .up (red-ish), less = .down. */
export function Delta({ delta, suffix = '', neutral = false }) {
  if (delta === null || delta === undefined) return html`<span class="delta faint">new</span>`;
  if (delta === 0) return html`<span class="delta faint">same</span>`;
  const up = delta > 0;
  return html`<span class=${cx('delta', !neutral && (up ? 'up' : 'down'))}>${up ? '▲' : '▼'} ${Math.abs(delta)}${suffix}</span>`;
}

// ---- countdown ---------------------------------------------------------------------------

/** Live d/h/m/s countdown boxes to targetTs. */
export function Countdown({ targetTs, compact = false }) {
  const t = useNow(1000);
  const p = countdownParts(targetTs - t);
  if (compact) {
    const s = p.days > 0 ? `${p.days}d ${p.hours}h ${p.minutes}m` : `${p.hours}h ${String(p.minutes).padStart(2, '0')}m ${String(p.seconds).padStart(2, '0')}s`;
    return html`<span class="num bold">${s}</span>`;
  }
  const units = [['days', p.days], ['hrs', p.hours], ['min', p.minutes], ['sec', p.seconds]];
  return html`<div class="countdown" role="timer" aria-label="Time until next drop">
    ${units.map(([k, v]) => html`<div class="unit"><b>${String(v).padStart(2, '0')}</b><span>${k}</span></div>`)}
  </div>`;
}

// ---- toasts ---------------------------------------------------------------------------

let toastSeq = 0;
const toastListeners = new Set();
let toasts = [];
const emitToasts = () => toastListeners.forEach(fn => fn(toasts));

/**
 * toast('Saved', { emoji:'✅', action:{label:'Undo', onClick}, duration: 3000 })
 */
export function toast(message, { emoji, action, duration = 3200 } = {}) {
  const id = ++toastSeq;
  toasts = [...toasts, { id, message, emoji, action }].slice(-3);
  emitToasts();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emitToasts(); }, duration);
  return id;
}

export function ToastHost() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastListeners.add(setList); return () => toastListeners.delete(setList); }, []);
  const dismiss = id => { toasts = toasts.filter(t => t.id !== id); emitToasts(); };
  return html`<div class="toast-host" aria-live="polite">
    ${list.map(t => html`<div class="toast" key=${t.id}>
      ${t.emoji && html`<span>${t.emoji}</span>`}
      <span>${t.message}</span>
      ${t.action && html`<button class="toast-action" onClick=${() => { t.action.onClick(); dismiss(t.id); }}>${t.action.label}</button>`}
    </div>`)}
  </div>`;
}

// ---- sheets ---------------------------------------------------------------------------

let sheetListeners = new Set();
let sheetStack = [];
const emitSheets = () => sheetListeners.forEach(fn => fn(sheetStack));

/**
 * Open a bottom sheet. `content` is a function (close) => vnode.
 * @returns {() => void} close
 */
export function openSheet(content, { title, onClose } = {}) {
  const id = ++toastSeq;
  const close = () => {
    if (!sheetStack.some(s => s.id === id)) return;
    sheetStack = sheetStack.filter(s => s.id !== id); emitSheets();
    onClose && onClose();
  };
  sheetStack = [...sheetStack, { id, content, title, close }];
  emitSheets();
  return close;
}

/** Promise<boolean> confirm dialog as a sheet. */
export function confirmSheet({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    const close = openSheet(c => html`<div class="stack-16">
      <div>
        <div class="sheet-title">${title}</div>
        ${body && html`<p class="muted small mt-8">${body}</p>`}
      </div>
      <div class="stack-8">
        <button class=${cx('btn btn-block btn-lg', danger ? 'btn-danger' : 'btn-primary')} onClick=${() => { done(true); c(); }}>${confirmLabel}</button>
        <button class="btn btn-block btn-ghost" onClick=${() => { done(false); c(); }}>${cancelLabel}</button>
      </div>
    </div>`, { onClose: () => done(false) });
    void close;
  });
}

export function SheetHost() {
  const [stack, setStack] = useState(sheetStack);
  useEffect(() => { sheetListeners.add(setStack); return () => sheetListeners.delete(setStack); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return stack.map(s => html`<div class="sheet-backdrop" key=${s.id} onClick=${e => { if (e.target === e.currentTarget) s.close(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${s.title || 'Dialog'}>
      <div class="sheet-handle"></div>
      ${s.title && html`<div class="sheet-title" style="margin-bottom:12px">${s.title}</div>`}
      ${s.content(s.close)}
    </div>
  </div>`);
}

// ---- people rows ---------------------------------------------------------------------------

/** Avatar + name + subtitle + trailing content. */
export function UserRow({ user, subtitle, right, onClick, highlight = false, rank }) {
  return html`<div class=${cx('list-item', onClick && 'clickable', highlight && 'me-row')} onClick=${onClick}>
    ${rank !== undefined && html`<span class=${cx('rank', rank <= 3 && `r${rank}`)}>${rank}</span>`}
    <${Avatar} user=${user} size="md" />
    <div class="grow">
      <div class="primary truncate">${user.isMe ? 'You' : user.name}</div>
      ${subtitle && html`<div class="secondary truncate">${subtitle}</div>`}
    </div>
    ${right}
  </div>`;
}

// ---- metrics -----------------------------------------------------------------------------

/** Metrics usable with leaderboard() / compareWeek().boards */
export const METRICS = [
  { id: 'score', label: 'Tab Score', short: 'Score', emoji: '👑' },
  ...CATEGORIES.map(c => ({ id: c.id, label: c.label, short: c.label, emoji: c.emoji, cat: c.id })),
  { id: 'stdDrinks', label: 'Standard drinks', short: 'Std drinks', emoji: '🧪' },
  { id: 'spend', label: 'Est. spent', short: '$ spent', emoji: '💸' },
];
export const METRIC_BY_ID = Object.fromEntries(METRICS.map(m => [m.id, m]));

export function formatMetric(metric, value) {
  if (metric === 'spend') return `$${Math.round(value)}`;
  if (metric === 'score' || metric === 'stdDrinks') return `${Math.round(value * 10) / 10}`;
  return `${value}`;
}

/** Horizontal metric chips (score + categories + ...). */
export function MetricPicker({ value, onChange, metrics = METRICS }) {
  return html`<div class="hscroll">
    ${metrics.map(m => html`<button class=${cx('chip', value === m.id && 'active')} onClick=${() => onChange(m.id)}>${m.emoji} ${m.short}</button>`)}
  </div>`;
}

/**
 * Leaderboard rows with bars.
 * @param {{board: Array<{userId,value,rank}>, metric, getUser:(id)=>user, meId?, limit?, onSelect?}} p
 */
export function Leaderboard({ board, metric, getUser, meId = 'me', limit, onSelect }) {
  const rows = limit ? board.slice(0, limit) : board;
  const max = Math.max(1, ...board.map(r => r.value));
  const cat = CATEGORY_IDS.includes(metric) ? metric : null;
  if (!board.length) return html`<${EmptyState} emoji="📭" title="No data yet" body="Nobody here has a drop for this week." />`;
  return html`<div class="list">
    ${rows.map(r => {
      const u = getUser(r.userId);
      if (!u) return null;
      return html`<div class=${cx('list-item', onSelect && 'clickable', r.userId === meId && 'me-row')} onClick=${onSelect ? () => onSelect(r.userId) : undefined}>
        <span class=${cx('rank', r.rank <= 3 && `r${r.rank}`)}>${r.rank}</span>
        <${Avatar} user=${u} size="sm" />
        <div class="grow">
          <div class="spread"><span class="primary truncate">${u.isMe ? 'You' : u.name.split(' ')[0]}</span><span class="bold num">${formatMetric(metric, r.value)}</span></div>
          <div class="mt-4"><${Bar} value=${r.value} max=${max} cat=${cat} /></div>
        </div>
      </div>`;
    })}
  </div>`;
}

/** An award tile. award: {emoji,title,blurb,winnerIds,valueLabel} */
export function AwardCard({ award, getUser, highlightId = 'me' }) {
  const winners = award.winnerIds.map(getUser).filter(Boolean);
  const mine = award.winnerIds.includes(highlightId);
  return html`<div class=${cx('card tight', mine && 'card-grad')} style="min-width:0">
    <div class="spread"><span style="font-size:28px">${award.emoji}</span>${mine && html`<span class="tag brand">YOU</span>`}</div>
    <div class="bold mt-8">${award.title}</div>
    <div class="tiny faint">${award.blurb}</div>
    <div class="row gap-6 mt-8">
      <${AvatarStack} users=${winners} max=${3} size="xs" />
      <span class="small truncate">${winners.map(w => (w.isMe ? 'You' : w.name.split(' ')[0])).join(', ')}</span>
    </div>
    <div class="tiny muted mt-4">${award.valueLabel}</div>
  </div>`;
}

// ---- week helpers ---------------------------------------------------------------------------

/** Horizontal chip list of weeks. weeks: weekKey[] newest first. */
export function WeekPicker({ weeks, value, onChange }) {
  return html`<div class="hscroll">
    ${weeks.map(w => html`<button class=${cx('chip', value === w && 'active')} onClick=${() => onChange(w)}>${formatWeekRange(w)}</button>`)}
  </div>`;
}

export const weekTitle = w => `${weekLabel(w)} · ${formatWeekRange(w)}`;

/**
 * Stacked 7-day bar chart. byDay: WeekStats.byDay.
 * metric: 'score' (stack by category weight) or a category id.
 */
export function DayBars({ byDay, highlightDayKey }) {
  const max = Math.max(1, ...byDay.map(d => d.total));
  return html`<div class="daybars">
    ${byDay.map(d => html`<div class=${cx('col', d.dayKey === highlightDayKey && 'hot')}>
      <span class="tiny faint num">${d.total || ''}</span>
      <div class="stackbar" style=${`height:${Math.max(4, (d.total / max) * 86)}%`}>
        ${CATEGORY_IDS.filter(c => d.totals[c] > 0).map(c => html`<i class=${`cat-${c}`} style=${`height:${(d.totals[c] / Math.max(1, d.total)) * 100}%; background: var(--cat)`}></i>`)}
      </div>
      <span class="lbl">${weekdayShort(d.dayKey).slice(0, 2)}</span>
    </div>`)}
  </div>`;
}

/** Legend of categories. */
export function CatLegend({ cats = CATEGORY_IDS }) {
  return html`<div class="row wrap gap-12">
    ${cats.map(c => html`<span class=${cx('row gap-6 tiny muted', `cat-${c}`)}><span class="cat-dot"></span>${CATEGORY_BY_ID[c].label}</span>`)}
  </div>`;
}

// ---- maps -----------------------------------------------------------------------------------

let leafletPromise = null;
/** Lazily load Leaflet (JS + CSS) from unpkg. Resolves window.L. */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('Map failed to load')); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

/**
 * Dark Leaflet map with an optional route line, category pins and spot labels.
 * @param {{
 *   route?: Array<{lat,lng}>,
 *   pins?: Array<{lat,lng,cat,sub?}>,
 *   spots?: Array<{lat,lng,name,count}>,
 *   areas?: Array<{lat,lng,name,count,radiusM}>,  // rough circles (friends' maps)
 *   center?: {lat,lng}, zoom?: number,
 *   className?: string,      // e.g. 'tall' | 'full'
 *   follow?: boolean,        // keep the last route point in view (live session)
 *   interactive?: boolean,
 * }} p
 */
export function MapView({ route = [], pins = [], spots = [], areas = [], center, zoom = 15, className = '', follow = false, interactive = true }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fitted = useRef(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !el.current || mapRef.current) return;
      const map = L.map(el.current, {
        zoomControl: false, attributionControl: true,
        dragging: interactive, scrollWheelZoom: false, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: false,
      });
      // Esri Dark Gray Canvas (no API key needed): base + labels.
      const esri = name => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;
      L.tileLayer(esri('World_Dark_Gray_Base'), { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }).addTo(map);
      L.tileLayer(esri('World_Dark_Gray_Reference'), { maxZoom: 19, maxNativeZoom: 16 }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      draw();
    }).catch(e => !cancelled && setErr(e.message));
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  function draw() {
    const L = window.L, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (route.length > 1) {
      L.polyline(route.map(p => [p.lat, p.lng]), { color: '#ec4899', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
      L.polyline(route.map(p => [p.lat, p.lng]), { color: '#fff', weight: 1.5, opacity: 0.5 }).addTo(layer);
    }
    if (route.length) {
      const last = route[route.length - 1];
      L.circleMarker([last.lat, last.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#ec4899', fillOpacity: 1 }).addTo(layer);
    }
    for (const p of pins) {
      const c = CATEGORY_BY_ID[p.cat];
      const icon = L.divIcon({ className: '', html: `<div class="map-pin cat-${p.cat}"><span>${(c && c.emoji) || '📍'}</span></div>`, iconSize: [28, 28], iconAnchor: [4, 26] });
      L.marker([p.lat, p.lng], { icon, keyboard: false }).addTo(layer);
    }
    for (const s of spots) {
      if (typeof s.lat !== 'number') continue;
      const icon = L.divIcon({ className: '', html: `<div class="map-spot">${escapeHtml(s.name)}${s.count ? ` · ${s.count}` : ''}</div>`, iconSize: null, iconAnchor: [0, -6] });
      L.marker([s.lat, s.lng], { icon, keyboard: false, interactive: false }).addTo(layer);
    }
    for (const a of areas) {
      L.circle([a.lat, a.lng], { radius: a.radiusM || 450, color: '#ec4899', weight: 1, opacity: 0.6, fillColor: '#8b5cf6', fillOpacity: 0.28, interactive: false }).addTo(layer);
      const icon = L.divIcon({ className: '', html: `<div class="map-spot map-area">${escapeHtml(a.name)}${a.count ? ` · ${a.count}` : ''}</div>`, iconSize: null, iconAnchor: [0, 0] });
      L.marker([a.lat, a.lng], { icon, keyboard: false, interactive: false }).addTo(layer);
    }
    const all = [...route, ...pins, ...spots.filter(s => typeof s.lat === 'number'), ...areas];
    const maxZoom = areas.length && !pins.length && !route.length ? 14 : 16; // rough maps stay zoomed out
    if (follow && route.length) {
      const last = route[route.length - 1];
      map.setView([last.lat, last.lng], fitted.current ? map.getZoom() : 16);
      fitted.current = true;
    } else if (!fitted.current || !interactive) {
      const b = boundsOf(all);
      if (b && all.length > 1) map.fitBounds(b, { padding: [36, 36], maxZoom });
      else if (all.length === 1) map.setView([all[0].lat, all[0].lng], Math.min(maxZoom, 16));
      else if (center) map.setView([center.lat, center.lng], zoom);
      fitted.current = all.length > 0;
    }
  }

  // redraw when data changes
  const sig = useMemo(() => JSON.stringify([route.length, route[route.length - 1], pins.length, pins[pins.length - 1], spots.length, areas.length]), [route, pins, spots, areas]);
  useEffect(() => { draw(); }, [sig]);

  if (err) return html`<div class=${cx('map', className)} style="display:flex;align-items:center;justify-content:center"><span class="small faint">Map unavailable offline</span></div>`;
  return html`<div class=${cx('map', className)} ref=${el}></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---- misc -----------------------------------------------------------------------------------

/** Link-like wrapper: <Link to="/friends">...</Link> */
export function Link({ to, className = '', children, replace = false }) {
  return html`<a href=${'#' + to} class=${className} onClick=${e => { e.preventDefault(); navigate(to, { replace }); }}>${children}</a>`;
}

/** Copy text with a toast. */
export async function copyText(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(msg, { emoji: '📋' }); }
  catch { toast('Couldn’t copy — long-press to copy instead'); }
}

/** Native share sheet if available, else copy. */
export async function shareText({ title, text, url }) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch { return; }
  copyText([text, url].filter(Boolean).join(' '), 'Copied to clipboard');
}

export { render };
