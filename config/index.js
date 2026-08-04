/**
 * アプリ全体の設定と環境変数の既定値を管理するファイル。
 *
 * 個人利用では route や targetFlight を直接編集し、サーバーや NAS では環境変数で上書きできる。
 */

const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

const config = {
  route: {
    // 出発空港の IATA コード。例: TYO / HND / NRT / KIX / SHA
    departureAirport: process.env.FLIGHT_FROM || 'FUK',

    // 到着空港の IATA コード。
    arrivalAirport: process.env.FLIGHT_TO || 'PVG',

    // 出発日。形式は YYYY-MM-DD。
    departureDate: process.env.FLIGHT_DEPARTURE_DATE || '2026-08-08',

    // 復路日。形式は YYYY-MM-DD。片道検索の場合は空文字にする。
    returnDate: process.env.FLIGHT_RETURN_DATE || '2026-08-16',

    // 取得したい通貨。Trip.com の表示通貨は地域設定の影響を受ける。
    currency: process.env.FLIGHT_CURRENCY || 'JPY'
  },

  // 手動で Trip.com を確認した価格。dashboard 上の比較表示に使う。
  // 空または 0 の場合は、手動確認価格なしとして表示する。
  manualPrice: Number(process.env.MANUAL_PRICE || 106490),

  targetFlight: {
    airline: 'Spring Airlines',
    airlineKeywords: ['Spring Airlines', '春秋航空'],
    outbound: {
      departureTime: '18:00',
      arrivalTime: '19:00'
    },
    return: {
      departureTime: '14:00',
      arrivalTime: '17:00'
    },
    directOnly: true,
    timeToleranceMinutes: 10,
    directKeywords: ['Nonstop', 'Direct', '直飞'],
    forbiddenStopKeywords: ['中转', '转机', '1 stop', 'stopover', 'stops', 'transfer', 'layover', ' via ', ' in Seoul']
  },

  trip: {
    siteName: 'Trip.com',
    baseUrl: 'https://www.trip.com',    // Playwright のブラウザ画面を表示するかどうか。デバッグ時は HEADLESS=false にする。
    headless: process.env.HEADLESS !== 'false',    // ローカル Chrome を使う場合は PLAYWRIGHT_CHANNEL=chrome を指定する。    // 未指定の場合は Playwright が管理する Chromium を使う。
    browserChannel: process.env.PLAYWRIGHT_CHANNEL || '',

    // ページ言語は Trip.com の文言や価格表示形式に影響する。
    // 既定では日本向け表示にし、JPY を扱いやすくする。
    locale: process.env.PLAYWRIGHT_LOCALE || 'ja-JP',

    // 通常のブラウザに近い User-Agent を指定し、表示差分を避ける。
    userAgent:
      process.env.PLAYWRIGHT_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',

    // ページ読み込みの最大待機時間。航空券ページは重いため余裕を持たせる。
    timeoutMs: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 90000),

    // Trip.com 検索時の人数と座席クラス。
    passengers: 1,
    cabinClass: 'y'
  },

  database: {
    filename: process.env.SQLITE_PATH || path.join(projectRoot, 'flight-prices.sqlite')
  },

  dashboard: {
    filename: process.env.DASHBOARD_PATH || path.join(projectRoot, 'dashboard.html'),
    indexFilename: process.env.INDEX_PATH || path.join(projectRoot, 'index.html'),
    publicUrl: process.env.DASHBOARD_URL || 'https://wenyue233.github.io/flight-price-monitor/'
  },

  alerts: {
    targetPrice: Number(process.env.TARGET_PRICE || 105000)
  },

  email: {
    dryRun: process.env.MAIL_DRY_RUN !== 'false',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    mailTo: process.env.MAIL_TO || ''
  },

  scheduler: {
    timezone: process.env.TZ || 'Asia/Tokyo',    // 毎日 09:00、13:00、17:00、21:00 に実行する。    // cron 形式は「秒 分 時 日 月 曜日」。
    cronExpressions: ['0 0 9 * * *', '0 0 13 * * *', '0 0 17 * * *', '0 0 21 * * *']
  },

  logging: {
    logDir: path.join(projectRoot, 'work', 'logs'),
    screenshotDir: path.join(projectRoot, 'work', 'screenshots'),
    debugHtmlDir: path.join(projectRoot, 'work', 'debug-html')
  }
};

module.exports = config;













