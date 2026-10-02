#!/usr/bin/env node
/**
 * check-workflows.mjs —— 推送前把 .github/**\/*.yml 全过一遍 YAML 解析。
 *
 * 为什么需要它：workflow 文件有语法错误时，GitHub **不会**在推送时给你一个清楚的报错，
 * 只会把那次推送记成一个「workflow file issue」的失败运行，而真正的事件（issue_comment
 * 等）根本不会触发。实测踩过：多行双引号字符串的收尾引号顶到第 0 列，终止了 `run: |`
 * 的块标量，整个机器人通道静默失效。
 *
 * 用法：node scripts/check-workflows.mjs   （退出码 0 全部可解析 / 1 有问题）
 * 依赖：Python + PyYAML（DSH 自带环境里有；没有时退化为只做基础结构检查并提示）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const EXTRA = [path.join(ROOT, '.github', 'ISSUE_TEMPLATE')];

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

const files = [...collect(WF_DIR), ...EXTRA.flatMap((dir) => collect(dir))].sort();
if (!files.length) {
  process.stdout.write('没有找到 .github 下的 YAML 文件\n');
  process.exit(0);
}
// 把扫过的目录打出来：这个脚本自己就因为「传了个数组给只收字符串的函数」静默漏过一整个
// 目录——静默跳过比报错更难发现，所以让它自己交代清楚扫了什么。
process.stdout.write(`扫描目录：${[WF_DIR, ...EXTRA].join('  ')}\n`);
process.stdout.write(`待校验文件 ${files.length} 个\n`);

const python = process.env.PYTHON ?? 'python';
const script = [
  'import sys, yaml',
  'bad = 0',
  'for p in sys.argv[1:]:',
  '    try:',
  '        yaml.safe_load(open(p, encoding="utf-8"))',
  '        print("  OK   " + p)',
  '    except Exception as e:',
  '        bad += 1',
  '        print("  FAIL " + p)',
  '        print("       " + str(e).replace("\\n", " | "))',
  'sys.exit(1 if bad else 0)',
].join('\n');

const probe = spawnSync(python, ['-c', 'import yaml'], { encoding: 'utf8' });
if (probe.status !== 0) {
  process.stdout.write('找不到 PyYAML（python -c "import yaml" 失败）——跳过 YAML 校验。\n');
  process.stdout.write('请自行确认 workflow 里没有「收尾引号顶到第 0 列」这类会终止块标量的写法。\n');
  process.exit(0);
}

const run = spawnSync(python, ['-c', script, ...files], { encoding: 'utf8' });
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
let ok = run.status === 0;

// ---- 额外检查：操作路由必须与 ops.mjs 声明一致，且两类表单都带 labels ----
// 这些地方分别在「workflow 决定要不要醒」「表单决定用哪个操作」「Issue 能不能被筛出来」，
// 任何一处漂移的表现都是**静默失效**（最难发现的那类坏法），所以在这里钉死。
const opsSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'ops.mjs'), 'utf8');
const declared = [...opsSrc.matchAll(/^\s*title:\s*'([^']+)'/gm)].map((m) => m[1]).sort();
const applySrc = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'apply.yml'), 'utf8');
const tplDir = EXTRA[0];

// ① 「机器代改」表单的标题前缀必须与 ops.mjs 声明的操作**一一对应**：一张表 = 一个意图
//    （评审实测：合并成一张、操作在表单内选，体验更差——已经点了「改一句话」的人还要再选一次）。
//
//    判定方式**不按文件名编号**：编号（1-4 机器代改 / 5 纠错 / 6 新增词条 / 7 站点改进）是给人读的，
//    加第五类操作时它表达不了（新增词条是机器代改，却排在 6）。这里的判据是**署名契约**本身——
//    带「内容变更」标签、且必填「GitHub 用户名」的表单就是机器代改表单。于是新增一类操作时，
//    只要表单与 ops.mjs 对不上，检查就会 FAIL，而不会因为编号没挪位而静默放过。
const isBotForm = (f) => {
  const src = fs.readFileSync(path.join(tplDir, f), 'utf8');
  return /^labels:\s*\[\s*"内容变更"/m.test(src) && /id: username[\s\S]*?required: true/.test(src);
};
const botFormFiles = fs.readdirSync(tplDir).filter((f) => f.endsWith('.yml') && isBotForm(f)).sort();
const prefixes = botFormFiles.flatMap((f) =>
  [...fs.readFileSync(path.join(tplDir, f), 'utf8').matchAll(/^title:\s*"\[([^\]]+)\]\s*"/gm)].map((m) => m[1]));
const routedOps = [...new Set(prefixes)].sort();
process.stdout.write(`\n路由检查：\n  ops.mjs 声明 ${declared.length} 个操作：${declared.join(' / ')}\n`);
process.stdout.write(`  机器代改表单 ${botFormFiles.length} 张，标题前缀 ${routedOps.length} 个：${routedOps.join(' / ')}\n`);
const sameSet = declared.length === routedOps.length && declared.every((v, i) => v === routedOps[i]);
if (sameSet) {
  process.stdout.write('  OK   一张表单一个意图，且与 ops.mjs 完全对应\n');
} else {
  ok = false;
  process.stdout.write('  FAIL 表单与 ops.mjs 不一致——机器人会静默漏掉或错认操作：\n');
  process.stdout.write(`       只在 ops.mjs：${declared.filter((d) => !routedOps.includes(d)).join(' ') || '（无）'}\n`);
  process.stdout.write(`       只在表单：${routedOps.filter((r) => !declared.includes(r)).join(' ') || '（无）'}\n`);
}

// ② workflow 的 if 必须认得每一个操作前缀，否则那条路机器人根本不醒
for (const prefix of routedOps) {
  if (applySrc.includes(`'[${prefix}]'`)) {
    process.stdout.write(`  OK   apply.yml 认得前缀 [${prefix}]\n`);
  } else {
    ok = false;
    process.stdout.write(`  FAIL apply.yml 不认前缀 [${prefix}]——那条路机器人不会醒\n`);
  }
}

const templates = collect(tplDir).filter((p) => path.basename(p) !== 'config.yml');
const noLabel = templates
  .map((p) => ({ p, src: fs.readFileSync(p, 'utf8') }))
  .filter(({ src }) => !/^labels:/m.test(src))
  .map(({ p }) => path.basename(p));

// ④ 机器人代改的表单必须**必填** GitHub 用户名——署名契约（docs/14）：
// 署名靠它，所以它是输入里的必填项；少一处，那条路就会退化成「署不出名」。
// 这里的集合直接复用 ① 算出来的 botFormFiles（按标题前缀与 ops.mjs 对上的那些），
// 不再按文件名编号挑选——否则新增一类操作、编号没挪位，这一项就会静默漏检。
const botForms = botFormFiles.map((f) => path.join(tplDir, f));
const missingUser = botForms.filter((p) => {
  const src = fs.readFileSync(p, 'utf8');
  const at = src.indexOf('label: GitHub 用户名');
  if (at < 0) return true;
  // 只看**这个字段自己的块**（到下一个 `- type:` 为止），不要用固定字符窗口：
  // 窗口会把后面字段的 required 也算进来，负例（把 required 改成 false）就触发不了检查。
  const rest = src.slice(at);
  const next = rest.search(/\n\s*- type:/);
  const block = next < 0 ? rest : rest.slice(0, next);
  return !/required:\s*true/.test(block);
}).map((p) => path.basename(p));
if (missingUser.length === 0) {
  process.stdout.write(`  OK   ${botForms.length} 张机器代改表单都把「GitHub 用户名」设为必填\n`);
} else {
  ok = false;
  process.stdout.write(`  FAIL 这些机器代改表单没有必填 GitHub 用户名（署名会没着落）：${missingUser.join(', ')}\n`);
}
if (noLabel.length) {
  process.stdout.write(`  FAIL 这些表单没有 labels（两类 Issue 就筛不出来了）：${noLabel.join(', ')}\n`);
  ok = false;
} else {
  process.stdout.write(`  OK   ${templates.length} 张表单都带 labels（内容变更 / 站点改进）\n`);
}

process.stdout.write(ok ? `\n全部检查通过。\n` : `\n有问题——**推送前必须修**（workflow 语法错误时 GitHub 只会静默不运行）。\n`);
process.exit(ok ? 0 : 1);
