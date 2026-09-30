// Groups: create a group, view its weekly drop + season standings, edit it.
//   /groups/new       → CreateGroupPage
//   /groups/:id       → GroupPage       (?week=YYYY-MM-DD optional)
//   /groups/:id/edit  → EditGroupPage
//
// Privacy: every number on this page comes from data.groupWeek() → weekStats(),
// which returns null for weeks that haven't dropped. We only ever ask for
// dropped weeks, and friends' spots are names only here (rough areas live in WeekSummary).

import { html, useState, useEffect, useRef, useMemo, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import { navigate, back } from '../router.js';
import {
  Icon, Avatar, AvatarStack, PageHeader, Section, EmptyState, Segmented, MetricPicker, METRICS, Leaderboard,
  AwardCard, WeekPicker, weekTitle, Countdown, toast, openSheet, confirmSheet, UserRow, copyText, formatMetric,
} from '../ui.js';
import { CATEGORY_BY_ID, CATEGORY_IDS } from '../config.js';
import { groupById, groupMembers, groupWeek, latestDropWeek, listFriends, getUser, firstName } from '../data.js';
import { createGroup, updateGroup, leaveGroup } from '../store.js';
import {
  prevWeekKey, isDropped, weekKeyOf, formatWeekRange, weekdayLong, nextDrop, dateFromDayKey, addDays,
  formatShortDate, weekLabel,
} from '../time.js';
import { leaderboard, emptyTotals } from '../stats.js';
import { now } from '../clock.js';

// ---- constants ------------------------------------------------------------------------

const GROUP_EMOJIS = ['🍻', '🔥', '🏠', '😵‍💫', '🎉', '🍹', '🥂', '🌿', '💨', '🦉', '🐐', '👑', '🎯', '🪩', '🍕', '🎲', '🏈', '🎸', '🌙', '🧃', '🥃', '🍷', '🫧', '🚬'];
const NAME_MAX = 32;
const NAME_IDEAS = [
  'Floor 3 Degens', 'The Liver Club', 'Sunday Scaries', 'Tailgate Task Force', 'Pregame Council', 'Bong Appétit',
  'Last Call Legends', 'Designated Nobody', 'Hot Box Office', 'Shots Fired', 'The Group Chat', 'Wine Down Crew',
];
const SEASON_WEEKS = 8;
const CREW_GROUPS = '/crew?tab=groups';
const VIEW_OPTIONS = [{ value: 'drop', label: 'This drop' }, { value: 'season', label: 'Season' }];
const WINS_METRIC = { id: 'wins', label: 'Weeks won', short: 'Weeks won', emoji: '🏆' };
const SEASON_METRICS = [METRICS[0], WINS_METRIC, ...METRICS.slice(1)];
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// Per-group UI prefs (view tab, metric) so coming back from a profile keeps your place.
const viewMemory = new Map();
const remember = (id, patch) => viewMemory.set(id, { ...(viewMemory.get(id) || {}), ...patch });

// ---- small helpers ----------------------------------------------------------------------

const enc = encodeURIComponent;
const round1 = n => Math.round(n * 10) / 10;
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
const pts = v => `${formatMetric('score', v)} ${plural(round1(v), 'pt')}`;
const unitFor = (cat, n) => (n === 1 ? CATEGORY_BY_ID[cat].unit : CATEGORY_BY_ID[cat].unitPlural);
const matchesQuery = (u, q) => u.name.toLowerCase().includes(q) || String(u.handle || '').toLowerCase().includes(q);
const sortMembers = users => [...users].sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.name.localeCompare(b.name)));
const shortName = u => (u.isMe ? 'You' : u.name.split(' ')[0]);
const monthDay = w => { const d = dateFromDayKey(w); return `${d.getMonth() + 1}/${d.getDate()}`; };

function hueOf(str) {
  let h = 7;
  for (const ch of String(str || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// A ?week= param is usable if it's a real Monday weekKey whose drop is out.
function validWeekParam(w) {
  return typeof w === 'string' && WEEK_RE.test(w) && weekKeyOf(w) === w && isDropped(w, now());
}

const openProfile = uid => navigate(uid === 'me' ? '/you' : `/u/${enc(uid)}`);
const openWeek = (uid, w) => navigate(uid === 'me' ? `/drop/${w}` : `/u/${enc(uid)}/week/${w}`);

// Replace the URL (keeps ?week= shareable / restorable on back) without jumping scroll.
function replaceQuery(path) {
  const y = window.scrollY;
  navigate(path, { replace: true });
  if (y) window.scrollTo(0, y);
}

async function confirmLeave(g) {
  const ok = await confirmSheet({
    title: `Leave ${g.name}?`,
    body: 'You’ll stop seeing this group’s drops, podiums and awards. Your own stats stay yours.',
    confirmLabel: 'Leave group',
    danger: true,
  });
  if (!ok) return;
  leaveGroup(g.id);
  navigate(CREW_GROUPS, { replace: true });
  toast(`You left ${g.name}`, { emoji: '👋' });
}

function openGroupMenu(g) {
  openSheet(close => html`<div class="pg-groups g-sheet">
    <div class="g-menu">
      <button class="g-menu-item" onClick=${() => { close(); navigate(`/groups/${enc(g.id)}/edit`); }}>
        <span class="g-menu-icon"><${Icon} name="edit" size=${18} /></span>
        <span class="grow">Edit group</span>
        <${Icon} name="chevron-right" size=${18} className="faint" />
      </button>
      ${g.inviteCode && html`<button class="g-menu-item" onClick=${() => { copyText(g.inviteCode, 'Invite code copied'); close(); }}>
        <span class="g-menu-icon"><${Icon} name="copy" size=${18} /></span>
        <span class="grow">Copy invite code</span>
        <span class="g-code num">${g.inviteCode}</span>
      </button>`}
      <button class="g-menu-item danger" onClick=${() => { close(); confirmLeave(g); }}>
        <span class="g-menu-icon"><${Icon} name="logout" size=${18} /></span>
        <span class="grow">Leave group</span>
      </button>
    </div>
  </div>`, { title: `${g.emoji} ${g.name}` });
}

// Fade the group name into the sticky header once the big title scrolls away.
function useCompactHeader(ref, active) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(entries => {
      const e = entries[entries.length - 1];
      if (e) setCompact(!e.isIntersecting && e.boundingClientRect.top < 80);
    }, { rootMargin: '-72px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return compact;
}

// ---- data shaping --------------------------------------------------------------------------

function buildGroupData(g, latest, extraWeek) {
  const recent = Array.from({ length: SEASON_WEEKS }, (_, i) => prevWeekKey(latest, i));
  const weekData = new Map();
  for (const w of recent) weekData.set(w, groupWeek(g.id, w));
  if (extraWeek && !weekData.has(extraWeek)) weekData.set(extraWeek, groupWeek(g.id, extraWeek));
  const withData = w => { const gw = weekData.get(w); return !!gw && gw.members.some(m => m.stats); };
  const weeks = [...weekData.keys()].filter(withData).sort().reverse(); // newest first
  const season = buildSeason(recent.filter(withData).map(w => [w, weekData.get(w)]));
  return { weekData, weeks, season };
}

/** Sum each member's weekly stats over the season; count weekly MVP wins. entries newest first. */
function buildSeason(entries) {
  const acc = new Map();
  const weekRows = [];
  for (const [weekKey, gw] of entries) {
    const present = gw.members.filter(m => m.stats);
    const board = gw.boards.score || [];
    // A week only counts as "won" if at least two people dropped and someone scored.
    const contest = present.length >= 2 && board.length > 0 && board[0].value > 0;
    const winnerIds = contest ? board.filter(r => r.rank === 1).map(r => r.userId) : [];
    let groupScore = 0;
    for (const m of present) {
      let a = acc.get(m.userId);
      if (!a) {
        a = { userId: m.userId, stats: { totals: emptyTotals(), score: 0, stdDrinks: 0, spend: 0, wins: 0, weeks: 0 } };
        acc.set(m.userId, a);
      }
      const st = a.stats;
      for (const c of CATEGORY_IDS) st.totals[c] += (m.stats.totals && m.stats.totals[c]) || 0;
      st.score += m.stats.score || 0;
      st.stdDrinks += m.stats.stdDrinks || 0;
      st.spend += m.stats.spend || 0;
      st.weeks += 1;
      groupScore += m.stats.score || 0;
    }
    for (const id of winnerIds) { const a = acc.get(id); if (a) a.stats.wins += 1; }
    weekRows.push({ weekKey, winnerIds, topScore: board[0] ? board[0].value : 0, present: present.length, groupScore: round1(groupScore) });
  }
  const members = [...acc.values()];
  for (const m of members) {
    m.stats.score = round1(m.stats.score);
    m.stats.stdDrinks = round1(m.stats.stdDrinks);
    m.stats.spend = Math.round(m.stats.spend);
  }
  const boards = Object.fromEntries(SEASON_METRICS.map(x => [x.id, leaderboard(members, x.id)]));
  const ranked = [...members].sort((a, b) => b.stats.wins - a.stats.wins || b.stats.score - a.stats.score || String(a.userId).localeCompare(String(b.userId)));
  const top = ranked[0];
  const mvp = top && (top.stats.wins > 0 || top.stats.score > 0) ? top : null;
  return { weekRows, members, boards, mvp, weeks: entries.length };
}

/** "You placed #3 of 5 · 4.5 pts behind Tyler" */
function placementLine(board) {
  const i = board.findIndex(r => r.userId === 'me');
  if (i < 0) return null;
  const me = board[i];
  const of = board.length;
  if (of < 2) return { emoji: '🫥', text: 'Only you had a drop this week. Technically, you won.' };
  if (me.rank === 1) {
    const cotop = board.filter(r => r.rank === 1 && r.userId !== 'me');
    if (cotop.length) return { emoji: '🤝', text: `Tied for the crown with ${cotop.map(r => firstName(r.userId)).join(' & ')}` };
    const next = board.find(r => r.rank > 1);
    const gap = next ? round1(me.value - next.value) : 0;
    return { emoji: '👑', text: next ? `You took the crown — ${pts(gap)} clear of ${firstName(next.userId)}` : 'You took the crown.' };
  }
  const ahead = board.slice(0, i).reverse().find(r => r.rank < me.rank);
  const gap = ahead ? round1(ahead.value - me.value) : 0;
  const behind = ahead ? ` · ${pts(gap)} behind ${firstName(ahead.userId)}` : '';
  const last = board[of - 1].rank === me.rank && of > 2;
  if (last) return { emoji: '😇', text: `Dead last. Your liver sends its thanks${behind}` };
  return { emoji: me.rank <= 3 ? '🥉' : '📊', text: `You placed #${me.rank} of ${of}${behind}` };
}

function zeroCopy(metric) {
  const c = CATEGORY_BY_ID[metric];
  if (c) return `Zero ${c.unitPlural} across the whole group. Wholesome… or lying.`;
  if (metric === 'wins') return 'Nobody’s won a week outright yet. The throne is empty.';
  return 'All zeros. A historically quiet stretch.';
}

// ---- shared pieces ---------------------------------------------------------------------------

function GroupHero({ emoji, name, placeholder = '', users, nameRef, extra }) {
  return html`<div class="g-hero">
    <div class="g-tile" style=${`--hue:${hueOf(emoji)}`}><span key=${emoji}>${emoji}</span></div>
    <h1 class=${cx('g-name', !name && 'ph')} ref=${nameRef}>${name || placeholder}</h1>
    <div class="g-meta">
      <${AvatarStack} users=${users} max=${5} size="sm" />
      <span>${users.length} ${plural(users.length, 'member')}</span>
    </div>
    ${extra}
  </div>`;
}

function GroupNotFound() {
  return html`<div class="page pg-groups">
    <${PageHeader} title="" back=${CREW_GROUPS} />
    <${EmptyState}
      emoji="🕳️"
      title="This group doesn’t exist (anymore)"
      body="Maybe you left, maybe it never happened. Either way, nothing to see here."
      action=${html`<button class="btn btn-primary" onClick=${() => navigate(CREW_GROUPS, { replace: true })}>Back to your groups</button>`}
    />
  </div>`;
}

function ZeroNote({ metric }) {
  const m = SEASON_METRICS.find(x => x.id === metric);
  return html`<div class="g-zero"><span class="e">${m ? m.emoji : '🫥'}</span>${zeroCopy(metric)}</div>`;
}

function NoDropsYet({ nd }) {
  return html`<div class="card card-night g-nodrop mt-16">
    <div class="g-nodrop-emoji">🍳</div>
    <div class="h3">The first drop is cooking</div>
    <p class="small muted mt-4">Log all week. Nobody sees a thing. Then Monday at noon, the podium goes up.</p>
    <div class="mt-16"><${Countdown} targetTs=${nd.ts} /></div>
  </div>`;
}

// ---- group page: This drop -----------------------------------------------------------------------

function Podium({ board, onSelect }) {
  const slots = [[board[1], 2], [board[0], 1], [board[2], 3]];
  return html`<div class="g-podium">
    ${slots.map(([r, place]) => {
      const u = r && getUser(r.userId);
      if (!u) {
        return html`<div class=${`g-pod empty p${place}`} key=${`empty-${place}`} aria-hidden="true">
          <span class="g-pod-block"></span>
        </div>`;
      }
      const isMe = r.userId === 'me';
      return html`<button key=${r.userId} class=${cx('g-pod', `p${place}`, isMe && 'me')} onClick=${() => onSelect(r.userId)}
          aria-label=${`${firstName(r.userId)}, rank ${r.rank}, ${pts(r.value)}`}>
        <span class="g-pod-av">
          ${r.rank === 1 && html`<span class="g-crown" aria-hidden="true">👑</span>`}
          <${Avatar} user=${u} size=${place === 1 ? 'lg' : 'md'} ring=${isMe} />
        </span>
        <span class="g-pod-name truncate">${firstName(r.userId)}</span>
        <span class="g-pod-score num">${formatMetric('score', r.value)}<small> pts</small></span>
        <span class="g-pod-block"><span class=${cx('rank', r.rank <= 3 && `r${r.rank}`)}>${r.rank}</span></span>
      </button>`;
    })}
  </div>`;
}

function TogetherCard({ present }) {
  if (!present.length) return null;
  const totals = emptyTotals();
  let std = 0, spend = 0, dayKeys = null;
  const dayScore = [0, 0, 0, 0, 0, 0, 0];
  const spots = new Map();
  for (const { stats } of present) {
    for (const c of CATEGORY_IDS) totals[c] += (stats.totals && stats.totals[c]) || 0;
    std += stats.stdDrinks || 0;
    spend += stats.spend || 0;
    (stats.byDay || []).forEach((d, i) => { if (i < 7) dayScore[i] += d.score || 0; });
    if (!dayKeys && stats.byDay && stats.byDay.length === 7) dayKeys = stats.byDay.map(d => d.dayKey);
    for (const sp of stats.spots || []) {
      if (!sp.name || /^Stop \d+$/.test(sp.name)) continue; // unnamed clusters mean nothing across people
      spots.set(sp.name, (spots.get(sp.name) || 0) + (sp.count || 0));
    }
  }
  const cats = CATEGORY_IDS.filter(c => totals[c] > 0);
  const peakScore = Math.max(...dayScore);
  const peakDay = peakScore > 0 && dayKeys ? dayKeys[dayScore.indexOf(peakScore)] : null;
  const topSpots = [...spots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  return html`<div class="card g-together">
    <div class="spread">
      <span class="g-eyebrow">🤝 Together this week</span>
      <span class="tiny faint">${present.length} ${plural(present.length, 'person', 'people')}</span>
    </div>
    ${cats.length
      ? html`<p class="g-tline">${cats.map((c, i) => html`${i > 0 ? html`<span class="g-dot"> · </span>` : null}<span class=${`g-titem cat-${c}`}><b>${totals[c]}</b> ${unitFor(c, totals[c])}</span>`)}</p>`
      : html`<p class="g-tline faint">A dry week. Collectively. Suspicious.</p>`}
    ${cats.length > 0 && html`<div class="g-tstats">
      <div class="g-tstat"><b class="num">${round1(std)}</b><span>standard drinks 🧪</span></div>
      <div class="g-tstat"><b class="num">$${Math.round(spend).toLocaleString()}</b><span>est. spent 💸</span></div>
    </div>`}
    ${peakDay && html`<div class="g-tfact"><${Icon} name="flame" size=${16} /><span><b>${weekdayLong(peakDay)}</b> was the group’s biggest night</span></div>`}
    ${topSpots.length > 0 && html`<div class="g-tfact"><${Icon} name="map-pin" size=${16} /><span>Most-hit spots: <b>${topSpots.join(' · ')}</b></span></div>`}
  </div>`;
}

function AwardsSection({ awards, presentCount }) {
  const [all, setAll] = useState(false);
  const mine = awards.filter(a => a.winnerIds.includes('me')).length;
  const shown = all ? awards : awards.slice(0, 6);
  return html`<${Section}
      title=${awards.length ? `Awards · ${awards.length}` : 'Awards'}
      action=${awards.length > 6 ? (all ? 'Show less' : `Show all ${awards.length}`) : null}
      onAction=${() => setAll(v => !v)}>
    ${mine > 0 && html`<div class="g-mine">🏅 You took home <b>${mine}</b> ${plural(mine, 'award')} this week</div>`}
    ${awards.length
      ? html`<div class="grid-2">${shown.map(a => html`<${AwardCard} key=${a.id} award=${a} getUser=${getUser} />`)}</div>`
      : html`<div class="card g-note">${presentCount < 2
        ? 'Awards need at least two people with a drop. Peer pressure required.'
        : 'No awards this week — nobody did anything award-worthy.'}</div>`}
  </${Section}>`;
}

function DropView({ week, weeks, latest, gw, metric, setMetric, setWeek }) {
  const present = gw.members.filter(m => m.stats);
  const missing = gw.members.length - present.length;
  const scoreBoard = gw.boards.score || [];
  const allZero = scoreBoard.length > 0 && scoreBoard.every(r => r.value === 0);
  const board = gw.boards[metric] || [];
  const boardZero = board.length > 0 && board.every(r => r.value === 0);
  const place = placementLine(scoreBoard);
  const open = uid => openWeek(uid, week);

  return html`<div class="g-view">
    <div class="mt-16"><${WeekPicker} weeks=${weeks} value=${week} onChange=${setWeek} /></div>
    <div class="g-weekline">
      <span class="small bold">${weekTitle(week)}</span>
      ${week === latest ? html`<span class="tag brand">Latest drop</span>` : null}
    </div>
    ${missing > 0 && html`<p class="tiny faint g-missing">${missing} ${plural(missing, 'member')} joined after this week, so ${missing === 1 ? 'they’re' : 'they’re'} not on the board.</p>`}

    ${allZero
      ? html`<div class="card g-dry"><div class="g-nodrop-emoji">🏜️</div><div class="h3">Bone dry</div><p class="small muted mt-4">Nobody logged a thing this week. Finals? Probation? We don’t judge.</p></div>`
      : html`<div class="card g-podium-card" key=${`pod-${week}`}>
          <${Podium} board=${scoreBoard} onSelect=${open} />
          ${place && html`<div class="g-place"><span class="g-place-e">${place.emoji}</span><span class="grow">${place.text}</span></div>`}
        </div>`}

    <${TogetherCard} present=${present} />

    <${Section} title="Leaderboard">
      <${MetricPicker} value=${metric} onChange=${setMetric} />
      <div class="card g-board mt-8">
        ${boardZero
          ? html`<${ZeroNote} metric=${metric} />`
          : html`<${Leaderboard} board=${board} metric=${metric} getUser=${getUser} onSelect=${open} />`}
      </div>
      <p class="g-hint">Tap anyone to see their full drop</p>
    </${Section}>

    <${AwardsSection} awards=${gw.awards || []} presentCount=${present.length} />
  </div>`;
}

// ---- group page: Season ------------------------------------------------------------------------------

function SeasonView({ season, metric, setMetric, onWeek }) {
  const { weekRows, boards, mvp, weeks } = season;
  if (!weeks) {
    return html`<div class="card g-note mt-16">Season stats cover the last ${SEASON_WEEKS} drops — nothing in that window yet.</div>`;
  }
  const board = boards[metric] || [];
  const zero = board.length > 0 && board.every(r => r.value === 0);
  const oldest = weekRows[weekRows.length - 1].weekKey;
  const newest = weekRows[0].weekKey;
  const heat = [...weekRows].reverse(); // oldest → newest
  const maxHeat = Math.max(1, ...heat.map(r => r.groupScore));
  const hottest = heat.reduce((a, b) => (b.groupScore > a.groupScore ? b : a), heat[0]);
  const mvpUser = mvp && getUser(mvp.userId);

  return html`<div class="g-view">
    <div class="g-weekline mt-16">
      <span class="small bold">Last ${weeks} ${plural(weeks, 'drop')}</span>
      <span class="tiny faint">${formatShortDate(oldest)} – ${formatShortDate(addDays(newest, 6))}</span>
    </div>

    ${mvpUser && html`<button class="card-hero g-mvp" onClick=${() => openProfile(mvp.userId)}>
      <span class="g-mvp-av">
        <span class="g-crown" aria-hidden="true">👑</span>
        <${Avatar} user=${mvpUser} size="lg" />
      </span>
      <span class="g-mvp-txt">
        <span class="g-eyebrow">Season MVP</span>
        <span class="g-mvp-name truncate">${mvpUser.isMe ? 'You. Obviously.' : mvpUser.name}</span>
        <span class="small muted">${mvp.stats.wins > 0
          ? `🏆 ${mvp.stats.wins} of ${weeks} ${plural(weeks, 'week')} won · ${pts(mvp.stats.score)}`
          : `Top score this season · ${pts(mvp.stats.score)}`}</span>
      </span>
    </button>`}

    <${Section} title="Season leaderboard">
      <${MetricPicker} value=${metric} onChange=${setMetric} metrics=${SEASON_METRICS} />
      <div class="card g-board mt-8">
        ${zero
          ? html`<${ZeroNote} metric=${metric} />`
          : html`<${Leaderboard} board=${board} metric=${metric} getUser=${getUser} onSelect=${openProfile} />`}
      </div>
    </${Section}>

    <${Section} title="Group heat">
      <div class="card">
        <div class="g-heat" style=${`--n:${heat.length}`}>
          ${heat.map(r => {
            const hot = r === hottest && r.groupScore > 0;
            return html`<div key=${r.weekKey} class=${cx('g-heat-col', hot && 'hot')}>
              <span class="tiny num g-heat-val">${hot ? Math.round(r.groupScore) : ''}</span>
              <i class="g-heat-bar" style=${`height:${Math.max(4, (r.groupScore / maxHeat) * 62)}%`}></i>
              <span class="g-heat-lbl">${monthDay(r.weekKey)}</span>
            </div>`;
          })}
        </div>
        ${hottest && hottest.groupScore > 0 && html`<p class="small muted mt-12">🔥 Wildest week: <b>${formatWeekRange(hottest.weekKey)}</b> — ${pts(hottest.groupScore)} combined</p>`}
      </div>
    </${Section}>

    <${Section} title="Weekly MVPs">
      <div class="card g-wlist">
        ${weekRows.map(r => {
          const ws = r.winnerIds.map(id => getUser(id)).filter(Boolean);
          return html`<button key=${r.weekKey} class=${cx('g-wrow', r.winnerIds.includes('me') && 'me')} onClick=${() => onWeek(r.weekKey)}>
            <span class="g-wrow-week"><b>${formatWeekRange(r.weekKey)}</b><span>${weekLabel(r.weekKey)}</span></span>
            <span class="grow g-wrow-who">
              ${ws.length
                ? html`<${AvatarStack} users=${ws} max=${3} size="sm" /><span class="truncate">${ws.map(shortName).join(' & ')}</span>`
                : html`<span class="faint small">${r.present < 2 ? 'No contest' : 'Nobody scored'}</span>`}
            </span>
            ${ws.length > 0 && html`<span class="g-wrow-score num">${formatMetric('score', r.topScore)}</span>`}
            <${Icon} name="chevron-right" size=${16} className="faint" />
          </button>`;
        })}
      </div>
    </${Section}>
  </div>`;
}

function MembersSection({ g, members, rightFor }) {
  const edit = () => navigate(`/groups/${enc(g.id)}/edit`);
  return html`<${Section} title=${`Members · ${members.length}`} action="Edit" onAction=${edit}>
    <div class="card g-members">
      ${members.map(u => html`<${UserRow} key=${u.id} user=${u} subtitle=${`@${u.handle}`} right=${rightFor(u.id)} onClick=${() => openProfile(u.id)} />`)}
      <button class="g-addrow" onClick=${edit}>
        <span class="g-addrow-icon"><${Icon} name="user-plus" size=${18} /></span>
        <span class="grow">Add friends to the group</span>
        <${Icon} name="chevron-right" size=${16} className="faint" />
      </button>
    </div>
  </${Section}>`;
}

// ---- GroupPage -----------------------------------------------------------------------------------

export function GroupPage({ params = {}, query = {} }) {
  const s = useStore();
  useNow(60000); // re-render if a new drop lands while the page is open
  const id = params.id;
  const g = groupById(id);
  const latest = latestDropWeek();
  const mem = viewMemory.get(id) || {};
  const [extraWeek] = useState(() => (validWeekParam(query.week) ? query.week : null));
  const [pickedWeek, setPickedWeek] = useState(() => query.week || null);
  const [view, setViewState] = useState(mem.view === 'season' ? 'season' : 'drop');
  const [metric, setMetricState] = useState(mem.metric || 'score');
  const [seasonMetric, setSeasonMetricState] = useState(mem.seasonMetric || 'score');
  const nameRef = useRef(null);
  const compact = useCompactHeader(nameRef, !!g);
  const data = useMemo(() => (g ? buildGroupData(g, latest, extraWeek) : null), [g, latest, extraWeek, s]);

  if (!g || !data) return html`<${GroupNotFound} />`;

  const members = sortMembers(groupMembers(g));
  const week = data.weeks.includes(pickedWeek) ? pickedWeek : data.weeks[0] || null;
  const gw = week ? data.weekData.get(week) : null;
  const nd = nextDrop(now(), s.settings.rolloverHour);
  const hasPill = !!s.activeSessionId;

  const setView = v => { setViewState(v); remember(id, { view: v }); };
  const setMetric = m => { setMetricState(m); remember(id, { metric: m }); };
  const setSeasonMetric = m => { setSeasonMetricState(m); remember(id, { seasonMetric: m }); };
  const setWeek = w => { setPickedWeek(w); replaceQuery(`/groups/${enc(id)}?week=${w}`); };
  const jumpToWeek = w => {
    setView('drop');
    setWeek(w);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
  };

  const rightFor = uid => {
    let tag = null;
    if (view === 'season') {
      const m = data.season.members.find(x => x.userId === uid);
      tag = m && m.stats.wins > 0 ? html`<span class="tag warn">🏆 ${m.stats.wins}</span>` : null;
    } else if (gw) {
      const r = (gw.boards.score || []).find(x => x.userId === uid);
      tag = r ? html`<span class=${cx('tag', r.rank === 1 && 'warn')}>#${r.rank}</span>` : html`<span class="tiny faint">no drop</span>`;
    }
    return html`<span class="row gap-6">${tag}<${Icon} name="chevron-right" size=${16} className="faint" /></span>`;
  };

  const header = html`<${PageHeader}
    title=${html`<span class=${cx('g-htitle', compact && 'on')}>${g.emoji} ${g.name}</span>`}
    back=${CREW_GROUPS}
    right=${html`<button class="icon-btn" onClick=${() => openGroupMenu(g)} aria-label="Group options"><${Icon} name="more" /></button>`}
  />`;

  const nextPill = html`<span class="g-next">
    <${Icon} name="clock" size=${14} />
    ${nd.cooking ? 'Cooking · drops in' : 'Next drop in'} <${Countdown} targetTs=${nd.ts} compact />
  </span>`;

  let body;
  if (!data.weeks.length) body = html`<${NoDropsYet} nd=${nd} />`;
  else if (view === 'season') body = html`<${SeasonView} season=${data.season} metric=${seasonMetric} setMetric=${setSeasonMetric} onWeek=${jumpToWeek} />`;
  else if (gw) body = html`<${DropView} week=${week} weeks=${data.weeks} latest=${latest} gw=${gw} metric=${metric} setMetric=${setMetric} setWeek=${setWeek} />`;
  else body = null;

  return html`<div class=${cx('page pg-groups', hasPill && 'g-has-pill')}>
    ${header}
    <${GroupHero} emoji=${g.emoji} name=${g.name} users=${members} nameRef=${nameRef} extra=${nextPill} />
    ${data.weeks.length > 0 && html`<div class="mt-16"><${Segmented} options=${VIEW_OPTIONS} value=${view} onChange=${setView} /></div>`}
    ${body}
    <${MembersSection} g=${g} members=${members} rightFor=${rightFor} />
  </div>`;
}

// ---- create / edit ------------------------------------------------------------------------------------

function EmojiGrid({ value, onChange }) {
  const list = GROUP_EMOJIS.includes(value) ? GROUP_EMOJIS : [value, ...GROUP_EMOJIS];
  return html`<div class="g-emoji-grid" role="radiogroup" aria-label="Group emoji">
    ${list.map(e => html`<button key=${e} type="button" role="radio" aria-checked=${e === value}
      class=${cx('g-emoji', e === value && 'on')} onClick=${() => onChange(e)}>${e}</button>`)}
  </div>`;
}

/**
 * Shared form for create + edit.
 * candidates: users that can be picked (friends, plus existing non-friend members when editing).
 */
function GroupEditor({ candidates, initial, submitLabel, onSubmit, after }) {
  const [name, setName] = useState(initial.name || '');
  const [emoji, setEmoji] = useState(initial.emoji || GROUP_EMOJIS[0]);
  const [selected, setSelected] = useState(() => (initial.memberIds || []).filter(x => x !== 'me'));
  const [search, setSearch] = useState('');
  const [placeholder] = useState(() => pickOne(NAME_IDEAS));
  const [busy, setBusy] = useState(false);

  const me = getUser('me');
  const byId = new Map(candidates.map(u => [u.id, u]));
  const picked = selected.filter(x => byId.has(x));
  const pickedUsers = picked.map(x => byId.get(x));
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && picked.length > 0 && !busy;
  const q = search.trim().toLowerCase().replace(/^@/, '');
  const shown = q ? candidates.filter(u => matchesQuery(u, q)) : candidates;
  const allOn = candidates.length > 0 && candidates.every(u => picked.includes(u.id));

  const toggle = uid => setSelected(sel => (sel.includes(uid) ? sel.filter(x => x !== uid) : [...sel, uid]));
  const toggleAll = () => setSelected(allOn ? [] : candidates.map(u => u.id));
  const roll = () => setName(pickOne(NAME_IDEAS.filter(x => x !== name)));
  const submit = () => {
    if (!valid) return;
    setBusy(true);
    onSubmit({ name: trimmed.slice(0, NAME_MAX), emoji, memberIds: picked });
  };
  const hint = !trimmed ? 'Give it a name first' : !picked.length ? 'Pick at least one friend' : `${picked.length + 1} people, one leaderboard`;

  return html`<div class="g-editor">
    <${GroupHero} emoji=${emoji} name=${trimmed} placeholder=${placeholder} users=${[me, ...pickedUsers]} />

    <div class="field mt-24">
      <div class="spread">
        <label class="label" for="g-name">Name</label>
        <span class=${cx('tiny num', name.length >= NAME_MAX ? 'g-limit' : 'faint')}>${name.length}/${NAME_MAX}</span>
      </div>
      <div class="input-wrap g-name-wrap">
        <input id="g-name" class="input" type="text" value=${name} maxLength=${NAME_MAX} placeholder=${placeholder}
          autocomplete="off" enterkeyhint="done"
          onInput=${e => setName(e.currentTarget.value.slice(0, NAME_MAX))}
          onKeyDown=${e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <button type="button" class="g-dice" onClick=${roll} aria-label="Suggest a name" title="Suggest a name">🎲</button>
      </div>
    </div>

    <${Section} title="Pick a vibe">
      <${EmojiGrid} value=${emoji} onChange=${setEmoji} />
    </${Section}>

    <${Section} title=${`Who’s in · ${picked.length + 1}`}
        action=${candidates.length > 1 ? (allOn ? 'Clear' : 'Select all') : null} onAction=${toggleAll}>
      ${pickedUsers.length > 0 && html`<div class="hscroll g-selchips">
        ${pickedUsers.map(u => html`<button key=${u.id} type="button" class="g-selchip" onClick=${() => toggle(u.id)} aria-label=${`Remove ${u.name}`}>
          <${Avatar} user=${u} size="xs" /><span>${shortName(u)}</span><${Icon} name="x" size=${14} />
        </button>`)}
      </div>`}
      <div class="input-wrap mt-8">
        <${Icon} name="search" size=${18} />
        <input class="input with-icon" type="search" placeholder="Search your friends" value=${search}
          autocomplete="off" onInput=${e => setSearch(e.currentTarget.value)} />
      </div>
      <div class="card g-picklist mt-12">
        <div class="list-item g-pick">
          <${Avatar} user=${me} size="md" />
          <div class="grow"><div class="primary">You</div><div class="secondary">Always in. It’s your tab.</div></div>
          <span class="g-check lock" aria-hidden="true"><${Icon} name="lock" size=${13} stroke=${2.4} /></span>
        </div>
        ${shown.map(u => {
          const on = picked.includes(u.id);
          return html`<button key=${u.id} type="button" class=${cx('list-item g-pick', on && 'on')} aria-pressed=${on} onClick=${() => toggle(u.id)}>
            <${Avatar} user=${u} size="md" />
            <div class="grow">
              <div class="primary truncate">${u.name}</div>
              <div class="secondary truncate">@${u.handle}${u.notFriend ? ' · not friends anymore' : ''}</div>
            </div>
            <span class="g-check" aria-hidden="true"><${Icon} name="check" size=${16} stroke=${3} /></span>
          </button>`;
        })}
        ${q.length > 0 && shown.length === 0 && html`<div class="g-nomatch small faint">No friends match “${search.trim()}”</div>`}
      </div>
    </${Section}>

    <div class="g-cta">
      <button class="btn btn-primary btn-lg btn-block" disabled=${!valid} onClick=${submit}>${submitLabel}</button>
      <div class="tiny faint center mt-8">${hint}</div>
    </div>
    ${after || null}
  </div>`;
}

export function CreateGroupPage() {
  const s = useStore();
  const friends = listFriends();
  const hasPill = !!s.activeSessionId;

  if (!friends.length) {
    return html`<div class="page pg-groups">
      <${PageHeader} title="New group" back=${CREW_GROUPS} />
      <${EmptyState}
        emoji="🫠"
        title="A group of one is just a diary"
        body="Groups are friends-only. Add a few people first, then come back and make it official."
        action=${html`<button class="btn btn-primary" onClick=${() => navigate('/crew/add')}><${Icon} name="user-plus" size=${18} /> Find friends</button>`}
      />
    </div>`;
  }

  const onCreate = ({ name, emoji, memberIds }) => {
    const g = createGroup({ name, emoji, memberIds });
    navigate(`/groups/${enc(g.id)}`, { replace: true });
    toast(`${g.name} is live — let the rankings begin`, { emoji: g.emoji });
  };

  return html`<div class=${cx('page pg-groups', hasPill && 'g-has-pill')}>
    <${PageHeader} title="New group" subtitle="Your people, ranked every Monday" back=${CREW_GROUPS} />
    <${GroupEditor} candidates=${friends} initial=${{ name: '', emoji: GROUP_EMOJIS[0], memberIds: [] }}
      submitLabel="Create group" onSubmit=${onCreate} />
  </div>`;
}

export function EditGroupPage({ params = {} }) {
  const s = useStore();
  const id = params.id;
  const g = groupById(id);
  const hasPill = !!s.activeSessionId;

  if (!g) return html`<${GroupNotFound} />`;

  const friends = listFriends();
  const friendSet = new Set(friends.map(f => f.id));
  // Existing members who aren't friends any more stay visible so they can be removed.
  const legacy = g.memberIds
    .filter(m => m !== 'me' && !friendSet.has(m))
    .map(m => getUser(m))
    .filter(Boolean)
    .map(u => ({ ...u, notFriend: true }));
  const candidates = [...friends, ...legacy];

  const onSave = ({ name, emoji, memberIds }) => {
    updateGroup(g.id, { name, emoji, memberIds });
    toast('Group updated', { emoji });
    back(`/groups/${enc(g.id)}`);
  };

  const leave = html`<${Section} title="Danger zone" className="g-danger">
    <button class="btn btn-danger btn-block" onClick=${() => confirmLeave(g)}><${Icon} name="logout" size=${18} /> Leave group</button>
    <p class="tiny faint center mt-8">You’ll stop seeing this group’s drops. Everyone else keeps theirs.</p>
  </${Section}>`;

  return html`<div class=${cx('page pg-groups', hasPill && 'g-has-pill')}>
    <${PageHeader} title="Edit group" back=${`/groups/${enc(g.id)}`} />
    <${GroupEditor} key=${g.id} candidates=${candidates} initial=${g} submitLabel="Save changes" onSubmit=${onSave} after=${leave} />
  </div>`;
}
