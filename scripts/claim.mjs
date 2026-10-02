#!/usr/bin/env node
/**
 * claim.mjs —— 认领维护：把一个 GitHub 用户名加进某条词条的 `maintainers`。
 *
 * 用法：
 *   node scripts/claim.mjs <kind>/<n> <github-username>
 *   node scripts/claim.mjs plugin/1 hxh230802
 *
 * 为什么要有它：词条页上的「⚠ 没有维护者」原来只是跳到一张纠错表单——填完还得维护者
 * 亲自去改文件。认领是一件**不需要写内容**的事，所以它应该由机器完成：
 * 站点给一个表单 → GitHub Action 跑这个脚本 → 自动开 PR。
 *
 * 行为：幂等（同一个用户名加两次只有一条）、保留原有 YAML 写法（行内数组 vs 块列表）、
 * 已存在则什么都不改并如实说明。退出码：0 成功 / 1 有问题 / 2 用法错误。
 */

import fs from 'node:fs';

import { loadRegistry, loadEntryFile } from './lib/data.mjs';
import { parseEntryId } from './lib/registry.mjs';
import { displayPath } from './lib/util.mjs';

const USAGE = `用法：node scripts/claim.mjs <kind>/<n> <github-username>

例：node scripts/claim.mjs plugin/1 hxh230802`;

/** GitHub 用户名规则：1–39 位，字母数字与连字符，不能以连字符开头/结尾 */
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * 把用户名加进 front-matter 的 maintainers。
 * 返回 { text, changed, how }；不碰正文（只在前 `---` 块内动手）。
 */
export function addMaintainer(raw, username) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { text: raw, changed: false, how: 'no-front-matter' };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return { text: raw, changed: false, how: 'no-front-matter' };

  for (let i = 1; i < end; i += 1) {
    const inline = /^(\s*)maintainers:\s*\[(.*)\]\s*$/.exec(lines[i]);
    if (inline) {
      const items = inline[2].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (items.includes(username)) return { text: raw, changed: false, how: 'already' };
      items.push(username);
      lines[i] = `${inline[1]}maintainers: [${items.join(', ')}]`;
      return { text: lines.join('\n'), changed: true, how: 'inline' };
    }
    const blockStart = /^(\s*)maintainers:\s*$/.exec(lines[i]);
    if (blockStart) {
      const indent = `${blockStart[1]}  `;
      const items = [];
      let j = i + 1;
      while (j < end && new RegExp(`^${indent}-\\s`).test(lines[j])) {
        items.push(lines[j].replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''));
        j += 1;
      }
      if (items.includes(username)) return { text: raw, changed: false, how: 'already' };
      lines.splice(j, 0, `${indent}- ${username}`);
      return { text: lines.join('\n'), changed: true, how: 'block' };
    }
  }

  // 没有 maintainers 键：插在 status 之后（保持头部键的可读顺序）
  let at = -1;
  for (let i = 1; i < end; i += 1) {
    if (/^\s*status:/.test(lines[i])) { at = i; break; }
  }
  if (at < 0) at = end - 1;
  lines.splice(at + 1, 0, `maintainers: [${username}]`);
  return { text: lines.join('\n'), changed: true, how: 'inserted' };
}

function main(argv) {
  if (argv.length !== 2 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return argv.length === 2 ? 0 : 2;
  }
  const [id, username] = argv;
  const parsed = parseEntryId(id);
  if (!parsed) {
    process.stderr.write(`词条 id 形状不对：\`${id}\`（要形如 plugin/1）\n`);
    return 2;
  }
  if (!USERNAME_RE.test(username)) {
    process.stderr.write(`GitHub 用户名不合法：\`${username}\`\n`);
    return 2;
  }

  const registry = loadRegistry();
  const known = (registry.data.entries ?? []).some((e) => `${e.kind}/${e.n}` === parsed.id);
  if (!known) {
    process.stderr.write(`${parsed.id} 不在 data/registry.yml 里——不能给不存在的词条认领维护\n`);
    return 1;
  }

  const entry = loadEntryFile(parsed.kind, parsed.n);
  if (!entry || !fs.existsSync(entry.path)) {
    process.stderr.write(`词条文件不存在：data/${parsed.kind}/${parsed.n}.md\n`);
    return 1;
  }

  const raw = fs.readFileSync(entry.path, 'utf8');
  const result = addMaintainer(raw, username);
  if (!result.changed) {
    process.stdout.write(
      result.how === 'already'
        ? `${parsed.id} 的 maintainers 里已经有 ${username}，无需改动。\n`
        : `${parsed.id} 的 front-matter 无法识别，未改动。\n`,
    );
    return result.how === 'already' ? 0 : 1;
  }
  fs.writeFileSync(entry.path, result.text);
  process.stdout.write(`${parsed.id} 的 maintainers 已加入 ${username}（写法：${result.how}）\n`);
  process.stdout.write(`改了：${displayPath(entry.path)}\n`);
  return 0;
}

// 只有在直接执行时才跑 main（被测试 import 时不跑）
if (process.argv[1] && process.argv[1].endsWith('claim.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
