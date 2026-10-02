#!/usr/bin/env node
/**
 * test-mascot.mjs —— 跟随光标的吉祥物（docs/08 §9）的接线契约测试。
 *
 * 为什么需要它：吉祥物的正确性一半在**浏览器里**（跟随手感、镜像、浮动），
 * 那部分沙箱里跑不了；另一半是**跨文件的接线**，而接线坏掉时页面不会报错——
 * 它只会「什么都不出现」，最难发现。所以这一半必须由断言守住：
 *   ① 精灵图与其尺寸：两帧横排 64×32，单帧 SVG 32×32；
 *   ② CSS 与图的尺寸一致（`background-size` 与 PNG 头里的宽高对得上，防止改了一边忘另一边）；
 *   ③ 可用性红线：`.mascot` 必须 `pointer-events: none`（绝不能挡点击与选字）；
 *   ④ 两类人不该看到它：触摸设备与「减少动态效果」在 CSS 与 JS 里都要挡住；
 *   ⑤ JS 与 CSS 用的是同一套类名（`mascot` / `mascot--on`）。
 *
 * 用法：node scripts/test-mascot.mjs   退出码 0 全过 / 1 有失败
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

const CSS = read('web/pedia.css');
const JS = read('web/pedia.js');

/** 取出某条规则块（从选择器到配对的右括号），只用于单条规则，够用 */
function ruleBlock(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  return '';
}

console.log('== ① 精灵图与尺寸 ==');
const pngPath = 'web/mascot-whale-girl.png';
const svgPath = 'web/mascot-whale-girl.svg';
check(`${pngPath} 存在`, fs.existsSync(path.join(ROOT, pngPath)));
check(`${svgPath} 存在`, fs.existsSync(path.join(ROOT, svgPath)));

const png = fs.readFileSync(path.join(ROOT, pngPath));
const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
const w = isPng ? png.readUInt32BE(16) : 0;
const h = isPng ? png.readUInt32BE(20) : 0;
check('精灵图是 PNG', isPng);
check('精灵图 64×32（两帧横排，每帧 32×32）', w === 64 && h === 32, `实得 ${w}×${h}`);

const svg = read(svgPath);
check('单帧 SVG 声明 32×32', svg.includes('width="32" height="32"') && svg.includes('viewBox="0 0 32 32"'));

console.log('\n== ② CSS 与图对得上 ==');
const mascot = ruleBlock(CSS, '.mascot');
check('CSS 里有 .mascot 规则', mascot.length > 0);
check('CSS 按两帧给 background-size', /background-size:\s*64px\s+32px/.test(mascot));
check(
  'background-size 与 PNG 头一致（改一边忘另一边就会在这里断）',
  mascot.includes(`background-size: ${w}px ${h}px`),
  `PNG 是 ${w}×${h}`,
);
check('CSS 引用的就是生成器产出的那张图', mascot.includes('url("mascot-whale-girl.png")'));
check('换帧用 steps（像素画插值会糊）', /animation:\s*mascot-wag[^;]*steps\(2\)/.test(mascot));

console.log('\n== ③ 可用性红线 ==');
check('.mascot 是 pointer-events: none（绝不挡点击、选字、滚动）', /pointer-events:\s*none/.test(mascot));
check('.mascot 不抢层级（z-index 低于左侧导航的 30/40）', (() => {
  const m = /z-index:\s*(\d+)/.exec(mascot);
  return m ? Number(m[1]) < 30 : false;
})());

console.log('\n== ④ 两类人不该看到它 ==');
const mediaBlock = CSS.slice(CSS.indexOf('.mascot {'));
check('CSS 挡住触摸设备（hover: none）', /@media[^{]*\(hover:\s*none\)/.test(CSS));
check('CSS 挡住「减少动态效果」', /prefers-reduced-motion:\s*reduce/.test(CSS));
check('JS 也挡触摸设备', JS.includes("matchMedia('(hover: none)')"));
check('JS 也挡「减少动态效果」', JS.includes("matchMedia('(prefers-reduced-motion: reduce)')"));
check('CSS 的媒体块里确实隐藏了 .mascot', /@media[^{]*hover:\s*none[^{]*\{[\s\S]*?\.mascot\s*\{[\s\S]*?display:\s*none/.test(mediaBlock));

console.log('\n== ⑤ JS 与 CSS 同一套类名 ==');
check('JS 定义了 mountMascot', JS.includes('function mountMascot()'));
check('JS 挂载时用了 .mascot 类', /className\s*=\s*'mascot'/.test(JS));
check('JS 显示/隐藏用的是 CSS 里那个修饰类', JS.includes('mascot--on') && CSS.includes('.mascot--on'));
check('mousemove 是 passive（不拖慢滚动）', /addEventListener\('mousemove'[\s\S]{0,400}?passive:\s*true/.test(JS));

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
