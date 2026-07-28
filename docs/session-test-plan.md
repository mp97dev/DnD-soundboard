# Findings and test plan — audio dropouts and cast disconnects

Written after the 4-hour live session of July 2026 (ThinkPad T430, Ubuntu, `.deb`
install, JBL Bluetooth speaker, Chromecast on TV, Brave with 10–20 tabs open).

This document records **what we concluded**, **what we changed**, and **what the
next session has to measure**. Read the "Test protocol" section before playing.

---

## 1. Is the code platform-dependent?

Almost not at all. The entire source tree contains six OS branches, all trivial:

| Location | Branch |
| --- | --- |
| `electron/ipc/ytdlp.js:25` | `yt-dlp` vs `yt-dlp.exe` |
| `electron/ipc/cast.js:22` | `ffmpeg` vs `ffmpeg.exe` |
| `electron/ipc/filesystem.js:13` | `ffmpeg` vs `ffmpeg.exe` |
| `server/lib/ytdlp-update.js:54` | `chmod +x` on non-Windows |
| `electron/main.js:43,154` | macOS menu / quit convention |
| `electron/main.js:20` | disable GPU under WSL |

Nothing in the audio path, the cast path, or the HTTP server branches on OS.

**But the code was platform-*fragile*** in two specific places. "Platform issue"
was a partly correct diagnosis that hid two real defects.

---

## 2. Finding A — Bluetooth stutter and permanent silence

### What was wrong

`src/audio/engine.js` streamed music and ambience through
`ctx.createMediaElementSource(el)` into a Web Audio graph. Four consequences:

1. **It abandoned Chromium's dedicated media output path.** A plain `<audio>`
   element feeds `AudioRendererImpl`, which has a deep, adaptive buffer and an
   explicit re-buffering state. Attaching a `MediaElementSource` moves output to
   the AudioContext's fixed-size render callback, whose size is chosen once at
   context construction.
2. **The graph rendered in the renderer process.** Every GC pause or swap-in
   caused by the browser's 20 tabs was a chance to miss the audio deadline and
   produce a dropout.
3. **The context was constructed at module scope**, binding its output stream and
   sample rate before any output device was chosen. A PulseAudio A2DP↔HSP profile
   switch — routine when a Bluetooth speaker reconnects — happens underneath it.
4. **There was no recovery code whatsoever.** No `error`, `stalled`, `waiting`,
   or `ended` listener; no `ctx.onstatechange`; no `devicechange` handling.

Points 1–3 explain the stuttering, and are genuinely amplified by the hardware
(see §4). **Point 4 is entirely our defect**, and it is what forced a manual
restart mid-session: the audio died, nothing noticed, and the UI kept showing the
track as playing.

### What changed

- Music and ambience now play the `HTMLAudioElement` **directly**, with no Web
  Audio graph. Volume via `el.volume`; fades reproduce the previous exponential
  curve with a timed ramp.
- One-shots deliberately **keep** the AudioContext — `AudioBuffer` is the right
  tool for instant, overlapping triggers. Master volume is applied on both paths.
  Upside of the split: a wedged AudioContext can now only kill one-shots, never
  the music bed.
- Full recovery: `error`, `stalled`/`waiting` (3s grace), and `ended`-while-looping
  each rebuild the element at its saved position, up to 5 attempts with backoff.
  A `devicechange` listener re-issues `play()` on every live voice.
- If recovery is exhausted, the failure is now **shown in the UI** instead of
  being silent.
- Removing the Web Audio graph also removed the `crossOrigin = 'anonymous'`
  workaround and its CORS failure mode.

---

## 3. Finding B — Chromecast disconnects

### What was wrong

The session ran on 0.1.5 or earlier, where `server/lib/cast.js` had **no
reconnection logic at all**. Any dropped socket meant a dead session until the
device was manually re-selected. That is exactly the reported symptom, three
times in four hours. This was not a platform issue.

### What changed

| Version | Mechanism |
| --- | --- |
| 0.2.0 | `scheduleReconnect` — retry every 5s, give up after 10 min |
| unreleased | `ensureWatchdog` — `getStatus` probe every 30s |

The watchdog matters because of the **leading unconfirmed hypothesis**: the
Default Media Receiver is not designed to hold a *static image* indefinitely. The
Chromecast falls back to Backdrop/ambient mode and terminates the receiver
**without emitting any socket error**, which is precisely why the original
`error`/`close` handlers were blind to it. The watchdog detects that case by
checking whether the receiver app is still among the TV's active applications.

**This hypothesis is not yet confirmed, and the next session must confirm or
refute it.** If confirmed, the fix is to wrap still images into a short looping
H.264 video — an actively-playing stream keeps the receiver alive indefinitely,
which is why the video case never disconnected. `ffmpeg` is already bundled and
`server/lib/hlsloop.js` already does the segmentation. That work is deliberately
**not** done yet: it should not be built on an unmeasured theory.

---

## 4. Finding C — the physical layer (this part really is the platform)

Two facts about the T430 explain both symptoms from a single cause.

**2.4 GHz coexistence.** The stock T430 WLAN card is commonly the Centrino
Wireless-N 2200, which is **2.4 GHz only**. Bluetooth A2DP is also 2.4 GHz, on
antennas centimetres apart. Intel's coexistence logic time-slices the radio
between them, degrading Bluetooth audio *and* WiFi at once — and getting worse as
WiFi traffic grows, which is what happens as browser tabs accumulate.

This matters more than it first appears: **the laptop is the media server for the
TV.** `server/lib/cast.js` builds the cast URL from the laptop's LAN IP, and the
Chromecast pulls the file over HTTP from the laptop. Laptop WiFi quality *is* TV
stream quality.

**WiFi power management.** Ubuntu's `iwlwifi` enables `power_save` by default on
battery, which directly starves the TV's stream. The new startup diagnostics now
record this state so we can stop guessing.

**Ubuntu version.** 22.04 ships PulseAudio; 24.04 ships PipeWire + WirePlumber.
For Bluetooth this is a large difference — PipeWire handles A2DP profile
switching, auto-reconnect and codec negotiation far more robustly. The startup
diagnostics now record which one is running.

---

## 5. Logging

Everything above is now instrumented. One log file, written by both the desktop
app and the LAN server:

```
<DATA_DIR>/logs/soundboard.log
```

For a packaged Linux desktop install that is:

```
~/.config/DnD Soundboard/data/logs/soundboard.log
```

In development it is `./data/logs/soundboard.log`. The file rotates at 2 MB
keeping one `.1` backup, so a long session cannot fill the disk. A logging
failure can never break playback or casting.

Line format:

```
2026-07-24T11:08:51.420Z INFO  cast session lost detector=watchdog uptimeSec=3612
```

Scopes you will see:

| Scope | Contents |
| --- | --- |
| `app` | startup: app / Electron / Chromium / Node versions, platform, arch |
| `env` | distro, audio server (PipeWire vs PulseAudio), default sink, WiFi power-save, LAN IP |
| `audio` | track start/stop, stalls, errors, rebuilds, device changes, AudioContext state, sample rate, base latency |
| `cast` | discovery, connect/launch/load timings, **session loss with which detector fired and uptime**, reconnect attempts |
| `ui:health` | renderer heartbeat, once a minute: heap, AudioContext state, live voices, and whether any voice is *silently* dead |
| `health` | host heartbeat, once a minute: RSS, heap, event-loop delay, cast session uptime |
| `ui:*` | anything reported from the renderer |
| `soak` | actions performed by the unattended soak driver (§9) |

The two heartbeat scopes are what make a long session measurable at all. Nothing
emits an event when audio quietly stops or memory creeps up over four hours —
those are only visible by comparing two distant instants, which is exactly what
a periodic line gives you. The renderer heartbeat downgrades itself to `WARN`
and prints per-voice detail the moment a voice claims to be playing while its
element is paused, or its `currentTime` has not moved since the previous beat.

The single most valuable line is the cast session-loss line: it names the
detector that fired and the session uptime in seconds. Four sessions' worth of
those answers the Backdrop question definitively.

---

## 6. Test protocol for the next session

Do a normal session. Do not change how you play — the point is to reproduce real
conditions. Just do the setup below, and note wall-clock times when something
feels wrong.

### Before starting

1. **Note the log file location** (§5) and confirm it exists after first launch.
2. **Record the baseline**: open the log and read the `env` block. Note whether
   the audio server is PipeWire or PulseAudio, whether the default sink is a
   `bluez` device, and whether WiFi `power_save` is on.
3. **Do not "fix" anything yet.** This session is a measurement, not a cure. If
   we change the audio stack and the hardware and the code all at once, we learn
   nothing about which one mattered.

### During the session

Play normally, then keep a rough note of:

- Any audible stutter — approximate time, and whether music or ambience.
- Any silence requiring manual intervention — this should now be impossible; if
  it happens, it is the most important result of the session.
- Any TV disconnect — approximate time, and what was on screen (**still image or
  video?** this is the decisive detail).
- Whether the on-screen audio error banner ever appears.

### Deliberate probes — worth 10 minutes total

| # | Probe | What it answers |
| --- | --- | --- |
| 1 | With music playing, turn the Bluetooth speaker **off**, wait 15s, turn it back **on** | Does audio resume on its own? This is the exact failure that forced a manual restart. Expect a rebuild in the log and sound returning without a click. |
| 2 | Cast a **still image** and leave it untouched for at least 90 minutes while playing normally | Confirms or refutes the Backdrop hypothesis. The log will show the detector and uptime. |
| 3 | Cast a **looping video** and leave it equally long | The control for probe 2. If video survives and image does not, the hypothesis is confirmed. |
| 4 | Mid-session, close Brave entirely for ~15 minutes while music plays | Isolates renderer/memory pressure from radio interference as the stutter cause. |
| 5 | If you can, run one stretch on **mains power** and one on **battery** | Isolates WiFi power-save and CPU scaling. |

### After the session

Copy the log file somewhere safe **before** relaunching the app — the 2 MB
rotation could otherwise discard the interesting part of a very long session.

Then grep it:

```bash
LOG=~/.config/"DnD Soundboard"/data/logs/soundboard.log
grep ' cast '  "$LOG" | grep -i 'lost\|reconnect'   # disconnect timeline
grep ' audio ' "$LOG" | grep -i 'stall\|error\|rebuild\|devicechange'
grep ' env '   "$LOG"                                # the baseline block
```

---

## 7. Decision table — what each outcome means

| Observation | Conclusion | Action |
| --- | --- | --- |
| Probe 1 recovers automatically | Finding A is fixed | Nothing further on audio recovery |
| Probe 1 does not recover | Rebuild logic is insufficient | Read the `audio` rebuild lines; likely needs a full voice teardown, not an element swap |
| Stutter persists with Brave closed (probe 4) | Radio interference, not CPU | Go to the hardware remediations in §8 |
| Stutter disappears with Brave closed | Renderer/memory pressure | Move reference tabs to a second device |
| Image disconnects, video does not (probes 2 vs 3) | **Backdrop hypothesis confirmed** | Implement the still-image-to-looping-video wrap |
| Both disconnect at similar uptimes | Network, not the receiver | Look at `env` WiFi power-save and §8 |
| Neither disconnects | Reconnect + watchdog were sufficient | Close the issue |

---

## 8. Environment remediations, by value per effort

None of these are code changes. Ordered by impact.

| # | Action | Cost | Fixes |
| --- | --- | --- | --- |
| 1 | **Use a 3.5 mm cable or USB DAC instead of Bluetooth** | €0–15 | Removes the audio problem *and* frees the 2.4 GHz band, improving cast stability |
| 2 | Disable WiFi power save: `sudo iw dev <iface> set power_save off` (persist via NetworkManager) | free | Cast buffering and drops |
| 3 | Upgrade to **Ubuntu 24.04 LTS** for PipeWire | free | Bluetooth reliability, if staying wireless |
| 4 | Move reference tabs (Notion, stat blocks) to a tablet | free | Renderer stalls |
| 5 | Dual-band WLAN card (Intel 6205 is a whitelisted T430 FRU) + separate USB Bluetooth 5.x dongle | ~€20 | 2.4 GHz coexistence |

**On replacing the laptop:** not warranted. The T430 runs this app comfortably;
what overloads it is the browser. Item 4 is cheaper and more effective. If
replacing anyway, the requirement is dual-band AC/AX WiFi and Bluetooth 5.0, not
CPU.

**On changing OS:** stay on Ubuntu, just reach 24.04.

**On changing packaging:** no. `.deb`/AppImage is fine. Flatpak and Snap would add
audio sandboxing problems in exactly the area that is already fragile.

**On server mode:** the most interesting option. Running the app in server mode
and driving it from a tablet moves audio output to a single-purpose device with a
clean Bluetooth stack, sidestepping both the coexistence and the renderer-stall
problems with no hardware purchase. The `/viewer` page also has no Backdrop
timeout, making it structurally more reliable than the Default Media Receiver.

---

## 9. Two tools you can run yourself

Both are plain npm scripts. Neither renames nor deletes anything. (One caveat on
the soak: the app itself re-downloads library files that have gone missing when it
starts, so launching it against a data directory with missing tracks will restore
them — that is normal app behaviour, not the soak.)

### `npm run session-report` — read a session log

```bash
npm run session-report                            # finds the installed log by itself
npm run session-report -- ~/soundboard.log        # a log copied off the game laptop
npm run session-report -- ~/soundboard.log --verbose
```

Reads `soundboard.log` (and the rotated `.1`, so a long session isn't truncated)
and answers, in one screen, the questions §6 asks you to note by hand:

- **Chromecast** — every session loss with the detector that fired, the uptime,
  and whether the screen held an image or a video. If only images drop and they
  drop at similar uptimes, it says so: that is the decision-table row that
  confirms the Backdrop hypothesis (§7).
- **Audio** — per track: normal buffering, real stalls, errors, rebuilds, and
  *give-ups*. A track with a give-up is one that stayed silent until a restart —
  the worst outcome, and the one probe 1 exists to rule out.
- **Health over time** — heap, RSS and event-loop delay from start to finish. It
  flags a renderer heap that more than doubled, and any moment the host event
  loop stalled long enough to break the audio byte pump.
- **Recording gaps** — dropped log lines, plus silences longer than three
  heartbeats. With the heartbeat running, a long silence means the *process* was
  stopped: suspend, freeze or crash.

Run it after every session, including the ones that felt fine — a clean report is
the baseline that makes the next bad one readable.

### `npm run soak` — a long session without playing one

```bash
npm run soak                            # 4 hours on your real data
npm run soak -- --minutes=30            # short trial run
npm run soak -- --minutes=480 --switch=120
npm run soak -- --cast=192.168.1.50     # include the TV in the rotation
npm run soak -- --data-dir=/path/to/data-copy
```

Launches the app, opens your board and drives it the way a session does: switches
music every `--switch` seconds, toggles ambience beds so several voices are live
at once, presses Stop All every ten cycles, and — with `--cast` — puts a visual on
the TV every fifth cycle. Every action it takes is written into the same log as
the app's own events, so the report can tell you the dropout arrived twelve
seconds after a specific track switch. The heartbeat is sped up (`--health=`,
seconds) so even a 30-minute run produces a usable trend.

Select the Chromecast from the toolbar before starting: `--cast` tells the soak
to include visual buttons in the rotation, it does not pick the device for you.

**What to run, and what each run answers:**

| Run | Answers |
| --- | --- |
| `npm run soak -- --minutes=480` overnight, no TV | Does audio survive 8 hours unattended? Does the heap grow? This is the cheapest possible version of the four-hour session. |
| `npm run soak -- --minutes=240 --cast=<ip>` with a **still image** left on screen | Probe 2 without playing a session: does the receiver drop the image at a repeatable uptime? |
| Same, but a board whose only visual is a **looping video** | Probe 3, the control. Image drops + video survives = Backdrop confirmed. |
| `npm run soak -- --minutes=60 --switch=20` | Stresses transitions: crossfades, stop-alls and overlapping ambience are where the audio engine works hardest. |
| Any soak, then turn the Bluetooth speaker **off and on** mid-run | Probe 1, at any hour of the day. The log must show a rebuild and sound returning by itself. |

The soak uses your installed data directory by default (real board, real tracks —
which matters, since the failures are about long files and real decoding). Pass
`--data-dir` with a copy if you would rather it never touch the original.
