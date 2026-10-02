/**
 * 站点标识（logo / favicon / og 图）生成器 —— 零依赖。
 *
 * 设计口径（docs/08 视觉系统）：
 *   · 站点是**像素风**（PX=4、crispEdges），所以标识也是像素画：16×16 网格；
 *   · 底色用 **海洋品牌蓝 #2f6fb8**（取自 dsh-myskin 的海洋令牌，站点默认主题色；静态图标只能跟随默认），
 *     白书页 + 琥珀书签 —— 「百科」的意象；
 *   · **刻意不出现任何像 DeepSeek 官方标识的元素**：本站是非官方社区资料站，
 *     标识只表达「这是一本中文百科」，不暗示官方身份。
 *
 * 用法：node scripts/logo.mjs
 * 产物（都入库，CI 不跑它）：web/favicon.ico、favicon-16/32/48.png、
 *   apple-touch-icon.png、favicon.svg、logo.svg、og-image.png
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');

/* ---------------------------------------------------------------- 像素画 */

// 16×16 网格：`.` 透明、`g` 浅绿（瓷砖描边）、`b` 品牌墨绿、`w` 白（书页）、
// `a` 琥珀（高亮行）、`d` 深色（文字线）
//
// 形态：品牌色瓷砖 + 一张白色文档 + 三条文字线，其中一条用琥珀高亮。
// 第一版把"书"画成竖长条，16px 下完全读不出来（像两根彩条），已改。
const MARK = [
  '................',
  '..gggggggggggg..',
  '.gbbbbbbbbbbbbg.',
  '.gbbbbbbbbbbbbg.',
  '.gbbwwwwwwwwbbg.',
  '.gbbwwwwwwwwbbg.',
  '.gbbwddddddwbbg.',
  '.gbbwwwwwwwwbbg.',
  '.gbbwddddddwbbg.',
  '.gbbwwwwwwwwbbg.',
  '.gbbwaaaawwwbbg.',
  '.gbbwwwwwwwwbbg.',
  '.gbbbbbbbbbbbbg.',
  '.gbbbbbbbbbbbbg.',
  '..gggggggggggg..',
  '................',
];

const COLORS = {
  g: [0xb3, 0xc9, 0xe4, 255], // 描边：海洋配色的 border-l2
  b: [0x2f, 0x6f, 0xb8, 255], // 海洋品牌蓝 #2f6fb8（dsh-myskin 的 brand-primary，与 pedia.css 一致）
  w: [0xff, 0xff, 0xff, 255], // 书页
  a: [0xf0, 0xa4, 0x2a, 255], // 书签
  d: [0x0c, 0x1e, 0x34, 255], // 深蓝（label-primary，书页文字线）
};

/** 网格 → RGBA 像素（放缩 scale 倍，最近邻，保持像素硬边） */
function paint(grid, scale) {
  const size = grid.length;
  const w = size * scale;
  const out = new Uint8Array(w * w * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = COLORS[grid[y][x]];
      if (!c) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (y * scale + dy) * w + (x * scale + dx);
          out[px * 4] = c[0];
          out[px * 4 + 1] = c[1];
          out[px * 4 + 2] = c[2];
          out[px * 4 + 3] = c[3];
        }
      }
    }
  }
  return { width: w, height: w, rgba: out };
}

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

function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO：直接内嵌 PNG（Vista 起支持，所有现代浏览器都认） */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/* ------------------------------------------------------------- SVG 输出 */

function markSvg() {
  const rects = [];
  for (let y = 0; y < MARK.length; y++) {
    for (let x = 0; x < MARK[y].length; x++) {
      const c = COLORS[MARK[y][x]];
      if (!c) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" role="img" aria-label="DSH 百科"><title>DSH 百科</title>${rects.join('')}</svg>\n`;
}

/* ---------------------------------------------------------------- og 图 */

/** og:image 用像素风底 + 品牌色块拼一张 1200×630 的图（不排汉字，避免无字体依赖） */
function ogImage() {
  const W = 1200;
  const H = 630;
  const rgba = new Uint8Array(W * H * 4);
  const bg = [0x0e, 0x1f, 0x1d, 255];
  const band = [0x12, 0x79, 0x6f, 255];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = y > H - 26 || y < 26 ? band : bg;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  // 右下角放 8 倍放大的标识
  const scale = 8;
  const big = paint(MARK, scale);
  const ox = W - big.width - 120;
  const oy = Math.round((H - big.height) / 2);
  for (let y = 0; y < big.height; y++) {
    for (let x = 0; x < big.width; x++) {
      const s = (y * big.width + x) * 4;
      if (big.rgba[s + 3] === 0) continue;
      const d = ((oy + y) * W + (ox + x)) * 4;
      rgba[d] = big.rgba[s];
      rgba[d + 1] = big.rgba[s + 1];
      rgba[d + 2] = big.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  // 左上角画一块「文字占位」的像素线（示意站名，不依赖字体）
  const line = (x0, y0, len, th, color) => {
    for (let y = y0; y < y0 + th; y++) {
      for (let x = x0; x < x0 + len; x++) {
        const i = (y * W + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = 255;
      }
    }
  };
  const ink = [0xe8, 0xf6, 0xf3, 255];
  line(120, 250, 520, 34, ink);
  line(120, 320, 360, 22, [0x8f, 0xe3, 0xd8, 255]);
  line(120, 372, 440, 22, [0x8f, 0xe3, 0xd8, 255]);
  return { width: W, height: H, rgba };
}

/* ------------------------------------------------------------------ 输出 */

const writes = [];
function write(name, buf) {
  fs.writeFileSync(path.join(WEB, name), buf);
  writes.push(`${name} (${Math.round(buf.length / 1024)} KB)`);
}

write('favicon.svg', Buffer.from(markSvg(), 'utf8'));
write('logo.svg', Buffer.from(markSvg(), 'utf8'));
const pngs = {};
for (const size of [16, 32, 48, 180]) {
  const img = paint(MARK, size / 16);
  const png = encodePng(img);
  pngs[size] = png;
  write(size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`, png);
}
write('favicon.ico', encodeIco([16, 32, 48].map((size) => ({ size, png: pngs[size] }))));
write('og-image.png', encodePng(ogImage()));

process.stdout.write('标识已生成：\n' + writes.map((w) => '  ' + w).join('\n') + '\n');
