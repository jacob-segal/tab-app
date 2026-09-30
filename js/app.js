// App shell: routing table, lazy page loading, tab bar, global overlays and
// background effects (session auto-end, route tracking, demo requests).

import { html, render, useState, useEffect, useErrorBoundary, cx } from './lib.js';
import { useStore, useInterval } from './hooks.js';
import { useRoute, matchPath, navigate } from './router.js';
import { Icon, ToastHost, SheetHost, toast } from './ui.js';
import { checkSessionTimeout, resolveDemoRequests, subscribe, getState } from './store.js';
import { syncRouteTracking, keepAwake } from './geo.js';
import { unseenDrop, activeSession, getUser } from './data.js';
import { formatDuration } from './time.js';
import { now } from './clock.js';

// ---- routes ------------------------------------------------------------------------
// Each page module exports a named component that receives { params, query }.
// `tab` = which tab-bar item is highlighted; `bare` = hide the tab bar.
const ROUTES = [
  { path: '/', load: () => import('./pages/home.js'), name: 'HomePage', tab: 'home' },
  { path: '/track', load: () => import('./pages/track.js'), name: 'TrackPage', tab: 'track' },
  { path: '/session', load: () => import('./pages/session.js'), name: 'LiveSessionPage', tab: 'track', bare: true },
  { path: '/session/:id', load: () => import('./pages/session.js'), name: 'SessionRecapPage', tab: 'you' },
  { path: '/drop', load: () => import('./pages/drop.js'), name: 'DropPage', tab: 'drop' },
  { path: '/drop/:weekKey', load: () => import('./pages/drop.js'), name: 'DropPage', tab: 'drop' },
  { path: '/drop/:weekKey/story', load: () => import('./pages/drop.js'), name: 'DropStoryPage', tab: 'drop', bare: true },
  { path: '/crew', load: () => import('./pages/friends.js'), name: 'CrewPage', tab: 'crew' },
  { path: '/crew/add', load: () => import('./pages/friends.js'), name: 'AddFriendsPage', tab: 'crew' },
  { path: '/crew/suggested', load: () => import('./pages/friends.js'), name: 'SuggestedPage', tab: 'crew' },
  { path: '/u/:id', load: () => import('./pages/friends.js'), name: 'ProfilePage', tab: 'crew' },
  { path: '/u/:id/week/:weekKey', load: () => import('./pages/friends.js'), name: 'FriendWeekPage', tab: 'crew' },
  { path: '/groups/new', load: () => import('./pages/groups.js'), name: 'CreateGroupPage', tab: 'crew' },
  { path: '/groups/:id', load: () => import('./pages/groups.js'), name: 'GroupPage', tab: 'crew' },
  { path: '/groups/:id/edit', load: () => import('./pages/groups.js'), name: 'EditGroupPage', tab: 'crew' },
  { path: '/you', load: () => import('./pages/history.js'), name: 'HistoryPage', tab: 'you' },
  { path: '/settings', load: () => import('./pages/settings.js'), name: 'SettingsPage', tab: 'you' },
];

function resolve(path) {
  for (const r of ROUTES) {
    const params = matchPath(r.path, path);
    if (params) return { route: r, params };
  }
  return null;
}

const moduleCache = new Map();
function usePageComponent(route) {
  const key = route && `${route.path}|${route.name}`;
  const [state, setState] = useState(() => (key && moduleCache.has(key) ? { C: moduleCache.get(key) } : { C: null }));
  useEffect(() => {
    if (!route) return;
    if (moduleCache.has(key)) { setState({ C: moduleCache.get(key) }); return; }
    let live = true;
    setState({ C: null });
    route.load().then(mod => {
      const C = mod[route.name];
      if (!C) throw new Error(`${route.name} not exported`);
      moduleCache.set(key, C);
      live && setState({ C });
    }).catch(err => live && setState({ C: null, err }));
    return () => { live = false; };
  }, [key]);
  return state;
}

// ---- error boundary -----------------------------------------------------------------

function PageBoundary({ children, resetKey }) {
  const [error, reset] = useErrorBoundary(e => console.error(e));
  useEffect(() => { if (error) reset(); }, [resetKey]);
  if (error) {
    return html`<div class="page"><div class="empty">
      <div class="emoji">🥴</div>
      <div class="h3">Something broke</div>
      <p class="small muted">${String(error.message || error)}</p>
      <div class="mt-16"><button class="btn btn-primary" onClick=${() => { reset(); navigate('/', { replace: true }); }}>Go home</button></div>
    </div></div>`;
  }
  return children;
}

// ---- tab bar ------------------------------------------------------------------------

const TABS = [
  { id: 'home', to: '/', icon: 'home', label: 'Home' },
  { id: 'track', to: '/track', icon: 'plus', label: 'Track' },
  { id: 'drop', to: '/drop', icon: 'gift', label: 'Drop', center: true },
  { id: 'crew', to: '/crew', icon: 'users', label: 'Crew' },
  { id: 'you', to: '/you', icon: 'user', label: 'You' },
];

function TabBar({ active }) {
  const s = useStore();
  const hasDrop = !!unseenDrop();
  const hasRequests = s.requests.incoming.length > 0;
  return html`<nav class="tabbar" aria-label="Main">
    ${TABS.map(t => html`<a href=${'#' + t.to} class=${cx('tab-item', t.id === active && 'active', t.center && 'center')}
        onClick=${e => { e.preventDefault(); navigate(t.to); }} aria-current=${t.id === active ? 'page' : undefined}>
      ${t.center
        ? html`<span class="center-btn"><${Icon} name=${t.icon} size=${24} /></span>`
        : html`<${Icon} name=${t.icon} size=${23} stroke=${t.id === active ? 2.4 : 2} />`}
      <span>${t.label}</span>
      ${((t.id === 'drop' && hasDrop) || (t.id === 'crew' && hasRequests)) && html`<span class="dot"></span>`}
    </a>`)}
  </nav>`;
}

function SessionPill() {
  const ses = activeSession();
  const [, tick] = useState(0);
  useInterval(() => tick(n => n + 1), 30000);
  if (!ses) return null;
  return html`<button class="session-pill" onClick=${() => navigate('/session')}>
    <span class="live-dot"></span> Session live · ${formatDuration(now() - ses.start)}
    <${Icon} name="chevron-right" size=${18} />
  </button>`;
}

// ---- global effects -------------------------------------------------------------------

function useBackgroundTasks() {
  useEffect(() => {
    const ended = checkSessionTimeout();
    if (ended) toast('Your last session auto-ended after going quiet', { emoji: '🌙' });
    syncRouteTracking();
    const unsub = subscribe(() => {
      syncRouteTracking();
      const s = getState();
      keepAwake(!!s.activeSessionId && s.settings.keepAwake);
    });
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        const e = checkSessionTimeout();
        if (e) toast('Your last session auto-ended after going quiet', { emoji: '🌙' });
        const s = getState();
        keepAwake(!!s.activeSessionId && s.settings.keepAwake);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { unsub(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useInterval(() => {
    checkSessionTimeout();
    const accepted = resolveDemoRequests();
    for (const id of accepted) {
      const u = getUser(id);
      if (u) toast(`${u.name.split(' ')[0]} accepted your friend request`, { emoji: u.avatar.emoji });
    }
  }, 4000);
}

// ---- root ----------------------------------------------------------------------------------

function App() {
  const s = useStore();
  const { path, query } = useRoute();
  useBackgroundTasks();
  const match = resolve(path);
  const { C, err } = usePageComponent(s.onboarded ? match && match.route : null);
  const [Onboarding, setOnboarding] = useState(null);

  useEffect(() => {
    if (!s.onboarded && !Onboarding) import('./pages/onboarding.js').then(m => setOnboarding(() => m.OnboardingPage));
  }, [s.onboarded]);

  if (!s.onboarded) {
    return html`<div class="app-shell">${Onboarding ? html`<${Onboarding} />` : null}<${ToastHost} /><${SheetHost} /></div>`;
  }

  if (!match) {
    return html`<div class="app-shell"><div class="page"><div class="empty"><div class="emoji">🧭</div><div class="h3">Page not found</div>
      <div class="mt-16"><button class="btn btn-primary" onClick=${() => navigate('/', { replace: true })}>Go home</button></div></div></div>
      <${TabBar} active="home" /></div>`;
  }
  const { route, params } = match;
  const showPill = !route.bare && path !== '/track' && !!s.activeSessionId;
  return html`<div class=${cx('app-shell', showPill && 'has-pill')}>
    <${PageBoundary} resetKey=${path}>
      ${err
        ? html`<div class="page"><div class="empty"><div class="emoji">📡</div><div class="h3">Couldn’t load this page</div><p class="small muted">${String(err.message || err)}</p></div></div>`
        : C ? html`<${C} key=${path} params=${params} query=${query} />` : html`<div class="page"></div>`}
    </${PageBoundary}>
    ${showPill && html`<${SessionPill} />`}
    ${!route.bare && html`<${TabBar} active=${route.tab} />`}
    <${ToastHost} />
    <${SheetHost} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));

// PWA: offline cache
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
