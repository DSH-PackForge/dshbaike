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
import process from 'node:process';

import { findOp, parseFormBody } from './lib/ops.mjs';
import { normalizeUsername, usernameProblem } from './lib/util.mjs';

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

/**
 * 这个 GitHub 账号真的存在吗？
 *
 * 形状合法不等于账号存在——写错一个字母就会在提交里留下一个指向不存在账号的署名，
 * 而那正是我们**唯一**用来记作者的东西。所以宁可拒绝，也不写下坏署名。
 * 返回 true / false；API 出错时抛异常（调用方按「无法核实」处理，也是拒绝）。
 */
async function userExists(name, token) {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(name)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dshbaike-bot',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`GitHub API 返回 ${res.status}`);
}

async function main(argv) {
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

  const form = parseFormBody(body);
  // 先解析表单：合并表单要靠「操作类型」下拉才知道用哪个操作
  const found = findOp(title, form);
  if (!found) {
    process.stderr.write(`认不出这是哪种贡献表单：\`${title}\`\n`);
    emit({
      ok: 'false',
      reason: 'unknown-op',
      escalate: 'false',
      fingerprint: fp,
      message: '认不出这是哪种表单。请用仓库里的 Issue 模板重新提交（标题形如 `[补充分区条目] themes` 或 `[内容变更] 改一个字段 plugin/1`）。',
    });
    return 1;
  }

  // ---- 署名契约（docs/14）：先校验，再动手 ----------------------------------
  // **所有**机器代改都必须带一个真实存在的 GitHub 用户名——署名靠它（提交作者写的就是它）。
  // 三道：①表单里有没有；②形状合不合法；③账号真不真（查 API）。任何一道不过就**直接拒绝**。
  const rawName = form['GitHub 用户名'];
  const name = normalizeUsername(rawName);
  const offline = argv.includes('--offline') || process.env.OFFLINE === 'true';
  const shape = usernameProblem(rawName);
  if (shape) {
    process.stderr.write(`${shape}\n`);
    emit({
      ok: 'false',
      reason: name ? 'bad-username' : 'incomplete',
      escalate: 'false',
      op: found.op.id,
      fingerprint: fp,
      message: `${shape}。**署名要用它**，所以机器人不会在没有合法用户名的情况下动手。`,
    });
    return 1;
  }
  if (!offline) {
    let exists;
    try {
      exists = await userExists(name, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '');
    } catch (err) {
      process.stderr.write(`无法核实 ${name}：${err.message}\n`);
      emit({
        ok: 'false',
        reason: 'user-lookup-failed',
        escalate: 'false',
        op: found.op.id,
        fingerprint: fp,
        message: `无法核实 \`${name}\` 这个账号（${err.message}）。署名要靠它，为了不写下坏署名，机器人这次不动手——改一下表单内容就会自动重试。`,
      });
      return 1;
    }
    if (!exists) {
      process.stderr.write(`GitHub 上找不到账号 ${name}\n`);
      emit({
        ok: 'false',
        reason: 'unknown-user',
        escalate: 'false',
        op: found.op.id,
        fingerprint: fp,
        message: `GitHub 上**找不到** \`${name}\` 这个账号。署名要用它（提交作者写的就是这个名字），所以机器人不会动手：请确认拼写——填的是**用户名**，不是显示名、不是邮箱。`,
      });
      return 1;
    }
  } else {
    process.stdout.write('（--offline：跳过账号存在性核实）\n');
  }

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

// main 现在是 async（要查 GitHub 账号是否存在）
process.exit(await main(process.argv.slice(2)));
