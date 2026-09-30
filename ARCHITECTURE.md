# Tab — architecture & build contract

**Tab** is a Superfan-style social tracker for college nights out. You log drinks (beer, seltzer, wine, mixed, other), shots, cigarettes, joints, edibles and bong hits. There's **no live status**: every Monday at 12 PM your week "drops" as a Wrapped-style recap, and you compare it with friends and groups.

The app is mobile-first and uses no build step: static ES modules plus Preact/htm loaded from unpkg. To serve it locally, run `python3 -m http.server 8765` in this folder (see `.claude/launch.json`).

## Product rules (non-negotiable)

1. **No live status.**
   - Friends never see anything about you until a week drops.
   - You only see **per-day counts** on the tracker, plus counts for your own current session.
   - Never show week-to-date totals, ranks, scores or awards for a week that hasn't dropped.
   - `data.weekStats()` enforces this and returns `null` for weeks that haven't dropped. Don't work around it.
2. **Late nights.**
   - A "tab day" runs from the rollover hour (default 6 AM, configurable 3–8 AM) to the same hour the next morning. A 2 AM beer on Saturday counts toward Friday.
   - During an active session, every log counts toward the night the session started.
   - Sessions auto-end after 5 h without a log, or after 16 h total.
   - UI copy should make this obvious. For example: "It's 2:14 AM — still counts as Friday night 🌙".
3. **Weeks and drops.**
   - A week is Monday–Sunday in tab days, so it ends at the Monday rollover.
   - It drops the following **Monday at 12 PM**.
   - Between the Monday rollover and noon, the previous week is "cooking": still editable, not yet revealed.
   - After its drop, a week is **locked**. `store` throws `LockedDayError`, and `actions.quickLog` turns that into a toast.
4. **Location is optional.**
   - When it's on, each log in a session gets a pin, and the session records a GPS route (Strava-like).
   - Friends see **spot names** (e.g. "Midtown") plus a **rough area map**: circles snapped to a ~400 m grid (`stats.areas`). They never see pins, routes or exact coordinates. `data.js` enforces this.
5. **The drop includes:**
   - totals per category
   - Tab Score (weighted) and your rank among friends, with per-category leaderboards
   - group awards
   - week-over-week trends and the 4-week average
   - standard drinks and an estimated $ spent
   - busiest night
   - top spots
6. **Demo world.**
   - v1 has no backend. `demo.js` generates deterministic friends and stats around Nashville/Vanderbilt.
   - Everything goes through `data.js` so a backend can replace it later.

## Files and ownership

| File | Owner | What |
|---|---|---|
| `js/config.js` | core | categories, drink types, prices, score weights, schedule constants |
| `js/time.js` | core | tab days, weeks, drops, editability, formatting (pure) |
| `js/stats.js` | core | `computeWeekStats`, trends, leaderboards, awards (pure) |
| `js/geomath.js` | core | distance, clustering, bounds (pure) |
| `js/demo.js` | core | people, groups, spots, deterministic generator (pure) |
| `js/store.js` | core | state shape, persistence, **all mutations** |
| `js/data.js` | core | **all read queries** (privacy enforced here) |
| `js/clock.js` | core | `now()`. **Always use this, never `Date.now()`**, so demo time travel works |
| `js/hooks.js` | core | `useStore()`, `useNow(ms)`, `useInterval(fn, ms)` |
| `js/router.js` | core | `navigate(path, {replace})`, `back(fallback)`, `useRoute()` |
| `js/geo.js` | core | `getPosition()`, `requestLocationPermission()`, `permissionState()`, route tracking, wake lock |
| `js/actions.js` | core | `quickLog`, `quickUnlog` (undo toast), `beginSession`, `finishSession`, `itemLabel`, `itemEmoji` |
| `js/ui.js` | core | shared components (see below) |
| `js/app.js` | core | routes, tab bar, session pill, global effects |
| `css/app.css` | core | design tokens and component classes |
| `js/pages/<page>.js` + `css/pages/<page>.css` | page builder | one builder per page file |
| `js/components/week-summary.js` | drop builder | `WeekSummary`, shared with friends pages |

**Page builders only edit their own files.** If you need something changed in a core file, don't edit it. Implement a local helper in your page file and list the request in your final report.

## Routes (in `js/app.js`)

Each page module exports the named component, which receives `{ params, query }`.

| Path | Module → export | Notes |
|---|---|---|
| `/` | `home.js` → `HomePage` | countdown, drop CTA, friends feed |
| `/track` | `track.js` → `TrackPage` | `?day=YYYY-MM-DD` optional |
| `/session` | `session.js` → `LiveSessionPage` | full screen, no tab bar |
| `/session/:id` | `session.js` → `SessionRecapPage` | |
| `/drop` | `drop.js` → `DropPage` | latest dropped week |
| `/drop/:weekKey` | `drop.js` → `DropPage` | my week; not dropped → teaser |
| `/drop/:weekKey/story` | `drop.js` → `DropStoryPage` | full screen, no tab bar |
| `/crew` | `friends.js` → `CrewPage` | `?tab=groups` optional |
| `/crew/add` | `friends.js` → `AddFriendsPage` | |
| `/crew/suggested` | `friends.js` → `SuggestedPage` | |
| `/u/:id` | `friends.js` → `ProfilePage` | `id === 'me'` → `navigate('/you', {replace:true})` |
| `/u/:id/week/:weekKey` | `friends.js` → `FriendWeekPage` | |
| `/groups/new` | `groups.js` → `CreateGroupPage` | |
| `/groups/:id` | `groups.js` → `GroupPage` | `?week=` optional |
| `/groups/:id/edit` | `groups.js` → `EditGroupPage` | |
| `/you` | `history.js` → `HistoryPage` | profile, weeks, sessions, spots |
| `/settings` | `settings.js` → `SettingsPage` | |
| (not onboarded) | `onboarding.js` → `OnboardingPage` | rendered instead of routes |

The tab bar is Home, Track, **Drop** (center), Crew, You.

## Shared UI (`js/ui.js`)

- `Icon({name,size,stroke})`. Names: home, plus, minus, x, check, chevron-left/right/down, users, user, user-plus, settings, map-pin, map, clock, lock, search, share, trophy, calendar, play, stop, edit, trash, info, sparkles, bell, navigation, copy, arrow-up/down, more, zap, gift, history, chart, qr, logout, moon, flame.
- `Avatar({user,size:'xs'|'sm'|'md'|'lg'|'xl',ring})`, `AvatarStack({users,max,size})`
- `CatIcon({cat,size:''|'sm'|'lg'})`
- `PageHeader({title,subtitle,back,right,big})`: `back` is `true` or a fallback path.
- `Section({title,action,onAction})`
- `EmptyState({emoji,title,body,action})`
- `Stepper({value,onMinus,onPlus,cat,size,disabled,label})`
- `Segmented({options:[{value,label}],value,onChange})`
- `Switch({checked,onChange,label})`
- `Bar({value,max,cat,thick})`
- `Delta({delta,suffix,neutral})`: more consumption shows `.up` (red), less shows `.down` (green).
- `Countdown({targetTs,compact})`
- `toast(msg,{emoji,action:{label,onClick},duration})`
- `openSheet((close)=>vnode,{title,onClose})` returns `close`.
- `confirmSheet({title,body,confirmLabel,danger})` returns `Promise<boolean>`.
- `UserRow({user,subtitle,right,onClick,highlight,rank})`
- `METRICS`, `METRIC_BY_ID`, `formatMetric(metric,v)`, `MetricPicker({value,onChange})`
- `Leaderboard({board,metric,getUser,limit,onSelect})`
- `AwardCard({award,getUser})`
- `WeekPicker({weeks,value,onChange})`, `weekTitle(w)`
- `DayBars({byDay,highlightDayKey})`, `CatLegend()`
- `MapView({route,pins,spots,center,zoom,className:'tall'|'full',follow,interactive})`: Leaflet, lazy-loaded.
- `Link({to})`, `copyText(text,msg)`, `shareText({title,text,url})`

## Data shapes

- **Log**: `{ id, cat, sub, ts, dayKey, sessionId, loc:{lat,lng,acc}|null, manual }`. `sub` is the drink type, set only when `cat==='drinks'`.
- **Session**: `{ id, start, end|null, dayKey, name|null, route:[{lat,lng,ts}] }`
- **WeekStats** (`stats.computeWeekStats`):
  ```
  { weekKey, totals:{drinks,shots,cigs,joints,edibles,bong}, drinkTypes:{beer,seltzer,wine,mixed,other},
    total, score, stdDrinks, spend, byDay:[{dayKey,totals,drinkTypes,total,score}×7],
    activeDays, busiestDay:{dayKey,total,score,totals}|null, latestLog:{ts,dayKey,cat}|null,
    sessions:[{id,name,dayKey,start,end,durationMs,distanceM,pinCount,totals,total,score}],
    spots:[{name,lat?,lng?,count,spotId?}], pins:[{lat,lng,ts,cat,sub,sessionId}], logCount }
  ```
  For friends, `pins=[]`, spots have no lat/lng, and `areas:[{name,count,lat,lng,radiusM}]` holds the ~400 m rough areas.
- **User** (`data.getUser(id)`): `{ id, name, handle, avatar:{emoji,hue}, school, year, isMe, friendIds?, hangouts?, joinedWeeksAgo? }`. Use `'me'` for the current user.

## Key `data.js` queries

These cover people, relations, weeks, comparisons, groups and the user's own logs/sessions:

- People and relations: `getUser`, `firstName`, `displayName`, `listFriends`, `friendIds`, `isFriend`, `relationTo(id)` (returns `'friend'|'outgoing'|'incoming'|'none'|'me'`), `incomingRequests`, `outgoingRequests`, `mutualFriendIds`, `searchPeople`, `suggestions()`, `mySpotIds`, `spotName`
- Weeks: `latestDropWeek()`, `thisWeek()`, `droppedWeeks(userId,max)`, `joinedWeekKey`, `weekStats(userId,weekKey)`, `trendsFor(userId,weekKey)`, `unseenDrop()`
- Comparisons: `circleIds()` (me + friends), `membersStats`, `compareWeek(userIds,weekKey)` returns `{members,awards,boards:{score,drinks,…,stdDrinks,spend}}`, `rankOn(board,userId)`
- Groups: `listGroups`, `groupById`, `groupsWith`, `groupMembers(g)`, `groupWeek(groupId,weekKey)`
- The user's own logs and sessions: `logsForDay`, `dayTotals(dayKey)`, `sessionById`, `sessionLogs`, `activeSession`, `mySessions`

## Conventions

- **htm syntax:**
  - Use `html\`<${Comp} prop=${x} />\``. Close with `</${Comp}>`.
  - Use `class`, not `className`.
  - There is no Fragment. Return multiple roots, or use `Fragment` from `lib.js`.
  - Beware ``${0 && html`…`}``: it renders the `0`. Use `${n > 0 && …}`.
- **Reactivity:** call `useStore()` at the top of each page so it re-renders on any state change, then read via `data.js`. Use `useNow(1000)` for ticking clocks.
- **Mutations:**
  - Logging goes through `actions.js` (`quickLog`/`quickUnlog`/`beginSession`/`finishSession`).
  - Everything else calls store functions directly (`acceptFriendRequest`, `createGroup`, `updateSettings`, …).
- **Styling:**
  - Use `app.css` classes and tokens.
  - Page CSS goes in `css/pages/<page>.css` (already linked in `index.html`).
  - **Prefix every selector with your page root class** (e.g. `.pg-track …`) and put that class on your page's root element (`<div class="page pg-track">`).
  - No hard-coded colors except for gradients and effects. Category colors come from `.cat-<id>` / `var(--cat)`.
  - Mobile-first, 375 px wide. Minimum touch target is 40 px. Respect the safe areas.
- **Copy:** playful and a bit degenerate, but never preachy. Lowercase-friendly, emoji where natural.
- **Checks:** `zsh tools/check.sh js/pages/<file>.js` runs a syntax and import/export check (no Node needed). `tools/check.sh` with no args checks everything. There's no browser available to builders, so reason carefully about runtime behavior.
