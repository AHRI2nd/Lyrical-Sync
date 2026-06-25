# AI Auto-Sync Installation & Usage Guide

Lyrical Sync's AI Auto-Sync feature uses CTC Forced Aligner to automatically assign timestamps to lyrics text.  
Optionally, Demucs vocal separation can be used as a preprocessing step to improve accuracy.

---

## System Requirements

| Item | Minimum |
|------|---------|
| OS | macOS 12+, Windows 10+ |
| RAM | 8 GB (16 GB recommended) |
| Storage | Required models only: ~3 GB / Full: ~5 GB |
| Internet | Required for initial setup |

> **GPU Acceleration**: The current version uses CPU inference. Performance depends on your CPU speed.

---

## Step 1 — Install Python Environment

The AI feature uses a bundled Python (CPython 3.11) — no separate Python installation required.

1. Click the **⚙ Settings** button at the bottom-left of the app.
2. Select the **AI Environment** tab.
3. Click **"Download Python"**.
   - macOS: Downloads the `python-3.11.10-macos-...` distribution.
   - Windows: Downloads the `python-3.11.10-windows-...` distribution.
4. After the download completes, click **"Install Packages"**.
   - Installs `torch`, `unidecode`, `demucs`, `ctc-forced-aligner`, and more.
   - On Windows, `ctc-forced-aligner` is built from source (takes 10–20 minutes).
5. When the installation log shows **"Installation complete"**, you're done.

> **Windows Note**: If Visual Studio Build Tools (C++ build tools) are not installed, the source build may fail. If you encounter an error, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) first.

---

## Step 2 — Download Models

1. Select the **AI Models** tab in Settings.
2. Download the models you need based on the table below.

| Model | Purpose | Size | Required |
|-------|---------|------|----------|
| **ctc-mms-300m** | Forced timestamp alignment (1,100+ languages) | 1.2 GB | ✅ Required |
| demucs-htdemucs | Vocal/accompaniment separation preprocessing | 83 MB | Optional |
| wav2vec2-base-960h | English ASR auxiliary model | 380 MB | Optional |

3. Model files are stored in the app data directory by default.  
   To specify a custom path, change it under **"Model Storage Path"**.

> **Tip**: Start with just ctc-mms-300m. Demucs improves accuracy for music-heavy tracks but adds processing time.

---

## Step 3 — Run AI Auto-Sync

1. Open an audio file (MP3, WAV, FLAC, M4A, etc.).
2. Enter lyrics in the LRC editor.
3. Click **"AI Auto-Sync"** at the top of the editor.
4. Select the language:
   - Korean: `kor`
   - English: `eng`
   - Japanese: `jpn`
   - 1,100+ other languages supported (ISO 639-3 codes)
5. Click **"Run"**.

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

**Q. macOS shows a "damaged file" warning.**  
A. The app automatically removes the quarantine attribute, but if it fails, run the following in Terminal:  
```bash
xattr -rd com.apple.quarantine ~/Library/Application\ Support/lyrical-sync/python
```

**Q. Package installation fails on Windows.**  
A. Install the "Desktop development with C++" workload from Visual Studio Build Tools, then try again.
