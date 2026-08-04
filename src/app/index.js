/**
 * アプリのエントリーポイント。
 *
 * once モードでは 1 回だけ検索し、watch モードでは初回検索後に定期実行を開始する。
 */

const { startScheduler, guardedRun } = require('./scheduler');
const { formatNextQueryTime } = require('./nextQueryTime');
const { closeDatabase } = require('../database');
const { consoleInfo, consoleError } = require('../utils/logger');

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
