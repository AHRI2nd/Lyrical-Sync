# Lyrical Sync

`.lrc`（LRC）歌詞ファイルを作成・同期・編集するデスクトップアプリ

[English](README.md) | [한국어](README.ko.md)

![main](img/main_ja.png)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Version](https://img.shields.io/badge/version-0.5.1-green)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)

---

## 機能

### 編集 & 同期
- **波形 & シークバー** — Wavesurfer.js で音声を可視化し、記録した行は波形上に**クリック可能なマーカー**として表示されます。波形表示と、ホバーツールチップ・ドラッグシーク・残り時間トグルを備えたシークバーを切り替えできます。
- **リアルタイム記録** — `Space` でアクティブな行に現在の再生位置を記録し、自動的に次の行へ進みます。再生・記録キーは**すべて再設定可能**です。
- **文字/単語単位の同期（Enhanced LRC）** — 文字ごとに時刻を入力する専用モード：文字の上をドラッグすると**現在の再生位置**で「塗る」ように記録され、ズーム可能な波形スクラブレーン・文字ごとのタイムマーカー・キーボード微調整・プレビューのカラオケ塗りに対応します。A2 `<mm:ss.xx>` タグまたは通常 LRC で保存します。
- **行ツール** — 行の複製、上の行と結合、分割（`Shift+Enter`、カーソル位置）、**ドラッグで並べ替え** — すべて取り消し可能。
- **複数選択 & 一括操作** — `Shift`/`Ctrl`+クリックで範囲・個別選択し、一括で削除・シフト・タイムスタンプ消去。
- **タイムスタンプツール** — 一括**オフセット**、**区間シフト**、**倍率**（テンポ/バージョンの不一致に合わせて全タイムスタンプを伸縮）。
- **検証 & 統計** — 完成度の表示＋問題リスト（未入力・重複・順序エラーのタイムスタンプ）。問題をクリックするとその行へジャンプ。
- **プレビュー** — 全画面カラオケプレビュー。自動スクロールのハイライト、行クリックでシーク、インラインのタイムスタンプ編集、文字単位のカラオケ塗り。
- **曲メタデータ** — タイトル・アーティスト・アルバム・作成者・オフセットおよび未知の LRC タグを編集（保持）。音声を開くと、ファイルのタグ（ID3 / Vorbis / MP4）から**空の項目を自動入力**します。
- **自動復元** — 作業中の内容をスナップショットとして保持し、予期せず終了しても（保存先がなくても）再起動時に復元を提案します。

### AI 自動同期
- **自動整列** — [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) と MMS-300M モデルで歌詞行を音声に整列します（**1130 言語**、日本語・英語・韓国語を含む）。
- **ボーカル分離** — 整列前に [Demucs](https://github.com/facebookresearch/demucs) でボーカルを分離し精度を高められます（任意）。
- **ボーカル活動検出（VAD）** — 間奏のあとボーカルが再開する地点に段落区切りのタイムスタンプを精密配置し、無ボーカル区間に誤って置かれた行の信頼度を下げて誤整列を見つけやすくします。
- **信頼度表示** — 整列した各行を信頼度に応じて色分けし、不確実な結果が一目で分かります。
- **使用項目の選択** — ボーカル分離・VAD の使用可否を整列ごとに切り替え。
- **内蔵 Python ランタイム** — アプリが独自の Python 環境をダウンロード・管理するため、システムの Python は不要です。

### Spotify & YouTube
- **Spotify モード** — アカウントを接続（PKCE OAuth）して再生を制御し、現在再生中の曲に合わせて歌詞を同期します。再生デバイス選択と「Spotify で開く」リンクを提供。リフレッシュトークンは OS のキーチェーンに保存されます。
- **YouTube モード** — yt-dlp（アプリがダウンロード・管理）で YouTube の URL から音声を直接読み込みます。

### 読み込み / 書き出し
- **開く** — LRC、SRT ファイル（ドラッグ＆ドロップ対応）。
- **書き出し** — LRC（通常または Enhanced LRC）、SRT、**WebVTT**、**ASS**（カラオケ）。
- **LRCLIB** — 公開データベース [LRCLIB](https://lrclib.net/) から歌詞を取得し、同期歌詞を投稿できます。

### 一般
- **多言語 UI** — 韓国語、英語、日本語。
- **ショートカットのカスタマイズ** — 再生・記録キーを競合検出付きで再設定（設定 → ショートカット）。
- **トースト通知** — 保存・エラー・AI 完了・ダウンロードなどを明確にフィードバック。
- **表示オプション** — UI スケール（70%〜130%）と歌詞のフォントサイズ調整。
- **自動保存 & 更新確認** — 保存先が決まっている変更を自動保存し、新しいリリースがあれば通知します。
- **対応音声フォーマット** — MP3、FLAC、WAV、OGG、Opus、M4A/AAC、AIFF/AIF。
  - macOS（WKWebView）：すべてのフォーマットをネイティブ対応。
  - Windows（WebView2）：AIFF/AIF は Rust バックエンドが自動的に WAV へトランスコード。

---

## インストール

### macOS

[Releases](../../releases) ページから最新の `.dmg` インストーラーをダウンロードし、Lyrical Sync をアプリケーションフォルダにドラッグします。

> **未署名アプリの警告**
>
> インストール後、ターミナルで次のコマンドを実行してください：
>
> ```bash
> xattr -cr /Applications/Lyrical\ Sync.app
> ```
>
> その後、通常どおりアプリを開きます。

### Windows

[Releases](../../releases) ページから最新の `.msi` または `_x64-setup.exe` インストーラーをダウンロードして実行します。

> **SmartScreen の警告**
>
> Windows Defender SmartScreen が「不明な発行元」の警告を表示した場合は、**詳細情報** → **実行** をクリックします。

---

## ショートカット

既定の割り当て — すべて **設定 → ショートカット** で再設定できます。

| キー | 動作 |
|------|------|
| `1` | -5 秒スキップ |
| `2` | -1 秒スキップ |
| `3` | 再生 / 一時停止 |
| `4` | +1 秒スキップ |
| `5` | +5 秒スキップ |
| `6` | 停止して 0:00 へ |
| `Space` | 現在行を記録 + 次の行へ |
| `Backspace` | 前の行へ |
| `Enter` | 下に新しい行を挿入（編集中） |
| `Shift+Enter` | カーソル位置で行を分割 |
| `Ctrl/⌘ + Z` / `Shift+Z` | 取り消し / やり直し |
| `Ctrl/⌘ + F` | 検索 & 置換 |

> 入力欄にフォーカスがある間はショートカットが無効になります。

---

## 技術スタック

| 役割 | 技術 | バージョン |
|------|------|-----------|
| デスクトップフレームワーク | Tauri | v2 |
| フロントエンド | React + TypeScript | React 19, TS 5.8 |
| スタイリング | Tailwind CSS + @tailwindcss/vite | v4 |
| 状態管理 | Zustand | v5 |
| 波形 | Wavesurfer.js | v7 |
| AI 整列 | ctc-forced-aligner + MMS-300M | — |
| ボーカル分離 | Demucs htdemucs | — |
| 音声タグ / トランスコード | lofty + Symphonia (Rust) | — |
| ファイル I/O | @tauri-apps/plugin-fs | v2 |
| ダイアログ | @tauri-apps/plugin-dialog | v2 |

---

## 開発をはじめる

### 前提条件

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- Tauri CLI の依存関係 — [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/) を参照

```bash
npm install
npm run tauri dev   # 開発
npm run tauri build # 本番ビルド
npx tsc --noEmit    # 型チェック
npm test            # フロントエンド単体テスト
```

ビルド成果物は `src-tauri/target/release/bundle/` に出力されます。
