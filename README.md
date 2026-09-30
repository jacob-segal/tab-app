# Tab 🧾

Log your nights, get your weekly drop, and compare with your crew.

Tab works like Superfan, but for nights out. It tracks drinks (beer, seltzer, wine, mixed, other), shots, cigarettes, joints, edibles and bong hits. It never shows live status. Every **Monday at 12 PM** your week "drops" as a Wrapped-style story, and you see how you stack up against your friends and groups.

## Run it

You don't need Node or a build step. Serve the folder:

```bash
python3 tools/serve.py
```

Then open http://localhost:8765 and use your browser's phone emulation. You can also add it to your home screen, but see the phone section below.

## Run the checks

```bash
zsh tools/check.sh
```

```bash
zsh tools/test.sh
```

`check.sh` runs a syntax check and verifies that every import resolves. `test.sh` runs about 100 logic tests with JavaScriptCore, which is built into macOS.

## Using it on your phone

Location and "Add to Home Screen" only work over **HTTPS** (or on localhost). To use it on a phone, host the folder somewhere static with HTTPS, such as GitHub Pages, Netlify Drop or Cloudflare Pages. Once it's hosted, open it in Safari and use **Share → Add to Home Screen**.

## How time works

- **Tab days:** your day ends at **6 AM** instead of midnight. You can change this to anywhere from 3–8 AM in Settings. A 2 AM beer on Saturday counts as Friday night.
- **Sessions:** start one when you go out. Everything logged during a session counts toward the night it started, even if you're still going at 9 AM. A session ends automatically after 5 hours without a log or 16 hours total.
- **Weeks:** a week runs from Monday 6 AM to the next Monday 6 AM. Its drop comes out **Monday at 12 PM**. Between 6 AM and noon the week is "cooking", so you can still fix Sunday. After the drop it's locked for good.
- **No live status:** you can see each day's counts on the tracker. Weekly totals, ranks and awards stay hidden, even from you, until the drop. Friends see nothing until then.

## Demo mode

Version 1 has no backend. During onboarding you can load a demo crew: about 20 fake students around Vanderbilt/Nashville, 3 groups and 6 past weeks of your own history.

Settings → **Demo tools** lets you time-travel. Use **Jump to next drop** to watch a drop land.

## Code map

See [ARCHITECTURE.md](ARCHITECTURE.md). In short:

- `js/time.js`, `js/stats.js`, `js/store.js` and `js/data.js` hold all the logic. They're pure modules with no DOM.
- `js/pages/*` are the screens.
- `js/data.js` is where a real backend (e.g. Supabase) would replace `js/demo.js`.
