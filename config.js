/**
 * 全局配置文件。
 *
 * 个人使用时，优先直接修改下面的 route 字段。
 * 也可以用环境变量覆盖，适合以后放到服务器或 NAS 上运行。
 */

const path = require('path');

const config = {
  route: {
    // 出发机场 IATA 代码，例如 TYO / HND / NRT / KIX / SHA。
    departureAirport: process.env.FLIGHT_FROM || 'FUK',

    // 到达机场 IATA 代码。
    arrivalAirport: process.env.FLIGHT_TO || 'PVG',

    // 出发日期，格式必须是 YYYY-MM-DD。
    departureDate: process.env.FLIGHT_DEPARTURE_DATE || '2026-08-08',

    // 返回日期，格式必须是 YYYY-MM-DD。如果只查单程，可设为空字符串。
    returnDate: process.env.FLIGHT_RETURN_DATE || '2026-08-16',

    // 期望读取的货币。Trip.com 页面可能会根据地区展示不同货币。
    currency: process.env.FLIGHT_CURRENCY || 'JPY'
  },

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
    baseUrl: 'https://www.trip.com',

    // Playwright 是否显示浏览器窗口。调试时可设置 HEADLESS=false。
    headless: process.env.HEADLESS !== 'false',

    // 如果本机安装了 Chrome，可设置 PLAYWRIGHT_CHANNEL=chrome 使用真实 Chrome。
    // 不设置时使用 Playwright 下载的 Chromium。
    browserChannel: process.env.PLAYWRIGHT_CHANNEL || '',

    // 页面语言会影响 Trip.com 的文案和价格展示格式。
    // 默认使用日本地区习惯，便于展示 JPY。
    locale: process.env.PLAYWRIGHT_LOCALE || 'ja-JP',

    // 默认 UA 尽量接近日常浏览器，减少因空 UA/测试 UA 导致页面异常。
    userAgent:
      process.env.PLAYWRIGHT_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',

    // 页面最长等待时间，单位毫秒。机票页经常加载慢，默认给得宽松一些。
    timeoutMs: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 90000),

    // Trip.com 查询人数与舱位。后续可以继续放到 config。
    passengers: 1,
    cabinClass: 'y'
  },

  database: {
    filename: process.env.SQLITE_PATH || path.join(__dirname, 'flight-prices.sqlite')
  },

  dashboard: {
    filename: process.env.DASHBOARD_PATH || path.join(__dirname, 'dashboard.html'),
    indexFilename: process.env.INDEX_PATH || path.join(__dirname, 'index.html'),
    publicUrl: process.env.DASHBOARD_URL || 'https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/dashboard.html'
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
    timezone: process.env.TZ || 'Asia/Tokyo',

    // 每天 09:00、13:00、17:00、21:00 运行。
    // cron 格式：秒 分 时 日 月 周
    cronExpressions: ['0 0 9 * * *', '0 0 13 * * *', '0 0 17 * * *', '0 0 21 * * *']
  },

  logging: {
    logDir: path.join(__dirname, 'work', 'logs'),
    screenshotDir: path.join(__dirname, 'work', 'screenshots'),
    debugHtmlDir: path.join(__dirname, 'work', 'debug-html')
  }
};

module.exports = config;
