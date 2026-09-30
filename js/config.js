// Static app configuration: categories, schedule, pricing, scoring.
// Pure data — safe to import from tests (no DOM, no CDN imports).

export const APP_NAME = 'Tab';

// ---- Categories ------------------------------------------------------------
// `unit` / `unitPlural` are used in copy ("3 drinks", "1 bong hit").
export const CATEGORIES = [
  { id: 'drinks',  label: 'Drinks',     unit: 'drink',     unitPlural: 'drinks',     emoji: '🍺', color: '#FFB547' },
  { id: 'shots',   label: 'Shots',      unit: 'shot',      unitPlural: 'shots',      emoji: '🥃', color: '#FF5C7A' },
  { id: 'cigs',    label: 'Cigarettes', unit: 'cig',       unitPlural: 'cigs',       emoji: '🚬', color: '#B8B8C8' },
  { id: 'joints',  label: 'Joints',     unit: 'joint',     unitPlural: 'joints',     emoji: '🌿', color: '#4ADE80' },
  { id: 'edibles', label: 'Edibles',    unit: 'edible',    unitPlural: 'edibles',    emoji: '🍪', color: '#C084FC' },
  { id: 'bong',    label: 'Bong hits',  unit: 'bong hit',  unitPlural: 'bong hits',  emoji: '💨', color: '#38D9F5' },
];
export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

// Only `drinks` has sub-types. Every drinks log MUST carry one of these as `sub`.
export const DRINK_TYPES = [
  { id: 'beer',    label: 'Beer',        emoji: '🍺' },
  { id: 'seltzer', label: 'Seltzer',     emoji: '🫧' },
  { id: 'wine',    label: 'Wine',        emoji: '🍷' },
  { id: 'mixed',   label: 'Mixed drink', emoji: '🍹' },
  { id: 'other',   label: 'Other',       emoji: '🥤' },
];
export const DRINK_TYPE_IDS = DRINK_TYPES.map(d => d.id);
export const DRINK_TYPE_BY_ID = Object.fromEntries(DRINK_TYPES.map(d => [d.id, d]));

// US standard drinks (14 g alcohol) per item. Mixed drinks are an estimate.
export const STD_DRINKS = { beer: 1, seltzer: 1, wine: 1, mixed: 1.5, other: 1, shot: 1 };

// Default price estimates in USD; editable in Settings (state.settings.prices).
export const DEFAULT_PRICES = {
  beer: 4, seltzer: 4, wine: 8, mixed: 9, other: 6,
  shots: 5, cigs: 0.5, joints: 10, edibles: 6, bong: 1,
};

// ---- Tab Score -------------------------------------------------------------
// Overall ranking weight per unit. Shown to users in an explainer.
export const SCORE_WEIGHTS = {
  drinks: 1, shots: 1.5, cigs: 0.5, joints: 2, edibles: 2, bong: 0.5,
};

// ---- Schedule --------------------------------------------------------------
// Week = Monday (at rollover hour) through the next Monday (at rollover hour).
// The drop for a week is released the following Monday at DROP_HOUR local time.
export const DEFAULT_ROLLOVER_HOUR = 6;       // "day" ends at 6 AM, not midnight
export const ROLLOVER_HOUR_OPTIONS = [3, 4, 5, 6, 7, 8];
export const DROP_WEEKDAY = 1;                // Monday (0 = Sunday)
export const DROP_HOUR = 12;                  // 12 PM
// Sessions auto-end after this much inactivity or total length.
export const SESSION_IDLE_MS = 5 * 60 * 60 * 1000;     // 5 h since last log
export const SESSION_MAX_MS = 16 * 60 * 60 * 1000;     // 16 h since start

// ---- Location --------------------------------------------------------------
export const HOME_AREA = { name: 'Nashville', lat: 36.1447, lng: -86.8027 }; // Vanderbilt
export const SPOT_RADIUS_M = 90;       // logs within this distance collapse into one spot
export const ROUTE_MIN_STEP_M = 20;    // ignore GPS jitter smaller than this
export const ROUTE_MIN_INTERVAL_MS = 15 * 1000;

export const STORAGE_KEY = 'tab.state.v1';
