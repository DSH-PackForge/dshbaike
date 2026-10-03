#!/usr/bin/env node
/**
 * test-routing.mjs —— 贡献系统契约的回归测试（docs/14）。
 *
 * 测三件最容易静默坏掉的事：
 *   ① **路由**：标题/下拉 → 该用哪个操作、编号从哪来（`[内容变更] 改一个字段 plugin/1`）；
 *   ② **拒绝**：机器人不能安全改的情形必须拒绝，而不是猜（嵌套字段、定位不唯一、分区不存在）；
 *   ③ **每个操作都不写文件**：`ops.*.apply()` 只返回新内容，落盘由调用方做——
 *      这条性质让测试能在 CI 里跑，也让「先审后改」的两道闸成立。
 *
 * 用法：node scripts/test-routing.mjs   退出码 0 全过 / 1 有失败
 */

import { OPS, findOp, parseFormBody } from './lib/ops.mjs';

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`  ✅ ${name}`); } else {
    fail += 1; console.log(`  ❌ ${name}\n       期望 ${JSON.stringify(want)}\n       实得 ${JSON.stringify(got)}`);
  }
};

console.log('== ① 路由：标题 → 操作 + 编号 ==');
// 一张表单 = 一个意图：站点深链把编号写进标题（GitHub 不能预填表单字段，只能预填标题）
const routes = [
  ['[担任维护者] plugin/1', {}, 'claim', 'plugin/1'],
  ['[接手维护] plugin/1', {}, 'claim', 'plugin/1'], // 旧标题仍要能解析
  ['[认领维护] plugin/1', {}, 'claim', 'plugin/1'], // 更早的旧标题也要能解析
  ['[担任维护者] plugin/1', { 'GitHub 用户名': 'someone' }, 'claim', 'plugin/1'],
  ['[改一个字段] concept/1', {}, 'field', 'concept/1'],
  ['[改正文里的一句话] plugin/1', {}, 'replace', 'plugin/1'],
  ['[补充分区条目] themes', {}, 'zone-item', 'themes'],
  ['[收录我的插件] ccch1mneyyy/dsh-TUI', { 'GitHub 用户名': 'someone' }, 'import-project', 'ccch1mneyyy/dsh-TUI'],
  // 兼容历史 Issue：早期用了「内容变更 + 操作名」的合并形式，仍然认得
  ['[内容变更] 改一个字段 concept/1', {}, 'field', 'concept/1'],
  ['[内容变更] 随便什么', { 操作类型: '改一个字段' }, 'field', '随便什么'],
  // 不由机器人处理的两类（由人来处理），以及无前缀的
  ['[站点改进] 导航太绕', {}, null, null],
  ['[纠错] 某个词条', {}, null, null],
  ['不是方括号标题', {}, null, null],
];
for (const [title, form, opId, target] of routes) {
  const r = findOp(title, form);
  check(`「${title}」→ ${opId ?? '不处理'}`, [r ? r.op.id : null, r ? r.target : null], [opId, target]);
}

console.log('\n== ② 拒绝：不能安全改就拒绝，且要能升级给人 ==');
const U = { 'GitHub 用户名': 'some-contributor' };
const cases = [
  ['嵌套字段 compat 改不了', OPS.field.apply({ target: '', form: { ...U, '词条 id': 'plugin/1', 字段名: 'compat', 新的值: 'x' } }), [false, 'unsupported', true]],
  ['词条 id 不存在', OPS.field.apply({ target: '', form: { ...U, '词条 id': 'plugin/999', 字段名: 'updatedAt', 新的值: '2026-01-01' } }), [false, 'unknown-entry', false]],
  ['正文片段命中多处（「的」）', OPS.replace.apply({ target: '', form: { ...U, '词条 id': 'plugin/1', 原文片段: '的', 改成: '之' } }), [false, 'ambiguous', true]],
  ['正文片段找不到', OPS.replace.apply({ target: '', form: { ...U, '词条 id': 'plugin/1', 原文片段: '这段文字肯定不在正文里xyzzy', 改成: 'x' } }), [false, 'not-found', true]],
  ['分区不存在', OPS['zone-item'].apply({ target: '', form: { ...U, 分区: 'nope', '二级分区 id': 'x', 名称: 'n', 一句话介绍: 'b', 外部链接: 'https://example.com' } }), [false, 'unknown-zone', false]],
  ['二级分区不存在', OPS['zone-item'].apply({ target: '', form: { ...U, 分区: 'themes', '二级分区 id': 'nope', 名称: 'n', 一句话介绍: 'b', 外部链接: 'https://example.com' } }), [false, 'unknown-section', false]],
  ['表单没填全', OPS.claim.apply({ target: '', form: {} }), [false, 'incomplete', false]],
  ['缺 GitHub 用户名（署名契约）', OPS.field.apply({ target: 'concept/1', form: { 字段名: 'updatedAt', 新的值: '2026-01-01' } }), [false, 'incomplete', false]],
  ['用户名形状不合法', OPS.field.apply({ target: 'concept/1', form: { 'GitHub 用户名': 'bad user!', 字段名: 'updatedAt', 新的值: '2026-01-01' } }), [false, 'bad-username', false]],
  ['用户名带 @ 也要挡（有人会顺手写）', OPS['zone-item'].apply({ target: '', form: { 'GitHub 用户名': '@someone', 分区: 'themes', '二级分区 id': 'packs', 名称: 'n', 一句话介绍: 'b', 外部链接: 'https://x.com' } }), [true, undefined, false]],
];
for (const [name, r, want] of cases) {
  check(name, [r.ok, r.reason, /unsupported|ambiguous|not-found/.test(r.reason ?? '')], want);
}
check('带 @ 的用户名会被规范化成干净的用户名', OPS.field.apply({ target: 'concept/1', form: { 'GitHub 用户名': '@someone', 字段名: 'updatedAt', 新的值: '2026-01-01' } }).credited, 'someone');

console.log('\n== ③ 成功路径只返回文本，不落盘；并且一定带回署名 ==');
const okCase = OPS.field.apply({ target: 'concept/1', form: { ...U, 字段名: 'updatedAt', 新的值: '2026-12-31' } });
check('改一个字段：拿到新内容而不是写文件', [okCase.ok, Array.isArray(okCase.writes), typeof okCase.writes[0].text], [true, true, 'string']);
check('新内容里确实改了那一行', /updatedAt: 2026-12-31/.test(okCase.writes[0].text), true);
check('带回署名（供 PR 归因）', okCase.credited, 'some-contributor');
const auto = OPS.claim.apply({ target: 'plugin/1', form: { 'GitHub 用户名': 'someone' } });
check('担任维护者：署名信息一并返回', [auto.ok, auto.credited], [true, 'someone']);
const zoneOk = OPS['zone-item'].apply({ target: '', form: { ...U, 分区: 'themes', '二级分区 id': 'packs', 名称: 'n', 一句话介绍: 'b', 外部链接: 'https://x.com' } });
check('补充分区条目：也带回署名', [zoneOk.ok, zoneOk.credited], [true, 'some-contributor']);
check('每个操作都声明了「要用户名」——源码里能看出来',
  Object.values(OPS).every((op) => /requireUsername/.test(op.apply.toString())), true);

console.log('\n== ④ 表单正文解析（Issue Forms 渲染格式）==');
const body = [
  '### 操作类型', '', '改一个字段', '',
  '### 词条 id', '', 'plugin/1', '',
  '### 字段名', '', 'updatedAt', '',
  '### 出处（可选但强烈建议）', '', '_No response_', '',
].join('\n');
check('按标签解析出字段，未填的变成空串', parseFormBody(body), {
  操作类型: '改一个字段', '词条 id': 'plugin/1', 字段名: 'updatedAt', '出处（可选但强烈建议）': '',
});

console.log('\n== ⑤ 收录工具（离线，注入桩 fetch）==');
// 「收录我的插件」是唯一联网的 op，所以它的核心逻辑抽在 lib 里、fetch 可注入——
// 这一段完全不联网，测的是清洗与组装：HTML 表格被丢后必须**告警**，否则内容会静默消失。
const { planProjectImport } = await import('./lib/import-project.mjs');
const stubFetch = async (url) => {
  const ok = (o) => ({ status: 200, ok: true, ...o });
  const miss = { status: 404, ok: false, json: async () => null, text: async () => '' };
  if (/api\.github\.com\/repos\/x\/y$/.test(url)) {
    return ok({
      json: async () => ({
        full_name: 'x/y', stargazers_count: 7, forks_count: 1, language: 'TypeScript',
        default_branch: 'main', description: '一句话简介', license: { spdx_id: 'MIT' },
      }),
      text: async () => '',
    });
  }
  if (/package\.json$/.test(url)) {
    const json = JSON.stringify({ name: '@x/y', version: '1.2.3', bin: { y: 'cli.js' } });
    return ok({ json: async () => JSON.parse(json), text: async () => json });
  }
  if (/README_ZH\.md$/.test(url)) {
    return ok({ text: async () => '# Y\n\n## 功能\n\n见 [文档](docs/a.md)。\n\n## 维护团队\n\n<table><tbody></tbody></table>\n' });
  }
  return miss;
};
const plan = await planProjectImport({ repoRef: 'x/y', kind: 'plugin', user: 'someone', now: '2026-10-03', fetchImpl: stubFetch });
check('生成草稿成功', plan.ok, true);
check('优先用简体中文 README', plan.readmeFile, 'README_ZH.md');
check('相对链接转成仓库绝对地址', /https:\/\/github\.com\/x\/y\/blob\/main\/docs\/a\.md/.test(plan.entryText), true);
check('产出是 draft（不合并不上线）', /^status: draft/m.test(plan.entryText), true);
check('门槛写成 maintainer 且带理由', /^entryGate: maintainer$/m.test(plan.entryText) && /^entryGateNote: /m.test(plan.entryText), true);
check('没有字面量反斜杠反引号', /\\`/.test(plan.entryText), false);
check('清洗后变空的小节会告警（HTML 表格被丢掉）', plan.warnings.join(' ').includes('维护团队'), true);
check('取不到上游时给人话、不抛异常',
  (await planProjectImport({ repoRef: 'x/nope', fetchImpl: async () => ({ status: 404, ok: false, json: async () => null, text: async () => '' }) })).reason,
  'upstream-unreachable');
// 机器读不到的东西必须**显式预留**（评审：肯定有字段收集不到，比如 bug——要预留好）
check('机器读不到的项列成 checklist（≥6 项）', plan.openQuestions.length >= 6, true);
check('checklist 里点名了「已知问题 / 限制」', plan.openQuestions.join(' ').includes('已知问题'), true);
check('上游没有「限制」一节时，替它留出空位', /## 已知问题与限制/.test(plan.entryText), true);
check('空位里有 TODO，不是静默省略', /## 已知问题与限制[\s\S]{0,80}TODO/.test(plan.entryText), true);

console.log(`\n== 结果：通过 ${pass} 项，失败 ${fail} 项 ==`);
process.exit(fail ? 1 : 0);
