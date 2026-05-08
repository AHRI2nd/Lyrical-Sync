# Lyrical Sync

`.lrc` (LRC) 歌詞ファイルを作成・編集するデスクトップアプリケーション

[English](README.md) | [한국어](README.ko.md)

![main](img/main_ja.png)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)

---

## 機能

- **波形再生** — Wavesurfer.js でオーディオを可視化し、キーボードショートカットで再生を制御
- **リアルタイムタイムスタンプ** — `Space` を押すと現在の再生位置でアクティブな歌詞行にタイムスタンプを打ち、次の行へ自動移動
- **歌詞エディター** — 歌詞行の追加・編集・並び替え・削除、複数行テキストの貼り付けで一括挿入
- **プレビューモード** — 自動スクロールハイライトとインラインタイムスタンプ編集に対応したカラオケ風フルスクリーンプレビュー
- **オフセット調整** — ミリ秒単位のオフセット値で全タイムスタンプを一括シフト
- **Raw LRC エディター** — 「全表示」ポップアップで LRC ファイル全体をテキストとして確認・編集
- **楽曲メタデータ** — タイトル・アーティスト・アルバム・作成者・オフセット・追加 LRC タグを編集（読み込み/保存時に保持）
- **多言語 UI** — 韓国語・英語・日本語
- **対応オーディオ形式** — MP3、FLAC、WAV、M4A/AAC、AIFF/AIF
  - macOS（WKWebView）: 全形式をネイティブサポート
  - Windows（WebView2）: AIFF/AIF ファイルは Rust バックエンドが自動的に WAV へトランスコードして再生

## インストール

### macOS

[Releases](../../releases) ページから最新の `.dmg` ファイルをダウンロードし、開いて Lyrical Sync をアプリケーションフォルダへドラッグしてください。

> **macOS — 未署名アプリの警告**
>
> インストール後、ターミナルで以下のコマンドを実行してください:
>
> ```bash
> xattr -cr /Applications/Lyrical\ Sync.app
> ```
>
> その後、アプリを通常どおり起動できます。

### Windows

[Releases](../../releases) ページから最新の `.msi` または `_x64-setup.exe` インストーラーをダウンロードして実行してください。

> **Windows — セキュリティ警告**
>
> Windows Defender SmartScreen に「発行元不明」の警告が表示された場合は、**詳細情報** → **実行**をクリックしてインストールを続行してください。

## キーボードショートカット

| キー | 動作 |
|------|------|
| `1` | −5秒スキップ |
| `2` | −1秒スキップ |
| `3` | 再生 / 一時停止 |
| `4` | +1秒スキップ |
| `5` | +5秒スキップ |
| `6` | 停止して先頭（0:00）へ |
| `Space` | 現在行にスタンプ + 次の行へ移動 |
| `Backspace` | 前の行へ移動 |

> 入力フィールドにフォーカスがある間はショートカットが無効になります。

## 技術スタック

| 役割 | 技術 | バージョン |
|------|------|-----------|
| デスクトップフレームワーク | Tauri | v2 |
| フロントエンド | React + TypeScript | React 19, TS 5.8 |
| スタイリング | Tailwind CSS + @tailwindcss/vite | v4 |
| 状態管理 | Zustand | v5 |
| 波形表示 | Wavesurfer.js | v7 |
| ファイル I/O | @tauri-apps/plugin-fs | v2 |
| ダイアログ | @tauri-apps/plugin-dialog | v2 |

## はじめに

### 必要環境

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- Tauri CLI 依存関係 — [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/) を参照

### 開発起動

```bash
npm install
npm run tauri dev
```

### ビルド

```bash
npm run tauri build
```

ビルド成果物は `src-tauri/target/release/bundle/` に出力されます。

### 型チェック

```bash
npx tsc --noEmit
```
