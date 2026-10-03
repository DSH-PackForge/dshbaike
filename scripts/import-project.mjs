#!/usr/bin/env node
/**
 * import-project.mjs —— 把一个上游项目变成一条词条草稿。
 *
 * 为什么需要（评审）：作者只想说一句「这个插件是我做的，收一下」，不该被迫学我们的
 * schema。这个脚本把**机器读得到的东西**全部填好——star / 许可证 / 版本 / 快照日期、
 * 正文（照搬它自己的 README）、各类链接——只把真正需要人判断的少数格留成 TODO。
 *
 * 用法：
 *   node scripts/import-project.mjs owner/repo [--kind plugin] [--user 你的GitHub名]
 *                                      [--dry] [--n 3] [--title 标题]
 *
 * 约定：
 *   · 默认**写文件**并调用 registry 的 allocate() 领号；--dry 只打印，不碰任何文件；
 *   · 正文优先取**简体中文 README**（README_ZH / README.zh-CN / README.zh / README），
 *     照搬它自己的话，不做我的理解与重构；
 *   · 相对链接一律改成仓库绝对地址（本站渲染器只认绝对地址，否则退化成纯文本）；
 *   · 网络访问都带重试；本脚本**不参与构建**，构建仍是离线确定性的。
 *
 * 两步之外的事由人决定：`category`（taxonomy 叶子）与 `positioning` 留 TODO，
 * 因为那是编辑判断，不是机器能推的。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UA = 'Mozilla/5.0 (compatible; dshbaike-import/1.0; +https://dshbaike.com)';
const KINDS = ['concept', 'plugin', 'pack', 'launcher', 'client', 'mcp', 'skill', 'preset',
  'recipe', 'theme', 'asset', 'tool', 'spec', 'tutorial', 'source'];

/* ------------------------------------------------------------------ 参数 */

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const repoArg = argv.find((a) => /^[\w.-]+\/[\w.-]+$/.test(a));
if (!repoArg) {
  console.error('用法：node scripts/import-project.mjs owner/repo [--kind plugin] [--user <用户名>] [--dry] [--n <号>] [--title <标题>]');
  process.exit(1);
}
const [owner, repo] = repoArg.split('/');
const kind = String(flag('kind', 'plugin'));
if (!KINDS.includes(kind)) { console.error('  ❌ --kind 只能是：' + KINDS.join(' | ')); process.exit(1); }
const dry = argv.includes('--dry');
const user = flag('user', null);
const forcedN = flag('n', null);

/* ------------------------------------------------------------------ 取数据 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, asJson, tries = 6) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: asJson ? 'application/vnd.github+json' : '*/*' },
        redirect: 'follow',
      });
      if (res.status === 404) return null;
      if (!res.ok) { await sleep(600); continue; }
      return asJson ? await res.json() : await res.text();
    } catch { await sleep(900); }
  }
  return null;
}

const api = (p, asJson = true) => fetchWithRetry('https://api.github.com/repos/' + owner + '/' + repo + p, asJson);
const raw = (p) => fetchWithRetry('https://raw.githubusercontent.com/' + owner + '/' + repo + '/HEAD/' + p, false);

const meta = await api('');
if (!meta) { console.error('  ❌ 取不到仓库信息（' + owner + '/' + repo + '）——拼写或网络问题'); process.exit(1); }
console.log('  仓库：' + meta.full_name + ' · star ' + meta.stargazers_count + ' · ' + (meta.license?.spdx_id ?? '无许可证'));
console.log('  描述：' + (meta.description ?? '（无）'));

const pkgText = await raw('package.json');
let pkg = null;
try { pkg = pkgText ? JSON.parse(pkgText) : null; } catch { pkg = null; }
const npmName = pkg?.name && !pkg.private ? pkg.name : null;
const version = pkg?.version ?? null;
const dsh = pkg?.dsh ?? null;

/* ------------------------------------------------------------------ 正文：照搬 README */

const README_CANDIDATES = ['README_ZH.md', 'README.zh-CN.md', 'README.zh.md', 'README.zh_CN.md', 'README.md'];
let readme = null; let readmeFile = null;
for (const name of README_CANDIDATES) {
  const t = await raw(name);
  if (t) { readme = t; readmeFile = name; break; }
}
if (!readme) console.log('  ⚠ 没找到 README，正文留 TODO');
console.log('  正文来源：' + (readmeFile ?? '（无）') + (readmeFile && /ZH|zh/.test(readmeFile) ? '（简体中文版）' : ''));

const BLOB = 'https://github.com/' + owner + '/' + repo + '/blob/' + (meta.default_branch ?? 'main') + '/';

/** 轻处理：去 HTML/徽章/图片、去它自己的「目录」小节与 H1、相对链接转绝对 */
function cleanReadme(md) {
  const lines = String(md).split('\n');
  const out = [];
  let skipLevel = 0;
  for (const line of lines) {
    if (/^\s*<\/?(p|div|table|tr|td|a|img|h1|h3)\b/i.test(line)) continue;
    const h = line.match(/^(#+)\s*(.+)$/);
    if (h && h[2].trim() === '目录') { skipLevel = h[1].length; continue; }
    if (skipLevel) {
      const m = line.match(/^(#+)\s/);
      if (m && m[1].length <= skipLevel) skipLevel = 0; else continue;
    }
    if (/^#\s/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n')
    .replace(/\]\((?!(?:https?:|mailto:|#|\/|\[\[))([^)\s]+)\)/g, (_m, t) => '](' + BLOB + t + ')')
    .replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const bodyFromReadme = readme ? cleanReadme(readme) : '';

/* 清洗会丢掉 HTML 表格/徽章——如果某个小节因此空了，必须让跑的人知道，
   否则会像 dsh-TUI 的「维护团队」那样：README 里的 HTML 表格被整段删掉，页面只剩空壳。 */
if (bodyFromReadme) {
  const secs = bodyFromReadme.split(/\n(?=##\s)/);
  const empties = [];
  for (const s of secs) {
    const m = s.match(/^##\s+(.+)$/m);
    if (!m) continue;
    const rest = s.replace(/^##\s+.+$/m, '').trim();
    if (rest.length < 12) empties.push(m[1].trim());
  }
  if (empties.length) {
    console.log('  ⚠ 这些小节清洗后是空的（多半原本是 HTML 表格或纯图片，需要人工从 README 补回来）：');
    for (const e of empties) console.log('      · ' + e);
  }
}

/* ------------------------------------------------------------------ 组装词条 */

const { skeleton, quote } = await import('./lib/skeleton.mjs');
const title = String(flag('title', pkg?.name ? repo : repo));

const summary = String(meta.description ?? '').trim() || 'TODO 一句话摘要';

const body = [
  bodyFromReadme || '## TODO 第一节\n\n（这个仓库没有可照搬的 README：正文待补。）',
  '',
  '## 本站补充（待填）',
  '',
  '- TODO 分类与定位：`category` 填 taxonomy 叶子、`positioning` 用生态语境说清它解决什么问题；',
  '- TODO 生态关系：与官方地基、其它同类项目的关系；',
  '- TODO 未核实：哪些说法只有上游自述、哪些我们实测过。',
  '',
].join('\n');

/* 先让 skeleton 给出这一类的标准骨架，再把机器能确定的字段补在注释提示之后 */
let text = skeleton(kind, title, new Date().toISOString().slice(0, 10), { summary, body });

const extra = [];
extra.push('# ---- 以下字段由 scripts/import-project.mjs 从上游自动填入（快照 ' + new Date().toISOString().slice(0, 10) + '）');
extra.push('repo: ' + owner + '/' + repo);
if (npmName) extra.push('npm: ' + quote(npmName));
if (pkg && Array.isArray(pkg.bin) === false && pkg.bin && typeof pkg.bin === 'object') {
  const bins = Object.keys(pkg.bin);
  if (bins.length) extra.push('install: npm install -g ' + (dsh ? '@deepseek-ai/dsh ' : '') + npmName);
}
extra.push('entryGate: maintainer');
extra.push('entryGateNote: ' + quote(user
  ? '由项目作者 @' + user + ' 在收录表单里申请收录（走"有维护者认领"这一条门槛）。'
  : '由项目作者申请收录（走"有维护者认领"这一条门槛）；申请人待补。'));
if (user) extra.push('maintainers: [' + user + ']');
if (meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION') {
  extra.push('licenseRefs:');
  extra.push('  - id: ' + meta.license.spdx_id.toLowerCase());
  extra.push('    name: ' + meta.license.spdx_id);
  extra.push('    note: ' + quote('来自 GitHub API 的许可证字段（快照 ' + new Date().toISOString().slice(0, 10) + '）；仓库根 LICENSE 未逐字读。'));
}
extra.push('providedBy:');
extra.push('  github:');
extra.push('    at: ' + new Date().toISOString().slice(0, 10));
extra.push('    url: https://github.com/' + owner + '/' + repo);
extra.push('    fields:');
extra.push('      star: ' + meta.stargazers_count);
extra.push('      fork: ' + meta.forks_count);
if (version) extra.push('      version: ' + quote(version));
if (meta.language) extra.push('      language: ' + meta.language);
if (readmeFile) extra.push('      readme: ' + readmeFile + '（正文照搬自此）');
extra.push('      note: ' + quote('以上数字与字段取自 GitHub API 与仓库文件（快照 ' + new Date().toISOString().slice(0, 10) + '）。'));

const fmEnd = text.indexOf('\n---\n');
text = text.slice(0, fmEnd) + '\n' + extra.join('\n') + text.slice(fmEnd);

/* ------------------------------------------------------------------ 落盘 */

if (dry) {
  const outPath = flag('out', null);
  if (outPath && typeof outPath === 'string') {
    fs.writeFileSync(path.resolve(String(outPath)), text, 'utf8');
    console.log('\n  ✓ --dry + --out：已把生成内容写到 ' + outPath + '（UTF-8，未碰 data/ 与 registry）');
    console.log('  行数 ' + text.split('\n').length + ' · 字符 ' + text.length);
    process.exit(0);
  }
  console.log('\n  ── --dry：以下为生成的词条内容（未写任何文件）──\n');
  console.log(text);
  console.log('\n  行数 ' + text.split('\n').length + ' · 字符 ' + text.length);
  process.exit(0);
}

const { allocate } = await import('./lib/registry.mjs');
const today = new Date().toISOString().slice(0, 10);
const alloc = forcedN ? { n: Number(forcedN) } : allocate({ kind, title, now: today });
const target = path.join(ROOT, 'data', kind, alloc.n + '.md');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, text);
console.log('\n  ✓ 已写入 data/' + kind + '/' + alloc.n + '.md（status: draft，不会上线）');
console.log('  下一步：补 category 与 positioning 两个 TODO，跑 node scripts/validate.mjs，');
console.log('          然后按 docs/14 的流程发布（改 status 为 published 并核对 registry）。');
