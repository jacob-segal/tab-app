// Pure geo helpers (no browser APIs).

import { SPOT_RADIUS_M } from './config.js';

const R = 6371000; // earth radius, m
const rad = d => (d * Math.PI) / 180;

// Great-circle distance in meters between {lat,lng} points.
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Total length of a route [{lat,lng}] in meters.
export function routeLengthM(route) {
  let total = 0;
  for (let i = 1; i < (route || []).length; i++) total += distanceM(route[i - 1], route[i]);
  return total;
}

// "1.2 mi" / "850 ft"
export function formatDistance(m) {
  const mi = m / 1609.344;
  if (mi >= 0.1) return `${mi.toFixed(mi >= 10 ? 0 : 1)} mi`;
  return `${Math.round(m * 3.28084)} ft`;
}

// Closest named spot within SPOT_RADIUS_M, or null.
export function nearestSpot(point, spots, radius = SPOT_RADIUS_M) {
  let best = null, bestD = Infinity;
  for (const s of spots || []) {
    const d = distanceM(point, s);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best && bestD <= radius ? best : null;
}

// Greedy clustering of pins into spots. Each cluster takes the name of the
// nearest known spot (if any within radius) else `Stop N`.
// Returns [{ name, lat, lng, count, spotId|null }] sorted by count desc.
export function clusterPins(pins, knownSpots = [], radius = SPOT_RADIUS_M) {
  const clusters = [];
  for (const p of pins || []) {
    if (!p || typeof p.lat !== 'number') continue;
    let c = clusters.find(c => distanceM(c, p) <= radius);
    if (!c) {
      c = { lat: p.lat, lng: p.lng, count: 0, sumLat: 0, sumLng: 0 };
      clusters.push(c);
    }
    c.count += 1;
    c.sumLat += p.lat; c.sumLng += p.lng;
    c.lat = c.sumLat / c.count; c.lng = c.sumLng / c.count;
  }
  let unnamed = 0;
  return clusters
    .map(c => {
      const known = nearestSpot(c, knownSpots, radius);
      return {
        name: known ? known.name : null,
        spotId: known ? known.id : null,
        lat: c.lat, lng: c.lng, count: c.count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .map(c => (c.name ? c : { ...c, name: `Stop ${++unnamed}` }));
}

// Bounding box [[south, west], [north, east]] for a list of points, or null.
export function boundsOf(points) {
  const pts = (points || []).filter(p => p && typeof p.lat === 'number');
  if (!pts.length) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of pts) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng); }
  return [[s, w], [n, e]];
}
