#!/usr/bin/env node
/**
 * new.mjs —— 领号：分配下一个空闲编号、写 data/registry.yml、生成词条骨架。
 *
 * 用法（docs/10 §3）：
 *   node scripts/new.mjs <kind> "<标题>" [--dry-run]
 *
 * 退出码：0 成功 / 2 用法错误（kind 非法、缺参数）/ 1 其它错误。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ENTRY_KINDS,
  REGISTRY_PATH,
  allocate,
  nextNumber,
} from './lib/registry.mjs';
// loadRegistry 属于「读」这一侧，由 data.mjs 提供（registry.mjs 只是自己 import 了它、并未 re-export，
// 之前这里从 registry.mjs 导入导致 `does not provide an export named 'loadRegistry'`，领号整个跑不起来）
import { loadRegistry } from './lib/data.mjs';
import { displayPath, fromRoot, todayLocal } from './lib/util.mjs';
import { skeleton } from './lib/skeleton.mjs';
import { SchemaError } from './lib/yaml.mjs';

const USAGE = `用法：node scripts/new.mjs <kind> "<标题>" [--dry-run]

  <kind>      ${ENTRY_KINDS.join(' | ')}
  --dry-run   只打印会分配到的号，不写任何文件

例：node scripts/new.mjs concept "为什么升级后插件会失效"`;

function usageError(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function main(argv) {
  const positional = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    } else if (arg.startsWith('-') && arg !== '-') usageError(`不认识的选项：${arg}`);
    else positional.push(arg);
  }

  const [kind, ...titleParts] = positional;
  const title = titleParts.join(' ').trim();

  if (!kind) usageError('缺少 <kind> 参数');
  if (!ENTRY_KINDS.includes(kind)) {
    usageError(`非法 <kind>：\`${kind}\`。合法值只有 ${ENTRY_KINDS.join(' | ')}`);
  }
  if (!title) usageError('缺少 "<标题>" 参数');

  const date = todayLocal();
  const id = `${kind}/${dryRun ? nextNumber(loadRegistry().data, kind) : '(分配中)'}`;

  if (dryRun) {
    const n = nextNumber(loadRegistry().data, kind);
    process.stdout.write('（dry-run：不写任何文件）\n');
    process.stdout.write(`会分配到的号：${kind}/${n}\n`);
    process.stdout.write(`词条文件会是：${path.join('data', kind, `${n}.md`)}\n`);
    process.stdout.write(`编号会写进：${displayPath(REGISTRY_PATH)}\n`);
    return 0;
  }

  const result = allocate({ kind, title, now: date });
  const finalId = `${result.kind}/${result.n}`;
  const absPath = fromRoot(result.entryPath);

  if (fs.existsSync(absPath)) {
    // allocate 已经改了 registry，这里必须硬失败并提示人工修复
    process.stderr.write(
      `严重：registry 已分配 ${finalId}，但目标文件已存在：${result.entryPath}\n请人工检查 data/registry.yml 的 counters 与 entries。\n`,
    );
    return 1;
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, skeleton(kind, title, date), 'utf8');

  process.stdout.write(`新词条 id：${finalId}\n`);
  process.stdout.write(`词条文件：${result.entryPath}\n`);
  process.stdout.write(`编号写入：${result.registryPath}\n`);
  process.stdout.write(`registry 条目：n=${result.n} kind=${result.kind} title=${result.entry.title} createdAt=${result.entry.createdAt} status=${result.entry.status}\n`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof SchemaError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
