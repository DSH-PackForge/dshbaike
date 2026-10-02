/**
 * util.mjs —— 路径定位、确定性排序、原子写、纯函数小工具。
 *
 * 硬约束（docs/10 §2）：Node 22 / ESM / 零第三方依赖 / 以仓库根为基准 /
 * Windows 上也能跑（路径一律走 node:path，只有 URL 里才出现 `/`）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（scripts/lib/ 往上两级），不依赖调用时的 cwd */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 以仓库根为基准解析路径 */
export function fromRoot(...parts) {
  return path.resolve(REPO_ROOT, ...parts);
}

/** 校验器/构建器共用的相对路径显示（统一成 `/`，跨平台） */
export function displayPath(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/* ------------------------------------------------------------------ */
/* 文件系统                                                            */
/* ------------------------------------------------------------------ */

export function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

export function readTextIfExists(absPath) {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function exists(absPath) {
  return fs.existsSync(absPath);
}

export function listFiles(dir, options = {}) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, options));
    } else if (entry.isFile()) {
      if (!options.ext || full.endsWith(options.ext)) out.push(full);
    }
  }
  return out;
}

/** 写文件（自动建目录），内容按 utf8 原样写出，不改一个字节 */
export function writeFile(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return absPath;
}

/** 原子写：先写 .tmp 再 rename，避免中途失败留下半截文件 */
export function writeFileAtomic(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, absPath);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 清理失败就算了 */
    }
    throw error;
  }
  return absPath;
}

/** 删空目录（自下而上），返回被删掉的目录数 */
export function pruneEmptyDirs(dir, stopAt) {
  if (!exists(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    removed += pruneEmptyDirs(full, stopAt);
    if (path.resolve(full) === path.resolve(stopAt)) continue;
    if (fs.readdirSync(full).length === 0) {
      fs.rmdirSync(full);
      removed += 1;
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* 确定性排序（docs/10 §6 末尾）                                        */
/* ------------------------------------------------------------------ */

const COLLATOR = new Intl.Collator('zh');

/** 字符串按 localeCompare('zh') 排序（永远返回新数组） */
export function sortStrings(list) {
  return [...list].sort((a, b) => COLLATOR.compare(a, b));
}

/** 按某个字符串键排序 */
export function sortBy(list, pick) {
  return [...list].sort((a, b) => COLLATOR.compare(String(pick(a) ?? ''), String(pick(b) ?? '')));
}

/** 数字 id 升序（`<kind>/<n>` 或纯数字） */
export function sortByNumericId(list, pick = (x) => x) {
  return [...list].sort((a, b) => numericId(pick(a)) - numericId(pick(b)));
}

/** 从 `plugin/12` 或 12 里取出数字 */
export function numericId(value) {
  if (typeof value === 'number') return value;
  const m = /(\d+)\s*$/.exec(String(value ?? ''));
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** 对象字面量按 key 排序重建（保证 JSON.stringify 的字节序稳定） */
export function sortObjectKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

/** 递归按键排序（数组顺序保持不变；调用方负责数组自身的排序） */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** 统一的 JSON 输出（2 空格缩进 + 结尾换行 + 稳定键序） */
export function toJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* 值工具                                                              */
/* ------------------------------------------------------------------ */

/** docs/02 §7：空字符串与空数组一律视为缺失 */
export function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** 取“第一个非缺失值” */
export function firstPresent(...values) {
  for (const value of values) if (!isMissing(value)) return value;
  return null;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 本地日期 YYYY-MM-DD（不用 toISOString，避免时区把日期拨前/拨后一天） */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 题名规整：用于 id / 锚点 / 键 */
export function slugify(text) {
  return Array.from(String(text))
    .filter((ch) => /[\p{Letter}\p{Number}]/u.test(ch))
    .join('')
    .toLowerCase();
}

/** 去掉 HTML 标签并还原常见实体（用于从渲染结果里取纯文本） */
export function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 稳定的字符串比较（用于非中文环境下的排序兜底） */
export function compareStrings(a, b) {
  return COLLATOR.compare(String(a ?? ''), String(b ?? ''));
}

/** 排序键：turn `plugin/12` → ['plugin', 12] */
export function compareIds(a, b) {
  const [ka, na] = String(a ?? '').split('/');
  const [kb, nb] = String(b ?? '').split('/');
  if (ka !== kb) return compareStrings(ka, kb);
  return (Number(na) || 0) - (Number(nb) || 0);
}

/** 解析 `kind/n`；非法返回 null */
export function parseEntryId(value) {
  if (typeof value !== 'string') return null;
  const m = /^([a-z]+)\/(\d+)$/.exec(value.trim());
  if (!m) return null;
  return { kind: m[1], n: Number(m[2]), id: `${m[1]}/${m[2]}` };
}

/**
 * 词条类型（docs/12 §1）：**一个分区一种类型** + 三个跨分区类型。
 * 顺序即 UI 展示顺序（分区按装配位置从界面到规范，跨分区的排最后）。
 * 新增类型必须同时改：本表、data/registry.yml 的 counters、data/taxonomy.yml、
 * scripts/lib/fields.mjs 的字段契约、web/pedia.js 的 KIND_ZH / KIND_ORDER、docs/02 §3。
 */
export const ENTRY_KINDS = [
  // 分区类型（与 data/zones/*.yml 的 kinds 一一对应）
  'client',
  'launcher',
  'plugin',
  'theme',
  'asset',
  'skill',
  'preset',
  'recipe',
  'pack',
  'tool',
  'spec',
  // 跨分区：阅读材料与外部渠道
  'concept',
  'tutorial',
  'source',
];

/* ------------------------------------------------------------------ */
/* GitHub 用户名（贡献系统的署名契约，docs/14）                          */
/* ------------------------------------------------------------------ */

/**
 * GitHub 官方规则：只允许字母数字与**单个**连字符，不能以连字符开头或结尾，最长 39 位。
 * 正则里 `-(?=[A-Za-z0-9])` 同时挡掉了连续连字符与结尾连字符。
 */
export const GITHUB_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** 去掉首尾空白与前面的 @（有人会顺手写 @name） */
export function normalizeUsername(value) {
  return String(value ?? '').trim().replace(/^@+/, '');
}

export function isValidUsername(value) {
  return GITHUB_USERNAME_RE.test(normalizeUsername(value));
}

/** 只做形状检查；账号是否真的存在由 apply-issue.mjs 查 API 确认 */
export function usernameProblem(value) {
  const name = normalizeUsername(value);
  if (!name) return '缺少 GitHub 用户名';
  if (name.length > 39) return 'GitHub 用户名最长 39 位';
  if (!GITHUB_USERNAME_RE.test(name)) return `\`${name}\` 不是合法的 GitHub 用户名（只允许字母数字与单个连字符，且不能以连字符开头/结尾）`;
  return null;
}

export function isEntryKind(kind) {
  return ENTRY_KINDS.includes(kind);
}
