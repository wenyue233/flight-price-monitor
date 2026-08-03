# Flight Price Monitor

Trip.com で指定した往復航空券を定期的に確認し、価格履歴を SQLite に保存して、静的な dashboard を生成する個人用の航空券価格監視ツールです。

現在は福岡 `FUK` から上海浦東 `PVG` への Spring Airlines 往復便を対象にしています。検索は手動実行、常駐監視、GitHub Pages 公開のいずれにも対応しています。

## プロジェクト概要
            Trip.com
               ↓
        Playwright Scraper
               ↓
          SQLite Database
               ↓
      Dashboard Generator
               ↓
            GitHub Pages
このプロジェクトは、航空券価格を毎日決まった時刻に確認し、価格の変化を見やすく残すことを目的にしています。

主な機能は次のとおりです。

- Trip.com を Playwright で開き、実際に表示された検索結果から価格を取得する
- 指定した航空会社、往路・復路時刻、直行便条件に合う往復便だけを保存する
- SQLite に価格履歴を蓄積する
- `dashboard.html` と `index.html` を生成する
- GitHub Pages に dashboard を公開する
- 価格変化があった場合にメール通知内容を作成する
- dashboard の表示言語を日本語 / 簡体字中国語で切り替えられる

## 技術スタック

- Node.js `>=22.5.0`
- CommonJS
- Playwright
- node:sqlite
- node-cron
- Express
- Chart.js
- pnpm / Corepack
- GitHub Pages

## ファイル構成

```text
config/
  index.js                  アプリ全体の設定と環境変数の既定値

src/
  app/
    index.js                実行入口。once / watch モードを切り替える
    monitor.js              1 回分の検索、保存、dashboard 生成、通知、publish をまとめる
    nextQueryTime.js         watch 起動後に表示する次回検索時刻を計算する
    scheduler.js            node-cron による定期実行を管理する
    update.js               検索、dashboard 更新、Git commit / push をまとめて実行する

  scraper/
    BaseScraper.js          scraper の共通インターフェース
    TripScraper.js          Trip.com を Playwright で操作する scraper
    index.js                有効な scraper を登録する

  database/
    index.js                SQLite の初期化、マイグレーション、CRUD

  dashboard/
    generator.js            SQLite の履歴から dashboard HTML を生成する
    locales.js              dashboard の日本語 / 中国語 UI 文言

  notifier/
    email.js                価格変化メールの作成と送信

  git/
    publisher.js            GitHub Pages 用ファイルの commit / push

  server/
    index.js                Render などで dashboard を配信する Express サーバー

  utils/
    logger.js               ログ、スクリーンショット、debug HTML の保存
    time.js                 日付と時刻の整形

dashboard.html              生成済み dashboard
index.html                  GitHub Pages のトップページ用 dashboard
flight-prices.sqlite        価格履歴データベース
package.json                npm scripts と依存関係
render.yaml                 Render cron 用設定
```

## システム流程

1. `pnpm run once` または scheduler から `runMonitorOnce()` が呼ばれる。
2. `TripScraper` が Trip.com を開き、指定ルートの検索結果を読み込む。
3. 対象航空会社、時刻、直行便条件に合う往復便を探す。
4. 条件に合う便が見つかった場合、最終支払い価格を取得する。
5. 価格を SQLite の `price_history` に保存する。
6. 前回価格や過去統計をもとに summary と通知内容を作る。
7. `dashboard.html` と `index.html` を再生成する。
8. GitHub remote が設定されている場合、Pages 用ファイルを commit / push する。

## セットアップ

Node.js `>=22.5.0` が必要です。SQLite は Node.js 組み込みの `node:sqlite` を使っています。

```bash
corepack enable
corepack pnpm install
corepack pnpm exec playwright install chromium
```

Windows では次のように `corepack.cmd` を使えます。

```powershell
corepack.cmd pnpm install
corepack.cmd pnpm exec playwright install chromium
```

## 設定方法

基本設定は [config/index.js](config/index.js) にあります。

主な設定項目は次のとおりです。

- `route.departureAirport`: 出発空港。既定値は `FUK`
- `route.arrivalAirport`: 到着空港。既定値は `PVG`
- `route.departureDate`: 出発日。形式は `YYYY-MM-DD`
- `route.returnDate`: 復路日。形式は `YYYY-MM-DD`
- `route.currency`: 取得したい通貨。例: `JPY`
- `targetFlight`: 航空会社、往路・復路時刻、直行便条件、時刻許容幅
- `manualPrice`: 手動確認価格。dashboard 上で自動取得価格と比較する
- `scheduler.cronExpressions`: 自動検索の実行時刻

環境変数でも上書きできます。

```bash
FLIGHT_FROM=FUK FLIGHT_TO=PVG FLIGHT_DEPARTURE_DATE=2026-08-08 FLIGHT_RETURN_DATE=2026-08-16 pnpm run once
```

## 実行方法

1 回だけ検索します。

```bash
pnpm run once
```

Windows では次のように実行できます。

```powershell
corepack.cmd pnpm run once
```

watch モードでは、起動直後に 1 回検索したあと、毎日 `09:00`、`13:00`、`17:00`、`21:00` JST に自動検索します。

```bash
pnpm run watch
```

Windows:

```powershell
corepack.cmd pnpm run watch
```

dashboard をローカルサーバーで配信します。

```bash
pnpm run serve
```

一括更新、commit、push を行います。

```bash
pnpm run update
```

Windows:

```powershell
corepack.cmd pnpm run update
```

## Dashboard

検索後に次の 2 つの HTML が生成されます。

- `dashboard.html`
- `index.html`

`index.html` は GitHub Pages のトップページとして使います。どちらも同じ内容で、サーバーなしでもブラウザで直接開けます。

dashboard には次の情報を表示します。

- 最新価格
- 手動確認価格との差分
- 前回価格との差分
- 過去最低価格と過去最高価格
- 直近の価格推移グラフ
- 直近 10 件の履歴
- 異常価格として扱った記録
- 日本語 / 簡体字中国語の切り替え

## データ

SQLite データベースは既定でプロジェクト直下に保存されます。

```text
flight-prices.sqlite
```

主なテーブルは `price_history` です。

保存される主な項目は次のとおりです。

- 検索日時
- 価格
- 通貨
- サイト名
- 出発空港 / 到着空港
- 出発日 / 復路日
- 往路・復路の便名
- 航空会社
- 往路・復路の出発 / 到着時刻
- 直行便かどうか
- マッチ状態
- 元価格テキスト

旧バージョンの `price_records` が存在する場合は、初回起動時に `price_history` へコピーします。既存データは削除しません。

## GitHub Pages 公開

手動で publish する場合は次を実行します。

```bash
pnpm run publish
```

publish は GitHub Pages 表示に必要なファイルだけを対象にします。

- `dashboard.html`
- `index.html`
- `README.md`

GitHub remote が設定されていない場合は、commit / push を行わずにスキップします。

公開 URL は環境変数で変更できます。

```bash
DASHBOARD_URL=https://example.github.io/flight-price-monitor/
```

## メール通知

既定では dry-run です。実際には送信せず、通知対象になった場合に件名と本文をコンソールへ出力します。

通知条件は次のとおりです。

- 前回価格より下がった
- 前回価格より上がった
- 目標価格を下回った

実際にメール送信するには、SMTP 設定と `MAIL_DRY_RUN=false` が必要です。

```bash
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
MAIL_TO=
MAIL_DRY_RUN=false
```

必要に応じて `nodemailer` を追加します。

```bash
pnpm add nodemailer
```

## エラー調査

Trip.com のページ構造変更、読み込み失敗、価格抽出失敗が起きた場合、ログと調査用ファイルを保存します。

```text
work/logs/
work/screenshots/
work/debug-html/
```

これにより、失敗時点の画面や HTML をあとから確認できます。

## 改善計画

- dashboard の表をフィルターやソートに対応させる
- 価格推移グラフに期間切り替えを追加する
- 複数ルートの監視に対応する
- 複数サイトの scraper を追加する
- メール以外の通知方法を追加する
- 設定を JSON や UI から編集できるようにする
- 監視結果の自動テストを増やす
- Docker / Render 運用手順をさらに整理する
