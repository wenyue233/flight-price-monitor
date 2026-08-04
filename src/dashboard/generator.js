/**
 * 保存済み価格履歴から dashboard.html と index.html を生成するモジュール。
 */

const fs = require('fs/promises');
const path = require('path');
const config = require('../../config');
const locales = require('./locales');
const {
  initializeDatabase,
  getLatestRecord,
  getPriceStats,
  getRecentRecords,
  getSuspiciousRecords
} = require('../database');
const { consoleInfo } = require('../utils/logger');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(JSON.stringify(value));
}

function i18nSpan(key, values = {}) {
  const valuesAttribute = Object.keys(values).length
    ? ` data-i18n-values="${escapeAttribute(values)}"`
    : '';

  return `<span data-i18n="${escapeHtml(key)}"${valuesAttribute}></span>`;
}

function i18nCell(key, colspan) {
  return `<tr><td colspan="${colspan}">${i18nSpan(key)}</td></tr>`;
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) {
    return i18nSpan('noData');
  }

  return `${Number(price).toLocaleString('ja-JP')} ${escapeHtml(currency || config.route.currency)}`;
}

function formatDifference(latestRecord, previousRecord) {
  if (!latestRecord || !previousRecord) {
    return i18nSpan('noPreviousData');
  }

  const diff = latestRecord.price - previousRecord.price;
  if (diff === 0) {
    return `${i18nSpan('same')} 0 ${escapeHtml(latestRecord.currency)}`;
  }

  const key = diff > 0 ? 'up' : 'down';
  return `${i18nSpan(key)} ${Math.abs(diff).toLocaleString('ja-JP')} ${escapeHtml(latestRecord.currency)}`;
}

function getManualPrice() {
  return Number.isFinite(config.manualPrice) && config.manualPrice > 0
    ? config.manualPrice
    : null;
}

function formatManualDifference(latestRecord, manualPrice, currency) {
  if (!latestRecord) {
    return i18nSpan('noAutoPrice');
  }

  if (!manualPrice) {
    return i18nSpan('noManualPrice');
  }

  const diff = latestRecord.price - manualPrice;
  if (diff === 0) {
    return `${i18nSpan('equalManual')} 0 ${escapeHtml(currency)}`;
  }

  const key = diff > 0 ? 'autoHigherThanManual' : 'autoLowerThanManual';
  return `${i18nSpan(key)} ${Math.abs(diff).toLocaleString('ja-JP')} ${escapeHtml(currency)}`;
}

function displayValue(value) {
  return value ? escapeHtml(value) : i18nSpan('unavailable');
}

function displayFlightNo(value, record) {
  if (value) {
    return escapeHtml(value);
  }

  if (record && record.match_status === 'matched') {
    return i18nSpan('unknownFlightMatched');
  }

  return i18nSpan('unavailable');
}

function displayMatchStatus(record) {
  return record && record.match_status === 'matched'
    ? i18nSpan('matched')
    : i18nSpan('noMatchRecord');
}

function displayDirect(value) {
  if (value === 1 || value === true) {
    return i18nSpan('yes');
  }

  if (value === 0 || value === false) {
    return i18nSpan('no');
  }

  return i18nSpan('unavailable');
}

function displayDateValue(value) {
  return value ? escapeHtml(value) : i18nSpan('singleTrip');
}

function displayTimeRange(record, prefix) {
  if (!record) {
    return i18nSpan('unavailable');
  }

  const departure = record[`${prefix}_departure_time`];
  const arrival = record[`${prefix}_arrival_time`];
  if (departure && arrival) {
    return `${escapeHtml(departure)} → ${escapeHtml(arrival)}`;
  }

  return displayValue(record[`${prefix}_time`]);
}

function detailRow(labelKey, valueHtml) {
  return `
      <dt>${i18nSpan(labelKey)}</dt>
      <dd>${valueHtml}</dd>`;
}

function card(labelKey, valueHtml) {
  return `
    <div class="card">
      <h2>${i18nSpan(labelKey)}</h2>
      <div class="value">${valueHtml}</div>
    </div>`;
}
function createPriceChange(priceChange, currency) {
    console.log("createPriceChange called:", priceChange);
  if (priceChange === null || priceChange === undefined) {
    return '';
  }

  if (priceChange < 0) {
    return `
      <div class="priceChange down">
        ↓ ${formatPrice(Math.abs(priceChange), currency)}
      </div>
    `;
  }

  if (priceChange > 0) {
    return `
      <div class="priceChange up">
        ↑ ${formatPrice(priceChange, currency)}
      </div>
    `;
  }

  return `
    <div class="priceChange">
      → 0
    </div>
  `;
}


function prefixedValue(prefixKey, valueHtml) {
  return `${i18nSpan(prefixKey)}${valueHtml}`;
}

function createTableRows(records) {
  if (records.length === 0) {
    return i18nCell('noMatchedRecords', 16);
  }

  return records
    .map((record) => `
      <tr>
        <td>${escapeHtml(record.observed_date)}</td>
        <td>${escapeHtml(record.observed_time)}</td>
        <td>${formatPrice(record.price, record.currency)}</td>
        <td>${record.original_price ? formatPrice(record.original_price, record.currency) : i18nSpan('unavailable')}</td>
        <td>${escapeHtml(record.currency)}</td>
        <td>${escapeHtml(record.site)}</td>
        <td>${displayMatchStatus(record)}</td>
        <td>${displayFlightNo(record.outbound_flight_no, record)}</td>
        <td>${displayFlightNo(record.return_flight_no, record)}</td>
        <td>${displayValue(record.outbound_airline || record.airline)}</td>
        <td>${displayValue(record.return_airline || record.airline)}</td>
        <td>${displayTimeRange(record, 'outbound')}</td>
        <td>${displayTimeRange(record, 'return')}</td>
        <td>${displayDirect(record.is_direct)}</td>
        <td>${escapeHtml(record.raw_price_text || '')}</td>
        <td>${escapeHtml(record.created_at)}</td>
      </tr>
    `)
    .join('');
}

function createSuspiciousRows(records) {
  if (records.length === 0) {
    return i18nCell('noSuspiciousRecords', 4);
  }

  return records
    .map((record) => `
      <tr>
        <td>${escapeHtml(record.query_time || record.observed_at || `${record.observed_date} ${record.observed_time}`)}</td>
        <td>${formatPrice(record.price, record.currency)}</td>
        <td>${escapeHtml(record.raw_price_text || '')}</td>
        <td>${i18nSpan('priceJump')}</td>
      </tr>
    `)
    .join('');
}

function createDetails({ latestRecord, latestCurrency, manualPrice }) {
  return [
    detailRow('queryTime', displayValue(latestRecord && (latestRecord.query_time || latestRecord.observed_at))),
    detailRow('sourceSite', displayValue(latestRecord ? latestRecord.site : config.trip.siteName)),
    detailRow('currentPrice', formatPrice(latestRecord && latestRecord.price, latestCurrency)),
    detailRow('scrapedPrice', formatPrice(latestRecord && latestRecord.price, latestCurrency)),
    detailRow('manualPrice', manualPrice ? formatPrice(manualPrice, latestCurrency) : i18nSpan('noManualPrice')),
    detailRow('manualDiff', formatManualDifference(latestRecord, manualPrice, latestCurrency)),
    detailRow('lowestPrice', formatPrice(latestRecord && latestRecord.price, latestCurrency)),
    detailRow('originalPrice', latestRecord && latestRecord.original_price ? formatPrice(latestRecord.original_price, latestCurrency) : i18nSpan('unavailable')),
    detailRow('route', `${escapeHtml(config.route.departureAirport)} → ${escapeHtml(config.route.arrivalAirport)}`),
    detailRow('departureDate', escapeHtml(config.route.departureDate)),
    detailRow('returnDate', displayDateValue(config.route.returnDate)),
    detailRow('matchStatus', displayMatchStatus(latestRecord)),
    detailRow(
      'flightNumbers',
      `${prefixedValue('outboundPrefix', displayFlightNo(latestRecord && latestRecord.outbound_flight_no, latestRecord))} / ${prefixedValue('returnPrefix', displayFlightNo(latestRecord && latestRecord.return_flight_no, latestRecord))}`
    ),
    detailRow(
      'airline',
      `${prefixedValue('outboundPrefix', displayValue(latestRecord && (latestRecord.outbound_airline || latestRecord.airline)))} / ${prefixedValue('returnPrefix', displayValue(latestRecord && (latestRecord.return_airline || latestRecord.airline)))}`
    ),
    detailRow('outboundTime', displayTimeRange(latestRecord, 'outbound')),
    detailRow('returnTime', displayTimeRange(latestRecord, 'return')),
    detailRow('direct', displayDirect(latestRecord && latestRecord.is_direct)),
    detailRow('rawPriceText', displayValue(latestRecord && latestRecord.raw_price_text)),
    detailRow('originalPriceText', displayValue(latestRecord && latestRecord.original_price_text))
  ].join('');
}

function createCards({
 latestRecord,
 previousRecord,
 priceChange,
 stats,
 latestCurrency,
 manualPrice
}) {
  return [
   card(
  'currentAutoPriceCard',
  `
  ${formatPrice(latestRecord && latestRecord.price, latestCurrency)}
  ${createPriceChange(priceChange, latestCurrency)}
  `
),
    card('manualPriceCard', manualPrice ? formatPrice(manualPrice, latestCurrency) : i18nSpan('noManualPrice')),
    card('manualDiffCard', formatManualDifference(latestRecord, manualPrice, latestCurrency)),
    card('historicalLowestCard', formatPrice(stats && stats.lowest_price, latestCurrency)),
    card('historicalHighestCard', formatPrice(stats && stats.highest_price, latestCurrency))
  ].join('');
}

function buildClientScript({ chartLabels, chartPrices, latestCurrency }) {
  return `
  <script>
    const dashboardLocales = ${JSON.stringify(locales)};
    const chartLabels = ${JSON.stringify(chartLabels)};
    const chartPrices = ${JSON.stringify(chartPrices)};
    const chartCurrency = ${JSON.stringify(latestCurrency)};
    let priceChart;

    function getStoredLanguage() {
      const language = localStorage.getItem('dashboardLanguage');
      return dashboardLocales[language] ? language : 'ja';
    }

    function translate(template, values, dictionary) {
      return Object.entries(values || {}).reduce(
        (text, [key, value]) => {
          const replacement = value && value.i18n ? dictionary[value.i18n] : value;
          return text.replaceAll('{' + key + '}', replacement);
        },
        template
      );
    }

    function updateChart(language) {
      if (!window.Chart) {
        const message = document.querySelector('[data-chart-error]');
        message.hidden = false;
        message.textContent = dashboardLocales[language].chartUnavailable;
        return;
      }

      const label = translate(dashboardLocales[language].chartDatasetLabel, { currency: chartCurrency }, dashboardLocales[language]);
      if (priceChart) {
        priceChart.data.datasets[0].label = label;
        priceChart.update();
        return;
      }

      priceChart = new Chart(document.getElementById('priceChart'), {
        type: 'line',
        data: {
          labels: chartLabels,
          datasets: [{
            label,
            data: chartPrices,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            tension: 0.2,
            fill: true
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              beginAtZero: false
            }
          }
        }
      });
    }

    function applyLanguage(language) {
      const dictionary = dashboardLocales[language];
      document.documentElement.lang = language === 'ja' ? 'ja' : 'zh-CN';
      document.title = dictionary.pageTitle;

      document.querySelectorAll('[data-i18n]').forEach((element) => {
        const values = element.dataset.i18nValues ? JSON.parse(element.dataset.i18nValues) : {};
        element.textContent = translate(dictionary[element.dataset.i18n], values, dictionary);
      });

      document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        element.setAttribute('aria-label', dictionary[element.dataset.i18nAriaLabel]);
      });

      document.querySelectorAll('[data-language-option]').forEach((button) => {
        const isActive = button.dataset.languageOption === language;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });

      localStorage.setItem('dashboardLanguage', language);
      updateChart(language);
    }

    document.querySelectorAll('[data-language-option]').forEach((button) => {
      button.addEventListener('click', () => applyLanguage(button.dataset.languageOption));
    });

    applyLanguage(getStoredLanguage());
  </script>`;
}

function buildHtml({ latestRecord, previousRecord, stats, records, suspiciousRecords }) {
  const chartRecords = records.slice().reverse();
  const chartLabels = chartRecords.map((record) => `${record.observed_date} ${record.observed_time}`);
  const chartPrices = chartRecords.map((record) => record.price);
  const generatedAt = new Date().toLocaleString('ja-JP');
  const latestCurrency = latestRecord ? latestRecord.currency : config.route.currency;
  const manualPrice = getManualPrice();
  const priceChange = latestRecord && previousRecord
  ? latestRecord.price - previousRecord.price
  : null;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title></title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 24px;
      color: #222;
      background: #f7f7f7;
    }

    .topBar {
      align-items: flex-start;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }

    .languageControl {
      align-items: center;
      display: flex;
      gap: 8px;
      white-space: nowrap;
    }

    .languageControl span {
      color: #555;
      font-size: 13px;
      font-weight: 600;
    }

    .languageControl button {
      background: #fff;
      border: 1px solid #bbb;
      border-radius: 6px;
      color: #222;
      cursor: pointer;
      font: inherit;
      padding: 6px 10px;
    }

    .languageControl button.active {
      background: #2563eb;
      border-color: #2563eb;
      color: #fff;
    }

    .meta {
      margin-bottom: 20px;
      color: #555;
      line-height: 1.6;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .card {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 14px;
    }

    .card h2 {
      margin: 0 0 8px;
      font-size: 14px;
      color: #666;
      font-weight: 600;
    }

    .value {
      font-size: 24px;
      font-weight: 700;
    }

    .details,
    .chartBox,
    .suspiciousBox,
    .tableBox {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 24px;
    }

    .detailsGrid {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 8px 12px;
      font-size: 15px;
    }

    .detailsGrid dt {
      color: #666;
      font-weight: 600;
    }

    .detailsGrid dd {
      margin: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      background: #fff;
    }

    th,
    td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #efefef;
    }

    .note {
      color: #666;
      font-size: 13px;
    }

    .priceChange {
         margin-top: 6px;
        font-size: 14px;
        font-weight: 600;
    }

    .priceChange.down {
        color: green;
    }

    .priceChange.up {
        color: red;
    }

    @media (max-width: 640px) {
      body {
        margin: 16px;
      }

      .topBar {
        display: block;
      }

      .languageControl {
        margin-bottom: 16px;
      }

      .detailsGrid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="topBar">
    <h1 data-i18n="pageTitle"></h1>
    <div class="languageControl" data-i18n-aria-label="languageLabel">
      <span data-i18n="languageLabel"></span>
      <button type="button" data-language-option="ja" data-i18n="switchToJa" aria-pressed="false"></button>
      <button type="button" data-language-option="zh" data-i18n="switchToZh" aria-pressed="false"></button>
    </div>
  </div>
  <div class="meta">
    <span data-i18n="routeLine" data-i18n-values="${escapeAttribute({
      from: config.route.departureAirport,
      to: config.route.arrivalAirport
    })}"></span><br>
    <span data-i18n="datesLine" data-i18n-values="${escapeAttribute({
      departureDate: config.route.departureDate,
      returnDate: config.route.returnDate || { i18n: 'singleTrip' }
    })}"></span><br>
    <span data-i18n="siteLine" data-i18n-values="${escapeAttribute({
      site: config.trip.siteName,
      currency: config.route.currency
    })}"></span><br>
    <span data-i18n="generatedAtLine" data-i18n-values="${escapeAttribute({ generatedAt })}"></span>
  </div>

  <section class="details">
    <h2 data-i18n="detailsTitle"></h2>
    <dl class="detailsGrid">
      ${createDetails({ latestRecord, latestCurrency, manualPrice })}
    </dl>
  </section>

  <section class="cards">
    ${createCards({ 
  latestRecord, 
  previousRecord,
  priceChange,
  stats, 
  latestCurrency, 
  manualPrice 
})}
  </section>

  <section class="chartBox">
    <h2 data-i18n="chartTitle"></h2>
    <canvas id="priceChart" height="100"></canvas>
    <p class="note" data-i18n="chartNote"></p>
    <p class="note" data-chart-error hidden></p>
  </section>

  <section class="tableBox">
    <h2 data-i18n="recordsTitle"></h2>
    <table>
      <thead>
        <tr>
          <th data-i18n="observedDate"></th>
          <th data-i18n="observedTime"></th>
          <th data-i18n="lowestPrice"></th>
          <th data-i18n="originalPrice"></th>
          <th data-i18n="currency"></th>
          <th data-i18n="site"></th>
          <th data-i18n="matchStatus"></th>
          <th data-i18n="outboundFlightNo"></th>
          <th data-i18n="returnFlightNo"></th>
          <th data-i18n="outboundAirline"></th>
          <th data-i18n="returnAirline"></th>
          <th data-i18n="outboundTime"></th>
          <th data-i18n="returnTime"></th>
          <th data-i18n="isDirect"></th>
          <th data-i18n="rawPriceText"></th>
          <th data-i18n="createdAt"></th>
        </tr>
      </thead>
      <tbody>
        ${createTableRows(records)}
      </tbody>
    </table>
  </section>

  <section class="suspiciousBox">
    <h2 data-i18n="suspiciousTitle"></h2>
    <table>
      <thead>
        <tr>
          <th data-i18n="queryTime"></th>
          <th data-i18n="currentPrice"></th>
          <th data-i18n="rawPriceText"></th>
          <th data-i18n="suspiciousReason"></th>
        </tr>
      </thead>
      <tbody>
        ${createSuspiciousRows(suspiciousRecords)}
      </tbody>
    </table>
  </section>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  ${buildClientScript({ chartLabels, chartPrices, latestCurrency })}
</body>
</html>`;
}

async function generateDashboard() {
  await initializeDatabase();

  const query = {
    site: config.trip.siteName,
    route: config.route
  };

  const [latestRecord, stats, records, suspiciousRecords] = await Promise.all([
    getLatestRecord(query),
    getPriceStats(query),
    getRecentRecords({ ...query, limit: 10 }),
    getSuspiciousRecords({ ...query, limit: 50 })
  ]);
  const previousRecord = records.length > 1 ? records[1] : null;

  await fs.mkdir(path.dirname(config.dashboard.filename), { recursive: true });
  const html = buildHtml({ latestRecord, previousRecord, stats, records, suspiciousRecords });

  await fs.writeFile(config.dashboard.filename, html, 'utf8');
  await fs.writeFile(config.dashboard.indexFilename, html, 'utf8');

  consoleInfo(`看板已生成：${config.dashboard.filename}`);
  consoleInfo(`GitHub Pages 首页已生成：${config.dashboard.indexFilename}`);
  return {
    dashboardPath: config.dashboard.filename,
    indexPath: config.dashboard.indexFilename
  };
}

module.exports = {
  generateDashboard
};
