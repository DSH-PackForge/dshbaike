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
const ok = run.status === 0;
process.stdout.write(ok ? `\n${files.length} 个文件都可以解析。\n` : `\n有文件无法解析——**推送前必须修**：workflow 语法错误时 GitHub 只会静默不运行。\n`);
process.exit(ok ? 0 : 1);
