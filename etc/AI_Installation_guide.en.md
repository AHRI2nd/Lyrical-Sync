# AI Auto-Sync Installation & Usage Guide

Lyrical Sync's AI Auto-Sync feature uses CTC Forced Aligner to automatically assign timestamps to lyrics text.  
Optionally, Demucs vocal separation can be used as a preprocessing step to improve accuracy.

---

## System Requirements

| Item | Minimum |
|------|---------|
| OS | macOS 14+ (Apple Silicon), Windows 10+ (x64), Windows ARM64 |
| RAM | 8 GB (16 GB recommended) |
| Storage | Required alignment model: 1.18 GiB / Optional Demucs model: 83.0 MiB (Python environment and package storage is additional) |
| Internet | Required for initial setup |

> **GPU Acceleration**: The current version uses CPU inference. Performance depends on your CPU speed.

> AI package installation checks the complete installed package graph against OSV. Only public package names and versions are sent. If the audit is unavailable or finds an advisory, the previous environment is retained. Reinstall packages after a security update; outdated environments cannot run AI alignment.

---

## Step 1 — Install or Update the Python Environment

The AI feature uses bundled CPython 3.13.17 (build 20261021) — no separate Python installation required.

1. Click the **⚙ Settings** button at the bottom-left of the app.
2. Select the **AI Environment** tab.
3. If Python is not installed, click **"Install / update AI environment"**. This prepares the bundled CPython runtime and AI packages together.
   - macOS uses the CPython 3.13.17 Apple Silicon distribution.
   - Windows x64 uses the CPython 3.13.17 x64 distribution.
   - Windows ARM64 uses the CPython 3.13.17 ARM64 distribution in a separate directory.
4. If Python is ready but packages are missing, click **"Auto-install packages"**.
   - This installs the supported platform's pinned package set and runs its security audit.
   - Windows x64 builds `ctc-forced-aligner` from source and may require Visual Studio C++ build tools.
   - Windows ARM64 uses verified native CPU packages and does not build `ctc-forced-aligner` from source.
5. Finish when the status changes to ready. If installation fails, review the displayed error and confirm that the previous environment was retained.

> **Windows x64 note**: Source builds may fail without Visual Studio Build Tools (C++ build tools). Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) if needed. ARM64 uses verified native packages.

---

## Step 2 — Download Models

1. Select the **AI Models** tab in Settings.
2. Download the models you need based on the table below.

| Model | Purpose | Size | Required |
|-------|---------|------|----------|
| **ctc-mms-300m** | Forced timestamp alignment | 1.18 GiB | ✅ Required |
| **demucs-htdemucs** | Vocal/accompaniment separation preprocessing | 83.0 MiB | Optional |

3. Model files are stored in the app data directory by default.  
   To specify a custom path, change it under **"Model Storage Path"**.

> **Tip**: Start with just ctc-mms-300m. Demucs improves accuracy for music-heavy tracks but adds processing time.

---

## Step 3 — Run AI Auto-Sync

1. Open an audio file (MP3, WAV, FLAC, M4A, etc.).
2. Enter lyrics in the LRC editor.
3. Choose Auto, English, Korean, or Japanese from the language list. The alignment model supports 1,130 languages, but the app currently exposes only these choices.
4. Click **"AI Auto-Sync"** at the top of the editor to start alignment. If existing character or word timestamps are present, confirm before they are cleared.

### Progress States

| State | Description |
|-------|-------------|
| Loading model | Loading ctc-mms-300m into memory |
| Vocal separation | Extracting vocal track with Demucs (if installed) |
| Alignment analysis | Matching lyrics to audio |
| Done | Timestamps generated |

---

## Step 4 — Review & Correct Results

- A **confidence badge** (0–100%) is shown next to each lyric line.
- Lines with low confidence show a red badge.
- How to correct:
  - Click a line to activate it, then press **Space** during playback to manually stamp it.
  - Click the timestamp button to overwrite with the current playback position.
- Manually stamped lines have their confidence badge automatically removed.
- Once you're done reviewing, click **"Clear Draft"** to remove all confidence badges.

---

## Settings Options

| Option | Location | Description |
|--------|----------|-------------|
| Blank line offset | Settings → General | Offset in seconds applied to blank line (paragraph separator) timestamps (default: 1.0s) |
| Model storage path | Settings → AI Models | Store models in a custom path instead of the default |

---

## Supported Audio Formats

MP3, WAV, M4A/AAC, FLAC, OGG, Opus, AIFF

---

## FAQ

**Q. Many lines are misaligned.**  
A. Check for typos or unnecessary symbols (brackets, chorus markers, etc.) in the lyrics. For tracks with heavy accompaniment, installing Demucs and retrying usually improves accuracy.

**Q. I see a "Python is not ready" error.**  
A. Check the Python installation status under Settings → AI Environment. If it shows as installed but the error persists, try restarting the app.

**Q. Package installation fails on Windows.**  
A. Install the "Desktop development with C++" workload from Visual Studio Build Tools, then try again.
