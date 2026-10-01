/**
 * data.mjs —— data/** 与 collected/** 的加载层（只读）。
 *
 * 所有读取都相对于仓库根；缺文件不是错误（M1 期间 data/ 可能还没有内容），
 * 但 **YAML 解析失败一定是错误**，并且带文件名 + 行号。
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseYaml, parseYamlWithLines, SchemaError } from './yaml.mjs';
import { splitFrontMatter } from './frontmatter.mjs';
import { ENTRY_KINDS, displayPath, exists, fromRoot, listFiles, readText, sortByNumericId } from './util.mjs';

export const DATA_DIR = fromRoot('data');
export const COLLECTED_DIR = fromRoot('collected');

/* ------------------------------------------------------------------ */
/* YAML 文件                                                           */
/* ------------------------------------------------------------------ */

/** 读 YAML；文件不存在返回 null */
export function loadYamlFile(absPath) {
  if (!exists(absPath)) return null;
  const text = readText(absPath);
  const file = displayPath(absPath);
  if (text.trim() === '') return null;
  return parseYaml(text, { file });
}

/** 读 YAML + 行号表；文件不存在返回 null */
export function loadYamlFileWithLines(absPath) {
  if (!exists(absPath)) return null;
  const text = readText(absPath);
  const file = displayPath(absPath);
  if (text.trim() === '') return null;
  const { data, lines } = parseYamlWithLines(text, { file });
  return { data, lines, file };
}

/** 读 JSON（collected/**）；不存在返回 null */
export function loadJsonFile(absPath) {
  if (!exists(absPath)) return null;
  const text = readText(absPath);
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SchemaError(`JSON 解析失败：${error.message}`, {
      file: displayPath(absPath),
      line: 1,
    });
  }
}

/* ------------------------------------------------------------------ */
/* registry.yml                                                        */
/* ------------------------------------------------------------------ */

/**
 * @returns {{ data: any, lines: Map<string, number>|null, file: string|null, path: string|null }}
 */
export function loadRegistry() {
  const abs = path.join(DATA_DIR, 'registry.yml');
  const loaded = loadYamlFileWithLines(abs);
  if (!loaded) {
    return { data: { version: 1, counters: {}, entries: [] }, lines: new Map(), file: null, path: abs };
  }
  const data = loaded.data ?? {};
  if (data.counters == null) data.counters = {};
  if (data.entries == null) data.entries = [];
  if (!Array.isArray(data.entries)) {
    throw new SchemaError('`entries` 必须是序列（每项一个 `- n: …` 块）', { file: loaded.file, line: loaded.lines.get('entries') ?? 1 });
  }
  return { ...loaded, data, path: abs };
}

/* ------------------------------------------------------------------ */
/* 词条                                                                */
/* ------------------------------------------------------------------ */

/**
 * 读一个词条文件（front-matter + 正文）。
 * @param {string} kind
 * @param {number} n
 * @param {{registry?: any}} [options]
 */
export function loadEntryFile(kind, n, options = {}) {
  const abs = path.join(DATA_DIR, kind, `${n}.md`);
  const text = readText(abs);
  const rel = `${kind}/${n}`;
  const file = displayPath(abs);
  const { data, body, bodyStartLine, lines } = splitFrontMatter(text, { file });
  const registryEntry = (options.registry?.entries ?? []).find((e) => Number(e.n) === Number(n) && e.kind === kind) ?? null;
  return { kind, n, id: rel, path: abs, file, data, body, bodyStartLine, lines, registryEntry, raw: text };
}

/** 扫描 data/<kind>/*.md，返回 [{kind, n, path}]（数字升序） */
export function scanEntryFiles(kinds = ENTRY_KINDS) {
  const out = [];
  for (const kind of kinds) {
    const dir = path.join(DATA_DIR, kind);
    if (!exists(dir)) continue;
    for (const abs of listFiles(dir, { ext: '.md' })) {
      const base = path.basename(abs, '.md');
      if (!/^\d+$/.test(base)) {
        out.push({ kind, n: null, path: abs, badName: base });
        continue;
      }
      out.push({ kind, n: Number(base), path: abs });
    }
  }
  return sortByNumericId(out, (x) => x.n ?? 0);
}

/* ------------------------------------------------------------------ */
/* taxonomy / zones / 其它事实源                                        */
/* ------------------------------------------------------------------ */

export function loadTaxonomy() {
  return loadYamlFileWithLines(path.join(DATA_DIR, 'taxonomy.yml'));
}

export function loadSources() {
  return loadYamlFileWithLines(path.join(DATA_DIR, 'sources.yml'));
}

export function loadEntities() {
  return loadYamlFileWithLines(path.join(DATA_DIR, 'entities.yml'));
}

export function loadZoneFiles() {
  const dir = path.join(DATA_DIR, 'zones');
  if (!exists(dir)) return [];
  return listFiles(dir, { ext: '.yml' })
    .sort()
    .map((abs) => {
      const loaded = loadYamlFileWithLines(abs);
      if (!loaded) return null;
      const zoneName = loaded.data?.zone ?? path.basename(abs, '.yml');
      return { ...loaded, path: abs, zone: String(zoneName) };
    })
    .filter(Boolean);
}

export function loadSourceConfigs() {
  const dir = path.join(DATA_DIR, 'sources');
  if (!exists(dir)) return [];
  return listFiles(dir, { ext: '.yml' })
    .sort()
    .map((abs) => {
      const loaded = loadYamlFileWithLines(abs);
      if (!loaded) return null;
      return { ...loaded, path: abs, slug: loaded.data?.slug ?? path.basename(abs, '.yml') };
    })
    .filter(Boolean);
}

export function loadAssets() {
  const dir = path.join(DATA_DIR, 'assets');
  if (!exists(dir)) return [];
  return listFiles(dir).map((abs) => path.relative(dir, abs).split(path.sep).join('/'));
}

/* ------------------------------------------------------------------ */
/* 模板（web/*.template.html 由站点外壳工作流拥有，构建只读不改）        */
/* ------------------------------------------------------------------ */

export function loadTemplate(name) {
  const abs = fromRoot('web', name);
  if (!exists(abs)) return null;
  return { path: abs, text: readText(abs) };
}

/* ------------------------------------------------------------------ */
/* collected/**（可选；缺了构建也要能跑）                               */
/* ------------------------------------------------------------------ */

export function loadCollected() {
  return {
    market: loadJsonFile(path.join(COLLECTED_DIR, 'market.json')),
    launchers: loadJsonFile(path.join(COLLECTED_DIR, 'launchers.json')),
    awesome: loadJsonFile(path.join(COLLECTED_DIR, 'awesome.json')),
    links: loadJsonFile(path.join(COLLECTED_DIR, 'links.json')),
    packDir: path.join(COLLECTED_DIR, 'packs'),
  };
}

export function loadCollectedPacks() {
  const dir = path.join(COLLECTED_DIR, 'packs');
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ id: path.basename(f, '.json'), data: loadJsonFile(path.join(dir, f)) }))
    .filter((x) => x.data);
}

export { SchemaError };
