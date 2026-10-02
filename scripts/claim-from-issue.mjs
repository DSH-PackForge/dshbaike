#!/usr/bin/env node
/**
 * claim-from-issue.mjs —— 把「我来维护这一条」Issue 表单的内容，落成一次文件改动。
 *
 * 由 `.github/workflows/claim.yml` 调用；输入来自 Issue 正文（GitHub Issue Forms 会把表单
 * 渲染成 `### <字段标签>\n\n<值>` 的 Markdown，所以这里按**标签**解析）。
 *
 * 用法（本地可测，不必等 CI）：
 *   ISSUE_BODY="$(cat body.md)" node scripts/claim-from-issue.mjs
 *   node scripts/claim-from-issue.mjs --body-file body.md
 *
 * 输出：一行 `key=value`（同时写进 $GITHUB_OUTPUT，如果在 Actions 里跑）。
 * 退出码：0 解析并改动成功 / 1 不能处理（表单不完整、id 不存在、本来就已是维护者）/ 2 用法错误。
 */

import fs from 'node:fs';

import { addMaintainer } from './claim.mjs';
import { loadRegistry, loadEntryFile } from './lib/data.mjs';
import { parseEntryId } from './lib/registry.mjs';

/** 表单里的标签（改模板时**必须同步改这里**，否则解析不到） */
const LABEL_ID = '词条 id';
const LABEL_USER = 'GitHub 用户名';

/** 从 Issue Forms 渲染出的正文里取某个标签的值 */
export function fieldFromBody(body, label) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const re = new RegExp(`^###\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$\\n+([\\s\\S]*?)(?=\\n###\\s|$)`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const value = m[1].trim();
  // 表单未填时 GitHub 会写 `_No response_`
  return /^_No response_$/i.test(value) ? '' : value;
}

function emit(pairs) {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
}

function main(argv) {
  let body = process.env.ISSUE_BODY ?? '';
  const fileArg = argv.indexOf('--body-file');
  if (fileArg >= 0) {
    const p = argv[fileArg + 1];
    if (!p) {
      process.stderr.write('--body-file 后面要给路径\n');
      return 2;
    }
    body = fs.readFileSync(p, 'utf8');
  }
  if (!body.trim()) {
    process.stderr.write('没有拿到 Issue 正文：请设 ISSUE_BODY 或用 --body-file\n');
    return 2;
  }

  const rawId = fieldFromBody(body, LABEL_ID).split('\n')[0].trim();
  const username = fieldFromBody(body, LABEL_USER).split('\n')[0].trim();
  const id = rawId.replace(/^`|`$/g, '').trim();

  if (!id || !username) {
    process.stderr.write(`表单不完整：id=\`${id}\` user=\`${username}\`\n`);
    emit({ ok: 'false', reason: 'incomplete' });
    return 1;
  }
  const parsed = parseEntryId(id);
  if (!parsed) {
    process.stderr.write(`词条 id 形状不对：\`${id}\`\n`);
    emit({ ok: 'false', id, user: username, reason: 'bad-id' });
    return 1;
  }

  const registry = loadRegistry();
  if (!(registry.data.entries ?? []).some((e) => `${e.kind}/${e.n}` === parsed.id)) {
    process.stderr.write(`${parsed.id} 不在 registry 里\n`);
    emit({ ok: 'false', id: parsed.id, user: username, reason: 'unknown-entry' });
    return 1;
  }

  const entry = loadEntryFile(parsed.kind, parsed.n);
  const before = fs.readFileSync(entry.path, 'utf8');
  const result = addMaintainer(before, username);
  if (!result.changed) {
    process.stderr.write(result.how === 'already' ? `${username} 已经是 ${parsed.id} 的维护者\n` : '无法识别 front-matter\n');
    emit({ ok: 'false', id: parsed.id, user: username, reason: result.how === 'already' ? 'already' : 'no-frontmatter' });
    return 1;
  }
  fs.writeFileSync(entry.path, result.text);
  process.stdout.write(`已把 ${username} 加进 ${parsed.id} 的 maintainers（${result.how}）\n`);
  emit({ ok: 'true', id: parsed.id, user: username, kind: parsed.kind, n: parsed.n, path: `data/${parsed.kind}/${parsed.n}.md` });
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('claim-from-issue.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
