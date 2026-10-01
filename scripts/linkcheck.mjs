#!/usr/bin/env node
/**
 * linkcheck.mjs —— 外链可达性检查（可选，不参与 build 必需路径）。
 *
 * 用法（docs/10 §3）：
 *   node scripts/linkcheck.mjs            # 干跑：只列出要检查的链接
 *   node scripts/linkcheck.mjs --write    # HEAD/GET 检查后写 collected/links.json
 *
 * 只读 data/**、collected/**，写 collected/links.json（采集产物目录）。
 */

import path from 'node:path';
import process from 'node:process';

import { loadCollected, loadEntities, loadRegistry, loadSources, loadZoneFiles } from './lib/data.mjs';
import { COLLECTED_DIR } from './lib/data.mjs';
import { fromRoot, isMissing, sortStrings, toJson, writeFileAtomic } from './lib/util.mjs';
import { SchemaError } from './lib/yaml.mjs';

const USAGE = `用法：node scripts/linkcheck.mjs [--write] [--timeout=毫秒] [--concurrency=N] [--quiet]

  --write           真的发请求，并把结果写进 collected/links.json
  --timeout=毫秒     单条超时（默认 10000）
  --concurrency=N   并发数（默认 6）
  --quiet           只在结尾打印摘要

不加 --write 时是干跑：只列出要检查的链接。`;

const SKIP_URL = [
  /^https?:\/\/(?:www\.)?(?:github|npmjs)\.com\/[^/]+\/[^/]+\/?$/,
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\.0\.0\.1/i,
];

function main(argv) {
  const flags = { write: false, timeout: 10000, concurrency: 6, quiet: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (arg === '--write') {
      flags.write = true;
      continue;
    }
    if (arg === '--quiet') {
      flags.quiet = true;
      continue;
    }
    const timeout = /^--timeout=(\d+)$/.exec(arg);
    if (timeout) {
      flags.timeout = Number(timeout[1]);
      continue;
    }
    const conc = /^--concurrency=(\d+)$/.exec(arg);
    if (conc) {
      flags.concurrency = Math.max(1, Number(conc[1]));
      continue;
    }
    process.stderr.write(`不认识的选项：${arg}\n\n${USAGE}\n`);
    return 2;
  }

  const log = (message) => {
    if (!flags.quiet) process.stdout.write(`${message}\n`);
  };

  const urls = collectLinks();
  log(`待检查链接 ${urls.length} 条`);
  if (!flags.write) {
    for (const url of urls) log(`  · ${url}`);
    process.stdout.write(`linkcheck dry-run: ${urls.length} links（加 --write 才发请求并写 collected/links.json）\n`);
    return 0;
  }

  return run(urls, flags, log);
}

async function run(urls, flags, log) {
  const results = new Array(urls.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(flags.concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await checkOne(urls[index], flags.timeout);
      log(`  ${results[index].status.padEnd(4)} ${results[index].code ?? '—'} ${urls[index]}`);
    }
  });
  await Promise.all(workers);

  const checkedAt = new Date().toISOString().slice(0, 10);
  const payload = {
    checkedAt,
    links: results
      .map((item) => ({ url: item.url, status: item.status, code: item.code }))
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
  };
  const abs = path.join(COLLECTED_DIR, 'links.json');
  writeFileAtomic(abs, toJson(payload));
  const ok = results.filter((r) => r.status === 'ok').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  process.stdout.write(`linkcheck ok: ${results.length} links, ${ok} ok, ${fail} fail → ${fromRoot('collected', 'links.json') === abs ? 'collected/links.json' : abs}\n`);
  return fail > 0 ? 0 : 0; // 死链降级为 warn，不影响退出码
}

async function checkOne(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'dsh-pedia-linkcheck/1.0 (+https://dshbaike.com)' },
    });
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'dsh-pedia-linkcheck/1.0 (+https://dshbaike.com)' },
      });
    }
    const code = response.status;
    return { url, code, status: code >= 200 && code < 400 ? 'ok' : code === 429 || code >= 500 ? 'warn' : 'fail' };
  } catch (error) {
    return { url, code: null, status: 'fail', error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 链接收集                                                            */
/* ------------------------------------------------------------------ */

function collectLinks() {
  const found = new Set();

  for (const zone of loadZoneFiles()) {
    for (const item of zone.data?.items ?? []) {
      for (const [key, value] of Object.entries(item?.links ?? {})) {
        if (!isMissing(value)) found.add(String(value));
      }
    }
    for (const source of zone.data?.sources ?? []) {
      if (!isMissing(source?.url)) found.add(String(source.url));
    }
  }

  const sources = loadSources();
  const sourceList = Array.isArray(sources?.data?.sources) ? sources.data.sources : [];
  for (const source of sourceList) {
    if (!isMissing(source?.url)) found.add(String(source.url));
    if (!isMissing(source?.linkOut)) found.add(String(source.linkOut));
  }

  for (const entity of loadEntities()?.data?.entities ?? []) {
    for (const ref of entity.refs ?? []) {
      if (!isMissing(ref?.url)) found.add(String(ref.url));
    }
  }

  const collected = loadCollected();
  for (const link of collected.links?.links ?? []) {
    if (!isMissing(link?.url)) found.add(String(link.url));
  }

  const registry = loadRegistry();
  void registry;

  return sortStrings([...found].filter((url) => /^https?:\/\//i.test(url) && !SKIP_URL.some((re) => re.test(url))));
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof SchemaError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
