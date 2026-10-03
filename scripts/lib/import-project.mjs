/**
 * import-project.mjs（lib）—— 把一个上游项目变成一条词条草稿的**核心逻辑**。
 *
 * 为什么要抽成 lib：同一套逻辑有两种用法——
 *   ① 人：`node scripts/import-project.mjs owner/repo …`（CLI 薄壳）；
 *   ② 机器人：Issue 表单里作者只填仓库地址，op 直接调用它。
 * 一处实现，避免两边漂移（与 skeleton.mjs 抽出来的理由相同）。
 *
 * 设计要点：
 *   · **fetch 可注入**（默认全局 fetch）→ 单元测试可以完全离线、无网络；
 *   · 只读上游，不写任何文件；写盘由调用方决定（CLI 或 op 的 writes 契约）；
 *   · README 优先简体中文版，**整篇照搬**；相对链接一律改成仓库绝对地址。
 */

import { quote, skeleton } from './skeleton.mjs';

const UA = 'Mozilla/5.0 (compatible; dshbaike/1.0; +https://dshbaike.com)';
const README_CANDIDATES = ['README_ZH.md', 'README.zh-CN.md', 'README.zh.md', 'README.zh_CN.md', 'README.md'];
const BLOB_BASE = (owner, repo, branch) =>
  'https://github.com/' + owner + '/' + repo + '/blob/' + branch + '/';

/** 把完整 URL 或 owner/repo 归一成 { owner, repo } */
export function parseRepoRef(input) {
  const s = String(input ?? '').trim().replace(/^<|>$/g, '');
  const m = s.match(/github\.com[/:]+([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i)
    ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** 带重试的取数据；404 返回 null，其余失败重试 */
export async function fetchWithRetry(fetchImpl, url, asJson, tries = 5) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': UA, accept: asJson ? 'application/vnd.github+json' : '*/*' },
        redirect: 'follow',
      });
      if (res.status === 404) return null;
      if (!res.ok) { await sleep(500); continue; }
      return asJson ? await res.json() : await res.text();
    } catch { await sleep(800); }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 清洗 README：去 HTML/徽章/图片、去它自己的「目录」与 H1、相对链接转绝对 */
export function cleanReadme(md, blobBase) {
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
    .replace(/\]\((?!(?:https?:|mailto:|#|\/|\[\[))([^)\s]+)\)/g, (_m, t) => '](' + blobBase + t + ')')
    .replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 清洗后变空的小节（多半原本是 HTML 表格或纯图片）——要告诉人，否则内容会静默丢失 */
export function emptySectionsAfterClean(md) {
  const empties = [];
  for (const seg of String(md).split(/\n(?=##\s)/)) {
    const m = seg.match(/^##\s+(.+)$/m);
    if (!m) continue;
    if (seg.replace(/^##\s+.+$/m, '').trim().length < 12) empties.push(m[1].trim());
  }
  return empties;
}

/**
 * 主入口：读上游、组装词条草稿正文与 front-matter 追加块。
 *
 * @returns {{ok: true, title, kind, user, entryText, readmeFile, npmName, version, meta, upstream, warnings: string[]}
 *          | {ok: false, reason: string, message: string}}
 */
export async function planProjectImport(options) {
  const {
    repoRef, kind = 'plugin', user = null, title = null, note = null, limits = null,
    now = new Date().toISOString().slice(0, 10), fetchImpl = globalThis.fetch,
  } = options ?? {};

  const parsed = parseRepoRef(repoRef);
  if (!parsed) return { ok: false, reason: 'bad-repo', message: '仓库地址看不懂——请填 `owner/repo` 或完整 GitHub URL。' };
  const { owner, repo } = parsed;

  const meta = await fetchWithRetry(fetchImpl, 'https://api.github.com/repos/' + owner + '/' + repo, true);
  if (!meta) {
    return {
      ok: false,
      reason: 'upstream-unreachable',
      message: '读不到 `' + owner + '/' + repo + '` 的 GitHub 信息（仓库不存在、或网络暂时不通）。确认一下地址，再在本 Issue 里回一句话重试。',
    };
  }

  const pkgText = await fetchWithRetry(fetchImpl,
    'https://raw.githubusercontent.com/' + owner + '/' + repo + '/HEAD/package.json', false);
  let pkg = null;
  try { pkg = pkgText ? JSON.parse(pkgText) : null; } catch { pkg = null; }
  const npmName = pkg && pkg.name && !pkg.private ? pkg.name : null;
  const version = pkg ? (pkg.version ?? null) : null;

  let readme = null; let readmeFile = null;
  for (const name of README_CANDIDATES) {
    const t = await fetchWithRetry(fetchImpl,
      'https://raw.githubusercontent.com/' + owner + '/' + repo + '/HEAD/' + name, false);
    if (t) { readme = t; readmeFile = name; break; }
  }
  const blobBase = BLOB_BASE(owner, repo, meta.default_branch ?? 'main');
  const readmePart = readme ? cleanReadme(readme, blobBase) : '';
  const warnings = [];
  if (readme) {
    const empties = emptySectionsAfterClean(readmePart);
    if (empties.length) warnings.push('这些小节清洗后是空的（原本多为 HTML 表格或纯图片，需人工从 README 补回）：' + empties.join(' / '));
  } else warnings.push('没有找到 README：正文留 TODO。');

  const entryTitle = String(title ?? '').trim() || repo;
  const summary = String(meta.description ?? '').trim() || 'TODO 一句话摘要';

  // 上游 README 是否已经有「已知限制 / 已知问题」这类小节——有就照搬了，没有就在**正文里**留出位置
  const LIMIT_HEAD = /^#{1,4}\s*(已知限制|已知问题|已知的?坑|限制|注意事项|Known (issues|limitations)|Limitations|Caveats)\s*$/im;
  const readmeHasLimits = readme ? LIMIT_HEAD.test(readme) : false;

  // 机器读不到的东西，在**文档本身**该写的位置留占位——不另开"待办清单"：
  // 谁拿到这份草稿，看到的就是"这一节该写什么、写在哪"。
  const bodyParts = [
    readmePart || '## TODO 第一节\n\n（这个仓库没有可照搬的 README：正文待补。）',
  ];
  if (note) bodyParts.push('', '## 作者补充', '', String(note).trim());
  if (!readmeHasLimits) {
    // 上游没写这一节：正文里替它留好位置（含"该怎么写"的一句话），而不是静默省略
    bodyParts.push(
      '',
      '## 已知问题与限制',
      '',
      limits ? String(limits).trim() : '- 待补：已知的坑、不支持的平台、需要额外配置的地方（上游 README 没写这一节）',
    );
  } else if (limits) {
    bodyParts.push('', '## 作者补充的已知问题', '', String(limits).trim());
  }
  // 兼容性：上游几乎不写，但读者最先问——同样在正文里留位置
  bodyParts.push(
    '',
    '## 兼容性',
    '',
    '- 支持的 DSH 版本：待补（查不到就写「未核实」，别猜）',
    '- 平台：待补',
  );
  const body = bodyParts.join('\n');

  let text = skeleton(kind, entryTitle, now, { summary, body });
  // tags 是空的时候，把「该填什么」写在那一行上（骨架只给了空数组）
  text = text.replace(/^tags: \[\]\s*$/m, 'tags: []                # TODO 至少两个（喂给标签长尾页）');

  const extra = [];
  extra.push('# ---- 以下字段由 scripts/lib/import-project.mjs 从上游自动填入（快照 ' + now + '）');
  extra.push('repo: ' + owner + '/' + repo);
  if (npmName) extra.push('npm: ' + quote(npmName));
  if (pkg && pkg.bin && typeof pkg.bin === 'object' && Object.keys(pkg.bin).length) {
    extra.push('install: npm install -g ' + npmName);
  }
  // 机器读不到、必须由人定的字段，**在这一坨里**留好位置（不是只写注释，也不是另开清单）：
  //   · 自由文本 → 直接给占位值，填的时候替换掉就行；
  //   · 枚举（role / entryGate 等）→ 只能留注释，因为非法值会让校验报错（骨架里已有）。
  extra.push('positioning: TODO 用生态语境说清它解决什么问题（别照抄上游 description）');
  extra.push('compat:');
  extra.push('  dsh: ["TODO 支持哪些 DSH 版本（查不到就写「未核实」，别猜）"]');
  extra.push('  runtime: []          # cli | desktop | web 等，按实测填');
  extra.push('  platforms: []        # 实测过的平台；没测就留空');
  extra.push('entryGate: maintainer');
  extra.push('entryGateNote: ' + quote(user
    ? '由项目作者 @' + user + ' 在收录表单里申请收录（走「有维护者认领」这一条门槛）。'
    : '由项目作者申请收录（走「有维护者认领」这一条门槛）；申请人待补。'));
  if (user) extra.push('maintainers: [' + user + ']');
  if (meta.license && meta.license.spdx_id && meta.license.spdx_id !== 'NOASSERTION') {
    extra.push('licenseRefs:');
    extra.push('  - id: ' + String(meta.license.spdx_id).toLowerCase());
    extra.push('    name: ' + meta.license.spdx_id);
    extra.push('    note: ' + quote('来自 GitHub API 的许可证字段（快照 ' + now + '）；仓库根 LICENSE 未逐字读。'));
  }
  extra.push('providedBy:');
  extra.push('  github:');
  extra.push('    at: ' + now);
  extra.push('    url: https://github.com/' + owner + '/' + repo);
  extra.push('    fields:');
  extra.push('      star: ' + meta.stargazers_count);
  extra.push('      fork: ' + meta.forks_count);
  if (version) extra.push('      version: ' + quote(version));
  if (meta.language) extra.push('      language: ' + meta.language);
  if (readmeFile) extra.push('      readme: ' + readmeFile);
  extra.push('      note: ' + quote('以上数字与字段取自 GitHub API 与仓库文件（快照 ' + now + '）。'));

  const fmEnd = text.indexOf('\n---\n');
  text = text.slice(0, fmEnd) + '\n' + extra.join('\n') + text.slice(fmEnd);

  return {
    ok: true,
    kind,
    title: entryTitle,
    user,
    entryText: text,
    readmeFile,
    npmName,
    version,
    readmeHasLimits,
    meta: { star: meta.stargazers_count, fork: meta.forks_count, license: meta.license?.spdx_id ?? null, language: meta.language ?? null },
    upstream: { owner, repo, url: 'https://github.com/' + owner + '/' + repo },
    warnings,
  };
}
