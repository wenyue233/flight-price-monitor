/**
 * 程序入口。
 *
 * 用法：
 *   npm start          常驻进程，按每天 9 点和 21 点自动运行
 *   npm run run-once   立即运行一次，适合测试
 */

const { startScheduler, guardedRun } = require('./scheduler');
const { closeDatabase } = require('./database');
const config = require('./config');
const { consoleInfo, consoleError } = require('./utils/logger');

function getScheduledTimes() {
  return config.scheduler.cronExpressions
    .map((expression) => {
      const [, minute, hour] = expression.trim().split(/\s+/);
      return {
        hour: Number(hour),
        minute: Number(minute)
      };
    })
    .filter(({ hour, minute }) => Number.isInteger(hour) && Number.isInteger(minute))
    .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
}

function getCurrentTimeInSchedulerTimezone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.scheduler.timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);

  return {
    hour: Number(parts.find((part) => part.type === 'hour').value),
    minute: Number(parts.find((part) => part.type === 'minute').value)
  };
}

function formatNextQueryTime(now = new Date()) {
  const scheduledTimes = getScheduledTimes();
  const current = getCurrentTimeInSchedulerTimezone(now);
  const currentMinutes = current.hour * 60 + current.minute;
  const next = scheduledTimes.find(({ hour, minute }) => hour * 60 + minute > currentMinutes) || scheduledTimes[0];

  return `${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')} JST`;
}

async function startWatchMode() {
  consoleInfo('正在执行首次查询...');
  await guardedRun();
  consoleInfo('首次查询完成。');
  consoleInfo('下一次查询时间：');
  consoleInfo(formatNextQueryTime());
  startScheduler();
}

async function main() {
  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    await guardedRun();
    await closeDatabase();
    return;
  }

  await startWatchMode();
}

process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});

main().catch(async (error) => {
  consoleError('程序启动失败。', error);
  await closeDatabase();
  process.exit(1);
});
