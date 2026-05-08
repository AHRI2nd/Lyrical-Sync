# Lyrical Sync

A desktop application for creating and editing `.lrc` (LRC) lyric files

[한국어](README.ko.md) | [日本語](README.ja.md)

![main](img/main_en.png)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)

---

## Features

- **Waveform playback** — visualize audio with Wavesurfer.js and control playback with keyboard shortcuts
- **Real-time timestamp stamping** — press `Space` to stamp the active lyric line with the current playback position, then auto-advance to the next line
- **Lyrics editor** — add, edit, reorder, and delete lyric lines; paste multi-line text to insert multiple lines at once
- **Preview mode** — karaoke-style full-screen preview with auto-scrolling highlight and inline timestamp editing
- **Offset adjustment** — bulk-shift all timestamps by a millisecond offset value
- **Raw LRC editor** — view and edit the full LRC file as plain text via the "View All" popup
- **Song metadata** — edit title, artist, album, author, offset, and any additional LRC tags (preserved on load/save)
- **Multi-language UI** — Korean, English, Japanese
- **Supported audio formats** — MP3, FLAC, WAV, M4A/AAC, AIFF/AIF
  - macOS (WKWebView): all formats natively supported
  - Windows (WebView2): AIFF/AIF files are automatically transcoded to WAV via the Rust backend

## Installation

### macOS

Download the latest `.dmg` installer from the [Releases](../../releases) page and open it to drag Lyrical Sync into your Applications folder.

> **macOS — unsigned app warning**
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

> **Windows — security prompt**
>
> If Windows Defender SmartScreen shows an "Unknown publisher" warning, click **More info** → **Run anyway** to proceed with the installation.

## Keyboard Shortcuts

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

> Shortcuts are disabled while an input field is focused.

## Tech Stack

| Role | Technology | Version |
|------|-----------|---------|
| Desktop framework | Tauri | v2 |
| Frontend | React + TypeScript | React 19, TS 5.8 |
| Styling | Tailwind CSS + @tailwindcss/vite | v4 |
| State management | Zustand | v5 |
| Waveform | Wavesurfer.js | v7 |
| File I/O | @tauri-apps/plugin-fs | v2 |
| Dialogs | @tauri-apps/plugin-dialog | v2 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Tauri CLI dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Binaries are output to `src-tauri/target/release/bundle/`.

### Type check

```bash
npx tsc --noEmit
```
