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
import { presentationFor } from './lib/presentation.mjs';
import { createHash } from 'node:crypto';
import { renderMarkdown, escapeHtml } from './lib/markdown.mjs';
import { ENTRY_KINDS } from './lib/registry.mjs';
// 生态全景图的数据（graph.json）：见 scripts/lib/graph.mjs。
// 页面不再由本项目渲染——全量生态图用第三方项目（vendor/dsh-plugin-mesh）。
import { buildEcosystemGraph } from './lib/graph.mjs';
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
 *   `/`           根域部署（现行：自定义域 https://dshbaike.com/）
 *   `/<repo>/`    GitHub Pages 项目子路径部署（https://<org>.github.io/<repo>/）
 * 默认 `/`；可用 `--base=/<repo>/` 或环境变量 `DSHBAIKE_BASE` 覆盖（CLI 优先）。
 */
let BASE = '/';

/**
 * 站点对外地址（写进 canonical / og:url / sitemap）。默认我们的自定义域；
 * 可用 --site= 或 DSHBAIKE_SITE 覆盖——**fork 部署应当覆盖它**，
 * 否则会声明 canonical 指向我们这边（等于把权重都送过来）。
 */
let SITE_URL = 'https://dshbaike.com';

function normalizeBase(input) {
  const raw = String(input ?? '').trim();
  if (raw === '' || raw === '/') return '/';
  return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

const USAGE = `用法：node scripts/build.mjs [--stamp=YYYY-MM-DD] [--base=/子路径/] [--dry-run] [--quiet]

  --stamp=<日期>  覆盖产物里的 generatedAt（默认取数据里最新的日期，保证确定性）
  --base=<路径>   部署根，默认 /（自定义域 / 根域）；GitHub Pages 项目子路径部署写 --base=/<repo>/
  --site=<地址>   站点对外地址，写进 canonical / og:url / sitemap（默认 https://dshbaike.com）
  --dry-run       只算不写，打印将要产出的文件清单
  --quiet         只在结尾打印一行摘要

环境变量：DSHBAIKE_BASE 等价于 --base、DSHBAIKE_SITE 等价于 --site（CLI 优先）。

退出码：0 成功 / 1 数据有问题 / 2 用法错误。`;

/* ------------------------------------------------------------------ */

function main(argv) {
  const flags = { stamp: null, dryRun: false, quiet: false };
  if (process.env.DSHBAIKE_BASE) BASE = normalizeBase(process.env.DSHBAIKE_BASE);
  if (process.env.DSHBAIKE_SITE) SITE_URL = String(process.env.DSHBAIKE_SITE).replace(/\/+$/, '');
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
    const site = /^--site=(.+)$/.exec(arg);
    if (site) {
      SITE_URL = site[1].trim().replace(/\/+$/, '');
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

  /* ---- 第三方全量插件生态图（vendor/dsh-plugin-mesh，MIT）----
     我们的 graph.json 是「人工核实过的关系」（31 条词条），这张图是「全量生态」
     （2625 个仓库、机器按 topic 采集）——两种东西，评审决定全景图用它那张。

     分两层落地：
       ① 它的应用与数据 → `web/mesh/app/`（原样拷贝；改它就去改上游或换新副本）
       ② 我们自己的说明壳 → `web/mesh/index.html`（构建期渲染，快照日期读 vendored 数据）
     套壳的理由：那张图不是我们做的，而它的界面右上角挂的是它自己的作者；读者从我们这儿
     点进来，得先知道这是谁的东西、数据是谁采的、哪些不是我们的结论。 */
  const vendorDir = fromRoot('vendor', 'dsh-plugin-mesh');
  const meshDataPath = path.join(vendorDir, 'data', 'mesh.json');
  const meshTemplate = loadTemplate('mesh.template.html');
  if (exists(vendorDir)) {
    const walkVendor = (dir, rel) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        const next = rel ? `${rel}/${name}` : name;
        if (fs.statSync(abs).isDirectory()) {
          walkVendor(abs, next);
          continue;
        }
        // README.md 是给我们自己看的，不进站点产物
        if (next === 'README.md') continue;
        push(writes, nextManifest, path.posix.join('mesh', 'app', next), readText(abs));
        counts.meshFiles = (counts.meshFiles ?? 0) + 1;
      }
    };
    walkVendor(vendorDir, '');
    if (exists(meshDataPath)) {
      push(
        writes,
        nextManifest,
        'mesh/index.html',
        renderMeshShell(meshTemplate?.text ?? null, JSON.parse(readText(meshDataPath))),
      );
      counts.meshFiles = (counts.meshFiles ?? 0) + 1;
    } else {
      problems.push('vendor/dsh-plugin-mesh/data/mesh.json 不存在：/mesh/ 的说明壳拿不到快照日期');
    }
  } else {
    problems.push('vendor/dsh-plugin-mesh 不存在：全量插件生态图（web/mesh/）不会生成');
  }

  /* ---- 我们自己的关系数据（docs/02 §产物 graph.json）----
     只产出数据、不画图：全量生态图用第三方那张（上面已拷进 web/mesh/）。
     这份数据留给将来的「以某条词条为圆心的邻域星图」以及下游消费。 */
  const graph = buildEcosystemGraph({ model, entryOutputs, reverse, generatedAt });
  counts.graphNodes = graph.counts.nodes;
  counts.graphEdges = graph.counts.edges;

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
  push(writes, nextManifest, path.posix.join('data', 'graph.json'), toJson(graph));
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

  /* ---- 维度索引（P1 长尾组合页，docs/10 §7）：先算好，页面预渲染要用它做内链 ---- */
  const indexes = buildDimensionIndexes(model, entryOutputs);

  /* ---- 词条页 / 分区页 ---- */
  const entryTemplate = loadTemplate('entry.template.html');
  const zoneTemplate = loadTemplate('zone.template.html');
  const indexTemplate = loadTemplate('index-page.template.html');
  const rss = { entry: [], zone: [] };
  if (!entryTemplate) {
    rss.entry.push('web/entry.template.html 不存在，词条页改用内置最小外壳（等站点外壳工作流补齐后会自愈）');
  }
  if (!zoneTemplate) {
    rss.zone.push('web/zone.template.html 不存在，分区页改用内置最小外壳');
  }

  for (const output of entryOutputs.values()) {
    const html = renderEntryPage(entryTemplate?.text ?? null, output, entryOutputs, indexes);
    const rel = path.posix.join(output.kind, `${output.n}.html`);
    push(writes, nextManifest, rel, html);
  }
  for (const zone of model.zones) {
    const output = buildZoneOutput(model, zone, entryOutputs, reverse, generatedAt);
    const html = renderZonePage(zoneTemplate?.text ?? null, output, entryOutputs, indexes);
    push(writes, nextManifest, `${zone.zone}.html`, html);
  }

  /* 生态全景图不再由本站渲染：改用第三方那张全量插件生态图（vendor/dsh-plugin-mesh，
     见下面的 web/mesh/ 拷贝）。我们只保留 graph.json 这份「核实过的关系」数据契约。 */

  /* ---- 维度索引页（P1 长尾组合页，docs/10 §7） ---- */
  for (const index of indexes) {
    const html = renderIndexPage(indexTemplate?.text ?? null, index, entryOutputs, indexes);
    push(writes, nextManifest, `${index.kind}/${index.slug}.html`, html);
    counts.indexes = (counts.indexes ?? 0) + 1;
  }

  // 名称 → 索引页地址：前端 indexlinks.js 用它把内链也挂到真实页面上
  push(writes, nextManifest, path.posix.join('data', 'indexes', 'index.json'), toJson({
    generatedAt: null,
    indexes: indexes.map((i) => ({ kind: i.kind, name: i.name, slug: i.slug, count: i.count })),
  }));

  // 汇总页：所有索引页的入口（人和爬虫都能一页看全）
  push(writes, nextManifest, 'tags.html', renderTagsHub(indexTemplate?.text ?? null, indexes));

  // 维护者名册（数据源是词条自己的 maintainers）
  push(writes, nextManifest, 'maintainers.html', renderMaintainersPage(indexTemplate?.text ?? null, entryOutputs));

  /* ---- SEO：sitemap.xml 与 robots.txt（P1） ---- */
  push(writes, nextManifest, 'sitemap.xml', sitemapXml(sitemapUrls(model, entryOutputs, indexes)));
  push(writes, nextManifest, 'robots.txt', robotsTxt());
  /* ---- AI 可见度：给大模型看的两个入口（llmstxt.org 约定） ---- */
  push(writes, nextManifest, 'llms.txt', llmsTxt(model, entryOutputs, indexes));
  push(writes, nextManifest, 'llms-full.txt', llmsFullTxt(entryOutputs));

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
  // 第三方全量生态图的托管目录（壳 + 原样拷贝的应用）。它整棵子树都是我们的产物，
  // 换 vendor 新副本或改路径时，上一版留下的文件要能被清掉（3MB 级，留着很显眼）。
  if (p === 'mesh' || p.startsWith('mesh/')) return true;
  if (p === 'sitemap.xml' || p === 'robots.txt') return true;
  if (/^(tag|platform)\/[a-z0-9-]+\.html$/.test(p)) return true;
  if (p === 'tags.html' || p === 'maintainers.html') return true;
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
  // 按**词条 id** 索引的「哪些教程提到它」：来源是教程的 plugins 块 + 教程正文的 [[]] 提及。
  // 与 byKey 的区别：byKey 按插件的 npm/repo 坐标聚合（为了去重与门槛），
  // 这个按词条本身聚合，所以**任何类型**的词条都能拿到（不只是插件）。
  const tutorialsByEntry = new Map();
  const addTutorialRef = (targetId, tutorialId) => {
    if (!targetId || !tutorialId || targetId === tutorialId) return;
    if (!tutorialsByEntry.has(targetId)) tutorialsByEntry.set(targetId, new Set());
    tutorialsByEntry.get(targetId).add(tutorialId);
  };
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
      // ① 教程的 plugins 块（刻意的引用，带 why）
      if (entry.kind === 'tutorial') addTutorialRef(parseEntryId(block.entry)?.id ?? null, entry.id);
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

  // ② 教程正文里的 [[]] 提及（教程写到哪，谁的「相关教程」里就多一条）
  for (const entry of model.entries) {
    if (entry.kind !== 'tutorial') continue;

    if (!entry.body) continue;
    for (const m of String(entry.body).matchAll(/\[\[([^\]\n|]+)/g)) {
      addTutorialRef(parseEntryId(m[1].trim())?.id ?? null, entry.id);
    }
  }


  const byEntryId = new Map();
  for (const item of plugins) {
    if (item.entryId) byEntryId.set(item.entryId, item);
  }

  return {
    byKey,
    byEntryId,
    tutorialsByEntry,
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
  // 三处都要拼：per-kind 必填/可选 **加上公共可选字段**。
  // 之前漏了 OPTIONAL_FIELDS.common，导致公共可选字段（authors，以及 archivedNote）
  // 根本进不了 meta —— archivedNote 当初是"单独带一笔"绕过去的，见下面。
  const metaFields = [
    ...(EXPECTED_FIELDS[kind] ?? []),
    ...(OPTIONAL_FIELDS[kind] ?? []),
    ...(OPTIONAL_FIELDS.common ?? []),
  ];
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

  // 「出现在哪些整合包」仍只对插件有意义（整合包按 npm/repo 坐标引用插件）
  const reverseRef = kind === 'plugin' ? reverse.byEntryId.get(id) : null;
  const usedInPacks = reverseRef ? reverseRef.packs : [];
  // 「相关教程」对**所有类型**都成立：教程写到哪，这里就长出一条（构建期派生，不用手维护）
  const referencedByTutorials = [...(reverse.tutorialsByEntry?.get(id) ?? [])];

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
    // 展示契约（docs/13）：基础格式由前端统一渲染，这里只给它「这个类型的扩展」
    // ——首屏块（lead）与信息表字段组的取舍/顺序。前端缺这个字段时会退回默认布局。
    presentation: presentationFor(kind),
    snapshot,
  };
  if (kind === 'plugin') {
    output.usedInPacks = sortStrings(usedInPacks);
  }
  // 「相关教程」对**所有类型**都成立（构建期派生：教程的 plugins 块 + 教程正文的 [[]] 提及），
  // 所以不放在上面的 plugin 分支里——它是词条的元数据，不是插件的专属字段。
  output.referencedByTutorials = sortStrings(referencedByTutorials);
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

function buildZoneIndex(model, generatedAt) {
  // 分区顺序的唯一来源是 data/registry.yml 的 `zoneOrder`（docs/06 §2）。
  // 之前这里按 id 字母序排，于是侧栏读起来是「素材与本地化 → 界面与客户端 → 启动器…」——
  // 顺序是编辑决定，不该由字母决定。未列进 zoneOrder 的排在最后（validate 规则 26 会报错）。
  const order = Array.isArray(model.registry?.data?.zoneOrder) ? model.registry.data.zoneOrder.map(String) : [];
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length + 1 : i;
  };
  return {
    generatedAt,
    // 字段名用 `count` 与 web/pedia.js 对齐（docs/10 §6 没冻结这个文件的字段名）
    zones: model.zones
      .map((zone) => ({
        id: zone.zone,
        title: zone.data?.title ?? null,
        desc: zone.data?.desc ?? null,
        count: Array.isArray(zone.data?.items) ? zone.data.items.length : 0,
      }))
      .sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
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
    // 分区页顶部的入口卡（`links`，docs/06 §4）：例如插件分区指向 `graph.html` 生态全景图。
    // 只允许站内相对路径或 http(s) 绝对地址，别让数据侧塞进 javascript: 之类。
    // **http:// 也要放行**：第三方项目常常只提供 http 地址（例如那张生态图的作者在线版是裸 IP），
    // 而入口卡是**导航链接**、不是页面内资源，不存在混合内容问题。只认 https 会把这类链接
    // 静默丢掉（评审踩过：配了在线版入口，页面和校验都不吭声）。
    links: (Array.isArray(data.links) ? data.links : [])
      .filter((l) => l && !isMissing(l.href) && /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$|^https?:\/\//i.test(String(l.href)))
      .map((l) => ({
        label: String(l.label ?? '').trim() || String(l.href),
        href: String(l.href),
        note: isMissing(l.note) ? null : String(l.note),
      })),
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
      // 默认折叠（docs/02 分区文件契约）：前端与预渲染都按它决定是否折进 <details>
      collapsed: s?.collapsed === true,
      introHtml: isMissing(s?.intro) ? null : renderMarkdown(String(s.intro), { base: BASE, hasEntry: false }).html,
    })),
    itemFields,
    items,
  });
}

/* ------------------------------------------------------------------ */
/* HTML 生成                                                           */
/* ------------------------------------------------------------------ */

const PRERENDER_COMMENT = '<!--{{PRERENDER}}-->';
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

function applyTemplate(template, { title, desc, payload, prerender, canonical, noindex }) {
  if (!template) return fallbackShell({ title, desc, payload });
  let html = template;
  if (html.includes('{{CANONICAL}}')) html = html.split('{{CANONICAL}}').join(canonical ?? `${SITE_URL}/`);
  // 墓碑页（status: deleted）保留链接可达，但不该被搜到
  if (noindex) html = html.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
  // 预渲染块（P0，docs/10 §7）：没有就替换成空串，模板里的占位注释不会留在产物里
  if (html.includes(PRERENDER_COMMENT)) {
    html = html.replace(PRERENDER_COMMENT, String(prerender ?? '').trim());
  }
  html = html.replaceAll('{{TITLE}}', title);
  html = html.replaceAll('{{DESC}}', desc);
  // 部署根写进 <base href>：模板里写死的是 "/"，项目子路径部署（GitHub Pages 的 /<repo>/）
  // 必须按 --base 改写，否则嵌套页（concept/1.html）里的相对资源会指到根域。
  html = html.replace(/<base href="[^"]*">/, `<base href="${BASE}">`);
  html = html.replace(BOOT_COMMENT, bootScript(payload));
  if (html.includes(BOOT_COMMENT_COMPACT)) html = html.replace(BOOT_COMMENT_COMPACT, bootScript(payload));
  return html.endsWith('\n') ? html : `${html}\n`;
}

/* ------------------------------------------------------------------ */
/* 预渲染（P0，docs/10 §7）                                            */
/*                                                                     */
/* 为什么要有：正文原先只在 data/entries/*.json 里，靠浏览器跑 JS 才填进 */
/* 页面——实测构建产物的静态可见文字只有 181 字、线上裸 HTML 43 字。     */
/* 百度基本不执行 JS，等于抓不到正文。这里把内容直接写进静态 HTML，     */
/* 前端 boot() 接管前再移除它，所以「有 JS / 无 JS」看到的是同一份内容。 */
/* ------------------------------------------------------------------ */

function htmlIdToPath(id, entryOutputs) {
  const parsed = parseEntryId(id);
  if (!parsed) return null;
  const out = entryOutputs?.get(parsed.id);
  return { href: `${parsed.kind}/${parsed.n}.html`, title: out?.title ?? parsed.id };
}

/**
 * 把 front-matter 里的值转成信息表能显示的一行文本。
 *
 * 之前数组一律 `String(v)` —— 遇到**对象数组**（`authors: [{name, role}]`）就漏出
 * `[object Object]`，而预渲染的信息表正是**爬虫与关掉 JS 的访客**看到的那一份。
 * 现在按 pedia.js 的精神**展开**（而不是丢弃）：
 *   - `{ name, role }` → `名字（角色）`（authors 就长这样）；
 *   - 其它对象 → 展开一层 `键: 值`，嵌套对象跳过（宁可少显示，也不显示 [object Object]）。
 */
function formatMetaValue(value) {
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => formatMetaValue(v))
      .filter((v) => v !== null && v !== undefined && v !== '' && !String(v).includes('[object Object]'));
    return parts.length ? parts.join('、') : null;
  }
  if (value && typeof value === 'object') {
    const bits = [];
    if (!isMissing(value.name)) bits.push(value.role ? `${value.name}（${value.role}）` : String(value.name));
    for (const [k, v] of Object.entries(value)) {
      if (k === 'name' || k === 'role') continue;
      if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
      bits.push(`${k}: ${v}`);
    }
    return bits.length ? bits.join(' · ') : null;
  }
  return String(value);
}

/** 词条页的静态内容：标题 / 别名 / 摘要 / 正文 / 相关教程 / 反向链接 / 信息表 / 标签 */
function prerenderEntry(output, entryOutputs, indexes = []) {
  const L = [];
  L.push('<div class="prerender" data-prerender="entry">');
  L.push('<article class="prose">');
  L.push(`<h1>${escapeHtml(output.title ?? output.id)}</h1>`);
  if (output.titleEn) L.push(`<p class="faint">${escapeHtml(output.titleEn)}</p>`);
  if (output.aliases?.length) L.push(`<p class="faint">别名：${output.aliases.map(escapeHtml).join('、')}</p>`);
  if (output.summary) L.push(`<p>${escapeHtml(output.summary)}</p>`);
  // 正文：构建期已经由 markdown 渲染成 HTML（同一个字段前端也在用）
  if (output.html) L.push(String(output.html));

  const tutorials = (output.referencedByTutorials ?? []).map((id) => htmlIdToPath(id, entryOutputs)).filter(Boolean);
  if (tutorials.length) {
    L.push('<h2>相关教程</h2>');
    L.push('<ul>');
    for (const t of tutorials) L.push(`<li><a href="${t.href}">${escapeHtml(t.title)}</a></li>`);
    L.push('</ul>');
  }

  const backs = (output.backlinks ?? []).map((b) => htmlIdToPath(b.id, entryOutputs)).filter(Boolean);
  if (backs.length) {
    L.push('<h2>谁引用了这一条</h2>');
    L.push('<ul>');
    for (const b of backs) L.push(`<li><a href="${b.href}">${escapeHtml(b.title)}</a></li>`);
    L.push('</ul>');
  }

  const metaRows = Object.entries(output.meta ?? {})
    // bugs 有自己的页签（「插件特性」），不进信息表——否则信息表里会出现一坨缺陷详情。
    .filter(([k]) => k !== 'bugs')
    .map(([k, v]) => [k, formatMetaValue(v)])
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    // 兜底：formatMetaValue 没吃住的嵌套形态曾漏出 `[object Object]`——那是**爬虫与
    // 关掉 JS 的访客**唯一能看到的版本，宁可不显示这一行，也不能显示错值。
    // （JS 侧按 pedia.js 的规则正确展开，所以带 JS 的访客不受影响。
    //   长期做法是让预渲染也做同样的展开，见待办。）
    .filter(([, v]) => !String(v).includes('[object Object]'));
  if (metaRows.length) {
    L.push('<h2>信息表</h2>');
    L.push('<dl>');
    for (const [k, v] of metaRows) {
      // URL 值的字段（url / linkOut / homepage…）在无 JS 的预渲染里也要能点开，
      // 与前端 pedia.js 的 infoRow 保持一致（评审：第三方项目的原链接、在线体验链接挂不上）。
      const raw = String(v);
      const dd = /^https?:\/\/\S+$/i.test(raw)
        ? `<a href="${escapeHtml(raw)}" rel="noopener noreferrer external" target="_blank">${escapeHtml(raw)}</a>`
        : escapeHtml(raw);
      L.push(`<dt>${escapeHtml(k)}</dt><dd>${dd}</dd>`);
    }
    L.push('</dl>');
  }

  if (output.tags?.length) {
    // 标签行渲染成 chips（学 MC百科 的「模组标签」）：插件页叫「插件标签」，
    // 其它类型仍叫「标签」——同一个字段，按类型换称呼。
    L.push(
      `<p class="entry-tags"><span class="faint">${output.kind === 'plugin' ? '插件标签' : '标签'}</span> ` +
        `${output.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</p>`,
    );
    // 采用度（社会证明，学 MC百科 的「有 694 个整合包使用了它」）：
    // 三个计数都是**派生**的——被哪些整合包用、被哪些教程引用、被哪些词条引用。
    // 全为 0 时整行不输出（纪律：缺失显示「无数据」，不显示 0，更不留空行）。
    const adoption = [];
    if (output.usedInPacks?.length) adoption.push(`被 ${output.usedInPacks.length} 个整合包使用`);
    if (output.referencedByTutorials?.length) adoption.push(`被 ${output.referencedByTutorials.length} 篇教程引用`);
    const backlinkCount = Array.isArray(output.backlinks) ? output.backlinks.length : 0;
    if (backlinkCount) adoption.push(`被 ${backlinkCount} 条词条引用`);
    if (adoption.length) L.push(`<p class="adoption">${adoption.join(' · ')}</p>`);
    // 属性块（学 MC百科 把元数据放在最上面、一眼可扫）：
    // 只列**已有数据**，空的一律不出（纪律：缺失显示「无数据」，不显示空壳）。
    // 相对时间（"3 天前"）留给前端算，这里写绝对日期，避免构建期时间漂移。
    const attrPairs = [];
    // 注意：front-matter 里的字段挂在 output.meta 下（updatedAt/maintainers 等少数是顶层派生字段），
    // 所以两边都读一次——上一版只读顶层，结果属性块只剩「最后更新」。
    const meta = output.meta ?? {};
    const pick = (k) => meta[k] ?? output[k];
    // roles 可能是「字符串」或「字符串数组」——其它形态（对象数组）一律不渲染，
    // 绝不出现 [object Object]（上一版就是这么漏出来的）。
    const rolesRaw = pick('roles');
    const rolesText = typeof rolesRaw === 'string'
      ? rolesRaw
      : Array.isArray(rolesRaw) && rolesRaw.every((r) => typeof r === 'string')
        ? rolesRaw.join('、')
        : null;
    if (pick('role')) attrPairs.push(['角色', String(pick('role'))]);
    else if (rolesText) attrPairs.push(['角色', rolesText]);
    if (pick('layer')) attrPairs.push(['层级', String(pick('layer'))]);
    if (pick('repo')) attrPairs.push(['上游', String(pick('repo'))]);
    if (pick('npm')) attrPairs.push(['npm', String(pick('npm'))]);
    if (pick('runtime')) attrPairs.push(['运行环境', String(pick('runtime'))]);
    if (pick('appliesTo')) attrPairs.push(['适用版本', String(pick('appliesTo'))]);
    const lic = typeof pick('license') === 'string' && pick('license') ? pick('license') : null;
    if (lic) attrPairs.push(['许可', lic]);
    if (output.updatedAt) attrPairs.push(['最后更新', String(output.updatedAt).slice(0, 10)]);
    const keep = pick('maintainers') ?? output.maintainers;
    if (Array.isArray(keep) && keep.length) attrPairs.push(['维护者', keep.map((m) => `@${m}`).join('、')]);
    // 来源类字段（launcher / source / pack 等类型主要靠这些）：
    // 这里按纯文本显示；可点击的版本在下面的信息表里（那里会识别 URL）。
    // 插件页按评审决定**不放市场坐标**（marketId 只在整合包/工具这类有意义的类型上显示）
    if (pick('marketId') && output.kind !== 'plugin') attrPairs.push(['市场坐标', String(pick('marketId'))]);
    if (pick('launcherId')) attrPairs.push(['canonical ID', String(pick('launcherId'))]);
    if (pick('url')) attrPairs.push(['上游地址', String(pick('url'))]);
    if (pick('linkOut')) attrPairs.push(['默认去处', String(pick('linkOut'))]);
    if (attrPairs.length) {
      // 与 JS 侧同名结构（.attrs 卡片 + .attrs__title 标题 + .attrs__pair 键值对），
      // 样式统一放 pedia.css —— 之前这里用内联样式、也没标题，肉眼根本认不出这是「属性」。
      L.push('<section class="attrs" aria-label="属性">');
      L.push('<h2 class="attrs__title">属性</h2>');
      for (const [k, v] of attrPairs) {
        L.push(
          `<span class="attrs__pair"><span class="faint">${escapeHtml(k)}</span> ` +
            `<strong>${escapeHtml(v)}</strong></span>`,
        );
      }
      L.push('</section>');
    }
    // 开发者 / 团队（authors）：上游作者卡片，头像用 GitHub 现成地址（零托管成本）。
    // 放在属性块之后（学 MC百科 的顺序），并且**只列已有数据**，没有就整块不出。
    // 与信息表里的「维护者」（本馆）不是一个概念，所以单独成块——别混。
    const authors = (output.meta?.authors ?? []).filter((a) => a && typeof a === 'object' && a.name);
    if (authors.length) {
      L.push('<section class="team" aria-label="开发者 / 团队">');
      L.push(`<h2 class="team__title">开发者 / 团队（${authors.length}）</h2>`);
      L.push('<div class="team__list">');
      for (const a of authors.slice(0, 5)) {
        const login = String(a.name).replace(/^@/, '');
        const gh = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login);
        L.push('<div class="team__card">');
        if (gh) {
          L.push(
            `<img class="team__avatar" src="https://github.com/${encodeURIComponent(login)}.png?size=80" alt="" loading="lazy" width="32" height="32">`,
          );
        }
        L.push('<span class="team__text">');
        L.push(`<span class="team__name">${escapeHtml(String(a.name))}</span>`);
        if (a.role) L.push(`<span class="team__role">${escapeHtml(String(a.role))}</span>`);
        L.push('</span></div>');
      }
      L.push('</div>');
      if (authors.length > 5) {
        // 预渲染是静态的，折叠按钮交给 JS；无 JS 时至少把「还有几个」说清楚
        L.push(`<p class="faint">另有 ${authors.length - 5} 位成员（启用 JavaScript 后展开）</p>`);
      }
      L.push('</section>');
    }
    // 支持的 DSH 版本：放在开发者/团队**下面**（评审指定的顺序）。
    // 数据源按可靠性排：dshVersions / dshVersion / appliesTo 优先，其次是 compat.dsh
    // （实测里它成句、自带诚实措辞，逐字照登）；都没有就给中性的一句，不替上游下结论。
    // 插件页不放 manifest（已决定取消），这里也不提。
    const versBits = [];
    const pushVers = (label, v) => {
      if (v === null || v === undefined || v === '') return;
      if (Array.isArray(v)) {
        const xs = v.filter((x) => x !== null && x !== undefined && x !== '');
        if (xs.length) versBits.push(`${label}：${xs.join('、')}`);
      } else if (typeof v !== 'object') {
        versBits.push(`${label}：${v}`);
      }
    };
    pushVers('DSH 版本', output.meta?.dshVersions);
    pushVers('DSH 版本', output.meta?.dshVersion);
    pushVers('适用版本', output.meta?.appliesTo);
    // compat.dsh 可能是**字符串**也可能是**字符串数组**（实测 launcher/3 就是数组），
    // 两种都认；嵌套对象才跳过（不猜语义）。
    const compatRaw = output.meta?.compat?.dsh;
    let compatText = null;
    if (Array.isArray(compatRaw)) {
      const xs = compatRaw.filter((x) => x !== null && x !== undefined && x !== '');
      if (xs.length) compatText = xs.join('　·　');
    } else if (compatRaw !== null && compatRaw !== undefined && compatRaw !== '' && typeof compatRaw !== 'object') {
      compatText = String(compatRaw);
    }
    const hasCompatText = compatText !== null;
    L.push('<section class="vers" aria-label="支持的 DSH 版本">');
    L.push('<h2 class="vers__title">支持的 DSH 版本</h2>');
    if (versBits.length) L.push(`<p class="vers__line">${escapeHtml(versBits.join('　·　'))}</p>`);
    if (hasCompatText) {
      L.push(`<p class="vers__line"><span class="faint">兼容声明</span>　${escapeHtml(compatText)}</p>`);
    }
    if (!versBits.length && !hasCompatText) {
      L.push('<p class="vers__line faint">本站尚未收录它的 DSH 版本声明。</p>');
    }
    L.push('</section>');
    const row = indexLinkRow(output.tags, indexes, 'tag');
    if (row) L.push(row);
  }
  L.push('</article>');
  L.push('</div>');
  return L.join('\n');
}

/** 分区页的静态内容：分区名与说明 + 各二级分区 + 条目（名字 + 一句话 + 词条链接） */
function prerenderZone(output, entryOutputs, indexes = []) {
  const L = [];
  L.push('<div class="prerender" data-prerender="zone">');
  L.push('<article class="prose">');
  L.push(`<h1>${escapeHtml(output.title ?? output.id)}</h1>`);
  if (output.desc) L.push(`<p>${escapeHtml(output.desc)}</p>`);
  for (const link of output.links ?? []) {
    L.push(
      `<aside class="zone-cta"><a class="zone-cta__link" href="${escapeHtml(link.href)}">` +
        `<span class="zone-cta__label">${escapeHtml(link.label)}</span>` +
        (link.note ? `<span class="zone-cta__note">${escapeHtml(link.note)}</span>` : '') +
        '</a></aside>',
    );
  }

  // 这一区涉及的标签/平台：给出通往索引页的入口（索引页也给回链，形成互链）
  {
    const tagNames = [...new Set((output.items ?? []).flatMap((i) => i.tags ?? []))];
    const platformNames = [...new Set((output.items ?? []).flatMap((i) => i.platforms ?? []))];
    const tagRow = indexLinkRow(tagNames, indexes, 'tag');
    const platRow = indexLinkRow(platformNames, indexes, 'platform');
    if (tagRow) L.push(tagRow);
    if (platRow) L.push(platRow);
  }

  const items = output.items ?? [];
  const sections = (output.sections ?? []).filter((s) => s?.id);
  const grouped = new Map();
  for (const item of items) {
    const key = item.section && sections.some((s) => s.id === item.section) ? item.section : '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const emit = (list) => {
    L.push('<ul>');
    for (const item of list) {
      const label = escapeHtml(item.name ?? '');
      const link = item.entry ? htmlIdToPath(item.entry, entryOutputs) : null;
      const name = link ? `<a href="${link.href}">${label}</a>` : label;
      const blurb = item.blurb ? ` —— ${escapeHtml(item.blurb)}` : '';
      L.push(`<li>${name}${blurb}</li>`);
    }
    L.push('</ul>');
  };

  for (const sec of sections) {
    const list = grouped.get(sec.id) ?? [];
    if (!list.length) continue;
    L.push(`<h2>${escapeHtml(sec.title ?? sec.id)}</h2>`);
    // 二级分区的**综述**（`intro`，构建期已渲染成 introHtml）也要进来：
    // 之前只渲染了 title/desc + 卡片，于是那段说明（含「去哪儿找全量」这类表格）
    // 只存在于 JSON 里，无 JS 的读者与爬虫都看不到。
    if (sec.collapsed) {
      // 默认折叠的节：说明与条目折进 <details>（内容仍在 HTML 里，爬虫与无 JS 用户都能读）
      L.push(`<details class="collapse subsec__fold"><summary>说明与条目（${list.length} 条）</summary>`);
      if (sec.desc) L.push(`<p>${escapeHtml(sec.desc)}</p>`);
      if (sec.introHtml) L.push(sec.introHtml);
      emit(list);
      L.push('</details>');
      continue;
    }
    if (sec.desc) L.push(`<p>${escapeHtml(sec.desc)}</p>`);
    if (sec.introHtml) L.push(sec.introHtml);
    emit(list);
  }
  const rest = grouped.get('') ?? [];
  if (rest.length) {
    if (sections.length) L.push('<h2>其余条目</h2>');
    emit(rest);
  }

  L.push('</article>');
  L.push('</div>');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* SEO 基础设施（P1）：sitemap.xml / robots.txt                        */
/* ------------------------------------------------------------------ */

function sitemapXml(urls) {
  const L = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const u of urls) {
    L.push('  <url>');
    L.push(`    <loc>${escapeHtml(u.loc)}</loc>`);
    if (u.lastmod) L.push(`    <lastmod>${escapeHtml(u.lastmod)}</lastmod>`);
    L.push('  </url>');
  }
  L.push('</urlset>', '');
  return L.join('\n');
}

/**
 * 页面的**对外规范地址**：不带 `.html`。
 *
 * 为什么：Cloudflare Pages 会把 HTML 重定向到无扩展名（`/plugin/2.html` → 308 → `/plugin/2`），
 * 所以搜索引擎眼里的最终地址是**无扩展名**那一版。canonical / og:url / sitemap 若还写 `.html`，
 * 就等于把规范地址指向一个会重定向的 URL —— 两边打架，权重信号被削弱。
 * 站内链接暂时仍写 `.html`（会吃一次 308，能跑通；要不要一并改另议）。
 */
function pageUrl(rel) {
  const clean = String(rel ?? '').replace(/\.html$/, '');
  if (clean === '' || clean === 'index') return `${SITE_URL}/`;
  return `${SITE_URL}/${clean}`;
}

function robotsTxt() {
  return [
    '# DSH 百科：内容页都欢迎抓取；只挡推广页与构建产物。',
    '# 分区页与词条页都是构建期渲染好的静态 HTML，不需要执行 JavaScript。',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /promo',
    '',
    '# AI 抓取器：与上面的 * 一致（本来就全站放行），这里只是把态度写明。',
    '# 机器可读入口：/llms.txt（站点索引）与 /llms-full.txt（全站正文纯文本转储）。',
    'User-agent: GPTBot',
    'Allow: /',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'User-agent: ChatGPT-User',
    'Allow: /',
    'User-agent: ClaudeBot',
    'Allow: /',
    'User-agent: PerplexityBot',
    'Allow: /',
    'User-agent: Google-Extended',
    'Allow: /',
    'User-agent: Applebot-Extended',
    'Allow: /',
    'User-agent: CCBot',
    'Allow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * `llms.txt` —— 给大模型看的站点索引（约定见 llmstxt.org）：
 * 一行标题、一段概述、然后是分门别类的链接清单。
 * 我们额外把**数据接口**也列出来：这个站的 JSON 就是它的"底稿"。
 */
function llmsTxt(model, entryOutputs, indexes = []) {
  const L = [
    '# DSH 百科',
    '',
    '> 一站式的 DeepSeek Harness 中文百科：12 个一级分区，每条词条都写明出处与快照日期。',
    '> 全部页面都是构建期渲染好的静态 HTML，**不需要执行 JavaScript**；',
    `> 机器可读数据在 ${SITE_URL}/data/ 下（见文末「数据接口」）。`,
    '',
    '## 分区',
    '',
  ];
  for (const zone of model.zones) {
    // 分区标题与描述挂在 `zone.data` 上（不是 `zone.title`）——之前写错，标题退化成 id 了。
    // 冒号只由 desc 前缀提供一次（之前格式串里还有一个 `:`，成了 `):：`）。
    const t = zone.data?.title ?? zone.zone;
    const d = zone.data?.desc ? `：${String(zone.data.desc).replace(/\s+/g, ' ').trim()}` : '';
    L.push(`- [${t}](${pageUrl(`${zone.zone}.html`)})${d}`);
  }
  L.push('', '## 索引页', '');
  L.push(`- [全部词条（按标签与平台）](${pageUrl('tags.html')}): 按类型/标签/平台浏览全站词条`);
  L.push(`- [维护者名册](${pageUrl('maintainers.html')}): 每条词条由谁维护`);
  L.push(`- [关于本站](${pageUrl('about.html')}): 收录口径、核实方式、许可与免责`);
  for (const index of indexes) L.push(`- [${index.name}](${pageUrl(`${index.kind}/${index.slug}.html`)}): ${index.count} 条`);
  L.push('', '## 词条', '');
  const entries = [...entryOutputs.values()]
    .filter((o) => o.status !== 'deleted' && o.status !== 'draft')
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  for (const o of entries) {
    const s = o.summary ? `：${String(o.summary).replace(/\s+/g, ' ').trim()}` : '';
    L.push(`- [${o.title ?? o.id}](${pageUrl(`${o.kind}/${o.n}.html`)}):${s}`);
  }
  L.push(
    '',
    '## 数据接口',
    '',
    `- [词条清单](${SITE_URL}/data/registry.json): 全站词条 id / 类型 / 标题 / 更新日期`,
    `- [分类体系](${SITE_URL}/data/taxonomy.json): 类型、标签、平台`,
    `- [关系图](${SITE_URL}/data/graph.json): **人工核实过的**关系（前置/相关/教程引用/整合包引用），带出处`,
    `- [单条词条](${SITE_URL}/data/entries/<kind>-<n>.json): 例如 ${SITE_URL}/data/entries/plugin-2.json`,
    `- [分区数据](${SITE_URL}/data/zones/<zone>.json): 例如 ${SITE_URL}/data/zones/plugins.json`,
    '',
    '## 全站正文',
    '',
    `- [llms-full.txt](${SITE_URL}/llms-full.txt): 所有词条的正文纯文本转储（便于直接阅读/引用）`,
    '',
    '## 出处与许可',
    '',
    '- 每条词条的信息表里都写明数据来源与快照日期；引用我们的数字时请一并标明快照日期。',
    '- 本站是社区百科，不是官方文档；官方契约以 `DSH-PackForge/DSH-PackForge` 仓库为准。',
    '',
  );
  return L.join('\n');
}

/** `llms-full.txt` —— 全站正文的纯文本转储（用构建期已经渲染好的 HTML 去标签） */
function llmsFullTxt(entryOutputs) {
  const strip = (html) =>
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const entries = [...entryOutputs.values()]
    .filter((o) => o.status !== 'deleted' && o.status !== 'draft')
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  const parts = [
    '# DSH 百科 · 全站正文转储',
    '',
    '> 这是 dshbaike.com 上所有词条的正文纯文本版本，便于直接检索与引用。',
    `> 每条上方给出规范地址与更新日期；机器可读的结构化版本在 ${SITE_URL}/data/ 下。`,
    '',
  ];
  for (const o of entries) {
    parts.push('---', '', `## ${o.title ?? o.id}`, '');
    parts.push(`- 地址：${pageUrl(`${o.kind}/${o.n}.html`)}`);
    parts.push(`- 类型：${o.kind}/${o.n}`);
    if (o.updatedAt) parts.push(`- 更新：${String(o.updatedAt).slice(0, 10)}`);
    if (o.summary) parts.push('', `> ${String(o.summary).replace(/\s+/g, ' ').trim()}`);
    const body = strip(o.html);
    if (body) parts.push('', body);
    parts.push('');
  }
  return parts.join('\n');
}

/** 所有该被收录的页面：首页 + 分区页 + 词条页（墓碑不进 sitemap） */
function sitemapUrls(model, entryOutputs, indexes = []) {
  const list = [
    { loc: `${SITE_URL}/`, lastmod: null },
    { loc: pageUrl('tags.html'), lastmod: null },
    { loc: pageUrl('about.html'), lastmod: null },
    { loc: pageUrl('maintainers.html'), lastmod: null },
    // 全量插件生态图（第三方项目，构建期拷进 web/mesh/）
    { loc: `${SITE_URL}/mesh/`, lastmod: null },
  ];
  for (const index of indexes) list.push({ loc: pageUrl(`${index.kind}/${index.slug}.html`), lastmod: null });
  for (const zone of model.zones) list.push({ loc: pageUrl(`${zone.zone}.html`), lastmod: zone.data?.updatedAt ?? null });
  for (const output of entryOutputs.values()) {
    // 墓碑（deleted）与草稿（draft）都不进 sitemap：
    // 前者是"保留链接但不该被搜到"，后者是"还没写完、不该被搜索引擎当内容推荐"
    if (output.status === 'deleted' || output.status === 'draft') continue;
    list.push({
      loc: pageUrl(`${output.kind}/${output.n}.html`),
      lastmod: output.updatedAt ?? null,
    });
  }
  // 按 loc 排序保证逐字节确定性（两次构建必须一致）
  return list.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/* 维度索引页（P1 长尾组合页，docs/10 §7）                              */
/*                                                                     */
/* 目标查询是「某一类东西」：`支持 .dspack 的启动器`、`Windows 上的 DSH`。 */
/* 页面内容全部来自已有结构化字段（分区条目的 tags / platforms + 词条的 tags）， */
/* 所以新增一条词条，相关索引页会在下次构建自动更新，零人工维护。          */
/*                                                                     */
/* 两条硬规矩：① 去重后不足 2 条**不发页**（薄页伤站点）；② 按 entry/名字去重 */
/* （同一条目可能登记在多个分区，如「裸 dsh 命令行」）。                    */
/* ------------------------------------------------------------------ */

function loadIndexSlugs() {
  const file = fromRoot('data', 'index-slugs.yml');
  if (!exists(file)) return { tags: {} };
  const out = { tags: {} };
  let section = null;
  for (const line of readText(file).split(/\r?\n/)) {
    const sec = /^([a-zA-Z]+):\s*$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    if (!section) continue;
    const m = /^\s{2}(.+?):\s*(\S+)\s*$/.exec(line);
    if (m) {
      if (!out[section]) out[section] = {};
      out[section][m[1].trim()] = m[2].trim();
    }
  }
  return out;
}

/** 标签名 → URL 片段：有登记用登记，没有则退化成稳定的短哈希（不随其它标签增删而变） */
function slugFor(name, map, prefix) {
  const explicit = map?.[name];
  if (explicit) return explicit;
  const ascii = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (ascii) return ascii;
  return `${prefix}-${createHash('sha1').update(String(name)).digest('hex').slice(0, 6)}`;
}

/**
 * 把分区条目与词条按维度聚成索引。
 * 返回 [{ kind: 'tag'|'platform', name, slug, items: [...] }]，按名字排序保证确定性。
 */
function buildDimensionIndexes(model, entryOutputs) {
  const slugs = loadIndexSlugs();
  const buckets = { tag: new Map(), platform: new Map() };
  const push = (dim, name, item) => {
    if (!name) return;
    if (!buckets[dim].has(name)) buckets[dim].set(name, new Map());
    const key = item.entry ?? `name:${item.name}`;
    const bag = buckets[dim].get(name);
    if (!bag.has(key)) bag.set(key, item);
  };

  // ① 分区条目：tags 与 platforms
  for (const zone of model.zones) {
    const data = zone.data ?? {};
    const zoneTitle = data.title ?? zone.zone;
    for (const item of Array.isArray(data.items) ? data.items : []) {
      if (!item || isMissing(item.name)) continue;
      const parsed = parseEntryId(item.entry);
      const base = {
        name: String(item.name),
        blurb: isMissing(item.blurb) ? null : String(item.blurb),
        entry: parsed?.id ?? null,
        zone: zone.zone,
        zoneTitle,
      };
      for (const t of Array.isArray(item.tags) ? item.tags : []) push('tag', String(t), base);
      for (const p of Array.isArray(item.platforms) ? item.platforms : []) push('platform', String(p), base);
    }
  }

  // ② 词条自己的 tags（词条侧的标签词表与分区条目不同，两边都要收）
  for (const output of entryOutputs.values()) {
    if (output.status === 'deleted') continue;
    const base = {
      name: output.title ?? output.id,
      blurb: output.summary ?? null,
      entry: output.id,
      zone: output.zone?.id ?? null,
      zoneTitle: output.zone?.title ?? null,
    };
    for (const t of output.tags ?? []) push('tag', String(t), base);
  }

  const result = [];
  for (const dim of ['tag', 'platform']) {
    for (const [name, bag] of buckets[dim]) {
      const items = [...bag.values()];
      if (items.length < 2) continue; // 门槛：薄页不发
      result.push({
        kind: dim,
        name,
        slug: slugFor(name, slugs.tags, 't'),
        count: items.length,
        items: sortBy(items, (i) => i.name),
      });
    }
  }
  return sortBy(result, (i) => `${i.kind}|${i.name}`);
}

/** 索引页的静态内容：标题 + 说明 + 条目列表 + 维度互链 */
function prerenderIndex(index, entryOutputs, siblings = []) {
  const L = [];
  const dimZh = index.kind === 'tag' ? '标签' : '平台';
  L.push('<div class="prerender" data-prerender="index">');
  // 面包屑也由构建期写（前端不渲染这一页的正文）：首页 › 标签/平台 › 本条
  L.push('<nav class="crumbs" aria-label="面包屑"><ol>');
  L.push(`<li><a href="${BASE}">首页</a></li>`);
  L.push(`<li><span>${dimZh}</span></li>`);
  L.push(`<li><span>${escapeHtml(index.name)}</span></li>`);
  L.push('</ol></nav>');
  L.push('<article class="prose">');
  L.push(`<h1>${escapeHtml(index.name)}：共 ${index.count} 条</h1>`);
  L.push(`<p>带「${escapeHtml(index.name)}」${dimZh}的 DSH 客户端、启动器与相关词条清单。` +
    '每条给出名字、一句话说明与词条链接；按名字排序。</p>');
  L.push('<ul>');
  for (const item of index.items) {
    const label = escapeHtml(item.name);
    const parsed = parseEntryId(item.entry);
    const name = parsed ? `<a href="${parsed.kind}/${parsed.n}.html">${label}</a>` : label;
    const blurb = item.blurb ? ` —— ${escapeHtml(item.blurb)}` : '';
    const zone = item.zone ? ` <span class="faint">（${escapeHtml(item.zoneTitle ?? item.zone)}）</span>` : '';
    L.push(`<li>${name}${zone}${blurb}</li>`);
  }
  L.push('</ul>');

  // 同一维度的其它索引页互链（爬虫的横向入口，也方便读者继续逛）
  const others = siblings.filter((s) => s.kind === index.kind && s.slug !== index.slug);
  if (others.length) {
    L.push(`<h2>其它${dimZh}索引</h2>`);
    L.push('<ul>');
    for (const s of sortBy(others, (s) => s.name)) {
      L.push(`<li><a href="${s.kind}/${s.slug}.html">${escapeHtml(s.name)}（${s.count} 条）</a></li>`);
    }
    L.push('</ul>');
  }

  L.push('</article>');
  L.push('</div>');
  return L.join('\n');
}

function renderIndexPage(template, index, entryOutputs, siblings = []) {
  const dimZh = index.kind === 'tag' ? '标签' : '平台';
  const title = `${index.name}（${dimZh}）：共 ${index.count} 条 | DSH百科`;
  const desc = `带「${index.name}」${dimZh}的 DSH 启动器、客户端与词条清单，共 ${index.count} 条，含每条的说明与词条链接。`;
  return applyTemplate(template, {
    title,
    desc,
    prerender: prerenderIndex(index, entryOutputs, siblings),
    canonical: pageUrl(`${index.kind}/${index.slug}.html`),
    payload: { base: BASE, page: 'static', kind: index.kind, n: null, title: index.name },
  });
}

/**
 * 「按标签/平台浏览」内链行：把这一页涉及的名字接到对应的索引页上。
 * 只接**有索引页**的那些（构建期有门槛：不足 2 条不发页），所以不会出现死链。
 */
function indexLinkRow(names, indexes, kind) {
  const byName = new Map(indexes.filter((i) => i.kind === kind).map((i) => [i.name, i]));
  const hits = [];
  for (const n of names ?? []) {
    const hit = byName.get(String(n));
    if (hit && !hits.includes(hit)) hits.push(hit);
  }
  if (!hits.length) return null;
  const dimZh = kind === 'tag' ? '标签' : '平台';
  const links = sortBy(hits, (h) => h.name)
    .map((h) => `<a href="${h.kind}/${h.slug}.html">${escapeHtml(h.name)}</a>（${h.count}）`)
    .join(' · ');
  return `<p class="prerender__indexlinks">按${dimZh}浏览：${links}</p>`;
}

/** tags.html：所有维度索引页的汇总入口 */
function renderTagsHub(template, indexes) {
  const L = [];
  L.push('<div class="prerender" data-prerender="index">');
  L.push('<article class="prose">');
  L.push(`<h1>全部索引：按标签与平台浏览（${indexes.length} 页）</h1>`);
  L.push('<p>本站把「某一类东西」也做成页面：按标签、按平台列出对应的启动器、客户端与词条。' +
    '每一页都给出名字、一句话说明与词条链接。</p>');
  for (const [kind, dimZh] of [['tag', '标签'], ['platform', '平台']]) {
    const list = sortBy(indexes.filter((i) => i.kind === kind), (i) => i.name);
    if (!list.length) continue;
    L.push(`<h2>按${dimZh}（${list.length}）</h2>`);
    L.push('<ul>');
    for (const i of list) {
      L.push(`<li><a href="${i.kind}/${i.slug}.html">${escapeHtml(i.name)}</a>（${i.count} 条）</li>`);
    }
    L.push('</ul>');
  }
  L.push('</article>');
  L.push('</div>');
  return applyTemplate(template, {
    title: '全部索引：按标签与平台浏览 | DSH百科',
    desc: `按标签与平台浏览 DSH 百科：${indexes.length} 个索引页，覆盖启动器、客户端、插件、整合包与教程。`,
    prerender: L.join('\n'),
    canonical: pageUrl('tags.html'),
    payload: { base: BASE, page: 'static', kind: null, n: null, title: '全部索引' },
  });
}

/* ------------------------------------------------------------------ */
/* 维护者名册（maintainers.html）                                       */
/*                                                                     */
/* 数据源就是词条自己的 `maintainers`（词条级维护者，docs/14）——不另立名单， */
/* 所以谁维护了哪一条，永远和词条页面说的是同一份事实。                    */
/* ------------------------------------------------------------------ */

/** maintainers 可能是 `"login"`（单元素被 YAML 解析成标量）、`[a, b]`、空数组或 null */
function normalizeMaintainers(value) {
  if (isMissing(value)) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/** 登录名 → 他维护的词条 */
function collectMaintainers(entryOutputs) {
  const by = new Map();
  for (const output of entryOutputs.values()) {
    if (output.status === 'deleted') continue;
    for (const login of normalizeMaintainers(output.meta?.maintainers)) {
      if (!by.has(login)) by.set(login, []);
      by.get(login).push({ id: output.id, kind: output.kind, n: output.n, title: output.title ?? output.id });
    }
  }
  return [...by.entries()]
    .map(([login, entries]) => ({ login, entries: sortBy(entries, (e) => e.id) }))
    .sort((a, b) => (a.login.toLowerCase() < b.login.toLowerCase() ? -1 : 1));
}

function renderMaintainersPage(template, entryOutputs) {
  const people = collectMaintainers(entryOutputs);
  const L = [];
  L.push('<div class="prerender" data-prerender="maintainers">');
  L.push('<h1>维护者名册</h1>');
  L.push('<p>本站的词条可以由人<strong>担任维护者</strong>：担任之后，改这一条的请求会先请你过目，' +
    '上游变了、内容过时了也能 @ 到你。这一页把所有愿意维护词条的人挂在一起——' +
    '名单不是我们指定的，而是每条词条自己的 <code>maintainers</code> 汇总出来的。</p>');

  if (!people.length) {
    L.push('<p class="faint">现在还没有人担任维护者。第一位会出现在这里——' +
      '在任意词条页点「我来维护」，或者直接在 Issue 里说一声就行。</p>');
  } else {
    L.push('<ul class="roster">');
    for (const person of people) {
      const login = escapeHtml(person.login);
      const mono = escapeHtml(person.login.slice(0, 1).toUpperCase());
      L.push('<li class="roster__item">');
      L.push(`<span class="roster__avatar"><span class="roster__mono" aria-hidden="true">${mono}</span>` +
        `<img src="https://github.com/${encodeURIComponent(person.login)}.png" alt="" loading="lazy" ` +
        'referrerpolicy="no-referrer" width="48" height="48"></span>');
      L.push('<span class="roster__body">');
      L.push(`<a class="roster__name" href="https://github.com/${encodeURIComponent(person.login)}" ` +
        `rel="noopener noreferrer external" target="_blank">${login}</a>`);
      L.push(`<span class="roster__count">维护 ${person.entries.length} 条</span>`);
      L.push('<span class="roster__entries">');
      L.push(sortBy(person.entries, (e) => e.kind === 'launcher' ? 0 : 1)
        .map((e) => `<a href="${e.kind}/${e.n}.html">${escapeHtml(e.title)}</a>`)
        .join(' · '));
      L.push('</span>');
      L.push('</span>');
      L.push('</li>');
    }
    L.push('</ul>');
    L.push(`<p class="faint">共 ${people.length} 位维护者，覆盖 ${people.reduce((a, p) => a + p.entries.length, 0)} 条词条。` +
      '想让你的名字也出现在这里：在词条页点「我来维护」。</p>');
  }

  L.push('<h2>担任维护者之后你会负责什么</h2>');
  L.push('<ul>');
  L.push('<li>这一条被改动前，会先请你过目（你就是它的第一道关）；</li>');
  L.push('<li>上游变了、链接挂了、数字过时了，我们可以 @ 到你；</li>');
  L.push('<li>你自己改这一条时，可以直接批自己的请求（不必等别人）。</li>');
  L.push('</ul>');
  L.push('<p class="faint">不要求你会写 Markdown、也不要求你本地跑脚本——' +
    '表单提交后由自动化改文件并开 PR。</p>');

  L.push('</div>');
  return applyTemplate(template, {
    title: '维护者名册 | DSH百科',
    desc: `担任 DSH百科词条维护者的人：共 ${people.length} 位，覆盖 ${people.reduce((a, p) => a + p.entries.length, 0)} 条词条。`,
    prerender: L.join('\n'),
    canonical: pageUrl('maintainers.html'),
    payload: { base: BASE, page: 'static', kind: null, n: null, title: '维护者名册' },
  });
}

/**
 * 各类词条的「搜索意图词」：写进 `<title>`，命中「怎么装 / 是什么 / 踩坑」这类查询。
 * 学 MC百科的标题写法——他们把**缩写 + 中文名 + 英文原名**全占在标题里
 * （实测：`[JEI]JEI物品管理器 (Just Enough Items)` 对「JEI 怎么用」排名第一），
 * 用户怎么搜都更容易命中。
 */
const ENTRY_INTENT = {
  plugin: '是什么、怎么装、兼容与踩坑',
  pack: '怎么装、包含什么、兼容性',
  launcher: '怎么装、怎么用、兼容性',
  tutorial: '步骤与要点',
  concept: '是什么、为什么',
  mcp: '是什么、怎么接',
  spec: '是什么、怎么遵守',
  source: '数据来源与口径',
};
const ENTRY_INTENT_FALLBACK = '是什么、怎么用';

/**
 * 词条页的结构化数据（schema.org `TechArticle`）。
 *
 * 为什么值得做：搜索引擎用它生成富结果，AI 摘要用它判断"这一页在讲什么、什么时候更新的"。
 * 只写**确定有值**的字段（标题/描述/别名/更新时间/所属站点），不编造关系与作者——
 * 关系要等 `relations` 真的填了再挂（那时用 `about`/`citation` 指向对方页面）。
 * `<` 一律转义成 `\u003c`，避免正文里的 `</script>` 之类把标签截断。
 */
function entryJsonLd(output) {
  const url = pageUrl(`${output.kind}/${output.n}.html`);
  const alt = [output.titleEn, ...(Array.isArray(output.aliases) ? output.aliases : [])].filter(Boolean);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: output.title ?? output.id,
    description: output.summary ?? undefined,
    inLanguage: 'zh-CN',
    url,
    mainEntityOfPage: url,
    isPartOf: { '@type': 'WebSite', name: 'DSH百科', url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: 'DSH百科', url: `${SITE_URL}/` },
    ...(alt.length ? { alternateName: alt } : {}),
    ...(output.updatedAt ? { dateModified: String(output.updatedAt).slice(0, 10) } : {}),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** 把一段 JSON-LD 塞进 </head> 之前（模板里没有占位符，这样不用改模板） */
function injectJsonLd(html, json) {
  const tag = `<script type="application/ld+json">${json}</script>`;
  const s = String(html ?? '');
  return s.includes('</head>') ? s.replace('</head>', `${tag}</head>`) : `${tag}${s}`;
}

function renderEntryPage(template, output, entryOutputs, indexes = []) {
  // 标题三合一：中文名 + 英文原名 + 意图词。别名不塞进标题（太长会被截断），
  // 放到描述开头——既帮助匹配，又保持标题干净。
  const name = output.title ?? output.id;
  const en = output.titleEn ? `（${output.titleEn}）` : '';
  const intent = ENTRY_INTENT[output.kind] ?? ENTRY_INTENT_FALLBACK;
  const title = `${name}${en}：${intent} | DSH百科`;
  const aliasBit = Array.isArray(output.aliases) && output.aliases.length ? `别名：${output.aliases.join('、')}。` : '';
  const desc = `${aliasBit}${output.summary ?? ''}`.trim();
  return injectJsonLd(applyTemplate(template, {
    title,
    desc,
    prerender: prerenderEntry(output, entryOutputs, indexes),
    canonical: pageUrl(`${output.kind}/${output.n}.html`),
    // 草稿页也 noindex（spec/1 那种占位条目就是草稿）
    noindex: output.status === 'deleted' || output.status === 'draft',
    payload: { base: BASE, page: 'entry', kind: output.kind, n: output.n, title: output.title },
  }), entryJsonLd(output));
}

function renderZonePage(template, output, entryOutputs, indexes = []) {
  const title = `${output.title ?? output.id} | DSH百科`;
  const desc = output.desc ?? '';
  return applyTemplate(template, {
    title,
    desc,
    prerender: prerenderZone(output, entryOutputs, indexes),
    canonical: pageUrl(`${output.id}.html`),
    payload: { base: BASE, page: 'zone', zone: output.id, title: output.title },
  });
}

/**
 * 生态全景图**不由本站渲染**（评审 2026-10-02）：全量插件生态图改用第三方项目
 * （`vendor/dsh-plugin-mesh`，MIT，构建期拷进 `web/mesh/`）。
 *
 * 本文件仍然产出 `data/graph.json` —— 那是「我们核实过的关系」的数据契约，
 * 与那张全量图是两种东西：它的边是 topic 共现/同作者（相似度），我们的边带出处。
 * 将来词条页要做「以某条词条为圆心的邻域星图」时，读的就是这份数据。
 */

/**
 * 第三方全量生态图的托管壳（`web/mesh/index.html`）。
 *
 * 它把 vendored 应用整屏嵌进来，并在上面压一条说明：**这东西是谁的、数据谁采的、
 * 哪些不是我们的结论**——因为那张图不是我们做的，而它的界面右上角挂的是它自己的作者。
 * 说明里的快照日期直接读 vendored 的 `data/mesh.json`，所以页面上写的日期
 * 永远和实际托管的那份数据一致（不会出现「说明写着 10-01、数据已经换成 10-05」）。
 */
function renderMeshShell(template, mesh) {
  const meta = mesh?.meta ?? {};
  const nodes = Number.isFinite(Number(meta.indexedNodes))
    ? Number(meta.indexedNodes)
    : Array.isArray(mesh?.nodes)
      ? mesh.nodes.length
      : null;
  const edges = Number.isFinite(Number(meta.sampleEdges))
    ? Number(meta.sampleEdges)
    : Array.isArray(mesh?.edges)
      ? mesh.edges.length
      : null;
  const gen = meta.generatedAt ? String(meta.generatedAt).slice(0, 10) : null;
  const bits = [gen ? `上游快照 ${gen}` : null, nodes ? `${nodes} 个仓库` : null, edges ? `${edges} 条关系` : null].filter(Boolean);
  const fallback = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>{{TITLE}}</title></head><body></body></html>';
  const filled = (template ?? fallback).split('{{MESH_SNAPSHOT}}').join(escapeHtml(bits.join(' · ')));
  return applyTemplate(filled, {
    title: '全量插件生态图（第三方） | DSH百科',
    desc: '第三方项目 dsh-plugin-mesh（MIT）的全量 DSH 插件生态图：本站原样托管、未做修改；数据由上游每小时自动采集，其中的数字与分类未经本站核实。',
    canonical: `${SITE_URL}/mesh/`,
    payload: { base: BASE, page: 'static', title: '全量插件生态图' },
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
