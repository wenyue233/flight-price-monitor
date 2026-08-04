/**
 * 監視処理と診断ログで使う日時整形ユーティリティ。
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

function getLocalParts(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    second: pad(date.getSeconds())
  };
}

function todayString(date = new Date()) {
  const parts = getLocalParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeString(date = new Date()) {
  const parts = getLocalParts(date);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function timestampForFile(date = new Date()) {
  const parts = getLocalParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function yesterdayString(date = new Date()) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  return todayString(yesterday);
}

module.exports = {
  todayString,
  timeString,
  timestampForFile,
  yesterdayString
};
