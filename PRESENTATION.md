システム全体の処理フロー：

Scheduler
   ↓
Playwright
   ↓
Trip.com
   ↓
SQLite
   ↓
Dashboard
   ↓
GitHub Pages


① 定期実行
② 航空券取得・条件判定
③ 価格保存
④ Dashboard生成
⑤ 公開

## ① TripScraper：対象航空券の判定
Trip.comから取得した候補便を確認します。
### 工夫した点
検索結果の最安値をそのまま保存せず、
指定条件に一致する航空券だけを保存するようにしました。

確認する条件：
- 航空会社
- 出発・到着時間
- 直行便
```javascript

const candidates = flights
  .map((flight) => ({
    // 価格を取得
    price: extractPrice(flight),

    // 航空会社を確認
    airline: findAirline(flight),

    // 指定時間と一致するか確認
    timeMatch: matchTimes(flight),

    // 直行便か確認
    isDirect: isDirectFlight(flight)
  }))
  .filter((flight) =>
    flight.price &&
    flight.airline &&
    flight.timeMatch &&
    flight.isDirect
  );
```

---

## ② Scheduler：定期実行
設定した時間に監視処理を自動実行します。
### 工夫した点
航空券検索は処理時間が長いため、
前回処理が終了していない場合は
重複実行しないように制御しています。

```javascript
// 設定した時間に監視処理を自動実行する
cron.schedule(
  expression,
  guardedRun,
  {
    // 日本時間で実行
    timezone: config.scheduler.timezone
  }
);
```

---

## ③ Dashboard生成：価格履歴の可視化
保存した価格データからHTMLを生成します。
### 工夫した点
現在価格だけではなく、
過去の価格履歴も保存することで、
価格変化を確認できるようにしました。

```javascript
// 保存した価格履歴を利用してHTMLを生成する
const html = buildHtml({
  latestRecord,   // 最新価格
  previousRecord, // 前回価格
  records         // 過去履歴
});

// GitHub Pages用HTMLを出力
await fs.writeFile(
  "dashboard.html",
  html,
  "utf8"
);
```

corepack.cmd pnpm run once