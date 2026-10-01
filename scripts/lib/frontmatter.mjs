/**
 * frontmatter.mjs —— 切分 `---` front-matter 与 Markdown 正文。
 *
 * 契约（docs/02 §3）：YAML front-matter + Markdown 正文，`---` 分界。
 * 解析失败一律抛 SchemaError（文件名 + 行号）。
 */

import { parseYamlWithLines, SchemaError } from './yaml.mjs';

const DELIM = /^---[ \t]*$/;

/**
 * 切分 front-matter。
 * @param {string} raw 文件全文
 * @param {{file?: string}} [options]
 * @returns {{ data: any, body: string, bodyStartLine: number, lines: Map<string, number>, hasFrontMatter: boolean, frontMatterRaw: string }}
 */
export function splitFrontMatter(raw, options = {}) {
  const file = options.file ?? '<front-matter>';
  const text = String(raw).replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\r|\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (DELIM.test(lines[i])) start = i;
    break;
  }

  if (start === -1) {
    throw new SchemaError('文件必须以 `---` 开头的 YAML front-matter 起手（第一行非空内容不是 `---`）', {
      file,
      line: 1,
      snippet: lines[0] ?? '',
    });
  }

  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (DELIM.test(lines[i])) {
      end = i;
      break;
    }
    // 顶层出现第二个 `---` 之前若遇到 `...` 也算结束
    if (lines[i].trim() === '...') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new SchemaError('front-matter 只有开头的 `---`，没有结尾的 `---`（正文会被整个当成 YAML 解析）', {
      file,
      line: start + 1,
      snippet: lines[start],
    });
  }

  const fmRaw = lines.slice(start + 1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');

  let parsed;
  try {
    parsed = parseYamlWithLines(fmRaw, { file });
  } catch (error) {
    if (error instanceof SchemaError) {
      // yaml.mjs 的行号是相对 front-matter 的，需要加上偏移
      throw new SchemaError(error.detail ?? error.message, {
        file,
        line: (error.line ?? 1) + start + 1,
        snippet: error.snippet,
      });
    }
    throw error;
  }

  // 行号同样加上偏移，变成相对整个文件的行号
  const shifted = new Map();
  for (const [key, lineNo] of parsed.lines) shifted.set(key, lineNo + start + 1);

  const data = parsed.data;
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new SchemaError('front-matter 的顶层必须是一组 `键: 值`，不能是序列或标量', {
      file,
      line: start + 1,
    });
  }

  return {
    data: data ?? {},
    body,
    bodyStartLine: end + 2,
    lines: shifted,
    hasFrontMatter: true,
    frontMatterRaw: fmRaw,
  };
}

/** 生成 front-matter + 正文（供 new.mjs 写骨架） */
export function joinFrontMatter(frontMatterText, body) {
  const fm = String(frontMatterText).replace(/\n+$/, '');
  const text = String(body).replace(/^\n+/, '');
  return `---\n${fm}\n---\n\n${text}`;
}
