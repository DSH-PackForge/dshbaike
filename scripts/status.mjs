#!/usr/bin/env node
/**
 * status.mjs —— 改词条状态：**同时**改 front-matter 与 data/registry.yml。
 *
 * 用法：
 *   node scripts/status.mjs <kind>/<n> <draft|published|archived|deleted> [更多 id...]
 *   node scripts/status.mjs plugin/3 published
 *
 * 为什么需要它：编号契约要求「词条文件的 status 必须与 registry 一致」（校验规则 2），
 * 而 `new.mjs` 领号时两处都写成 `draft`——于是「写完准备发布」这一步天然要在两个文件里
 * 各改一次，漏一处就是 error。人被这个坑绊过一次（子代理写词条时踩到），所以固化成命令。
 *
 * 退出码：0 成功 / 1 有问题（未知 id、状态非法、两处不一致且无法安全改写）/ 2 用法错误。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ENTRY_STATUSES, parseEntryId } from './lib/registry.mjs';
import { loadRegistry, loadEntryFile } from './lib/data.mjs';
import { displayPath } from './lib/util.mjs';

const USAGE = `用法：node scripts/status.mjs <kind>/<n> <状态> [更多 <kind>/<n> <状态>…]

  状态取值：${ENTRY_STATUSES.join(' | ')}

例：
  node scripts/status.mjs plugin/3 published      # 写完并自检通过后发布
  node scripts/status.mjs concept/5 deleted       # 撤下：页面保留成墓碑，号永不复用`;

/** 在 registry 文本里把某个 (kind, n) 条目的 status 改掉；返回新文本与是否命中 */
function setRegistryStatus(text, kind, n, status) {
  const lines = text.split('\n');
  let inBlock = false;
  let inEntries = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^entries:/.test(lines[i])) inEntries = true;
    if (!inEntries) continue;
    const m = /^(\s*)-\s*n:\s*(\d+)\s*$/.exec(lines[i]);
    if (m) {
      inBlock = Number(m[2]) === Number(n);
      continue;
    }
    if (!inBlock) continue;
    const k = /^(\s*)kind:\s*(\S+)\s*$/.exec(lines[i]);
    if (k && k[2] !== kind) {
      inBlock = false; // n 相同但 kind 不是我们要的那条
      continue;
    }
    const s = /^(\s*)status:\s*(\S+)\s*$/.exec(lines[i]);
    if (s) {
      lines[i] = `${s[1]}status: ${status}`;
      return { text: lines.join('\n'), hit: true };
    }
  }
  return { text, hit: false };
}

/** 改词条文件 front-matter 里的 status（只动第一处，且必须在 front-matter 内） */
function setFileStatus(raw, status) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { text: raw, hit: false };
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break;
    const m = /^(\s*)status:\s*(\S+)(\s*#.*)?$/.exec(lines[i]);
    if (m) {
      lines[i] = `${m[1]}status: ${status}`;
      return { text: lines.join('\n'), hit: true };
    }
  }
  return { text: raw, hit: false };
}

function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return argv.length === 0 ? 2 : 0;
  }
  if (argv.length % 2 !== 0) {
    process.stderr.write(`参数要成对出现：<kind>/<n> <状态>\n\n${USAGE}\n`);
    return 2;
  }

  const registry = loadRegistry();
  const registryText = fs.readFileSync(registry.path, 'utf8');
  const index = new Map();
  for (const entry of registry.data.entries ?? []) {
    index.set(`${entry.kind}/${entry.n}`, entry);
  }

  let failures = 0;
  let nextRegistryText = registryText;

  for (let i = 0; i < argv.length; i += 2) {
    const id = argv[i];
    const status = argv[i + 1];
    const parsed = parseEntryId(id);
    if (!parsed) {
      process.stderr.write(`不认识的词条 id：\`${id}\`（要形如 plugin/3）\n`);
      failures += 1;
      continue;
    }
    if (!ENTRY_STATUSES.includes(status)) {
      process.stderr.write(`非法状态：\`${status}\`（只能是 ${ENTRY_STATUSES.join(' | ')}）\n`);
      failures += 1;
      continue;
    }
    const reg = index.get(parsed.id);
    if (!reg) {
      process.stderr.write(`${parsed.id} 不在 registry 里——领号必须走 node scripts/new.mjs\n`);
      failures += 1;
      continue;
    }

    const entry = loadEntryFile(parsed.kind, parsed.n);
    if (!entry || !fs.existsSync(entry.path)) {
      process.stderr.write(`${parsed.id} 的词条文件不存在：data/${parsed.kind}/${parsed.n}.md\n`);
      failures += 1;
      continue;
    }

    const before = { registry: reg.status ?? 'draft', file: entry.data?.status ?? 'draft' };
    const r = setRegistryStatus(nextRegistryText, parsed.kind, parsed.n, status);
    const f = setFileStatus(fs.readFileSync(entry.path, 'utf8'), status);
    if (!r.hit) {
      process.stderr.write(`${parsed.id} 在 registry 里找不到 status 行，未改动\n`);
      failures += 1;
      continue;
    }
    if (!f.hit) {
      process.stderr.write(`${parsed.id} 的 front-matter 里找不到 status 行，未改动（registry 也未写）\n`);
      failures += 1;
      continue;
    }
    nextRegistryText = r.text;
    fs.writeFileSync(entry.path, f.text);
    process.stdout.write(
      `${parsed.id} → ${status}（registry ${before.registry} → ${status}，文件 ${before.file} → ${status}）\n`,
    );
  }

  if (nextRegistryText !== registryText) fs.writeFileSync(registry.path, nextRegistryText);
  if (failures > 0) {
    process.stderr.write(`${failures} 项未改动。改完请跑 node scripts/validate.mjs\n`);
    return 1;
  }
  process.stdout.write(`完成。文件：${displayPath(registry.path)} + 对应词条文件。请跑 node scripts/validate.mjs\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
