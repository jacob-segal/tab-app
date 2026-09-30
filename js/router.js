// Hash router. Paths look like "#/friends/maya/week/2026-09-21".
import { useState, useEffect } from './lib.js';

const listeners = new Set();
const parse = () => {
  const raw = (location.hash || '#/').slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
};
let current = parse();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach(fn => fn(current));
  window.scrollTo(0, 0);
});

let depth = 0; // in-app pushes we can safely go back through

/** Go to a path, e.g. navigate('/friends/maya'). { replace: true } avoids a history entry. */
export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) return;
  if (replace) { history.replaceState(null, '', target); current = parse(); listeners.forEach(fn => fn(current)); window.scrollTo(0, 0); }
  else { depth++; location.hash = path; }
}

/** Back if we navigated within the app, else go to `fallback`. */
export function back(fallback = '/') {
  if (depth > 0) { depth--; history.back(); }
  else navigate(fallback, { replace: true });
}

export const getRoute = () => current;

/** Match "/friends/:id/week/:weekKey" against a path. Returns params or null. */
export function matchPath(pattern, path) {
  const p = pattern.split('/').filter(Boolean), a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

/** { path, query } — re-renders on navigation. */
export function useRoute() {
  const [r, setR] = useState(current);
  useEffect(() => { const fn = x => setR(x); listeners.add(fn); return () => listeners.delete(fn); }, []);
  return r;
}
