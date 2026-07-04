# Flight Price Monitor

个人机票价格看板工具。程序会每天 09:00、13:00、17:00、21:00 打开 Trip.com，查找指定往返航班组合，匹配成功后保存价格到 SQLite，并生成可直接打开的 `dashboard.html` 和 GitHub Pages 首页 `index.html`。

## 安装

需要 Node.js `>=22.5.0`，因为数据库层使用 Node 内置 SQLite。

```bash
npm install
npx playwright install chromium
```

## 配置

直接修改 `config.js`：

- `departureAirport`：出发机场，默认 `FUK`
- `arrivalAirport`：到达机场，默认 `PVG`
- `departureDate`：出发日期，格式 `YYYY-MM-DD`
- `returnDate`：返回日期，格式 `YYYY-MM-DD`
- `currency`：目标货币，例如 `JPY`
- `targetFlight`：目标航班匹配条件，包括 Spring Airlines / 春秋航空、去返程时间、直飞要求和时间容差

也可以用环境变量覆盖：

```bash
FLIGHT_FROM=FUK FLIGHT_TO=PVG FLIGHT_DEPARTURE_DATE=2026-08-08 FLIGHT_RETURN_DATE=2026-08-15 pnpm run once
```

## 运行

手动查一次：

```bash
pnpm run once
```

长期自动运行：

```bash
pnpm run watch
```

`pnpm run watch` 会保持进程常驻，并按 Asia/Tokyo 时区每天 `09:00`、`13:00`、`17:00`、`21:00` 自动查询。`pnpm start` 等同于 `pnpm run watch`。

查看结果的页面：

```text
/Users/tukimac/Documents/Codex/2026-07-04/node-js-javascript-typescript-playwright-sqlite/dashboard.html
```

这个文件不需要启动服务器，可以直接用浏览器打开。页面内容全部来自 SQLite 中的真实抓取记录，不会生成模拟数据。

注意：电脑睡眠、关机、网络断开，或终端进程退出时，不会自动查询。长期监控需要保持电脑唤醒并让 `pnpm run watch` 进程持续运行。

## GitHub Pages 发布

手动发布当前看板和数据库：

```bash
pnpm run publish
```

这个命令会执行：

```bash
git add dashboard.html index.html README.md
git commit -m "update flight price dashboard"
git push
```

GitHub Pages 只用于展示看板，不保存 SQLite、日志、截图或 debug HTML。开启 GitHub Pages 后，可以用仓库 Pages 首页在公司电脑或手机查看看板：

```bash
https://wenyue233.github.io/flight-price-monitor/
```

程序会同时生成 `dashboard.html` 和内容相同的 `index.html`，所以打开 Pages 首页会直接显示机票看板。邮件里的 dashboard 链接可用环境变量配置：

```bash
DASHBOARD_URL=https://wenyue233.github.io/flight-price-monitor/
```

每次 `pnpm run once` 或 `pnpm run watch` 自动查询成功后，程序会先保存 SQLite、重新生成 `dashboard.html` 和 `index.html`，然后尝试自动执行 publish。如果 `git push` 失败，本地保存不受影响，只会输出错误日志。

如果当前目录还没有执行 `git init`，或还没有配置 `remote origin`，publish 不会报错，也不会执行 git add/commit/push，只会提示：

```text
当前项目尚未连接 GitHub，请先初始化 Git 仓库。
```

## 邮件通知

默认是 dry-run，不会真的发送邮件。dry-run 会在触发通知时输出邮件标题和正文。

通知规则：

- 当前价格低于上次价格：发送降价提醒
- 当前价格高于上次价格：发送涨价提醒
- 当前价格持平：不发送
- 当前价格低于 `targetPrice`：发送目标价提醒
- 同时满足价格变化和低于目标价时，只发送一封邮件

当前目标价默认：

```text
105000 JPY
```

邮件环境变量：

```bash
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
MAIL_TO=
```

如果没有配置邮件环境变量，真实发送模式下会输出“邮件未配置，跳过发送”。如需未来真实发送邮件，请安装 `nodemailer` 并关闭 dry-run：

```bash
pnpm add nodemailer
MAIL_DRY_RUN=false pnpm run once
```

## 数据

SQLite 数据库默认保存在：

```text
flight-prices.sqlite
```

表名：

```text
price_history
```

字段包括查询时间、日期、时间、价格、货币、网站、航线、出发日期、返回日期、航班号、航司、出发/到达时间、是否直飞、匹配状态和原始价格文本。旧版本的 `price_records` 会在启动时自动复制到 `price_history`，不会删除旧数据。

只有匹配到目标航班组合时才会写入 `price_history`，避免把页面最低价误保存为目标航班价格。找不到目标组合时，会在 `work/logs/` 中记录页面上读取到的航班号、航司、时间和截图路径。

## 错误日志

如果 Trip.com 页面变化、加载失败或找不到价格，程序不会静默失败，会输出错误并保存调试文件：

- `work/logs/`
- `work/screenshots/`
- `work/debug-html/`

## 扩展新网站

新增网站时：

1. 在 `scrapers/` 下新增类，例如 `GoogleFlightsScraper.js`
2. 继承 `BaseScraper`
3. 实现 `searchLowestPrice(route)`
4. 在 `scrapers/index.js` 注册

每个 scraper 返回统一结构：

```js
{
  site: 'Trip.com',
  price: 92350,
  currency: 'JPY',
  rawPriceText: 'JPY 92,350',
  outboundFlightNo: '',
  returnFlightNo: '',
  airline: 'Spring Airlines',
  outboundAirline: 'Spring Airlines',
  returnAirline: 'Spring Airlines',
  outboundDepartureTime: '18:00',
  outboundArrivalTime: '19:00',
  returnDepartureTime: '13:50',
  returnArrivalTime: '17:00',
  isDirect: true,
  matchStatus: 'matched',
  url: 'https://...'
}
```
