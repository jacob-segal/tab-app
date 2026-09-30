// Crew pages: friends + requests + suggestions (CrewPage), search/invite
// (AddFriendsPage), people you may know (SuggestedPage), someone's profile
// (ProfilePage) and a friend's dropped week with a head-to-head (FriendWeekPage).
//
// Privacy (see ARCHITECTURE.md): only dropped weeks are ever shown (data.weekStats
// returns null otherwise), only for friends, and only spot *names*.

import { html, useState, useEffect, useRef, useMemo, cx } from '../lib.js';
import { useStore } from '../hooks.js';
import { navigate } from '../router.js';
import { now, onClockChange } from '../clock.js';
import { CATEGORY_BY_ID, CATEGORY_IDS } from '../config.js';
import {
  weekLabel, weekNumber, isDropped, dropTs, formatAgo, formatDropMoment, weekKeyOf, nextDrop,
} from '../time.js';
import { topCategories } from '../stats.js';
import {
  getUser, listFriends, relationTo, incomingRequests, outgoingRequests, mutualFriendIds, searchPeople,
  suggestions, spotName, mySpotIds, droppedWeeks, latestDropWeek, thisWeek, weekStats, circleIds,
  compareWeek, rankOn, listGroups, groupsWith, groupMembers, groupWeek, firstName,
} from '../data.js';
import {
  getState, sendFriendRequest, cancelFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, dismissSuggestion,
} from '../store.js';
import {
  Icon, Avatar, AvatarStack, PageHeader, Section, EmptyState, Segmented, Countdown, toast, openSheet,
  confirmSheet, UserRow, METRIC_BY_ID, formatMetric, WeekPicker, weekTitle, copyText, shareText,
} from '../ui.js';
import { WeekSummary } from '../components/week-summary.js';

// ---- small helpers -----------------------------------------------------------------

const ROOT = 'page pg-crew';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstOf = u => (u ? (u.isMe ? 'You' : String(u.name || '?').split(' ')[0]) : '?');
const hueOf = u => (u && u.avatar && Number.isFinite(u.avatar.hue) ? u.avatar.hue : 265);
const fmtScore = v => formatMetric('score', v || 0);
const round1 = n => Math.round(n * 10) / 10;
const stop = fn => e => { e.stopPropagation(); fn(e); };
const metricValue = (st, m) => (CATEGORY_IDS.includes(m) ? st.totals[m] || 0 : st[m] || 0);
const isWeekKey = w => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) && weekKeyOf(w) === w;
const metaLine = u => [u.year, u.school].filter(Boolean).join(' · ');

/** Props for a non-button element that should act like one (keyboard + click). */
const clickProps = fn => ({
  role: 'button',
  tabIndex: 0,
  onClick: fn,
  onKeyDown: e => {
    if (e.target !== e.currentTarget) return; // let nested buttons handle their own keys
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
  },
});

/** "Jordan, Tyler + 2 more" */
function namesLine(users, max = 2) {
  const names = users.slice(0, max).map(firstOf);
  const rest = users.length - names.length;
  return rest > 0 ? `${names.join(', ')} + ${rest} more` : names.join(' & ');
}

const chevron = () => html`<span class="cr-chev"><${Icon} name="chevron-right" size=${18} /></span>`;

/**
 * suggestions() drops people the moment you request them. Keep anyone we've
 * already shown on this screen in place (with their new "Requested"/"Friends"
 * button) unless they were dismissed — so cards don't vanish mid-tap.
 */
function useStickySuggestions(keepRelations) {
  const seen = useRef(new Map());
  const live = suggestions();
  const liveIds = new Set();
  for (const e of live) { seen.current.set(e.user.id, e); liveIds.add(e.user.id); }
  const dismissed = new Set(getState().dismissedSuggestions || []);
  return [...seen.current.values()].filter(e => liveIds.has(e.user.id)
    || (!dismissed.has(e.user.id) && keepRelations.includes(relationTo(e.user.id))));
}
const KEEP_PENDING = ['outgoing'];
const KEEP_ALL = ['outgoing', 'friend'];

/** Re-render once `ts` passes (e.g. the moment a week drops) and on clock changes. */
function useRerenderAt(ts) {
  const [n, force] = useState(0);
  useEffect(() => {
    const off = onClockChange(() => force(x => x + 1));
    const ms = ts ? ts - now() : -1;
    const t = ms > 0 && ms < 2147000000 ? setTimeout(() => force(x => x + 1), ms + 300) : null;
    return () => { off(); if (t) clearTimeout(t); };
  }, [ts, n]);
}

function hideSuggestion(u) {
  dismissSuggestion(u.id);
  toast(`Hid ${firstOf(u)}. They'll never know`, { emoji: '🤫' });
}

// ---- relation button ---------------------------------------------------------------

/**
 * Add / Requested / Accept / Friends — reflects relationTo(id).
 * onFriendClick: when given, the "Friends" state opens it (profile menu);
 * otherwise it's a disabled "Friends ✓".
 */
function RelationButton({ id, block = false, onFriendClick }) {
  const rel = relationTo(id);
  const prev = useRef(rel);
  const changed = prev.current !== rel;
  useEffect(() => { prev.current = rel; });
  if (rel === 'me') return null;
  const u = getUser(id);
  const first = firstOf(u);
  const cls = (...extra) => cx('btn cr-act', block && 'btn-block', changed && 'pop', ...extra);

  if (rel === 'friend') {
    if (onFriendClick) {
      return html`<button key="friend" class=${cls('is-friends')} onClick=${stop(onFriendClick)} aria-haspopup="dialog">
        <${Icon} name="check" size=${16} stroke=${2.6} /> Friends <${Icon} name="chevron-down" size=${16} />
      </button>`;
    }
    return html`<button key="friend" class=${cls('is-friends')} disabled aria-label=${`You and ${first} are friends`}>
      Friends <${Icon} name="check" size=${16} stroke=${2.6} />
    </button>`;
  }
  if (rel === 'outgoing') {
    return html`<button key="outgoing" class=${cls('is-requested')} aria-label=${`Cancel request to ${first}`}
      onClick=${stop(() => { cancelFriendRequest(id); toast('Request unsent. Smooth.', { emoji: '🫣' }); })}>
      <${Icon} name="clock" size=${15} /> Requested
    </button>`;
  }
  if (rel === 'incoming') {
    return html`<button key="incoming" class=${cls('btn-primary')}
      onClick=${stop(() => { acceptFriendRequest(id); toast(`${first} is in your crew now`, { emoji: '🤝' }); })}>
      <${Icon} name="check" size=${16} stroke=${2.6} /> Accept
    </button>`;
  }
  return html`<button key="none" class=${cls('btn-primary')} aria-label=${`Add ${first}`}
    onClick=${stop(() => { sendFriendRequest(id); toast(`Request sent to ${first}`, { emoji: '📨' }); })}>
    <${Icon} name="user-plus" size=${16} /> Add
  </button>`;
}

// ---- sheets ---------------------------------------------------------------------------

function openMutuals(user, mutuals) {
  openSheet(close => html`<div class="pg-crew">
    <div class="list">
      ${mutuals.map(m => html`<${UserRow} key=${m.id} user=${m} subtitle=${`@${m.handle}`}
        onClick=${() => { close(); navigate(`/u/${m.id}`); }} right=${chevron()} />`)}
    </div>
  </div>`, { title: `You & ${firstOf(user)} both know` });
}

async function confirmRemove(user) {
  const first = firstOf(user);
  const ok = await confirmSheet({
    title: `Remove ${first}?`,
    body: `You'll stop seeing each other's drops, and ${first} gets taken out of your groups.`,
    confirmLabel: 'Remove from crew',
    danger: true,
  });
  if (ok) { removeFriend(user.id); toast(`${first} is out of the crew`, { emoji: '👋' }); }
}

function openFriendMenu(user) {
  const latest = latestDropWeek();
  openSheet(close => html`<div class="pg-crew">
    <div class="cr-menu-head">
      <${Avatar} user=${user} size="md" />
      <div class="grow">
        <div class="bold truncate">${user.name}</div>
        <div class="tiny faint">In your crew · swapping drops every Monday</div>
      </div>
    </div>
    <div class="stack-8 mt-16">
      <button class="btn btn-block btn-lg btn-outline" onClick=${() => { close(); navigate(`/u/${user.id}/week/${latest}`); }}>
        <${Icon} name="chart" size=${18} /> Compare latest drop
      </button>
      <button class="btn btn-block btn-lg btn-danger" onClick=${() => { close(); confirmRemove(user); }}>
        <${Icon} name="logout" size=${18} /> Remove from crew
      </button>
      <button class="btn btn-block btn-ghost" onClick=${close}>Never mind</button>
    </div>
  </div>`);
}

// ============================================================================================
// /crew
// ============================================================================================

export function CrewPage({ query }) {
  const s = useStore();
  const tab = query && query.tab === 'groups' ? 'groups' : 'friends';
  const pymk = useStickySuggestions(KEEP_PENDING).slice(0, 6);
  const latest = latestDropWeek();
  const crewBoard = useMemo(() => compareWeek(circleIds(), latest).boards.score, [s, latest]);

  const friends = listFriends();
  const groups = listGroups();
  const incoming = incomingRequests();
  const outgoing = outgoingRequests();
  const drop = nextDrop(now(), s.settings.rolloverHour);

  const setTab = v => navigate(v === 'groups' ? '/crew?tab=groups' : '/crew', { replace: true });
  const segLabel = (label, n) => html`${label}${n > 0 && html`<span class="cr-segcount">${n}</span>`}`;

  const header = html`<${PageHeader} big title="Crew"
    subtitle=${html`Next drop in <${Countdown} targetTs=${drop.ts} compact />`}
    right=${html`<button class="icon-btn" aria-label="Add friends" onClick=${() => navigate('/crew/add')}><${Icon} name="user-plus" size=${20} /></button>`} />`;

  const seg = html`<div class="cr-seg"><${Segmented} value=${tab} onChange=${setTab} options=${[
    { value: 'friends', label: segLabel('Friends', friends.length) },
    { value: 'groups', label: segLabel('Groups', groups.length) },
  ]} /></div>`;

  if (tab === 'groups') {
    return html`<div class=${ROOT}>
      ${header}${seg}
      ${groups.length > 0
        ? html`<div class="stack-12">${groups.map(g => html`<${GroupCard} key=${g.id} g=${g} w=${latest} />`)}</div>
          <button class="cr-newgroup" onClick=${() => navigate('/groups/new')}><${Icon} name="plus" size=${20} /> Create a group</button>`
        : html`<div class="card cr-empty-card"><${EmptyState} emoji="🍻" title="No groups yet"
            body="Floor, team, roommates, the group chat — make a group and get a leaderboard + awards every Monday."
            action=${html`<button class="btn btn-primary" onClick=${() => navigate('/groups/new')}><${Icon} name="plus" size=${18} /> Create a group</button>`} /></div>`}
    </div>`;
  }

  return html`<div class=${ROOT}>
    ${header}${seg}

    <button class="cr-searchbtn" onClick=${() => navigate('/crew/add')}>
      <${Icon} name="search" size=${18} /><span class="truncate">Search by name or @handle</span>
    </button>

    ${incoming.length > 0 && html`<${Section} title=${html`Requests <span class="badge cr-badge">${incoming.length}</span>`}>
      <div class="card cr-reqs">
        ${incoming.map(r => html`<${RequestRow} key=${r.id} req=${r} />`)}
      </div>
    </${Section}>`}

    ${outgoing.length > 0 && html`<${Section} title="Pending">
      <div class="card cr-list cr-compact">
        ${outgoing.map(r => html`<${UserRow} key=${r.id} user=${r.user}
          subtitle=${`Requested ${formatAgo(r.at, now())}`}
          onClick=${() => navigate(`/u/${r.id}`)}
          right=${html`<button class="btn btn-ghost cr-act" aria-label=${`Cancel request to ${firstOf(r.user)}`}
            onClick=${stop(() => { cancelFriendRequest(r.id); toast('Request unsent. Smooth.', { emoji: '🫣' }); })}>Cancel</button>`} />`)}
      </div>
      ${s.settings.demoMode && html`<p class="tiny faint mt-8">Demo mode: they'll accept in a few seconds.</p>`}
    </${Section}>`}

    ${pymk.length > 0 && html`<${Section} title="People you may know" action="See all" onAction=${() => navigate('/crew/suggested')}>
      <div class="hscroll cr-pk-row">
        ${pymk.map(e => html`<${SuggestionCard} key=${e.user.id} entry=${e} />`)}
      </div>
    </${Section}>`}

    <${Section} title=${friends.length > 0 ? `Your crew · ${friends.length}` : 'Your crew'}>
      ${friends.length > 0
        ? html`<div class="card cr-list">
            ${friends.map(f => html`<${UserRow} key=${f.id} user=${f}
              subtitle=${friendSubtitle(f.id, latest, crewBoard)}
              onClick=${() => navigate(`/u/${f.id}`)} right=${chevron()} />`)}
          </div>`
        : html`<div class="card cr-empty-card"><${EmptyState} emoji="🫂" title="Your crew is empty"
            body="Tab hits different with witnesses. Add friends and compare drops every Monday at noon."
            action=${html`<button class="btn btn-primary" onClick=${() => navigate('/crew/add')}><${Icon} name="user-plus" size=${18} /> Invite friends</button>`} /></div>`}
    </${Section}>
  </div>`;
}

function friendSubtitle(id, w, board) {
  const r = rankOn(board, id);
  if (!r) return 'No drop yet';
  return `${weekLabel(w)} · ${fmtScore(r.value)} pts · #${r.rank} in crew${r.rank === 1 ? ' 👑' : ''}`;
}

function RequestRow({ req }) {
  const u = req.user;
  const first = firstOf(u);
  const m = mutualFriendIds(u.id).length;
  const sub = [m > 0 ? plural(m, 'mutual friend') : `@${u.handle}`, formatAgo(req.at, now())].join(' · ');
  return html`<${UserRow} user=${u} subtitle=${sub} onClick=${() => navigate(`/u/${u.id}`)} right=${html`<div class="row gap-6">
    <button class="btn btn-primary cr-act" onClick=${stop(() => { acceptFriendRequest(u.id); toast(`${first} is in your crew now`, { emoji: '🤝' }); })}>Accept</button>
    <button class="icon-btn" aria-label=${`Decline ${first}`} onClick=${stop(() => { declineFriendRequest(u.id); toast('Request declined. Cold.', { emoji: '🧊' }); })}>
      <${Icon} name="x" size=${18} />
    </button>
  </div>`} />`;
}

function SuggestionCard({ entry }) {
  const u = entry.user;
  const why = entry.reasons && entry.reasons.length ? entry.reasons[0] : 'On Tab';
  return html`<div class="card cr-pk" ...${clickProps(() => navigate(`/u/${u.id}`))} aria-label=${`${u.name}, ${why}`}>
    <button class="cr-pk-x" aria-label=${`Hide ${u.name}`} onClick=${stop(() => hideSuggestion(u))}><${Icon} name="x" size=${15} /></button>
    <${Avatar} user=${u} size="lg" />
    <div class="cr-pk-name truncate">${firstOf(u)}</div>
    <div class="cr-pk-why">${why}</div>
    <${RelationButton} id=${u.id} block />
  </div>`;
}

function GroupCard({ g, w }) {
  const members = groupMembers(g);
  const gw = groupWeek(g.id, w);
  const mvp = gw ? gw.awards.find(a => a.id === 'mvp') : null;
  const myRank = gw ? rankOn(gw.boards.score, 'me') : null;
  const iWon = !!mvp && mvp.winnerIds.includes('me');
  return html`<div class="card clickable cr-group" ...${clickProps(() => navigate(`/groups/${g.id}`))}>
    <div class="row gap-12">
      <span class="cr-group-emoji">${g.emoji || '🍻'}</span>
      <div class="grow">
        <div class="h3 truncate">${g.name}</div>
        <div class="row gap-6 mt-4">
          <${AvatarStack} users=${members} max=${5} size="xs" />
          <span class="tiny faint">${plural(members.length, 'member')}</span>
        </div>
      </div>
      ${chevron()}
    </div>
    <div class="cr-group-foot">
      ${mvp
        ? html`<span class="truncate">👑 MVP last drop: <b>${mvp.winnerIds.map(firstName).join(' & ')}</b>${iWon ? ' 😈' : ''}</span>`
        : html`<span class="truncate faint">👑 MVP gets crowned once 2+ members have a drop</span>`}
      ${myRank && html`<span class="tag">You #${myRank.rank}/${myRank.of}</span>`}
    </div>
  </div>`;
}

// ============================================================================================
// /crew/add
// ============================================================================================

export function AddFriendsPage() {
  const s = useStore();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const sugg = useStickySuggestions(KEEP_ALL);
  useEffect(() => {
    const t = setTimeout(() => { try { inputRef.current && inputRef.current.focus({ preventScroll: true }); } catch { /* ignore */ } }, 80);
    return () => clearTimeout(t);
  }, []);

  const query = q.trim();
  const results = query ? searchPeople(query) : [];
  const me = getUser('me');
  const handle = (me && me.handle) || 'you';
  const link = `https://tab.app/add/${encodeURIComponent(handle)}`;

  const personRow = (u, subtitle) => html`<${UserRow} key=${u.id} user=${u} subtitle=${subtitle}
    onClick=${() => navigate(`/u/${u.id}`)} right=${html`<${RelationButton} id=${u.id} />`} />`;

  let body;
  if (query) {
    body = results.length > 0
      ? html`<div class="card cr-list mt-16">${results.map(u => personRow(u, searchSubtitle(u)))}</div>`
      : html`<${EmptyState} emoji="🔍" title=${`No one called “${query}” yet`}
          body="They're probably not on Tab. Send them your link and fix that." />`;
  } else {
    body = sugg.length > 0
      ? html`<${Section} title="Suggested for you" action=${sugg.length > 5 ? 'See all' : null} onAction=${() => navigate('/crew/suggested')}>
          <div class="card cr-list">${sugg.slice(0, 5).map(e => personRow(e.user, (e.reasons && e.reasons[0]) || `@${e.user.handle}`))}</div>
        </${Section}>`
      : html`<p class="small faint center mt-24">Search by name or @handle — or send your link below.</p>`;
  }

  return html`<div class=${ROOT}>
    <${PageHeader} title="Add friends" back="/crew" />
    <div class="input-wrap cr-search">
      <${Icon} name="search" size=${18} />
      <input ref=${inputRef} class="input with-icon" type="text" inputmode="search" enterkeyhint="search"
        placeholder="Search by name or @handle" aria-label="Search people" value=${q}
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck=${false}
        onInput=${e => setQ(e.currentTarget.value)}
        onKeyDown=${e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setQ(''); }} />
      ${q.length > 0 && html`<button class="cr-search-clear" aria-label="Clear search"
        onClick=${() => { setQ(''); inputRef.current && inputRef.current.focus(); }}><${Icon} name="x" size=${16} /></button>`}
    </div>
    ${s.settings.demoMode && html`<div class="lock-note cr-demo-note"><${Icon} name="zap" size=${16} /> Demo mode: requests get auto-accepted in a few seconds</div>`}

    ${body}

    <div class="card card-night cr-invite">
      <div class="row gap-12">
        <span class="cr-invite-emoji">💌</span>
        <div class="grow">
          <div class="h3">Invite friends</div>
          <div class="small muted">Tab's more fun when the whole crew's on it.</div>
        </div>
      </div>
      <div class="cr-invite-label">Your handle</div>
      <div class="cr-invite-handle">@${handle}</div>
      <div class="cr-invite-link">
        <span class="truncate grow">${link.replace(/^https:\/\//, '')}</span>
        <span class="tag">demo</span>
      </div>
      <div class="grid-2 mt-12">
        <button class="btn btn-outline cr-act" onClick=${() => copyText(link, 'Invite link copied')}><${Icon} name="copy" size=${16} /> Copy</button>
        <button class="btn btn-primary cr-act" onClick=${() => shareText({ title: 'Tab', text: `Add me on Tab (@${handle}) — weekly drops, zero judgment 🍻`, url: link })}>
          <${Icon} name="share" size=${16} /> Share
        </button>
      </div>
    </div>
  </div>`;
}

function searchSubtitle(u) {
  const m = mutualFriendIds(u.id).length;
  return [`@${u.handle}`, m > 0 ? `${m} mutual` : u.year].filter(Boolean).join(' · ');
}

// ============================================================================================
// /crew/suggested
// ============================================================================================

export function SuggestedPage() {
  const s = useStore();
  const list = useStickySuggestions(KEEP_ALL);
  return html`<div class=${ROOT}>
    <${PageHeader} title="People you may know" back="/crew" />
    <div class="cr-explainer">
      <span class="cr-explainer-ic"><${Icon} name="sparkles" size=${18} /></span>
      <div class="grow">
        <div class="bold small">Based on mutual friends and places you both go</div>
        <div class="tiny faint mt-4">Places match by spot name only — nobody sees your exact location.</div>
        ${!s.settings.locationEnabled && html`<button class="cr-explainer-link" onClick=${() => navigate('/settings')}>Turn on location for better matches →</button>`}
      </div>
    </div>
    ${list.length > 0
      ? html`<div class="stack-12 mt-16">${list.map(e => html`<${SuggestionItem} key=${e.user.id} entry=${e} />`)}</div>`
      : html`<div class="card cr-empty-card mt-16"><${EmptyState} emoji="🫥" title="No suggestions right now"
          body="Add a few friends (or log a night with location on) and we'll find your people."
          action=${html`<button class="btn btn-primary" onClick=${() => navigate('/crew/add')}><${Icon} name="search" size=${18} /> Search by name</button>`} /></div>`}
  </div>`;
}

function SuggestionItem({ entry }) {
  const u = entry.user;
  const mutuals = (entry.mutualIds || []).map(getUser).filter(Boolean);
  const rel = relationTo(u.id);
  const meta = metaLine(u);
  return html`<div class="card cr-sug">
    <div class="cr-sug-main" ...${clickProps(() => navigate(`/u/${u.id}`))}>
      <${Avatar} user=${u} size="lg" />
      <div class="grow">
        <div class="cr-sug-name truncate">${u.name}</div>
        ${meta.length > 0 && html`<div class="tiny faint truncate">${meta}</div>`}
        <div class="cr-reasons">
          ${(entry.reasons || []).map(r => html`<span key=${r} class="cr-reason">
            <${Icon} name=${/mutual/i.test(r) ? 'users' : 'map-pin'} size=${12} /><span>${r}</span>
          </span>`)}
        </div>
      </div>
    </div>
    ${mutuals.length > 0 && html`<div class="cr-sug-mutual">
      <${AvatarStack} users=${mutuals} max=${4} size="xs" />
      <span class="tiny muted truncate">Friends with ${namesLine(mutuals)}</span>
    </div>`}
    <div class="grid-2 mt-12">
      <${RelationButton} id=${u.id} block />
      ${rel === 'none'
        ? html`<button class="btn btn-outline cr-act btn-block" onClick=${() => hideSuggestion(u)}>Dismiss</button>`
        : html`<button class="btn btn-ghost cr-act btn-block" onClick=${() => navigate(`/u/${u.id}`)}>View profile</button>`}
    </div>
  </div>`;
}

// ============================================================================================
// /u/:id
// ============================================================================================

/** Everything the profile's "drops" section needs, from dropped weeks only. */
function friendHistory(id) {
  const weeks = droppedWeeks(id); // newest first, dropped only
  const circle = circleIds();
  const rows = [];
  for (const w of weeks) {
    const st = weekStats(id, w);
    if (!st) continue;
    const cmp = compareWeek(circle, w);
    rows.push({
      w, st,
      mine: weekStats('me', w),
      rank: rankOn(cmp.boards.score, id),
      awards: cmp.awards.filter(a => a.winnerIds.includes(id)),
    });
  }
  const avg = rows.length ? round1(rows.reduce((a, r) => a + r.st.score, 0) / rows.length) : 0;
  const best = rows.reduce((b, r) => (!b || r.st.score > b.st.score ? r : b), null);
  let them = 0, me = 0;
  for (const r of rows) {
    if (!r.mine) continue;
    if (r.st.score > r.mine.score) them++;
    else if (r.mine.score > r.st.score) me++;
  }
  return { weeks, rows, avg, best, series: { them, me } };
}

export function ProfilePage({ params }) {
  const s = useStore();
  const id = params ? params.id : null;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (id === 'me') navigate('/you', { replace: true }); }, [id]);
  const user = id && id !== 'me' ? getUser(id) : null;
  const rel = user ? relationTo(id) : 'none';
  const friend = rel === 'friend';
  const hist = useMemo(() => (user && friend ? friendHistory(id) : null), [id, friend, s]);

  if (id === 'me') return null;
  if (!user) {
    return html`<div class=${ROOT}>
      <${PageHeader} title="Profile" back="/crew" />
      <${EmptyState} emoji="👻" title="Who?" body="This person isn't on Tab (or never was). Spooky."
        action=${html`<button class="btn btn-primary" onClick=${() => navigate('/crew', { replace: true })}>Back to crew</button>`} />
    </div>`;
  }

  const first = firstOf(user);
  const mutuals = mutualFriendIds(id).map(getUser).filter(Boolean);
  const hangouts = Array.isArray(user.hangouts) ? user.hangouts : [];
  // Friends: their usual spots. Everyone else: only the spots you already share.
  const mySpots = friend ? null : new Set(mySpotIds());
  const shared = friend ? hangouts : hangouts.filter(h => mySpots.has(h));
  const spotNames = shared.slice(0, 3).map(spotName);
  const meta = metaLine(user);
  const common = friend ? groupsWith(id) : [];

  return html`<div class=${ROOT}>
    <${PageHeader} title="Profile" back="/crew" />

    <div class="cr-hero" style=${`--hue:${hueOf(user)}`}>
      <${Avatar} user=${user} size="xl" />
      <h1 class="cr-hero-name">${user.name}</h1>
      <div class="cr-hero-handle">@${user.handle}</div>
      ${meta.length > 0 && html`<div class="cr-hero-meta">${meta}</div>`}
      <div class="cr-hero-actions">
        <${RelationButton} id=${id} onFriendClick=${() => openFriendMenu(user)} />
        ${rel === 'incoming' && html`<button class="btn btn-outline cr-act"
          onClick=${() => { declineFriendRequest(id); toast('Request declined. Cold.', { emoji: '🧊' }); }}>Decline</button>`}
      </div>
    </div>

    <div class="card cr-social">
      ${mutuals.length > 0
        ? html`<button class="cr-social-row" onClick=${() => openMutuals(user, mutuals)}>
            <${AvatarStack} users=${mutuals} max=${4} size="sm" />
            <span class="grow">
              <span class="bold small">${plural(mutuals.length, 'mutual friend')}</span>
              <span class="cr-social-sub truncate">${namesLine(mutuals)}</span>
            </span>
            ${chevron()}
          </button>`
        : html`<div class="cr-social-row">
            <span class="cr-social-ic"><${Icon} name="users" size=${16} /></span>
            <span class="grow small muted">No mutual friends yet</span>
          </div>`}
      ${spotNames.length > 0 && html`<div class="cr-social-row">
        <span class="cr-social-ic"><${Icon} name="map-pin" size=${16} /></span>
        <span class="grow small">${friend ? 'Usually at ' : 'You both hit '}<b>${spotNames.join(', ')}</b></span>
      </div>`}
    </div>

    ${friend
      ? html`<${FriendDrops} user=${user} hist=${hist} showAll=${showAll} onShowAll=${() => setShowAll(true)} />
        <${Section} title="Groups in common">
          ${common.length > 0
            ? html`<div class="row wrap gap-6">${common.map(g => html`<button key=${g.id} class="chip cr-gchip" onClick=${() => navigate(`/groups/${g.id}`)}>
                <span>${g.emoji || '🍻'}</span><span class="truncate">${g.name}</span>
              </button>`)}</div>`
            : html`<div class="card cr-nogroup">
                <span class="small muted">No groups with ${first} yet.</span>
                <button class="btn btn-outline cr-act" onClick=${() => navigate('/groups/new')}>Start one</button>
              </div>`}
        </${Section}>`
      : html`<${LockedCard} user=${user} rel=${rel} />`}
  </div>`;
}

const GHOST_BARS = [42, 68, 30, 84, 56, 92, 46, 72, 38, 64];

function LockedCard({ user, rel }) {
  const first = firstOf(user);
  const title = rel === 'outgoing' ? `Waiting on ${first}…`
    : rel === 'incoming' ? `${first} wants in`
    : `Add ${first} to see their weekly drops`;
  const body = rel === 'outgoing' ? `Once ${first} accepts, you'll see each other's weekly drops.`
    : rel === 'incoming' ? 'Accept and you two start swapping drops every Monday.'
    : 'Drops are friends-only. No live status, no stalking — just the Monday recap.';
  return html`<div class="card cr-locked">
    <div class="cr-ghost" aria-hidden="true">${GHOST_BARS.map((h, i) => html`<i key=${i} style=${`height:${h}%`}></i>`)}</div>
    <div class="cr-locked-body">
      <span class="cr-locked-icon"><${Icon} name="lock" size=${22} /></span>
      <div class="h3 mt-12">${title}</div>
      <p class="small muted mt-4">${body}</p>
      ${rel === 'none' && html`<div class="mt-16"><${RelationButton} id=${user.id} /></div>`}
    </div>
  </div>`;
}

function FriendDrops({ user, hist, showAll, onShowAll }) {
  const first = firstOf(user);
  if (!hist || hist.rows.length === 0) {
    return html`<${Section} title=${`${first}'s drops`}>
      <div class="card cr-empty-card"><${EmptyState} emoji="🍳" title=${`${first}'s first drop is cooking`}
        body="It lands Monday at noon. Come back for the tea." /></div>
    </${Section}>`;
  }
  const { rows, weeks, avg, best, series } = hist;
  const shown = showAll ? rows : rows.slice(0, 6);
  const openWeek = w => navigate(`/u/${user.id}/week/${w}`);
  return html`<${Section} title=${`${first}'s drops`}>
    <div class="grid-3 cr-tiles">
      <div class="stat-tile"><div class="value">${weeks.length}</div><div class="label">Weeks on Tab</div></div>
      <div class="stat-tile"><div class="value">${fmtScore(avg)}</div><div class="label">Avg Tab Score</div></div>
      <button class="stat-tile cr-tile-best" onClick=${() => openWeek(best.w)} aria-label=${`Best week: ${weekLabel(best.w)}`}>
        <div class="value">${fmtScore(best.st.score)}</div><div class="label">Best · ${weekLabel(best.w)}</div>
      </button>
    </div>

    <div class="card cr-chart-card mt-12" style=${`--hue:${hueOf(user)}`}>
      <div class="spread">
        <div class="bold">Tab Score by week</div>
        <div class="cr-legend"><span><i class="lg-them"></i>${first}</span><span><i class="lg-me"></i>You</span></div>
      </div>
      <${ScoreChart} rows=${rows} first=${first} onPick=${openWeek} />
      ${series.them + series.me > 0 && html`<div class="cr-series">
        <span>Season series</span>
        <span>${first} <b>${series.them}</b> – <b>${series.me}</b> You</span>
      </div>`}
    </div>

    <div class="card cr-list cr-weeks mt-12">
      ${shown.map(r => html`<${WeekRow} key=${r.w} r=${r} latest=${r.w === weeks[0]} onPick=${openWeek} />`)}
    </div>
    ${rows.length > shown.length && html`<button class="btn btn-block btn-ghost mt-8" onClick=${onShowAll}>Show all ${rows.length} weeks</button>`}
  </${Section}>`;
}

function ScoreChart({ rows, first, onPick }) {
  const data = rows.slice(0, 12).reverse(); // oldest → newest
  const max = Math.max(1, ...data.map(r => Math.max(r.st.score, r.mine ? r.mine.score : 0)));
  return html`<div class="cr-chart" style=${`grid-template-columns:repeat(${data.length}, minmax(0, 1fr))`}>
    ${data.map((r, i) => {
      const h = (r.st.score / max) * 100;
      const m = r.mine ? (r.mine.score / max) * 100 : null;
      const last = i === data.length - 1;
      const label = `${weekLabel(r.w)}: ${first} ${fmtScore(r.st.score)}, you ${r.mine ? fmtScore(r.mine.score) : 'no drop'}`;
      return html`<button key=${r.w} class=${cx('cr-chart-col', last && 'is-last')} onClick=${() => onPick(r.w)} aria-label=${label} title=${label}>
        <span class="cr-chart-track">
          ${last && html`<span class="cr-chart-val" style=${`bottom:calc(${h}% + 6px)`}>${fmtScore(r.st.score)}</span>`}
          <i class="cr-chart-bar" style=${`height:${Math.max(2, h)}%; animation-delay:${i * 30}ms`}></i>
          ${m !== null && html`<i class="cr-chart-me" style=${`bottom:${m}%`}></i>`}
        </span>
        <span class="cr-chart-lbl">${weekNumber(r.w)}</span>
      </button>`;
    })}
  </div>`;
}

function WeekRow({ r, latest, onPick }) {
  const top = topCategories(r.st)[0];
  const c = top ? CATEGORY_BY_ID[top] : null;
  const n = top ? r.st.totals[top] : 0;
  const rk = r.rank;
  return html`<button class="list-item clickable cr-wk" onClick=${() => onPick(r.w)}>
    <span class=${cx('cr-wk-rank', rk && rk.rank <= 3 && `is-top r${rk.rank}`)}>
      ${rk
        ? html`<b class=${cx('rank', rk.rank <= 3 && `r${rk.rank}`)}>#${rk.rank}</b><small>of ${rk.of}</small>`
        : html`<b class="rank">–</b>`}
    </span>
    <span class="grow cr-wk-body">
      <span class="cr-wk-title truncate">${weekTitle(r.w)}</span>
      <span class="cr-wk-meta">
        ${c
          ? html`<span class=${`cr-chip cat-${top}`}>${c.emoji} ${n} ${n === 1 ? c.unit : c.unitPlural}</span>`
          : html`<span class="cr-chip">😇 dry week</span>`}
        ${latest && html`<span class="tag brand">LATEST</span>`}
        ${r.awards.slice(0, 3).map(a => html`<span key=${a.id} class="cr-award" title=${a.title} aria-label=${a.title}>${a.emoji}</span>`)}
        ${r.awards.length > 3 && html`<span class="tiny faint">+${r.awards.length - 3}</span>`}
      </span>
    </span>
    <span class="cr-wk-score"><b>${fmtScore(r.st.score)}</b><small>pts</small></span>
  </button>`;
}

// ============================================================================================
// /u/:id/week/:weekKey
// ============================================================================================

function centerActiveChip(wrap) {
  if (!wrap) return;
  const sc = wrap.querySelector('.hscroll');
  const chip = sc && sc.querySelector('.chip.active');
  if (!sc || !chip) return;
  const a = sc.getBoundingClientRect(), b = chip.getBoundingClientRect();
  sc.scrollLeft += (b.left - a.left) - (a.width - b.width) / 2;
}

export function FriendWeekPage({ params }) {
  const s = useStore();
  const id = params ? params.id : null;
  const w = params ? params.weekKey : null;
  const valid = isWeekKey(w);
  const pickerRef = useRef(null);
  useRerenderAt(valid ? dropTs(w) : 0);
  useEffect(() => { if (id === 'me') navigate(valid ? `/drop/${w}` : '/drop', { replace: true }); }, [id, w]);
  useEffect(() => { centerActiveChip(pickerRef.current); }, [w]);

  const user = id && id !== 'me' ? getUser(id) : null;
  const rel = user ? relationTo(id) : 'none';
  const friend = rel === 'friend';
  const t = now();
  const dropped = valid && isDropped(w, t);
  // Stats only for friends and only for dropped weeks (weekStats also enforces the latter).
  const st = friend && dropped ? weekStats(id, w) : null;
  const mine = friend && dropped ? weekStats('me', w) : null;
  const weeks = friend ? droppedWeeks(id) : [];

  if (id === 'me') return null;
  if (!user) {
    return html`<div class=${ROOT}>
      <${PageHeader} title="Week" back="/crew" />
      <${EmptyState} emoji="👻" title="Who?" body="This person isn't on Tab (or never was)." />
    </div>`;
  }
  const first = firstOf(user);
  const back = `/u/${id}`;
  if (!friend) {
    return html`<div class=${ROOT}>
      <${PageHeader} title=${`${first}'s week`} back=${back} />
      <${LockedCard} user=${user} rel=${rel} />
    </div>`;
  }
  if (!valid) {
    return html`<div class=${ROOT}>
      <${PageHeader} title=${`${first}'s week`} back=${back} />
      <${EmptyState} emoji="🗓️" title="That week doesn't exist" body="Pick one of their drops instead."
        action=${weeks.length > 0 ? html`<button class="btn btn-primary" onClick=${() => navigate(`/u/${id}/week/${weeks[0]}`, { replace: true })}>Latest drop</button>` : null} />
    </div>`;
  }

  const picker = weeks.length > 0 && html`<div class="cr-picker" ref=${pickerRef}>
    <${WeekPicker} weeks=${weeks} value=${w} onChange=${k => navigate(`/u/${id}/week/${k}`, { replace: true })} />
  </div>`;
  const head = html`<${PageHeader} title=${`${first}'s week`} subtitle=${weekTitle(w)} back=${back} />`;

  if (!dropped) {
    const cur = thisWeek();
    if (w > cur) {
      return html`<div class=${ROOT}>${head}${picker}
        <${EmptyState} emoji="🔮" title="Nice try, time traveler" body="That week hasn't even happened yet." />
      </div>`;
    }
    const live = w === cur;
    const at = dropTs(w);
    return html`<div class=${ROOT}>${head}${picker}
      <div class="card-hero cr-cooking">
        <div class="cr-cooking-emoji">${live ? '🌙' : '🍳'}</div>
        <div class="h2 mt-8">${live ? `${first}'s week is still in progress` : `${first}'s week is cooking`}</div>
        <p class="small muted mt-8">No peeking — it drops ${formatDropMoment(at)} and everyone finds out at the same time.</p>
        <div class="cr-cooking-cd"><${Countdown} targetTs=${at} /></div>
      </div>
      <p class="tiny faint center mt-16">Until then it's between them and their tab. 🤐</p>
    </div>`;
  }

  if (!st) {
    return html`<div class=${ROOT}>${head}${picker}
      <${EmptyState} emoji="🐣" title=${`${first} wasn't on Tab yet`} body="Their drops start later. Pick another week above." />
    </div>`;
  }

  return html`<div class=${ROOT}>${head}${picker}
    <${HeadToHead} user=${user} st=${st} mine=${mine} />
    <div class="cr-summary"><${WeekSummary} userId=${id} weekKey=${w} compareIds=${circleIds()} /></div>
    ${mine && html`<button class="btn btn-block btn-outline mt-16" onClick=${() => navigate(`/drop/${w}`)}>
      <${Icon} name="gift" size=${18} /> Your drop for this week
    </button>`}
  </div>`;
}

const H2H_METRICS = ['score', ...CATEGORY_IDS, 'stdDrinks'];

function HeadToHead({ user, st, mine }) {
  const me = getUser('me');
  const first = firstOf(user);
  let them = 0, you = 0;
  const rows = H2H_METRICS.map(m => {
    const a = metricValue(st, m);
    const b = mine ? metricValue(mine, m) : null;
    const win = b === null || a === b ? null : a > b ? 'them' : 'you';
    if (m !== 'score') { if (win === 'them') them++; if (win === 'you') you++; }
    return { m, a, b, win, max: Math.max(a, b || 0) };
  });
  const diff = mine ? round1(st.score - mine.score) : null;
  const verdict = diff === null ? `You weren't on Tab yet — no contest.`
    : diff > 0 ? `${first} out-tabbed you by ${fmtScore(diff)} pts`
    : diff < 0 ? `You out-tabbed ${first} by ${fmtScore(-diff)} pts 😈`
    : 'Dead even. Suspicious. 🤝';
  return html`<div class="card cr-h2h" style=${`--hue:${hueOf(user)}`}>
    <div class="cr-h2h-top">
      <div class="cr-h2h-side">
        <${Avatar} user=${user} size="lg" ring=${diff !== null && diff > 0} />
        <span class="bold truncate">${first}</span>
      </div>
      <div class="cr-h2h-tally">
        <div class="cr-h2h-score">
          <b class=${cx(mine && them > you && 'win')}>${them}</b><span>–</span><b class=${cx(mine && you > them && 'win')}>${mine ? you : '—'}</b>
        </div>
        <div class="tiny faint">categories won</div>
      </div>
      <div class="cr-h2h-side">
        <${Avatar} user=${me} size="lg" ring=${diff !== null && diff < 0} />
        <span class="bold">You</span>
      </div>
    </div>
    <div class="cr-h2h-verdict">${verdict}</div>
    <div class="cr-h2h-rows">${rows.map(r => html`<${H2HRow} key=${r.m} r=${r} />`)}</div>
  </div>`;
}

function H2HRow({ r }) {
  const meta = METRIC_BY_ID[r.m] || { emoji: '•', short: r.m };
  const cat = CATEGORY_IDS.includes(r.m) ? r.m : null;
  const pa = r.max > 0 ? (r.a / r.max) * 100 : 0;
  const pb = r.b !== null && r.max > 0 ? (r.b / r.max) * 100 : 0;
  const zero = r.a === 0 && (r.b === null || r.b === 0);
  return html`<div class=${cx('cr-h2h-row', cat && `cat-${cat}`, r.m === 'score' && 'is-score', zero && 'is-zero')}>
    <div class=${cx('cr-h2h-cell them', r.win === 'them' && 'win')}>
      <span class="cr-h2h-val">${formatMetric(r.m, r.a)}</span>
      <span class="cr-h2h-track"><i style=${`width:${pa}%`}></i></span>
    </div>
    <div class="cr-h2h-label"><span aria-hidden="true">${meta.emoji}</span><small>${meta.short}</small></div>
    <div class=${cx('cr-h2h-cell you', r.win === 'you' && 'win')}>
      <span class="cr-h2h-track"><i style=${`width:${pb}%`}></i></span>
      <span class="cr-h2h-val">${r.b === null ? '—' : formatMetric(r.m, r.b)}</span>
    </div>
  </div>`;
}
