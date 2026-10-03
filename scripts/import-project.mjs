#!/usr/bin/env node
/**
 * import-project.mjs（CLI）—— 薄壳：解析参数 → 调 lib/import-project.mjs → 落盘或打印。
 *
 * 逻辑全在 lib 里（机器人 op 用同一份），这个文件只管命令行体验。
 *
 * 用法：
 *   node scripts/import-project.mjs owner/repo [--kind plugin] [--user 你的GitHub名]
 *                                      [--dry] [--out 文件] [--n 3] [--title 标题]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planProjectImport } from './lib/import-project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KINDS = ['concept', 'plugin', 'pack', 'launcher', 'client', 'mcp', 'skill', 'preset',
  'recipe', 'theme', 'asset', 'tool', 'spec', 'tutorial', 'source'];

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const repoArg = argv.find((a) => !a.startsWith('--') && (a.includes('/') || a.includes('github.com')));
if (!repoArg) {
  console.error('用法：node scripts/import-project.mjs owner/repo [--kind plugin] [--user <用户名>] [--dry] [--out <文件>] [--n <号>] [--title <标题>]');
  process.exit(1);
}
const kind = String(flag('kind', 'plugin'));
if (!KINDS.includes(kind)) { console.error('  ❌ --kind 只能是：' + KINDS.join(' | ')); process.exit(1); }
const dry = argv.includes('--dry');
const outPath = flag('out', null);
const forcedN = flag('n', null);

const plan = await planProjectImport({
  repoRef: repoArg,
  kind,
  user: flag('user', null),
  title: flag('title', null),
  note: flag('note', null),
  now: new Date().toISOString().slice(0, 10),
});

if (!plan.ok) { console.error('  ❌ ' + plan.message); process.exit(1); }

console.log('  上游：' + plan.upstream.url + ' · star ' + plan.meta.star + ' · ' + (plan.meta.license ?? '无许可证'));
console.log('  正文来源：' + (plan.readmeFile ?? '（无 README）')
  + (plan.readmeFile && /ZH|zh/.test(plan.readmeFile) ? '（简体中文版）' : '')
  + ' · npm ' + (plan.npmName ?? '（无）') + (plan.version ? ' v' + plan.version : ''));
for (const w of plan.warnings) console.log('  ⚠ ' + w);

if (dry) {
  if (outPath && typeof outPath === 'string') {
    fs.writeFileSync(path.resolve(String(outPath)), plan.entryText, 'utf8');
    console.log('  ✓ --dry + --out：已写到 ' + outPath + '（UTF-8，未碰 data/ 与 registry）· '
      + plan.entryText.split('\n').length + ' 行');
  } else {
    console.log('\n  ── --dry：生成的词条内容（未写任何文件）──\n');
    console.log(plan.entryText);
    console.log('\n  行数 ' + plan.entryText.split('\n').length);
  }
  process.exit(0);
}

const { allocate } = await import('./lib/registry.mjs');
const today = new Date().toISOString().slice(0, 10);
const alloc = forcedN ? { n: Number(forcedN) } : allocate({ kind, title: plan.title, now: today });
const target = path.join(ROOT, 'data', kind, alloc.n + '.md');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, plan.entryText);
console.log('  ✓ 已写入 data/' + kind + '/' + alloc.n + '.md（status: draft，不会上线）');
console.log('  下一步：补 category 与 positioning，跑 node scripts/validate.mjs，再按 docs/14 发布。');
