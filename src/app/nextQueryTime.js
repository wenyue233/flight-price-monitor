/**
 * watch モードで表示する次回検索予定時刻を計算するモジュール。
 */

const config = require('../../config');

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

module.exports = {
  formatNextQueryTime
};
