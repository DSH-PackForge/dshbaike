/**
 * markdown.mjs —— 最小 Markdown 渲染器（严格按 docs/10 §8 的安全边界）
 *
 * 纪律：
 *   1. **先转义再替换**：`& < > " '` 全部先转义，任何原始 HTML 都不会穿透。
 *   2. 链接只允许 `http(s):`（写错协议就退化成纯文本，绝不产出 `javascript:`）。
 *   3. `[[kind/n]]` 渲染成站内链接；目标不存在时渲染成红链（`class="redlink"`）。
 *   4. 标题生成锚点：中文标题直接用文本做 id，重名追加 `-2`、`-3`。
 *
 * 支持：标题 / 段落 / 无序与有序列表（可嵌套）/ 围栏代码块 / 表格 /
 *       引用块 / 分隔线 / 行内 code、**粗**、*斜*、链接、`[[kind/n]]`。
 */

/* ------------------------------------------------------------------ */
/* 转义                                                                */
/* ------------------------------------------------------------------ */

/** docs/10 §8：`& < > " '` 全部转义 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 标题 / 锚点用的纯文本 */
export function plainText(html) {
  return unescapeHtml(String(html).replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 还原 escapeHtml 产生的实体（只还原我们自己转义的那五个） */
export function unescapeHtml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 标题文本 → 锚点 id。
 * 中文标题直接用文本做 id（合法 HTML5 id），空格转 `-`，重名由 `uniqueAnchor` 处理。
 */
export function anchorFor(text) {
  const base = plainText(text)
    .replace(/[\s\u3000]+/g, '-')
    .replace(/["'`#$%&()*+,./:;<=>?@[\\\]^_{|}~!]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

/* ------------------------------------------------------------------ */
/* 行内渲染                                                            */
/* ------------------------------------------------------------------ */

// 用控制字符做占位符：它在步骤 1 的转义里不会被改（`&` 会被改成 `&amp;`，控制字符不会）
const PLACEHOLDER_PREFIX = '\u0001PH';
const PLACEHOLDER_SUFFIX = '\u0001';

export function renderInline(source, ctx = {}) {
  const codes = [];
  const stash = (text) => {
    const token = `${PLACEHOLDER_PREFIX}${codes.length}${PLACEHOLDER_SUFFIX}`;
    codes.push(text);
    return token;
  };

  // 步骤 1：整段先转义（此后不再有任何原始字符能变成标签）
  let text = escapeHtml(source);

  // 步骤 2：行内代码优先（其内容不再参与任何替换）
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_m, _tick, code) => stash(`<code>${code.trim()}</code>`));

  // 步骤 3：站内链接 `[[kind/n]]` / `[[kind/n|显示文本]]`（在普通链接之前处理）
  text = text.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner) => {
    const [rawTarget, rawLabel] = inner.split('|');
    const target = (rawTarget ?? '').trim();
    if (!/^[a-z]+\/\d+$/.test(target)) {
      // 写错了 id 形状：当作纯文本，别猜
      return `${escapeHtml((rawLabel ?? '').trim()) || escapeHtml(target)}（站内链接格式应为 kind/n）`;
    }
    const label = escapeHtml((rawLabel ?? '').trim()) || escapeHtml(target);
    const href = `${ctx.base ?? '/'}${target}.html`;
    if (ctx.hasEntry && !ctx.hasEntry(target)) {
      return stash(`<a class="redlink" data-entry="${target}" href="#/contributing">${label}</a>`);
    }
    return stash(`<a href="${href}" data-entry="${target}">${label}</a>`);
  });

  // 步骤 4：链接与图片（只允许 http(s) / mailto / 站内相对路径）
  text = text.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, (m, label, href) => {
    const isImage = m.startsWith('!');
    const safe = safeHref(unescapeHtml(href));
    if (!safe) {
      // 危险或未知协议：退化成纯文本，绝不产出可点的链接
      return isImage ? label : `${label}（链接协议不被允许：只接受 http/https）`;
    }
    if (isImage) return stash(`<img src="${escapeHtml(safe)}" alt="${label}">`);
    return stash(`<a href="${escapeHtml(safe)}">${label}</a>`);
  });

  // 步骤 5：粗体 / 斜体。
  // 规则：强调段内部不能以空白开头/结尾，也不能跨段落（含换行）。
  // 不要求外侧边界字符——中文里 `、*斜体*。` 这类紧贴标点的写法是常态，
  // 而 `a*b*c` 这类误伤本来就是 Markdown 的既有歧义。
  text = text.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>');
  text = text.replace(/_(?=\S)([^_\n]*?\S)_/g, '<em>$1</em>');

  // 步骤 6：还原占位符（从后往前，支持嵌套的一层）
  for (let i = codes.length - 1; i >= 0; i -= 1) {
    text = text.split(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`).join(codes[i]);
  }
  // 孤立的占位符（理论上不会出现）就地清掉，避免漏到页面里
  text = text.replace(/\u0001PH\d+\u0001/g, '');
  return text;
}

/** 只放行 http / https / mailto / 站内相对路径 */
export function safeHref(href) {
  const text = String(href ?? '').trim();
  if (text === '') return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^mailto:[^\s]+$/i.test(text)) return text;
  if (/^#[^\s]*$/.test(text)) return text;
  if (/^\/[^\s]*$/.test(text)) return text;
  if (/^[a-z]+\/\d+\.html$/.test(text)) return text;
  return null;
}

/* ------------------------------------------------------------------ */
/* 块级渲染                                                            */
/* ------------------------------------------------------------------ */

/**
 * 渲染 Markdown 正文。
 * @param {string} source
 * @param {{base?: string, hasEntry?: (id: string) => boolean}} [ctx]
 * @returns {{ html: string, toc: Array<{level: number, text: string, anchor: string}> }}
 */
export function renderMarkdown(source, ctx = {}) {
  const lines = String(source ?? '').split(/\r\n|\r|\n/);
  const toc = [];
  const anchors = new Set();

  const uniqueAnchor = (text) => {
    const base = anchorFor(text);
    if (!anchors.has(base)) {
      anchors.add(base);
      return base;
    }
    let i = 2;
    while (anchors.has(`${base}-${i}`)) i += 1;
    const id = `${base}-${i}`;
    anchors.add(id);
    return id;
  };

  const html = renderBlocks(lines, 0, lines.length, { ...ctx, toc, uniqueAnchor });
  return { html, toc };
}

/** 渲染 lines[start, end) 这一段的块级内容 */
function renderBlocks(lines, start, end, ctx) {
  const out = [];
  let i = start;

  while (i < end) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 围栏代码块
    const fence = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const [, indent, marker, lang] = fence;
      const markerChar = marker[0];
      const markerLen = marker.length;
      const body = [];
      i += 1;
      let closed = false;
      while (i < end) {
        const closeRe = new RegExp(`^\\s*${markerChar === '`' ? '`' : '~'}{${markerLen},}\\s*$`);
        if (closeRe.test(lines[i])) {
          closed = true;
          i += 1;
          break;
        }
        body.push(stripIndent(lines[i], indent.length));
        i += 1;
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      const text = body.join('\n');
      out.push(`<pre><code${cls}>${escapeHtml(text)}${closed ? '' : '\n'}</code></pre>`);
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const inner = renderInline(heading[2], ctx);
      const text = plainText(inner);
      const anchor = ctx.uniqueAnchor(text);
      if (level >= 2 && level <= 4) ctx.toc.push({ level, text, anchor });
      out.push(`<h${level} id="${escapeHtml(anchor)}">${inner}</h${level}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      const block = [];
      while (i < end && (/^\s*>/.test(lines[i]) || (block.length > 0 && lines[i].trim() !== '' && !isBlockStart(lines[i])))) {
        block.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(block, 0, block.length, ctx)}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < end && isTableDelimiter(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < end && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const head = header.map((cell) => `<th>${renderInline(cell, ctx)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, ctx)}</td>`).join('')}</tr>`)
        .join('\n');
      out.push(`<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n<tbody>\n${body}\n</tbody>\n</table>`);
      continue;
    }

    // 列表
    if (listItemMatch(line)) {
      const [rendered, next] = renderList(lines, i, end, ctx);
      out.push(rendered);
      i = next;
      continue;
    }

    // 缩进代码块（4 空格）
    if (/^ {4}\S/.test(line)) {
      const body = [];
      while (i < end && (/^ {4}/.test(lines[i]) || lines[i].trim() === '')) {
        body.push(lines[i].replace(/^ {4}/, ''));
        i += 1;
      }
      while (body.length && body[body.length - 1].trim() === '') body.pop();
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }

    // 段落：吃到空行或下一个块级起点
    const para = [line.trim()];
    i += 1;
    while (i < end && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(' '), ctx)}</p>`);
  }

  return out.join('\n');
}

/** 这一行是否开启一个新的块级结构（段落需要在这里断开） */
function isBlockStart(line) {
  return (
    /^\s*(`{3,}|~{3,})/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*>/.test(line) ||
    listItemMatch(line) !== null ||
    /^ {4}\S/.test(line)
  );
}

function stripIndent(line, n) {
  let count = 0;
  while (count < n && line[count] === ' ') count += 1;
  return line.slice(count);
}

/* ---- 列表 ---- */

function listItemMatch(line) {
  // 排除分隔线（`-` / `*` / `_` 三个以上）
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return null;
  const m = /^(\s*)([-*+]|\d+[.)])[ \t]+(\S.*)$/.exec(line);
  if (!m) return null;
  return { indent: m[1].length, ordered: /\d/.test(m[2]), marker: m[2], text: m[3] };
}

function renderList(lines, start, end, ctx) {
  const first = listItemMatch(lines[start]);
  const listIndent = first.indent;
  const ordered = first.ordered;
  const items = [];
  let i = start;

  while (i < end) {
    const current = listItemMatch(lines[i]);
    if (!current) {
      // 空行：后面若还有同层列表项就继续，否则结束
      if (lines[i].trim() === '') {
        let j = i + 1;
        while (j < end && lines[j].trim() === '') j += 1;
        const next = j < end ? listItemMatch(lines[j]) : null;
        if (next && next.indent === listIndent && next.ordered === ordered) {
          i = j;
          continue;
        }
      }
      break;
    }
    if (current.indent < listIndent) break;
    if (current.indent > listIndent) break; // 交给上一项的内容块处理
    if (current.ordered !== ordered) break;

    const contentIndent = current.indent + current.marker.length + 1;
    const block = [current.text];
    i += 1;
    while (i < end) {
      const line = lines[i];
      if (line.trim() === '') {
        // 空行后再看下一行缩进是否还属于本项
        let j = i + 1;
        while (j < end && lines[j].trim() === '') j += 1;
        if (j < end && leadingSpaces(lines[j]) >= contentIndent && !isListMarkerAt(lines[j], listIndent)) {
          block.push('');
          i += 1;
          continue;
        }
        break;
      }
      if (isListMarkerAt(line, listIndent)) break;
      if (leadingSpaces(line) < contentIndent) break;
      block.push(stripIndent(line, contentIndent));
      i += 1;
    }
    while (block.length && block[block.length - 1].trim() === '') block.pop();
    const inner = renderBlocks(block, 0, block.length, ctx);
    items.push(unwrapSingleParagraph(inner));
  }

  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((item) => `<li>${item}</li>`).join('\n');
  return [`<${tag}>\n${body}\n</${tag}>`, i];
}

const BLOCK_TAG_RE = /<(?:p|ul|ol|pre|blockquote|table|h[1-6]|hr|div)[\s>]/;

/** 单项只有一个段落时去掉 `<p>` 包装；含块级结构时保留（HTML 合法） */
function unwrapSingleParagraph(inner) {
  if (!inner.startsWith('<p>') || !inner.endsWith('</p>')) return inner;
  const body = inner.slice(3, -4);
  if (BLOCK_TAG_RE.test(body)) return inner;
  return body;
}

function leadingSpaces(line) {
  const m = /^ */.exec(line);
  return m ? m[0].length : 0;
}

function isListMarkerAt(line, indent) {
  const m = listItemMatch(line);
  return Boolean(m && m.indent === indent);
}

/* ---- 表格 ---- */

function isTableDelimiter(line) {
  const text = line.trim();
  if (!/^\|?[\s:|-]+\|?$/.test(text)) return false;
  if (!text.includes('-')) return false;
  return text.split('|').filter((c) => c.trim() !== '').every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}
