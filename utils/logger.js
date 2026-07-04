/**
 * 简单文件日志工具。
 * 抓取机票时，失败原因通常需要回看当时页面、截图和错误栈。
 */

const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { timestampForFile } = require('./time');

async function ensureLogDirs() {
  await Promise.all([
    fs.mkdir(config.logging.logDir, { recursive: true }),
    fs.mkdir(config.logging.screenshotDir, { recursive: true }),
    fs.mkdir(config.logging.debugHtmlDir, { recursive: true })
  ]);
}

async function writeJsonLog(name, payload) {
  await ensureLogDirs();

  const filename = `${timestampForFile()}-${name}.json`;
  const filePath = path.join(config.logging.logDir, filename);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return filePath;
}

async function writeDebugHtml(name, html) {
  await ensureLogDirs();

  const filename = `${timestampForFile()}-${name}.html`;
  const filePath = path.join(config.logging.debugHtmlDir, filename);
  await fs.writeFile(filePath, html, 'utf8');

  return filePath;
}

function consoleInfo(message, extra) {
  if (extra) {
    console.log(`[INFO] ${message}`, extra);
    return;
  }

  console.log(`[INFO] ${message}`);
}

function consoleError(message, error) {
  console.error(`[ERROR] ${message}`);

  if (error) {
    console.error(error.stack || error.message || error);
  }
}

module.exports = {
  ensureLogDirs,
  writeJsonLog,
  writeDebugHtml,
  consoleInfo,
  consoleError
};
