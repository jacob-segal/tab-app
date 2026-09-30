// Home: the landing screen.
// - Next-drop countdown hero (flips on its own when the drop lands)
// - Fresh-drop CTA, or a summary of the last drop
// - Tonight: start a session / log today, plus the late-night attribution hint
// - Incoming friend requests, friends' drops feed, groups strip, suggestions
//
// Privacy: everything here is for the latest *dropped* week (data.weekStats
// returns null for anything else). The only live counts shown are the user's
// own active session, which the product rules allow.

import { html, useMemo, useRef, useEffect, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import { navigate } from '../router.js';
import {
  Icon, Avatar, AvatarStack, Section, EmptyState, Countdown, UserRow, toast, formatMetric, weekTitle,
} from '../ui.js';
import { CATEGORY_BY_ID, CATEGORY_IDS } from '../config.js';
import {
  nextDrop, weekLabel, formatWeekRange, formatShortDate, weekStartTs, weekEndTs, weekDays, tsAt, addDays,
  nextWeekKey, prevWeekKey, tabDayKey, lateNightInfo, attributeDayKey, formatTime, weekdayLong, weekdayShort,
  formatDuration, dayKeyFromDate,
} from '../time.js';
import {
  getUser, firstName, friendIds, latestDropWeek, weekStats, trendsFor, unseenDrop, circleIds, compareWeek,
  rankOn, listGroups, groupMembers, groupWeek, suggestions, incomingRequests, activeSession, sessionLogs,
  joinedWeekKey,
} from '../data.js';
import { awardsFor, topCategories, totalsOf } from '../stats.js';
import { beginSession } from '../actions.js';
import { sendFriendRequest, getState } from '../store.js';

// ---- helpers ------------------------------------------------------------------------

const clamp01 = x => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const go = path => () => navigate(path);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Props that make a non-button element behave like one (click + Enter/Space). */
function tap(fn, label) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: fn,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
    },
  };
}

/** "Maya", "Maya & You", "Maya, Jordan & 2 more" */
function joinNames(ids, max = 2) {
  const names = ids.map(firstName);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} & ${names.length - max} more`;
}

/** Time/day-aware greeting line under the wordmark. */
function greeting(t, rollover, name) {
  const first = String(name || '').trim().split(/\s+/)[0];
  const who = first ? `, ${first}` : '';
  const d = new Date(t);
  const h = d.getHours();
  if (h < rollover) return `Up late${who}? 🌙`;
  switch (d.getDay()) {
    case 1: return h < 12 ? `Drop day${who} 🎁` : `New week, clean slate${who} ✨`;
    case 2: return `Tuesday${who}. Recovery arc 🧃`;
    case 3: return `Hump day${who} 🐫`;
    case 4: return `Thirsty Thursday${who} 🍻`;
    case 5: return `It’s Friday${who} 🪩`;
    case 6: return `Saturday${who}. Main character energy ✨`;
    default: return h < 16 ? `Sunday scaries${who}? 🫠` : `Sunday reset${who} 🛋️`;
  }
}

/**
 * One-line highlight for a friend's tile: an award they took in the crew
 * (not MVP — the crown covers that), else their top category.
 */
function highlightFor(userId, stats, awards) {
  const won = awardsFor(userId, awards).filter(a => a.id !== 'mvp');
  const pick = won.find(a => a.winnerIds.length === 1) || won[0];
  if (pick) return `${pick.emoji} ${pick.title}`;
  if (!stats || !(stats.total > 0)) return '😇 Stayed in';
  const top = topCategories(stats)[0];
  const c = CATEGORY_BY_ID[top];
  if (!c) return '😇 Stayed in';
  const n = stats.totals[top];
  return `${c.emoji} ${plural(n, c.unit, c.unitPlural)}`;
}

/** Everything the page needs for the latest dropped week `w` (memoized per state change). */
function buildHome(w) {
  const me = getUser('me');
  const myStats = weekStats('me', w);
  const cmp = compareWeek(circleIds(), w);
  const mvp = cmp.awards.find(a => a.id === 'mvp');
  const mvpIds = mvp ? mvp.winnerIds : [];

  const feed = cmp.members
    .filter(m => m.userId !== 'me' && m.stats)
    .map(m => ({ user: getUser(m.userId), stats: m.stats }))
    .filter(r => r.user)
    .sort((a, b) => b.stats.score - a.stats.score || a.user.name.localeCompare(b.user.name))
    .map(r => ({ ...r, mvp: mvpIds.includes(r.user.id), hl: highlightFor(r.user.id, r.stats, cmp.awards) }));

  // A new user's first drop is for the week they joined.
  const jw = joinedWeekKey('me');
  const firstWeek = jw && jw > w ? jw : nextWeekKey(w);

  const groups = listGroups().map(g => {
    const members = groupMembers(g);
    const gw = groupWeek(g.id, w);
    const gMvp = gw ? gw.awards.find(a => a.id === 'mvp') : null;
    const myRank = gw ? rankOn(gw.boards.score, 'me') : null;
    return { id: g.id, name: g.name || 'Untitled', emoji: g.emoji || '🍻', members, mvpIds: gMvp ? gMvp.winnerIds : [], myRank };
  });

  const session = activeSession();
  return {
    me,
    myStats,
    rank: myStats ? rankOn(cmp.boards.score, 'me') : null,
    myAwards: myStats ? awardsFor('me', cmp.awards) : [],
    trends: myStats ? trendsFor('me', w) : null,
    feed,
    firstDropDay: addDays(firstWeek, 7),
    unseen: unseenDrop(),
    nFriends: friendIds().length,
    groups,
    suggestions: suggestions().slice(0, 3),
    requests: incomingRequests(),
    session,
    tally: session ? totalsOf(sessionLogs(session.id)) : null,
  };
}

// ---- page ------------------------------------------------------------------------------

export function HomePage() {
  const s = useStore();
  const t = useNow(1000);
  const rollover = s.settings.rolloverHour;
  const w = latestDropWeek();
  const d = useMemo(() => buildHome(w), [s, w]);

  // When a drop lands while Home is open, celebrate it.
  const prevW = useRef(w);
  useEffect(() => {
    const was = prevW.current;
    prevW.current = w;
    if (!was || w <= was) return;
    const story = !!weekStats('me', w) && !getState().seenDrops[w];
    toast(`${weekLabel(w)} just dropped`, {
      emoji: '🎁',
      duration: 6000,
      action: { label: 'Open', onClick: () => navigate(story ? `/drop/${w}/story` : `/drop/${w}`) },
    });
  }, [w]);

  const nd = nextDrop(t, rollover);

  return html`<div class="page pg-home">
    <header class="hm-top">
      <div class="hm-wordmark" aria-label="Tab">Tab</div>
      <div class="row gap-6">
        <button class="hm-me" onClick=${go('/you')} aria-label="Your profile"><${Avatar} user=${d.me} size="sm" /></button>
        <button class="icon-btn" onClick=${go('/settings')} aria-label="Settings"><${Icon} name="settings" size=${20} /></button>
      </div>
    </header>
    <p class="hm-greet">${greeting(t, rollover, s.me.name)}</p>

    <div class="hm-stack">
      ${d.unseen && html`<${NewDropCard} w=${d.unseen} feed=${d.feed} />`}
      <${DropHero} t=${t} nd=${nd} rollover=${rollover} />
      ${!d.unseen && html`<${LastDropCard} d=${d} w=${w} t=${t} />`}
      <${TonightCard} t=${t} rollover=${rollover} ses=${d.session} tally=${d.tally} locationOn=${!!s.settings.locationEnabled} />
      ${d.requests.length > 0 && html`<${RequestsBanner} requests=${d.requests} />`}
    </div>

    <${FriendsFeed} d=${d} w=${w} />
    <${GroupsStrip} groups=${d.groups} />
    ${d.suggestions.length > 0 && html`<${SuggestedTeaser} list=${d.suggestions} />`}
  </div>`;
}

// ---- hero: next drop countdown -----------------------------------------------------------

function DropHero({ t, nd, rollover }) {
  const cooking = nd.cooking;
  const dropDay = addDays(nd.weekKey, 7);
  const todayKey = tabDayKey(t, rollover);

  // Normal: 7 story-style segments for the current week (DST-safe per tab day).
  // Cooking: an "oven timer" from the Monday rollover to noon.
  const days = weekDays(nd.weekKey).map(dk => {
    const a = tsAt(dk, rollover), b = tsAt(addDays(dk, 1), rollover);
    return { dk, f: clamp01((t - a) / (b - a)) };
  });
  const ws = weekStartTs(nd.weekKey, rollover), we = weekEndTs(nd.weekKey, rollover);
  const weekPct = Math.round(clamp01((t - ws) / (we - ws)) * 100);
  const ovenPct = clamp01((t - we) / (nd.ts - we)) * 100;

  return html`<section class=${cx('card-hero hm-hero', cooking && 'is-cooking')} aria-label="Next drop">
    <div class="hm-hero-top">
      <span class="hm-hero-label"><${Icon} name="gift" size=${14} stroke=${2.4} /> Next drop</span>
      <span class="hm-hero-pill">${cooking ? 'Today · 12 PM' : `Mon ${formatShortDate(dropDay)} · 12 PM`}</span>
    </div>

    ${cooking
      ? html`<div class="hm-hero-title">${weekLabel(nd.weekKey)} is cooking 🍳</div>
          <p class="hm-hero-sub">Last call to fix Sunday · ${formatWeekRange(nd.weekKey)}</p>`
      : html`<div class="hm-hero-title">${weekLabel(nd.weekKey)}</div>
          <p class="hm-hero-sub">${formatWeekRange(nd.weekKey)}</p>`}

    <div class="hm-hero-count"><${Countdown} targetTs=${nd.ts} /></div>

    ${cooking
      ? html`<div class="hm-oven">
            <div class="hm-oven-bar" role="progressbar" aria-label="Cooking progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(ovenPct)}>
              <i style=${`width:${ovenPct}%`}></i>
            </div>
            <div class="hm-oven-lbl"><span>🍳 In the oven</span><span>Serving at noon</span></div>
          </div>
          <button class="btn btn-white btn-block hm-fix" onClick=${go(`/track?day=${addDays(nd.weekKey, 6)}`)}>
            <${Icon} name="edit" size=${16} /> Fix last week
          </button>`
      : html`<div class="hm-days" role="progressbar" aria-label="How far through the week" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${weekPct}>
          ${days.map(({ dk, f }) => html`<div key=${dk} class=${cx('hm-day', dk === todayKey && 'today', dk < todayKey && 'past')}>
            <div class="hm-seg"><i style=${`width:${f * 100}%`}></i></div>
            <span>${weekdayShort(dk)}</span>
          </div>`)}
        </div>`}

    <p class="hm-hero-foot"><${Icon} name="lock" size=${12} stroke=${2.4} /> Drops Mondays at 12 PM · no peeking till then</p>
  </section>`;
}

// ---- drop cards ------------------------------------------------------------------------------

function NewDropCard({ w, feed }) {
  const open = () => navigate(`/drop/${w}/story`);
  const friends = feed.map(r => r.user);
  // Whole card is a pointer target; the Open button is the keyboard/a11y target
  // (no role=button on the card, so interactive elements aren't nested).
  return html`<section class="hm-dropnew" onClick=${open} aria-label=${`Your ${weekLabel(w)} drop`}>
    <div class="hm-confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <span class="tag brand hm-newtag"><${Icon} name="sparkles" size=${12} stroke=${2.4} /> NEW DROP</span>
    <div class="hm-dropnew-title">Your ${weekLabel(w)} drop is here 🎁</div>
    <p class="small muted mt-4">${formatWeekRange(w)} · the receipts are in</p>
    <div class="hm-dropnew-foot">
      ${friends.length > 0
        ? html`<${AvatarStack} users=${friends} max=${5} size="sm" />
            <span class="small muted truncate">${plural(friends.length, 'friend', 'friends')} dropped too</span>`
        : html`<span class="small faint">Just you this week — add friends to compare</span>`}
    </div>
    <button class="btn btn-white btn-block btn-lg hm-open" onClick=${e => { e.stopPropagation(); open(); }}>
      <${Icon} name="play" size=${14} /> Open
    </button>
  </section>`;
}

function LastDropCard({ d, w, t }) {
  if (!d.myStats) return html`<${FirstDropCard} d=${d} w=${w} t=${t} />`;
  const { myStats, rank, myAwards, trends } = d;
  const hasRank = rank && rank.of >= 2;
  const delta = trends && trends.score ? trends.score.delta : null;
  const deltaCls = delta === null || delta === 0 ? 'faint' : delta > 0 ? 'up' : 'down';
  const absDelta = delta === null ? 0 : Math.abs(delta);
  const deltaTxt = delta === null ? 'new' : delta === 0 ? 'same' : `${absDelta >= 100 ? Math.round(absDelta) : absDelta}`;
  const deltaArrow = delta ? html`<span class="hm-arrow">${delta > 0 ? '▲' : '▼'}</span>` : null;
  const shownAwards = myAwards.slice(0, 3);

  return html`<section class="card clickable hm-last" ...${tap(go(`/drop/${w}`), `Open your ${weekLabel(w)} drop`)}>
    <div class="spread">
      <div class="grow">
        <div class="hm-kicker">Last drop</div>
        <div class="h3 truncate">${weekTitle(w)}</div>
      </div>
      <span class="faint"><${Icon} name="chevron-right" size=${20} /></span>
    </div>

    <div class="hm-last-stats">
      <div class="hm-stat">
        <div class="hm-stat-v grad-text">${formatMetric('score', myStats.score)}</div>
        <div class="hm-stat-l">Tab Score</div>
      </div>
      <div class="hm-stat">
        <div class="hm-stat-v">${hasRank ? `#${rank.rank}` : '—'}</div>
        <div class="hm-stat-l">${hasRank ? `of ${rank.of} in your crew` : 'rank needs a crew'}</div>
      </div>
      <div class="hm-stat">
        <div class=${cx('hm-stat-v sm', deltaCls)}>${deltaArrow}${deltaTxt}</div>
        <div class="hm-stat-l">vs ${weekLabel(prevWeekKey(w))}</div>
      </div>
    </div>

    ${myStats.total === 0 && html`<p class="small muted mt-12">A zero week. Monk mode unlocked 🧘</p>`}
    ${shownAwards.length > 0
      ? html`<div class="hm-awards">
          ${shownAwards.map(a => html`<span class="hm-award" key=${a.id}>${a.emoji} ${a.title}</span>`)}
          ${myAwards.length > shownAwards.length && html`<span class="hm-award more">+${myAwards.length - shownAwards.length}</span>`}
        </div>`
      : hasRank && html`<p class="small faint mt-12">No hardware this week. The trophy case is patient 🏆</p>`}
  </section>`;
}

function FirstDropCard({ d, w, t }) {
  const today = dayKeyFromDate(new Date(t));
  const when = d.firstDropDay === today ? 'today at 12 PM' : `Monday, ${formatShortDate(d.firstDropDay)} at 12 PM`;
  const crewHasDrop = d.feed.length > 0;
  return html`<section class="card hm-first">
    <div class="hm-first-emoji" aria-hidden="true">🥚</div>
    <div class="hm-kicker">Your first drop</div>
    <div class="h3 mt-4">Lands ${when}</div>
    <p class="small muted mt-8">Log as you go. Nobody sees a thing — not even you — until your week drops.</p>
    <div class="mt-16">
      ${crewHasDrop
        ? html`<button class="btn btn-outline btn-block" onClick=${go(`/drop/${w}`)}><${Icon} name="users" size=${18} /> See the crew’s drop</button>`
        : html`<button class="btn btn-outline btn-block" onClick=${go('/crew/add')}><${Icon} name="user-plus" size=${18} /> Add your crew</button>`}
    </div>
  </section>`;
}

// ---- tonight ------------------------------------------------------------------------------

function TonightCard({ t, rollover, ses, tally, locationOn }) {
  const info = lateNightInfo(t, rollover);
  const countsAs = attributeDayKey(t, rollover, ses);
  const sessionCarry = !!ses && countsAs !== info.tabDayKey;
  const showHint = info.late || countsAs !== info.calendarDayKey;
  const hint = `It’s ${formatTime(t)} — ${sessionCarry ? 'this session ' : ''}still counts as ${weekdayLong(countsAs)} night 🌙`;
  const tallyCats = tally ? CATEGORY_IDS.filter(c => tally.totals[c] > 0) : [];

  return html`<section class="card hm-tonight" aria-label="Tonight">
    <div class="spread">
      <div class="h3">${info.late ? 'Still out?' : 'Tonight'}</div>
      <span class="tag">${weekdayShort(countsAs).toUpperCase()} NIGHT</span>
    </div>

    ${ses
      ? html`<button class="hm-live" onClick=${go('/session')}>
          <span class="live-dot"></span>
          <div class="grow">
            <div class="bold truncate">${ses.name ? `${ses.name} · ` : 'Session live · '}${formatDuration(t - ses.start)}</div>
            ${tallyCats.length > 0
              ? html`<div class="hm-tally">${tallyCats.map(c => html`<span key=${c} class=${`cat-${c}`}>${CATEGORY_BY_ID[c].emoji} ${tally.totals[c]}</span>`)}</div>`
              : html`<div class="small muted">Nothing logged yet — first round?</div>`}
          </div>
          <${Icon} name="chevron-right" size=${20} />
        </button>`
      : html`<div class="hm-actions">
          <button class="hm-action primary" onClick=${() => { beginSession(); }}>
            <span class="hm-action-ic"><${Icon} name="play" size=${16} /></span>
            <b>Start a session</b>
            <small>${locationOn ? 'Maps your route + spots 📍' : 'Keeps the whole night on one day'}</small>
          </button>
          <button class="hm-action" onClick=${go('/track')}>
            <span class="hm-action-ic"><${Icon} name="plus" size=${18} stroke=${2.6} /></span>
            <b>Log today</b>
            <small>${info.late ? `Counts toward ${weekdayShort(countsAs)}` : 'Tap in what you had'}</small>
          </button>
        </div>`}

    ${showHint && html`<div class="banner late hm-late" role="note">
      <span class="hm-late-ic"><${Icon} name="clock" size=${18} /></span>
      <span class="small">${hint}</span>
    </div>`}

    ${!ses && !locationOn && html`<button class="hm-loc" onClick=${go('/settings')}>
      <${Icon} name="map-pin" size=${14} /> Want a map of your night? Turn on location →
    </button>`}
  </section>`;
}

// ---- friend requests ---------------------------------------------------------------------

function RequestsBanner({ requests }) {
  const n = requests.length;
  const ids = requests.map(r => r.id);
  return html`<button class="banner hm-req" onClick=${go('/crew')}>
    <${AvatarStack} users=${requests.map(r => r.user)} max=${3} size="sm" />
    <div class="grow">
      <div class="bold">${plural(n, 'friend request', 'friend requests')}</div>
      <div class="small muted truncate">${joinNames(ids)} ${n === 1 ? 'wants' : 'want'} in on your tab</div>
    </div>
    <${Icon} name="chevron-right" size=${20} />
  </button>`;
}

// ---- friends' drops feed -----------------------------------------------------------------

function FriendsFeed({ d, w }) {
  const top = d.feed.slice(0, 8);
  const title = 'Friends’ drops';

  if (d.nFriends === 0) {
    return html`<${Section} title=${title}>
      <div class="card hm-empty">
        <${EmptyState} emoji="🫂" title="Solo tab? Bold."
          body="Add your crew and every Monday you’ll see who really went off."
          action=${html`<button class="btn btn-primary" onClick=${go('/crew/add')}><${Icon} name="user-plus" size=${18} /> Add friends</button>`} />
      </div>
    </${Section}>`;
  }

  if (top.length === 0) {
    return html`<${Section} title=${title}>
      <div class="card hm-empty">
        <${EmptyState} emoji="⏳" title="No crew drops yet"
          body=${`Nobody in your crew has a ${weekLabel(w)} drop. New friends show up after their first Monday.`} />
      </div>
    </${Section}>`;
  }

  return html`<${Section} title=${title} action="See all" onAction=${go(`/drop/${w}`)}>
    <p class="hm-sub">${weekTitle(w)} · ranked by Tab Score</p>
    <div class="hm-fgrid">
      ${top.map((r, i) => html`<button key=${r.user.id} class=${cx('hm-ftile', r.mvp && 'mvp')}
          style=${`--hue:${r.user.avatar ? r.user.avatar.hue : 265};--i:${i}`}
          onClick=${go(`/u/${r.user.id}/week/${w}`)}
          aria-label=${`${r.user.name}: ${formatMetric('score', r.stats.score)} points`}>
        ${r.mvp && html`<span class="hm-crown" title="Tab MVP">👑</span>`}
        <${Avatar} user=${r.user} size="md" />
        <div class="hm-fname truncate">${r.user.name.split(' ')[0]}</div>
        <div class="hm-fscore"><b>${formatMetric('score', r.stats.score)}</b><span>pts</span></div>
        <div class="hm-fhl truncate">${r.hl}</div>
      </button>`)}
    </div>
    ${d.feed.length > top.length && html`<button class="btn btn-ghost btn-block hm-more" onClick=${go(`/drop/${w}`)}>
      See all ${d.feed.length} <${Icon} name="chevron-right" size=${16} />
    </button>`}
  </${Section}>`;
}

// ---- groups strip -------------------------------------------------------------------------

function GroupsStrip({ groups }) {
  const empty = groups.length === 0;
  return html`<${Section} title="Groups" action=${empty ? null : 'See all'} onAction=${go('/crew?tab=groups')}>
    <div class="hscroll hm-groups">
      ${groups.map(g => {
        const mvpLine = g.mvpIds.length > 0
          ? `👑 ${joinNames(g.mvpIds, 1)}`
          : g.members.length < 2 ? '👀 Just you so far' : '⏳ No drop yet';
        const rankLine = g.myRank && g.myRank.of >= 2
          ? `You’re #${g.myRank.rank} of ${g.myRank.of}`
          : plural(g.members.length, 'member', 'members');
        return html`<button key=${g.id} class="hm-gcard" onClick=${go(`/groups/${g.id}`)} aria-label=${`Group ${g.name}`}>
          <div class="spread">
            <span class="hm-gemoji">${g.emoji}</span>
            <${AvatarStack} users=${g.members} max=${3} size="xs" />
          </div>
          <div class="hm-gname truncate">${g.name}</div>
          <div class="hm-gmvp truncate">${mvpLine}</div>
          <div class="tiny faint truncate">${rankLine}</div>
        </button>`;
      })}
      <button class=${cx('hm-gcard hm-gnew', empty && 'wide')} onClick=${go('/groups/new')}>
        <span class="hm-gplus"><${Icon} name="plus" size=${20} stroke=${2.6} /></span>
        <span class="bold">New group</span>
        ${empty && html`<span class="small faint">Your floor, your team, your roomies — ranked every Monday.</span>`}
      </button>
    </div>
  </${Section}>`;
}

// ---- suggested friends ------------------------------------------------------------------------

function SuggestedTeaser({ list }) {
  const add = (e, u) => {
    e.stopPropagation();
    sendFriendRequest(u.id);
    toast(`Request sent to ${u.name.split(' ')[0]}`, { emoji: '👋' });
  };
  return html`<${Section} title="People you may know" action="See all" onAction=${go('/crew/suggested')}>
    <div class="card hm-sugg">
      <div class="list">
        ${list.map(x => html`<${UserRow} key=${x.user.id} user=${x.user}
          subtitle=${x.reasons.join(' · ')}
          onClick=${go(`/u/${x.user.id}`)}
          right=${html`<button class="btn btn-sm btn-primary hm-add" onClick=${e => add(e, x.user)} aria-label=${`Add ${x.user.name}`}>
            <${Icon} name="user-plus" size=${16} /> Add
          </button>`} />`)}
      </div>
    </div>
  </${Section}>`;
}
