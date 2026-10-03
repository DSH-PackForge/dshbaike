#!/usr/bin/env node
/**
 * validate.mjs —— 校验 data/**（docs/02 §9 的 23 条规则；docs/10 §9 要求 6 / 23 必须是 error）。
 *
 * 用法：
 *   node scripts/validate.mjs                 # 校验整棵 data/ 树
 *   node scripts/validate.mjs <文件…>          # 只校验给定文件（跨文件检查仍取全量数据）
 *
 * 退出码：有 error → 1；只有 warn → 0；用法错误 → 2。
 * 末尾固定打印一行 `N errors, M warnings`。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  DATA_DIR,
  loadCollected,
  loadCollectedPacks,
  loadEntities,
  loadRegistry,
  loadSourceConfigs,
  loadSources,
  loadTaxonomy,
  loadZoneFiles,
} from './lib/data.mjs';
import { splitFrontMatter } from './lib/frontmatter.mjs';
import { isMissing, displayPath, fromRoot, exists, parseEntryId, readText, todayLocal } from './lib/util.mjs';
import { SchemaError } from './lib/yaml.mjs';
import { EXPECTED_FIELDS, OPTIONAL_FIELDS } from './lib/fields.mjs';
import { registryProblems, ENTRY_STATUSES, ENTRY_KINDS } from './lib/registry.mjs';

const USAGE = `用法：node scripts/validate.mjs [文件…]

  不带参数   校验整棵 data/ 树
  带文件参数  只校验这些文件（跨文件检查仍读全量 data/）

退出码：有 error → 1，只有 warn → 0。`;

/* ------------------------------------------------------------------ */
/* 诊断收集                                                            */
/* ------------------------------------------------------------------ */

class Reporter {
  constructor() {
    this.items = [];
    this.seen = new Set();
  }

  add(level, file, line, rule, message, hint) {
    const key = `${level}|${file}|${line ?? ''}|${rule}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ level, file, line: line ?? null, rule, message, hint: hint ?? null });
  }

  error(file, line, rule, message, hint) {
    this.add('error', file, line, rule, message, hint);
  }

  warn(file, line, rule, message, hint) {
    this.add('warn', file, line, rule, message, hint);
  }

  get errors() {
    return this.items.filter((i) => i.level === 'error');
  }

  get warnings() {
    return this.items.filter((i) => i.level === 'warn');
  }

  print(out = process.stdout) {
    const sorted = [...this.items].sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
      if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
      return a.message < b.message ? -1 : 1;
    });
    for (const item of sorted) {
      const loc = item.line ? `${item.file}:${item.line}` : item.file;
      const tag = item.level === 'error' ? 'error' : 'warn ';
      out.write(`${tag} [规则 ${item.rule}] ${loc} — ${item.message}\n`);
      if (item.hint) out.write(`                                ↳ ${item.hint}\n`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 行号定位                                                            */
/* ------------------------------------------------------------------ */

function lineOf(lines, keyPath) {
  if (!lines) return null;
  if (typeof keyPath === 'number') return lines.get(String(keyPath)) ?? null;
  const key = String(keyPath);
  if (lines.has(key)) return lines.get(key);
  // 回退到最长已知前缀（`plugins.0.name` → `plugins.0` → `plugins`）
  const parts = key.split('.');
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const prefix = parts.slice(0, i).join('.');
    if (lines.has(prefix)) return lines.get(prefix);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 枚举与常量                                                          */
/* ------------------------------------------------------------------ */

const ENUMS = {
  status: ENTRY_STATUSES,
  difficulty: ['beginner', 'intermediate', 'advanced'],
  origin: ['original', 'external'],
  layer: ['runtime', 'plugin', 'agent', 'workspace', 'ecosystem'],
  role: ['bundle', 'client', 'bundle+client', 'theme', 'compat'],
  packType: ['profile', 'dshhome'],
  // editorial = 四条机械门槛都不满足时的**特殊途径**：编辑明确决定收录，并必须写明理由
  entryGate: ['official', 'tutorial', 'pack', 'maintainer', 'editorial'],
  sourceKind: ['plugin-directory', 'guide', 'market', 'registry', 'spec', 'tool', 'topic'],
  relation: ['complementary', 'overlapping', 'upstream'],
  relationType: ['requires', 'recommends', 'conflicts', 'replaces', 'integrates'],
  roleType: ['owner', 'maintainer', 'contributor', 'translator', 'upstream'],
  risk: ['desktop-control', 'network', 'credentials', 'build-script'],
  /** 分区条目的来源徽章（docs/02 §1.3）。注意：**分区级**的 dataSource 已废弃（docs/07） */
  sourceBadge: ['awesome', 'market', 'launchers', 'specs', 'curated'],
  /** 规范文件状态：historical 是「被新版取代但仍可读」，不是 deprecated（那份还有效、只是旧） */
  specStatus: ['current', 'historical', 'draft', 'deprecated'],
  /** 配方落点层：写进 profile 目录里的 patch 文件算 userspace */
  targetLayer: ['project', 'userspace', 'machine'],
  /** 配方形态 */
  recipeKind: ['config', 'snippet', 'instructions'],
  /** 形态：client 用 desktop/tui/web/cli/ide，tool 用 cli/app/library/service */
  form: ['desktop', 'tui', 'web', 'cli', 'ide', 'app', 'library', 'service'],
  /** MCP 接入的传输方式（docs/12 §1）：与 dsh-mcp-client 的配置项一致 */
  transport: ['stdio', 'streamable-http', 'both'],
};

/** 只有形如「实测 / 未核实」的口径词才算声明过适用性（规则 11 / 16） */
const CALIBER = /实测|未核实|已核实|未测试|未验证/;

/** 插件引用块里禁止出现的空泛理由（规则 9） */
const BANNED_WHY = ['很好用', '很强大', '非常强大', '牛逼', '神器', 'yyds', '好用', '强烈推荐', '必备'];

/**
 * 官方组织（规则 15 的 `official` 门槛）：repo owner 或 npm scope 落在这里就属「官方来源」，
 * 天然配得上插件区的一页。名单写死、可核实、不易被绕过——比「有人认领」更客观。
 */
const OFFICIAL_OWNERS = new Set(['deepseek-ai']);

/** zone 文件的通用键（不在 `itemFields` 白名单里的额外键就是规则 23 的 error） */
const ZONE_KEYS = new Set([
  'zone',
  'title',
  'desc',
  'kinds',
  'sections',
  'howto',
  'links',
  'itemFields',
  'snapshot',
  'items',
  'updatedAt',
]);

/** 分区条目的通用卡片键（docs/06 §4） */
const ITEM_KEYS = new Set([
  'name',
  'blurb',
  'section',
  'source',
  'links',
  'entry',
  'completeness',
  'tags',
  'version',
  'updatedAt',
  'risk',
]);

const BODY_MIN_LENGTH = 120; // 规则 14（warn）
const WHY_MIN_LENGTH = 8; // 规则 9

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const targets = argv.filter((a) => !a.startsWith('-'));
  const unknownFlags = argv.filter((a) => a.startsWith('-') && a !== '--help' && a !== '-h');
  if (unknownFlags.length) {
    process.stderr.write(`不认识的选项：${unknownFlags.join(' ')}\n\n${USAGE}\n`);
    return 2;
  }

  const reporter = new Reporter();
  const ctx = loadContext(reporter);

  for (const target of targets) {
    if (!exists(target)) {
      reporter.error(target, null, 0, '指定的文件不存在');
    }
  }

  checkTaxonomy(ctx, reporter);
  if (targets.length === 0) {
    checkRegistry(ctx, reporter);
    checkEntries(ctx, reporter, null);
    checkZones(ctx, reporter, null);
    checkZoneKinds(ctx, reporter);
    checkZoneSections(ctx, reporter);
    checkZoneOrder(ctx, reporter);
    checkLinkShapes(ctx, reporter);
    checkSourcesConfig(ctx, reporter);
  } else {
    // 只校验给定文件：跨文件检查仍用全量数据
    const abs = targets.map((t) => path.resolve(t));
    const entryTargets = abs.filter((p) => /[\\/]data[\\/][a-z]+[\\/]\d+\.md$/.test(p) || ctx.entryByPath.has(p));
    const zoneTargets = abs.filter((p) => ctx.zoneByPath.has(p));
    const registryTarget = abs.some((p) => path.resolve(ctx.registry.path) === p);
    const known = new Set([...entryTargets, ...zoneTargets, ...(registryTarget ? [ctx.registry.path] : [])]);
    for (const p of abs) {
      if (!known.has(p)) {
        reporter.warn(displayPath(p), null, 0, '这个文件不在已知的事实源清单里（不是词条 / 分区 / registry），已跳过');
      }
    }
    checkRegistry(ctx, reporter, registryTarget || entryTargets.length > 0);
    checkEntries(ctx, reporter, entryTargets.length ? entryTargets : null);
    checkZones(ctx, reporter, zoneTargets.length ? zoneTargets : null);
    checkZoneKinds(ctx, reporter);
    checkZoneSections(ctx, reporter);
    checkZoneOrder(ctx, reporter);
    checkSourcesConfig(ctx, reporter);
  }

  reporter.print();
  process.stdout.write(`${reporter.errors.length} errors, ${reporter.warnings.length} warnings\n`);
  return reporter.errors.length > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 加载上下文                                                          */
/* ------------------------------------------------------------------ */

function loadContext(reporter) {
  const registry = loadRegistry();
  const taxonomy = loadTaxonomy();
  const sources = loadSources();
  const entities = loadEntities();
  const zones = loadZoneFiles();
  const sourceConfigs = loadSourceConfigs();
  const collected = loadCollected();

  const entryByN = new Map();
  for (const entry of registry.data.entries ?? []) {
    if (entry.kind && Number.isFinite(Number(entry.n))) {
      entryByN.set(`${entry.kind}/${Number(entry.n)}`, entry);
    }
  }

  // 扫描 data/<kind>/*.md
  const entryFiles = [];
  for (const kind of ENTRY_KINDS) {
    const dir = path.join(DATA_DIR, kind);
    if (!exists(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (!fs.statSync(abs).isFile()) continue;
      if (!name.endsWith('.md')) {
        reporter.warn(displayPath(abs), null, 1, `data/${kind}/ 下出现了非 .md 文件，已忽略`);
        continue;
      }
      const base = name.slice(0, -3);
      if (!/^\d+$/.test(base)) {
        reporter.error(displayPath(abs), null, 1, `文件名的编号部分必须是纯数字（现在是 \`${base}\`）`, '路径契约是 data/<kind>/<n>.md');
        continue;
      }
      entryFiles.push({ kind, n: Number(base), abs, file: displayPath(abs) });
    }
  }
  entryFiles.sort((a, b) => (a.kind === b.kind ? a.n - b.n : a.kind < b.kind ? -1 : 1));

  // 解析每个词条的 front-matter
  const entries = [];
  for (const item of entryFiles) {
    const raw = readText(item.abs);
    let parsed = null;
    try {
      parsed = splitFrontMatter(raw, { file: item.file });
    } catch (error) {
      reporter.error(
        item.file,
        error instanceof SchemaError ? error.line : null,
        5,
        error instanceof SchemaError ? error.detail : `front-matter 解析失败：${error.message}`,
      );
      entries.push({ ...item, data: null, body: '', lines: new Map(), parseFailed: true });
      continue;
    }
    entries.push({ ...item, data: parsed.data, body: parsed.body, lines: parsed.lines, bodyStartLine: parsed.bodyStartLine });
  }

  const byId = new Map();
  for (const entry of entries) byId.set(`${entry.kind}/${entry.n}`, entry);

  // data/registry.yml 的原始文本（行号用）
  const registryText = exists(path.join(DATA_DIR, 'registry.yml')) ? readText(path.join(DATA_DIR, 'registry.yml')) : null;

  const zoneByPath = new Map();
  for (const zone of zones) zoneByPath.set(path.resolve(zone.path), zone);

  const entryByPath = new Map();
  for (const entry of entries) entryByPath.set(path.resolve(entry.abs), entry);

  return {
    registry,
    registryText,
    taxonomy,
    taxonomyLeaves: collectTaxonomyLeaves(taxonomy?.data),
    sources,
    entities,
    zones,
    sourceConfigs,
    collected,
    entryByN,
    byId,
    entries,
    zoneByPath,
    entryByPath,
  };
}

/* ------------------------------------------------------------------ */
/* taxonomy                                                            */
/* ------------------------------------------------------------------ */

/**
 * 分类树节点 id。允许两种写法：
 * - 全限定：`id: concept.runtime`（data/taxonomy.yml 现行写法）
 * - 相对：`id: runtime`，由父级补上前缀
 * 之前这里无条件补前缀，导致全限定写法被拼成 `concept.concept.runtime`，
 * 于是「明明在树里」的 category 被判成不在树里（规则 6 误报）。
 */
function taxonomyNodeId(prefix, localId) {
  const explicit = String(localId);
  if (!prefix) return explicit;
  return explicit.includes('.') ? explicit : `${prefix}.${explicit}`;
}

/** 递归收集 taxonomy 节点：id → { node, path, deprecated, hasChildren, line } */
function collectTaxonomyLeaves(data) {
  const map = new Map();
  const walk = (nodes, prefix) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const localId = node.id ?? node.key ?? node.name;
      if (!localId) continue;
      const id = taxonomyNodeId(prefix, localId);
      const children = node.children ?? node.nodes ?? [];
      map.set(id, {
        node,
        id,
        hasChildren: Array.isArray(children) && children.length > 0,
        deprecated: node.status === 'deprecated' || node.deprecated === true,
      });
      if (Array.isArray(children) && children.length) walk(children, id);
    }
  };
  const roots = Array.isArray(data) ? data : (data?.tree ?? data?.nodes ?? []);
  walk(roots, '');
  return map;
}

function checkTaxonomy(ctx, reporter) {
  const taxonomy = ctx.taxonomy;
  if (!taxonomy) {
    reporter.warn('data/taxonomy.yml', null, 6, '没有 taxonomy.yml，category 的叶子校验无法进行（规则 6 形同虚设）');
    return;
  }
  const walk = (nodes, prefix, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const [i, node] of nodes.entries()) {
      const line = lineOf(taxonomy.lines, `${prefix ? `${prefix}.` : ''}${i}`);
      const localId = node?.id ?? node?.key ?? node?.name;
      const id = localId ? taxonomyNodeId(prefix, localId) : String(localId);
      if (!localId) {
        reporter.error(taxonomy.file, line, 6, `taxonomy 第 ${i + 1} 个节点缺少 id / key`);
        continue;
      }
      if (isMissing(node.label?.zh) && isMissing(node.label)) {
        reporter.warn(taxonomy.file, line, 6, `taxonomy 节点 \`${id}\` 没有 label.zh`);
      }
      if (isMissing(node.desc)) {
        reporter.warn(taxonomy.file, line, 6, `taxonomy 节点 \`${id}\` 没有 desc（docs/02 §4 要求必填）`);
      }
      const children = node.children ?? node.nodes;
      if (depth >= 3 && Array.isArray(children) && children.length) {
        reporter.warn(taxonomy.file, line, 6, `taxonomy 节点 \`${id}\` 层级超过 3 层，叶子校验会变得难以维护`);
      }
      walk(children, id, depth + 1);
    }
  };
  const roots = Array.isArray(taxonomy.data) ? taxonomy.data : (taxonomy.data?.tree ?? taxonomy.data?.nodes ?? []);
  walk(roots, '', 1);
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

function checkRegistry(ctx, reporter, force = false) {
  const registry = ctx.registry;
  const file = registry.file ?? 'data/registry.yml';
  const lines = registry.lines;

  if (!registry.file) {
    reporter.warn(file, null, 3, 'data/registry.yml 不存在；所有编号契约检查都会跳过（领号请走 node scripts/new.mjs）');
    return;
  }

  for (const problem of registryProblems(registry.data)) {
    const line = lineOf(lines, problem.path);
    const isCounter = problem.path.startsWith('counters.');
    reporter.error(file, line, isCounter ? 3 : 2, problem.message);
  }
  if (!force) return;
}

/* ------------------------------------------------------------------ */
/* 词条                                                                */
/* ------------------------------------------------------------------ */

function checkEntries(ctx, reporter, only) {
  const targets = only ?? ctx.entries;
  for (const entry of targets) {
    if (!entry.data) continue; // front-matter 已经报过错
    checkEntry(ctx, reporter, entry);
  }
}

/**
 * `canonicalId` 的全局占用表（规则 25）。
 * 它是生态里认的那个**全局唯一名**（插件 owner.repo / @scope/name、启动器注册表 ID、
 * 整合包市场坐标），所以两条词条不能认领同一个 —— 用模块级 Map 跨词条查重，
 * 顺手把「整合包 bundles 写的官方包名对不上词条坐标」这类问题挡在前面。
 */
const CANONICAL_SEEN = new Map();

function checkEntry(ctx, reporter, entry) {
  const { kind, n, file, data, lines } = entry;
  const id = `${kind}/${n}`;
  const R = (key) => lineOf(lines, key);

  // ---- 规则 1：路径与 kind 匹配（由扫描保证；这里再确认一遍 kind 字段） ----
  if (data.kind != null && String(data.kind) !== kind) {
    reporter.error(file, R('kind'), 1, `front-matter 的 kind \`${data.kind}\` 与所在目录 \`${kind}\` 不一致`);
  }

  // ---- 规则 2 / 4：registry 一致性、墓碑不可覆盖 ----
  const reg = ctx.entryByN.get(id);
  if (!reg) {
    reporter.error(file, null, 2, `${id} 不在 data/registry.yml 里（领号必须走 node scripts/new.mjs ${kind} "…"）`, '手写文件会破坏编号契约');
  } else {
    if (reg.status === 'deleted') {
      // 合法墓碑：registry 与文件都是 deleted —— 页面保留、链接不烂（docs/02 §2 规则 3）。
      // 只有「文件还活着」才说明这个号被复用了。
      const fmStatusForTombstone = data.status == null ? 'published' : String(data.status);
      if (fmStatusForTombstone !== 'deleted') {
        reporter.error(
          file,
          R('status'),
          4,
          `${id} 在 registry 里已经是墓碑（status: deleted），墓碑号永不复用`,
          reg.title ? `墓碑标题：${reg.title}` : null,
        );
      }
    }
    const fmStatus = data.status == null ? 'published' : String(data.status);
    const regStatus = reg.status == null ? 'published' : String(reg.status);
    if (fmStatus !== regStatus) {
      reporter.error(file, R('status'), 2, `status 不一致：front-matter 是 \`${fmStatus}\`，registry 是 \`${regStatus}\``);
    }
    if (reg.title != null && data.title != null && String(reg.title) !== String(data.title)) {
      reporter.warn(file, R('title'), 2, `title 与 registry 不一致：front-matter \`${data.title}\`，registry \`${reg.title}\``, '改了标题记得同步 registry');
    }
  }

  // ---- 规则 5：必填字段 ----
  // `draft` 是「还没写完」的合法状态（new.mjs 生成的骨架就是 draft），
  // 所以「缺类别 / 类别不在树里」这类问题在 draft 下只提示，改成 published 才拦截。
  const isDraft = String(data.status ?? '') === 'draft';
  const incomplete = (line, rule, message, hint) =>
    isDraft
      ? reporter.warn(file, line, rule, `${message}（draft 状态只提示，不拦截）`)
      : reporter.error(file, line, rule, message, hint);

  for (const key of ['title', 'category', 'summary', 'status']) {
    if (isMissing(data[key])) {
      incomplete(R(key), 5, `缺少必填字段 \`${key}\``);
    }
  }
  if (Array.isArray(data.category) && data.category.length === 0) {
    incomplete(R('category'), 5, '`category` 不能是空数组：至少要有一个 taxonomy 叶子节点');
  }
  if (typeof data.category !== 'undefined' && !Array.isArray(data.category)) {
    incomplete(R('category'), 5, '`category` 必须是序列（如 `[plugin.compat]`）');
  }
  if (typeof data.summary === 'string' && data.summary.trim().length < 8 && data.summary.trim().length > 0) {
    reporter.warn(file, R('summary'), 5, `summary 只有 ${data.summary.trim().length} 个字，太短了`);
  }
  if (!isMissing(data.status) && !ENTRY_STATUSES.includes(String(data.status))) {
    reporter.error(file, R('status'), 13, `status \`${data.status}\` 不在允许值里（${ENTRY_STATUSES.join(' | ')}）`);
  }

  // ---- 规则 6：category 必须是 taxonomy 叶子（M1 必须就位，error） ----
  if (Array.isArray(data.category)) {
    for (const [i, cat] of data.category.entries()) {
      const line = R(`category.${i}`) ?? R('category');
      if (typeof cat !== 'string') {
        reporter.error(file, line, 6, `category[${i}] 不是字符串`);
        continue;
      }
      const node = cat.includes('.') ? ctx.taxonomyLeaves.get(cat) : matchLeafShorthand(ctx.taxonomyLeaves, cat);
      if (!node) {
        incomplete(line, 6, `category \`${cat}\` 不在 data/taxonomy.yml 里`, '只能填 taxonomy 的叶子节点 id（点分形式，如 plugin.compat）');
        continue;
      }
      if (node.hasChildren) {
        incomplete(line, 6, `category \`${cat}\` 是 taxonomy 的父节点，不是叶子`, '父节点不能直接当分类用');
      }
      if (node.deprecated) {
        reporter.warn(file, line, 6, `category \`${cat}\` 已被标记 deprecated`);
      }
    }
  }

  // ---- 规则 13：枚举字段 + 截图存在 ----
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (field === 'status' || field === 'risk' || field === 'sourceBadge') continue;
    if (isMissing(data[field])) continue;
    if (!allowed.includes(String(data[field]))) {
      reporter.error(file, R(field), 13, `${field} \`${data[field]}\` 不在允许值里（${allowed.join(' | ')}）`);
    }
  }
  if (!isMissing(data.screenshots)) {
    if (!Array.isArray(data.screenshots)) {
      reporter.error(file, R('screenshots'), 13, '`screenshots` 必须是序列');
    } else {
      for (const [i, shot] of data.screenshots.entries()) {
        if (typeof shot !== 'string') continue;
        const abs = path.join(DATA_DIR, 'assets', shot);
        if (!exists(abs)) {
          reporter.error(file, R(`screenshots.${i}`) ?? R('screenshots'), 13, `截图不存在：data/assets/${shot}`);
        }
      }
    }
  }

  // ---- 规则 8：正文里的 [[kind/n]] 目标必须存在（正文行号按出现位置估算） ----
  const bodyLines = String(entry.body ?? '').split(/\r\n|\r|\n/);
  const bodyLineOf = (needle) => {
    const idx = bodyLines.findIndex((l) => l.includes(needle));
    return idx === -1 ? (entry.bodyStartLine ?? null) : (entry.bodyStartLine ?? 1) + idx;
  };
  const wikilinks = [...String(entry.body ?? '').matchAll(/\[\[([^\]\n]+?)\]\]/g)];
  for (const match of wikilinks) {
    const target = match[1].split('|')[0].trim();
    const line = bodyLineOf(match[0]);
    const parsed = parseEntryId(target);
    if (!parsed) {
      reporter.error(file, line, 8, `[[${target}]] 的形状不对：站内链接必须写成 \`kind/n\``);
      continue;
    }
    const targetEntry = ctx.byId.get(parsed.id);
    if (!targetEntry) {
      reporter.error(file, line, 8, `[[${target}]] 指向的词条不存在（渲染时会变成红链）`, '要么建这一条，要么改掉链接');
    } else if (String(targetEntry.data?.status) === 'deleted') {
      reporter.warn(file, line, 8, `[[${target}]] 指向的词条已撤下（墓碑）`);
    }
  }

  // ---- 规则 12（构建期）/ 明显不支持的外链在正文里就地提示 ----
  for (const match of String(entry.body ?? '').matchAll(/\[[^\]]*\]\(([^)\s]+)/g)) {
    const url = match[1];
    if (!/^(https?:|mailto:|#|\/)/i.test(url)) {
      reporter.warn(file, bodyLineOf(match[0]), 12, `正文里的链接 \`${url}\` 协议不被允许，渲染时会退化成纯文本`);
    }
  }

  // ---- 规则 14：正文长度下限（warn） ----
  // **草稿跳过**：draft 的定义就是"还没写完"，故意留空的占位条目（如 spec/1）每轮构建
  // 都报一条 warn 只是噪声；改成 published 之后这条规则照常生效。
  const bodyText = String(entry.body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (String(data.status ?? '') !== 'draft' && bodyText.length < BODY_MIN_LENGTH) {
    reporter.warn(file, entry.bodyStartLine ?? null, 14, `正文只有 ${bodyText.length} 个字符（下限 ${BODY_MIN_LENGTH}），像空壳词条`);
  }

  // ---- 规则 7：prereq / related 指向的词条必须存在 ----
  for (const field of ['prereq', 'related']) {
    if (isMissing(data[field])) continue;
    if (!Array.isArray(data[field])) {
      reporter.error(file, R(field), 7, `\`${field}\` 必须是序列（形如 [concept/4, tutorial/1]）`);
      continue;
    }
    for (const [i, ref] of data[field].entries()) {
      const line = R(`${field}.${i}`) ?? R(field);
      const parsed = parseEntryId(ref);
      if (!parsed) {
        reporter.error(file, line, 7, `${field}[${i}] \`${ref}\` 的形状不对：必须是 \`kind/n\``);
        continue;
      }
      const target = ctx.byId.get(parsed.id);
      if (!target) {
        reporter.error(file, line, 7, `${field} 指向的 ${parsed.id} 不存在`);
      } else if (String(target.data?.status) === 'deleted') {
        reporter.warn(file, line, 7, `${field} 指向的 ${parsed.id} 已撤下（墓碑）`);
      }
    }
  }

  // ---- 规则 11：appliesTo 必须带口径 ----
  if (kind === 'tutorial' && !isMissing(data.appliesTo)) {
    if (!CALIBER.test(String(data.appliesTo))) {
      reporter.error(file, R('appliesTo'), 11, `appliesTo 里没有「实测 / 未核实」这类口径词：\`${data.appliesTo}\``);
    }
  }

  // ---- 规则 22：archived 必须说明原因（warn） ----
  if (String(data.status) === 'archived' && isMissing(data.archivedNote)) {
    reporter.warn(file, R('status'), 22, 'status: archived 但没写 archivedNote：归档不是垃圾桶，要说清为什么还留着');
  }

  // ---- 规则 9：插件引用块 ----
  const plugins = data.plugins;
  if (!isMissing(plugins)) {
    if (!Array.isArray(plugins)) {
      reporter.error(file, R('plugins'), 9, '`plugins` 必须是序列（每项一个插件引用块）');
    } else {
      for (const [i, block] of plugins.entries()) {
        checkPluginBlock(ctx, reporter, { file, lines, kind, id, block, index: i });
      }
    }
  }

  // ---- 规则 10：origin: external 的必填项 ----
  if (String(data.origin) === 'external') {
    const ext = data.external;
    if (isMissing(ext) || typeof ext !== 'object') {
      reporter.error(file, R('external'), 10, 'origin: external 必须给 `external` 块（url / reviewedAt / verdict）');
    } else {
      for (const key of ['url', 'reviewedAt', 'verdict']) {
        if (isMissing(ext[key])) {
          reporter.error(file, R(`external.${key}`) ?? R('external'), 10, `origin: external 缺少 external.${key}`);
        }
      }
      if (!isMissing(ext.url) && !/^https?:\/\//i.test(String(ext.url))) {
        reporter.error(file, R('external.url'), 10, `external.url 必须是 http(s) 链接：\`${ext.url}\``);
      }
    }
    if (bodyText.length === 0) {
      reporter.error(file, entry.bodyStartLine ?? null, 10, 'origin: external 的词条也必须有正文（写「讲了什么、适合谁、哪里会过时」，不是转载）');
    }
  }

  // ---- 规则 15 / 16：插件词条 ----
  if (kind === 'plugin') {
    checkPluginEntry(ctx, reporter, entry, { id, bodyText });
  }

  // ---- 规则 23：authors（上游作者/团队）----
  // 与 maintainers 语义不同：maintainers 是本馆维护者（也是第一道闸的批准人），
  // authors 是**上游**那个项目是谁做的。只对第三方项目类有意义；
  // concept / tutorial / recipe 是本馆原创，写了就是概念混用，直接报错。
  if (!isMissing(data.authors)) {
    const OWN_TYPES = new Set(['concept', 'tutorial', 'recipe']);
    const AUTHOR_ROLES = new Set(['开发团队', '作者', '维护者', '贡献者', '吉祥物', '发布方']);
    if (OWN_TYPES.has(kind)) {
      reporter.error(file, R('authors'), 23, `${kind} 是本馆原创词条，不该有 \`authors\`（上游作者只用于第三方项目类；本馆署名走贡献者机制）`);
    } else if (!Array.isArray(data.authors) || data.authors.length === 0) {
      reporter.error(file, R('authors'), 23, 'authors 必须是非空数组，每项形如 `- { name, role }`');
    } else {
      data.authors.forEach((a, i) => {
        if (!a || typeof a !== 'object' || Array.isArray(a)) {
          reporter.error(file, R('authors'), 23, `authors[${i}] 必须是 { name, role } 对象`);
          return;
        }
        if (isMissing(a.name)) reporter.error(file, R('authors'), 23, `authors[${i}] 缺 name`);
        if (isMissing(a.role)) {
          reporter.error(file, R('authors'), 23, `authors[${i}] 缺 role（枚举：${[...AUTHOR_ROLES].join(' | ')}）`);
        } else if (!AUTHOR_ROLES.has(String(a.role))) {
          reporter.error(file, R('authors'), 23, `authors[${i}].role 不在枚举里：\`${a.role}\``);
        }
      });
    }
  }

  // ---- 规则 24：bugs（缺陷与踩坑）----
  // 评审明确：插件页那个「插件特性」页签里的"特性"就是 bug（对照 bug.mcmod.cn 的
  // 「MOD特性警示」，供安装前避雷）。所以字段要求能回答「哪个版本、什么状态、凭什么说」：
  //   title 必填；severity ∈ 致命|严重|轻微；status ∈ 已确认|未复现|上游已知|已修复*|未核实；
  //   affects / evidence / note / upstream 可选，upstream 必须是 http(s) 链接。
  // 只对 plugin 开放（跨插件组合的缺陷走独立 bug 词条）。
  if (!isMissing(data.bugs)) {
    const BUG_SEVERITY = new Set(['致命', '严重', '轻微']);
    const BUG_STATUS = new Set(['已确认', '未复现', '上游已知', '未核实']);
    if (kind !== 'plugin') {
      reporter.error(file, R('bugs'), 24, `bugs 只用于 plugin 词条；${kind} 若遇到跨插件组合的缺陷，请另开独立 bug 词条并让相关词条反向引用`);
    } else if (!Array.isArray(data.bugs) || data.bugs.length === 0) {
      reporter.error(file, R('bugs'), 24, 'bugs 必须是非空数组，每项形如 `- { title, severity, affects, status, evidence }`');
    } else {
      data.bugs.forEach((b, i) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}] 必须是对象`);
          return;
        }
        if (isMissing(b.title)) reporter.error(file, R('bugs'), 24, `bugs[${i}] 缺 title（一句话说清是什么缺陷）`);
        if (isMissing(b.severity)) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}] 缺 severity（枚举：${[...BUG_SEVERITY].join(' | ')}）`);
        } else if (!BUG_SEVERITY.has(String(b.severity))) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}].severity 不在枚举里：\`${b.severity}\``);
        }
        if (isMissing(b.status)) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}] 缺 status（枚举：${[...BUG_STATUS].join(' | ')} | 已修复…）`);
        } else {
          const st = String(b.status);
          // 「已修复」允许带版本尾巴（已修复（0.3.6）），其余必须是枚举里的整词
          if (!BUG_STATUS.has(st) && !st.startsWith('已修复')) {
            reporter.error(file, R('bugs'), 24, `bugs[${i}].status 不在枚举里：\`${st}\``);
          }
        }
        if (isMissing(b.affects)) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}] 缺 affects（受影响/起始版本；不确定就写「未核实」）`);
        }
        if (!isMissing(b.upstream) && !/^https?:\/\//i.test(String(b.upstream))) {
          reporter.error(file, R('bugs'), 24, `bugs[${i}].upstream 必须是 http(s) 链接：\`${b.upstream}\``);
        }
      });
    }
  }

  // ---- 规则 25：shortName（简称）与 canonicalId（全局唯一名）----
  // 显示名与身份是两件事：title=中文名、titleEn=英文名、shortName=简称、aliases=俗称；
  // 而 canonicalId 是**生态里认的那个唯一名**，与馆内坐标 id（plugin/2，号不复用）不同。
  if (!isMissing(data.shortName)) {
    const sn = String(data.shortName).trim();
    if (!sn) {
      reporter.error(file, R('shortName'), 25, 'shortName 不能是空白');
    } else if (sn.length > 16) {
      reporter.error(file, R('shortName'), 25, `shortName 太长（${sn.length} 字）；简称应当 ≤ 16 字`, '长名字放 title，简称只用来在标题与卡片上省地方');
    } else if (sn === String(data.title ?? '').trim()) {
      reporter.error(file, R('shortName'), 25, 'shortName 与 title 相同（简称没有意义，且会渲染成 [X]X）', '要么删掉 shortName，要么把它改成真正的简称');
    }
  }
  if (!isMissing(data.canonicalId)) {
    const cid = String(data.canonicalId).trim();
    if (!cid) {
      reporter.error(file, R('canonicalId'), 25, 'canonicalId 不能是空白');
    } else {
      if (/\s/.test(cid)) {
        reporter.error(file, R('canonicalId'), 25, `canonicalId 不能含空格：\`${cid}\``);
      }
      const prev = CANONICAL_SEEN.get(cid);
      if (prev) {
        reporter.error(
          file,
          R('canonicalId'),
          25,
          `canonicalId \`${cid}\` 已被 ${prev} 占用（它必须全局唯一）`,
          '同一个上游包/仓库只能被一条词条认领；合集的词条请留空，不要认领成员的 ID',
        );
      } else {
        CANONICAL_SEEN.set(cid, id);
      }
    }
  }

  // ---- 规则 26：cover（封面，作者可自定义，也允许自定义链接）----
  // 评审：封面要能让作者自己给。**两种写法都支持**：
  //   ① 仓库内 `covers/xxx.png` —— 构建期拷进 web/covers/（走我们缓存、可审计）
  //   ② `https://…` 外链 —— 作者自己托管的图（我们查不到它是否存在，所以只做形态校验）
  // 共同要求：png/jpg/jpeg/webp、**禁 SVG**（会当 og:image 给第三方平台看，SVG 能带脚本）；
  // 外链**必须 https**（http 图片在 https 页面上是混合内容，会被浏览器拦）。
  if (!isMissing(data.cover)) {
    const cov = String(data.cover).trim();
    if (/^https?:\/\//i.test(cov)) {
      if (!/^https:\/\//i.test(cov)) {
        reporter.error(file, R('cover'), 26, `外链封面必须是 https：\`${cov}\``, 'http 图片在 https 页面上是混合内容，会被浏览器拦掉');
      } else if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(cov)) {
        reporter.warn(file, R('cover'), 26, `外链封面看不出是 png/jpg/webp：\`${cov}\``, '确保这个地址直接返回图片（不是网页），否则 og:image 会失效');
      }
    } else {
      const rel = cov.replace(/^\.\//, '').split('\\').join('/');
      if (!/^covers\/[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) {
        reporter.error(file, R('cover'), 26, `cover 要么是仓库内 covers/ 下的文件，要么是 https 外链：\`${cov}\``, '本地图放 covers/（构建期会拷进 web/covers/）；作者自己托管的图请写 https 绝对地址');
      } else if (!/\.(png|jpe?g|webp)$/i.test(rel)) {
        reporter.error(file, R('cover'), 26, `cover 只支持 png / jpg / webp：\`${cov}\``, '禁 SVG：它会被当 og:image 给第三方平台看，而 SVG 能带脚本');
      } else {
        const abs = fromRoot(rel);
        if (!exists(abs)) {
          reporter.error(file, R('cover'), 26, `cover 指向的文件不存在：\`${rel}\``, '把图放进仓库的 covers/ 目录（构建期会拷进 web/covers/）');
        } else {
          const kb = fs.statSync(abs).size / 1024;
          if (kb > 300) {
            reporter.warn(file, R('cover'), 26, `封面 ${Math.round(kb)}KB，偏大（建议 ≤ 300KB）`, '本站不裁不压（零依赖），请作者自己压到合适尺寸再提');
          }
        }
      }
    }
  }
  if (!isMissing(data.coverAlt) && !String(data.coverAlt).trim()) {
    reporter.error(file, R('coverAlt'), 26, 'coverAlt 不能是空白（要么写清替代文字，要么删掉这个字段）');
  }
  if (!isMissing(data.coverLink)) {
    const link = String(data.coverLink).trim();
    if (!/^https:\/\/\S+$/i.test(link)) {
      reporter.error(file, R('coverLink'), 26, `coverLink 必须是 https 链接：\`${link}\``, '封面可点，但目标必须是 https（否则是混合内容）');
    }
  }

  // ---- 字段白名单：未知字段给 warn，避免拼错字段名悄悄丢数据 ----
  const expected = new Set([
    ...(EXPECTED_FIELDS[kind] ?? []),
    ...(OPTIONAL_FIELDS.common ?? []),
    ...(OPTIONAL_FIELDS[kind] ?? []),
  ]);
  for (const key of Object.keys(data)) {
    if (!expected.has(key)) {
      reporter.warn(file, R(key), 5, `字段 \`${key}\` 不在 ${kind} 的契约里（拼错了？）`, '见 docs/02 §3.1 / §3.2');
    }
  }
}

function checkPluginBlock(ctx, reporter, info) {
  const { file, kind, id, block, index } = info;
  const R = (key) => lineOf(info.lines, `plugins.${index}.${key}`) ?? lineOf(info.lines, `plugins.${index}`);
  if (!block || typeof block !== 'object') {
    reporter.error(file, R(null), 9, `plugins[${index}] 不是一个引用块（应为 \`- name: …\` 形式）`);
    return;
  }
  if (isMissing(block.name)) reporter.error(file, R('name'), 9, `plugins[${index}] 缺少 name`);
  if (isMissing(block.why)) {
    reporter.error(file, R('why'), 9, `plugins[${index}]（${block.name ?? '?'}）缺少 why：在这篇内容里为什么用它`);
  } else {
    const why = String(block.why).trim();
    if (why.length < WHY_MIN_LENGTH) {
      reporter.error(file, R('why'), 9, `plugins[${index}].why 只有 ${why.length} 个字（下限 ${WHY_MIN_LENGTH}）`);
    }
    const banned = BANNED_WHY.find((word) => why.includes(word));
    if (banned) {
      reporter.error(file, R('why'), 9, `plugins[${index}].why 里出现了空泛词「${banned}」，要写清具体用途`);
    }
  }
  if (isMissing(block.npm) && isMissing(block.repo)) {
    reporter.error(file, R('npm'), 9, `plugins[${index}]（${block.name ?? '?'}）必须至少给 npm 或 repo 之一`);
  }
  if (!isMissing(block.install) && !/^dsh plugin\s/i.test(String(block.install).trim())) {
    reporter.error(file, R('install'), 9, `plugins[${index}].install 必须是 \`dsh plugin …\` 形式：\`${block.install}\``);
  }
  if (!isMissing(block.entry)) {
    const parsed = parseEntryId(block.entry);
    if (!parsed) {
      reporter.error(file, R('entry'), 9, `plugins[${index}].entry \`${block.entry}\` 形状不对：必须是 plugin/<n>`);
    } else if (!ctx.byId.get(parsed.id)) {
      reporter.error(file, R('entry'), 9, `plugins[${index}].entry 指向的 ${parsed.id} 不存在`);
    }
  }
  if (!isMissing(block.entry) && kind === 'plugin') {
    const parsed = parseEntryId(block.entry);
    if (parsed && parsed.id === id) {
      reporter.warn(file, R('entry'), 9, '插件引用块指向了词条自己');
    }
  }
}

function checkPluginEntry(ctx, reporter, entry, extras) {
  const { file, data, lines } = entry;
  const { id, bodyText } = extras;
  const R = (key) => lineOf(lines, key);

  const repo = data.repo;
  const npm = data.npm;
  if (isMissing(repo) && isMissing(npm)) {
    reporter.error(file, R('repo'), 16, '插件词条必须至少给 `repo`（owner/repo）或 `npm`（包名）之一');
  }
  if (!isMissing(repo) && !/^[\w.-]+\/[\w.-]+$/.test(String(repo))) {
    reporter.error(file, R('repo'), 16, `repo \`${repo}\` 形状不对：应该是 owner/repo`);
  }

  // 收录门槛（规则 15）
  const referencedBy = [];
  for (const other of ctx.entries) {
    if (other.kind === 'plugin' || !other.data) continue;
    const blocks = other.data.plugins;
    if (!Array.isArray(blocks)) continue;
    const hit = blocks.some((b) => b && b.entry === id);
    if (hit) referencedBy.push(`${other.kind}/${other.n}`);
  }
  const usedInPacks = (data.usedInPacks ?? []).length > 0;
  const hasMaintainer = !isMissing(data.maintainers);
  // 官方来源：本体仓库/官方组织发的包天然配得上这一页——这一格是**客观可核实**的
  // （看 repo owner 或 npm scope），不需要也不该由「有人认领」来给它背书。
  // 此前门槛里没有这一格，结果官方本体条目反而收不进来（实测：插件区第一条就是它）。
  const owner = !isMissing(repo)
    ? String(repo).split('/')[0].toLowerCase()
    : (!isMissing(npm) ? String(npm).replace(/^@/, '').split('/')[0].toLowerCase() : '');
  const isOfficial = OFFICIAL_OWNERS.has(owner);
  const satisfied = [
    isOfficial ? 'official' : null,
    referencedBy.length ? 'tutorial' : null,
    usedInPacks ? 'pack' : null,
    hasMaintainer ? 'maintainer' : null,
  ].filter(Boolean);

  // 特殊途径（评审：这么强制的门槛应该取消一下，或者有一个特殊途径）：
  // 四条机械门槛都不满足时，声明 `entryGate: editorial` 并在 `entryGateNote` 写明理由即可放行——
  // 把「要不要收」交回给人，但要求留下理由。缺理由或没走这条路，只 warn，不挡 CI。
  const isEditorial = String(data.entryGate ?? '') === 'editorial';
  const gateNote = String(data.entryGateNote ?? '').trim();
  const editorialOk = isEditorial && gateNote.length >= 8;

  const declared = data.entryGate;
  if (declared != null && !isMissing(declared)) {
    if (!ENUMS.entryGate.includes(String(declared))) {
      reporter.error(file, R('entryGate'), 15, `entryGate \`${declared}\` 不在允许值里（${ENUMS.entryGate.join(' | ')}）`);
    } else if (declared === 'editorial') {
      if (!editorialOk) {
        reporter.warn(
          file,
          R('entryGateNote') ?? R('entryGate'),
          15,
          'entryGate 声明为 `editorial`（编辑决定收录），但没有写明 `entryGateNote` 理由——特殊途径要求留理由',
        );
      }
    } else if (!satisfied.includes(String(declared))) {
      reporter.error(
        file,
        R('entryGate'),
        15,
        `entryGate 声明为 \`${declared}\`，但实际不满足${satisfied.length ? `（实际满足：${satisfied.join(', ')}）` : '任何收录门槛'}`,
        '门槛 = 官方组织发布 / 被本站教程引用 / 被已收录整合包使用 / 有 maintainer 认领；都不满足时可走特殊途径：entryGate: editorial + entryGateNote 写明理由',
      );
    }
  }

  if (satisfied.length === 0 && !editorialOk) {
    reporter.warn(
      file,
      R('repo') ?? null,
      15,
      `插件词条 ${id} 不满足任何收录门槛（不是官方来源、没被教程引用、没被整合包使用、没有 maintainer）`,
      '四条门槛满足任意一条即可；都不满足时可走特殊途径：entryGate: editorial + entryGateNote 写明理由（见 docs/02 §1.2）',
    );
  }
  if (bodyText.length === 0) {
    reporter.warn(file, entry.bodyStartLine ?? null, 15, `插件词条 ${id} 正文为空：聚合页的价值在「外部源没有的那部分」`);
  }

  // relations 的 target 必须存在，since/until 必须合法（规则 16 / 21）
  if (!isMissing(data.relations)) {
    if (!Array.isArray(data.relations)) {
      reporter.error(file, R('relations'), 16, '`relations` 必须是序列');
    } else {
      for (const [i, rel] of data.relations.entries()) {
        const line = R(`relations.${i}`) ?? R('relations');
        if (!rel || typeof rel !== 'object') {
          reporter.error(file, line, 16, `relations[${i}] 不是对象`);
          continue;
        }
        if (isMissing(rel.type)) {
          reporter.error(file, R(`relations.${i}.type`) ?? line, 16, `relations[${i}] 缺少 type`);
        } else if (!ENUMS.relationType.includes(String(rel.type))) {
          reporter.error(file, R(`relations.${i}.type`) ?? line, 16, `relations[${i}].type \`${rel.type}\` 不在允许值里`);
        }
        const parsed = parseEntryId(rel.target);
        if (!parsed) {
          reporter.error(file, R(`relations.${i}.target`) ?? line, 16, `relations[${i}].target \`${rel.target}\` 形状不对：必须是 plugin/<n>`);
        } else if (parsed.kind !== 'plugin') {
          reporter.error(file, R(`relations.${i}.target`) ?? line, 16, `relations[${i}].target 必须指向 plugin/<n>（现在是 ${parsed.id}）`);
        } else if (!ctx.byId.get(parsed.id)) {
          reporter.error(file, R(`relations.${i}.target`) ?? line, 16, `relations[${i}].target 指向的 ${parsed.id} 不存在`);
        }
        const since = rel.since;
        const until = rel.until;
        for (const key of ['since', 'until']) {
          const value = rel[key];
          if (isMissing(value)) continue;
          if (!/^[\w.+-]+$/.test(String(value))) {
            reporter.warn(file, R(`relations.${i}.${key}`) ?? line, 21, `relations[${i}].${key} \`${value}\` 不像合法版本串`);
          }
        }
        if (!isMissing(since) && !isMissing(until) && compareVersions(String(since), String(until)) > 0) {
          reporter.warn(file, R(`relations.${i}.since`) ?? line, 21, `relations[${i}] 的 since（${since}）大于 until（${until}），版本段反了`);
        }
      }
    }
  }

  // compat.dsh 每项带口径（规则 16）
  const compatDsh = data.compat?.dsh;
  if (!isMissing(compatDsh)) {
    if (!Array.isArray(compatDsh)) {
      reporter.error(file, R('compat.dsh'), 16, 'compat.dsh 必须是版本枚举（序列）');
    } else {
      for (const [i, item] of compatDsh.entries()) {
        const text = typeof item === 'string' ? item : JSON.stringify(item);
        if (!CALIBER.test(text)) {
          reporter.error(file, R(`compat.dsh.${i}`) ?? R('compat'), 16, `compat.dsh[${i}]（${text}）没有标「实测 / 未核实」口径`);
        }
      }
    }
  }

  // providedBy 每项带快照时间（规则 16）
  if (!isMissing(data.providedBy)) {
    if (typeof data.providedBy !== 'object' || Array.isArray(data.providedBy)) {
      reporter.error(file, R('providedBy'), 16, 'providedBy 必须是对象（awesome / npm / github / dshbase 各一项）');
    } else {
      for (const [source, value] of Object.entries(data.providedBy)) {
        const line = R(`providedBy.${source}`) ?? R('providedBy');
        if (value == null || typeof value !== 'object') {
          reporter.warn(file, line, 16, `providedBy.${source} 不是对象，跳过快照时间检查`);
          continue;
        }
        const at = value.at ?? value.snapshot ?? value.fetchedAt;
        if (isMissing(at)) {
          reporter.error(file, line, 16, `providedBy.${source} 没有快照时间（at / snapshot），热度数字必须带快照日期`);
        } else if (!/^\d{4}-\d{2}-\d{2}/.test(String(at))) {
          reporter.warn(file, line, 16, `providedBy.${source} 的快照时间 \`${at}\` 不是 YYYY-MM-DD`);
        }
      }
    }
  }

  // roles 枚举（温和）
  if (Array.isArray(data.roles)) {
    for (const [i, role] of data.roles.entries()) {
      if (!role || isMissing(role.who)) {
        reporter.warn(file, R(`roles.${i}`) ?? R('roles'), 16, `roles[${i}] 缺少 who`);
      }
      if (role && !isMissing(role.role) && !ENUMS.roleType.includes(String(role.role))) {
        reporter.warn(file, R(`roles.${i}.role`) ?? R('roles'), 16, `roles[${i}].role \`${role.role}\` 不在允许值里`);
      }
    }
  }
}

/** `1.2.3` / `0.1.0-rc.6` 的粗比较（足够支撑 since ≤ until 的检查） */
function compareVersions(a, b) {
  const parse = (v) => String(v).split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    const sx = String(x);
    const sy = String(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
  }
  return 0;
}

/** `concept.runtime`（叶子）在 taxonomy 里的直接查找；shorthand 只接受唯一匹配 */
function matchLeafShorthand(leaves, cat) {
  const hits = [...leaves.values()].filter((node) => node.id.endsWith(`.${cat}`) && !node.hasChildren);
  return hits.length === 1 ? hits[0] : null;
}

/* ------------------------------------------------------------------ */
/* 分区                                                                */
/* ------------------------------------------------------------------ */

function checkZones(ctx, reporter, only) {
  const targets = only ? ctx.zones.filter((z) => only.includes(path.resolve(z.path))) : ctx.zones;
  const seenZones = new Map();
  for (const zone of ctx.zones) {
    if (seenZones.has(zone.zone)) {
      reporter.error(zone.file, lineOf(zone.lines, 'zone'), 17, `分区名 \`${zone.zone}\` 重复（另一个在 ${seenZones.get(zone.zone)}）`);
    } else {
      seenZones.set(zone.zone, zone.file);
    }
  }

  for (const zone of targets) {
    checkZone(ctx, reporter, zone);
  }
}

function checkZone(ctx, reporter, zone) {
  const { file, data, lines, zone: zoneName } = zone;
  const R = (key) => lineOf(lines, key);

  if (isMissing(data.title)) reporter.error(file, R('title'), 17, `分区 \`${zoneName}\` 缺少 title`);
  if (isMissing(data.desc)) reporter.error(file, R('desc'), 17, `分区 \`${zoneName}\` 缺少 desc（一句话定义，必填）`);
  if (isMissing(data.howto)) reporter.error(file, R('howto'), 17, `分区 \`${zoneName}\` 缺少 howto（顶部「怎么用」，必填）`);
  for (const key of Object.keys(data)) {
    if (!ZONE_KEYS.has(key)) {
      reporter.error(
        file,
        R(key),
        17,
        `分区文件里出现了未知键 \`${key}\``,
        key === 'dataSource' || key === 'sources'
          ? '`dataSource` / `sources` 已废弃：分区页不再有「本分区的来源」区块（docs/07 已标记废弃）'
          : `允许的通用键：${[...ZONE_KEYS].join(', ')}`,
      );
    }
  }

  const itemFields = Array.isArray(data.itemFields) ? data.itemFields.map(String) : [];
  if (data.itemFields != null && !Array.isArray(data.itemFields)) {
    reporter.error(file, R('itemFields'), 23, '`itemFields` 必须是序列（专属字段白名单）');
  }
  // 通用卡片键不能进 itemFields：构建会把 itemFields 里的键塞进 item.extra，
  // 于是顶层字段（尤其 source 徽章）会凭空消失。这条护栏就是为那次事故加的。
  for (const field of itemFields) {
    if (ITEM_KEYS.has(field)) {
      reporter.error(
        file,
        R('itemFields'),
        23,
        `\`itemFields\` 不能声明通用卡片键 \`${field}\``,
        `通用键（${[...ITEM_KEYS].join(' / ')}）直接写在条目上即可；itemFields 只放本分区独有的字段，否则构建会把它塞进 extra、顶层丢失`,
      );
    }
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (data.items != null && !Array.isArray(data.items)) {
    reporter.error(file, R('items'), 17, '`items` 必须是序列');
  }
  if (items.length === 0) {
    reporter.warn(file, R('items'), 17, `分区 \`${zoneName}\` 还没有任何条目（十一个分区页都必须非空）`);
  }

  const usedFields = new Set();
  for (const [i, item] of items.entries()) {
    const at = (key) => lineOf(lines, key == null ? `items.${i}` : `items.${i}.${key}`) ?? R('items');
    if (!item || typeof item !== 'object') {
      reporter.error(file, at(null), 17, `items[${i}] 不是对象`);
      continue;
    }
    if (isMissing(item.name)) reporter.error(file, at('name'), 17, `items[${i}] 缺少 name`);
    if (isMissing(item.blurb)) reporter.error(file, at('blurb'), 17, `items[${i}]（${item.name ?? '?'}）缺少 blurb（一句话介绍，人工写）`);
    if (isMissing(item.links)) {
      reporter.error(file, at('links'), 17, `items[${i}]（${item.name ?? '?'}）缺少 links（至少一个外部链接）`);
    } else if (typeof item.links !== 'object' || Array.isArray(item.links) || Object.keys(item.links).length === 0) {
      reporter.error(file, at('links'), 17, `items[${i}].links 必须是非空对象（如 { github: "owner/repo" }）`);
    } else {
      for (const [key, url] of Object.entries(item.links)) {
        if (isMissing(url)) continue;
        const text = String(url);
        if (/^(https?:\/\/|mailto:)/i.test(text)) continue;
        if (/^[\w.-]+\/[\w.-]+$/.test(text)) continue;
        // `npm: dsh-myskin` 这类裸包名是合法写法（npm 包名不一定带 scope 或斜杠）
        if (String(key) === 'npm' && /^(@[\w.-]+\/)?[\w.-]+$/.test(text)) continue;
        reporter.warn(file, at('links'), 18, `items[${i}].links.${key} \`${text}\` 既不是 URL 也不是 owner/repo`);
      }
    }
    if (!isMissing(item.source) && !ENUMS.sourceBadge.includes(String(item.source))) {
      reporter.warn(file, at('source'), 17, `items[${i}].source \`${item.source}\` 不是已知来源徽章（${ENUMS.sourceBadge.join(' | ')}）`);
    }
    if (!isMissing(item.risk) && Array.isArray(item.risk)) {
      for (const risk of item.risk) {
        if (!ENUMS.risk.includes(String(risk))) {
          reporter.warn(file, at('risk'), 17, `items[${i}].risk \`${risk}\` 不在允许值里（${ENUMS.risk.join(' | ')}）`);
        }
      }
    }

    // 规则 18：entry 指向存在的词条（留空即红链，合法）
    if (!isMissing(item.entry)) {
      const parsed = parseEntryId(item.entry);
      if (!parsed) {
        reporter.error(file, at('entry'), 18, `items[${i}].entry \`${item.entry}\` 形状不对：必须是 kind/<n>`);
      } else if (!ctx.byId.get(parsed.id)) {
        reporter.error(file, at('entry'), 18, `items[${i}].entry 指向的 ${parsed.id} 不存在`, '要么建这一条，要么留空（红链是合法状态）');
      }
    }

    // 规则 23：只允许 itemFields 白名单内的专属键（M1 必须就位，error）
    for (const key of Object.keys(item)) {
      if (ITEM_KEYS.has(key)) continue;
      if (itemFields.includes(key)) {
        usedFields.add(key);
        continue;
      }
      reporter.error(
        file,
        at(key),
        23,
        `items[${i}]（${item.name ?? '?'}）出现了 \`itemFields\` 白名单之外的键 \`${key}\``,
        itemFields.length
          ? `本分区允许的专属字段：${itemFields.join(', ')}`
          : '本分区没有声明 itemFields，条目只允许通用卡片字段（name / blurb / links / entry / tags / risk …）',
      );
    }
  }

  for (const field of itemFields) {
    if (!usedFields.has(field)) {
      reporter.warn(file, R('itemFields'), 23, `itemFields 声明了 \`${field}\`，但没有任何条目在用它`);
    }
  }

  // 分区来源区块
  if (!isMissing(data.sources)) {
    if (!Array.isArray(data.sources)) {
      reporter.error(file, R('sources'), 17, '`sources` 必须是序列');
    } else {
      for (const [i, source] of data.sources.entries()) {
        if (isMissing(source?.id) || isMissing(source?.name)) {
          reporter.warn(file, lineOf(lines, `sources.${i}`) ?? R('sources'), 17, `sources[${i}] 缺少 id / name`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* sources/<slug>.yml（规则 20）                                        */
/* ------------------------------------------------------------------ */

const SOURCE_CONFIG_KEYS = new Set(['slug', 'url', 'zones', 'zone', 'adapter', 'note', 'status', 'snapshot', 'sourceKind', 'name']);

/** 跨分区类型：不属于任何一层，因此不写进分区的 kinds（docs/12 §1） */
const CROSS_ZONE_KINDS = new Set(['concept', 'tutorial', 'source']);

/**
 * 规则 25：二级分区（docs/06 §2.0.1）。
 * 一级分区回答「这是哪一层」，二级分区回答「同一层里属于哪一类」——
 * 两者混在一起时，读者分不清「去源头」还是「读条目」。
 */
function checkZoneSections(ctx, reporter) {
  for (const zone of ctx.zones) {
    const sections = zone.data?.sections;
    const items = Array.isArray(zone.data?.items) ? zone.data.items : [];
    const at = (key) => lineOf(zone.lines, key) ?? lineOf(zone.lines, 'sections') ?? 1;

    if (isMissing(sections)) {
      // 没声明 sections：条目就不该写 section（写了说明数据里有个悬空的归属）
      for (const [i, item] of items.entries()) {
        if (!item || typeof item !== 'object' || isMissing(item.section)) continue;
        reporter.error(
          zone.file,
          lineOf(zone.lines, `items.${i}.section`) ?? at('items'),
          25,
          `items[${i}]（${item.name ?? '?'}）写了 section，但本分区没有声明 sections`,
          '要么在分区头部加 sections: [...]，要么去掉这个键',
        );
      }
      continue;
    }
    if (!Array.isArray(sections)) {
      reporter.error(zone.file, at('sections'), 25, '`sections` 必须是序列');
      continue;
    }

    const ids = new Map();
    for (const [i, section] of sections.entries()) {
      if (!section || typeof section !== 'object') {
        reporter.error(zone.file, at('sections'), 25, `sections[${i}] 不是对象`);
        continue;
      }
      const id = isMissing(section.id) ? null : String(section.id).trim();
      const line = lineOf(zone.lines, `sections.${i}.id`) ?? at('sections');
      if (!id) {
        reporter.error(zone.file, line, 25, `sections[${i}] 缺少 id`);
        continue;
      }
      if (!/^[a-z][a-z0-9-]*$/.test(id)) {
        reporter.error(zone.file, line, 25, `二级分区 id \`${id}\` 只允许小写字母、数字与连字符（它会进 URL 锚点 #sec-${id}）`);
      }
      if (ids.has(id)) {
        reporter.error(zone.file, line, 25, `二级分区 id \`${id}\` 重复（另一个在 sections[${ids.get(id)}]）`);
        continue;
      }
      ids.set(id, i);
      if (isMissing(section.title)) reporter.error(zone.file, line, 25, `sections[${i}]（${id}）缺少 title`);
    }

    if (ids.size === 0) continue;

    for (const [i, item] of items.entries()) {
      if (!item || typeof item !== 'object') continue;
      const raw = item.section;
      const itemLine = lineOf(zone.lines, `items.${i}.section`) ?? lineOf(zone.lines, `items.${i}.name`) ?? at('items');
      if (isMissing(raw)) {
        reporter.warn(
          zone.file,
          itemLine,
          25,
          `items[${i}]（${item.name ?? '?'}）没有 section：它不会出现在任何二级分区里`,
          `补 section: <${[...ids.keys()].join(' | ')}>`,
        );
        continue;
      }
      const id = String(raw).trim();
      if (!ids.has(id)) {
        reporter.error(
          zone.file,
          itemLine,
          25,
          `items[${i}]（${item.name ?? '?'}）的 section \`${id}\` 不是本分区声明的二级分区`,
          `可用：${[...ids.keys()].join(' / ')}`,
        );
      }
    }
  }
}

/**
 * 规则 24：分区类型必须恰好被一个分区声明（docs/12 §2）。
 * 早先 kind→分区是构建期用正则从分区名里猜的：猜错过（concept 被算成「规范与协议」），
 * 而且新增类型时会静默没有归属。这条护栏让「一种类型一个分区」成为可校验的事实。
 */
function checkZoneKinds(ctx, reporter) {
  const declaredBy = new Map();
  for (const zone of ctx.zones) {
    const declared = zone.data?.kinds;
    if (isMissing(declared)) continue;
    const list = Array.isArray(declared) ? declared : [declared];
    const line = lineOf(zone.lines, 'kinds');
    for (const raw of list) {
      const kind = String(raw).trim();
      if (!ENTRY_KINDS.includes(kind)) {
        reporter.error(zone.file, line, 24, `分区声明的 kinds 里有未知类型 \`${kind}\``, `合法类型：${ENTRY_KINDS.join(', ')}`);
        continue;
      }
      if (CROSS_ZONE_KINDS.has(kind)) {
        reporter.error(zone.file, line, 24, `跨分区类型 \`${kind}\` 不该写进分区 kinds`, 'concept / tutorial / source 不绑分区');
        continue;
      }
      if (declaredBy.has(kind)) {
        reporter.error(zone.file, line, 24, `类型 \`${kind}\` 已被分区 \`${declaredBy.get(kind)}\` 声明`, '一个分区类型只能属于一个分区');
        continue;
      }
      declaredBy.set(kind, zone.zone);
    }
  }
  for (const kind of ENTRY_KINDS) {
    if (CROSS_ZONE_KINDS.has(kind) || declaredBy.has(kind)) continue;
    reporter.warn(
      null,
      null,
      24,
      `词条类型 \`${kind}\` 没有被任何分区声明`,
      `在 data/zones/<分区>.yml 里加 kinds: [${kind}]，否则它的词条没有所属分区`,
    );
  }
}

/**
 * 规则 27：`links.*` 的值要么是绝对 URL，要么是**已知键的裸坐标**。
 *
 * 站点的渲染层会把 `github: owner/repo` 与 `npm: @scope/name` 补成绝对 URL；
 * 但别的键写裸值会被浏览器当成相对路径（点出去变成"本站的 /xxx"，线上踩过）。
 * 这里给 warn 而不是 error：形态错不至于拦住贡献，但要在本地报出来。
 */
function checkLinkShapes(ctx, reporter) {
  const BARE_OK = { github: /^[\w.-]+\/[\w.-]+$/, npm: /^(@[\w.-]+\/)?[\w.-]+$/ };
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const walk = (file, lines, links, lineOfKey) => {
    if (!isObj(links)) return;
    for (const [key, value] of Object.entries(links)) {
      if (isMissing(value)) continue;
      const v = String(value).trim();
      if (/^https?:\/\//i.test(v) || v.startsWith('mailto:')) continue;
      const ok2 = BARE_OK[key] ? BARE_OK[key].test(v) : false;
      if (ok2) continue;
      reporter.warn(
        file,
        lineOfKey(key),
        27,
        `links.${key} 写的是 \`${v}\`——既不是绝对 URL，也不是已知的裸坐标`,
        'github 写 owner/repo、npm 写 @scope/name（渲染层会补前缀）；其它键请写完整 URL，否则点出去会变成站内相对路径',
      );
    }
  };
  for (const zone of ctx.zones) {
    (zone.data.items ?? []).forEach((item) => walk(zone.file, zone.lines, item?.links, (k) => lineOf(zone.lines, k)));
    // 分区顶部的**入口卡**（`links` 是数组，与 items[].links 的 map 形状不同，上面 walk 覆盖不到）。
    // 必须校验：build.mjs 会**静默丢弃**不合形状的 href —— 编辑者以为挂上了、页面上却没有。
    // （评审就踩过：第三方项目在线版的 http:// 地址被丢，页面与校验都不吭声。）
    const cards = Array.isArray(zone.data.links) ? zone.data.links : [];
    cards.forEach((l, i) => {
      if (!l || isMissing(l.href)) return;
      const href = String(l.href).trim();
      if (/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$/i.test(href) || /^https?:\/\//i.test(href)) return;
      reporter.error(
        zone.file,
        lineOf(zone.lines, 'links'),
        27,
        `links[${i}] 的 href \`${href}\` 会被构建期丢弃`,
        '入口卡只接受站内 .html 相对路径（如 mesh/index.html）或 http(s):// 绝对地址，否则这张卡不会出现在分区页上',
      );
    });
  }
  for (const entry of ctx.entries) {
    const providers = entry.data?.providedBy;
    if (!isObj(providers)) continue;
    for (const p of Object.values(providers)) {
      walk(entry.file, entry.lines, p?.links, (k) => lineOf(entry.lines, k));
    }
  }
}

/**
 * 规则 26：`data/registry.yml` 的 `zoneOrder` 必须与实际分区**完全对应**（docs/06 §2）。
 *
 * 顺序是编辑决定（docs/06 §2：先每天要用的，规范垫底），不是字母序——而它是**唯一来源**：
 * 构建期的 zones/index.json 与站点侧栏都按它排。漏写一个分区 → 那个分区被排到最后；
 * 多写一个不存在的 → 顺序表里有幽灵。两种都得在本地报出来，不能等上线才发现。
 */
function checkZoneOrder(ctx, reporter) {
  const declared = Array.isArray(ctx.registry?.data?.zoneOrder) ? ctx.registry.data.zoneOrder.map(String) : [];
  const actual = ctx.zones.map((z) => z.zone);
  if (!declared.length) {
    reporter.error(
      displayPath(ctx.registry.path),
      lineOf(ctx.registry.lines, 'zoneOrder'),
      26,
      'registry 里没有 zoneOrder——分区顺序会退化成按 id 字母序',
      `补上完整顺序，例如：\n${actual.map((z) => `  - ${z}`).join('\n')}`,
    );
    return;
  }
  const seen = new Set();
  for (const id of declared) {
    if (seen.has(id)) {
      reporter.error(displayPath(ctx.registry.path), lineOf(ctx.registry.lines, 'zoneOrder'), 26, `zoneOrder 里 \`${id}\` 出现了两次`);
    }
    seen.add(id);
  }
  const missing = actual.filter((id) => !seen.has(id));
  const extra = declared.filter((id) => !actual.includes(id));
  if (missing.length) {
    reporter.error(
      displayPath(ctx.registry.path),
      lineOf(ctx.registry.lines, 'zoneOrder'),
      26,
      `zoneOrder 漏了这些分区：${missing.join(', ')}`,
      '漏掉的分区会被排到最末（构建按 zoneOrder 排名，不在表里的排最后）',
    );
  }
  if (extra.length) {
    reporter.error(
      displayPath(ctx.registry.path),
      lineOf(ctx.registry.lines, 'zoneOrder'),
      26,
      `zoneOrder 里有不存在的分区：${extra.join(', ')}`,
      '分区文件在 data/zones/<id>.yml；改过名字就同步这里',
    );
  }
}

function checkSourcesConfig(ctx, reporter) {
  const zoneNames = new Set(ctx.zones.map((z) => z.zone));
  const hasZones = ctx.zones.length > 0;
  const documentedSlugs = new Set();
  if (Array.isArray(ctx.sources?.data?.sources)) {
    for (const source of ctx.sources.data.sources) {
      if (source?.slug) documentedSlugs.add(String(source.slug));
    }
  } else if (ctx.sources?.data && typeof ctx.sources.data === 'object') {
    for (const key of Object.keys(ctx.sources.data)) documentedSlugs.add(key);
  }
  // 源词条（kind: source）的 slug 也算「已文档化」
  // 注意：**不要把源词条声明的 zones 加进 zoneNames**——那等于让源自己给自己授权，
  // 「源指向的分区不存在」这条规则就永远不触发（曾经因此漏掉了 `docs` 这个不存在的分区）。
  for (const entry of ctx.entries) {
    if (entry.kind !== 'source' || !entry.data) continue;
    if (entry.data.slug) documentedSlugs.add(String(entry.data.slug));
  }

  for (const config of ctx.sourceConfigs) {
    const { file, data, lines, slug } = config;
    if (documentedSlugs.has(slug)) {
      reporter.error(
        file,
        lineOf(lines, 'slug') ?? 1,
        20,
        `源 \`${slug}\` 既有 data/sources/${slug}.yml 配置、又有同 slug 的源词条：两者不能并存`,
      );
    }
    for (const key of Object.keys(data)) {
      if (!SOURCE_CONFIG_KEYS.has(key)) {
        reporter.warn(file, lineOf(lines, key), 20, `源配置里出现了未知键 \`${key}\``);
      }
    }
    const zones = data.zones ?? (data.zone ? [data.zone] : []);
    if (!hasZones) {
      continue; // 分区还没建，跳过
    }
    for (const [i, z] of (Array.isArray(zones) ? zones : [zones]).entries()) {
      if (!zoneNames.has(String(z))) {
        reporter.error(file, lineOf(lines, Array.isArray(zones) ? `zones.${i}` : 'zone'), 20, `源 \`${slug}\` 指向的分区 \`${z}\` 不存在`);
      }
    }
    const adapterZone = data.adapter?.zone;
    if (!isMissing(adapterZone) && !zoneNames.has(String(adapterZone))) {
      reporter.error(file, lineOf(lines, 'adapter.zone') ?? lineOf(lines, 'adapter'), 20, `adapter.zone \`${adapterZone}\` 不是已存在的分区`);
    }
  }

  // 源词条自己声明的 zones 同样必须指向真实存在的分区（前端据此聚合「本分区的来源」）
  if (hasZones) {
    for (const entry of ctx.entries) {
      if (entry.kind !== 'source' || !entry.data) continue;
      const declared = entry.data.zones;
      if (isMissing(declared)) continue;
      const list = Array.isArray(declared) ? declared : [declared];
      for (const [i, z] of list.entries()) {
        if (zoneNames.has(String(z))) continue;
        reporter.error(
          entry.file,
          lineOf(entry.lines, Array.isArray(declared) ? `zones.${i}` : 'zones'),
          20,
          `源词条 \`${entry.data.title ?? entry.id}\` 指向的分区 \`${z}\` 不存在`,
          `已存在的分区只有：${[...zoneNames].join(' / ')}`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof SchemaError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
