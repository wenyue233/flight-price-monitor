/**
 * 单次价格监控任务。
 *
 * scheduler.js 负责“什么时候运行”，这里负责“运行一次做什么”。
 */

const config = require('./config');
const {
  initializeDatabase,
  insertPriceRecord,
  getPreviousRecord,
  getPriceStats
} = require('./database');
const { createScrapers } = require('./scrapers');
const { generateDashboard } = require('./dashboard');
const { maybeSendPriceEmail } = require('./notifier');
const { publishDashboard } = require('./publisher');
const { todayString, timeString } = require('./utils/time');
const { consoleInfo, consoleError, writeJsonLog } = require('./utils/logger');

function formatPrice(price, currency) {
  if (price === null || price === undefined) {
    return '暂无数据';
  }

  return `${Number(price).toLocaleString('ja-JP')} ${currency}`;
}

function formatChange(currentRecord, previousRecord) {
  if (!previousRecord) {
    return '无上次记录';
  }

  const diff = currentRecord.price - previousRecord.price;
  if (diff === 0) {
    return `持平 0 ${currentRecord.currency}`;
  }

  return `${diff > 0 ? '上涨' : '下降'} ${Math.abs(diff).toLocaleString('ja-JP')} ${currentRecord.currency}`;
}

async function printRunSummary({ site, route, record }) {
  const previousRecord = await getPreviousRecord({
    site,
    route,
    beforeObservedAt: record.observedAt
  });
  const stats = await getPriceStats({ site, route });
  const isHistoricalLow = stats && stats.lowest_price === record.price;

  console.log(
    `[SUMMARY] ${record.observedDate} ${record.observedTime} / ${formatPrice(record.price, record.currency)} / ${formatChange(record, previousRecord)} / 历史最低：${isHistoricalLow ? '是' : '否'}`
  );

  return { previousRecord, stats };
}

async function runMonitorOnce() {
  await initializeDatabase();

  const scrapers = createScrapers();
  const observedDate = todayString();
  const observedTime = timeString();
  const observedAt = new Date().toISOString();
  let hasSuccessfulQuery = false;

  consoleInfo(`开始查询：${config.route.departureAirport} -> ${config.route.arrivalAirport}`);

  for (const scraper of scrapers) {
    try {
      consoleInfo(`正在打开 ${scraper.siteName} 并匹配目标往返航班组合...`);

      const result = await scraper.searchLowestPrice(config.route);
      const record = {
        observedDate,
        observedTime,
        observedAt,
        queryTime: observedAt,
        price: result.price,
        currency: result.currency,
        site: result.site,
        route: `${config.route.departureAirport} -> ${config.route.arrivalAirport}`,
        departureAirport: config.route.departureAirport,
        arrivalAirport: config.route.arrivalAirport,
        departureDate: config.route.departureDate,
        returnDate: config.route.returnDate,
        outboundFlightNo: result.outboundFlightNo,
        returnFlightNo: result.returnFlightNo,
        airline: result.airline,
        outboundAirline: result.outboundAirline,
        returnAirline: result.returnAirline,
        outboundTime: result.outboundTime,
        returnTime: result.returnTime,
        outboundDepartureTime: result.outboundDepartureTime,
        outboundArrivalTime: result.outboundArrivalTime,
        returnDepartureTime: result.returnDepartureTime,
        returnArrivalTime: result.returnArrivalTime,
        isDirect: result.isDirect,
        matchStatus: result.matchStatus,
        rawPriceText: result.rawPriceText
      };

      const id = await insertPriceRecord(record);
      hasSuccessfulQuery = true;
      consoleInfo(`${scraper.siteName}: 已保存记录 #${id}，最低价 ${formatPrice(record.price, record.currency)}。`);

      const summaryContext = await printRunSummary({
        site: scraper.siteName,
        route: config.route,
        record
      });

      await maybeSendPriceEmail({
        record,
        previousRecord: summaryContext.previousRecord,
        stats: summaryContext.stats
      });
    } catch (error) {
      consoleError(`${scraper.siteName}: 查询失败。`, error);

      await writeJsonLog('monitor-error', {
        site: scraper.siteName,
        route: config.route,
        errorMessage: error.message,
        tripDiagnostics: error.tripDiagnostics || null,
        stack: error.stack,
        observedAt
      });
    }
  }

  try {
    await generateDashboard();
  } catch (error) {
    consoleError('生成 dashboard.html 失败。', error);

    await writeJsonLog('dashboard-error', {
      route: config.route,
      errorMessage: error.message,
      stack: error.stack,
      observedAt
    });
  }

  if (hasSuccessfulQuery) {
    try {
      await publishDashboard();
    } catch (error) {
      consoleError('publish 失败，本地 SQLite 和 dashboard.html 已保留。', error);

      await writeJsonLog('publish-error', {
        route: config.route,
        errorMessage: error.message,
        stack: error.stack,
        observedAt
      });
    }
  }
}

module.exports = {
  runMonitorOnce
};
