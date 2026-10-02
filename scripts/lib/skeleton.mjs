/**
 * skeleton.mjs —— 词条骨架（`new.mjs` 与机器人「新增词条」操作共用一套）。
 *
 * 为什么抽出来：骨架原本写在 `new.mjs` 里，而 `new.mjs` 是带副作用的 CLI
 * （import 即执行 main），机器人操作不能 import 它。抽到这里后两处共用同一份定义，
 * 改骨架只改这里，不会出现「人领号生成的骨架」与「机器人建的骨架」不一样。
 */
import { isMissing } from './util.mjs';

/** YAML 标量：能不引就不引，该引就引（含首尾空格、特殊首字符时） */
export function quote(text) {
  const s = String(text);
  if (/^[\p{Letter}\p{Number}][\p{Letter}\p{Number} \u3000._@/-]*$/u.test(s) && !/^(true|false|null|~)$/i.test(s)) {
    return s;
  }
  return JSON.stringify(s);
}

/**
 * 生成词条文件全文：front-matter（公共必填 + 该 kind 的注释提示）+ 正文。
 *
 * @param {string} kind  词条类型（ENTRY_KINDS 之一）
 * @param {string} title 标题
 * @param {string} date  updatedAt（YYYY-MM-DD）
 * @param {{summary?: string, body?: string}} [opts]
 *        summary 给了就写进 summary（机器人代建时用表单里的一句话摘要）；
 *        body 给了就代替默认的「## TODO 第一节」占位。
 */
export function skeleton(kind, title, date, opts = {}) {
  const lines = [
    `title: ${quote(title)}`,
    'category: []            # TODO 填 taxonomy 的叶子节点 id（如 concept.runtime）；规则 6 是 error',
    'tags: []',
    isMissing(opts.summary)
      ? 'summary: TODO 一句话摘要，用于列表与搜索'
      : `summary: ${quote(opts.summary)}`,
    'status: draft           # draft | published | archived | deleted（必须与 registry 一致）',
    `updatedAt: ${date}`,
  ];

  const kindHints = {
    concept: ['# layer: runtime | plugin | agent | workspace | ecosystem', '# spec: 权威出处（代码路径或规范文档 URL）'],
    plugin: [
      '# repo: owner/repo        # npm 与 repo 至少给一个（规则 16）',
      '# npm: "@scope/name"',
      '# install: dsh plugin add <…>',
      '# role: bundle | client | bundle+client | theme | compat',
      '# positioning: TODO 用生态语境说清它解决什么问题（不要照抄上游 description）',
      '# entryGate: tutorial     # official | tutorial | pack | maintainer（插件收录门槛，规则 15）',
    ],
    tutorial: [
      '# difficulty: beginner | intermediate | advanced',
      '# prereq: [concept/1]',
      '# appliesTo: "dsh 0.1.0-rc.6 实测；0.2.x 未核实"   # 必须带「实测 / 未核实」口径（规则 11）',
      '# origin: original        # original | external',
      '# related: []',
    ],
    pack: ['# marketId: <owner>.<repo>', '# packType: profile | dshhome', '# fitFor: TODO 这包适合谁（人工判断）'],
    launcher: [
      '# launcherId: dshl | hdsl | dsh-packforge-app | official-desktop | dsh-cli',
      '# url: …',
      '# platforms: []',
    ],
    source: [
      '# url: …',
      '# zones: [plugins]',
      '# sourceKind: plugin-directory | guide | market | registry | spec | tool | topic',
      '# relation: complementary | overlapping | upstream',
      '# howto: TODO 怎么用它 / 怎么向它投稿',
      '# linkOut: …',
    ],
  };
  lines.push(...(kindHints[kind] ?? []));

  const body = isMissing(opts.body)
    ? ['## TODO 第一节', '', '这里写正文（中文）。标题从二级开始，构建期会生成锚点与 TOC。', ''].join('\n')
    : String(opts.body);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
