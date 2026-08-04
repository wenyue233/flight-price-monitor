/**
 * GitHub Pages 用ファイルを commit / push する公開処理モジュール。
 */

const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { consoleInfo } = require('../utils/logger');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '..', '..');

async function runGit(args) {
  const result = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024
  });

  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

async function hasGitRepository() {
  try {
    await fs.access(path.join(projectRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function hasRemoteOrigin() {
  try {
    const origin = await runGit(['remote', 'get-url', 'origin']);
    return Boolean(origin);
  } catch {
    return false;
  }
}

async function publishDashboard() {
  if (!(await hasGitRepository()) || !(await hasRemoteOrigin())) {
    consoleInfo('当前项目尚未连接 GitHub，请先初始化 Git 仓库。');
    return { skipped: true, reason: 'not-connected-to-github' };
  }

  const publishFiles = ['dashboard.html', 'index.html', 'README.md'];
  await runGit(['add', ...publishFiles]);

  const status = await runGit(['status', '--porcelain', ...publishFiles]);
  if (!status) {
    consoleInfo('publish: dashboard.html / index.html / README.md 没有变化，跳过提交。');
    return { skipped: true };
  }

  await runGit(['commit', '-m', 'update flight price dashboard']);
  await runGit(['push']);
  consoleInfo('GitHub Pages 已更新。');

  return { skipped: false };
}

if (require.main === module) {
  publishDashboard().catch((error) => {
    console.error('[ERROR] publish 失败');
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = {
  publishDashboard,
  hasGitRepository,
  hasRemoteOrigin
};
