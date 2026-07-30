# Known limitations, workarounds and technical debt

Things that are deliberately unfinished, deliberately not done, or known to
misbehave. Each entry says what the situation is, why it is that way, and what
to do about it — so nobody has to rediscover the reasoning from the code.

Companion to [session-test-plan.md](session-test-plan.md), which covers what was
measured during a real session.

---

## Casting

### Casting to the TV is unreliable on some setups

**Status:** open, under investigation.

Casting a visual to the Chromecast fails often enough on at least one real
setup to be unusable, while the same media plays correctly on the viewer page.
The failure has not yet been narrowed to a cause.

The three candidate causes need telling apart, because they are different bugs
with different fixes:

| Where it fails | Log signature | Likely cause |
|---|---|---|
| Connecting | `connect: fallita`, `connect: timeout di 8s scaduto` | mDNS handed back a stale IP, or the TV is asleep |
| Loading the media | `La TV non ha caricato il media (timeout)` | The TV cannot fetch the file from the PC: firewall, wrong LAN IP advertised, or a congested 2.4 GHz band |
| Mid-session | `watchdog`, `player-close`, `client-error` | The TV dropped the receiver — the Backdrop/ambient-mode hypothesis |

Every disconnect is already recorded with its cause and the session uptime.
To collect it:

```bash
npm run session-report -- path/to/soundboard.log --verbose
```

The log lives in the data directory (see *Data & storage* in the README):
`~/.config/dnd-soundboard/data/logs/soundboard.log` on Linux,
`%APPDATA%\dnd-soundboard\data\logs\soundboard.log` on Windows.

**Workaround in the meantime: cast the browser tab.** See below.

### Workaround — cast the viewer tab instead of the media

Instead of having the app send the media to the TV, put the **viewer page** on
the TV using Chrome's own tab casting:

1. Open `http://<pc-ip>:<port>/viewer` in Chrome — the 📱 toolbar button copies
   that URL.
2. Chrome menu → **Cast** → pick the TV → **Sources → Cast tab**.
3. Leave the app's 📺 picker **empty**. In viewer-only mode the app pushes
   visuals to the page and never touches the Cast protocol, so nothing fights
   over the TV.

This is reliable where the media path is not, because Chrome handles the
transport. The cost is that it is manual — a few clicks each session — and that
tab mirroring re-encodes the video, so quality is lower than a direct cast and
the PC does more work.

### Why the app cannot do that for you

Tab mirroring is a Chrome browser feature and is not exposed to web pages or to
apps: there is no API to start it programmatically.

Casting a *page* rather than a media file needs a **custom Web Receiver** — an
HTML app registered in the Google Cast SDK Developer Console, with an App ID
the sender launches instead of the Default Media Receiver. That was considered
and rejected:

- A **published** receiver must be served over **HTTPS**. The viewer is plain
  HTTP on the LAN, and no public CA will issue a certificate for a LAN IP.
- An **unpublished** receiver may be hosted on an ordinary server, but only
  works on Chromecast devices individually enrolled in the console. It would
  break on any TV a user has not registered.

Either path trades a local-first app for one that depends on a Google developer
account and per-device enrolment. Not worth it for a self-hosted tool — unless
the media path turns out to be unfixable, in which case revisit this.

Sources: [Web Receiver overview](https://developers.google.com/cast/docs/web_receiver),
[Registration](https://developers.google.com/cast/docs/registration).

### The HLS loop playlist has a repetition ceiling

Videos are cast as an HLS playlist that repeats the same segments to fake a
~4-hour single file, which avoids the receiver's overlay and re-buffering on
every loop. The repeat count is capped at `MAX_LOOPS = 500`
(`server/lib/hlsloop.js`).

For short clips the cap bites before the 4-hour target: a 5-second video ends
after about 42 minutes, not 4 hours. When the playlist ends the cast session
drops. If a visual mysteriously stops after a while, check the clip length
against that arithmetic.

### The visual button tolerates a 12-second cast dropout

`visuals.status()` keeps reporting a visual as on-screen for 12 seconds after
the cast session goes down, so a momentary drop at the end of a media cycle
does not unlight the button while the video is plainly still playing.

This is a deliberate papering-over. It hides the symptom, not the cause: if the
session really is dropping on every loop, that is worth fixing at the source
once the logs say why.

---

## Library

### Removing a track leaves its file on disk

"Remove from library" deletes the row from `index.json` and nothing else. A
downloaded mp3 or an imported video is not recoverable once deleted, and
"remove from my library" is not the same request as "delete my files".

The cost is that unreferenced files accumulate in `library/downloaded/`. There
is no cleanup tool yet; a future one should list unreferenced files and let the
user confirm before deleting anything.

### Deleting a track leaves board buttons dangling

Board buttons reference tracks by id. Removing a track a button points at
leaves the reference in place, and the button renders as "no track".

The confirmation dialog counts how many buttons across **all** boards reference
the selection and shows that before you commit, so it is at least never
silent. It does not offer to clean the buttons up.

### Built-in tracks cannot be removed

They do not live in `index.json` — `library:list` re-adds them from
`builtin-tracks.json` on every launch. A library that empties itself and comes
back full on restart would be worse than being told no, so removal is refused
outright.

---

## Interface

### The toolbar is overloaded

It holds eleven controls and wraps to two rows at 1280px. Nothing is clipped —
`flex-wrap` plus `flex-shrink: 0` on Stop All, Master and Play/Edit keeps every
control reachable — but two rows costs vertical space that the grid could use.

Export and Import are the obvious candidates to move into the library dialog.

### Dragging from the library to the grid still uses HTML5 drag-and-drop

In-grid moving and resizing were rewritten on Pointer Events: snapped ghost,
occupancy check, refusal on collision. The **library → grid** path was not, and
still uses the browser's native drag, so it shows the browser's ghost image
rather than a snapped preview.

It is not broken — that path does check collisions, and offers the nearest free
cell when you aim at an occupied one. Converting it means converting the
sidebar's folder drops at the same time, since both share the same
`dataTransfer` types.

### Hairline borders fall below the WCAG contrast guidance

`--border` against `--bg-panel` measures 1.3–1.7:1 across all themes, under the
3:1 guidance for UI component boundaries. This is a deliberate hairline
aesthetic and no state is conveyed by those borders alone — every control that
signals state does so with colour and text as well. Raising it is a
system-wide decision that belongs in `tokens.css`.

### Text in the Electron main process is not translated

The UI is fully IT/EN, but strings thrown from the main process reach the
renderer untranslated: `electron/ipc/ytdlp.js` download errors,
`electron/ipc/config.js` dialog titles, and the file-filter names in
`electron/ipc/filesystem.js`. They surface as `job.error` in the library panel.

`server/viewer.html` is Italian-only for the same reason.

Log lines are deliberately left in Italian — `scripts/session-report.js` parses
them.

---

## Build and dependencies

### Dev-only audit findings remain

`npm audit --omit=dev` reports **0**: nothing vulnerable ships. The remaining
findings are all dev-only and none are in `build.files`:

- `brace-expansion`, reached through `electron-builder`. npm's only offered fix
  downgrades electron-builder to 25.1.8 — refused.
- `esbuild`, an arbitrary-file-read affecting the **dev server on Windows**
  only. `vite@7` pins `esbuild ^0.27`, and the fix is in 0.28.1; clearing it
  needs a vite major bump.

`protobufjs` is pinned to `^7.5.4` via `overrides` because
`castv2 → protobufjs@6` carried five advisories, and `npm audit fix --force`
"fixes" them by downgrading `castv2-client` to 0.0.2, which breaks casting
entirely. castv2 only uses `load`, `lookupType`, `encode().finish()` and
`decode()`, all unchanged in 7.x, and the enum values stay numeric — which
matters, because `castv2/lib/client.js` rejects any packet whose
`protocolVersion !== 0`.

### Node 20 deprecation warnings in CI

`actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and are forced
onto Node 24 by the runners. Harmless today; will need the actions bumping.
