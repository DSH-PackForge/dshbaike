/**
 * registry.mjs —— 读写 data/registry.yml 与号码分配。
 *
 * 铁律（docs/02 §2、docs/10 §3）：
 *   - 每个 kind 独立自增编号，**墓碑号（status: deleted）永不复用**；
 *   - 只有 `new.mjs` 会改 `counters`，手改由 `validate.mjs` 拒绝；
 *   - 写入保持原文件的既有排版：只重写 `counters:` 块、只向 `entries:` 追加一项，
 *     其余字节原样保留（避免顺手重排整个文件）。
 */

import { ENTRY_KINDS, displayPath, fromRoot, parseEntryId, readText, todayLocal, writeFileAtomic, exists } from './util.mjs';
import { loadRegistry } from './data.mjs';
import { SchemaError, stringifyYaml } from './yaml.mjs';
import path from 'node:path';

const REGISTRY_PATH = fromRoot('data', 'registry.yml');
const ENTRY_STATUSES = ['published', 'draft', 'archived', 'deleted'];

export { REGISTRY_PATH, ENTRY_STATUSES, ENTRY_KINDS };

/** registry 条目表 → 以 `kind/n` 为键的索引 */
export function indexRegistry(data) {
  const byId = new Map();
  for (const entry of data.entries ?? []) {
    const kind = entry.kind;
    const n = Number(entry.n);
    if (!kind || !Number.isFinite(n)) continue;
    byId.set(`${kind}/${n}`, { ...entry, kind, n });
  }
  return byId;
}

/** 某 kind 的已分配号（含墓碑） */
export function allocatedNumbers(data, kind) {
  return (data.entries ?? [])
    .filter((e) => e.kind === kind && Number.isFinite(Number(e.n)))
    .map((e) => Number(e.n));
}

/**
 * 取下一个空闲号。
 * 取 max(counters[kind], 已分配最大号) + 1 —— 这样即使 counters 被人手改小，
 * 也绝不会撞上已经用掉的号（含墓碑）。
 */
export function nextNumber(data, kind) {
  if (!ENTRY_KINDS.includes(kind)) {
    throw new SchemaError(`未知的词条类型 \`${kind}\`，只能是 ${ENTRY_KINDS.join(' | ')}`, {
      file: displayPath(REGISTRY_PATH),
      line: 1,
    });
  }
  const counter = Number(data.counters?.[kind] ?? 0) || 0;
  const maxAllocated = allocatedNumbers(data, kind).reduce((a, b) => Math.max(a, b), 0);
  return Math.max(counter, maxAllocated) + 1;
}

/** 号码是否是可用的（未被占用、也不是墓碑） */
export function isNumberFree(data, kind, n) {
  return !allocatedNumbers(data, kind).includes(Number(n));
}

/* ------------------------------------------------------------------ */
/* 写回（保留排版）                                                     */
/* ------------------------------------------------------------------ */

function findBlockRange(lines, key) {
  const head = `^${key}:[ \\t]*(#.*)?$`;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(head).test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') break;
    if (/^[^\s#]/.test(line)) break; // 回到顶层
    end += 1;
  }
  return { start, end };
}

function quoteScalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9\u4e00-\u9fff._@/-]+$/.test(text) && !/^(true|false|null|~|\d+)$/i.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  return JSON.stringify(text);
}

/**
 * 把新的 counters / entries 写回 registry.yml。
 * 策略：`counters:` 块按原格式逐行更新（新增的 kind 追加在后面），
 *      `entries:` 块尾部追加新条目；未涉及的行一个字节都不动。
 */
export function saveRegistry(originalText, data, additions = []) {
  const text = originalText ?? '';
  if (text.trim() === '') {
    // 没有原文件（例如 M1 期间 data/ 还没建）：整份写出来
    return stringifyYaml({
      version: data.version ?? 1,
      counters: data.counters,
      entries: data.entries,
    });
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // 1) counters
  const counters = data.counters ?? {};
  const range = findBlockRange(lines, 'counters');
  if (range) {
    const blockLines = lines.slice(range.start + 1, range.end);
    const seen = new Set();
    const rewritten = [];
    for (const line of blockLines) {
      const m = /^(\s+)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!m) {
        rewritten.push(line);
        continue;
      }
      const [, pad, key, rest] = m;
      const comment = /#.*$/.exec(rest);
      seen.add(key);
      if (key in counters) {
        const tail = comment ? `  ${comment[0]}` : '';
        rewritten.push(`${pad}${key}: ${counters[key]}${tail}`);
      } else {
        rewritten.push(line); // 不该发生：保留原样，validate 会报
      }
    }
    for (const key of Object.keys(counters)) {
      if (seen.has(key)) continue;
      rewritten.push(`  ${key}: ${counters[key]}`);
    }
    // 保持注释行位置：把注释行留在最后
    lines.splice(range.start + 1, range.end - range.start - 1, ...rewritten);
  } else {
    const insertAt = lines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    const block = ['counters:', ...Object.keys(counters).map((k) => `  ${k}: ${counters[k]}`)];
    lines.splice(insertAt === -1 ? lines.length : insertAt + 1, 0, ...block);
  }

  // 2) entries：只追加新条目
  if (additions.length > 0) {
    const entriesRange = findBlockRange(lines, 'entries');
    const rendered = additions.map((entry) => {
      const parts = [
        `  - n: ${entry.n}`,
        `    kind: ${quoteScalar(entry.kind)}`,
        `    title: ${quoteScalar(entry.title)}`,
        `    createdAt: ${quoteScalar(entry.createdAt)}`,
        `    status: ${quoteScalar(entry.status)}`,
      ];
      return parts.join('\n');
    });
    if (entriesRange) {
      lines.splice(entriesRange.end, 0, ...rendered.join('\n').split('\n'));
    } else {
      lines.push('entries:', ...rendered.join('\n').split('\n'));
    }
  }

  const out = lines.join('\n');
  return out.endsWith('\n') ? out.replace(/\n/g, eol) : `${out}${eol}`;
}

/**
 * 分配号码并把新条目写进 registry.yml。
 * @param {{kind: string, title: string, now?: string}} options
 * @returns {{ n: number, entryPath: string, registryPath: string }}
 */
export function allocate(options) {
  const { kind, title } = options;
  const registry = loadRegistry();
  const data = registry.data;
  const n = nextNumber(data, kind);
  const createdAt = options.now ?? todayLocal();

  const entry = { n, kind, title, createdAt, status: 'draft' };
  const counters = { ...(data.counters ?? {}) };
  counters[kind] = Math.max(Number(counters[kind] ?? 0) || 0, n);
  const nextData = { ...data, counters };

  const originalText = exists(REGISTRY_PATH) ? readText(REGISTRY_PATH) : '';
  const updated = saveRegistry(originalText, nextData, [entry]);
  writeFileAtomic(REGISTRY_PATH, updated);
  return { n, kind, entry, entryPath: path.join('data', kind, `${n}.md`), registryPath: displayPath(REGISTRY_PATH) };
}

/** 校验 registry 自身的结构（供 validate.mjs 复用） */
export function registryProblems(data) {
  const problems = [];
  const seen = new Map();
  for (const entry of data.entries ?? []) {
    const key = `${entry.kind}/${entry.n}`;
    if (seen.has(key)) problems.push({ path: key, message: `registry 里 ${key} 出现了两次` });
    seen.set(key, entry);
    if (!ENTRY_KINDS.includes(entry.kind)) {
      problems.push({ path: key, message: `registry 里的 kind \`${entry.kind}\` 不是合法类型` });
    }
    if (!Number.isFinite(Number(entry.n)) || Number(entry.n) <= 0) {
      problems.push({ path: key, message: `registry 里的 n（${entry.n}）必须是正整数` });
    }
    if (entry.status && !ENTRY_STATUSES.includes(entry.status)) {
      problems.push({ path: key, message: `registry 里的 status \`${entry.status}\` 不合法` });
    }
  }
  for (const [kind, counter] of Object.entries(data.counters ?? {})) {
    const maxAllocated = allocatedNumbers(data, kind).reduce((a, b) => Math.max(a, b), 0);
    if (Number(counter) < maxAllocated) {
      problems.push({
        path: `counters.${kind}`,
        message: `counters.${kind} = ${counter} 小于已分配的最大号 ${maxAllocated}（断号不回填，但计数器不能倒退）`,
      });
    }
  }
  return problems;
}

export { parseEntryId };
