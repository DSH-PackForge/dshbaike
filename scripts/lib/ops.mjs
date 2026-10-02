/**
 * ops.mjs —— 可自动化的「有界操作」库（docs/14）。
 *
 * 设计前提（评审定调）：
 *   「改任何内容都可以沿用这种做法；如果改动太大、或者在我们现有体系下改不了，
 *     那再让他主动 fork 并 PR。」
 *
 * 所以每个操作都必须能回答三个问题：
 *   1. **它改哪一处**（`files` 与 `summary` 会说清；机器只动这一处）；
 *   2. **什么情况下它不能改**（`reason: 'unsupported'` 等 → 回帖让作者 fork + PR）；
 *   3. **怎么校验它没改坏**（由 workflow 统一跑 validate.mjs）。
 *
 * 每个操作都是纯函数式的：读文件 → 返回新内容 → 由调用方落盘。
 * 这样本地能用合成表单直接测，不必赌 CI。
 */

import fs from 'node:fs';
import path from 'node:path';

import { addMaintainer, readMaintainers } from '../claim.mjs';
import { DATA_DIR, loadRegistry, loadEntryFile } from './data.mjs';
import { allocate, parseEntryId, REGISTRY_PATH } from './registry.mjs';
import { skeleton } from './skeleton.mjs';
import { ENTRY_KINDS, exists, normalizeUsername, readText, todayLocal, usernameProblem } from './util.mjs';

/* ------------------------------------------------------------------ */
/* Issue Forms 解析                                                    */
/* ------------------------------------------------------------------ */

/** 把 Issue Forms 渲染出的正文解析成 { 标签: 值 }（GitHub 会写 `_No response_` 表示没填） */
export function parseFormBody(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  const buckets = {};
  let current = null;
  for (const line of lines) {
    const m = /^###\s+(\S.*?)\s*$/.exec(line);
    if (m) {
      current = m[1];
      buckets[current] = [];
      continue;
    }
    if (current) buckets[current].push(line);
  }
  const out = {};
  for (const [label, chunk] of Object.entries(buckets)) {
    const value = chunk.join('\n').trim();
    out[label] = /^_No response_$/i.test(value) ? '' : value;
  }
  return out;
}

/** 从 `[认领维护] plugin/1` 这类标题里取操作与标的 */
export function parseTitle(title) {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(String(title ?? ''));
  if (!m) return { opTitle: null, target: '' };
  return { opTitle: m[1].trim(), target: m[2].trim() };
}

/* ------------------------------------------------------------------ */
/* 公共工具                                                            */
/* ------------------------------------------------------------------ */


/**
 * 找同类型 + 同标题的**草稿**：用于「新增词条」的幂等。
 *
 * 为什么需要：机器人重跑一次（或同一份表单被重复提交）时，如果每次都重新领号，
 * 就会一路吃掉编号。规则是——同标题的草稿已经存在，就复用它那个号。
 */
function findDraftByTitle(kind, title) {
  const dir = path.join(DATA_DIR, kind);
  if (!exists(dir)) return null;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^\d+\.md$/.test(name)) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    // status 行后面跟着 # draft | published … 的说明注释，所以只取第一个词（踩过：整行比对导致幂等失效）
    const status = ((/^status:\s*([A-Za-z]+)/m.exec(text) ?? [])[1] ?? '').trim();
    const found = ((/^title:\s*(.+)$/m.exec(text) ?? [])[1] ?? '').trim().replace(/^["']|["']$/g, '');
    if (status !== 'draft' || found !== title) continue;
    const date = ((/^updatedAt:\s*(.+)$/m.exec(text) ?? [])[1] ?? '').trim();
    const n = Number(name.slice(0, -3));
    return { n, rel: `data/${kind}/${n}.md`, date: date || todayLocal() };
  }
  return null;
}

/** 表单的「初稿正文」+「事实来源」→ 词条正文（来源永远保留在正文里，便于维护者核对） */
function renderNewEntryBody({ draftBody, sources, user }) {
  const body = draftBody
    ? draftBody
    : '## TODO 第一节\n\n（还没有正文。可以继续用词条页的「改一句话」逐步补，或直接 fork + PR。）';
  const src = sources
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => '- ' + line)
    .join('\n');
  return [
    body,
    '## 事实来源',
    '',
    src,
    '',
    `> 由 @${user} 在 Issue 表单里提供；发布前请逐条核对——本站只写能指到出处的事实。`,
    '',
  ].join('\n');
}

/** 读词条文件并返回 { entry, raw }；不存在则 null */
export function readEntry(id) {
  const parsed = parseEntryId(id);
  if (!parsed) return null;
  const reg = loadRegistry();
  if (!(reg.data.entries ?? []).some((e) => `${e.kind}/${e.n}` === parsed.id)) return null;
  const entry = loadEntryFile(parsed.kind, parsed.n);
  if (!entry || !fs.existsSync(entry.path)) return null;
  return { parsed, entry, raw: fs.readFileSync(entry.path, 'utf8'), rel: `data/${parsed.kind}/${parsed.n}.md` };
}

/** 拆出 front-matter 的行区间（不含两端的 `---`） */
export function frontMatterRange(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return { lines, start: 1, end: i };
  }
  return null;
}

const ARRAY_FIELDS = new Set([
  'tags', 'aliases', 'maintainers', 'screenshots', 'platforms', 'zones', 'related', 'prereq',
  'provides', 'requires', 'targets', 'roots', 'files', 'permissions', 'launchers',
]);

/**
 * 所有操作都必须带一个合法的 GitHub 用户名（docs/14）。
 *
 * 为什么是「必须」：署名靠它——提交作者写的就是这个名字。名字缺失或形状不合法时，
 * 与其写一个指向不存在账号的 `Co-authored-by`，不如**直接拒绝**让人改表单。
 * 形状之外的「账号是否真的存在」由 apply-issue.mjs 查 API 确认（ops 保持纯函数、不联网）。
 */
export function requireUsername(form) {
  const raw = form['GitHub 用户名'];
  const problem = usernameProblem(raw);
  if (problem) {
    return {
      error: {
        ok: false,
        reason: normalizeUsername(raw) ? 'bad-username' : 'incomplete',
        message: `${problem}。**署名要用它**，所以机器人不会在没有合法用户名的情况下动手。`,
      },
    };
  }
  return { username: normalizeUsername(raw) };
}

export function formatScalar(field, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (ARRAY_FIELDS.has(field)) {
    const items = value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
    return `[${items.join(', ')}]`;
  }
  if (value === 'null') return 'null';
  if (/^-?\d+$/.test(value)) return value;
  // 只在**必要**时加引号：机器人的 diff 要跟手写的风格一致，否则审阅时全是无谓噪音。
  // 安全集合：字母数字、下划线、点、连字符、斜杠、@、空格、ISO 日期（文件里本来就都不带引号）；
  // 另外避开 YAML 会解释成别的类型的词（true/false/null/yes/no/on/off）。
  const safe = /^[\w.\-/@ ]+$/u.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value);
  return safe ? value : JSON.stringify(value);
}

/* ------------------------------------------------------------------ */
/* 操作定义                                                            */
/* ------------------------------------------------------------------ */

export const OPS = {
  /**
   * 新增词条：领号 + 建 draft 骨架 + 把表单内容填进去（docs/14 §1.2 的第 5 类代改）。
   *
   * 并发与编号（评审问过「撞号怎么办」）：
   *   · 号取自**当前 main**（workflow 检出的是最新 main），nextNumber = max(counters, 已分配最大号) + 1；
   *   · 同类型 + 同标题的草稿已存在就**复用它的号**（重跑与重复提交都不会继续吃号）；
   *   · 真并发（两个 Issue 同时领到同一个号）时，第二个 PR 会在 registry.yml 上**冲突**——
   *     可见、可恢复，维护者重跑一次即可；不会静默改错。
   * 代价要写明白：**编号是永久的**，所以一个最终没合并的草稿 PR 会永久占掉一个号。
   *
   * 建出来的是 status: draft —— 不合并就永远不上线（两道闸照旧）。
   */
  'new-entry': {
    id: 'new-entry',
    title: '新增词条',
    summary: (v) => `领号并建 draft 骨架（${v.id}）`,
    apply({ form }) {
      const who = requireUsername(form);
      if (who.error) return who.error;
      const user = who.username;

      const rawKind = String(form['词条类型'] ?? '').trim();
      const kind = (rawKind.match(/^[a-z][a-z-]*/) ?? [''])[0];
      const title = String(form['标题'] ?? '').trim();
      const summary = String(form['一句话摘要'] ?? '').trim();
      const draftBody = String(form['初稿正文（可选）'] ?? '').trim();
      const sources = String(form['事实来源'] ?? '').trim();

      if (!kind || !ENTRY_KINDS.includes(kind)) {
        return { ok: false, reason: 'incomplete', message: `「词条类型」没选，或不在允许值里（${ENTRY_KINDS.join(' | ')}）。` };
      }
      if (!title) return { ok: false, reason: 'incomplete', message: '表单缺「标题」。' };
      if (!summary) return { ok: false, reason: 'incomplete', message: '表单缺「一句话摘要」——它会用在卡片与搜索里。' };
      if (!sources) {
        return { ok: false, reason: 'incomplete', message: '表单缺「事实来源」。本站只写能指到出处的事实；确实查不到的写「未核实」，但不能空着。' };
      }

      const date = todayLocal();
      const body = renderNewEntryBody({ draftBody, sources, user });

      const dup = findDraftByTitle(kind, title);
      if (dup) {
        return {
          ok: true,
          changed: false,
          writes: [{ path: dup.rel, text: skeleton(kind, title, dup.date, { summary, body }) }],
          id: `${kind}/${dup.n}`,
          user,
          credited: user,
          summary: `复用已分配的编号 ${kind}/${dup.n}（同标题草稿已存在，未再吃号）`,
        };
      }

      const alloc = allocate({ kind, title, now: date });
      return {
        ok: true,
        changed: true,
        writes: [
          { path: `data/${kind}/${alloc.n}.md`, text: skeleton(kind, title, date, { summary, body }) },
          // allocate() 已经把编号写进 registry 了；这里把同一份内容也作为 write 交出去，
          // 好让幂等比对与提交都走同一条路（内容一致，重复落盘无害）。
          { path: 'data/registry.yml', text: readText(REGISTRY_PATH) },
        ],
        id: `${kind}/${alloc.n}`,
        user,
        credited: user,
        summary: `领号 ${kind}/${alloc.n}、建 draft 骨架（写完再发布）`,
      };
    },
  },

  /** 认领维护：把用户名加进 maintainers（唯一一处改动） */
  claim: {
    id: 'claim',
    title: '认领维护',
    summary: (v) => `把 ${v.user} 加进 maintainers`,
    apply({ target, form }) {
      const id = (form['词条 id'] || target || '').trim().replace(/^`|`$/g, '');
      const who = requireUsername(form);
      if (who.error) return who.error;
      const user = who.username;
      if (!id) return { ok: false, reason: 'incomplete', message: '表单缺「词条 id」。' };
      const found = readEntry(id);
      if (!found) return { ok: false, reason: 'unknown-entry', message: `词条 \`${id}\` 不在 registry 里。` };
      const result = addMaintainer(found.raw, user);
      if (!result.changed) {
        return result.how === 'already'
          ? { ok: false, reason: 'already', message: `${user} 已经是这一条的维护者。` }
          : { ok: false, reason: 'unsupported', message: '这一条的 front-matter 无法识别，请 fork 后手工改。' };
      }
      return {
        ok: true,
        changed: true,
        writes: [{ path: found.rel, text: result.text }],
        id: found.parsed.id,
        user,
        credited: user,
        // 已有的维护者也要被叫到：有人来一起维护，他们该知道（docs/14 §1.4）
        notify: readMaintainers(found.raw),
        summary: `把 ${user} 加进 maintainers`,
      };
    },
  },

  /** 改一个字段：只支持标量与本系统认识的列表字段；嵌套结构一律拒绝并升级 */
  field: {
    id: 'field',
    title: '改一个字段',
    apply({ target, form }) {
      const id = (form['词条 id'] || target || '').trim().replace(/^`|`$/g, '');
      const who = requireUsername(form);
      if (who.error) return who.error;
      const field = (form['字段名'] || '').trim();
      const value = form['新的值'] || '';
      if (!id || !field || !value.trim()) return { ok: false, reason: 'incomplete', message: '表单缺「词条 id」「字段名」或「新的值」。' };
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field)) return { ok: false, reason: 'unsupported', message: `字段名 \`${field}\` 不像一个字段。` };
      const found = readEntry(id);
      if (!found) return { ok: false, reason: 'unknown-entry', message: `词条 \`${id}\` 不在 registry 里。` };

      const fm = frontMatterRange(found.raw);
      if (!fm) return { ok: false, reason: 'unsupported', message: '这一条没有 front-matter。' };
      const { lines, start, end } = fm;
      const next = formatScalar(field, value);

      let at = -1;
      for (let i = start; i < end; i += 1) {
        const m = /^(\s*)([A-Za-z][A-Za-z0-9]*):(\s*)(.*)$/.exec(lines[i]);
        if (!m || m[2] !== field) continue;
        at = i;
        const rest = m[4].trim();
        // 块结构（值在下一层）改不了：那是嵌套字段，让作者 fork 后手工改
        if (rest === '') return { ok: false, reason: 'unsupported', message: `\`${field}\` 是嵌套结构，机器人不碰它——请 fork 后手工改。` };
        lines[i] = `${m[1]}${field}: ${next}`;
        break;
      }
      if (at < 0) {
        // 没有这个键：插在 status 之后（保持头部可读）
        let insertAt = end;
        for (let i = start; i < end; i += 1) {
          if (/^\s*status:/.test(lines[i])) { insertAt = i + 1; break; }
        }
        lines.splice(insertAt, 0, `${field}: ${next}`);
      }
      return {
        ok: true,
        changed: true,
        writes: [{ path: found.rel, text: lines.join('\n') }],
        id: found.parsed.id,
        credited: who.username,
        // 改的是**这条词条**：它的维护者要被叫到（docs/14 §1.4）
        notify: readMaintainers(found.raw),
        summary: `${at < 0 ? '新增' : '更新'}字段 \`${field}\``,
      };
    },
  },

  /** 改正文里的一句话：精确匹配、且**必须唯一命中**；0 次或多次都拒绝（不猜） */
  replace: {
    id: 'replace',
    title: '改正文里的一句话',
    apply({ target, form }) {
      const id = (form['词条 id'] || target || '').trim().replace(/^`|`$/g, '');
      const who = requireUsername(form);
      if (who.error) return who.error;
      const from = form['原文片段'] || '';
      const to = form['改成'] || '';
      if (!id || !from.trim() || !to.trim()) return { ok: false, reason: 'incomplete', message: '表单缺「词条 id」「原文片段」或「改成」。' };
      const found = readEntry(id);
      if (!found) return { ok: false, reason: 'unknown-entry', message: `词条 \`${id}\` 不在 registry 里。` };

      const fm = frontMatterRange(found.raw);
      if (!fm) return { ok: false, reason: 'unsupported', message: '这一条没有 front-matter。' };
      const head = found.raw.split('\n').slice(0, fm.end + 1).join('\n');
      const body = found.raw.split('\n').slice(fm.end + 1).join('\n');

      const needle = from.trim();
      const hits = body.split(needle).length - 1;
      if (hits === 0) {
        return {
          ok: false,
          reason: 'not-found',
          message: '正文里找不到那段原文（可能已经改过了，或者你贴的是 front-matter 里的内容——那种改动请用「改一个字段」）。',
        };
      }
      if (hits > 1) {
        return { ok: false, reason: 'ambiguous', message: `那段原文在正文里出现了 ${hits} 次，机器人不敢猜是哪一处。请把片段贴长一点（能唯一定位）。` };
      }
      const nextBody = body.replace(needle, to.trim());
      return {
        ok: true,
        changed: true,
        writes: [{ path: found.rel, text: `${head}\n${nextBody}` }],
        id: found.parsed.id,
        credited: who.username,
        summary: '替换正文里的一处片段',
      };
    },
  },

  /** 补充分区条目：往某个二级分区追加一条卡片（名称 + 一句话 + 外链） */
  'zone-item': {
    id: 'zone-item',
    title: '补充分区条目',
    apply({ target, form }) {
      const zoneId = (form['分区'] || target || '').trim().replace(/^`|`$/g, '').split(/[\s（(]/)[0];
      const who = requireUsername(form);
      if (who.error) return who.error;
      const section = (form['二级分区 id'] || '').trim();
      const name = (form['名称'] || '').trim();
      const blurb = (form['一句话介绍'] || '').trim();
      const linksRaw = form['外部链接'] || '';
      if (!zoneId || !name || !blurb || !linksRaw.trim()) {
        return { ok: false, reason: 'incomplete', message: '表单缺「分区」「名称」「一句话介绍」或「外部链接」。' };
      }
      const file = path.join('data', 'zones', `${zoneId}.yml`);
      if (!fs.existsSync(file)) return { ok: false, reason: 'unknown-zone', message: `分区 \`${zoneId}\` 不存在。` };
      const raw = fs.readFileSync(file, 'utf8');

      // 二级分区必须已声明（否则链接过去会落在「未分组」里，读者看不到）
      const declared = [...raw.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
      if (!declared.includes(section)) {
        return {
          ok: false,
          reason: 'unknown-section',
          message: `\`${zoneId}\` 里没有二级分区 \`${section}\`。可用的：${declared.join(' / ')}`,
        };
      }

      const links = [];
      for (const line of linksRaw.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const m = /^([a-zA-Z-]+)\s*:\s*(.+)$/.exec(line);
        if (m) links.push([m[1], m[2].trim()]);
        else if (/^https?:\/\//i.test(line)) links.push(['url', line]);
        else if (/^[\w.-]+\/[\w.-]+$/.test(line)) links.push(['github', line]);
        else return { ok: false, reason: 'bad-links', message: `看不懂这一行链接：\`${line}\`。写 \`键: 值\`（如 \`github: owner/repo\`）或一个完整 URL。` };
      }
      if (!links.length) return { ok: false, reason: 'bad-links', message: '至少要给一个外链。' };

      const item = [
        `  - name: ${name}`,
        `    section: ${section}`,
        `    blurb: ${blurb}`,
        '    source: curated',
        '    entry: null',
        '    links:',
        ...links.map(([k, v]) => `      ${k}: ${v}`),
      ].join('\n');
      const text = raw.endsWith('\n') ? `${raw}${item}\n` : `${raw}\n${item}\n`;
      return {
        ok: true,
        changed: true,
        writes: [{ path: `data/zones/${zoneId}.yml`, text }],
        id: zoneId,
        credited: who.username,
        summary: `往 ${zoneId} 的「${section}」追加一条：${name}`,
      };
    },
  },
};

/** 合并表单的类别标题：`[内容变更] 改一个字段 plugin/1`（选择器里只有一条，操作在表单里选） */
export const CONTENT_CLASS_TITLE = '内容变更';

/**
 * **人工处理**的贡献类型（与 OPS 里那五类机器代改相对）。
 *
 * 这些请求本身是合理的，只是机器人不做：纠错要人判断、
 * 写教程/派生概念是创作、站点改进是改站本身。登记在这里是为了让机器人**明确回一句
 * 「这类由人工处理」**——而不是回「认不出这是哪种表单，请用模板重新提交」
 * （作者用的就是模板，那句话等于死胡同）。
 */
export const HUMAN_TASKS = ['纠错', '站点改进', '为它写一篇教程', '派生概念', '收录申请'];

/** 标题是否属于「人工处理」那一类 */
export function isHumanTask(title) {
  const { opTitle } = parseTitle(title);
  return opTitle != null && HUMAN_TASKS.includes(opTitle);
}

/**
 * 按标题（与表单）找操作。解析顺序从**最明确**到最含糊：
 *   ① `[补充分区条目] themes` —— 标题前缀就是操作名（独立表单与历史 Issue 都走这条）；
 *   ② `[内容变更] 改一个字段 plugin/1` —— 站点深链把操作名与编号都塞进标题
 *      （GitHub 不支持用 URL 预填 YAML 表单字段，只有标题能预填，所以编号放标题里）；
 *   ③ `[内容变更] …` + 表单里的「操作类型」下拉 —— 从「New issue」直接进来的人选的那一项。
 * 剩下的返回 null：机器人**不猜**，也**不插话**（由人来处理）。
 */
export function findOp(title, form = {}) {
  const { opTitle, target } = parseTitle(title);
  if (!opTitle) return null;
  const all = Object.values(OPS);

  const direct = all.find((op) => op.title === opTitle);
  if (direct) return { op: direct, target };

  if (opTitle === CONTENT_CLASS_TITLE) {
    const named = all.find((op) => target.includes(op.title));
    if (named) return { op: named, target: target.replace(named.title, '').trim() };
    const picked = all.find((op) => op.title === String(form['操作类型'] ?? '').trim());
    if (picked) return { op: picked, target };
  }
  return null;
}
