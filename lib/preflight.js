/**
 * 收尾前的环境自检。
 *
 * 这三项都来自真实事故，且都发生在"以为已经交付"的时刻：
 *   - 凭据文件忘了删（生成了 5 个 token，本地留着一个）
 *   - 调试端口 / 本地代理忘了关（9333、8899 长期监听）
 *   - 复用旧脚本时写死的默认值把别的项目信息带进来
 *
 * 故意只做只读检查：插件不改用户环境，只把问题摆到收尾门槛上。
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const CREDENTIAL_NAMES = ['.gh-token', '.gh-device.json', '.rel-id', 'gh-token.txt'];

/** 常见的高危监听端口：调试端口能让任意本地进程控制浏览器。 */
const WATCHED_PORTS = [
  { port: 9333, why: 'Edge/Chromium 远程调试端口，可被本地任意进程操控浏览器' },
  { port: 8899, why: '本地转发代理，交付后应关闭' },
  { port: 9222, why: 'Chrome 远程调试端口' },
];

/** 不该再出现在代码里的旧账号 / 旧文案。 */
const STALE_PATTERNS = [
  { pattern: /['"]drdr666['"]/, why: '账号少一个 d（实际为 drdrdrd666 之外的旧值）' },
  { pattern: /['"]sixtysevenlf['"]/, why: '来自别的项目文案的账号' },
];

function probePort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function walkFiles(dir, out = [], depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out, depth + 1);
    else if (/\.(mjs|js|cjs|json|ya?ml)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * 扫描工作区的交付残留。
 * @param {string} workspace 工作区绝对路径
 * @param {{skipFiles?: string[]}} [options] 相对路径白名单（例如自检脚本自身）
 * @returns {Promise<string[]>} 人类可读的问题列表，空数组表示干净
 */
export async function scanEnvironment(workspace, options = {}) {
  const problems = [];
  const skip = new Set(options.skipFiles || []);

  // 1. 凭据残留
  for (const name of CREDENTIAL_NAMES) {
    if (fs.existsSync(path.join(workspace, name))) {
      problems.push(`凭据文件仍在：${name}（用完应删除，并提醒用户撤销对应 token）`);
    }
  }

  // 2. 高危端口
  for (const { port, why } of WATCHED_PORTS) {
    if (await probePort(port)) {
      problems.push(`端口 ${port} 仍在监听：${why}`);
    }
  }

  // 3. 写死的旧默认值
  const files = walkFiles(workspace).filter((f) => !skip.has(path.relative(workspace, f).split(path.sep).join('/')));
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { pattern, why } of STALE_PATTERNS) {
      if (pattern.test(text)) {
        problems.push(`代码里写死了旧值：${path.relative(workspace, file)} —— ${why}`);
      }
    }
  }

  return problems;
}
