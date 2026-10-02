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

/** 生成词条骨架（front-matter 只放公共必填项 + 该 kind 的注释提示） */
function skeleton(kind, title, date) {
  const lines = [
    `title: ${quote(title)}`,
    'category: []            # TODO 填 taxonomy 的叶子节点 id（如 concept.runtime）；规则 6 是 error',
    'tags: []',
    'summary: TODO 一句话摘要，用于列表与搜索',
    'status: draft           # draft | published | archived | deleted（必须与 registry 一致）',
    `updatedAt: ${date}`,
  ];

  const kindHints = {
    concept: ['# layer: runtime | plugin | agent | workspace | ecosystem', '# spec: 权威出处（代码路径或规范文档 URL）'],
    plugin: [
      '# repo: owner/repo        # npm 与 repo 至少给一个（规则 16）',
      '# npm: "@scope/name"',
      '# install: dsh plugin add <…>',
      '# role: bundle | client | bundle+client | theme | compat',
      '# positioning: TODO 用生态语境说清它解决什么问题（不要照抄上游 description）',
      '# entryGate: tutorial     # official | tutorial | pack | maintainer（插件收录门槛，规则 15）',
    ],
    tutorial: [
      '# difficulty: beginner | intermediate | advanced',
      '# prereq: [concept/1]',
      '# appliesTo: "dsh 0.1.0-rc.6 实测；0.2.x 未核实"   # 必须带「实测 / 未核实」口径（规则 11）',
      '# origin: original        # original | external',
      '# related: []',
    ],
    pack: ['# marketId: <owner>.<repo>', '# packType: profile | dshhome', '# fitFor: TODO 这包适合谁（人工判断）'],
    launcher: [
      '# launcherId: dshl | hdsl | dsh-packforge-app | official-desktop | dsh-cli',
      '# url: …',
      '# platforms: []',
    ],
    source: [
      '# url: …',
      '# zones: [plugins]',
      '# sourceKind: plugin-directory | guide | market | registry | spec | tool | topic',
      '# relation: complementary | overlapping | upstream',
      '# howto: TODO 怎么用它 / 怎么向它投稿',
      '# linkOut: …',
    ],
  };
  lines.push(...(kindHints[kind] ?? []));

  const body = ['## TODO 第一节', '', '这里写正文（中文）。标题从二级开始，构建期会生成锚点与 TOC。', ''].join('\n');
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

function quote(text) {
  const s = String(text);
  if (/^[\p{Letter}\p{Number}][\p{Letter}\p{Number} \u3000._@/-]*$/u.test(s) && !/^(true|false|null|~)$/i.test(s)) {
    return s;
  }
  return JSON.stringify(s);
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
