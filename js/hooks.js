// Preact hooks bridging the store/clock into components.
import { useState, useEffect, useRef } from './lib.js';
import { getState, subscribe } from './store.js';
import { now, onClockChange } from './clock.js';

/** Re-render whenever the store changes. Returns the current state. */
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force(n => n + 1)), []);
  return getState();
}

/** Current time (ms), refreshed every `intervalMs` and on clock offset changes. */
export function useNow(intervalMs = 1000) {
  const [t, setT] = useState(now());
  useEffect(() => {
    const id = setInterval(() => setT(now()), intervalMs);
    const off = onClockChange(() => setT(now()));
    return () => { clearInterval(id); off(); };
  }, [intervalMs]);
  return t;
}

/** Run `fn` every `ms` while mounted (latest fn is always used). */
export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
