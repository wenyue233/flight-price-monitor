/**
 * GitHub Pages 发布脚本。
 *
 * 只提交 GitHub Pages 展示所需文件。
 * git push 失败时由调用方记录错误，不影响本地保存。
 */

const { execFile } = require('child_process');
const fs = require('fs/promises');
const { promisify } = require('util');
const { consoleInfo } = require('./utils/logger');

const execFileAsync = promisify(execFile);

async function runGit(args) {
  const result = await execFileAsync('git', args, {
    cwd: __dirname,
    maxBuffer: 1024 * 1024
  });

  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

async function hasGitRepository() {
  try {
    await fs.access(`${__dirname}/.git`);
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
