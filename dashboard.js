/**
 * 本地静态看板生成器。
 *
 * dashboard.html 不需要服务器即可打开。
 * 注意：页面数据全部来自 SQLite 中已有的真实抓取记录，不创建模拟数据。
 */

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const {
  initializeDatabase,
  getLatestRecord,
  getPriceStats,
  getRecentRecords
} = require('./database');
const { consoleInfo } = require('./utils/logger');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) {
    return '暂无数据';
  }

  return `${Number(price).toLocaleString('ja-JP')} ${currency || config.route.currency}`;
}

function formatDifference(latestRecord, previousRecord) {
  if (!latestRecord || !previousRecord) {
    return '暂无上次数据';
  }

  const diff = latestRecord.price - previousRecord.price;
  if (diff === 0) {
    return `持平：0 ${latestRecord.currency}`;
  }

  const label = diff > 0 ? '上涨' : '下降';
  return `${label}：${Math.abs(diff).toLocaleString('ja-JP')} ${latestRecord.currency}`;
}

function getManualPrice() {
  return Number.isFinite(config.manualPrice) && config.manualPrice > 0
    ? config.manualPrice
    : null;
}

function formatManualDifference(latestRecord, manualPrice, currency) {
  if (!latestRecord) {
    return '暂无自动抓取价';
  }

  if (!manualPrice) {
    return '暂无手动确认价';
  }

  const diff = latestRecord.price - manualPrice;
  if (diff === 0) {
    return `一致：0 ${currency}`;
  }

  const label = diff > 0 ? '自动价高于手动价' : '自动价低于手动价';
  return `${label}：${Math.abs(diff).toLocaleString('ja-JP')} ${currency}`;
}

function displayValue(value) {
  return value ? value : '未读取到';
}

function displayFlightNo(value, record) {
  if (value) {
    return value;
  }

  if (record && record.match_status === 'matched') {
    return '未读取到，但已按航司+时间+直飞匹配';
  }

  return '未读取到';
}

function displayMatchStatus(record) {
  return record && record.match_status === 'matched' ? '已匹配目标航班' : '暂无匹配记录';
}

function displayDirect(value) {
  if (value === 1 || value === true) {
    return '是';
  }
  if (value === 0 || value === false) {
    return '否';
  }
  return '未读取到';
}

function displayTimeRange(record, prefix) {
  if (!record) {
    return '未读取到';
  }

  const departure = record[`${prefix}_departure_time`];
  const arrival = record[`${prefix}_arrival_time`];
  if (departure && arrival) {
    return `${departure} → ${arrival}`;
  }

  return record[`${prefix}_time`] || '未读取到';
}

function createTableRows(records) {
  if (records.length === 0) {
    return '<tr><td colspan="16">暂无目标航班匹配记录</td></tr>';
  }

  return records
    .map((record) => `
      <tr>
        <td>${escapeHtml(record.observed_date)}</td>
        <td>${escapeHtml(record.observed_time)}</td>
        <td>${escapeHtml(formatPrice(record.price, record.currency))}</td>
        <td>${escapeHtml(record.original_price ? formatPrice(record.original_price, record.currency) : '未读取到')}</td>
        <td>${escapeHtml(record.currency)}</td>
        <td>${escapeHtml(record.site)}</td>
        <td>${escapeHtml(displayMatchStatus(record))}</td>
        <td>${escapeHtml(displayFlightNo(record.outbound_flight_no, record))}</td>
        <td>${escapeHtml(displayFlightNo(record.return_flight_no, record))}</td>
        <td>${escapeHtml(displayValue(record.outbound_airline || record.airline))}</td>
        <td>${escapeHtml(displayValue(record.return_airline || record.airline))}</td>
        <td>${escapeHtml(displayTimeRange(record, 'outbound'))}</td>
        <td>${escapeHtml(displayTimeRange(record, 'return'))}</td>
        <td>${escapeHtml(displayDirect(record.is_direct))}</td>
        <td>${escapeHtml(record.raw_price_text || '')}</td>
        <td>${escapeHtml(record.created_at)}</td>
      </tr>
    `)
    .join('');
}

function buildHtml({ latestRecord, previousRecord, stats, records }) {
  const chartRecords = records.slice().reverse();
  const chartLabels = chartRecords.map((record) => `${record.observed_date} ${record.observed_time}`);
  const chartPrices = chartRecords.map((record) => record.price);
  const generatedAt = new Date().toLocaleString('ja-JP');
  const latestCurrency = latestRecord ? latestRecord.currency : config.route.currency;
  const manualPrice = getManualPrice();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>个人机票价格看板</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 24px;
      color: #222;
      background: #f7f7f7;
    }

    h1 {
      margin-bottom: 8px;
      font-size: 28px;
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
  </style>
</head>
<body>
  <h1>个人机票价格看板</h1>
  <div class="meta">
    航线：${escapeHtml(config.route.departureAirport)} → ${escapeHtml(config.route.arrivalAirport)}<br>
    出发：${escapeHtml(config.route.departureDate)}，返回：${escapeHtml(config.route.returnDate || '单程')}<br>
    网站：${escapeHtml(config.trip.siteName)}，目标货币：${escapeHtml(config.route.currency)}<br>
    页面生成时间：${escapeHtml(generatedAt)}
  </div>

  <section class="details">
    <h2>最新查询详情</h2>
    <dl class="detailsGrid">
      <dt>查询时间</dt>
      <dd>${escapeHtml(latestRecord ? latestRecord.query_time || latestRecord.observed_at : '暂无数据')}</dd>
      <dt>抓取网站</dt>
      <dd>${escapeHtml(latestRecord ? latestRecord.site : config.trip.siteName)}</dd>
      <dt>当前价格</dt>
      <dd>${escapeHtml(formatPrice(latestRecord && latestRecord.price, latestCurrency))}</dd>
      <dt>自动抓取价</dt>
      <dd>${escapeHtml(formatPrice(latestRecord && latestRecord.price, latestCurrency))}</dd>
      <dt>手动确认价</dt>
      <dd>${escapeHtml(manualPrice ? formatPrice(manualPrice, latestCurrency) : '暂无手动确认价')}</dd>
      <dt>自动/手动差额</dt>
      <dd>${escapeHtml(formatManualDifference(latestRecord, manualPrice, latestCurrency))}</dd>
      <dt>最终价格</dt>
      <dd>${escapeHtml(formatPrice(latestRecord && latestRecord.price, latestCurrency))}</dd>
      <dt>原价</dt>
      <dd>${escapeHtml(latestRecord && latestRecord.original_price ? formatPrice(latestRecord.original_price, latestCurrency) : '未读取到')}</dd>
      <dt>航线</dt>
      <dd>${escapeHtml(config.route.departureAirport)} → ${escapeHtml(config.route.arrivalAirport)}</dd>
      <dt>出发日期</dt>
      <dd>${escapeHtml(config.route.departureDate)}</dd>
      <dt>返回日期</dt>
      <dd>${escapeHtml(config.route.returnDate || '单程')}</dd>
      <dt>是否匹配目标航班</dt>
      <dd>${escapeHtml(displayMatchStatus(latestRecord))}</dd>
      <dt>航班号</dt>
      <dd>去程：${escapeHtml(displayFlightNo(latestRecord && latestRecord.outbound_flight_no, latestRecord))}；返程：${escapeHtml(displayFlightNo(latestRecord && latestRecord.return_flight_no, latestRecord))}</dd>
      <dt>航司</dt>
      <dd>去程：${escapeHtml(displayValue(latestRecord && (latestRecord.outbound_airline || latestRecord.airline)))}；返程：${escapeHtml(displayValue(latestRecord && (latestRecord.return_airline || latestRecord.airline)))}</dd>
      <dt>去程时间</dt>
      <dd>${escapeHtml(displayTimeRange(latestRecord, 'outbound'))}</dd>
      <dt>返程时间</dt>
      <dd>${escapeHtml(displayTimeRange(latestRecord, 'return'))}</dd>
      <dt>是否直飞</dt>
      <dd>${escapeHtml(displayDirect(latestRecord && latestRecord.is_direct))}</dd>
      <dt>最终价文本</dt>
      <dd>${escapeHtml(displayValue(latestRecord && latestRecord.raw_price_text))}</dd>
      <dt>原价文本</dt>
      <dd>${escapeHtml(displayValue(latestRecord && latestRecord.original_price_text))}</dd>
    </dl>
  </section>

  <section class="cards">
    <div class="card">
      <h2>自动抓取价</h2>
      <div class="value">${escapeHtml(formatPrice(latestRecord && latestRecord.price, latestCurrency))}</div>
    </div>
    <div class="card">
      <h2>手动确认价</h2>
      <div class="value">${escapeHtml(manualPrice ? formatPrice(manualPrice, latestCurrency) : '暂无手动确认价')}</div>
    </div>
    <div class="card">
      <h2>自动/手动差额</h2>
      <div class="value">${escapeHtml(formatManualDifference(latestRecord, manualPrice, latestCurrency))}</div>
    </div>
    <div class="card">
      <h2>上次价格</h2>
      <div class="value">${escapeHtml(previousRecord ? formatPrice(previousRecord.price, previousRecord.currency) : '暂无上次数据')}</div>
    </div>
    <div class="card">
      <h2>和上次相比</h2>
      <div class="value">${escapeHtml(formatDifference(latestRecord, previousRecord))}</div>
    </div>
    <div class="card">
      <h2>历史最低价格</h2>
      <div class="value">${escapeHtml(formatPrice(stats && stats.lowest_price, latestCurrency))}</div>
    </div>
    <div class="card">
      <h2>历史最高价格</h2>
      <div class="value">${escapeHtml(formatPrice(stats && stats.highest_price, latestCurrency))}</div>
    </div>
  </section>

  <section class="chartBox">
    <h2>最近价格变化折线图</h2>
    <canvas id="priceChart" height="100"></canvas>
    <p class="note">折线图只展示 SQLite 中真实保存的记录。</p>
  </section>

  <section class="tableBox">
    <h2>最近 10 次记录</h2>
    <table>
      <thead>
        <tr>
          <th>日期</th>
          <th>时间</th>
          <th>最终价格</th>
          <th>原价</th>
          <th>货币</th>
          <th>网站</th>
          <th>匹配状态</th>
          <th>去程航班号</th>
          <th>返程航班号</th>
          <th>去程航司</th>
          <th>返程航司</th>
          <th>去程时间</th>
          <th>返程时间</th>
          <th>是否直飞</th>
          <th>最终价文本</th>
          <th>入库时间</th>
        </tr>
      </thead>
      <tbody>
        ${createTableRows(records)}
      </tbody>
    </table>
  </section>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const chartLabels = ${JSON.stringify(chartLabels)};
    const chartPrices = ${JSON.stringify(chartPrices)};
    const chartCurrency = ${JSON.stringify(latestCurrency)};

    new Chart(document.getElementById('priceChart'), {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [{
          label: '最低价格 (' + chartCurrency + ')',
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
  </script>
</body>
</html>`;
}

async function generateDashboard() {
  await initializeDatabase();

  const query = {
    site: config.trip.siteName,
    route: config.route
  };

  const [latestRecord, stats, records] = await Promise.all([
    getLatestRecord(query),
    getPriceStats(query),
    getRecentRecords({ ...query, limit: 10 })
  ]);
  const previousRecord = records.length > 1 ? records[1] : null;

  await fs.mkdir(path.dirname(config.dashboard.filename), { recursive: true });
  const html = buildHtml({ latestRecord, previousRecord, stats, records });

  await fs.writeFile(
    config.dashboard.filename,
    html,
    'utf8'
  );
  await fs.writeFile(
    config.dashboard.indexFilename,
    html,
    'utf8'
  );

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
