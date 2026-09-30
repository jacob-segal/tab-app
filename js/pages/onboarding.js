// Onboarding: welcome → profile → how days work → location → demo crew.

import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { useStore } from '../hooks.js';
import { Avatar, Icon, Switch, toast } from '../ui.js';
import { completeOnboarding, updateSettings } from '../store.js';
import { ROLLOVER_HOUR_OPTIONS, DEFAULT_ROLLOVER_HOUR } from '../config.js';
import { requestLocationPermission, geoSupported } from '../geo.js';
import { navigate } from '../router.js';

const EMOJIS = ['😎', '🦊', '🐸', '🦄', '🐻', '🦈', '🐐', '🦉', '👽', '🤠', '🥴', '😈', '🍄', '🌵', '🔥', '⚡️', '🪩', '🎸', '🏈', '🐙'];
const HUES = [265, 320, 350, 20, 45, 140, 190, 220];
const STEPS = ['welcome', 'profile', 'days', 'location', 'demo'];

const hourLabel = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const suggestHandle = name => name.toLowerCase().normalize('NFKD').replace(/[^\w\s.]/g, '').trim().replace(/\s+/g, '.').replace(/[^a-z0-9_.]/g, '').slice(0, 20);
const handleError = h => {
  if (!h) return 'Pick a handle';
  if (h.length < 3) return 'At least 3 characters';
  if (h.length > 20) return '20 characters max';
  if (!/^[a-z0-9_.]+$/.test(h)) return 'Letters, numbers, _ and . only';
  return null;
};

export function OnboardingPage() {
  const s = useStore();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [emoji, setEmoji] = useState('😎');
  const [hue, setHue] = useState(265);
  const [locState, setLocState] = useState('idle'); // idle | asking | on | denied | unsupported
  const [demo, setDemo] = useState(true);
  const nameRef = useRef(null);

  useEffect(() => { if (STEPS[step] === 'profile' && nameRef.current) setTimeout(() => nameRef.current && nameRef.current.focus(), 250); }, [step]);

  const go = n => { setDir(n > step ? 1 : -1); setStep(n); window.scrollTo(0, 0); };
  const next = () => go(Math.min(STEPS.length - 1, step + 1));
  const prev = () => go(Math.max(0, step - 1));

  const effectiveHandle = handleTouched ? handle : suggestHandle(name);
  const hErr = handleError(effectiveHandle);
  const profileOk = name.trim().length > 0 && !hErr;
  const rollover = s.settings.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;

  async function enableLocation() {
    if (!geoSupported()) { setLocState('unsupported'); return; }
    setLocState('asking');
    const ok = await requestLocationPermission();
    setLocState(ok ? 'on' : 'denied');
    if (ok) toast('Location on — your spots will show up on the map', { emoji: '📍' });
  }

  function finish() {
    completeOnboarding({ name: name.trim(), handle: effectiveHandle, avatar: { emoji, hue }, demo, locationEnabled: locState === 'on' });
    navigate('/', { replace: true });
    toast(demo ? 'Demo crew loaded. Your first drop is waiting 🎁' : 'You’re in. Start logging 🍻', { duration: 4000 });
  }

  const me = { name: name || 'You', avatar: { emoji, hue } };
  const key = STEPS[step];

  return html`<div class="page no-tabbar pg-onboarding">
    <div class="ob-top">
      ${step > 0 ? html`<button class="icon-btn plain" onClick=${prev} aria-label="Back"><${Icon} name="chevron-left" /></button>` : html`<span class="ob-spacer"></span>`}
      <div class="ob-dots" aria-label=${`Step ${step + 1} of ${STEPS.length}`}>
        ${STEPS.map((k, i) => html`<span key=${k} class=${cx('ob-dot', i === step && 'on', i < step && 'done')}></span>`)}
      </div>
      <span class="ob-spacer"></span>
    </div>

    <div class=${cx('ob-step', dir > 0 ? 'from-right' : 'from-left')} key=${key}>
      ${key === 'welcome' && html`
        <div class="ob-hero">
          <div class="ob-logo">Tab</div>
          <p class="ob-tag">Log your nights. Get your weekly drop. Compare with your crew.</p>
        </div>
        <div class="ob-features stack-12">
          ${[['📝', 'Tap to log', 'Drinks, shots, cigs, joints, edibles, bong hits. Two taps, done.'],
             ['🎁', 'Your drop lands Monday 12 PM', 'A Wrapped-style recap of your week. Every week.'],
             ['👯', 'Compare with your crew', 'Leaderboards, awards and receipts with friends and groups.']].map(([e, t, b]) => html`
            <div class="ob-feature" key=${t}><span class="ob-feature-e">${e}</span><div><div class="bold">${t}</div><div class="small muted">${b}</div></div></div>`)}
        </div>
        <div class="ob-promise"><${Icon} name="lock" size=${18} /> <span><b>No live status.</b> Friends only ever see your weekly drop.</span></div>
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-block" onClick=${next}>Get started</button></div>
      `}

      ${key === 'profile' && html`
        <div class="h1">Who’s running<br />this tab?</div>
        <div class="ob-preview"><${Avatar} user=${me} size="xl" /><div class="h3 mt-12">${name.trim() || 'Your name'}</div><div class="small faint">@${effectiveHandle || 'handle'}</div></div>
        <div class="stack-16">
          <div class="field"><label for="ob-name">Name</label>
            <input id="ob-name" ref=${nameRef} class="input" maxLength="40" placeholder="Jordan Blake" value=${name} onInput=${e => setName(e.currentTarget.value)} autocomplete="name" /></div>
          <div class="field"><label for="ob-handle">Handle</label>
            <div class="input-wrap"><span class="ob-at">@</span>
              <input id="ob-handle" class="input ob-handle-input" maxLength="20" placeholder="jblake" value=${effectiveHandle}
                autocapitalize="off" autocorrect="off" spellcheck="false"
                onInput=${e => { setHandleTouched(true); setHandle(e.currentTarget.value.toLowerCase().replace(/\s/g, '')); }} /></div>
            ${(handleTouched || name) && hErr && html`<div class="tiny ob-err">${hErr}</div>`}
          </div>
          <div class="field"><label>Avatar</label>
            <div class="ob-emojis">${EMOJIS.map(e => html`<button key=${e} class=${cx('ob-emoji', e === emoji && 'on')} onClick=${() => setEmoji(e)} aria-label=${`Avatar ${e}`}>${e}</button>`)}</div>
            <div class="ob-hues">${HUES.map(h => html`<button key=${h} class=${cx('ob-hue', h === hue && 'on')} style=${`--hue:${h}`} onClick=${() => setHue(h)} aria-label=${`Color ${h}`}></button>`)}</div>
          </div>
        </div>
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-block" disabled=${!profileOk} onClick=${next}>Continue</button></div>
      `}

      ${key === 'days' && html`
        <div class="h1">That 2 AM beer?<br /><span class="grad-text">Still Friday.</span></div>
        <p class="muted mt-12">On Tab your day doesn’t end at midnight. It ends at <b>${hourLabel(rollover)}</b>, so late nights count toward the night they started.</p>
        <div class="card ob-timeline mt-16">
          <div class="ob-tl-row"><span class="ob-tl-time">10 PM</span><span class="ob-tl-dot" style="--cat: var(--c-drinks)"></span><span>🍺 First beer</span><span class="ob-tl-day">Fri</span></div>
          <div class="ob-tl-row"><span class="ob-tl-time">12 AM</span><span class="ob-tl-dot" style="--cat: var(--c-shots)"></span><span>🥃 Midnight shot</span><span class="ob-tl-day">Fri</span></div>
          <div class="ob-tl-row"><span class="ob-tl-time">2 AM</span><span class="ob-tl-dot" style="--cat: var(--c-cigs)"></span><span>🚬 Parking-lot cig</span><span class="ob-tl-day">Fri</span></div>
          <div class="ob-tl-row reset"><span class="ob-tl-time">${hourLabel(rollover)}</span><span class="ob-tl-dot"></span><span class="faint">Day resets</span><span class="ob-tl-day">Sat</span></div>
        </div>
        <div class="card mt-12 row top gap-12"><span style="font-size:24px">🌙</span><div><div class="bold">Sessions</div><div class="small muted">Going out? Start a session and everything you log counts toward that night, even if you’re still going at sunrise.</div></div></div>
        <div class="field mt-16"><label>My day ends at</label>
          <div class="ob-hours">${ROLLOVER_HOUR_OPTIONS.map(h => html`<button key=${h} class=${cx('chip', h === rollover && 'active')} onClick=${() => updateSettings({ rolloverHour: h })}>${hourLabel(h)}</button>`)}</div>
        </div>
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-block" onClick=${next}>Makes sense</button></div>
      `}

      ${key === 'location' && html`
        <div class="ob-bigemoji">📍</div>
        <div class="h1">Map your nights <span class="faint" style="font-size:18px">(optional)</span></div>
        <p class="muted mt-12">Like Strava, but for going out. During a session, every log drops a pin and your route gets recorded. Your drop shows your top spots.</p>
        <div class="stack-8 mt-16">
          <div class="ob-point"><span>🔒</span><span class="small">Friends only see spot names like “Midtown” and a rough area map — never your route or exact location.</span></div>
          <div class="ob-point"><span>🔋</span><span class="small">Only used while a session is running, and only while Tab is open.</span></div>
          <div class="ob-point"><span>⚙️</span><span class="small">You can turn it on or off anytime in Settings.</span></div>
        </div>
        ${locState === 'on' && html`<div class="banner mt-16"><span>✅</span><span class="small bold">Location is on</span></div>`}
        ${locState === 'denied' && html`<div class="banner mt-16"><span>🚫</span><span class="small">Location was blocked. You can allow it later in your browser settings, then flip it on in Settings.</span></div>`}
        ${locState === 'unsupported' && html`<div class="banner mt-16"><span>🤷</span><span class="small">This browser can’t share location here (it needs HTTPS). Everything else works fine.</span></div>`}
        <div class="ob-actions stack-8">
          ${locState === 'on'
            ? html`<button class="btn btn-primary btn-lg btn-block" onClick=${next}>Continue</button>`
            : html`<button class="btn btn-primary btn-lg btn-block" disabled=${locState === 'asking'} onClick=${enableLocation}>${locState === 'asking' ? 'Asking…' : 'Enable location'}</button>
                   <button class="btn btn-ghost btn-block" onClick=${next}>Not now</button>`}
        </div>
      `}

      ${key === 'demo' && html`
        <div class="ob-bigemoji">👯</div>
        <div class="h1">Bring a crew?</div>
        <p class="muted mt-12">v1 has no servers yet. The demo crew fills Tab with fake friends around Vanderbilt, three groups and six past weeks of your own history, so you can try everything today.</p>
        <div class="card mt-16 row gap-12">
          <div class="grow"><div class="bold">Load demo crew (Nashville)</div><div class="small muted">20 fake people, 3 groups, a drop waiting for you</div></div>
          <${Switch} checked=${demo} onChange=${setDemo} label="Load demo crew" />
        </div>
        ${!demo && html`<p class="small faint mt-12">Starting clean: your first drop lands next Monday at 12 PM. You can load the demo later in Settings.</p>`}
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-block" onClick=${finish}>Let’s go 🍻</button></div>
      `}
    </div>
  </div>`;
}
