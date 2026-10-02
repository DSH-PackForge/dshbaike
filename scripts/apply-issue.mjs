#!/usr/bin/env node
/**
 * apply-issue.mjs —— 「表单 → 有界操作 → 文件改动」的统一派发器（docs/14）。
 *
 * 由 `.github/workflows/apply.yml` 调用：读 Issue 标题与正文，找到对应操作，
 * 让它改文件，然后把结果写进 $GITHUB_OUTPUT（workflow 据此开 PR 或回帖）。
 *
 * 本地可测（不必赌 CI）：
 *   node scripts/apply-issue.mjs --title "[认领维护] plugin/1" --body-file body.md
 *   ISSUE_TITLE=... ISSUE_BODY=... node scripts/apply-issue.mjs
 *
 * 退出码：0 改动成功 / 1 不能自动处理（原因写进 reason，必要时置 escalate=1）/ 2 用法错误。
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

import { findOp, parseFormBody } from './lib/ops.mjs';

/**
 * 请求指纹：标题 + 正文的哈希。
 *
 * 「第一道闸」是维护者在 Issue 里回复 `/approve`。评论式审批有个洞：批准之后作者可以
 * 再编辑正文，执行的就成了**没被审过的那一版**。指纹把「审的哪一份」钉死：
 * 批准时的指纹写在机器人的回帖里，执行时重新算一遍，不一致就拒绝并要求重审。
 */
export function fingerprint(title, body) {
  const text = `${String(title ?? '').trim()}\n${String(body ?? '').replace(/\r\n/g, '\n').trim()}`;
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * 这些原因意味着「机器人不该改」，要请作者主动 fork + PR：
 *   unsupported —— 改动落在机器人不碰的结构上（嵌套字段、块结构）
 *   ambiguous   —— 定位不唯一（正文片段出现多次），猜就是错
 *   not-found   —— 找不到那段原文
 * 其余（incomplete / unknown-entry / unknown-section / bad-links / already）作者改表单就能解决。
 */
const ESCALATE = new Set(['unsupported', 'ambiguous', 'not-found']);

function emit(pairs) {
  const lines = [];
  for (const [key, value] of Object.entries(pairs)) {
    const text = String(value ?? '');
    if (text.includes('\n')) lines.push(`${key}<<__DSH_EOF__`, text, '__DSH_EOF__');
    else lines.push(`${key}=${text}`);
  }
  const payload = `${lines.join('\n')}\n`;
  process.stdout.write(payload);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, payload);
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function main(argv) {
  const title = argValue(argv, '--title') ?? process.env.ISSUE_TITLE ?? '';
  let body = process.env.ISSUE_BODY ?? '';
  const bodyFile = argValue(argv, '--body-file');
  if (bodyFile) body = fs.readFileSync(bodyFile, 'utf8');
  // 干跑：算出会发生什么，但**不写文件**——用在「先审再做」的第一道闸上
  const dryRun = argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

  if (!title.trim()) {
    process.stderr.write('没有拿到 Issue 标题（--title 或 ISSUE_TITLE）\n');
    return 2;
  }

  const fp = fingerprint(title, body);
  const expect = argValue(argv, '--expect-fingerprint') ?? process.env.EXPECT_FINGERPRINT ?? '';
  if (expect && expect !== fp) {
    process.stderr.write(`请求指纹不一致：审的是 ${expect}，现在是 ${fp}（正文在批准后被改过）\n`);
    emit({
      ok: 'false',
      reason: 'stale-approval',
      escalate: 'false',
      fingerprint: fp,
      message: `这个请求在批准之后**又被修改过**（审核指纹 \`${expect}\` → 现在 \`${fp}\`）。为了不改错东西，机器人拒绝执行。请维护者看一眼新的内容后重新回复 \`/approve\`。`,
    });
    return 1;
  }

  const found = findOp(title);
  if (!found) {
    process.stderr.write(`认不出这是哪种贡献表单：\`${title}\`\n`);
    emit({
      ok: 'false',
      reason: 'unknown-op',
      escalate: 'false',
      fingerprint: fp,
      message: '认不出这是哪种表单。请用仓库里的 Issue 模板重新提交（标题形如 `[认领维护] plugin/1`）。',
    });
    return 1;
  }

  const form = parseFormBody(body);
  const result = found.op.apply({ target: found.target, form });

  if (!result.ok) {
    process.stderr.write(`未能自动处理：${result.reason} —— ${result.message}\n`);
    emit({
      ok: 'false',
      reason: result.reason,
      escalate: ESCALATE.has(result.reason) ? 'true' : 'false',
      op: found.op.id,
      fingerprint: fp,
      message: result.message,
    });
    return 1;
  }

  for (const write of result.writes) {
    if (!dryRun) fs.writeFileSync(write.path, write.text);
  }
  process.stdout.write(
    `${dryRun ? '（干跑，未写文件）' : '已改动'} ${result.writes.length} 个文件：${result.writes.map((w) => w.path).join(', ')}\n`,
  );
  emit({
    ok: 'true',
    changed: 'true',
    dry: dryRun ? 'true' : 'false',
    op: found.op.id,
    id: result.id ?? '',
    files: result.writes.map((w) => w.path).join(','),
    summary: result.summary ?? found.op.title,
    fingerprint: fp,
    // 署名：提这个 Issue 的人（GitHub 认过的身份）+ 表单里写的用户名（认领维护那张表有）
    author: process.env.ISSUE_AUTHOR ?? '',
    credited: result.credited ?? '',
  });
  return 0;
}

process.exit(main(process.argv.slice(2)));
