/**
 * 吉祥物生成器：跟随光标的「鲸鱼娘」—— 零依赖。
 *
 * 设计口径：
 *   · 与站点标识同一套**像素语言**（32×32 网格、crispEdges、rect 拼的 SVG），理由见 docs/08 §9；
 *   · 造型依据「鲸鱼娘」公认特征（蓝色渐变长发、呆毛、鲸类头鳍、蓝眼睛、深蓝白女仆头饰与领口、
 *     大型鲸尾）画**原创像素画**：不描摹任何具体作品，也不用任何官方标识；
 *   · **不动光标本身**：系统指针一律照旧，吉祥物是「跟在光标后面的宠物」，
 *     所以它必须 pointer-events: none，绝不能挡点击、选字与滚动。
 *
 * 两帧为什么只差尾巴：换帧是给「活着」的最小信号，整只乱动会在长时间阅读里变成干扰。
 * 上下浮动交给 JS（跟随的插值里已经算了），换帧交给 CSS（background-position + steps(2)），
 * 两边各管一件事，不互相覆盖 transform。
 *
 * 用法：
 *   node scripts/mascot.mjs                       # 写入 web/（产物入库，CI 不跑它）
 *   node scripts/mascot.mjs --out .tmp/mascot     # 写到别处（预览、比对）
 *   node scripts/mascot.mjs --preview .tmp/x.png  # 另出一张放大评审图（不用浏览器）
 *   node scripts/mascot.mjs --manifest            # 只打印文件 / 尺寸，不写文件
 *
 * 产物：
 *   web/mascot-whale-girl.png   两帧横排 64×32（CSS 按 background-position 换帧）
 *   web/mascot-whale-girl.svg   第 1 帧，32×32（文档、评审图、单帧兜底用）
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------------------------------------------- 色板 */

// 蓝色渐变长发 + 深蓝鲸尾/鲸鳍 + 深蓝白女仆装 + 蓝眼睛：同一族蓝，亮色与暗色页面上都读得出。
const COLORS = {
  o: '#14203c', // 描边（深海军蓝）
  w: '#ffffff', // 白（女仆头饰 / 领口荷叶边）
  W: '#dbe6f5', // 白的高光边
  H: '#2f5aa8', // 发色：发根深蓝
  h: '#5b8fd6', // 发色：中段
  l: '#a8cdf0', // 发色：发梢浅蓝
  t: '#d9e9fb', // 发色：末端近白
  n: '#33427f', // 鲸尾 / 鲸类头鳍 / 女仆裙的深蓝
  N: '#7b93cc', // 深蓝的缘光（鳍内侧、尾缘）
  s: '#ffdcc8', // 肤色
  p: '#ff9fb0', // 腮红
  b: '#4f7fd0', // 发带 / 领结的蓝
  B: '#93b9ee', // 蓝结的高光
  e: '#3d5fc4', // 眼睛：虹膜
  E: '#2a4292', // 眼睛：瞳孔与上睫线
};

/* --------------------------------------------------------------- 像素画 */

/**
 * 头（24×25）：发顶 → 女仆头饰（两行荷叶边，戴在头发上，不要做成帽檐）→ 蓝眼睛 →
 * 腮红与嘴 → 两侧鲸类头鳍（与眼睛同高，这是「鲸」的读法来源之一）→
 * 领口荷叶边与深蓝结 → 长发垂到两侧（发根深蓝、发梢近白，就是那条蓝色渐变）。
 */
const HEAD = [
  '..........hh.h..........', // 呆毛（分叉）
  '...........hhh..........',
  '.....oHHHHHHHHHHHHo.....', // 发顶：先把头发画满，头饰是「戴在头发上」的
  '...oHHHHHHHHHHHHHHHHo...',
  '..oHHHHHHHHHHHHHHHHHHo..',
  '..oHHHHHHHHHHHHHHHHHHo..',
  '..oHHwoowwoowwoowwHHo...', // 女仆头饰：两行，顶缘荷叶边（三行会变帽檐）
  '..oHHWWWWWWWWWWWWWWHHo..',
  '.oHhhssssssssssssssshHo.',
  '.oHhhssssssssssssssshHo.',
  'onNhhs.EE.ssss.EE.shhNno', // 鲸类头鳍与眼睛同高 + 上睫线
  'onNhhseWWesssseWWeshhNno', // 虹膜 + 高光
  'onNhhs.ee.ssss.ee.shhNno',
  '.oNhhssssssssssssssshNo.',
  '.oHhhppsssssssssspphhHo.', // 腮红
  '.oHhhppssssoosssspphhHo.', // 腮红 + 嘴
  '..oHhsssssssssssssshHo..',
  '...oHhssssssssssssHho...',
  '....ohwwwwwwwwwwwwho....', // 领口白色荷叶边
  '.....owwwwwwnnwwwwwo....', // 领口的深蓝结
  '....olllo......olllo....', // 长发垂到两侧，越往下越浅
  '...ollllo......ollllo...',
  '..ollllo........ollllo..',
  '..ollto..........otllo..',
  '...oto............oto...',
];

/** 头饰左端的蓝色蝴蝶结 */
const BOW = ['bb.bb', 'bB.Bb', 'bb.bb'];

/**
 * 侧向鲸尾（8×8）。参考形象里最醒目的特征就是那条大型鲸尾：
 * 头是「娘」的部分，尾巴是「鲸」的部分——两样缺一个都会被读成普通拟人。
 * 形状与箭尾同源（尾柄 → 张开 → 两片尾叶），转了 90° 让尾柄朝着头。
 */
const TAIL = [
  '.....nn',
  '..nnnNn',
  '.nNnn..',
  'nNn....',
  'nNn....',
  '.nNnn..',
  '..nnnNn',
  '.....nn',
];

/* --------------------------------------------------------------- 网格工具 */

function blank(size = 32) {
  return Array.from({ length: size }, () => Array(size).fill('.'));
}

/** 把一块 ASCII 像素画贴到网格上（越界即报错，不许静默裁掉） */
function blit(grid, art, ox, oy) {
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[y].length; x++) {
      const ch = art[y][x];
      if (ch === '.') continue;
      const gx = ox + x;
      const gy = oy + y;
      if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) {
        throw new Error(`blit 越界：(${gx},${gy})`);
      }
      grid[gy][gx] = ch;
    }
  }
  return grid;
}

/** 色号必须都在色板里：写错一个字母要当场报出来，不能静默变成透明 */
function assertColors(art, name) {
  art.forEach((row, y) => {
    for (const ch of row) {
      if (ch !== '.' && !COLORS[ch]) throw new Error(`${name} 第 ${y} 行出现未定义色号「${ch}」`);
    }
  });
}

/**
 * 矩形像素画必须每行等宽：这类画是一格一格描出来的，少写一个像素会让整行右移，
 * 肉眼在 4× 评审图上要盯很久才发现——交给断言。
 */
function assertRect(art, name) {
  const width = Math.max(...art.map((r) => r.length));
  art.forEach((row, y) => {
    if (row.length !== width) throw new Error(`${name} 第 ${y} 行宽度 ${row.length} ≠ ${width}`);
  });
}

/* ---------------------------------------------------------------- 两帧 */

/** 组装一帧：tailY 决定尾巴的高低，两帧只差这一个像素就是「摆尾」 */
function frame(tailY) {
  assertColors(HEAD, 'HEAD');
  assertColors(BOW, 'BOW');
  assertColors(TAIL, 'TAIL');
  assertRect(HEAD, 'HEAD');
  assertRect(BOW, 'BOW');
  assertRect(TAIL, 'TAIL');
  const grid = blank();
  blit(grid, HEAD, 1, 2); // 头（24×25），靠左留出尾巴的位置
  blit(grid, BOW, 3, 8); // 头饰左端的蓝结
  blit(grid, TAIL, 25, tailY); // 侧向鲸尾
  return grid;
}

const FRAMES = [
  { label: '第 1 帧（尾平）', grid: () => frame(11) },
  { label: '第 2 帧（尾摆）', grid: () => frame(12) },
];

/* ------------------------------------------------------------- PNG 编码 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 与 logo.mjs 里的同名编码器保持同一实现（都是 filter=none 的 RGBA PNG） */
function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function gridToRgba(grid, scale = 1) {
  const size = grid.length;
  const w = size * scale;
  const out = new Uint8Array(w * w * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const [r, g, b] = hexToRgb(COLORS[ch]);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = ((y * scale + dy) * w + x * scale + dx) * 4;
          out[p] = r;
          out[p + 1] = g;
          out[p + 2] = b;
          out[p + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: w, rgba: out };
}

/** 多帧横排成一张精灵图：CSS 用 background-position 换帧，比多张图少一次请求 */
function framesToStrip(grids) {
  const size = grids[0].length;
  const width = size * grids.length;
  const out = new Uint8Array(width * size * 4);
  grids.forEach((grid, i) => {
    const { rgba } = gridToRgba(grid);
    for (let y = 0; y < size; y++) {
      const src = y * size * 4;
      out.set(rgba.subarray(src, src + size * 4), (y * width + i * size) * 4);
    }
  });
  return { width, height: size, rgba: out };
}

/* ------------------------------------------------------------- SVG 输出 */

/** 相邻同色像素合并成横条，产物能小一截；像素对齐不变 */
function runRects(grid) {
  const rects = [];
  for (let y = 0; y < grid.length; y++) {
    let x = 0;
    while (x < grid[y].length) {
      const ch = grid[y][x];
      if (ch === '.') {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < grid[y].length && grid[y][x + run] === ch) run++;
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${COLORS[ch]}"/>`);
      x += run;
    }
  }
  return rects;
}

function toSvg(grid, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges" role="img" aria-label="DSH 百科吉祥物：${label}"><title>DSH 百科吉祥物：${label}</title>${runRects(grid).join('')}</svg>\n`;
}

/* ------------------------------------------------------- 评审图（不需要浏览器） */

/**
 * 拼一张 32 位 RGBA 的评审图：每帧一行，亮色底与暗色底各一组，组内 1× / 2× / 4×。
 * 为什么要它：这个仓库的约束是「零依赖、离线可跑」，不能为了看一眼去拉 Playwright；
 * 存成 PNG 后任何看图工具（含 DSH 的 read_image）都能直接看。
 */
function reviewSheet() {
  const W = 900;
  const H = 4 + FRAMES.length * 168;
  const canvas = new Uint8Array(W * H * 4);
  const fill = (x, y, w, h, [r, g, b]) => {
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= W) continue;
        const p = (yy * W + xx) * 4;
        canvas[p] = r;
        canvas[p + 1] = g;
        canvas[p + 2] = b;
        canvas[p + 3] = 255;
      }
    }
  };
  const paste = (sprite, ox, oy) => {
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        const s = (y * sprite.width + x) * 4;
        if (sprite.rgba[s + 3] === 0) continue;
        const p = ((oy + y) * W + ox + x) * 4;
        canvas[p] = sprite.rgba[s];
        canvas[p + 1] = sprite.rgba[s + 1];
        canvas[p + 2] = sprite.rgba[s + 2];
        canvas[p + 3] = 255;
      }
    }
  };
  const LIGHT = [255, 255, 255];
  const DARK = [20, 24, 29];
  const GAP = [216, 221, 228];

  fill(0, 0, W, H, GAP);
  FRAMES.forEach((f, i) => {
    const grid = f.grid();
    const top = i * 168;
    for (const [x0, bg] of [[0, LIGHT], [452, DARK]]) {
      fill(x0, top, 448, 166, bg);
      const baseY = top + 19;
      paste(gridToRgba(grid, 1), x0 + 24, baseY + 48);
      paste(gridToRgba(grid, 2), x0 + 78, baseY + 16);
      paste(gridToRgba(grid, 4), x0 + 190, baseY);
    }
  });
  return { width: W, height: H, rgba: canvas };
}

/* ------------------------------------------------------------------ 主流程 */

const argv = process.argv.slice(2);
const manifestOnly = argv.includes('--manifest');
const outIdx = argv.indexOf('--out');
const outDir = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(ROOT, argv[outIdx + 1]) : path.join(ROOT, 'web');
const previewIdx = argv.indexOf('--preview');
const previewPath = previewIdx >= 0 ? path.resolve(ROOT, argv[previewIdx + 1] ?? '.tmp/mascot-review.png') : null;

const grids = FRAMES.map((f) => f.grid());
const strip = framesToStrip(grids);
const svg = toSvg(grids[0], FRAMES[0].label);

if (!manifestOnly) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mascot-whale-girl.png'), encodePng(strip));
  fs.writeFileSync(path.join(outDir, 'mascot-whale-girl.svg'), svg, 'utf8');
}

const target = manifestOnly ? '（--manifest：未写文件）' : path.relative(ROOT, outDir) || '.';
process.stdout.write(`吉祥物产物 → ${target}\n`);
process.stdout.write(
  `  mascot-whale-girl.png  ${strip.width}×${strip.height}（${FRAMES.length} 帧横排，每帧 32×32，CSS 用 steps(${FRAMES.length}) 换帧）\n`,
);
process.stdout.write(`  mascot-whale-girl.svg  32×32（${FRAMES[0].label}）\n`);
FRAMES.forEach((f, i) => {
  const lit = f.grid().flat().filter((ch) => ch !== '.').length;
  process.stdout.write(`  ${f.label}：${lit} 像素\n`);
});

if (previewPath && !manifestOnly) {
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  const sheet = reviewSheet();
  fs.writeFileSync(previewPath, encodePng(sheet));
  process.stdout.write(`评审图 → ${path.relative(ROOT, previewPath)}（${sheet.width}×${sheet.height}，每行一帧：左亮色 / 右暗色，1× 2× 4×）\n`);
}
