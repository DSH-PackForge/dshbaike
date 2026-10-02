#!/usr/bin/env node
/**
 * test-mascot.mjs —— 跟随光标的吉祥物（docs/08 §9）的接线与合规契约测试。
 *
 * 为什么需要它：吉祥物的正确性一半在**浏览器里**（跟随手感、换帧、镜像），那部分沙箱里
 * 跑不了；另一半是**跨文件的接线与许可义务**，坏掉时页面不会报错——它只会「什么都不出现」，
 * 或者「用了别人的素材却没署名」。这两类都必须由断言守住：
 *   ① 两套横排精灵存在、尺寸与帧数对得上（换帧位移靠它算）；
 *   ② CSS 的帧宽与图的帧宽一致（改了一边忘另一边，换帧就会错位）；
 *   ③ 可用性红线：`.mascot` 必须 `pointer-events: none`；
 *   ④ 两类人不该看到它：触摸设备与「减少动态效果」，CSS 与 JS 都要挡住；
 *   ⑤ JS 与 CSS 同一套类名（`mascot` / `mascot__sprite` / `mascot--walk` / `mascot--on`）；
 *   ⑥ **署名**：CREDITS 与许可全文都在，页脚那条署名线还在（这是素材许可的条件）。
 *
 * 用法：node scripts/test-mascot.mjs   退出码 0 全过 / 1 有失败
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

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

/** 取出某条规则块（从选择器到配对的右括号），用于单条规则 */
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

/** 读 PNG 头：宽、高 */
function pngSize(p) {
  const buf = fs.readFileSync(path.join(ROOT, p));
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log('== ① 两套横排精灵 ==');
const IDLE = 'web/mascot-fatfish-idle.png';
const WALK = 'web/mascot-fatfish-walk.png';
check(`${IDLE} 存在`, exists(IDLE));
check(`${WALK} 存在`, exists(WALK));
const idle = pngSize(IDLE);
const walk = pngSize(WALK);
const FRAME = 192; // 每帧画布边长
check('待机图是 6 帧横排（1152×192）', idle && idle.w === FRAME * 6 && idle.h === FRAME, idle ? `实得 ${idle.w}×${idle.h}` : '读不出');
check('行走图是 8 帧横排（1536×192）', walk && walk.w === FRAME * 8 && walk.h === FRAME, walk ? `实得 ${walk.w}×${walk.h}` : '读不出');
check('两张图帧高一致（换套时人物不跳）', idle && walk && idle.h === walk.h);

console.log('\n== ② CSS 与图对得上 ==');
const sprite = ruleBlock(CSS, '.mascot__sprite');
check('CSS 里有 .mascot__sprite 规则', sprite.length > 0);
check('按高度 96px 缩放（= 帧高 192 的一半，2× 供高 DPI）', /background-size:\s*auto\s+96px/.test(sprite));
check('底边中点为锚（换帧/镜像不左右跳）', /margin-left:\s*-48px/.test(sprite) && /bottom:\s*0/.test(sprite));
check('CSS 引用的就是待机图', sprite.includes('url("mascot-fatfish-idle.png")'));
const walkBlock = CSS.slice(CSS.indexOf('.mascot--walk .mascot__sprite'));
check('行走态切到行走图', walkBlock.includes('url("mascot-fatfish-walk.png")'));

const idleAnim = /@keyframes\s+mascot-idle\s*\{[\s\S]*?background-position:\s*-(\d+)px/.exec(CSS);
const walkAnim = /@keyframes\s+mascot-walk\s*\{[\s\S]*?background-position:\s*-(\d+)px/.exec(CSS);
check('待机换帧位移 = 帧宽 × 6', idleAnim && Number(idleAnim[1]) === (FRAME / 2) * 6, idleAnim ? `实得 -${idleAnim[1]}px` : '没找到');
check('行走换帧位移 = 帧宽 × 8', walkAnim && Number(walkAnim[1]) === (FRAME / 2) * 8, walkAnim ? `实得 -${walkAnim[1]}px` : '没找到');
check('换帧用 steps（插值会糊）', /animation:\s*mascot-idle[^;]*steps\(6\)/.test(sprite) && /steps\(8\)/.test(walkBlock));

console.log('\n== ③ 可用性红线 ==');
const mascot = ruleBlock(CSS, '.mascot');
check('.mascot 是 pointer-events: none（绝不挡点击、选字、滚动）', /pointer-events:\s*none/.test(mascot));
check('.mascot 不抢层级（z-index 低于左侧导航的 30/40）', (() => {
  const m = /z-index:\s*(\d+)/.exec(mascot);
  return m ? Number(m[1]) < 30 : false;
})());

console.log('\n== ④ 两类人不该看到它 ==');
check('CSS 挡住触摸设备（hover: none）', /@media[^{]*\(hover:\s*none\)/.test(CSS));
check('CSS 挡住「减少动态效果」', /prefers-reduced-motion:\s*reduce/.test(CSS));
check('CSS 的媒体块里确实隐藏了 .mascot', /@media[^{]*hover:\s*none[^{]*\{[\s\S]*?\.mascot\s*\{[\s\S]*?display:\s*none/.test(CSS));
check('JS 也挡触摸设备', JS.includes("matchMedia('(hover: none)')"));
check('JS 也挡「减少动态效果」', JS.includes("matchMedia('(prefers-reduced-motion: reduce)')"));

console.log('\n== ⑤ JS 与 CSS 同一套类名 ==');
check('JS 定义了 mountMascot', JS.includes('function mountMascot()'));
check('JS 建了外层 .mascot', /className\s*=\s*'mascot'/.test(JS));
check('JS 建了内层 .mascot__sprite', /className\s*=\s*'mascot__sprite'/.test(JS));
check('走在走/站着两个状态都用了 CSS 里的类', JS.includes('mascot--walk') && JS.includes('mascot--on') && CSS.includes('.mascot--on'));
check('mousemove 是 passive（不拖慢滚动）', /addEventListener\('mousemove'[\s\S]{0,600}?passive:\s*true/.test(JS));

console.log('\n== ⑥ 署名（素材许可的条件，不是可选装饰）==');
check('web/mascot-CREDITS.txt 存在', exists('web/mascot-CREDITS.txt'));
check('许可全文存在', exists('docs/third-party/fatfish-attribution-license-1.0.txt'));
if (exists('web/mascot-CREDITS.txt')) {
  const credits = read('web/mascot-CREDITS.txt');
  check('CREDITS 写明作者', credits.includes('YunYueSama'));
  check('CREDITS 写明仓库地址（许可要求不得只写作者）', credits.includes('https://github.com/YunYueSama/codex-deepseek-pet'));
  check('CREDITS 写明许可名', credits.includes('大肥鱼项目署名许可 1.0'));
  check('CREDITS 说明了本站的修改（许可第 3 条）', credits.includes('修改'));
}
check('页脚配置里有署名三元组', JS.includes('mascotAuthor') && JS.includes('mascotRepo') && JS.includes('mascotLicense'));
check('页脚真的渲染了署名行', /mascotAuthor/.test(JS) && /吉祥物「大肥鱼」/.test(JS));
check('LICENSE 把吉祥物素材列为第三方例外', read('LICENSE').includes('mascot-fatfish-idle.png'));

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
