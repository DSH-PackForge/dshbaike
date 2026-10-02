/**
 * presentation.mjs —— 词条页的展示契约（docs/13）。
 *
 * 三层分法（评审定调：「可以有一个基础格式，然后分区扩展」）：
 *
 *   1. **基础格式**：所有词条共用同一套骨架——面包屑 / 标题 / 摘要 / 首屏块 / 信息表 /
 *      目录 / 正文 / 关系 / 反链 / 脚注。一致性由这一层保证，不由每个类型各写一套模板。
 *   2. **分区扩展**：按 kind 覆盖两件事——
 *      `lead`：这一类最该先看到的一块（配方要代码片段、规范要版本与状态、整合包要成分）；
 *      `groups`：信息表的字段组取舍与顺序（`recipe` 不该有「兼容与平台」，
 *      `spec` 的「版本与状态」应该在基本信息之前）。
 *   3. **缺省降级**：`lead` 需要的数据没有，就**不渲染这块**——不编、不留空壳。
 *
 * 为什么不做 14 套模板：模板是代码，会各自漂移；把差异收敛成「一张声明表 + 三个通用组件」，
 * 新增类型只加十来行声明。
 */

/** 基础字段组（key → 由前端 FIELD_ZH 出中文标签） */
export const BASE_GROUPS = {
  basic: {
    title: '基本信息',
    keys: [
      'positioning', 'titleEn', 'aliases', 'category', 'tags', 'role', 'layer', 'difficulty',
      'origin', 'fitFor', 'maintainers', 'status', 'updatedAt',
    ],
  },
  compat: {
    title: '兼容与平台',
    keys: ['dshVersion', 'dshVersions', 'appliesTo', 'runtime', 'platforms', 'supportedManifest', 'launchers', 'permissions'],
  },
  origin: {
    title: '安装与出处',
    keys: ['install', 'repo', 'npm', 'marketId', 'spec', 'url', 'linkOut', 'coverage', 'downloads', 'relation', 'howto', 'zones', 'prereq', 'related', 'provides', 'requires'],
  },
  license: {
    title: '许可证',
    keys: ['license', 'licenseRefs'],
  },
};

/**
 * 各类型的扩展声明。
 * `lead.type`：
 *   `code`  —— 一个可复制的代码/命令块（用 `field` 取值，`note` 里的字段作为脚注行）
 *   `facts` —— 一排「键: 值」小卡（用 `fields` 取字段，缺的自动跳过）
 * `groups`：基础组的顺序与取舍；`extraGroups`：只属于这个类型的新组。
 */
export const KIND_EXTENSIONS = {
  // ---- 分区类型 ----
  client: {
    lead: { type: 'facts', fields: ['form', 'platforms'] },
    groups: ['basic', 'compat', 'origin', 'license'],
  },
  launcher: {
    lead: { type: 'facts', fields: ['launcherId', 'platforms', 'supportedManifest'] },
    groups: ['basic', 'compat', 'origin', 'license'],
  },
  plugin: {
    lead: null, // 插件页的「定位 + 外部源指针 + 引用卡」已经够抢眼，不再加首屏块
    groups: ['basic', 'compat', 'origin', 'license'],
  },
  theme: {
    lead: { type: 'facts', fields: ['targets'] },
    groups: ['basic', 'compat', 'origin', 'license'],
  },
  asset: {
    lead: { type: 'facts', fields: ['assetType', 'locale'] },
    groups: ['basic', 'origin', 'license'],
  },
  skill: {
    lead: { type: 'facts', fields: ['skillKind', 'roots', 'files'] },
    groups: ['basic', 'origin', 'license'],
  },
  preset: {
    lead: { type: 'facts', fields: ['presetKind', 'files', 'permissions'] },
    groups: ['basic', 'compat', 'origin', 'license'],
  },
  recipe: {
    lead: { type: 'code', field: 'snippet', label: '可直接粘贴的片段', note: ['dshRef', 'targetLayer'] },
    groups: ['basic', 'license'],
    extraGroups: [{ title: '落点与理由', keys: ['recipeKind', 'targetLayer', 'dshRef', 'why'] }],
  },
  pack: {
    lead: { type: 'facts', fields: ['packType', 'dshVersions', 'downloads'] },
    groups: ['basic', 'compat', 'origin', 'license'],
    extraGroups: [{ title: '包成分', keys: ['composition'] }],
  },
  tool: {
    lead: { type: 'facts', fields: ['form', 'language', 'requires'] },
    groups: ['basic', 'origin', 'license'],
  },
  spec: {
    lead: { type: 'facts', fields: ['specVersion', 'specStatus', 'fileName', 'supersedes'] },
    groups: ['basic', 'origin', 'license'],
    extraGroups: [{ title: '版本与状态', keys: ['specVersion', 'specStatus', 'fileName', 'supersedes', 'repo', 'url'] }],
  },

  // ---- 跨分区类型（阅读材料与外部渠道，保持散文为主）----
  concept: { lead: null, groups: ['basic', 'compat', 'origin', 'license'] },
  tutorial: { lead: null, groups: ['basic', 'compat', 'origin', 'license'] },
  source: { lead: null, groups: ['basic', 'origin', 'license'] },
};

/** 取某个 kind 的展示声明（含解析好的字段组）。未知类型降级为基础格式。 */
export function presentationFor(kind) {
  const ext = KIND_EXTENSIONS[kind] ?? {};
  const order = Array.isArray(ext.groups) && ext.groups.length ? ext.groups : ['basic', 'compat', 'origin', 'license'];
  const groups = order
    .map((id) => BASE_GROUPS[id])
    .filter(Boolean)
    .map((g) => ({ title: g.title, keys: [...g.keys] }));
  for (const extra of ext.extraGroups ?? []) groups.push({ title: extra.title, keys: [...extra.keys] });
  return { lead: ext.lead ?? null, groups };
}
