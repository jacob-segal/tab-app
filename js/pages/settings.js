// Settings: profile, days & drops, location, prices, score, privacy, demo tools, data.

import { html, useState, cx } from '../lib.js';
import { useStore, useNow } from '../hooks.js';
import {
  PageHeader, Section, Avatar, Icon, Switch, toast, openSheet, confirmSheet,
} from '../ui.js';
import {
  ROLLOVER_HOUR_OPTIONS, DEFAULT_PRICES, SCORE_WEIGHTS, CATEGORIES, DRINK_TYPES,
} from '../config.js';
import { nextDrop, formatDayLabel, formatTime, tabDayKey, formatDuration } from '../time.js';
import {
  updateProfile, updateSettings, updatePrices, upsertSpot, deleteSpot, loadDemoData, clearDemoData,
  exportJSON, importJSON, clearMyLogs, resetAll,
} from '../store.js';
import { requestLocationPermission, geoSupported } from '../geo.js';
import { setClockOffset, clockOffset, now } from '../clock.js';
import { navigate } from '../router.js';

const EMOJIS = ['😎', '🦊', '🐸', '🦄', '🐻', '🦈', '🐐', '🦉', '👽', '🤠', '🥴', '😈', '🍄', '🌵', '🔥', '⚡️', '🪩', '🎸', '🏈', '🐙'];
const HUES = [265, 320, 350, 20, 45, 140, 190, 220];
const hourLabel = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const HOUR = 3600e3, DAY = 24 * HOUR;

function ProfileSheet({ me, close }) {
  const [name, setName] = useState(me.name);
  const [handle, setHandle] = useState(me.handle);
  const [emoji, setEmoji] = useState(me.avatar.emoji);
  const [hue, setHue] = useState(me.avatar.hue);
  const valid = name.trim() && /^[a-z0-9_.]{3,20}$/.test(handle);
  return html`<div class="stack-16 pg-settings">
    <div class="center"><${Avatar} user=${{ name, avatar: { emoji, hue } }} size="xl" /></div>
    <div class="field"><label>Name</label><input class="input" maxLength="40" value=${name} onInput=${e => setName(e.currentTarget.value)} /></div>
    <div class="field"><label>Handle</label><input class="input" maxLength="20" value=${handle} autocapitalize="off" spellcheck="false"
      onInput=${e => setHandle(e.currentTarget.value.toLowerCase().replace(/\s/g, ''))} />
      ${!/^[a-z0-9_.]{3,20}$/.test(handle) && html`<div class="tiny st-err">3–20 characters: letters, numbers, _ and .</div>`}</div>
    <div class="st-emojis">${EMOJIS.map(e => html`<button key=${e} class=${cx('st-emoji', e === emoji && 'on')} onClick=${() => setEmoji(e)}>${e}</button>`)}</div>
    <div class="st-hues">${HUES.map(h => html`<button key=${h} class=${cx('st-hue', h === hue && 'on')} style=${`--hue:${h}`} onClick=${() => setHue(h)} aria-label=${`Color ${h}`}></button>`)}</div>
    <button class="btn btn-primary btn-block" disabled=${!valid} onClick=${() => { updateProfile({ name: name.trim(), handle, avatar: { emoji, hue } }); close(); toast('Profile updated', { emoji: '✨' }); }}>Save</button>
  </div>`;
}

export function SettingsPage() {
  const s = useStore();
  const t = useNow(1000);
  const [asking, setAsking] = useState(false);
  const { me, settings } = s;
  const offset = clockOffset();

  async function toggleLocation(on) {
    if (!on) { updateSettings({ locationEnabled: false }); toast('Location off', { emoji: '📍' }); return; }
    if (!geoSupported()) { toast('Location needs HTTPS (or localhost) in this browser', { emoji: '🤷' }); return; }
    setAsking(true);
    const ok = await requestLocationPermission();
    setAsking(false);
    if (ok) { updateSettings({ locationEnabled: true }); toast('Location on — sessions will map your night', { emoji: '📍' }); }
    else toast('Location was blocked. Allow it in your browser’s site settings, then try again.', { emoji: '🚫', duration: 5000 });
  }

  function renameSpot(spot) {
    let val = spot.name;
    openSheet(c => html`<div class="stack-12">
      <div class="sheet-title">Rename spot</div>
      <input class="input" maxLength="32" value=${val} onInput=${e => { val = e.currentTarget.value; }} autofocus />
      <button class="btn btn-primary btn-block" onClick=${() => { if (!val.trim()) return; upsertSpot({ ...spot, name: val }); c(); toast('Spot renamed', { emoji: '📍' }); }}>Save</button>
      <button class="btn btn-danger btn-block" onClick=${() => { deleteSpot(spot.id); c(); toast('Spot removed'); }}>Delete spot</button>
    </div>`);
  }

  const travel = ms => { setClockOffset(clockOffset() + ms); toast(`Time traveled ${ms > 0 ? '+' : ''}${formatDuration(Math.abs(ms))}`, { emoji: '⏩' }); };
  function jumpToDrop() {
    const nd = nextDrop(now(), settings.rolloverHour);
    setClockOffset(clockOffset() + (nd.ts + 60e3 - now()));
    toast('Jumped to the next drop 🎁', { emoji: '⏩' });
    navigate('/');
  }

  function doExport() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tab-backup-${tabDayKey(now(), 0)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded', { emoji: '💾' });
  }
  function doImport(e) {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!file) return;
    file.text().then(text => { importJSON(text); toast('Backup restored', { emoji: '✅' }); })
      .catch(err => toast(err.message || 'That file didn’t work', { emoji: '⚠️' }));
  }

  const priceRow = (key, label, emoji) => html`<div class="st-price" key=${key}>
    <span class="st-price-e">${emoji}</span><span class="grow small">${label}</span>
    <span class="st-dollar">$</span>
    <input class="input st-price-input" type="number" inputmode="decimal" min="0" step="0.25" value=${settings.prices[key]}
      onChange=${e => { const v = Math.max(0, Number(e.currentTarget.value) || 0); updatePrices({ [key]: v }); }} />
  </div>`;

  return html`<div class="page pg-settings">
    <${PageHeader} title="Settings" back="/you" />

    <div class="card row gap-12 clickable" onClick=${() => openSheet(c => html`<${ProfileSheet} me=${me} close=${c} />`, { title: 'Edit profile' })}>
      <${Avatar} user=${me} size="lg" />
      <div class="grow"><div class="h3 truncate">${me.name || 'You'}</div><div class="small faint">@${me.handle}</div></div>
      <span class="btn btn-sm">Edit</span>
    </div>

    <${Section} title="Days & drops">
      <div class="card">
        <div class="field"><label>My day ends at</label>
          <div class="row wrap gap-6">${ROLLOVER_HOUR_OPTIONS.map(h => html`<button key=${h} class=${cx('chip', h === settings.rolloverHour && 'active')} onClick=${() => { updateSettings({ rolloverHour: h }); toast(`Days now end at ${hourLabel(h)}`, { emoji: '🌙' }); }}>${hourLabel(h)}</button>`)}</div>
          <p class="tiny faint mt-4">Anything before ${hourLabel(settings.rolloverHour)} counts as the night before. Changes apply to new logs.</p>
        </div>
        <hr class="divider" />
        <div class="setting-row"><div class="grow"><div class="primary">Drop time</div><div class="secondary">Everyone’s week drops at the same time</div></div><span class="tag brand">MON · 12 PM</span></div>
        <div class="setting-row"><div class="grow"><div class="primary">Locking</div><div class="secondary">You can fix last week until Monday noon. After the drop it’s final, so nobody pads their numbers.</div></div><${Icon} name="lock" size=${18} /></div>
      </div>
    <//>

    <${Section} title="Location">
      <div class="card">
        <div class="setting-row">
          <div class="grow"><div class="primary">Location during sessions</div><div class="secondary">${asking ? 'Asking your browser…' : settings.locationEnabled ? 'Pins + route while a session runs' : 'Off — sessions still work without a map'}</div></div>
          <${Switch} checked=${settings.locationEnabled} onChange=${toggleLocation} label="Location" />
        </div>
        <div class=${cx('setting-row', !settings.locationEnabled && 'st-dim')}>
          <div class="grow"><div class="primary">Record route</div><div class="secondary">Draw your path between stops, Strava-style</div></div>
          <${Switch} checked=${settings.trackRoute} onChange=${v => updateSettings({ trackRoute: v })} label="Record route" />
        </div>
        <div class="setting-row">
          <div class="grow"><div class="primary">Keep screen awake</div><div class="secondary">While a session is live (helps tracking)</div></div>
          <${Switch} checked=${settings.keepAwake} onChange=${v => updateSettings({ keepAwake: v })} label="Keep screen awake" />
        </div>
      </div>
      ${s.spots.length > 0 && html`<div class="card flush mt-12">
        <div class="st-card-head small bold">Named spots <span class="faint">· ${s.spots.length}</span></div>
        ${s.spots.map(sp => html`<button key=${sp.id} class="st-spot" onClick=${() => renameSpot(sp)}><span>📍</span><span class="grow truncate">${sp.name}</span><${Icon} name="edit" size=${16} /></button>`)}
      </div>`}
    <//>

    <${Section} title="Prices" action="Reset" onAction=${() => { updatePrices({ ...DEFAULT_PRICES }); toast('Prices reset'); }}>
      <div class="card">
        <p class="tiny faint" style="margin-bottom:8px">Used for the “≈ $ spent” estimate in your drop.</p>
        ${DRINK_TYPES.map(d => priceRow(d.id, d.label, d.emoji))}
        ${CATEGORIES.filter(c => c.id !== 'drinks').map(c => priceRow(c.id, c.id === 'cigs' ? 'Cigarette' : c.unit[0].toUpperCase() + c.unit.slice(1), c.emoji))}
      </div>
    <//>

    <${Section} title="Tab Score">
      <div class="card">
        <p class="small muted">Your overall rank uses a weighted score so a joint doesn’t count the same as a single bong rip.</p>
        <div class="st-weights mt-12">${CATEGORIES.map(c => html`<div key=${c.id} class=${cx('st-weight', `cat-${c.id}`)}><span class="cat-icon sm">${c.emoji}</span><span class="grow small">1 ${c.unit}</span><b class="num cat-text">${SCORE_WEIGHTS[c.id]} pt${SCORE_WEIGHTS[c.id] === 1 ? '' : 's'}</b></div>`)}</div>
      </div>
    <//>

    <${Section} title="Privacy">
      <div class="card stack-12">
        ${[['🙈', 'No live status', 'Friends only see weekly drops, never what you’re doing right now.'],
           ['📍', 'Rough areas only', 'Friends see spot names like “Midtown” on a blurry ~400 m area map — never your pins, route or exact location.'],
           ['📱', 'On this device', 'In v1 everything is stored locally in this browser.']].map(([e, t, b]) => html`<div key=${t} class="row top gap-12"><span style="font-size:20px">${e}</span><div><div class="bold small">${t}</div><div class="small muted">${b}</div></div></div>`)}
      </div>
    <//>

    <${Section} title="Demo tools">
      <div class="card">
        <div class="spread"><div><div class="bold small">App clock</div><div class="small muted num">${formatDayLabel(tabDayKey(t, 0))} · ${formatTime(t)}</div></div>
          ${offset !== 0 ? html`<span class="tag warn">${offset > 0 ? '+' : '−'}${formatDuration(Math.abs(offset))}</span>` : html`<span class="tag good">REAL TIME</span>`}</div>
        <div class="st-btns mt-12">
          <button class="btn btn-sm" onClick=${() => travel(HOUR)}>+1 hour</button>
          <button class="btn btn-sm" onClick=${() => travel(DAY)}>+1 day</button>
          <button class="btn btn-sm btn-primary" onClick=${jumpToDrop}>Jump to next drop</button>
          <button class="btn btn-sm btn-ghost" disabled=${offset === 0} onClick=${() => { setClockOffset(0); toast('Back to real time', { emoji: '🕰️' }); }}>Reset clock</button>
        </div>
        <p class="tiny faint mt-8">Time travel only affects this tab and resets when you close it.</p>
        <hr class="divider" />
        <div class="spread">
          <div class="grow"><div class="bold small">Demo crew</div><div class="small muted">${settings.demoMode ? 'Loaded — 20 fake Nashville friends' : 'Not loaded'}</div></div>
          ${settings.demoMode
            ? html`<button class="btn btn-sm btn-danger" onClick=${async () => { if (await confirmSheet({ title: 'Clear demo data?', body: 'Removes demo friends, groups and your seeded history. Your real logs stay.', confirmLabel: 'Clear demo', danger: true })) { clearDemoData(); toast('Demo data cleared'); } }}>Clear</button>`
            : html`<button class="btn btn-sm btn-primary" onClick=${() => { loadDemoData(); toast('Demo crew loaded 👯'); }}>Load</button>`}
        </div>
      </div>
    <//>

    <${Section} title="Your data">
      <div class="card flush">
        <button class="st-action" onClick=${doExport}><${Icon} name="share" size=${18} /><span class="grow">Export backup (JSON)</span></button>
        <label class="st-action"><${Icon} name="arrow-down" size=${18} /><span class="grow">Import backup</span><input type="file" accept="application/json,.json" class="hidden" onChange=${doImport} /></label>
        <button class="st-action" onClick=${async () => { if (await confirmSheet({ title: 'Clear all your logs?', body: 'Deletes every log and session on this device. Friends and groups stay.', confirmLabel: 'Clear logs', danger: true })) { clearMyLogs(); toast('Logs cleared'); } }}><${Icon} name="trash" size=${18} /><span class="grow">Clear my logs</span></button>
        <button class="st-action danger" onClick=${async () => { if (await confirmSheet({ title: 'Reset Tab?', body: 'Wipes everything on this device and starts onboarding again.', confirmLabel: 'Reset everything', danger: true })) { setClockOffset(0); resetAll(); navigate('/', { replace: true }); } }}><${Icon} name="logout" size=${18} /><span class="grow">Reset app</span></button>
      </div>
    <//>

    <p class="center tiny faint mt-24">Tab v0.1 — first go · made for degenerates, with love 🧾</p>
  </div>`;
}

