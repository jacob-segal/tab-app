// WeekSummary — the detailed, scrollable breakdown of one person's dropped week.
// Used for the user's own drop (drop.js) and for friends' weeks (friends.js).
//
//   <${WeekSummary} userId="me" weekKey=${w} />
//   <${WeekSummary} userId=${friendId} weekKey=${w} compareIds=${ids} />
//
// Privacy: everything comes from data.weekStats(), which returns null for
// weeks that haven't dropped (→ EmptyState) and strips coordinates from
// friends' stats. Friends only get a rough-area map (stats.areas, ~400 m circles).

import { html, useMemo, cx } from '../lib.js';
import { CATEGORIES, DRINK_TYPES, SCORE_WEIGHTS } from '../config.js';
import { weekStats, trendsFor, compareWeek, rankOn, circleIds, getUser, firstName } from '../data.js';
import { isDropped, dropTs, weekdayLong, formatDayLabel, formatDuration, formatTime, addDays } from '../time.js';
import { topCategories, awardsFor } from '../stats.js';
import { formatDistance } from '../geomath.js';
import { useStore } from '../hooks.js';
import { navigate } from '../router.js';
import { now } from '../clock.js';
import {
  Icon, CatIcon, Section, EmptyState, Bar, Delta, openSheet, AwardCard, DayBars, CatLegend, MapView, Link, formatMetric,
} from '../ui.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pctLabel = p => `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}%`;

// ---- Tab Score explainer ------------------------------------------------------

export function openScoreInfo() {
  const example = Math.round((4 * SCORE_WEIGHTS.drinks + 2 * SCORE_WEIGHTS.shots) * 10) / 10;
  openSheet(close => html`<div class="ws ws-sheet">
    <p class="small muted">One number for your whole week. Everything you log is worth points — the heavier stuff counts more:</p>
    <div class="list mt-12">
      ${CATEGORIES.map(c => html`<div class="list-item" key=${c.id}>
        <${CatIcon} cat=${c.id} size="sm" />
        <div class="grow primary">${cap(c.unit)}</div>
        <span class="ws-weight num">${SCORE_WEIGHTS[c.id]} ${SCORE_WEIGHTS[c.id] === 1 ? 'pt' : 'pts'}</span>
      </div>`)}
    </div>
    <p class="small faint mt-12">So 4 beers + 2 shots = ${example} pts. Standard drinks and $ spent are just for context — they don't touch your score. Top score in the crew takes Tab MVP 👑, lowest gets Choir Boy 😇.</p>
    <button class="btn btn-block mt-16" onClick=${close}>Got it</button>
  </div>`, { title: 'How the Tab Score works' });
}

// ---- sections -------------------------------------------------------------------

function ScoreBlock({ userId, stats, trends, rank }) {
  const isMe = userId === 'me';
  const sc = trends && trends.score;
  const hasPrev = !!sc && sc.prev !== null;
  return html`<div class="card ws-score">
    <div class="ws-score-glow" aria-hidden="true"></div>
    <div class="spread">
      <span class="ws-eyebrow">Tab Score</span>
      <button class="icon-btn ws-info" onClick=${openScoreInfo} aria-label="How the Tab Score works">
        <${Icon} name="info" size=${18} />
      </button>
    </div>
    <div class="ws-score-num num">${formatMetric('score', stats.score)}<span class="ws-score-unit">pts</span></div>
    <div class="ws-score-meta">
      ${rank && rank.of > 1
        ? html`<span class=${cx('ws-rank', rank.rank === 1 && 'gold')}>${rank.rank === 1 ? '👑 ' : ''}<b>#${rank.rank}</b> of ${rank.of} in ${isMe ? 'your' : 'the'} crew</span>`
        : isMe
          ? html`<${Link} to="/crew/add" className="ws-rank ws-rank-cta">Add friends to get ranked →</${Link}>`
          : null}
      ${hasPrev
        ? html`<span class="ws-vs"><${Delta} delta=${sc.delta} /><span class="tiny faint">vs last week</span></span>`
        : html`<span class="tiny faint">First week on the books ✨</span>`}
    </div>
    <div class="ws-facts">
      ${plural(stats.total, 'thing', 'things')} logged · ${plural(stats.activeDays, 'active night', 'active nights')}
    </div>
  </div>`;
}

function TotalsGrid({ stats, trends }) {
  return html`<div class="ws-tiles">
    ${CATEGORIES.map(c => {
      const v = stats.totals[c.id] || 0;
      const t = trends && trends.byCat[c.id];
      const hasPrev = !!t && t.prev !== null;
      const vsAvg = t && t.vsAvgPct !== null && t.vsAvgPct !== undefined ? t.vsAvgPct : null;
      return html`<div class=${cx('ws-tile', `cat-${c.id}`, v === 0 && !(t && t.prev) && 'zero')} key=${c.id}>
        <${CatIcon} cat=${c.id} size="sm" />
        <div class="ws-tile-val num">${v}</div>
        <div class="ws-tile-lbl">${c.label}</div>
        <div class="ws-tile-foot">
          ${hasPrev ? html`<${Delta} delta=${t.delta} />` : html`<span class="delta faint">—</span>`}
          ${vsAvg !== null && html`<span class=${cx('ws-vsavg', vsAvg > 0 && 'up', vsAvg < 0 && 'down')}>vs avg ${pctLabel(vsAvg)}</span>`}
        </div>
      </div>`;
    })}
  </div>`;
}

function DrinksCard({ stats, isMe }) {
  const count = d => stats.drinkTypes[d.id] || 0;
  // Every drink type gets a bar (biggest first); empty ones sink to the bottom, dimmed.
  const types = [...DRINK_TYPES].sort((a, b) => count(b) - count(a));
  const max = Math.max(1, ...types.map(count));
  return html`<div class="card ws-drinks">
    ${(stats.totals.drinks || 0) > 0
      ? html`<div class="stack-12">
          ${types.map(d => html`<div class=${cx('ws-drink-row', count(d) === 0 && 'zero')} key=${d.id}>
            <span class="ws-drink-emoji" aria-hidden="true">${d.emoji}</span>
            <div class="grow">
              <div class="spread small"><span class="bold truncate">${d.label}</span><span class="bold num">${count(d)}</span></div>
              <div class="mt-4"><${Bar} value=${count(d)} max=${max} cat="drinks" /></div>
            </div>
          </div>`)}
        </div>`
      : html`<div class="ws-dry"><span aria-hidden="true">🏜️</span> Dry week on the drinks front.</div>`}
    <div class="ws-mini-grid">
      <div class="ws-mini">
        <div class="ws-mini-val num">${formatMetric('stdDrinks', stats.stdDrinks)}</div>
        <div class="ws-mini-lbl">🧪 std drinks <span class="faint">(incl. shots)</span></div>
      </div>
      <div class="ws-mini">
        <div class="ws-mini-val num">$${stats.spend}</div>
        <div class="ws-mini-lbl">💸 est. spent <span class="faint">(everything)</span></div>
      </div>
    </div>
    ${isMe && html`<div class="ws-est tiny faint">estimates · <${Link} to="/settings" className="ws-est-link">edit prices in Settings</${Link}></div>`}
  </div>`;
}

function WeekCard({ stats }) {
  const busy = stats.busiestDay;
  const cats = topCategories(stats);
  return html`<div class="card ws-week">
    <${DayBars} byDay=${stats.byDay} highlightDayKey=${busy ? busy.dayKey : null} />
    ${cats.length > 0 && html`<div class="mt-12"><${CatLegend} cats=${cats} /></div>`}
    <div class="ws-busiest">
      ${busy
        ? html`<span aria-hidden="true">🔥</span><span>Busiest night: <b>${weekdayLong(busy.dayKey)}</b> · ${plural(busy.total, 'thing', 'things')}</span>`
        : html`<span aria-hidden="true">😇</span><span class="muted">No big nights. Suspiciously wholesome.</span>`}
    </div>
  </div>`;
}

function AwardsBlock({ userId, cmp }) {
  const compared = cmp.members.filter(m => m.stats).length;
  const mine = awardsFor(userId, cmp.awards);
  const isMe = userId === 'me';
  if (compared < 2) {
    return html`<div class="ws-line">
      <span aria-hidden="true">🏆</span>
      ${isMe
        ? html`<span>Awards need a crew. <${Link} to="/crew/add" className="ws-inline-link">Add friends →</${Link}></span>`
        : html`<span>Not enough people to hand out awards this week.</span>`}
    </div>`;
  }
  if (!mine.length) {
    return html`<div class="ws-line"><span aria-hidden="true">🫥</span>
      <span>${isMe ? 'No hardware this week. Somebody’s gotta be the audience.' : `${firstName(userId)} went home empty-handed.`}</span>
    </div>`;
  }
  return html`<div class="ws-awards">
    ${mine.map(a => html`<${AwardCard} key=${a.id} award=${a} getUser=${getUser} />`)}
  </div>`;
}

function SpotsBlock({ userId, stats, locationEnabled }) {
  const isMe = userId === 'me';
  const spots = stats.spots || [];
  if (!spots.length) {
    return html`<div class="ws-line"><span aria-hidden="true">📍</span>
      <span>${isMe
        ? (locationEnabled
          ? 'No pins this week — spots show up when you log during a session.'
          : html`No spots mapped. <${Link} to="/settings" className="ws-inline-link">Turn on location</${Link}> to Strava your nights.`)
        : `${firstName(userId)} didn’t share any spots this week.`}</span>
    </div>`;
  }
  const top = spots.slice(0, 6);
  const max = Math.max(1, ...top.map(s => s.count));
  // Only the user's own pins ever carry coordinates.
  const showMap = isMe && (stats.pins || []).length > 0;
  const areas = !isMe ? stats.areas || [] : [];
  return html`<div class="card ws-spots">
    ${showMap && html`<div class="ws-map"><${MapView} pins=${stats.pins} spots=${spots} interactive=${false} /></div>`}
    ${areas.length > 0 && html`<div class="ws-map ws-map-rough"><${MapView} areas=${areas} interactive=${false} /></div>
      <div class="tiny faint ws-rough-note">🔒 Rough areas only (~400 m) — never exact spots or routes</div>`}
    <div class="list">
      ${top.map((s, i) => html`<div class="list-item ws-spot" key=${`${s.name}-${i}`}>
        <span class=${cx('rank', i < 3 && `r${i + 1}`)}>${i + 1}</span>
        <div class="grow">
          <div class="spread"><span class="primary truncate">${s.name}</span><span class="small bold num">${plural(s.count, 'log', 'logs')}</span></div>
          <div class="mt-4"><${Bar} value=${s.count} max=${max} /></div>
        </div>
      </div>`)}
    </div>
  </div>`;
}

function SessionsBlock({ stats }) {
  const list = stats.sessions || [];
  if (!list.length) {
    return html`<div class="ws-line"><span aria-hidden="true">🌙</span>
      <span>No sessions this week. Start one from Track next time you head out and it’ll show up here.</span>
    </div>`;
  }
  return html`<div class="card ws-sessions">
    <div class="list">
      ${list.map(x => html`<div class="list-item clickable ws-ses" key=${x.id} role="button" tabindex="0"
          onClick=${() => navigate(`/session/${x.id}`)}
          onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/session/${x.id}`); } }}>
        <span class="ws-ses-ico" aria-hidden="true">🌙</span>
        <div class="grow">
          <div class="primary truncate">${x.name || `${weekdayLong(x.dayKey)} night`}</div>
          <div class="secondary truncate">
            ${formatDayLabel(x.dayKey)} · ${x.end ? formatDuration(x.durationMs) : 'no end time'}${x.distanceM > 50 ? ` · ${formatDistance(x.distanceM)}` : ''}
          </div>
        </div>
        <div class="ws-ses-total"><b class="num">${x.total}</b><span>${x.total === 1 ? 'thing' : 'things'}</span></div>
        <${Icon} name="chevron-right" size=${18} className="faint" />
      </div>`)}
    </div>
  </div>`;
}

// ---- main component ----------------------------------------------------------------

/**
 * @param {{ userId: string, weekKey: string, compareIds?: string[] }} p
 *   compareIds: whose weeks to rank/award against (defaults to me + friends).
 */
export function WeekSummary({ userId = 'me', weekKey, compareIds }) {
  const s = useStore();
  const idsKey = (compareIds || []).join(',');
  const ids = useMemo(() => {
    const base = compareIds && compareIds.length ? compareIds : circleIds();
    return base.includes(userId) ? base : [userId, ...base];
  }, [s, userId, idsKey]);

  const stats = weekKey ? weekStats(userId, weekKey) : null;
  const hasStats = !!stats;
  const trends = useMemo(() => (hasStats ? trendsFor(userId, weekKey) : null), [s, userId, weekKey, hasStats]);
  const cmp = useMemo(() => (hasStats ? compareWeek(ids, weekKey) : null), [s, ids, weekKey, hasStats]);

  const isMe = userId === 'me';

  if (!stats) {
    const notYet = !!weekKey && !isDropped(weekKey, now());
    const known = isMe || !!getUser(userId);
    const who = isMe ? 'You weren’t' : known ? `${firstName(userId)} wasn’t` : 'They weren’t';
    return html`<div class="ws">
      <${EmptyState}
        emoji=${notYet ? '🔒' : '🫙'}
        title=${notYet ? 'Not dropped yet' : 'Nothing on the tab'}
        body=${notYet
          ? `This week drops ${formatDayLabel(addDays(weekKey, 7))} at ${formatTime(dropTs(weekKey))}. No peeking${isMe ? ' — not even you' : ''} 🙈`
          : `${who} on Tab yet for this week.`} />
    </div>`;
  }

  const rank = cmp ? rankOn(cmp.boards.score, userId) : null;

  return html`<div class="ws">
    <${ScoreBlock} userId=${userId} stats=${stats} trends=${trends} rank=${rank} />

    <${Section} title="The damage">
      <${TotalsGrid} stats=${stats} trends=${trends} />
    </${Section}>

    <${Section} title="Drinks & spend">
      <${DrinksCard} stats=${stats} isMe=${isMe} />
    </${Section}>

    <${Section} title="The week">
      <${WeekCard} stats=${stats} />
    </${Section}>

    <${Section} title=${isMe ? 'Awards you won' : 'Awards won'}>
      <${AwardsBlock} userId=${userId} cmp=${cmp} />
    </${Section}>

    <${Section} title="Top spots">
      <${SpotsBlock} userId=${userId} stats=${stats} locationEnabled=${!!s.settings.locationEnabled} />
    </${Section}>

    ${isMe && html`<${Section} title="Sessions">
      <${SessionsBlock} stats=${stats} />
    </${Section}>`}
  </div>`;
}
