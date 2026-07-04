/**
 * 程序入口。
 *
 * 用法：
 *   npm start          常驻进程，按每天 9 点和 21 点自动运行
 *   npm run run-once   立即运行一次，适合测试
 */

const { startScheduler, guardedRun } = require('./scheduler');
const { closeDatabase } = require('./database');
const { consoleError } = require('./utils/logger');

async function main() {
  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    await guardedRun();
    await closeDatabase();
    return;
  }

  startScheduler();
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
