# Soundboard LAN server (tablet mode)

Runs the soundboard as a small web server so a **tablet** can open it in a
browser and play audio locally — out the tablet's own (e.g. Bluetooth) speaker.
YouTube downloads happen **on the server** (where `yt-dlp`/`ffmpeg` work); the
tablet just drives them.

The browser runs the *same* Vue renderer as the desktop app. The only
difference is the transport: `window.api` talks HTTP + WebSocket
([server/web-api.js](web-api.js)) instead of Electron IPC, and audio is served
from the `/media/` route instead of the `media://` protocol.

## Quick start (local)

```bash
npm install
npm run build:renderer     # builds dist/renderer (served by the server)
npm run fetch:ytdlp        # puts yt-dlp in ./bin (or install it system-wide)
npm run server             # http://localhost:8080
```

`ffmpeg` must be on the `PATH` (or in `./bin`). Data lives in `./data` locally,
or `SOUNDBOARD_DATA_DIR` if set.

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `SOUNDBOARD_DATA_DIR` | `<repo>/data` | Boards, library, mp3s, settings (keep it **outside** the repo in prod) |
| `SOUNDBOARD_AUDIO_QUALITY` | _(unset)_ | `yt-dlp --audio-quality` (e.g. `7` ≈ 96 kbps) to shrink files / egress |

## Deploy to a Proxmox LXC

In a fresh Debian/Ubuntu container, **as root**:

```bash
# point it at YOUR public repo
REPO_URL=https://github.com/<you>/dnd-soundboard.git \
  bash <(curl -fsSL https://raw.githubusercontent.com/<you>/dnd-soundboard/main/scripts/deploy-lxc.sh)
```

…or clone first and run [`scripts/deploy-lxc.sh`](../scripts/deploy-lxc.sh).
It installs Node + ffmpeg + yt-dlp, builds the renderer, and sets up two
systemd units:

- **`dnd-soundboard.service`** — the server (auto-restarts, starts on boot)
- **`dnd-soundboard-update.timer`** — checks the repo every 15 min and, only if
  there are new commits, pulls + rebuilds + restarts ([`scripts/update.sh`](../scripts/update.sh))

Then open `http://<lxc-ip>:8080` on the tablet.

```bash
journalctl -u dnd-soundboard -f          # server logs
systemctl start dnd-soundboard-update    # force an update now
```

> **Edit `REPO_URL`** in `scripts/update.sh` / `scripts/deploy-lxc.sh` (or pass
> it as an env var). The default guesses `github.com/mp97dev/dnd-soundboard`.

## Egress / data usage

Audio responses are sent with `Cache-Control: public, max-age=1yr, immutable`,
and files are content-addressed by YouTube ID (they never change). So each
track transfers **once per device**, then plays from the browser cache forever —
a 4-hour session replaying a 1-hour loop is one ~60–90 MB transfer, not four. A
small [service worker](sw.js) additionally caches the UI shell + thumbnails for
offline use. On your home LAN (tablet ↔ Proxmox) this is all free anyway; the
caching matters only if you expose it remotely (e.g. via Tailscale).

## Chromecast

The server also drives Chromecast casting: `GET /api/cast/devices` (mDNS
discovery), `POST /api/cast/show {host, path, title}`, `POST /api/cast/stop`,
`GET /api/cast/status`. The cast session runs **in the server process**
(castv2-client → Default Media Receiver): the server hands the TV a
`http://<server-ip>:PORT/media/...` URL, so server and Chromecast must be on
the same LAN. The tablet UI only picks the device and the visual. Note: mDNS
discovery needs multicast — it won't find devices from inside WSL or across
VLANs; use the manual-IP option in the UI in that case.

## What it is NOT

The PC/LXC must be reachable on the network — this is a LAN server, not a
standalone Android app. For a truly PC-free build you'd wrap this same web app
in Capacitor and pre-sync audio; that's a separate effort.
