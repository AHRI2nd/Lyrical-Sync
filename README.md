# Lyrical Sync — Store edition

A local desktop editor for lyric timing on macOS and Windows.

[한국어](README.ko.md) | [日本語](README.ja.md)

## Editing and playback

- Open LRC and SRT documents and user-selected audio files.
- Stamp line timestamps during playback; edit metadata and raw LRC.
- Edit character/word timing in Enhanced LRC and preview karaoke highlighting.
- Split, merge, duplicate and reorder rows; select multiple rows and adjust timestamps.
- Undo/redo, find/replace, recent files and recovery of unsaved edits.
- Waveform, seek bar, repeat playback and optional spectrogram.
- Local automatic spotting finds sound/silence boundaries. It does not recognize lyrics or guarantee vocal alignment.
- Settings for keyboard shortcuts, interface scale and lyric font size.
- Korean, English and Japanese interface, selected from the system language.

## Files and limits

Export plain/Enhanced LRC, SRT, WebVTT and ASS. Each format preserves only the information it supports; arbitrary original SRT end times/overlaps are not preserved by the editor's start-time model. Audio is used for playback and is not exported.

Audio formats include MP3, WAV, FLAC, OGG/Opus, M4A/AAC and AIFF/AIF. Playback support depends on the operating system and its WebView codecs. Windows AIFF/AIF is converted locally to WAV in memory. Long audio can require substantial memory.

Saving to a known working path supports auto-save. Recovery stores unsaved lyrics locally; storage errors can prevent recovery updates or deletion. Recent entries can be cleared without deleting original files.

## Privacy

Lyrics, audio and editing data are processed on the device. This edition has no online lyrics search, account connection, advertising, remote analytics, AI alignment download or built-in updater. User-selected cloud folders may be synchronized by a separate service.

[Privacy policy](https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy-en/) · Privacy contact: tsukimori@ahri2nd.xyz. The policy is also available from Help in the app.

## Distribution and development

The intended distribution is the Mac App Store and Microsoft Store. Availability depends on publication and Store review; this repository does not establish that either listing is live. Store updates are delivered through the respective Store. macOS target: Apple Silicon, macOS 12 or later. Windows target: x64, Windows 10 build 19041 or later. These are build baselines; platform acceptance is verified on tested devices.

Windows MSIX bundles a Fixed Version WebView2 runtime. `runFullTrust` runs the desktop editor; it does not request administrator elevation. Unsigned Store submission packages are not ordinary locally installable packages.

For local development, install Node.js, Rust and the platform build tools, then run `npm ci` and `npm run dev`. Check with `npm test`, `npm run test:packaging`, `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml --locked`. Store build commands: `npm run build:appstore` on macOS and `npm run build:msstore -- -RuntimePath <x64-runtime-directory>` on Windows. Distribution signing/profile and Windows SDK requirements apply.

## License

[MIT](LICENSE). Third-party components retain their own licenses. Choose files you have permission to use.
