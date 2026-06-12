# DnD Soundboard (MVP)

Soundboard desktop local-first per sessioni di gioco di ruolo. Electron + Vue 3 + Pinia + Web Audio API.

## Requisiti

- Node.js 18+
- `yt-dlp` per l'import da YouTube: nel PATH oppure in `./bin/yt-dlp` (`yt-dlp.exe` su Windows). Scaricabile da https://github.com/yt-dlp/yt-dlp/releases
- `ffmpeg` nel PATH (richiesto da yt-dlp per la conversione in mp3)

## Avvio in sviluppo

```bash
./install.sh     # npm install + scarica yt-dlp (ultima release) in ./bin
npm run dev
```

In alternativa, manuale: `npm install`, poi metti `yt-dlp` nel PATH o in `./bin`.
Se i download YouTube falliscono con errori tipo "Precondition check failed",
ri-esegui `./install.sh` per aggiornare yt-dlp.

## Build distribuzione

```bash
npm run build
```

## Architettura

```
electron/            Main process
├── main.js          Finestra, protocollo media://, bootstrap
├── preload.js       Bridge IPC sicuro (window.api)
├── paths.js         Percorsi dati locali
└── ipc/
    ├── filesystem.js  Boards, libreria, import locale
    ├── settings.js    settings.json
    └── ytdlp.js       Download YouTube + ri-download automatico

src/                 Renderer (Vue 3)
├── audio/engine.js  Web Audio: canale musica esclusivo (crossfade/fade/instant),
│                    ambience additive, one-shot transienti, master gain
├── stores/          Pinia: library, boards, settings, playback
└── components/      PlayMode, EditMode, LibrarySidebar,
                     PropertiesPanel, SoundButton
```

## Dati

Tutto in JSON + asset locali (in dev: `./data`, in produzione: cartella userData).

```
data/
├── boards/*.json        Board (versione, griglia, bottoni)
├── library/
│   ├── index.json       Indice tracce
│   ├── builtin/         Suoni inclusi (ambience/, oneshots/)
│   ├── downloaded/      Audio importati (YouTube + locali)
│   └── thumbnails/
└── settings.json
```

Il renderer non accede mai al filesystem: legge gli asset tramite il protocollo
custom `media://` e comunica col main process solo via IPC.

## Uso

1. **Edit Mode**: importa tracce (URL YouTube o file locali), trascinale sulla
   griglia, ridimensiona e rinomina i bottoni dal pannello proprietà.
2. **Play Mode**: interfaccia minimale per la sessione. Blu = musica attiva,
   verde = ambience attiva, flash ambra = one-shot. Stop All e volume master in toolbar.
3. Le board referenziano solo ID della libreria: se un file YouTube manca al
   caricamento, viene riscaricato automaticamente.

## Suoni built-in

Inserisci file audio in `data/library/builtin/ambience/` e `oneshots/`, poi
aggiungili a `data/library/index.json` (o importali come file locali dall'app).
