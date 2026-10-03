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
    // 上游那个项目是谁做的。**与 maintainers 语义不同**：maintainers 是本馆维护者
    // （也是机器人代改第一道闸的批准人），authors 是上游作者/团队。
    // 只对第三方项目类（plugin / pack / launcher / tool / source …）有意义；
    // concept / tutorial / recipe 是本馆原创，用了会被 validate 报错（见 docs/02 §3.1）。
    'authors',
    // 显示名的另外两件：简称（dsh-pack / dshl），以及**全局唯一名**——
    // 生态里认的那个标识：插件 owner.repo 或 @scope/name、启动器注册表 ID、整合包市场坐标。
    // 与词的 id（plugin/2，馆内坐标、号不复用）不是一回事，两者都要有。
    'shortName',
    'canonicalId',
    // 封面（评审：人家都有封面；而且**要能让作者自定义**、也**允许自定义链接**）。
    // cover 两种写法都支持：
    //   ① 仓库内 `covers/xxx.png` —— 构建期原样拷进 web/covers/（走我们的缓存、可审计）
    //   ② `https://…` 外链 —— 原样引用（作者把图放自己站/GitHub 上，不必往仓库塞二进制）
    // coverLink 可选：点了封面去哪儿（默认不可点）。
    'cover',
    'coverAlt',
    'coverCredit',
    'coverLink',
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
    // editorial 特殊途径要求配的理由（见 docs/02 §1.2）
    'entryGateNote',
    'catalogCat',
    'archivedNote',
    // 缺陷与踩坑（评审：这里的"特性"就是 bug）。只对 plugin 开放：
    // 跨插件组合才出现的缺陷要另开独立 bug 词条并被反向引用，同一个缺陷只有一个 canonical 位置。
    'bugs',
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
    'providedBy',
    'archivedNote',
  ],
  // 启动器一度是唯一没有证据字段的 kind（M1 的 5 张注册表卡片用不上）。
  // 现在启动器词条要写清许可、归属、版本口径与快照，所以补齐成与其它 kind 一致的这套：
  // 它们记的是「这条事实从哪来、什么时候核实的」（docs/02 §3.1）。
  launcher: [
    'launcherId',
    'url',
    'support',
    'platforms',
    'supportedManifest',
    'archivedNote',
    'positioning',
    'roles',
    'licenseRefs',
    'compat',
    'providedBy',
  ],
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
  // ---- M2：一个分区一种类型（docs/12 §3）。这些键只在该类型下合法 ----
  client: ['form', 'platforms', 'repo', 'install', 'compat', 'licenseRefs', 'providedBy', 'screenshots'],
  theme: ['targets', 'install', 'repo', 'npm', 'screenshots', 'compat', 'licenseRefs', 'providedBy'],
  asset: ['assetType', 'locale', 'install', 'repo', 'provides', 'licenseRefs', 'providedBy'],
  skill: ['skillKind', 'roots', 'files', 'install', 'repo', 'provides', 'licenseRefs', 'providedBy'],
  preset: ['presetKind', 'files', 'install', 'repo', 'permissions', 'provides', 'licenseRefs', 'providedBy'],
  recipe: ['recipeKind', 'targetLayer', 'dshRef', 'snippet', 'why', 'providedBy'],
  tool: ['form', 'language', 'repo', 'npm', 'install', 'provides', 'requires', 'licenseRefs', 'providedBy'],
  // MCP 接入（docs/12 §1）：一个 MCP 服务器/桥接，重点是「怎么接进来」与「接进来给模型什么」
  mcp: ['transport', 'provides', 'auth', 'install', 'repo', 'npm', 'docs', 'risk', 'licenseRefs', 'providedBy'],
  spec: ['specVersion', 'specStatus', 'fileName', 'url', 'supersedes', 'repo', 'providedBy'],
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
  // ---- M2：各分区类型的期望字段（顺序即缺项清单里的次序）----
  client: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'form', 'platforms', 'repo', 'install', 'compat', 'tags', 'maintainers', 'updatedAt'],
  theme: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'targets', 'install', 'repo', 'screenshots', 'tags', 'maintainers', 'updatedAt'],
  asset: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'assetType', 'locale', 'install', 'repo', 'tags', 'maintainers', 'updatedAt'],
  skill: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'roots', 'files', 'install', 'repo', 'tags', 'maintainers', 'updatedAt'],
  preset: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'presetKind', 'files', 'install', 'repo', 'tags', 'maintainers', 'updatedAt'],
  recipe: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'recipeKind', 'targetLayer', 'dshRef', 'why', 'tags', 'maintainers', 'updatedAt'],
  tool: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'form', 'language', 'repo', 'install', 'tags', 'maintainers', 'updatedAt'],
  mcp: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'transport', 'provides', 'install', 'repo', 'tags', 'maintainers', 'updatedAt'],
  spec: [...COMMON_REQUIRED, 'titleEn', 'aliases', 'specVersion', 'specStatus', 'fileName', 'url', 'tags', 'maintainers', 'updatedAt'],
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
  transport: 2,
  provides: 2,
  marketId: 2,
  packType: 2,
  launcherId: 2,
  platforms: 2,
  // M2 各类型的「必填」字段给 3，期望字段给 2（docs/12 §3）
  form: 3,
  targets: 3,
  assetType: 3,
  roots: 3,
  presetKind: 3,
  recipeKind: 3,
  targetLayer: 3,
  specVersion: 3,
  specStatus: 3,
  fileName: 3,
  files: 2,
  language: 2,
  provides: 2,
  requires: 2,
  supersedes: 2,
  locale: 2,
  dshRef: 2,
  snippet: 2,
  why: 2,
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
  // ---- M2 新类型的字段提示（docs/12 §3）----
  form: ['形态未标', '补 form（client: desktop / tui / web / cli / ide；tool: cli / app / library / service）'],
  targets: ['改界面的哪几部分未写', '补 targets（shell / colors / wallpaper / icons / editor）'],
  assetType: ['素材类型未标', '补 assetType（font / icons / wallpaper / locale / snippet）'],
  locale: ['语言未标', '补 locale（如 zh-CN、language-neutral）'],
  skillKind: ['技能类型未标', '可选：补 skillKind（skill / collection）'],
  roots: ['发现根未写', '补 roots（project / user / builtin，见技能扫描根的概念词条）'],
  files: ['关键文件未列', '补 files（如 SKILL.md、agent.cordis.yml）'],
  presetKind: ['预设类型未标', '补 presetKind（agent / client）'],
  permissions: ['权限档位未写', '可选：补 permissions（默认档与可切换档）'],
  recipeKind: ['配方类型未标', '补 recipeKind（config / snippet / instructions）'],
  targetLayer: ['落点层未标', '补 targetLayer（project / userspace / machine）'],
  dshRef: ['对应的 DSH 文件未给', '补 dshRef（如 AGENTS.md、cordis.patch.yml）'],
  snippet: ['片段未给', '补 snippet（可直接粘贴的最小片段）'],
  why: ['为什么这样配未说', '补 why（一句话说明它改变什么行为）'],
  language: ['实现语言未标', '补 language'],
  requires: ['依赖未列', '可选：补 requires（它需要什么才能跑）'],
  // ---- MCP 接入（docs/12 §1）----
  transport: ['传输方式未标', '补 transport（stdio 还是 streamable-http）'],
  auth: ['需要什么凭据未写', '可选：补 auth（要哪些 token / 环境变量——它决定风险等级）'],
  docs: ['文档入口未给', '可选：补 docs（官方文档或协议说明的链接）'],
  specVersion: ['规格版本未给', '补 specVersion'],
  specStatus: ['规格状态未标', '补 specStatus（current / draft / deprecated）'],
  fileName: ['仓库内路径未给', '补 fileName（如 specs/manifest/v5.md）'],
  supersedes: ['替代关系未写', '可选：补 supersedes（它取代了哪一份）'],
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
