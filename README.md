# ⚔️ DnD Soundboard

A local-first soundboard for tabletop RPG sessions. Lay out music, ambience and
one-shot sound effects on a grid of buttons, pull tracks straight from YouTube,
and fire them during play. **Electron + Vue 3 + Pinia + Web Audio API.**

Run it two ways from the same codebase:

- **Desktop app** — Windows / Ubuntu / macOS (Electron).
- **Tablet mode** — a small LAN server you host (e.g. a Proxmox LXC); open it in
  a tablet's browser and play out the tablet's own Bluetooth speaker. See
  [Tablet mode](#-tablet-mode-lan-server).

![Play mode](docs/img/play-mode.png)

---

## Contents

- [Features](#features)
- [Quick start (desktop)](#-quick-start-desktop)
- [Using the app](#-using-the-app)
  - [Boards](#boards)
  - [Building your library](#building-your-library)
  - [Edit mode](#edit-mode)
  - [Play mode](#play-mode)
  - [Export / Import](#export--import)
- [Tablet mode (LAN server)](#-tablet-mode-lan-server)
- [Data & storage](#-data--storage)
- [Development](#-development)
- [Troubleshooting](#-troubleshooting)

---

## Features

- **Grid boards** — resizable buttons on a grid, multiple boards, switch from the toolbar.
- **Three channels** — *music* (exclusive, with crossfade/fade/instant transitions),
  *ambience* (layered, looping), *one-shot* (fire-and-forget effects).
- **YouTube import** — paste a single link, **many links at once, or a whole playlist**;
  downloads run **in parallel**. Audio is extracted to mp3 with thumbnails.
- **Local import** — drop in your own mp3/ogg/wav/m4a/flac files.
- **Export / Import** — share boards + settings + library metadata as one JSON
  (no heavy mp3s; YouTube tracks re-download themselves on the other machine).
- **Self-healing** — if a referenced audio file is missing, it's re-downloaded
  automatically from its YouTube source on board open.
- **Local-first** — everything lives in plain JSON + local files; no account, no cloud.

---

## 🚀 Quick start (desktop)

### Requirements

- **Node.js 20+**
- **`yt-dlp`** — in your `PATH` or in `./bin` (`yt-dlp.exe` on Windows).
  `./install.sh` / `npm run fetch:ytdlp` fetches the latest release into `./bin`.
- **`ffmpeg`** — in your `PATH` (yt-dlp uses it to convert to mp3).

### Run in development

```bash
./install.sh      # npm install + download yt-dlp into ./bin
npm run dev        # launches Vite + Electron with hot reload
```

(Or manually: `npm install`, then put `yt-dlp` in your `PATH` or `./bin`.)

### Build a distributable

| Platform | Command |
|---|---|
| Windows | `npm run build` |
| Ubuntu / Linux | `npm run build:linux` |
| macOS | `npm run build:mac` |

Output lands in `dist/out/`.

---

## 🎛️ Using the app

The window has a **toolbar** (board switcher, export/import, master volume,
Stop All, Play/Edit toggle) and a **main area** that shows either Play or Edit mode.

### Boards

- **+ Nuova board** creates a board; the dropdown switches between them.
- A board is a grid (default 8×12) of buttons. Each button points at a library
  track by id — so boards stay tiny and portable.

### Building your library

In **Edit mode** the left sidebar is your library.

![Library sidebar](docs/img/library-sidebar.png)

- **YouTube** — paste into the *“URL o playlist YouTube”* box and hit the
  download button. You can paste:
  - a single video URL,
  - **several URLs** (one per line / separated by spaces or commas),
  - a **playlist** URL — it's expanded into its videos automatically.

  Downloads run **up to 3 at a time**, each with its own progress bar; finished
  ones drop off the list, failures stay so you can retry.
- **+ Importa audio locale** — pick local audio files to add as one-shots.
- Tracks are grouped **Musica / Ambience / One-Shot**. The coloured dot marks the
  channel. Drag any track onto the grid to create a button.

> Set the download bitrate with the `SOUNDBOARD_AUDIO_QUALITY` env var
> (e.g. `7` ≈ 96 kbps) to shrink long ambience loops.

### Edit mode

![Edit mode](docs/img/edit-mode.png)

- **Drag** a library track onto the grid to add a button; **drag** an existing
  button to move it.
- **Click** a button to select it (orange outline) and edit it in the
  **properties panel**: label, channel/track, size (row/column span).
- A button showing a dashed border is **unassigned** or its file is **missing**.

### Play mode

The session view — big buttons, no editing. Tap to trigger. Button colours:

| Colour | Meaning |
|---|---|
| 🔵 Blue border | Music track currently playing (one at a time) |
| 🟢 Green border | Ambience layer currently playing |
| 🟠 Amber flash | One-shot just fired |
| Dashed / faded | File missing or no track assigned |

The toolbar has the **Master** volume slider and **⏹ Stop All** (fades everything out).

### Export / Import

- **⤓ Esporta** writes a single JSON with your settings, all boards, and the
  library index (track metadata + YouTube URLs) — **without** the mp3 files.
- **⤒ Importa** loads such a file on another machine: boards and settings appear
  immediately, and the YouTube tracks re-download themselves automatically.
- Locally-imported (non-YouTube) tracks can't be re-fetched, so they'll show as
  missing after import on a fresh machine.

---

## 📱 Tablet mode (LAN server)

Want to drive the soundboard from a tablet and play out its Bluetooth speaker?
Host the server (downloads still happen server-side where yt-dlp works) and open
it in the tablet's browser — it runs the same UI and plays audio locally.

**On a Proxmox LXC (Debian/Ubuntu), as root:**

```bash
apt-get update && apt-get install -y curl
REPO_URL=https://github.com/mp97dev/dnd-soundboard.git BRANCH=main \
  bash <(curl -fsSL https://raw.githubusercontent.com/mp97dev/dnd-soundboard/main/scripts/deploy-lxc.sh)
```

This installs Node + ffmpeg + yt-dlp, builds the renderer, and sets up two
systemd units: the **server** and a **15-minute auto-updater** that pulls new
commits and rebuilds. Then open `http://<lxc-ip>:8080` on the tablet.

Run it locally instead with `npm run server` (→ `http://localhost:8080`).

Full details, env vars, egress/caching notes and remote access (Tailscale) are in
**[server/README.md](server/README.md)**.

---

## 💾 Data & storage

Everything is plain JSON + local files. In desktop dev it's `./data`; in a
packaged app it's the OS `userData` folder; on the server it's
`SOUNDBOARD_DATA_DIR` (kept outside the repo).

```
data/
├── boards/*.json        Boards (grid + buttons)
├── library/
│   ├── index.json       Track index (user tracks)
│   ├── builtin/         Bundled sounds (ambience/, oneshots/)
│   ├── downloaded/      Audio (YouTube + local imports)
│   └── thumbnails/
└── settings.json
```

The renderer never touches the filesystem directly: in the desktop app it reads
assets through the custom `media://` protocol and talks to the main process over
IPC; in the browser/server build the same calls go over HTTP + WebSocket.

### Built-in sounds

Put audio in `data/library/builtin/ambience/` and `oneshots/`, then add entries
to `data/library/index.json` (or just import them from the app as local files).

---

## 🛠️ Development

```
electron/            Main process (desktop)
├── main.js          Window, media:// protocol, bootstrap
├── preload.js       Secure IPC bridge (window.api)
├── paths.js         Local data paths
└── ipc/             boards/library, settings, ytdlp, config (export/import)

src/                 Renderer (Vue 3) — shared by desktop and server
├── audio/engine.js  Web Audio: music (transitions), ambience, one-shots
├── media.js         media:// (Electron) vs /media/ (web) URL base
├── stores/          Pinia: library, boards, settings, playback
└── components/      PlayMode, EditMode, LibrarySidebar, PropertiesPanel, SoundButton

server/              LAN server (tablet mode): HTTP + WS over the same renderer
scripts/             yt-dlp/ffmpeg fetch, LXC deploy + auto-update, systemd units
e2e/                 Playwright tests (Electron)
```

Run the end-to-end tests:

```bash
npm run test:e2e
```

---

## 🩺 Troubleshooting

- **YouTube download fails** (e.g. *“Precondition check failed”*): yt-dlp is out
  of date — re-run `./install.sh` or `npm run fetch:ytdlp`.
- **No audio on a track / “file missing”**: the mp3 wasn't found; open the board
  (YouTube tracks re-download) or click *“Scarica N file mancanti”* in the sidebar.
- **`ffmpeg not found`**: install ffmpeg and ensure it's on the `PATH` (or in `./bin`).
- **Tablet can't reach the server**: it must be on the same network as the host;
  check the LXC IP and that port `8080` is open. See
  [server/README.md](server/README.md) for remote access.
