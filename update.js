/**
 * One-command updater for short-term ticket monitoring.
 *
 * Flow:
 * 1. corepack/corepack.cmd pnpm run once
 * 2. stage only publishable source/dashboard files
 * 3. stop if there are no publishable changes
 * 4. commit
 * 5. git pull --rebase
 * 6. push
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('./config');
const { hasGitRepository, hasRemoteOrigin } = require('./publisher');
const { initializeDatabase, getLatestRecord, closeDatabase } = require('./database');

const execFileAsync = promisify(execFile);
const publishFiles = [
  'dashboard.html',
  'index.html',
  'README.md',
  'dashboard.js',
  'config.js',
  'database.js',
  'monitor.js',
  'update.js',
  'package.json',
  '.gitignore'
];

async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: __dirname,
    maxBuffer: 1024 * 1024 * 10,
    ...options
  });

  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function printCommand(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`);
}

function getRunOnceCommands() {
  if (process.platform === 'win32') {
    return [
      {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', 'corepack.cmd pnpm run once'],
        displayCommand: 'corepack.cmd',
        displayArgs: ['pnpm', 'run', 'once']
      }
    ];
  }

  return [
    {
      command: 'corepack',
      args: ['pnpm', 'run', 'once']
    },
    {
      command: 'pnpm',
      args: ['run', 'once']
    }
  ];
}

function explainGitPushError(error) {
  const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
  if (/could not read Username|Authentication failed|Permission denied|repository not found|403|401/i.test(output)) {
    return [
      'git push 失败：GitHub 登录或凭据未配置。',
      '请先登录 GitHub、配置 credential helper，或为 remote origin 配置可用的 token/SSH key。'
    ].join('\n');
  }

  return `git push 失败：${output.trim() || '未知错误'}`;
}

async function ensureGitReady() {
  if (!(await hasGitRepository()) || !(await hasRemoteOrigin())) {
    console.log('当前项目尚未连接 GitHub，请先初始化 Git 仓库。');
    return false;
  }

  return true;
}

async function pullLatest() {
  printCommand('git', ['pull', '--rebase']);
  await runCommand('git', ['pull', '--rebase']);
}

async function runOnce() {
  const commands = getRunOnceCommands();
  let lastError;

  for (const { command, args, options, displayCommand, displayArgs } of commands) {
    printCommand(displayCommand || command, displayArgs || args);
    try {
      await runCommand(command, args, {
        env: {
          ...process.env,
          PATH: process.env.PATH
        },
        ...options
      });
      return;
    } catch (error) {
      lastError = error;
      if (process.platform === 'win32' || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw lastError;
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) {
    return '暂无数据';
  }

  return `${Number(price).toLocaleString('ja-JP')} ${currency || config.route.currency}`;
}

async function getCurrentNormalPrice() {
  await initializeDatabase();
  const record = await getLatestRecord({
    site: config.trip.siteName,
    route: config.route
  });

  return record
    ? {
        priceText: formatPrice(record.price, record.currency),
        record
      }
    : {
        priceText: '暂无 normal 记录',
        record: null
      };
}

async function stagePublishFiles() {
  printCommand('git', ['add', ...publishFiles]);
  await runCommand('git', ['add', ...publishFiles]);
}

async function getPublishStatus() {
  return runCommand('git', ['status', '--porcelain', ...publishFiles]);
}

async function commitIfNeeded() {
  const status = await getPublishStatus();
  if (!status) {
    console.log('没有需要提交的代码。');
    return false;
  }

  printCommand('git', ['commit', '-m', 'update flight price dashboard']);
  await runCommand('git', ['commit', '-m', 'update flight price dashboard']);
  return true;
}

async function pushChanges() {
  printCommand('git', ['push']);
  try {
    await runCommand('git', ['push']);
  } catch (error) {
    console.error(explainGitPushError(error));
    return false;
  }

  console.log('GitHub Pages 已更新。');
  console.log(`GitHub Pages：\n${config.dashboard.publicUrl}`);
  return true;
}

async function update() {
  if (!(await ensureGitReady())) {
    return;
  }

  try {
    console.log('[1/5] 打开 Trip...');
    console.log('[2/5] 匹配目标航班...');
    console.log('[3/5] 读取最终价格...');
    await runOnce();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`.trim();
    console.error(`pnpm run once 失败：${output}`);
    return;
  }

  console.log('[4/5] 更新 dashboard...');
  await stagePublishFiles();
  const committed = await commitIfNeeded();
  const current = await getCurrentNormalPrice();
  if (!committed) {
    console.log('查询完成');
    console.log(`当前价格：${current.priceText}`);
    console.log(`GitHub Pages：\n${config.dashboard.publicUrl}`);
    await closeDatabase();
    return;
  }

  console.log('[5/5] GitHub Pages...');
  try {
    await pullLatest();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`.trim();
    console.error(`git pull --rebase 失败：${output}`);
    console.error('本地提交已创建，但尚未推送。请处理 rebase 冲突或工作区问题后，再执行 pnpm run update。');
    return;
  }

  const pushed = await pushChanges();
  console.log('查询完成');
  console.log(`当前价格：${current.priceText}`);
  console.log(`GitHub Pages：\n${config.dashboard.publicUrl}`);
  await closeDatabase();
  if (!pushed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  update().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = {
  update,
  getRunOnceCommands
};
