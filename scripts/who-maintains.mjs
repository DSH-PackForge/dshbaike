#!/usr/bin/env node
/**
 * who-maintains.mjs —— 打印「这条改动涉及的那条词条」的维护者（一行一个）。
 *
 * 两种用法：
 *   node scripts/who-maintains.mjs plugin/1              # 直接给词条 id
 *   node scripts/who-maintains.mjs --issue               # 从 ISSUE_TITLE / ISSUE_BODY 推断
 *   node scripts/who-maintains.mjs --issue --one-line    # 逗号分隔，便于塞进环境变量
 *
 * 为什么需要「从 Issue 推断」：第一道闸要让**这条词条的维护者**也能批准（docs/14 §1.4），
 * 而那个 job 不该去真的执行操作，只需要知道「这条改动动的是哪条词条」。
 *
 * 推断来源与 findOp 一致：标题尾部（站点深链塞进去的编号）优先，其次表单里的「词条 id」。
 * 没有维护者、或推断不出词条时输出空（退出码 0）——「还没人认领」不是错误。
 */

import fs from 'node:fs';
import path from 'node:path';

import { readMaintainers } from './claim.mjs';
import { parseFormBody, parseTitle } from './lib/ops.mjs';
import { parseEntryId } from './lib/registry.mjs';
import { REPO_ROOT } from './lib/util.mjs';

const argv = process.argv.slice(2);
const fromIssue = argv.includes('--issue');
const oneLine = argv.includes('--one-line');

/** 从标题与表单里推断被改的词条 id（形状不合法就当没有） */
function entryIdFromIssue() {
  const { target } = parseTitle(process.env.ISSUE_TITLE ?? '');
  const form = parseFormBody(process.env.ISSUE_BODY ?? '');
  const candidates = [target, form['词条 id'] ?? ''];
  for (const raw of candidates) {
    const id = String(raw).trim().replace(/^`|`$/g, '').split(/\s+/)[0];
    if (id && parseEntryId(id)) return id;
  }
  return '';
}

const id = fromIssue ? entryIdFromIssue() : (argv.find((a) => !a.startsWith('--')) ?? '');
if (!id) process.exit(0);

const parsed = parseEntryId(id);
if (!parsed) process.exit(0);

// 直接拼路径并先查存在性：loadEntryFile 不检查存在性，词条不存在时会抛 ENOENT，
// 而非零退出会被 workflow 当成「脚本坏了」——「查不到」与「出错」必须分开。
const file = path.join(REPO_ROOT, 'data', parsed.kind, `${parsed.n}.md`);
if (!fs.existsSync(file)) process.exit(0);

const list = readMaintainers(fs.readFileSync(file, 'utf8'));
process.stdout.write(oneLine ? `${list.join(',')}\n` : list.map((u) => `${u}\n`).join(''));
