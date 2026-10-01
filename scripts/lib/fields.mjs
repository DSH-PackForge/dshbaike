/**
 * fields.mjs —— 词条字段契约（docs/02 §3）与完备度计算（docs/10 §4 的 completeness）。
 *
 * 一处定义，`validate.mjs` 与 `build.mjs` 共用，避免两边漂移。
 */

/** 公共必填字段（docs/02 §3.1） */
export const COMMON_REQUIRED = ['title', 'category', 'summary', 'status'];

/** 公共可选字段 */
export const OPTIONAL_FIELDS = {
  common: [
    'kind',
    'titleEn',
    'aliases',
    'tags',
    'maintainers',
    'updatedAt',
    'screenshots',
    'slug',
    // 归档说明对所有 kind 都适用（规则 22：status: archived 必须写清为什么还留着）
    'archivedNote',
  ],
  concept: ['layer', 'spec'],
  plugin: [
    'repo',
    'npm',
    'install',
    'role',
    'positioning',
    'relations',
    'roles',
    'licenseRefs',
    'compat',
    'providedBy',
    'usedInPacks',
    'referencedByTutorials',
    'entryGate',
    'catalogCat',
    'archivedNote',
  ],
  tutorial: ['difficulty', 'prereq', 'appliesTo', 'origin', 'external', 'plugins', 'related', 'archivedNote'],
  pack: [
    'marketId',
    'packType',
    'dshVersion',
    'dshVersions',
    'launchers',
    'composition',
    'downloads',
    'fitFor',
    'roles',
    'licenseRefs',
    'plugins',
    'archivedNote',
  ],
  launcher: ['launcherId', 'url', 'support', 'platforms', 'supportedManifest', 'archivedNote'],
  source: [
    'url',
    'zones',
    'adapter',
    'sourceKind',
    'coverage',
    'provides',
    'license',
    'relation',
    'howto',
    'linkOut',
    'archivedNote',
  ],
};

/** 每个 kind 期望出现的字段（用于完备度；顺序也决定缺项清单的次序） */
export const EXPECTED_FIELDS = {
  concept: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'layer', 'spec', 'tags', 'maintainers', 'updatedAt'],
  plugin: [
    ...COMMON_REQUIRED,
    'titleEn',
    'aliases',
    'repo',
    'npm',
    'install',
    'role',
    'positioning',
    'tags',
    'compat',
    'relations',
    'licenseRefs',
    'providedBy',
    'maintainers',
    'updatedAt',
  ],
  tutorial: [
    ...COMMON_REQUIRED,
    'titleEn',
    'aliases',
    'difficulty',
    'prereq',
    'appliesTo',
    'origin',
    'plugins',
    'related',
    'tags',
    'maintainers',
    'updatedAt',
  ],
  pack: [
    ...COMMON_REQUIRED,
    'titleEn',
    'aliases',
    'marketId',
    'packType',
    'dshVersions',
    'launchers',
    'fitFor',
    'roles',
    'licenseRefs',
    'tags',
    'maintainers',
    'updatedAt',
  ],
  launcher: [
    ...COMMON_REQUIRED,
    'titleEn',
    'aliases',
    'launcherId',
    'url',
    'support',
    'platforms',
    'supportedManifest',
    'tags',
    'maintainers',
    'updatedAt',
  ],
  source: [
    ...COMMON_REQUIRED,
    'titleEn',
    'aliases',
    'url',
    'zones',
    'sourceKind',
    'relation',
    'howto',
    'linkOut',
    'coverage',
    'provides',
    'license',
    'tags',
    'maintainers',
    'updatedAt',
  ],
};

/** 字段权重：必填项缺了扣得更狠（M1 的初始口径，可调） */
const FIELD_WEIGHT = {
  title: 3,
  category: 3,
  summary: 3,
  status: 3,
  positioning: 3,
  appliesTo: 3,
  fitFor: 3,
  howto: 2,
  spec: 2,
  repo: 2,
  npm: 2,
  install: 2,
  role: 2,
  compat: 2,
  relations: 2,
  providedBy: 2,
  licenseRefs: 2,
  url: 2,
  zones: 2,
  sourceKind: 2,
  relation: 2,
  linkOut: 2,
  layer: 2,
  difficulty: 2,
  origin: 2,
  marketId: 2,
  packType: 2,
  launcherId: 2,
  platforms: 2,
};

const DEFAULT_WEIGHT = 1;

/** 缺项清单的人话标签 + 补齐提示 */
const FIELD_META = {
  title: ['标题未写', '写中文 title'],
  titleEn: ['没有英文标题', '可选：补 titleEn'],
  aliases: ['没有别名', '可选：补 aliases（俗称、拼音、旧名）'],
  category: ['分类未填', '填 taxonomy 叶子节点 id'],
  tags: ['没有标签', '可选：补 tags'],
  summary: ['一句话摘要未写', '补 summary（用于列表与搜索）'],
  status: ['状态未声明', '填 status（draft / published / archived / deleted）'],
  updatedAt: ['没有核实日期', '可选：补 updatedAt（YYYY-MM-DD）'],
  maintainers: ['没有维护者', '可选：补 maintainers（GitHub 用户名）'],
  layer: ['layer 未声明', '补 layer（runtime / plugin / agent / workspace / ecosystem）'],
  spec: ['权威出处未给', '补 spec（代码路径或规范文档 URL）'],
  repo: ['仓库地址未给', '补 repo（owner/repo）'],
  npm: ['npm 包名未给', '补 npm 包名'],
  install: ['安装命令未给', '补 install（dsh plugin … 形式）'],
  role: ['role 未声明', '补 role（bundle / client / bundle+client / theme / compat）'],
  positioning: ['一句话定位未写', '用生态语境说清它解决什么问题'],
  compat: ['兼容性未声明', '补 compat（dsh 版本枚举 + runtime + platforms）'],
  relations: ['没有关系', '补 relations（requires / conflicts …，这是相对外部源的增量）'],
  roles: ['没有参与者', '补 roles（owner / maintainer / upstream …）'],
  licenseRefs: ['许可证未声明', '补 licenseRefs（可多条）'],
  providedBy: ['没有外部源事实', '补 providedBy（awesome / npm / github，带快照时间）'],
  difficulty: ['难度未标', '补 difficulty'],
  prereq: ['没有前置', '可选：补 prereq'],
  appliesTo: ['适用版本未写', '补 appliesTo，必须带「实测 / 未核实」口径'],
  origin: ['来源未声明', '补 origin（original / external）'],
  external: ['外部教程信息未给', 'origin: external 时必须补 external（url / reviewedAt / verdict）'],
  plugins: ['没有插件引用块', '可选：补 plugins[]'],
  related: ['没有相关词条', '可选：补 related'],
  marketId: ['市场 id 未给', '补 marketId（<owner>.<repo>）'],
  packType: ['包形态未标', '补 packType（profile / dshhome）'],
  dshVersions: ['适用 DSH 版本未给', '补 dshVersions（枚举，不写 range）'],
  launchers: ['启动器信息未给', '补 launchers（manifest v5 §13 归一化形态）'],
  fitFor: ['适合谁未写', '补 fitFor（人工判断，是相对市场页的增量）'],
  launcherId: ['canonical ID 未给', '补 launcherId'],
  url: ['链接未给', '补 url'],
  support: ['一句话定位未写', '补 support'],
  platforms: ['支持平台未给', '补 platforms'],
  supportedManifest: ['支持的规格版本未给', '补 supportedManifest'],
  zones: ['覆盖分区未给', '补 zones（这个源覆盖哪些分区）'],
  sourceKind: ['源类型未标', '补 sourceKind'],
  coverage: ['收录量未给', '补 coverage（items + 快照日期）'],
  provides: ['提供的字段未列', '补 provides'],
  license: ['许可口径未标', '补 license（口径冲突要标注）'],
  relation: ['与我们的关系未标', '补 relation（complementary / overlapping / upstream）'],
  howto: ['怎么用未写', '补 howto（怎么用它 / 怎么投稿）'],
  linkOut: ['默认外链未给', '补 linkOut（默认把读者送去哪）'],
  screenshot: ['截图缺失', '补图片或删掉 screenshots 项'],
};

/**
 * 计算完备度（docs/10 §4 的 completeness）。
 * @returns {{ score: number, missing: Array<{field: string, label: string, hint: string}> }}
 */
export function computeCompleteness(kind, data) {
  const fields = EXPECTED_FIELDS[kind] ?? [];
  let total = 0;
  let got = 0;
  const missing = [];
  for (const [index, field] of fields.entries()) {
    const weight = FIELD_WEIGHT[field] ?? DEFAULT_WEIGHT;
    total += weight;
    if (!isMissingValue(data?.[field])) {
      got += weight;
      continue;
    }
    const [label, hint] = FIELD_META[field] ?? [`${field} 未填`, `补 ${field}`];
    missing.push({ field, label, hint, weight, index });
  }
  missing.sort((a, b) => (a.weight === b.weight ? a.index - b.index : b.weight - a.weight));
  const score = total === 0 ? 0 : Math.round((got / total) * 100);
  return { score, missing: missing.map(({ field, label, hint }) => ({ field, label, hint })) };
}

/** 与 util.isMissing 同口径，但这里复制一份避免 fields.mjs 依赖 util（保持零依赖方向） */
function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** 字段所属来源（docs/10 §4 的 `sources`: 字段 → manual | verified | auto） */
export const FIELD_SOURCE = {
  recomputed: [
    'kind',
    'status',
    'relations',
    'referencedByTutorials',
    'backlinks',
    'usedInPacks',
    'plugins',
  ],
  auto: ['providedBy', 'coverage', 'downloads', 'composition', 'launchers', 'packType', 'dshVersions'],
  verified: ['licenseRefs', 'compat', 'role', 'launcherId', 'supportedManifest'],
  label: {
    manual: '人工',
    verified: '人工核实',
    auto: '自动采集',
    recomputed: '构建期派生',
  },
};
