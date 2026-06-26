# Lyrical Sync

A desktop app for creating, syncing, and editing `.lrc` (LRC) lyric files

[한국어](README.ko.md) | [日本語](README.ja.md)

![main](img/main_en.png)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Version](https://img.shields.io/badge/version-0.5.1-green)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)

---

## Features

### Editing & syncing
- **Waveform & seek bar** — visualize audio with Wavesurfer.js; stamped lines appear as clickable markers on the waveform. Switch between waveform and a sleek seek bar with hover tooltip, drag-to-seek, and remaining-time toggle.
- **Real-time stamping** — press `Space` to stamp the active line with the current playback position and auto-advance. All playback/stamp keys are **fully customizable**.
- **Character / word-level sync (Enhanced LRC)** — a dedicated mode to time each glyph: drag across glyphs to "paint" timestamps at the live position, with a zoomable waveform scrub lane, per-glyph time markers, keyboard nudge, and karaoke fill in preview. Exports A2 `<mm:ss.xx>` tags or plain LRC.
- **Line tools** — duplicate, merge, split (`Shift+Enter` at the caret), and **drag to reorder** lines — all undoable.
- **Multi-select & bulk actions** — `Shift`/`Ctrl`-click to select a range or pick lines, then bulk delete, shift, or clear their timestamps.
- **Timestamp tools** — bulk **offset**, **range shift**, and **scale** (stretch/compress every timestamp to fix tempo/version mismatch).
- **Validation & stats** — a completion gauge plus a list of issues (missing, duplicate, or out-of-order timestamps); click any issue to jump to that line.
- **Preview mode** — full-screen karaoke preview with auto-scrolling highlight, click-to-seek on any line, inline timestamp editing, and per-glyph karaoke fill.
- **Song metadata** — edit title, artist, album, author, offset, and any extra LRC tags (preserved on load/save); empty fields are **auto-filled from the audio file's tags** (ID3 / Vorbis / MP4) when you open audio.
- **Auto-recovery** — unsaved work is snapshotted and offered for restore after an unexpected close, even when no save path exists.

### AI Auto Sync
- **Automatic alignment** — aligns lyric lines to audio using [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) with the MMS-300M model (**1130 languages**, incl. Korean, English, Japanese).
- **Vocal separation** — optionally runs [Demucs](https://github.com/facebookresearch/demucs) to isolate vocals before alignment for better accuracy.
- **Vocal activity detection (VAD)** — places paragraph-break timestamps precisely where vocals resume after an instrumental break, and lowers confidence on lines that land in no-vocal regions so you can catch misalignments.
- **Confidence display** — each aligned line is color-coded by confidence so uncertain results stand out.
- **Choose what runs** — toggle vocal separation and VAD per run.
- **Self-contained Python runtime** — the app downloads and manages its own embedded Python; no system Python required.

### Spotify & YouTube
- **Spotify mode** — connect your account (PKCE OAuth) to control playback and sync lyrics against the currently playing track, with a device picker and an "Open in Spotify" link. Refresh tokens are stored in the OS keychain.
- **YouTube mode** — load audio directly from a YouTube URL via yt-dlp (downloaded and managed by the app).

### Import / export
- **Open** — LRC and SRT files (drag-and-drop supported).
- **Export** — LRC (plain or Enhanced LRC), SRT, **WebVTT**, and **ASS** (karaoke).
- **LRCLIB** — fetch lyrics from, and contribute synced lyrics to, the public [LRCLIB](https://lrclib.net/) database.

### General
- **Multi-language UI** — Korean, English, Japanese.
- **Customizable shortcuts** — rebind playback/stamp keys with conflict detection (Settings → Shortcuts).
- **Toast notifications** — clear feedback for saves, errors, AI completion, downloads, and more.
- **Display options** — UI scale (70%–130%) and adjustable lyrics font size.
- **Auto-save & auto-update check** — saves changes to a known path automatically and notifies you when a new release is available.
- **Supported audio formats** — MP3, FLAC, WAV, OGG, Opus, M4A/AAC, AIFF/AIF.
  - macOS (WKWebView): all formats natively supported.
  - Windows (WebView2): AIFF/AIF files are automatically transcoded to WAV via the Rust backend.

---

## Installation

### macOS

Download the latest `.dmg` installer from the [Releases](../../releases) page and drag Lyrical Sync into your Applications folder.

> **Unsigned app warning**
>
> Run the following command in Terminal after installation:
>
> ```bash
> xattr -cr /Applications/Lyrical\ Sync.app
> ```
>
> Then open the app normally.

### Windows

Download the latest `.msi` or `_x64-setup.exe` installer from the [Releases](../../releases) page and run it.

> **SmartScreen warning**
>
> If Windows Defender SmartScreen shows an "Unknown publisher" warning, click **More info** → **Run anyway**.

---

## Keyboard Shortcuts

Default bindings — all of these can be remapped in **Settings → Shortcuts**.

| Key | Action |
|-----|--------|
| `1` | Skip −5 s |
| `2` | Skip −1 s |
| `3` | Play / Pause |
| `4` | Skip +1 s |
| `5` | Skip +5 s |
| `6` | Stop and reset to 0:00 |
| `Space` | Stamp current line + move to next |
| `Backspace` | Move to previous line |
| `Enter` | Insert a new line below (while editing) |
| `Shift+Enter` | Split the line at the caret |
| `Ctrl/⌘ + Z` / `Shift+Z` | Undo / Redo |
| `Ctrl/⌘ + F` | Find & replace |

> Shortcuts are disabled while an input field is focused.

---

## Tech Stack

| Role | Technology | Version |
|------|-----------|---------|
| Desktop framework | Tauri | v2 |
| Frontend | React + TypeScript | React 19, TS 5.8 |
| Styling | Tailwind CSS + @tailwindcss/vite | v4 |
| State management | Zustand | v5 |
| Waveform | Wavesurfer.js | v7 |
| AI alignment | ctc-forced-aligner + MMS-300M | — |
| Vocal separation | Demucs htdemucs | — |
| Audio tags / transcode | lofty + Symphonia (Rust) | — |
| File I/O | @tauri-apps/plugin-fs | v2 |
| Dialogs | @tauri-apps/plugin-dialog | v2 |

---

## Getting Started (Development)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Tauri CLI dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev   # development
npm run tauri build # production build
npx tsc --noEmit    # type check
npm test            # frontend unit tests
```

Build output is placed in `src-tauri/target/release/bundle/`.
