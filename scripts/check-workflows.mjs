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

// ---- 额外检查：机器人路由的操作前缀必须与 ops.mjs 声明的操作标题一致 ----
// 这两处分别是「workflow 决定要不要醒」与「脚本决定用哪个操作」，改名不一致时
// 表现是**机器人静默不工作**（最难发现的那类坏法），所以在这里钉死。
const opsSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'ops.mjs'), 'utf8');
const declared = [...opsSrc.matchAll(/^\s*title:\s*'([^']+)'/gm)].map((m) => m[1]).sort();
const applySrc = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'apply.yml'), 'utf8');
const routed = [...applySrc.matchAll(/startsWith\(github\.event\.issue\.title,\s*'\[([^\]]+)\]'\)/g)]
  .map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();
process.stdout.write(`\n路由检查：\n  ops.mjs 声明 ${declared.length} 个操作：${declared.join(' / ')}\n`);
process.stdout.write(`  apply.yml 路由 ${routed.length} 个前缀：${routed.join(' / ')}\n`);
const sameSet = declared.length === routed.length && declared.every((v, i) => v === routed[i]);
if (sameSet) {
  process.stdout.write('  OK   两处一致\n');
} else {
  ok = false;
  process.stdout.write('  FAIL 两处不一致——机器人会静默漏掉或错认操作，必须修：\n');
  process.stdout.write(`       只在 ops.mjs 有：${declared.filter((d) => !routed.includes(d)).join(' ') || '（无）'}\n`);
  process.stdout.write(`       只在 apply.yml 有：${routed.filter((r) => !declared.includes(r)).join(' ') || '（无）'}\n`);
}

const templates = collect(EXTRA[0]).filter((p) => path.basename(p) !== 'config.yml');
const noLabel = templates
  .map((p) => ({ p, src: fs.readFileSync(p, 'utf8') }))
  .filter(({ src }) => !/^labels:/m.test(src))
  .map(({ p }) => path.basename(p));
if (noLabel.length) {
  process.stdout.write(`  FAIL 这些表单没有 labels（两类 Issue 就筛不出来了）：${noLabel.join(', ')}\n`);
  ok = false;
} else {
  process.stdout.write(`  OK   ${templates.length} 张表单都带 labels（内容变更 / 站点改进）\n`);
}

process.stdout.write(ok ? `\n全部检查通过。\n` : `\n有问题——**推送前必须修**（workflow 语法错误时 GitHub 只会静默不运行）。\n`);
process.exit(ok ? 0 : 1);
