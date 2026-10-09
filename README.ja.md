# Lyrical Sync — Store edition

macOSとWindowsで端末内の歌詞ファイルに再生時刻を付けるデスクトップエディターです。

[English](README.md) | [한국어](README.ko.md)

## 編集と再生

- LRC・SRT文書と選択した音声ファイルを開く
- 再生中の行タイムスタンプ入力、メタデータ・生のLRC編集
- Enhanced LRCの文字・単語タイミング編集とカラオケプレビュー
- 行の分割・結合・複製・移動、複数行選択と時刻調整
- 元に戻す・やり直し、検索・置換、最近のファイルと未保存作業の復元
- 波形・シークバー・繰り返し再生・任意のスペクトログラム
- ローカル自動スポッティングによる音・無音の境界検出。歌詞認識やボーカル整列は保証しません。
- キー設定・UI倍率・歌詞文字サイズ
- システム言語に応じた韓国語・英語・日本語UI

## ファイルと制限

通常/Enhanced LRC、SRT、WebVTT、ASSに書き出せます。形式が対応する情報だけを保持します。開始時刻を中心とする編集モデルのため、元のSRTの任意の終了時刻・重なりは保持しません。音声は再生に使用し、書き出しません。

MP3、WAV、FLAC、OGG/Opus、M4A/AAC、AIFF/AIFなどを扱います。再生対応はOSとWebViewのコーデックに依存します。WindowsのAIFF/AIFは端末のメモリ内でWAVに変換します。長い音声は多くのメモリを必要とする場合があります。

作業ファイルのパスがあれば自動保存を利用できます。未保存の歌詞は端末に復元用として保存され、ストレージエラーで更新・削除に失敗する場合があります。最近の一覧を消しても元のファイルは削除されません。

## プライバシー

歌詞・音声・編集データは端末内で処理します。この版にはオンライン歌詞検索・アカウント連携・広告・遠隔分析・AI整列ダウンロード・独自更新機能はありません。選択したクラウドフォルダーは別の同期サービスが処理する場合があります。

[プライバシーポリシー](https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy-ja/) · お問い合わせ: tsukimori@ahri2nd.xyz。アプリのヘルプからも開けます。

## 配布と開発

Mac App StoreとMicrosoft Store向けです。提供状況は公開とStore審査によって決まり、このリポジトリーは公開済みであることを示しません。更新は各Storeから配布します。macOSのビルド対象はApple Silicon・macOS 12以降、Windowsはx64・Windows 10ビルド19041以降です。ビルド基準と実機検証の範囲は別です。

Windows MSIXにはFixed Version WebView2が含まれます。`runFullTrust`はデスクトップエディターの実行用で、管理者昇格を要求しません。未署名のStore提出パッケージは通常のローカルインストール用ではありません。

開発にはNode.js・Rust・プラットフォームのビルドツールを用意し、`npm ci`、`npm run dev`を実行します。検証は`npm test`、`npm run test:packaging`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --locked`です。StoreビルドはmacOSで`npm run build:appstore`、Windowsで`npm run build:msstore -- -RuntimePath <x64-runtime-directory>`を使用します。配布署名・プロファイル・Windows SDKの要件が適用されます。

## ライセンス

[MIT](LICENSE)。外部コンポーネントにはそれぞれのライセンスが適用されます。利用する権利のあるファイルを選んでください。
