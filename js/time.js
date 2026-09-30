// Time logic: "tab days", weeks, drops, editability, formatting.
//
// Key ideas
// - A "tab day" (dayKey, 'YYYY-MM-DD') runs from rolloverHour on that calendar
//   date until rolloverHour the next morning. With the default 6 AM rollover,
//   a beer at 2:30 AM Saturday belongs to Friday.
// - A week (weekKey = the Monday's dayKey) is Monday..Sunday tab days, i.e.
//   Monday rolloverHour -> next Monday rolloverHour in real time.
// - A week's drop is released the following Monday at DROP_HOUR (12 PM).
//   Between Monday 6 AM and 12 PM the new week is live and the previous week
//   is "cooking" (still editable, not yet revealed).
// - Once a week has dropped it is locked.
//
// All functions work in the device's local time zone and are DST-safe: they
// only use calendar arithmetic (new Date(y, m, d + n)), never "ts - 6h".
// Pure module: no DOM, safe for tests.

import { DROP_HOUR, DEFAULT_ROLLOVER_HOUR } from './config.js';

const MS_MIN = 60 * 1000;
const MS_HOUR = 60 * MS_MIN;
const MS_DAY = 24 * MS_HOUR;

const pad2 = n => String(n).padStart(2, '0');

// ---- dayKey primitives ----------------------------------------------------

export function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Local midnight of that calendar date.
export function dateFromDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dayKey, n) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return dayKeyFromDate(new Date(y, m - 1, d + n));
}

// Whole days from a to b (b - a), DST-safe.
export function daysBetween(aKey, bKey) {
  const a = dateFromDayKey(aKey), b = dateFromDayKey(bKey);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / MS_DAY);
}

// Timestamp of `hour:00` local time on the calendar date `dayKey`.
export function tsAt(dayKey, hour = 0, minute = 0) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

// ---- tab days & weeks -----------------------------------------------------

// The tab day a timestamp belongs to (before rolloverHour => previous date).
export function tabDayKey(ts, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const d = new Date(ts);
  if (d.getHours() < rolloverHour) {
    return dayKeyFromDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  }
  return dayKeyFromDate(d);
}

// Monday on or before dayKey.
export function weekKeyOf(dayKey) {
  const dow = dateFromDayKey(dayKey).getDay(); // 0 Sun .. 6 Sat
  return addDays(dayKey, -((dow + 6) % 7));
}

export function weekDays(weekKey) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));
}

export function prevWeekKey(weekKey, n = 1) { return addDays(weekKey, -7 * n); }
export function nextWeekKey(weekKey, n = 1) { return addDays(weekKey, 7 * n); }

// Real-time bounds of a week.
export function weekStartTs(weekKey, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  return tsAt(weekKey, rolloverHour);
}
export function weekEndTs(weekKey, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  return tsAt(addDays(weekKey, 7), rolloverHour);
}

export function currentDayKey(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  return tabDayKey(now, rolloverHour);
}
export function currentWeekKey(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  return weekKeyOf(currentDayKey(now, rolloverHour));
}

// ---- drops ----------------------------------------------------------------

// When the drop for `weekKey` is released (following Monday, DROP_HOUR).
export function dropTs(weekKey) {
  return tsAt(addDays(weekKey, 7), DROP_HOUR);
}

export function isDropped(weekKey, now) {
  return now >= dropTs(weekKey);
}

// The previous week while it's "cooking" (Mon rollover -> Mon 12 PM), else null.
export function pendingDropWeekKey(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const prev = prevWeekKey(currentWeekKey(now, rolloverHour));
  return isDropped(prev, now) ? null : prev;
}

// Most recent week whose drop is out.
export function latestDroppedWeekKey(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const prev = prevWeekKey(currentWeekKey(now, rolloverHour));
  return isDropped(prev, now) ? prev : prevWeekKey(prev);
}

// The week the next drop is for, and when it lands.
export function nextDrop(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const pending = pendingDropWeekKey(now, rolloverHour);
  const weekKey = pending || currentWeekKey(now, rolloverHour);
  return { weekKey, ts: dropTs(weekKey), cooking: !!pending };
}

// Last N dropped weeks, newest first.
export function droppedWeekKeys(now, count, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const latest = latestDroppedWeekKey(now, rolloverHour);
  return Array.from({ length: count }, (_, i) => prevWeekKey(latest, i));
}

// ---- editability ----------------------------------------------------------

// A day can be edited if it isn't in the future and its week hasn't dropped.
export function isDayEditable(dayKey, now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  if (dayKey > currentDayKey(now, rolloverHour)) return false;
  return !isDropped(weekKeyOf(dayKey), now);
}

// All editable days, oldest first (current week so far, plus the cooking week).
export function editableDayKeys(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const today = currentDayKey(now, rolloverHour);
  const pending = pendingDropWeekKey(now, rolloverHour);
  const start = pending || weekKeyOf(today);
  const out = [];
  for (let k = start; k <= today; k = addDays(k, 1)) out.push(k);
  return out;
}

// ---- session attribution --------------------------------------------------

// Which day a log at `ts` counts toward. During an active session, logs count
// toward the night the session started — unless that week already dropped
// (locked), in which case they fall back to the log's own tab day.
export function attributeDayKey(ts, rolloverHour = DEFAULT_ROLLOVER_HOUR, session = null) {
  const own = tabDayKey(ts, rolloverHour);
  if (session && session.dayKey && session.dayKey < own && !isDropped(weekKeyOf(session.dayKey), ts)) {
    return session.dayKey;
  }
  return own;
}

// True when the calendar date differs from the tab day (e.g. 2 AM Saturday
// still counting as Friday). Used for the "late night" hint on the tracker.
export function lateNightInfo(now, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const tab = tabDayKey(now, rolloverHour);
  const cal = dayKeyFromDate(new Date(now));
  return { late: tab !== cal, tabDayKey: tab, calendarDayKey: cal };
}

// ---- formatting -----------------------------------------------------------

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayShort(dayKey) { return WEEKDAYS_SHORT[dateFromDayKey(dayKey).getDay()]; }
export function weekdayLong(dayKey) { return WEEKDAYS_LONG[dateFromDayKey(dayKey).getDay()]; }
export function dayOfMonth(dayKey) { return dateFromDayKey(dayKey).getDate(); }

// "Sep 25"
export function formatShortDate(dayKey) {
  const d = dateFromDayKey(dayKey);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// "Fri, Sep 25"
export function formatDayLabel(dayKey) {
  return `${weekdayShort(dayKey)}, ${formatShortDate(dayKey)}`;
}

// "Today" / "Yesterday" / "Friday"
export function relativeDayName(dayKey, todayKey) {
  const diff = daysBetween(dayKey, todayKey);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Last night';
  return weekdayLong(dayKey);
}

// "Sep 21 – 27" or "Sep 28 – Oct 4"
export function formatWeekRange(weekKey) {
  const a = dateFromDayKey(weekKey), b = dateFromDayKey(addDays(weekKey, 6));
  const left = `${MONTHS_SHORT[a.getMonth()]} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS_SHORT[b.getMonth()]} ${b.getDate()}`;
  return `${left} – ${right}`;
}

// ISO-8601 week number of the week's Monday.
export function weekNumber(weekKey) {
  const d = dateFromDayKey(weekKey);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / MS_DAY + 1) / 7);
}

// "Week 39"
export function weekLabel(weekKey) { return `Week ${weekNumber(weekKey)}`; }

// "1:42 AM"
export function formatTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Mon 12 PM"
export function formatDropMoment(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

// Split a positive duration into parts for countdowns.
export function countdownParts(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
    done: ms <= 0,
  };
}

// "3h 12m", "45m", "2d 4h"
export function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / MS_MIN));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// "just now", "5m ago", "3h ago", "2d ago"
export function formatAgo(ts, now) {
  const diff = Math.max(0, now - ts);
  if (diff < MS_MIN) return 'just now';
  if (diff < MS_HOUR) return `${Math.floor(diff / MS_MIN)}m ago`;
  if (diff < MS_DAY) return `${Math.floor(diff / MS_HOUR)}h ago`;
  return `${Math.floor(diff / MS_DAY)}d ago`;
}

export const MS = { MIN: MS_MIN, HOUR: MS_HOUR, DAY: MS_DAY };
