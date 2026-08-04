/**
 * 1 回分の価格監視処理をまとめるモジュール。
 *
 * 取得、保存、dashboard 生成、通知、publish の流れをここで組み立てる。
 */

const config = require('../../config');
const {
  initializeDatabase,
  insertPriceRecord,
  getLatestRecord,
  getLatestAnyRecord,
  getPreviousRecord,
  getPriceStats
} = require('../database');
const { createScrapers } = require('../scraper');
const { generateDashboard } = require('../dashboard/generator');
const { maybeSendPriceEmail } = require('../notifier/email');
const { publishDashboard } = require('../git/publisher');
const { todayString, timeString } = require('../utils/time');
const { consoleInfo, consoleError, writeJsonLog } = require('../utils/logger');

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

async function determineRecordStatus({ site, route, price }) {
  const [previousNormal, previousAny] = await Promise.all([
    getLatestRecord({ site, route }),
    getLatestAnyRecord({ site, route })
  ]);

  if (previousAny && previousAny.status === 'suspicious' && previousAny.price === price) {
    return {
      status: 'normal',
      reason: '同一价格连续出现两次，恢复为 normal'
    };
  }

  if (previousNormal && price < previousNormal.price * 0.92) {
    return {
      status: 'suspicious',
      reason: `Price jump: 当前价格比上一条有效价格低超过 8%（上一条有效价格 ${formatPrice(previousNormal.price, previousNormal.currency)}）`
    };
  }

  return {
    status: 'normal',
    reason: ''
  };
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
      const statusDecision = await determineRecordStatus({
        site: result.site,
        route: config.route,
        price: result.price
      });
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
        status: statusDecision.status,
        originalPrice: result.originalPrice,
        originalPriceText: result.originalPriceText,
        rawPriceText: result.rawPriceText
      };

      const id = await insertPriceRecord(record);
      hasSuccessfulQuery = true;
      consoleInfo(`${scraper.siteName}: 已保存记录 #${id}，价格 ${formatPrice(record.price, record.currency)}，status=${record.status}。`);
      if (record.status === 'suspicious') {
        consoleInfo(`异常价格已保留但不计入正式统计：${statusDecision.reason}`);
      }

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
