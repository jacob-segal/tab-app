// Browser location + screen wake lock. All functions fail soft (return null /
// no-op) so the app works fine with location off or unsupported.
//
// Geolocation needs a secure context: localhost or HTTPS.

import { getState, appendRoutePoint } from './store.js';

export const geoSupported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext !== false;

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function permissionState() {
  if (!geoSupported()) return 'unsupported';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state;
  } catch { return 'prompt'; }
}

/** One-shot position. Resolves {lat,lng,acc,ts} or null (denied/timeout/unsupported). */
export function getPosition({ timeout = 8000, maximumAge = 60000, highAccuracy = true } = {}) {
  return new Promise(resolve => {
    if (!geoSupported()) return resolve(null);
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      p => finish({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), ts: p.timestamp }),
      () => finish(null),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge },
    );
  });
}

/** Ask for permission by requesting a fix. Resolves true if we got a location. */
export async function requestLocationPermission() {
  const pos = await getPosition({ timeout: 12000, maximumAge: 0 });
  return !!pos;
}

// ---- route tracking for the active session ---------------------------------

let watchId = null, watchingSession = null;

/** Start recording GPS points into a session's route (no-op if already on). */
export function startRouteTracking(sessionId) {
  if (!geoSupported() || watchingSession === sessionId) return;
  stopRouteTracking();
  watchingSession = sessionId;
  watchId = navigator.geolocation.watchPosition(
    p => {
      if (p.coords.accuracy > 150) return; // too fuzzy to be useful
      appendRoutePoint(sessionId, { lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}

export function stopRouteTracking() {
  if (watchId != null && geoSupported()) navigator.geolocation.clearWatch(watchId);
  watchId = null; watchingSession = null;
}

export const isTrackingRoute = () => watchingSession;

/** Keep tracking in sync with state: call whenever state changes. */
export function syncRouteTracking() {
  const s = getState();
  const ses = s.activeSessionId && s.sessions.find(x => x.id === s.activeSessionId);
  if (ses && !ses.end && s.settings.locationEnabled && s.settings.trackRoute) startRouteTracking(ses.id);
  else if (watchingSession) stopRouteTracking();
}

// ---- wake lock (keeps the screen on while a session is recording) --------------

let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch { wakeLock = null; }
}
