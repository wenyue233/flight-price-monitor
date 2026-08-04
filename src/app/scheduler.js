/**
 * 定期実行スケジューラー。
 *
 * node-cron で実行時刻を登録し、前回処理が続いている場合は重複実行を避ける。
 */

const cron = require('node-cron');
const config = require('../../config');
const { runMonitorOnce } = require('./monitor');
const { consoleInfo, consoleError } = require('../utils/logger');

let isRunning = false;

async function guardedRun() {
  if (isRunning) {
    consoleInfo('上一次任务仍在运行，本次调度跳过，避免重复打开浏览器。');
    return;
  }

  isRunning = true;

  try {
    await runMonitorOnce();
  } catch (error) {
    consoleError('调度任务发生未处理错误。', error);
  } finally {
    isRunning = false;
  }
}

function startScheduler() {
  for (const expression of config.scheduler.cronExpressions) {
    cron.schedule(expression, guardedRun, {
      timezone: config.scheduler.timezone
    });

    consoleInfo(`已注册定时任务：${expression} (${config.scheduler.timezone})`);
  }

  consoleInfo('机票价格监控已启动，等待每天 09:00、13:00、17:00、21:00 自动运行。');
}

module.exports = {
  startScheduler,
  guardedRun
};
