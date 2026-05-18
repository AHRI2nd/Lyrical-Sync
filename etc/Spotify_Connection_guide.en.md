# Spotify Integration Setup & Usage Guide

Lyrical Sync integrates with the Spotify Web Playback SDK to let you play Spotify tracks directly in the app while editing LRC files.  
No server required — it works with just your own Spotify Developer App Client ID.

---

## System Requirements

- **Spotify Premium** account (required for the Web Playback SDK)
- **Spotify Developer** account (free, sign up at [developer.spotify.com](https://developer.spotify.com))
- Internet connection

> The Web Playback SDK does not work with a Spotify Free account.

---

## Step 1 — Create a Spotify Developer App

1. Log in to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Click **"Create app"**.
3. Fill in the details as follows:

   | Field | Value |
   |-------|-------|
   | App name | Any name (e.g., `Lyrical Sync`) |
   | App description | Any description |
   | Redirect URIs | `http://127.0.0.1:54321/callback` |
   | Which API/SDKs | Check **Web Playback SDK** |

4. Click **"Save"**.
5. Copy the **Client ID** from the **Settings** page of the created app.

> **Redirect URI Notice**: Enter `http://127.0.0.1:54321/callback` exactly. Using `localhost` or a different port will cause authentication to fail.

---

## Step 2 — Enter Client ID in Lyrical Sync

1. Click the **⚙ Settings** button at the bottom-left of the app.
2. Select the **Spotify** tab.
3. Paste the copied **Client ID** and click **"Save"**.

---

## Step 3 — Log in to Spotify

1. Click the **Spotify button** in the top header.
2. A browser will open with the Spotify login page.
3. Log in with your Spotify Premium account and grant the app permissions.
4. After authentication, Lyrical Sync will automatically resume.

> Login credentials are securely stored in the system keychain (macOS: Keychain, Windows: Credential Manager) and automatically restored on the next launch.

---

## Step 4 — Select & Play a Track

Clicking the Spotify button branches based on the current playback state.

### When a track is currently playing

- **"Load"**: Loads the currently playing track into the app and switches to Spotify mode.
- **"Choose another track"**: Opens the search/playlist modal.
- **"Switch to file mode"**: Returns to local audio file mode.

### When no track is playing

- **"Search on Spotify"**: Opens the search/playlist modal.
- **"Switch to file mode"**: Returns to local audio file mode.

### Search/Playlist Modal

- **Search tab**: Search by track name or artist name (real-time search)
- **My Playlists tab**: Select a track from your saved playlists

Selecting a track automatically switches to Spotify mode, and the metadata (title/artist/album) is auto-filled in the LRC editor.

---

## Spotify Mode Player

In Spotify mode, a dedicated player panel is shown instead of the waveform.

| Feature | Description |
|---------|-------------|
| Seek bar | Click to jump to a position; hover to see time tooltip |
| −5s / −1s / ▶⏸ / +1s / +5s | Playback controls |
| Stop | Reset playback position to the beginning (0:00) |
| Repeat | Toggle repeat for the current track |
| Volume | In-app volume control |
| Album art | Displayed alongside current track info |

### Keyboard Shortcuts

The same keyboard shortcuts work in Spotify mode.

| Key | Action |
|-----|--------|
| `1` | −5 seconds |
| `2` | −1 second |
| `3` | Play/Pause |
| `4` | +1 second |
| `5` | +5 seconds |
| `Space` | Stamp current line + move to next |
| `Backspace` | Move to previous line |

---

## Limitations

Due to the nature of Spotify streaming, the following features are unavailable:

| Feature | Reason |
|---------|--------|
| Waveform visualization | Cannot directly access streaming audio data |
| Playback speed control | Not supported by the Spotify API |
| AI Auto-Sync | Requires a local audio file |

> If you need AI Auto-Sync, we recommend generating timestamps in file mode first using AI, then switching to Spotify mode for fine-tuning.

---

## Returning to File Mode

- Click the Spotify button in the header → select **"Switch to file mode"**
- You can also toggle the mode from Settings → Spotify tab.

---

## FAQ

**Q. I see "No active Spotify device available".**  
A. Launch the Spotify app (mobile or PC) first, then try again. The app must be running for the Web Playback SDK to register as a device.

**Q. The browser doesn't return to the app after authentication.**  
A. Verify that the Redirect URI is set to exactly `http://127.0.0.1:54321/callback`. Note that changes in the Developer Dashboard can take a few minutes to take effect after saving.

**Q. I see a "Spotify Premium is required" error.**  
A. The Web Playback SDK is a Spotify Premium exclusive feature and cannot be used with a Free account.

**Q. How do I log out?**  
A. Click the **"Log out"** button in Settings → Spotify tab. This removes the stored credentials from the system keychain.

**Q. I entered the Client ID but can't log in.**  
A. Double-check that `http://127.0.0.1:54321/callback` is listed in the Redirect URIs for your app in the Developer Dashboard.
