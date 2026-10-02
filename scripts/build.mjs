#!/usr/bin/env node
/**
 * build.mjs —— 离线构建：data/**（+ 可选 collected/**）→ web/data/**、web/<kind>/<n>.html、web/<zone>.html
 *
 * 硬约束：
 *   - **完全离线**：只读 data/** 与 collected/**，不联网。
 *   - **确定性**：同一输入连续两次构建逐字节一致（所以 `generatedAt` 取自数据里
 *     最新的日期，而不是「现在几点」——见 --stamp）。
 *   - 只写自己拥有的产物（docs/10 §1）；index.html / *.template.html / pedia.css / pedia.js 只读。
 *
 * 用法：
 *   node scripts/build.mjs [--stamp=YYYY-MM-DD] [--dry-run] [--quiet]
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
  loadSources,
  loadTaxonomy,
  loadTemplate,
  loadZoneFiles,
} from './lib/data.mjs';
import { splitFrontMatter } from './lib/frontmatter.mjs';
import { computeCompleteness, EXPECTED_FIELDS, FIELD_SOURCE, OPTIONAL_FIELDS } from './lib/fields.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { ENTRY_KINDS } from './lib/registry.mjs';
import {
  compareIds,
  displayPath,
  exists,
  fromRoot,
  isMissing,
  isPlainObject,
  parseEntryId,
  pruneEmptyDirs,
  readText,
  sortBy,
  sortByNumericId,
  sortObjectKeys,
  sortStrings,
  toJson,
  writeFile,
} from './lib/util.mjs';
import { SchemaError } from './lib/yaml.mjs';

const WEB_DIR = fromRoot('web');
const MANIFEST_NAME = '.pedia-manifest.json';

/**
 * 部署根（构建期决定，写进每个页面的 `<base href>` 与 boot 的 base）：
 *   `/`           根域部署（自定义域名、Cloudflare Pages 根）
 *   `/dshbaike/`  GitHub Pages 子路径部署（https://<org>.github.io/dshbaike/）
 * 默认 `/`；可用 `--base=/dshbaike/` 或环境变量 `DSHBAIKE_BASE` 覆盖（CLI 优先）。
 */
let BASE = '/';

function normalizeBase(input) {
  const raw = String(input ?? '').trim();
  if (raw === '' || raw === '/') return '/';
  return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

const USAGE = `用法：node scripts/build.mjs [--stamp=YYYY-MM-DD] [--base=/子路径/] [--dry-run] [--quiet]

  --stamp=<日期>  覆盖产物里的 generatedAt（默认取数据里最新的日期，保证确定性）
  --base=<路径>   部署根，默认 /（根域）；GitHub Pages 子路径部署写 --base=/dshbaike/
  --dry-run       只算不写，打印将要产出的文件清单
  --quiet         只在结尾打印一行摘要

环境变量：DSHBAIKE_BASE 等价于 --base（CLI 优先）。

退出码：0 成功 / 1 数据有问题 / 2 用法错误。`;

/* ------------------------------------------------------------------ */

function main(argv) {
  const flags = { stamp: null, dryRun: false, quiet: false };
  if (process.env.DSHBAIKE_BASE) BASE = normalizeBase(process.env.DSHBAIKE_BASE);
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const base = /^--base=(.*)$/.exec(arg);
    if (base) {
      BASE = normalizeBase(base[1]);
      continue;
    }
    const stamp = /^--stamp=(.+)$/.exec(arg);
    if (stamp) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp[1])) {
        process.stderr.write(`--stamp 必须是 YYYY-MM-DD，收到 \`${stamp[1]}\`\n`);
        return 2;
      }
      flags.stamp = stamp[1];
      continue;
    }
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg.startsWith('-')) {
      process.stderr.write(`不认识的选项：${arg}\n\n${USAGE}\n`);
      return 2;
    }
  }

  const log = (message) => {
    if (!flags.quiet) process.stdout.write(`${message}\n`);
  };

  const model = loadModel();
  const generatedAt = flags.stamp ?? deriveGeneratedAt(model);

  const counts = { entries: 0, zones: 0, files: 0, changed: 0, removed: 0 };
  const writes = [];
  const previous = readManifest();
  const nextManifest = [];
  const problems = [];

  const registryJson = {
    generatedAt,
    version: model.registry.data.version ?? 1,
    counters: sortObjectKeys({ ...model.registry.data.counters }),
    entries: (model.registry.data.entries ?? [])
      .map((e) => ({
        n: Number(e.n),
        kind: e.kind,
        title: e.title ?? null,
        createdAt: e.createdAt ?? null,
        status: e.status ?? 'published',
      }))
      .sort((a, b) => (a.kind === b.kind ? a.n - b.n : a.kind < b.kind ? -1 : 1)),
  };

  /* ---- 反查：教程/包 里引用了哪些插件 ---- */
  const reverse = buildReverseIndex(model);

  /* ---- 词条产物 ---- */
  const entryOutputs = new Map(); // id → 产物对象
  for (const entry of model.entries) {
    const { kind, n, id } = entry;
    if (!entry.data) {
      problems.push(`${entry.file}: front-matter 解析失败，已跳过`);
      continue;
    }
    const output = buildEntryOutput(model, entry, reverse, generatedAt);
    entryOutputs.set(id, output);
    counts.entries += 1;
  }

  for (const [id, output] of entryOutputs) {
    const rel = path.posix.join('data', 'entries', `${output.kind}-${output.n}.json`);
    push(writes, nextManifest, rel, toJson(output));
  }

  /* ---- registry / search / taxonomy / entities / reverse / plugins ---- */
  push(writes, nextManifest, path.posix.join('data', 'registry.json'), toJson(registryJson));

  const searchItems = sortByNumericId(
    [...entryOutputs.values()]
      // 墓碑不进搜索：`status: deleted` 的词条页面保留（链接不烂），但不该被搜到
      .filter((e) => e.status !== 'deleted')
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        aliases: e.aliases,
        tags: e.tags ?? [],
        summary: e.summary,
      })),
    (e) => e.id.split('/')[1],
  ).sort(compareIds);
  push(writes, nextManifest, path.posix.join('data', 'search.json'), toJson({ generatedAt, items: searchItems }));

  push(writes, nextManifest, path.posix.join('data', 'taxonomy.json'), toJson(buildTaxonomyOutput(model, entryOutputs, generatedAt)));
  push(writes, nextManifest, path.posix.join('data', 'entities.json'), toJson(buildEntitiesOutput(model, generatedAt)));
  push(writes, nextManifest, path.posix.join('data', 'reverse', 'plugins.json'), toJson(reverse.output));
  push(writes, nextManifest, path.posix.join('data', 'plugins', 'index.json'), toJson(buildPluginsIndex(model, entryOutputs, generatedAt)));
  push(writes, nextManifest, path.posix.join('data', 'graph.json'), toJson(buildGraph(model, entryOutputs, generatedAt)));
  push(writes, nextManifest, path.posix.join('data', 'zones', 'index.json'), toJson(buildZoneIndex(model, generatedAt)));

  /* ---- 分区产物 ---- */
  for (const zone of model.zones) {
    const output = buildZoneOutput(model, zone, entryOutputs, reverse, generatedAt);
    push(
      writes,
      nextManifest,
      path.posix.join('data', 'zones', `${output.id}.json`),
      toJson(output),
    );
    counts.zones += 1;
  }

  /* ---- 词条页 / 分区页 ---- */
  const entryTemplate = loadTemplate('entry.template.html');
  const zoneTemplate = loadTemplate('zone.template.html');
  const rss = { entry: [], zone: [] };
  if (!entryTemplate) {
    rss.entry.push('web/entry.template.html 不存在，词条页改用内置最小外壳（等站点外壳工作流补齐后会自愈）');
  }
  if (!zoneTemplate) {
    rss.zone.push('web/zone.template.html 不存在，分区页改用内置最小外壳');
  }

  for (const output of entryOutputs.values()) {
    const html = renderEntryPage(entryTemplate?.text ?? null, output);
    const rel = path.posix.join(output.kind, `${output.n}.html`);
    push(writes, nextManifest, rel, html);
  }
  for (const zone of model.zones) {
    const output = buildZoneOutput(model, zone, entryOutputs, reverse, generatedAt);
    const html = renderZonePage(zoneTemplate?.text ?? null, output);
    push(writes, nextManifest, `${zone.zone}.html`, html);
  }

  /* ---- 写盘 ---- */
  const changed = [];
  for (const item of writes) {
    const abs = fromRoot('web', item.rel);
    const same = exists(abs) && readText(abs) === item.content;
    if (same) continue;
    changed.push(item.rel);
    if (!flags.dryRun) writeFile(abs, item.content);
  }

  /* ---- 清理上一轮产物里已经不存在的文件（只动自己拥有的范围） ---- */
  const removed = [];
  const nextSet = new Set(nextManifest.map((m) => m.path));
  for (const item of previous) {
    if (nextSet.has(item.path)) continue;
    if (!isOwnedArtifact(item.path)) continue;
    removed.push(item.path);
    if (!flags.dryRun) {
      const abs = fromRoot('web', item.path);
      if (exists(abs)) fs.rmSync(abs, { force: true });
    }
  }

  if (!flags.dryRun) {
    writeFile(fromRoot('web', MANIFEST_NAME), toJson({ version: 1, generator: 'dsh-pedia/build.mjs', files: nextManifest }));
    for (const dir of ['data/entries', 'data/zones', 'data/reverse', 'data/plugins']) {
      pruneEmptyDirs(fromRoot('web', dir), fromRoot('web'));
    }
  }

  counts.files = writes.length;
  counts.changed = changed.length;
  counts.removed = removed.length;

  for (const message of problems) process.stderr.write(`warn  ${message}\n`);
  for (const message of rss.entry) process.stderr.write(`warn  ${message}\n`);
  for (const message of rss.zone) process.stderr.write(`warn  ${message}\n`);

  log(`generatedAt = ${generatedAt}（取自数据里最新的日期；用 --stamp 覆盖）`);
  log(`词条 ${counts.entries} 条 · 分区 ${counts.zones} 个 · 产物文件 ${counts.files} 个（本次改动 ${counts.changed}，清理 ${counts.removed}）`);
  if (flags.dryRun) log('（dry-run：没有写任何文件）');
  process.stdout.write(
    `build ok: ${counts.entries} entries, ${counts.zones} zones, ${counts.files} files, ${counts.changed} written\n`,
  );
  return 0;
}

/* ------------------------------------------------------------------ */
/* 产物收集                                                            */
/* ------------------------------------------------------------------ */

function push(writes, manifest, rel, content) {
  const normalized = rel.split(path.sep).join('/');
  writes.push({ rel: normalized, content });
  manifest.push({ path: normalized, bytes: Buffer.byteLength(content, 'utf8') });
}

/** 只允许清理自己拥有的产物（docs/10 §1） */
function isOwnedArtifact(rel) {
  const p = rel.split(path.sep).join('/');
  if (p.startsWith('data/')) return true;
  if (/^[a-z]+\/\d+\.html$/.test(p)) return true;
  if (/^[a-z]+\.html$/.test(p) && p !== 'index.html') return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* 加载模型                                                            */
/* ------------------------------------------------------------------ */

function loadModel() {
  const registry = loadRegistry();
  const taxonomy = loadTaxonomy();
  const sources = loadSources();
  const entities = loadEntities();
  const zones = loadZoneFiles();
  const collected = loadCollected();

  const entries = [];
  for (const kind of ENTRY_KINDS) {
    const dir = path.join(DATA_DIR, kind);
    if (!exists(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.md')) continue;
      const base = name.slice(0, -3);
      if (!/^\d+$/.test(base)) continue;
      const abs = path.join(dir, name);
      const file = displayPath(abs);
      const raw = readText(abs);
      try {
        const parsed = splitFrontMatter(raw, { file });
        entries.push({ kind, n: Number(base), id: `${kind}/${Number(base)}`, abs, file, ...parsed });
      } catch (error) {
        entries.push({ kind, n: Number(base), id: `${kind}/${Number(base)}`, abs, file, data: null, body: '', lines: new Map() });
        process.stderr.write(`warn  ${file}: ${error instanceof SchemaError ? error.message : error.message}\n`);
      }
    }
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.n - b.n : a.kind < b.kind ? -1 : 1));

  const byId = new Map();
  for (const entry of entries) byId.set(entry.id, entry);

  return {
    registry,
    taxonomy,
    sources,
    entities,
    zones,
    collected,
    entries,
    byId,
    collectedPacks: loadCollectedPacks(),
    zoneByKind: zoneForKinds(zones),
  };
}

/** kind → 默认分区（docs/10 §4 的 `zone` 字段） */
/**
 * kind → 所属分区（docs/12 §2）。
 * **分区显式声明优先**：`data/zones/<id>.yml` 里的 `kinds: [theme]` 是权威来源。
 * 早先用正则从分区名/标题里猜，猜错过（`concept` 被猜成「规范与协议」），
 * 新增分区时还会静默失效。跨分区类型（concept / tutorial / source）不写进任何分区。
 */
function zoneForKinds(zones) {
  const map = new Map();
  for (const zone of zones) {
    const declared = zone.data?.kinds;
    if (!Array.isArray(declared)) continue;
    for (const raw of declared) {
      const kind = String(raw).trim();
      if (!kind || map.has(kind)) continue;
      map.set(kind, zone);
    }
  }
  const byEntryKind = (kind) =>
    zones.find((zone) => (zone.data?.items ?? []).some((item) => parseEntryId(item?.entry)?.kind === kind)) ?? null;
  const byTitle = (re) => zones.find((zone) => re.test(zone.zone) || re.test(String(zone.data?.title ?? ''))) ?? null;
  // 兜底：跨分区类型不绑分区（一条源覆盖多个分区，本身不属于任何一层）
  if (!map.has('concept')) map.set('concept', byEntryKind('concept') ?? byTitle(/concept|概念/i));
  if (!map.has('tutorial')) map.set('tutorial', byEntryKind('tutorial') ?? byTitle(/教程|ops/i));
  if (!map.has('source')) map.set('source', null);
  return map;
}

/** 确定性 generatedAt：数据里最新的日期 */
function deriveGeneratedAt(model) {
  const dates = [];
  const consider = (value) => {
    if (typeof value !== 'string') return;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (m) dates.push(m[1]);
  };
  for (const entry of model.entries) {
    consider(entry.data?.updatedAt);
    consider(entry.data?.providedBy?.awesome?.at);
    consider(entry.data?.providedBy?.npm?.at);
    consider(entry.data?.providedBy?.github?.at);
    consider(entry.data?.providedBy?.dshbase?.at);
    consider(entry.data?.coverage?.at);
    consider(entry.data?.external?.reviewedAt);
    for (const rel of entry.data?.relations ?? []) consider(rel.since);
  }
  for (const reg of model.registry.data.entries ?? []) consider(reg.createdAt);
  for (const zone of model.zones) consider(zone.data?.snapshot);
  for (const entity of model.entities?.data?.entities ?? []) {
    for (const r of entity?.refs ?? []) consider(r?.at);
  }
  for (const source of model.sources?.data?.sources ?? []) consider(source?.coverage?.at);
  if (model.collected.market?.generatedAt) consider(model.collected.market.generatedAt);
  if (model.collected.links?.checkedAt) consider(model.collected.links.checkedAt);
  dates.sort();
  return dates.length ? dates[dates.length - 1] : '1970-01-01';
}

/* ------------------------------------------------------------------ */
/* 反向索引（插件 → 教程 / 包）                                         */
/* ------------------------------------------------------------------ */

function pluginKeyOf(block) {
  if (!isMissing(block?.npm)) return `npm:${String(block.npm).trim()}`;
  if (!isMissing(block?.repo)) return `repo:${String(block.repo).trim()}`;
  if (!isMissing(block?.name)) return `name:${String(block.name).trim()}`;
  return null;
}

function buildReverseIndex(model) {
  const byKey = new Map();
  const ensure = (key, name, entryId) => {
    if (!byKey.has(key)) byKey.set(key, { key, name: name ?? null, entryId: entryId ?? null, tutorials: [], packs: [], refs: [] });
    const item = byKey.get(key);
    if (!item.name && name) item.name = name;
    if (!item.entryId && entryId) item.entryId = entryId;
    return item;
  };

  for (const entry of model.entries) {
    if (!entry.data) continue;
    const blocks = Array.isArray(entry.data.plugins) ? entry.data.plugins : [];
    for (const block of blocks) {
      const key = pluginKeyOf(block);
      if (!key) continue;
      const item = ensure(key, block.name, parseEntryId(block.entry)?.id ?? null);
      const ref = {
        entry: entry.id,
        kind: entry.kind,
        title: entry.data.title ?? null,
        npm: block.npm ?? null,
        repo: block.repo ?? null,
        install: block.install ?? null,
        why: block.why ?? null,
        sources: Array.isArray(block.sources) ? [...block.sources] : [],
      };
      if (!item.refs.some((r) => r.entry === ref.entry && r.repo === ref.repo && r.npm === ref.npm)) item.refs.push(ref);
      if (entry.kind === 'tutorial' && !item.tutorials.includes(entry.id)) item.tutorials.push(entry.id);
      if (entry.kind === 'pack' && !item.packs.includes(entry.id)) item.packs.push(entry.id);
    }
  }

  const plugins = [...byKey.values()]
    .map((item) => ({
      key: item.key,
      name: item.name,
      entryId: item.entryId,
      tutorials: sortStrings(item.tutorials),
      packs: sortStrings(item.packs),
      refs: sortBy(item.refs, (r) => `${r.entry}|${r.repo ?? ''}|${r.npm ?? ''}`),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const byEntryId = new Map();
  for (const item of plugins) {
    if (item.entryId) byEntryId.set(item.entryId, item);
  }

  return {
    byKey,
    byEntryId,
    output: { generatedAt: null, plugins },
  };
}

/* ------------------------------------------------------------------ */
/* 词条产物                                                            */
/* ------------------------------------------------------------------ */

function buildEntryOutput(model, entry, reverse, generatedAt) {
  const { kind, n, id, data } = entry;
  const completeness = computeCompleteness(kind, data);
  const hasEntry = (target) => {
    const parsed = parseEntryId(target);
    if (!parsed) return false;
    const target2 = model.byId.get(parsed.id);
    return Boolean(target2 && target2.data);
  };
  const { html, toc } = renderMarkdown(entry.body ?? '', { base: BASE, hasEntry });

  const status = isMissing(data.status) ? 'published' : String(data.status);
  const zone = model.zoneByKind.get(kind) ?? null;

  const meta = {};
  const metaFields = [...(EXPECTED_FIELDS[kind] ?? []), ...(OPTIONAL_FIELDS[kind] ?? [])];
  for (const field of metaFields) {
    if (isMissing(data[field])) continue;
    if (['title', 'category', 'summary', 'status', 'tags', 'aliases'].includes(field)) continue;
    meta[field] = data[field];
  }
  if (!isMissing(data.category)) meta.category = Array.isArray(data.category) ? sortStrings(data.category) : data.category;
  // 归档说明要进 meta：墓碑/归档页要显示「为什么还留着」（规则 22）。
  // 它属于 common 可选字段，不在这两个 per-kind 列表里，所以单独带一笔。
  if (!isMissing(data.archivedNote)) meta.archivedNote = data.archivedNote;

  const relations = (Array.isArray(data.relations) ? data.relations : []).map((rel) => ({
    type: rel?.type ?? null,
    target: rel?.target ?? null,
    targetTitle: titleOf(model, rel?.target),
    since: rel?.since ?? null,
    until: rel?.until ?? null,
    note: rel?.note ?? null,
  }));

  const plugins = (Array.isArray(data.plugins) ? data.plugins : []).map((block) => ({
    name: block?.name ?? null,
    entry: parseEntryId(block?.entry)?.id ?? null,
    why: block?.why ?? null,
    install: block?.install ?? null,
    links: sortObjectKeys(
      compact({
        github: block?.repo ? `https://github.com/${block.repo}` : null,
        npm: block?.npm ? `https://www.npmjs.com/package/${String(block.npm).replace(/^@/, '@')}` : null,
      }),
    ),
  }));

  const wikiTargets = [...String(entry.body ?? '').matchAll(/\[\[([^\]\n|]+)/g)]
    .map((m) => parseEntryId(m[1].trim())?.id)
    .filter(Boolean);
  const prereqIds = (Array.isArray(data.prereq) ? data.prereq : []).map((x) => parseEntryId(x)?.id).filter(Boolean);
  const relatedIds = (Array.isArray(data.related) ? data.related : []).map((x) => parseEntryId(x)?.id).filter(Boolean);
  const backlinkIds = [...new Set([...prereqIds, ...relatedIds, ...wikiTargets])].filter((x) => x !== id);

  const reverseRef = kind === 'plugin' ? reverse.byEntryId.get(id) : null;
  const usedInPacks = reverseRef ? reverseRef.packs : [];
  const referencedByTutorials = reverseRef ? reverseRef.tutorials : [];

  const snapshot = latestSnapshot(data);

  const output = {
    id,
    kind,
    n,
    title: data.title ?? null,
    titleEn: data.titleEn ?? null,
    aliases: sortStrings(data.aliases ?? []),
    tags: sortStrings(data.tags ?? []),
    summary: data.summary ?? null,
    status,
    updatedAt: data.updatedAt ?? null,
    html,
    toc,
    meta,
    sources: deriveFieldSources(data),
    completeness,
    plugins,
    relations,
    backlinks: sortBy(backlinkIds, (x) => x).map((target) => ({ id: target, title: titleOf(model, target) })),
    zone: zone ? { id: zone.zone, title: zone.data?.title ?? null } : null,
    snapshot,
  };
  if (kind === 'plugin') {
    output.usedInPacks = sortStrings(usedInPacks);
    output.referencedByTutorials = sortStrings(referencedByTutorials);
  }
  return sortObjectKeys(deepSort(output));
}

/** 数组按值排序、对象按键排序，保证 JSON 逐字节稳定 */
function deepSort(value) {
  if (Array.isArray(value)) return value.map((v) => deepSort(v));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = deepSort(value[key]);
    return out;
  }
  return value;
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!isMissing(v)) out[k] = v;
  return out;
}

function titleOf(model, target) {
  const parsed = parseEntryId(target);
  if (!parsed) return null;
  const entry = model.byId.get(parsed.id);
  return entry?.data?.title ?? null;
}

function latestSnapshot(data) {
  const dates = [];
  const consider = (v) => {
    if (typeof v === 'string') {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
      if (m) dates.push(m[1]);
    }
  };
  if (isPlainObject(data.providedBy)) {
    for (const value of Object.values(data.providedBy)) consider(value?.at ?? value?.snapshot);
  }
  consider(data.coverage?.at);
  dates.sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** 字段 → manual | verified | auto（docs/10 §4） */
function deriveFieldSources(data) {
  const out = {};
  for (const field of FIELD_SOURCE.recomputed) {
    if (!isMissing(data[field]) || ['relations', 'plugins'].includes(field)) out[field] = 'recomputed';
  }
  for (const field of FIELD_SOURCE.auto) {
    if (!isMissing(data[field])) out[field] = 'auto';
  }
  for (const field of FIELD_SOURCE.verified) {
    if (!isMissing(data[field])) out[field] = 'verified';
  }
  for (const field of ['title', 'summary', 'tags', 'updatedAt', 'maintainers', 'positioning', 'spec', 'install', 'repo', 'npm', 'entryGate', 'fitFor', 'howto', 'linkOut', 'url']) {
    if (!isMissing(data[field])) out[field] = 'manual';
  }
  return sortObjectKeys(out);
}

/* ------------------------------------------------------------------ */
/* taxonomy / entities / plugins 索引 / graph                          */
/* ------------------------------------------------------------------ */

function buildTaxonomyOutput(model, entryOutputs, generatedAt) {
  const counts = {};
  for (const entry of entryOutputs.values()) {
    if (entry.status === 'deleted') continue;
    const cats = entry.meta?.category;
    if (!Array.isArray(cats)) continue;
    for (const cat of cats) counts[String(cat)] = (counts[String(cat)] ?? 0) + 1;
  }
  const tree = model.taxonomy?.data ?? { tree: [] };
  return { generatedAt, tree: isPlainObject(tree) && 'tree' in tree ? tree.tree : tree, counts: sortObjectKeys(counts) };
}

function buildEntitiesOutput(model, generatedAt) {
  const list = [];
  const seen = new Set();
  for (const entity of model.entities?.data?.entities ?? []) {
    const id = entity?.id ?? null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      keys: sortStrings(entity.keys ?? []),
      refs: sortBy(entity.refs ?? [], (r) => String(r?.source ?? '')).map((ref) => ({
        source: ref?.source ?? null,
        url: ref?.url ?? null,
        at: ref?.at ?? null,
        fields: sortObjectKeys(ref?.fields ?? {}),
      })),
    });
  }
  return { generatedAt, entities: sortBy(list, (e) => e.id) };
}

function buildPluginsIndex(model, entryOutputs, generatedAt) {
  const items = [];
  for (const entry of entryOutputs.values()) {
    if (entry.kind !== 'plugin') continue;
    items.push({
      id: entry.id,
      n: entry.n,
      title: entry.title,
      positioning: entry.meta?.positioning ?? null,
      category: entry.meta?.category ?? [],
      tags: entry.tags ?? [],
      providedBy: entry.meta?.providedBy ?? {},
      snapshot: entry.snapshot,
      completeness: entry.completeness?.score ?? null,
    });
  }
  items.sort((a, b) => a.n - b.n);
  return { generatedAt, items };
}

function buildGraph(model, entryOutputs, generatedAt) {
  const edges = [];
  for (const entry of entryOutputs.values()) {
    for (const rel of entry.relations ?? []) {
      edges.push({ from: entry.id, to: rel.target, type: rel.type ?? 'related' });
    }
    for (const target of entry.backlinks ?? []) {
      if (!target?.id) continue;
      if ((entry.relations ?? []).some((r) => r.target === target.id)) continue;
      edges.push({ from: entry.id, to: target.id, type: 'references' });
    }
  }
  return { generatedAt, edges: sortBy(edges, (e) => `${e.from}|${e.type}|${e.to}`) };
}

function buildZoneIndex(model, generatedAt) {
  return {
    generatedAt,
    // 字段名用 `count` 与 web/pedia.js 对齐（docs/10 §6 没冻结这个文件的字段名）
    zones: sortBy(
      model.zones.map((zone) => ({
        id: zone.zone,
        title: zone.data?.title ?? null,
        desc: zone.data?.desc ?? null,
        count: Array.isArray(zone.data?.items) ? zone.data.items.length : 0,
      })),
      (z) => z.id,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 分区产物                                                            */
/* ------------------------------------------------------------------ */

function buildZoneOutput(model, zone, entryOutputs, reverse, generatedAt) {
  const data = zone.data ?? {};
  const itemFields = Array.isArray(data.itemFields) ? data.itemFields.map(String) : [];
  const items = (Array.isArray(data.items) ? data.items : []).map((item) => {
    const extra = {};
    for (const field of itemFields) {
      if (isMissing(item?.[field])) continue;
      extra[field] = item[field];
    }
    const parsed = parseEntryId(item?.entry);
    const output = parsed ? entryOutputs.get(parsed.id) : null;
    return {
      name: item?.name ?? null,
      blurb: item?.blurb ?? null,
      section: isMissing(item?.section) ? null : String(item.section).trim(),
      source: item?.source ?? null,
      links: sortObjectKeys(item?.links ?? {}),
      entry: parsed?.id ?? null,
      entryTitle: output?.title ?? null,
      completeness: output ? (output.completeness?.score ?? null) : null,
      tags: sortStrings(item?.tags ?? []),
      version: item?.version ?? null,
      updatedAt: item?.updatedAt ?? null,
      risk: sortStrings(item?.risk ?? []),
      extra: sortObjectKeys(extra),
    };
  });

  // 分区页**不再有「本分区的来源」区块**：那套「分区优先消费外部源、无源才人工清单」
  // 的模型已经不成立（评审 2026-10-02）。现在每个分区有自己的词条类型与二级分区，
  // 外部源要么作为二级分区里的一个条目（如「插件市场」），要么只是词条的出处，不再单列一块。

  return deepSort({
    id: zone.zone,
    title: data.title ?? null,
    desc: data.desc ?? null,
    howto: data.howto ?? null,
    // 这个分区收哪些词条类型（docs/12 §2）：前端据此把「本分区能长出哪些详情」讲清楚
    kinds: sortStrings(data.kinds ?? []),
    // 二级分区（docs/06 §2.0.1）：intro 是编辑综述，构建期就渲染成 HTML，
    // 前端不必为了它再带一个 Markdown 渲染器（也不让未转义的 HTML 从数据侧溜进来）。
    // **保持声明顺序**：这里不排序——分区作者写「主题包 → 主题加载器」就是他要的顺序，
    // 按 id 排会变成「加载器 → 主题包」。确定性由源文件顺序保证，不靠排序。
    sections: (Array.isArray(data.sections) ? data.sections : []).map((s) => ({
      id: s?.id ?? null,
      title: s?.title ?? null,
      desc: s?.desc ?? null,
      intro: s?.intro ?? null,
      introHtml: isMissing(s?.intro) ? null : renderMarkdown(String(s.intro), { base: BASE, hasEntry: false }).html,
    })),
    itemFields,
    items,
  });
}

/* ------------------------------------------------------------------ */
/* HTML 生成                                                           */
/* ------------------------------------------------------------------ */

const BOOT_COMMENT = '<!--{{PEDIA_BOOT}}-->';
const BOOT_COMMENT_COMPACT = '<!-- {{PEDIA_BOOT}} -->';

function bootScript(payload) {
  return `<script>window.__PEDIA__ = ${JSON.stringify(payload)};window.__PEDIA_BASE__ = ${JSON.stringify(BASE)};</script>`;
}

/** 模板缺失时的最小外壳（等站点外壳工作流补齐 web/entry.template.html 后自动让位） */
function fallbackShell({ title, desc, payload }) {
  const meta = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    '<link rel="stylesheet" href="' + BASE + 'pedia.css">',
    bootScript(payload),
    '</head>',
    '<body>',
    '<div id="app"></div>',
    '<script src="' + BASE + 'pedia.js"></script>',
    '</body>',
    '</html>',
    '',
  ];
  return meta.join('\n');
}

function applyTemplate(template, { title, desc, payload }) {
  if (!template) return fallbackShell({ title, desc, payload });
  let html = template;
  html = html.replaceAll('{{TITLE}}', title);
  html = html.replaceAll('{{DESC}}', desc);
  // 部署根写进 <base href>：模板里写死的是 "/"，子路径部署（GitHub Pages 的 /dshbaike/）
  // 必须按 --base 改写，否则嵌套页（concept/1.html）里的相对资源会指到根域。
  html = html.replace(/<base href="[^"]*">/, `<base href="${BASE}">`);
  html = html.replace(BOOT_COMMENT, bootScript(payload));
  if (html.includes(BOOT_COMMENT_COMPACT)) html = html.replace(BOOT_COMMENT_COMPACT, bootScript(payload));
  return html.endsWith('\n') ? html : `${html}\n`;
}

function renderEntryPage(template, output) {
  const title = `${output.title ?? output.id} | DSH百科`;
  const desc = output.summary ?? '';
  return applyTemplate(template, {
    title,
    desc,
    payload: { base: BASE, page: 'entry', kind: output.kind, n: output.n, title: output.title },
  });
}

function renderZonePage(template, output) {
  const title = `${output.title ?? output.id} | DSH百科`;
  const desc = output.desc ?? '';
  return applyTemplate(template, {
    title,
    desc,
    payload: { base: BASE, page: 'zone', zone: output.id, title: output.title },
  });
}

/* ------------------------------------------------------------------ */
/* 增量清单                                                            */
/* ------------------------------------------------------------------ */

function readManifest() {
  const abs = fromRoot('web', MANIFEST_NAME);
  if (!exists(abs)) return [];
  try {
    const parsed = JSON.parse(readText(abs));
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    return [];
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
