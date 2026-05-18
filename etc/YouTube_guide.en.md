# YouTube Audio Loading Guide

Lyrical Sync uses yt-dlp to download audio from YouTube videos to a temporary file, enabling waveform visualization and LRC timestamp editing.

---

## Requirements

- Internet connection
- yt-dlp (installable within the app)

> yt-dlp is a standalone binary — no separate Python environment is required.

---

## Step 1 — Install yt-dlp

1. Click the **⚙ Settings** button in the bottom-left of the app.
2. Select the **YouTube** tab.
3. Click the **"Download yt-dlp"** button.
4. Once the download is complete, the status badge will change to **"Installed"**.

> On macOS, a universal binary supporting both arm64 and x86_64 is installed.

---

## Step 2 — Enable YouTube Mode

You can enable YouTube mode in one of two ways:

**Option A — Settings toggle**
1. Go to Settings → YouTube tab and turn on the **"YouTube Mode"** toggle.

**Option B — Mode selector button**
1. Click the mode selector button in the top header.
2. Select **YouTube** from the list.

> The YouTube option is only enabled after yt-dlp is installed.

---

## Step 3 — Enter a YouTube URL and Load Audio

1. Click the **"YouTube Link"** button at the bottom of the waveform area.
2. Paste a YouTube URL into the popup.
   - Example: `https://www.youtube.com/watch?v=XXXXXXXXXXX`
   - Short URLs (`https://youtu.be/...`) are also supported.
3. Click **"Load"** or press Enter.
4. Once the audio is downloaded and processed, the waveform will appear automatically.

---

## Settings Options

The following options are available in Settings → YouTube tab:

| Option | Description |
|--------|-------------|
| **Audio Quality** | Best available (bestaudio) / 192 kbps / 128 kbps |
| **Cookies File** | Path to a `.txt` cookies file for accessing private or age-restricted videos |
| **Proxy** | Proxy server address for bypassing regional restrictions |

### Exporting a Cookies File

Use a browser extension such as _Get cookies.txt LOCALLY_ to export your YouTube login cookies in Netscape `cookies.txt` format.

---

## Features Available in YouTube Mode

| Feature | Available |
|---------|:---------:|
| Waveform visualization | ✅ |
| Playback controls (skip / stop / loop) | ✅ |
| Playback speed control | ✅ |
| Zoom slider | ✅ |
| AI Auto Sync | ✅ |
| Save LRC | ✅ |

> YouTube mode uses the same waveform-based player as regular file mode.

---

## Temporary File Location

Downloaded audio is stored temporarily in the app cache directory. Files are not deleted automatically when the app exits. To clean them up manually, check the following paths:

- **macOS**: `~/Library/Caches/com.lyricalsync.app/ytdlp-audio/`
- **Windows**: `%LOCALAPPDATA%\com.lyricalsync.app\cache\ytdlp-audio\`

---

## FAQ

**Q. Loading audio is taking a very long time.**  
A. Download time depends on video length and network speed. Longer videos naturally take more time.

**Q. I see a "yt-dlp error" message.**  
A. Check that the URL is correct. For private videos, you will need a cookies file. Age-restricted videos can also be accessed with a cookies file.

**Q. Can I load region-locked videos?**  
A. Entering a proxy server address in Settings may allow you to bypass regional restrictions.

**Q. Does it work with sites other than YouTube?**  
A. yt-dlp supports thousands of sites. You can try pasting any URL, though Lyrical Sync is tested primarily with YouTube.

**Q. How do I update yt-dlp?**  
A. When a newer version is available, an **"Update"** button will appear in Settings → YouTube tab.

---

> **Copyright notice**: When downloading audio from YouTube videos, please comply with the applicable copyright laws and YouTube's Terms of Service. Use for personal study and research purposes only is recommended.
