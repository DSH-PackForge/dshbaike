/**
 * yaml.mjs —— 极简 YAML 子集解析器（零第三方依赖）
 *
 * 只实现本项目 data/**、collected/** 真正用到的子集：
 *   块映射、块序列、行内 `{}` / `[]`、引号标量、`|` / `>` 块标量、
 *   `#` 注释、`---` 文档分隔、null / true / false / 数字。
 *
 * 明确不支持（用到即报带行号的错，绝不静默猜）：
 *   锚点与别名（&x / *x）、标签（!!str）、流式多行、复杂键（? key）、
 *   多文档（第二个 `---` 之后的内容）。
 *
 * 错误一律抛 SchemaError，带 文件名 + 行号 + 人话说明。
 */

export class SchemaError extends Error {
  constructor(message, { file = '<unknown>', line = null, column = null, snippet = null } = {}) {
    const loc = line == null ? file : `${file}:${line}`;
    super(`${loc}: ${message}`);
    this.name = 'SchemaError';
    this.file = file;
    this.line = line;
    this.column = column;
    this.snippet = snippet;
    this.detail = message;
  }
}

const BOM = '\uFEFF';

/** 数字字面量：十进制 / 浮点 / 科学计数（不支持 0x、八进制、前导 + 号） */
const RE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** 需要加引号才能保持字符串语义的裸标量 */
const RE_QUOTE_NEEDED = /^(?:$|[-?:,[\]{}#&*!|>'"%@`]|.*: |.*\s#)/;
const RE_BOOLISH = /^(?:true|false|yes|no|on|off|null|~|True|False|TRUE|FALSE|NULL|Null|Yes|No|On|Off)$/;

/** 判定一个字符串是否必须是标量（用于 stringify 时决定是否加引号） */
export function looksLikeNonString(text) {
  return RE_NUMBER.test(text) || RE_BOOLISH.test(text) || /^[-+]?\d/.test(text);
}

/* ------------------------------------------------------------------ */
/* 词法：拆行，保留原始行号                                              */
/* ------------------------------------------------------------------ */

function splitLines(raw) {
  const text = String(raw).replace(/^\uFEFF/, '');
  return text.split(/\r\n|\r|\n/);
}

/** 去掉注释与行尾空白（正确跳过引号内与括号内的 `#`） */
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inSingle) {
      if (ch === "'") {
        if (line[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/* ------------------------------------------------------------------ */
/* 解析器                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  constructor(text, file) {
    this.file = file;
    this.rawLines = splitLines(text);
    this.lines = [];
    for (let i = 0; i < this.rawLines.length; i += 1) {
      const raw = this.rawLines[i];
      const lineNo = i + 1;
      if (raw.includes('\t')) {
        throw new SchemaError('缩进里出现了制表符（tab）。YAML 只允许空格缩进，请把 tab 换成空格', {
          file: this.file,
          line: lineNo,
          snippet: raw,
        });
      }
      const stripped = stripComment(raw).replace(/\s+$/, '');
      if (!stripped.trim()) continue;
      // indent = 缩进列数；content = 去掉缩进后的内容
      const indent = stripped.length - stripped.replace(/^ +/, '').length;
      this.lines.push({ raw, content: stripped.slice(indent), indent, line: lineNo });
    }
    this.at = 0;
    this.linesByPath = new Map();
  }

  /* ---- 行访问 ---- */

  eof() {
    return this.at >= this.lines.length;
  }

  peek() {
    return this.lines[this.at] ?? null;
  }

  next() {
    const line = this.lines[this.at] ?? null;
    if (line) this.at += 1;
    return line;
  }

  /** 取“有效行”：下一行若缩进不足则视为不存在（返回 null） */
  peekValue(minIndent) {
    const line = this.peek();
    if (!line) return null;
    if (line.indent < minIndent) return null;
    return line;
  }

  ok(cond, message, line) {
    if (cond) return;
    throw new SchemaError(message, {
      file: this.file,
      line: line ? line.line : (this.peek()?.line ?? this.rawLines.length),
      snippet: line ? line.raw : this.peek()?.raw ?? null,
    });
  }

  /* ---- 路径（供 validate 报行号用） ---- */

  path(kind, key) {
    this.pathStack = this.pathStack ?? [];
    if (kind === 'push') this.pathStack.push(String(key));
    else if (kind === 'pop') this.pathStack.pop();
    else throw new Error(`未知的路径操作 ${kind}`);
    return this.pathStack.join('.');
  }

  noteKey(key, line) {
    const prefix = (this.pathStack ?? []).join('.');
    const full = prefix ? `${prefix}.${key}` : String(key);
    if (!this.linesByPath.has(full)) this.linesByPath.set(full, line.line);
  }

  /* ---- 入口 ---- */

  run() {
    const docs = [];
    let value = null;
    const top = this.peek();
    // 顶层缩进就是文件里第一行内容的缩进（允许整体缩进的 YAML）
    const topIndent = top ? top.indent : 0;
    while (!this.eof()) {
      const line = this.peek();
      if (line.indent !== topIndent) {
        throw new SchemaError(`这一行的缩进（${line.indent} 空格）与文档顶层的缩进（${topIndent} 空格）不一致`, {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      if (line.content === '---') {
        this.next();
        continue;
      }
      if (line.content === '...') {
        this.next();
        break;
      }
      value = this.parseBlockValue(topIndent);
      docs.push(value);
      if (this.eof()) break;
      if (this.peek().content !== '---' && this.peek().content !== '...') {
        throw new SchemaError('顶层出现了无法解析的内容（是不是缩进不一致？）', {
          file: this.file,
          line: this.peek().line,
          snippet: this.peek().raw,
        });
      }
    }
    if (docs.length > 1) {
      throw new SchemaError('这个文件里有多份 YAML 文档（多余的 `---`）。本项目的解析器只接受一份', {
        file: this.file,
        line: this.lines[0]?.line ?? 1,
      });
    }
    return value;
  }

  /* ---- 块 ---- */

  parseBlockValue(indent) {
    const line = this.peekValue(indent);
    return this.parseBlockValueInner(indent, line);
  }

  parseBlockValueInner(indent, line) {
    if (!line) return null;
    if (line.indent > indent) {
      // 允许「值比父键多缩进」这种常见写法
      return this.parseBlockValue(line.indent);
    }
    if (line.content.startsWith('- ') || line.content === '-') return this.parseSequence(line.indent);
    if (line.content === '|' || line.content === '>' || /^[|>][+-]?\d*$/.test(line.content)) {
      return this.blockScalar(line, line.indent);
    }
    const split = findTopLevelColon(line.content);
    if (split) return this.parseMapping(line.indent);
    // 裸标量（极少见，例如整个文件只有一行字符串）
    this.next();
    return this.resolveInline(line.content, line);
  }

  parseMapping(indent) {
    const map = {};
    const keys = new Set();
    while (!this.eof()) {
      const line = this.peekValue(indent);
      if (!line) break;
      if (line.indent > indent) {
        throw new SchemaError('缩进比上一个键更深，但上一行没有可以承载它的 `key:`', {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      if (line.indent < indent) break;
      if (line.content.startsWith('- ') || line.content === '-') break; // 交回父级
      if (line.content === '---' || line.content === '...') break;
      const split = findTopLevelColon(line.content);
      if (!split) {
        throw new SchemaError('期望的是 `键: 值`，这一行里没有找到键值分隔的冒号', {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      const key = this.scalarKey(line.content.slice(0, split.index), line);
      if (keys.has(key)) {
        throw new SchemaError(`重复的键 \`${key}\`（同一个映射里键必须唯一）`, {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      keys.add(key);
      this.noteKey(key, line);
      this.next();
      const rest = line.content.slice(split.index + 1).trim();
      const col = indent + 1;
      if (rest === '') {
        const nested = this.peekValue(0);
        if (nested && (nested.content.startsWith('- ') || nested.content === '-') && nested.indent <= indent) {
          map[key] = null;
        } else {
          this.path('push', key);
          map[key] = this.parseBlockValue(col);
          this.path('pop');
        }
      } else {
        this.path('push', key);
        map[key] = this.parseValue(rest, col, line);
        this.path('pop');
      }
    }
    return map;
  }

  parseSequence(indent) {
    const out = [];
    let index = 0;
    while (!this.eof()) {
      const line = this.peekValue(indent);
      if (!line) break;
      if (line.indent !== indent) {
        throw new SchemaError('序列项的缩进比 `-` 更深，无法判断它属于哪一项', {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      if (!(line.content.startsWith('- ') || line.content === '-')) break;
      this.next();
      const rest = line.content === '-' ? '' : line.content.slice(2).trim();
      const col = indent + 2;
      this.noteKey(String(index), line);
      this.path('push', index);
      if (rest === '') {
        out.push(this.parseBlockValue(col));
      } else {
        const split = findTopLevelColon(rest);
        const flow = rest.startsWith('[') || rest.startsWith('{');
        const quoted = rest.startsWith('"') || rest.startsWith("'");
        if (split && !flow && !quoted) {
          out.push(this.parseMappingAfterDash(rest, line, indent));
        } else {
          out.push(this.parseValue(rest, col, line));
        }
      }
      this.path('pop');
      index += 1;
    }
    return out;
  }

  /**
   * `- key: value`：把 `- ` 之后的文本当成缩进为 `dashIndent + 2` 的一行，
   * 与后续更深缩进的行一起解析成一个映射。
   */
  parseMappingAfterDash(rest, dashLine, dashIndent) {
    const synthetic = { raw: rest, content: rest, indent: dashIndent + 2, line: dashLine.line };
    const savedLines = this.lines;
    const savedAt = this.at;
    const lines = savedLines.slice();
    lines.splice(this.at, 0, synthetic);
    this.lines = lines;
    try {
      return this.parseMapping(synthetic.indent);
    } finally {
      const consumed = this.at;
      this.lines = savedLines;
      this.at = savedAt + Math.max(0, consumed - savedAt - 1);
    }
  }

  parseValue(rest, indent, line) {
    if (/^[|>][+-]?\d*$/.test(rest)) return this.blockScalarFrom(rest, line, indent);
    if (rest.startsWith('[') || rest.startsWith('{')) {
      const text = this.collectFlow(rest, line);
      return text.startsWith('[') ? this.flowSeq(text, line) : this.flowMap(text, line);
    }
    return this.scalar(rest, line);
  }

  collectFlow(rest, startLine) {
    let text = rest;
    let depth = bracketDelta(text);
    while (depth > 0 && !this.eof()) {
      const line = this.peekValue(0);
      if (!line) break;
      this.next();
      text += ` ${line.content.trim()}`;
      depth += bracketDelta(line.content);
    }
    if (depth !== 0) {
      throw new SchemaError('行内 `[` / `{` 没有闭合（括号数量对不上）', {
        file: this.file,
        line: startLine.line,
        snippet: startLine.raw,
      });
    }
    return text;
  }

  /* ---- 块标量 ---- */

  blockScalar(line, indent) {
    this.next();
    return this.readBlockScalar(line.content, line, indent);
  }

  blockScalarFrom(header, keyLine, indent) {
    return this.readBlockScalar(header, keyLine, indent);
  }

  readBlockScalar(header, keyLine, indent) {
    const style = header[0];
    const chomp = /-/.test(header) ? 'strip' : /\+/.test(header) ? 'keep' : 'clip';
    const explicit = /(\d)/.exec(header);
    const collected = [];
    let blockIndent = explicit ? indent + Number(explicit[1]) : null;
    while (!this.eof()) {
      const line = this.peek();
      if (line.indent <= indent) break;
      this.next();
      if (blockIndent == null) blockIndent = line.indent;
      collected.push(line);
    }
    if (blockIndent == null) blockIndent = indent + 1;
    const texts = collected.map((l) => (l.content.length >= blockIndent ? l.raw.slice(blockIndent) : ''));
    let text;
    if (style === '|') {
      text = texts.join('\n');
    } else {
      const parts = [];
      let buffer = [];
      for (const t of texts) {
        if (t.trim() === '') {
          if (buffer.length) {
            parts.push(buffer.join(' '));
            buffer = [];
          }
          parts.push('');
        } else {
          buffer.push(t.trim());
        }
      }
      if (buffer.length) parts.push(buffer.join(' '));
      text = parts.join('\n');
    }
    if (chomp === 'strip') return text.replace(/\n+$/, '');
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  /* ---- 标量 ---- */

  scalarKey(text, line) {
    const t = text.trim();
    if (t.startsWith('?')) {
      throw new SchemaError('不支持复杂键（以 `?` 开头的键）', {
        file: this.file,
        line: line.line,
        snippet: line.raw,
      });
    }
    const v = this.scalar(t, line);
    return typeof v === 'string' ? v : String(v);
  }

  scalar(text, line) {
    const t = text.trim();
    if (t === '') return null;
    if (t[0] === '"') return this.parseDoubleQuoted(t, line);
    if (t[0] === "'") return this.parseSingleQuoted(t, line);
    if (t[0] === '*' || t[0] === '&') {
      throw new SchemaError('不支持 YAML 锚点 / 别名（`&` / `*`）。多源同物请用 data/entities.yml 的 keys 归并', {
        file: this.file,
        line: line.line,
        snippet: line.raw,
      });
    }
    if (t.startsWith('!')) {
      throw new SchemaError('不支持 YAML 标签（`!` / `!!`）', {
        file: this.file,
        line: line.line,
        snippet: line.raw,
      });
    }
    if (t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
    if (t === 'true' || t === 'True' || t === 'TRUE') return true;
    if (t === 'false' || t === 'False' || t === 'FALSE') return false;
    if (RE_NUMBER.test(t)) return Number(t);
    return t;
  }

  parseDoubleQuoted(t, line) {
    let out = '';
    let i = 1;
    for (; i < t.length; i += 1) {
      const ch = t[i];
      if (ch === '\\') {
        const nx = t[i + 1];
        const table = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0' };
        if (nx in table) {
          out += table[nx];
          i += 1;
        } else if (nx === 'u') {
          out += String.fromCharCode(parseInt(t.slice(i + 2, i + 6), 16));
          i += 5;
        } else {
          throw new SchemaError(`不认识的转义 \\${nx}`, {
            file: this.file,
            line: line.line,
            snippet: line.raw,
          });
        }
        continue;
      }
      if (ch === '"') {
        const tail = t.slice(i + 1).trim();
        if (tail !== '') {
          throw new SchemaError(`双引号字符串后面还有多余内容 \`${tail}\``, {
            file: this.file,
            line: line.line,
            snippet: line.raw,
          });
        }
        return out;
      }
      out += ch;
    }
    throw new SchemaError('双引号字符串没有闭合', { file: this.file, line: line.line, snippet: line.raw });
  }

  parseSingleQuoted(t, line) {
    let out = '';
    for (let i = 1; i < t.length; i += 1) {
      if (t[i] === "'") {
        if (t[i + 1] === "'") {
          out += "'";
          i += 1;
          continue;
        }
        const tail = t.slice(i + 1).trim();
        if (tail !== '') {
          throw new SchemaError(`单引号字符串后面还有多余内容 \`${tail}\``, {
            file: this.file,
            line: line.line,
            snippet: line.raw,
          });
        }
        return out;
      }
      out += t[i];
    }
    throw new SchemaError('单引号字符串没有闭合', { file: this.file, line: line.line, snippet: line.raw });
  }

  /* ---- 行内集合 ---- */

  flowSeq(text, line) {
    const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
    // `[]` 是空序列，不是「一个空元素」：splitFlow('') 会给出 ['']，再解析成 [null]
    if (inner.trim() === '') return [];
    const parts = splitFlow(inner);
    return parts.map((p, i) => {
      this.noteKey(String(i), line);
      this.path('push', i);
      const v = this.valueFromFlow(p.trim(), line);
      this.path('pop');
      return v;
    });
  }

  flowMap(text, line) {
    const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
    // `{}` 是空映射，与 `[]` 同理
    if (inner.trim() === '') return {};
    const parts = splitFlow(inner);
    const map = {};
    for (const part of parts) {
      const split = findTopLevelColon(part);
      if (!split) {
        throw new SchemaError(`行内映射 \`{...}\` 里缺少 \`键: 值\`：\`${part.trim()}\``, {
          file: this.file,
          line: line.line,
          snippet: line.raw,
        });
      }
      const key = this.scalarKey(part.slice(0, split.index), line);
      this.noteKey(key, line);
      this.path('push', key);
      map[key] = this.valueFromFlow(part.slice(split.index + 1).trim(), line);
      this.path('pop');
    }
    return map;
  }

  valueFromFlow(text, line) {
    if (text === '') return null;
    if (text.startsWith('[')) return this.flowSeq(text, line);
    if (text.startsWith('{')) return this.flowMap(text, line);
    return this.scalar(text, line);
  }

  resolveInline(text, line) {
    return this.parseValue(text.trim(), line.indent, line);
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function bracketDelta(text) {
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '[' || ch === '{') delta += 1;
    else if (ch === ']' || ch === '}') delta -= 1;
  }
  return delta;
}

/** 找顶层（不在引号/括号内）的 `:`；要求后面是空白或行尾 */
export function findTopLevelColon(text) {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "'") {
        if (text[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0) {
      const nextCh = text[i + 1];
      if (nextCh === undefined || nextCh === ' ' || nextCh === '\t') return { index: i };
    }
  }
  return null;
}

/** 按顶层逗号切分流式内容 */
function splitFlow(text) {
  const out = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          current += "'";
          i += 1;
        } else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i += 1;
      } else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '' || out.length === 0) out.push(current);
  return out.filter((s) => s.trim() !== '' || out.length === 1);
}

/* ------------------------------------------------------------------ */
/* 公开 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解析 YAML 文本。
 * @param {string} text
 * @param {{file?: string}} [options]
 * @returns {any} 解析结果
 * @throws {SchemaError} 带文件名 + 行号
 */
export function parseYaml(text, options = {}) {
  const file = options.file ?? '<yaml>';
  const parser = new Parser(text, file);
  const value = parser.run();
  return value;
}

/**
 * 解析 YAML 文本，同时返回 `键路径 → 行号` 映射（用于校验报告行号）。
 * @returns {{ data: any, lines: Map<string, number>, lineCount: number }}
 */
export function parseYamlWithLines(text, options = {}) {
  const file = options.file ?? '<yaml>';
  const parser = new Parser(text, file);
  const data = parser.run();
  return { data, lines: parser.linesByPath, lineCount: parser.rawLines.length };
}

/* ------------------------------------------------------------------ */
/* 序列化（写 data/registry.yml 等，供 new.mjs 用）                     */
/* ------------------------------------------------------------------ */

function scalarToText(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`不能把 ${value} 写成 YAML 标量`);
    return String(value);
  }
  const text = String(value);
  // 保留结尾换行（`|` 保留一个、`|+` 保留全部），避免 round-trip 丢字符
  if (text.includes('\n')) {
    const trailing = /(\n+)$/.exec(text);
    const body = (trailing ? text.slice(0, -trailing[1].length) : text).split('\n').map((l) => (l ? `  ${l}` : ''));
    const header = !trailing ? '|-' : trailing[1].length === 1 ? '|' : '|+';
    return `${header}\n${body.join('\n')}`;
  }
  if (text === '' || looksLikeNonString(text) || RE_QUOTE_NEEDED.test(text) || /^\s|\s$/.test(text)) {
    // 含单引号时用双引号形式（JSON 转义恰好是 YAML 双引号的合法子集）
    if (!text.includes("'")) return `'${text}'`;
    return JSON.stringify(text);
  }
  return text;
}

function toYaml(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          const nested = toYaml(item, indent + 2);
          return `${pad}- ${nested.slice(indent + 2)}`;
        }
        return `${pad}- ${scalarToText(item)}`;
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return keys
      .map((key) => {
        const v = value[key];
        const k = scalarToText(key);
        if (v !== null && typeof v === 'object') {
          const nested = toYaml(v, indent + 2);
          if (nested === '[]' || nested === '{}') return `${pad}${k}: ${nested}`;
          return `${pad}${k}:\n${nested}`;
        }
        return `${pad}${k}: ${scalarToText(v)}`;
      })
      .join('\n');
  }
  return `${pad}${scalarToText(value)}`;
}

/** 把 JS 值序列化成 YAML 文本（末尾带换行；块标量缩进 2 空格） */
export function stringifyYaml(value) {
  const text = toYaml(value, 0);
  return text.endsWith('\n') ? text : `${text}\n`;
}
