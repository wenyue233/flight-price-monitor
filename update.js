/**
 * One-command updater for short-term ticket monitoring.
 *
 * Flow:
 * 1. pnpm run once
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

const execFileAsync = promisify(execFile);
const publishFiles = ['dashboard.html', 'index.html', 'README.md', 'dashboard.js', 'config.js'];

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
  printCommand('pnpm', ['run', 'once']);
  await runCommand('pnpm', ['run', 'once'], {
    env: {
      ...process.env,
      PATH: process.env.PATH
    }
  });
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
    console.log('没有需要发布的变化');
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
  console.log(`GitHub Pages 链接：${config.dashboard.publicUrl}`);
  return true;
}

async function update() {
  if (!(await ensureGitReady())) {
    return;
  }

  try {
    await runOnce();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`.trim();
    console.error(`pnpm run once 失败：${output}`);
    return;
  }

  await stagePublishFiles();
  const committed = await commitIfNeeded();
  if (!committed) {
    console.log(`GitHub Pages 链接：${config.dashboard.publicUrl}`);
    return;
  }

  try {
    await pullLatest();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`.trim();
    console.error(`git pull --rebase 失败：${output}`);
    console.error('本地提交已创建，但尚未推送。请处理 rebase 冲突或工作区问题后，再执行 pnpm run update。');
    return;
  }

  await pushChanges();
}

if (require.main === module) {
  update().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = {
  update
};
