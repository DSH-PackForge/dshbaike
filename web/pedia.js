/* ==========================================================================
   DSH 百科 · 前端渲染（零框架、纯静态、无第三方 JS）
   实现 docs/10-m1-interface.md §7 与 docs/08-visual-system.md 的组件清单。

   数据入口（唯一）：window.__PEDIA__ = { base, page, kind, n, title }
     page ∈ entry | zone | index
   后端产物（只读，均为构建期生成）：
     ${base}data/registry.json            ${base}data/taxonomy.json
     ${base}data/zones/<zone>.json        ${base}data/zones/index.json（可选）
     ${base}data/entries/<kind>-<n>.json  ${base}data/search.json
     ${base}data/reverse/plugins.json     ${base}data/links.json（可选）

   纪律（照 docs/02 §7、docs/08 §1 原则 6）：
   - 空字符串与空数组 = 缺失 → 一律显示「无数据」，绝不显示 0；
   - 未声明 ≠ 不兼容（--unknown 独立成色）；
   - 状态一律「符号 + 文字」，不靠颜色。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  var SITE = {
    name: 'DSH 百科',
    tagline: '一站式的 DeepSeek Harness 中文百科',
    compliance: '非官方社区资料站',
    ogDesc:
      '一站式的 DeepSeek Harness 中文百科：界面与客户端、插件、整合包、启动器、主题、技能、预设、指令与配方，一处找齐；每页标注来源与快照日期。',
    domain: 'dshbaike.com',
    licenseCode: '代码 CC0 / 正文 CC BY-SA',
    repo: 'DSH-PackForge/dshbaike',
    editBase: 'https://github.com/DSH-PackForge/dshbaike/edit/main/data/',
    issueNew: 'https://github.com/DSH-PackForge/dshbaike/issues/new',
    contributing: 'https://github.com/DSH-PackForge/dshbaike/blob/main/CONTRIBUTING.md'
  };

  var ECO = [
    { label: 'awesome-dsh-plugin.com', url: 'https://awesome-dsh-plugin.com/' },
    { label: 'dshbase.com', url: 'https://dshbase.com/' },
    { label: '整合包市场', url: 'https://github.com/DSH-PackForge/dsh-pack-market' },
    { label: '规范仓库', url: 'https://github.com/DSH-PackForge/DSH-PackForge' }
  ];

  /* 十二个一级分区（docs/06 §2；顺序的唯一来源是 data/registry.yml 的 zoneOrder）。仅作为数据缺失时的导航兜底：
     title/desc 以构建期产物 web/data/zones/*.json 为准。 */
  var ZONES = [
    { id: 'clients', label: '界面与客户端', desc: '你从哪、以什么界面使用 DSH：官方 Web UI、各类桌面端、终端界面（TUI）、无界面 CLI 与 headless 跑法。' },
    { id: 'plugins', label: '插件', desc: '给 DSH 加功能：宿主侧 / 客户端侧插件、bundle、兼容层。' },
    { id: 'skills', label: '技能包', desc: 'SKILL.md 技能与技能合集。' },
    { id: 'launchers', label: '启动器', desc: '.dspack 的安装端：装包、选版本、一键启动。' },
    { id: 'packs', label: '整合包', desc: '.dspack（profile / dshhome 两形态）。' },
    { id: 'mcps', label: 'MCP 与工具接入', desc: '把外部 MCP 服务器的工具接成模型能直接调用的能力（mcp__<server>__<tool>）。' },
    { id: 'themes', label: '主题与皮肤', desc: '主题引擎（皮肤加载器）、配色令牌、壁纸、图标包。' },
    { id: 'assets', label: '素材与本地化', desc: '图标、字体、翻译包（汉化 / i18n）。' },
    { id: 'presets', label: '预设与人设', desc: 'agent.cordis.yml 预设、persona 与角色设定。' },
    { id: 'recipes', label: '指令与配方', desc: '全局指令模板（AGENTS.md）、cordis.patch.yml 片段、层栈配方。' },
    { id: 'toolchain', label: '工具链', desc: '打包 / 安装 / 市场 / 索引 / 调试工具。' },
    { id: 'specs', label: '规范与协议', desc: 'manifest / pack-structure / index / publishing / launcher-registry。' }
  ];

  /* 词条 kind → 中文名（面包屑、最近更新、词条页归属）。顺序与 docs/12 §1 一致 */
  var KIND_ZH = {
    client: '客户端',
    launcher: '启动器',
    plugin: '插件',
    mcp: 'MCP 接入',
    theme: '主题与皮肤',
    asset: '素材与本地化',
    skill: '技能包',
    preset: '预设与人设',
    recipe: '指令与配方',
    pack: '整合包',
    tool: '工具',
    spec: '规范文件',
    concept: '概念',
    tutorial: '教程',
    source: '资源源'
  };

  /* kind → 默认所属分区（构建期产物里带 zone 时以产物为准）。
     跨分区的 concept / tutorial / source 不绑分区。 */
  var KIND_ZONE = {
    client: 'clients',
    launcher: 'launchers',
    plugin: 'plugins',
    mcp: 'mcps',
    theme: 'themes',
    asset: 'assets',
    skill: 'skills',
    preset: 'presets',
    recipe: 'recipes',
    pack: 'packs',
    tool: 'toolchain',
    spec: 'specs',
    concept: null,
    tutorial: null,
    source: null
  };

  var STATUS = {
    published: { cls: 'ok', icon: '✔', label: '已发布' },
    draft: { cls: 'warn', icon: '✎', label: '草稿' },
    archived: { cls: 'unknown', icon: '▣', label: '已归档' },
    deleted: { cls: 'danger', icon: '✖', label: '已撤下' }
  };

  var RISK_ZH = {
    'desktop-control': '桌面操控',
    network: '网络访问',
    credentials: '凭据',
    'build-script': '构建脚本'
  };

  /**
   * 每个风险取值的大白话解释（docs/02 §3.2）。
   * 此前徽章的提示只有「风险提示：桌面操控」——把标签重复一遍，**等于没解释**；
   * 而四个词的含义只写在内部文档里。这里给读者一句能看懂的话。
   * 语气刻意克制：说清「它能做什么」，不吓人、也不替读者做决定。
   */
  var RISK_NOTE = {
    'desktop-control': '它是装在系统里的原生程序，不是沙箱里的网页：装它等于把你的用户权限交给它——能读写你的文件、启动别的进程、装东西，系统权限模型不会替你拦。',
    network: '它会联网：下载包与更新、拉远程清单。它装回来的东西本站无法预先核实，内容可能随时变。',
    credentials: '它会接触登录凭据或 token。给多少权限由你决定，拿不准就先只给只读的。',
    'build-script': '安装时会执行仓库里的构建脚本（pnpm 默认拦截，要手动加 allowBuilds 才放行）——脚本内容本站不逐个审。'
  };

  var SOURCE_ZH = {
    manual: '人工',
    verified: '已核实',
    auto: '自动采集',
    人工: '人工',
    自动: '自动采集',
    引用自npm: '引用自 npm',
    npm: '引用自 npm'
  };

  var FORM_ZH = { web: 'Web', desktop: '桌面端', tui: 'TUI', headless: 'headless', cli: 'CLI' };
  var SHIPPED_ZH = { official: '官方', 'third-party': '第三方', launcher: '启动器内置' };
  var ROLE_ZH = {
    bundle: '宿主侧 bundle',
    client: '含 Web UI',
    'bundle+client': '宿主 + 客户端',
    theme: '主题',
    compat: '兼容层'
  };  var REL_ZH = {
    requires: '前置',
    recommends: '推荐',
    conflicts: '冲突',
    replaces: '替代',
    integrates: '联动'
  };
  var DIFFICULTY_ZH = { beginner: '入门', intermediate: '进阶', advanced: '高级' };
  var LINKS_ZH = {
    github: 'GitHub',
    npm: 'npm',
    awesome: 'awesome',
    dshbase: 'dshbase',
    market: '市场',
    detail: '详情页',
    docs: '文档',
    release: '发布页',
    spec: '规范',
    url: '链接'
  };

  var FIELD_ZH = {
    form: '形态',
    shippedBy: '提供方',
    profile: 'profile',
    platforms: '平台',
    transport: '传输方式',
    auth: '所需凭据',
    lineage: '血缘',
    selfVersioning: '版本格式',
    importSupport: '支持 .dspack 导入',
    version: '版本',
    updatedAt: '更新',
    role: '形态',
    positioning: '定位',
    repo: '仓库',
    npm: 'npm',
    install: '安装',
    license: '许可证',
    licenseRefs: '许可证',
    maintainers: '维护者',
    difficulty: '难度',
    appliesTo: '适用版本',
    origin: '来源',
    packType: '包形态',
    dshVersion: 'DSH 版本',
    dshVersions: 'DSH 版本',
    launchers: '启动器',
    downloads: '下载量',
    fitFor: '适合谁',
    marketId: '市场 ID',
    launcherId: 'canonical ID',
    supportedManifest: '支持的 manifest',
    sourceKind: '源类型',
    provides: '提供内容',
    coverage: '收录量',
    relation: '与我们的关系',
    howto: '怎么用',
    linkOut: '默认去处',
    zones: '覆盖分区',
    category: '分类',
    tags: '标签',
    summary: '摘要',
    titleEn: '英文名',
    aliases: '别名',
    layer: '所属层级',
    spec: '权威出处',
    prereq: '前置词条',
    related: '相关词条',
    external: '原站信息',
    plugins: '引用的插件',
    // M2 各分区类型的专有字段（docs/12 §3）
    form: '形态',
    targets: '改造范围',
    assetType: '素材类型',
    locale: '语言',
    skillKind: '技能类型',
    roots: '发现根',
    files: '关键文件',
    presetKind: '预设类型',
    permissions: '权限档位',
    recipeKind: '配方类型',
    targetLayer: '落点层',
    dshRef: '对应文件',
    snippet: '可粘贴片段',
    why: '为什么这样配',
    language: '实现语言',
    requires: '依赖',
    specVersion: '规格版本',
    specStatus: '规格状态',
    fileName: '仓库内路径',
    supersedes: '取代了'
  };
  /* ----- 标签外观（docs/08 §4、docs/13）-----
     图标是内联 SVG：站点离线构建、不发外部请求，也不依赖图标字体。
     TAG_STYLE 是**登记表**——登记过的标签才上色/带图标，其余走中性样式。 */
  var TAG_ICONS = {
    block: '<svg viewBox="0 0 12 12"><rect x="1" y="1" width="4.4" height="4.4" rx=".6"/><rect x="6.6" y="1" width="4.4" height="4.4" rx=".6"/><rect x="1" y="6.6" width="4.4" height="4.4" rx=".6"/><rect x="6.6" y="6.6" width="4.4" height="4.4" rx=".6"/></svg>',
    window: '<svg viewBox="0 0 12 12"><rect x="1" y="2.5" width="10" height="7.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 5.4h10" stroke="currentColor" stroke-width="1.4"/></svg>',
    layers: '<svg viewBox="0 0 12 12"><path d="M6 1.2 11 4 6 6.8 1 4Z"/><path d="M1 7.4 6 10.2l5-2.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  };

  var TAG_STYLE = {
    'MC 系': { tone: 'grass', icon: 'block' },
    'WinUI': { tone: 'sky', icon: 'window' },
    '多版本管理': { tone: 'violet', icon: 'layers' },
    '生态管理': { tone: 'amber' },
    '支持 .dspack': { tone: 'slate' },
    '停更': { tone: 'amber' },
    '安卓': { tone: 'grass' }
  };

  /**
   * 标签 chip：登记过的标签带色调与小图标，其余保持中性。
   * 为什么不做成「所有标签自动配色」：颜色一多就没有重点；
   * 而且颜色不该是唯一信号——标签文字始终在，图标只是装饰。
   */
  function tagChip(tag, opts) {
    var o = opts || {};
    var name = String(tag);
    var style = TAG_STYLE[name] || {};
    var attrs = { class: o.className || 'tag' };
    // data-tag 是**筛选的键**（筛选逻辑读 chip.getAttribute('data-tag')），一定要带上：
    // 只有 data-tone 的话，点标签等于传了空值 → 页面显示「没有匹配的条目」（线上踩过）。
    attrs.dataset = style.tone ? { tag: name, tone: style.tone } : { tag: name };
    var children = [];
    if (style.icon && TAG_ICONS[style.icon]) {
      children.push(el('span', { class: 'tag__icon', 'aria-hidden': 'true', html: TAG_ICONS[style.icon] }));
    }
    children.push(document.createTextNode(isPresent(o.label) ? String(o.label) : name));
    if (o.button) {
      attrs.type = 'button';
      attrs['aria-pressed'] = o.pressed === true ? 'true' : 'false';
      return el('button', attrs, children);
    }
    if (o.href) {
      attrs.href = o.href;
      return el('a', attrs, children);
    }
    return el('span', attrs, children);
  }


  var FIELD_GROUPS = [
    { title: '基本信息', keys: ['positioning', 'titleEn', 'aliases', 'category', 'tags', 'role', 'layer', 'difficulty', 'origin', 'fitFor', 'packType', 'launcherId', 'sourceKind', 'form', 'targets', 'assetType', 'locale', 'skillKind', 'roots', 'presetKind', 'recipeKind', 'targetLayer', 'language', 'specVersion', 'specStatus', 'maintainers', 'status', 'updatedAt'] },
    { title: '兼容与平台', keys: ['dshVersion', 'dshVersions', 'appliesTo', 'runtime', 'platforms', 'supportedManifest', 'launchers', 'importSupport', 'selfVersioning', 'lineage', 'permissions'] },
    { title: '安装与出处', keys: ['install', 'repo', 'npm', 'marketId', 'spec', 'url', 'linkOut', 'coverage', 'downloads', 'relation', 'howto', 'zones', 'prereq', 'related', 'files', 'dshRef', 'fileName', 'supersedes', 'requires', 'provides', 'snippet', 'why'] },
    { title: '许可证', keys: ['license', 'licenseRefs'] }
  ];

  /* ---------------------------------------------------------------- 工具 */

  function isPresent(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'boolean') return true;
    return true;
  }

  function asArray(v) {
    if (!isPresent(v)) return [];
    return Array.isArray(v) ? v : [v];
  }

  /* 把任意值变成一行可读文本（对象取 name/id/slot，不吐 [object Object]） */
  function plainText(v) {
    if (Array.isArray(v)) return v.map(plainText).join(' · ');
    if (isPlainObject(v)) {
      var label = v.name || v.id || v.slot || v.key || v.label;
      if (isPresent(label)) return String(label) + (isPresent(v.note) ? '（' + v.note + '）' : '');
      return JSON.stringify(v);
    }
    return String(v);
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') {
          Object.keys(v).forEach(function (dk) {
            if (v[dk] === null || v[dk] === undefined) return;
            node.setAttribute('data-' + dk.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), String(v[dk]));
          });
        } else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    appendAll(node, children);
    return node;
  }

  // 只把真正的数组当「子节点列表」；字符串/数字/单个节点都直接挂上。
  function appendAll(node, children) {
    if (Array.isArray(children)) {
      children.forEach(function (c) { appendAll(node, c); });
      return;
    }
    if (children === null || children === undefined || children === false || children === true) return;
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children && typeof children.nodeType === 'number') node.appendChild(children);
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    appendAll(f, children);
    return f;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /* 缺失 = 「无数据」（绝不是 0） */
  function missing(text) {
    return el('span', { class: 'val-missing', text: text || '无数据' });
  }

  function val(v, fmt) {
    if (!isPresent(v)) return missing();
    if (fmt) return fmt(v);
    if (Array.isArray(v)) return document.createTextNode(v.join(' · '));
    if (isPlainObject(v)) return document.createTextNode(JSON.stringify(v));
    return document.createTextNode(String(v));
  }

/**
   * 链接坐标 → 绝对 URL（docs/02 §3.3 的 links 约定）。
   *
   * 数据里的写法是**裸坐标**：`links.github: owner/repo`、`links.npm: "@scope/name"`。
   * 直接塞进 href 会被浏览器当成**相对路径**——点卡片上的「GitHub」会跳到本站的 /owner/repo
   * （线上实测踩到过）。所以已知坐标在这补前缀；已经是绝对 URL 的原样放行。
   */
  function linkHref(key, value) {
    var v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (key === 'github') return 'https://github.com/' + v.replace(/^\/+/, '');
    if (key === 'npm') return 'https://www.npmjs.com/package/' + v.replace(/^npm:/, '').replace(/^\/+/, '');
    return v;
  }

  function extLink(href, text, cls) {
    if (!isPresent(href)) return missing();
    return el('a', { href: String(href), rel: 'noopener noreferrer external', target: '_blank', class: cls, text: text || String(href) });
  }

  function joinWith(nodes, sep) {
    var out = [];
    nodes.forEach(function (n, i) {
      if (i) out.push(document.createTextNode(sep));
      out.push(n);
    });
    return out;
  }

  function slugify(text, used) {
    var s = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!s) s = 'section';
    if (used) {
      if (used[s]) {
        used[s] += 1;
        s = s + '-' + used[s];
      } else used[s] = 1;
    }
    return s;
  }

  function fmtDate(d) {
    if (!isPresent(d)) return '';
    return String(d).slice(0, 10);
  }

  function badge(text, kind, title) {
    return el('span', { class: 'badge badge--' + kind, text: text, title: title || null });
  }

  var LINK_ICON = ' ↗';

  /* ------------------------------------------------------------ 数据加载 */

  function normalizeBase(raw) {
    var b = raw === null || raw === undefined || String(raw).trim() === '' ? '/' : String(raw);
    b = b.split('#')[0].split('?')[0].replace(/\\/g, '/').trim();
    if (b === '') return '/';
    // `./` 是「相对当前文档」，**不能塌成根路径 `/`**：
    // 首页是手写外壳、boot 里就写 `./`（为了双击打开或挂在任意路径下都能用），
    // 塌成 `/` 后在 GitHub Pages 的 /dshbaike/ 子路径下会去请求 /data/search.json → 404。
    if (b === './' || b === '.') return './';
    if (b.indexOf('://') >= 0) return b.replace(/\/?$/, '/');
    if (b.charAt(0) !== '/') b = '/' + b;
    b = b.replace(/\/+$/, '/').replace(/\/\.\//g, '/');
    return b;
  }

  var BASE = normalizeBase(
    (window.__PEDIA__ && window.__PEDIA__.base) ||
      (document.body && document.body.getAttribute('data-base')) ||
      '/'
  );

  var DATA = {
    _cache: {},
    url: function (rel) {
      return BASE + 'data/' + String(rel).replace(/^\/+/, '');
    },
    get: function (rel, optional) {
      var key = String(rel);
      if (this._cache[key]) return this._cache[key];
      var p = fetch(this.url(key), { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status + ' · ' + key);
          err.status = res.status;
          err.optional = !!optional;
          throw err;
        }
        return res.json();
      });
      this._cache[key] = p;
      return p;
    },
    soft: function (rel) {
      return this.get(rel, true).catch(function () { return null; });
    }
  };

  var GLOBAL = {
    registry: null,
    entryIndex: null, // id → {n, kind, title, status, createdAt, updatedAt}
    zoneIndex: null, // zone id → {title, desc, count}
    entry: null,
    zone: null
  };

  function registryEntries(reg) {
    if (!reg) return [];
    if (Array.isArray(reg.entries)) return reg.entries.filter(isPlainObject);
    if (isPlainObject(reg.entries)) {
      var out = [];
      Object.keys(reg.entries).forEach(function (k) {
        var v = reg.entries[k];
        if (Array.isArray(v)) {
          v.forEach(function (item) {
            if (isPlainObject(item)) {
              var o = Object.assign({}, item);
              if (!isPresent(o.kind)) o.kind = k;
              out.push(o);
            }
          });
        }
      });
      return out;
    }
    return [];
  }

  function entryIdOf(e) {
    if (!e) return '';
    if (isPresent(e.id)) return String(e.id);
    if (isPresent(e.kind) && isPresent(e.n)) return String(e.kind) + '/' + String(e.n);
    return '';
  }

  function buildEntryIndex(reg) {
    var idx = {};
    registryEntries(reg).forEach(function (e) {
      var id = entryIdOf(e);
      if (!id) return;
      idx[id] = e;
    });
    return idx;
  }

  function entryUrl(id) {
    var parts = String(id).split('/');
    if (parts.length !== 2) return BASE;
    return BASE + encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts[1]) + '.html';
  }

  function zoneUrl(id) {
    return BASE + encodeURIComponent(id) + '.html';
  }

  function entryTitleOf(id) {
    if (GLOBAL.entryIndex && GLOBAL.entryIndex[id] && isPresent(GLOBAL.entryIndex[id].title)) {
      return String(GLOBAL.entryIndex[id].title);
    }
    if (GLOBAL.entry && String(GLOBAL.entry.id) === String(id) && isPresent(GLOBAL.entry.title)) {
      return String(GLOBAL.entry.title);
    }
    return String(id);
  }

  function entryIsKnown(id) {
    if (!id) return false;
    if (GLOBAL.entryIndex && Object.prototype.hasOwnProperty.call(GLOBAL.entryIndex, id)) return true;
    if (GLOBAL.entry && String(GLOBAL.entry.id) === String(id)) return true;
    return false;
  }

  function kindZh(kind) {
    return KIND_ZH[kind] || String(kind || '词条');
  }

  function zoneFallback(id) {
    for (var i = 0; i < ZONES.length; i++) if (ZONES[i].id === id) return ZONES[i];
    return null;
  }

  function zoneMeta(id) {
    if (GLOBAL.zoneIndex && GLOBAL.zoneIndex[id]) return GLOBAL.zoneIndex[id];
    return zoneFallback(id) || { id: id, label: id, desc: '' };
  }

  /* 站内词条链接：存在 → 蓝链；不存在 → 红链「写这一条」 */
  function entryLink(id, title, opts) {
    opts = opts || {};
    var known = opts.known === true || entryIsKnown(id);
    var label = title || (known ? entryTitleOf(id) : String(id));
    if (known) {
      return el('a', { href: entryUrl(id), text: label, dataset: { entry: id }, class: opts.class || null });
    }
    var red = el('a', {
      class: 'redlink' + (opts.class ? ' ' + opts.class : ''),
      href: redlinkHref(id, label),
      dataset: { entry: id, redlink: '1' },
      title: '尚未收录 · 写这一条',
      text: label + '（写这一条）',
      'aria-label': label + '：尚未收录，去贡献入口写这一条'
    });
    return red;
  }

  /**
   * Issue 表单 URL：`?template=<表单>.yml` + 预填字段（GitHub 用 `?<field-id>=` 预填表单字段）。
   * 站内所有「贡献」入口都走这里，落到**结构化表单**上，而不是一张空白 Issue 框——
   * 空白框对报告者是负担，对维护者是非结构化噪音。
   */
  function issueForm(template, params) {
    var pairs = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') return;
      pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return SITE.issueNew + '?template=' + encodeURIComponent(template) + (pairs.length ? '&' + pairs.join('&') : '');
  }

  function redlinkHref(id, label) {
    // 走「新增词条」表单：编号与骨架由自动化处理，报告者不需要装 Node、不需要本地跑脚本。
    // 注意 GitHub **只能预填标题**（`body`/自定义字段名会被忽略，见 docs/14 §1.2），
    // 所以这里只传 title，不传那些看起来能预填、实际无效的参数。
    return issueForm('6-new-entry.yml', {
      title: '[新增词条] ' + (label || id || '')
    });
  }

  function editHref(id) {
    var parts = String(id || '').split('/');
    if (parts.length !== 2) return SITE.repo;
    return SITE.editBase + parts[0] + '/' + parts[1] + '.md';
  }

  function correctHref(id, title) {
    // 纠错走表单：字段结构化（词条 / 问题类型 / 哪里不对 / 建议改法 / 出处），
    // 维护者一眼看出改哪一行，而不是从一段自由文本里猜。
    return issueForm('5-correction.yml', {
      title: '[纠错] ' + (title || id || '')
    });
  }

  function deriveHref(kind, title) {
    return issueForm('6-new-entry.yml', {
      title: '[新增词条 · ' + kindZh(kind) + '] ' + (title || '')
    });
  }

  /* ------------------------------------------------------- Markdown 渲染 */

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    var s = String(u === null || u === undefined ? '' : u).trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function safeHref(u) {
    var s = String(u === null || u === undefined ? '' : u).trim();
    return /^(https?:\/\/|#|\/|\.\/|\.\.\/)/i.test(s) ? s : '';
  }

  function inline(text, used) {
    var placeholders = [];
    var stash = function (html) {
      placeholders.push(html);
      return '\u0000' + (placeholders.length - 1) + '\u0000';
    };

    // 行内代码先摘出来，避免其中的 * / [ 被当成标记
    var out = String(text).replace(/`([^`]+)`/g, function (m, code) {
      return stash('<code>' + escapeHtml(code) + '</code>');
    });

    out = escapeHtml(out);

    // 站内链接 [[kind/n]] / [[kind/n|显示名]]
    out = out.replace(/\[\[([a-z]+)\/(\d+)(?:\|([^\]]+))?\]\]/gi, function (m, kind, n, label) {
      var id = kind + '/' + n;
      var known = entryIsKnown(id);
      var text = label ? label : known ? entryTitleOf(id) : id;
      return stash(renderEntryAnchor(id, text, known));
    });

    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, href) {
      var safe = safeUrl(href);
      if (!safe) return label; // javascript: 之类一律降级成纯文本
      return stash('<a href="' + escapeHtml(safe) + '" rel="noopener noreferrer external" target="_blank">' + label + '</a>');
    });

    out = out.replace(/(^|[^A-Za-z0-9_"/])(https?:\/\/[^\s<>()]+)/g, function (m, pre, url) {
      return pre + stash('<a href="' + escapeHtml(url) + '" rel="noopener noreferrer external" target="_blank">' + escapeHtml(url) + '</a>');
    });

    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      return placeholders[Number(i)];
    });
  }

  function renderEntryAnchor(id, text, known) {
    if (known) {
      return '<a href="' + escapeHtml(entryUrl(id)) + '" data-entry="' + escapeHtml(id) + '">' + text + '</a>';
    }
    return (
      '<a class="redlink" href="' + escapeHtml(redlinkHref(id, text)) + '" data-entry="' + escapeHtml(id) +
      '" data-redlink="1" title="尚未收录 · 写这一条">' + text + '（写这一条）</a>'
    );
  }

  function mdToHtml(md) {
    var used = {};
    var lines = String(md === null || md === undefined ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var i = 0;

    function isBlank(l) { return /^\s*$/.test(l); }
    function isHeading(l) { return /^#{1,6}\s+/.test(l); }
    function isFence(l) { return /^\s*```/.test(l); }
    function isTableSep(l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.indexOf('-') >= 0; }
    function isList(l) { return /^\s*([-*+]|\d+\.)\s+/.test(l); }

    function flushChain() {
      while (i < lines.length && !isBlank(lines[i]) && !isHeading(lines[i]) && !isFence(lines[i]) && !isList(lines[i])) {
        var cur = lines[i];
        if (/^\s*>/.test(cur)) {
          var q = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) {
            q.push(lines[i].replace(/^\s*>\s?/, ''));
            i++;
          }
          html.push('<blockquote>' + inline(q.join(' '), used) + '</blockquote>');
          continue;
        }
        // 表格：当前行 + 下一行是分隔行
        if (cur.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          var header = splitRow(cur);
          i += 2;
          var rows = [];
          while (i < lines.length && lines[i].indexOf('|') >= 0 && !isBlank(lines[i]) && !isHeading(lines[i])) {
            rows.push(splitRow(lines[i]));
            i++;
          }
          html.push(tableHtml(header, rows, used));
          continue;
        }
        var para = [cur.trim()];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && !isHeading(lines[i]) && !isFence(lines[i]) && !isList(lines[i]) && !/^\s*>/.test(lines[i])) {
          if (lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
          para.push(lines[i].trim());
          i++;
        }
        html.push('<p>' + inline(para.join(' '), used) + '</p>');
      }
    }

    function splitRow(l) {
      return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
    }

    function tableHtml(header, rows, u) {
      var out = '<div class="table-wrap"><table class="data"><thead><tr>';
      header.forEach(function (h) { out += '<th scope="col">' + inline(h, u) + '</th>'; });
      out += '</tr></thead><tbody>';
      rows.forEach(function (r) {
        out += '<tr>';
        r.forEach(function (c) { out += '<td>' + inline(c, u) + '</td>'; });
        out += '</tr>';
      });
      return out + '</tbody></table></div>';
    }

    while (i < lines.length) {
      var line = lines[i];
      if (isBlank(line)) { i++; continue; }

      if (isFence(line)) {
        var lang = line.replace(/^\s*```\s*/, '').trim();
        i++;
        var code = [];
        while (i < lines.length && !isFence(lines[i])) { code.push(lines[i]); i++; }
        i++; // 收尾的 ```
        html.push(
          '<div class="codeblock' + (lang ? '' : ' codeblock--plain') + '">' +
          '<pre><code' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : '') + '>' + escapeHtml(code.join('\n')) + '</code></pre>' +
          '<button type="button" class="codeblock__copy" data-copy>复制</button>' +
          '</div>'
        );
        continue;
      }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var level = Math.min(h[1].length + 0, 6);
        var text = h[2].trim().replace(/\s*#+\s*$/, '');
        var anchor = slugify(text, used);
        var tag = level <= 1 ? 'h1' : 'h' + Math.max(2, Math.min(4, level));
        html.push(
          '<' + tag + ' id="' + escapeHtml(anchor) + '">' + inline(text, used) +
          '<a class="anchor" href="#' + escapeHtml(anchor) + '" aria-label="锚点链接：' + escapeHtml(text) + '">#</a></' + tag + '>'
        );
        i++;
        continue;
      }

      if (isList(line)) {
        var ordered = /^\s*\d+\.\s+/.test(line);
        var items = [];
        while (i < lines.length && isList(lines[i])) {
          var m = lines[i].match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
          // 简单续行：下一行缩进且不是新的列表项
          var buf = m ? m[1] : '';
          i++;
          while (i < lines.length && !isList(lines[i]) && !isBlank(lines[i]) && /^\s{2,}/.test(lines[i])) {
            buf += ' ' + lines[i].trim();
            i++;
          }
          items.push('<li>' + inline(buf, used) + '</li>');
        }
        html.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }

      flushChain();
    }

    return html.join('\n');
  }

  function tocFromHtml(root) {
    var out = [];
    var used = {};
    var nodes = root ? root.querySelectorAll('h2, h3') : [];
    Array.prototype.forEach.call(nodes, function (n) {
      if (!n.id) n.id = slugify(n.textContent, used);
      out.push({ level: n.tagName === 'H2' ? 2 : 3, text: n.textContent.replace(/#$/, '').trim(), anchor: n.id });
    });
    return out;
  }

  /* ------------------------------------------------------------- 顶栏等 */

  function zoneNavItems() {
    if (GLOBAL.zoneIndex && Object.keys(GLOBAL.zoneIndex).length) {
      var known = ZONES.map(function (z) { return z.id; });
      var extras = Object.keys(GLOBAL.zoneIndex).filter(function (id) { return known.indexOf(id) < 0; });
      return ZONES.map(function (z) {
        var m = GLOBAL.zoneIndex[z.id];
        return { id: z.id, label: (m && m.title) || z.label };
      }).concat(extras.map(function (id) {
        return { id: id, label: GLOBAL.zoneIndex[id].title || id };
      }));
    }
    return ZONES.map(function (z) { return { id: z.id, label: z.label }; });
  }

  function renderMasthead(opts) {
    opts = opts || {};
    var host = $('#site-masthead');
    if (!host) return;
    clear(host);

    var navItems = zoneNavItems();
    var list = el('ul', { class: 'zones__list' },
      navItems.map(function (z) {
        var a = el('a', { href: zoneUrl(z.id), text: z.label });
        if (opts.currentZone === z.id) a.setAttribute('aria-current', 'page');
        // 窄屏是浮层：点完导航就收回，别挡着正文
        a.addEventListener('click', function () {
          if (railIsOverlay()) setRailCollapsed(true, false);
        });
        return el('li', {}, a);
      })
    );

    var searchInput = el('input', {
      type: 'search',
      class: 'search__input',
      id: 'site-search',
      // 侧栏只有 180px：这里用短文案，完整版留给首页 hero 的搜索框
      placeholder: '搜索词条 …',
      autocomplete: 'off',
      'aria-label': '站内搜索',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'site-search-panel',
      'aria-autocomplete': 'list'
    });

    // 「相关」不再需要一个展开按钮：它已经并进右侧信息栏（窄屏时信息栏排在最前，照样看得到）
    // 侧栏最下面的按钮：向左收回
    var collapseBtn = el('button', {
      type: 'button',
      class: 'rail-collapse',
      id: 'rail-collapse',
      'aria-controls': 'site-masthead',
      'aria-expanded': 'true'
    }, [
      el('span', { class: 'rail-collapse__icon', 'aria-hidden': 'true', text: '‹' }),
      el('span', { text: '收起侧栏' })
    ]);

    var inner = el('div', { class: 'masthead__inner' }, [
      el('a', { class: 'brand', href: BASE, 'aria-label': SITE.name + ' 首页' }, [
        el('span', { class: 'brand__name', text: SITE.name })
      ]),
      el('nav', { class: 'zones', 'aria-label': '一级分区' }, list),
      el('div', { class: 'masthead__tools' }, [
        el('div', { class: 'search' }, [
          searchInput,
          el('div', { class: 'search__panel', id: 'site-search-panel', role: 'listbox', 'aria-label': '搜索结果', hidden: true })
        ]),
        themeButton(),
        collapseBtn
      ])
    ]);

    host.appendChild(inner);
    attachSearch(searchInput, $('#site-search-panel'));
    bindThemeButton($('#theme-toggle', host));

    collapseBtn.addEventListener('click', function () { setRailCollapsed(true, true); });

    ensureRailChrome();
    syncRailAria();
  }

  /* ------------------------------------------------------------ 侧栏收放 */

  var RAIL_STORE_KEY = 'dsh-pedia-rail';
  var RAIL_OVERLAY_QUERY = '(max-width: 1099px)';

  /** 窄视口下侧栏是浮层（覆盖正文），宽视口下推开正文——与 CSS 的断点保持一致 */
  function railIsOverlay() {
    return window.matchMedia(RAIL_OVERLAY_QUERY).matches;
  }

  function railIsCollapsed() {
    return document.documentElement.classList.contains('rail-collapsed');
  }

  /**
   * 收起 / 展开侧栏。
   * @param {boolean} collapsed
   * @param {boolean} persist 是否记住这次选择（用户点击 = true；程序默认值 = false）
   */
  function setRailCollapsed(collapsed, persist) {
    document.documentElement.classList.toggle('rail-collapsed', !!collapsed);
    if (persist) {
      try { localStorage.setItem(RAIL_STORE_KEY, collapsed ? 'collapsed' : 'open'); } catch (e) { /* 隐私模式：忽略 */ }
    }
    syncRailAria();
  }

  function syncRailAria() {
    var collapsed = railIsCollapsed();
    var collapse = document.getElementById('rail-collapse');
    if (collapse) collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var reopen = document.getElementById('rail-reopen');
    if (reopen) reopen.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  /** 回展把手与遮罩挂在 body 上：它们不能跟着侧栏一起移出屏幕 */
  function ensureRailChrome() {
    if (!document.getElementById('rail-reopen')) {
      var reopen = el('button', {
        type: 'button',
        class: 'rail-reopen',
        id: 'rail-reopen',
        'aria-controls': 'site-masthead',
        'aria-label': '展开导航侧栏'
      }, [
        el('span', { 'aria-hidden': 'true', text: '›' }),
        el('span', { text: '导航' })
      ]);
      reopen.addEventListener('click', function () { setRailCollapsed(false, true); });
      document.body.appendChild(reopen);
    }

    if (!document.getElementById('rail-backdrop')) {
      var backdrop = el('div', { class: 'rail-backdrop', id: 'rail-backdrop' });
      backdrop.addEventListener('click', function () { setRailCollapsed(true, true); });
      document.body.appendChild(backdrop);
    }

    if (!GLOBAL.railKeysBound) {
      GLOBAL.railKeysBound = true;
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && railIsOverlay() && !railIsCollapsed()) setRailCollapsed(true, true);
      });
    }
  }

  /** 首次执行：优先用记住的选择；没选过就按视口给默认（窄屏默认收起） */
  function applyInitialRailState() {
    var stored = null;
    try { stored = localStorage.getItem(RAIL_STORE_KEY); } catch (e) { stored = null; }
    var collapsed = stored === 'collapsed' || stored === 'open' ? stored === 'collapsed' : railIsOverlay();
    document.documentElement.classList.toggle('rail-collapsed', collapsed);
  }

  function themeButton() {
    return el('button', {
      type: 'button',
      class: 'icon-btn',
      id: 'theme-toggle',
      'aria-live': 'polite',
      text: '主题：跟随系统'
    });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'auto';
  }

  function applyTheme(mode) {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    try {
      if (mode === 'auto') localStorage.removeItem('dsh-pedia-theme');
      else localStorage.setItem('dsh-pedia-theme', mode);
    } catch (e) { /* 隐私模式等：忽略 */ }
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '主题：' + (mode === 'light' ? '亮色' : mode === 'dark' ? '暗色' : '跟随系统');
  }

  function bootTheme() {
    var mode = 'auto';
    try {
      mode = localStorage.getItem('dsh-pedia-theme') || 'auto';
    } catch (e) { mode = 'auto'; }
    if (mode !== 'light' && mode !== 'dark') mode = 'auto';
    if (mode !== 'auto') document.documentElement.setAttribute('data-theme', mode);
    return mode;
  }

  function bindThemeButton(btn) {
    if (!btn) return;
    btn.textContent = '主题：' + (currentTheme() === 'light' ? '亮色' : currentTheme() === 'dark' ? '暗色' : '跟随系统');
    btn.addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      var next = order[(order.indexOf(currentTheme()) + 1) % order.length];
      applyTheme(next);
    });
  }

  function renderFooter() {
    var host = $('#site-footer');
    if (!host) return;
    clear(host);

    var snapshot = GLOBAL.registry && isPresent(GLOBAL.registry.generatedAt)
      ? String(GLOBAL.registry.generatedAt).slice(0, 10)
      : GLOBAL.registry && isPresent(GLOBAL.registry.snapshot)
        ? String(GLOBAL.registry.snapshot).slice(0, 10)
        : GLOBAL.zone && isPresent(GLOBAL.zone.snapshot)
          ? String(GLOBAL.zone.snapshot).slice(0, 10)
          : GLOBAL.entry && isPresent(GLOBAL.entry.snapshot)
            ? String(GLOBAL.entry.snapshot).slice(0, 10)
            : null;

    var line1 = [SITE.name, SITE.domain];
    var l1 = el('p', { class: 'footer__line' }, joinWith(
      line1.map(function (t) { return document.createTextNode(t); }), ' · '
    ));
    if (snapshot) {
      l1.appendChild(document.createTextNode(' · 数据快照 ' + snapshot));
    } else {
      l1.appendChild(document.createTextNode(' · 数据快照 '));
      l1.appendChild(missing('无数据'));
    }
    l1.appendChild(document.createTextNode(' · ' + SITE.licenseCode));

    host.appendChild(el('div', { class: 'footer__inner' }, [
      l1,
      el('p', { class: 'footer__line', text: SITE.compliance }),
      el('p', { class: 'footer__line' }, [document.createTextNode('生态：')].concat(
        joinWith(ECO.map(function (e) { return extLink(e.url, e.label); }), ' · ')
      )),
      el('p', { class: 'footer__line' }, [
        document.createTextNode('发现交给 awesome，入门交给 dshbase，解释交给我们。 · '),
        el('a', { href: SITE.contributing, rel: 'noopener noreferrer external', target: '_blank', text: '贡献指南（领号流程）' }),
        document.createTextNode(' · '),
        // Issue 分两类（docs/14 §1.2）：内容变更走词条页上的表单，百科自身的问题走这张表
        el('a', {
          href: issueForm('7-meta.yml', { title: '[站点改进] ' }),
          rel: 'noopener noreferrer external',
          target: '_blank',
          text: '反馈百科本身的问题',
          title: '导航、搜索、样式、渲染、贡献流程、想新增的分区或词条类型——这些由人来处理和设计，不走机器人代改'
        })
      ])
    ]));
  }

  /* ---------------------------------------------------------------- 搜索 */

  var searchMode = null;

  function attachSearch(input, panel) {
    if (!input || !panel) return;

    var hits = [];
    var active = -1;
    var bag = null;

    function loadBag() {
      if (bag) return bag;
      bag = Promise.all([
        DATA.soft('search.json'),
        GLOBAL.zoneIndex ? Promise.resolve(null) : DATA.soft('zones/index.json')
      ]).then(function (r) {
        var idx = r[0] && Array.isArray(r[0].items) ? r[0].items : [];
        var zi = r[1];
        if (zi && isPlainObject(zi)) registerZoneIndex(zi);
        var zoneItems = [];
        return loadZoneFiles().then(function (zones) {
          zones.forEach(function (z) {
            asArray(z.items).forEach(function (it) {
              if (!isPresent(it.name)) return;
              zoneItems.push({
                kind: 'zone',
                zone: z.id,
                title: String(it.name),
                summary: it.blurb || '',
                tags: asArray(it.tags),
                entry: it.entry || null,
                zoneTitle: z.title || zoneMeta(z.id).label
              });
            });
          });
          return { entries: idx, zones: zoneItems };
        });
      });
      return bag;
    }

    function score(item, q) {
      var t = String(item.title || '').toLowerCase();
      var s = String(item.summary || '').toLowerCase();
      if (t.indexOf(q) === 0) return 0;
      if (t.indexOf(q) >= 0) return 1;
      var aliases = asArray(item.aliases).join(' ').toLowerCase();
      var tags = asArray(item.tags).join(' ').toLowerCase();
      if (aliases.indexOf(q) >= 0 || tags.indexOf(q) >= 0) return 2;
      if (s.indexOf(q) >= 0) return 3;
      return -1;
    }

    function run() {
      var q = input.value.trim().toLowerCase();
      if (!q) {
        hide();
        return;
      }
      loadBag().then(function (b) {
        var scored = [];
        b.entries.forEach(function (it) {
          var sc = score(it, q);
          if (sc >= 0) scored.push({ sc: sc, item: it, group: kindZh(it.kind) });
        });
        b.zones.forEach(function (it) {
          var sc = score(it, q);
          if (sc >= 0) scored.push({ sc: sc, item: it, group: '分区条目 · ' + it.zoneTitle });
        });
        scored.sort(function (a, b2) {
          if (a.sc !== b2.sc) return a.sc - b2.sc;
          var ka = a.item.kind === 'zone' ? 1 : 0;
          var kb = b2.item.kind === 'zone' ? 1 : 0;
          if (ka !== kb) return ka - kb;
          return String(a.item.title).localeCompare(String(b2.item.title), 'zh');
        });
        paint(scored.slice(0, 12), q);
      });
    }

    function paint(results, q) {
      clear(panel);
      hits = [];
      active = -1;
      if (!results.length) {
        panel.appendChild(el('div', { class: 'search__empty' }, [
          document.createTextNode('没有匹配词条。'),
          el('a', {
            href: SITE.issueNew + '?title=' + encodeURIComponent('[收录申请] ' + input.value.trim()),
            rel: 'noopener noreferrer external',
            target: '_blank',
            text: '申请收录这条'
          })
        ]));
        show();
        return;
      }
      var lastGroup = null;
      results.forEach(function (r) {
        if (r.group !== lastGroup) {
          panel.appendChild(el('div', { class: 'search__group', text: r.group }));
          lastGroup = r.group;
        }
        var isZone = r.item.kind === 'zone';
        var href = isZone
          ? zoneUrl(r.item.zone) + (r.item.entry ? '' : '#q=' + encodeURIComponent(r.item.title))
          : entryUrl(r.item.id || r.item.kind + '/' + r.item.n);
        var a = el('a', {
          class: 'search__hit',
          href: href,
          role: 'option',
          id: 'search-hit-' + hits.length,
          dataset: { idx: hits.length }
        }, [
          el('b', { text: r.item.title }),
          r.item.summary ? el('span', { class: 'muted', text: ' · ' + String(r.item.summary).slice(0, 60) }) : null,
          isZone && !r.item.entry ? el('span', { class: 'redlink', text: ' · 写这一条' }) : null
        ]);
        panel.appendChild(a);
        hits.push(a);
      });
      show();
    }

    function show() {
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function hide() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
      hits = [];
    }

    function move(delta) {
      if (!hits.length) return;
      active = (active + delta + hits.length) % hits.length;
      hits.forEach(function (h, i) { h.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
      input.setAttribute('aria-activedescendant', hits[active].id);
      hits[active].scrollIntoView({ block: 'nearest' });
    }

    var timer = null;
    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 130);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') {
        if (active >= 0 && hits[active]) { location.href = hits[active].getAttribute('href'); e.preventDefault(); }
        else if (hits.length) { location.href = hits[0].getAttribute('href'); e.preventDefault(); }
      } else if (e.key === 'Escape') { hide(); input.blur(); }
    });
    input.addEventListener('focus', function () { if (input.value.trim()) run(); });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== input) hide();
    });

    searchMode = { input: input, run: run };
  }

  function registerZoneIndex(zi) {
    if (!isPlainObject(zi)) return;
    var src = Array.isArray(zi.zones) ? zi.zones : isPlainObject(zi.zones) ? Object.keys(zi.zones).map(function (k) {
      return Object.assign({ id: k }, zi.zones[k]);
    }) : [];
    var idx = {};
    src.forEach(function (z) {
      if (!z || !isPresent(z.id)) return;
      idx[z.id] = {
        title: z.title || (zoneFallback(z.id) || {}).label || z.id,
        desc: z.desc || (zoneFallback(z.id) || {}).desc || '',
        count: isPresent(z.count) ? z.count : isPresent(z.items) ? asArray(z.items).length : null
      };
    });
    if (Object.keys(idx).length) GLOBAL.zoneIndex = Object.assign(GLOBAL.zoneIndex || {}, idx);
  }

  var _zoneFiles = null;
  function loadZoneFiles() {
    if (_zoneFiles) return _zoneFiles;
    _zoneFiles = Promise.all(ZONES.map(function (z) {
      return DATA.soft('zones/' + z.id + '.json').then(function (j) { return j; }).catch(function () { return null; });
    })).then(function (list) {
      return list.filter(isPlainObject);
    });
    return _zoneFiles;
  }

  /* ------------------------------------------------------------- 通用块 */

  /** 命令块：可复制的代码块（不做「一键安装」假按钮） */
  function codeBlock(code, label) {
    var text = String(code === null || code === undefined ? '' : code);
    return el('figure', { class: 'codeblock' }, [
      label ? el('figcaption', { class: 'sr-only', text: label }) : null,
      el('pre', {}, el('code', { text: text })),
      el('button', {
        type: 'button',
        class: 'codeblock__copy',
        dataset: { copy: '1' },
        'aria-label': '复制命令：' + text,
        text: '复制'
      })
    ]);
  }

  function bindCopyButtons(root) {
    (root || document).querySelectorAll('[data-copy]').forEach(function (btn) {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', function () {
        // `data-copy="1"` / 裸 `data-copy`：复制同块 <code> 的文本；
        // `data-copy="<文本>"`：直接复制这个文本（缺口清单里的「复制片段」用它）
        var explicit = btn.getAttribute('data-copy');
        var wrap = btn.closest('.codeblock');
        var code = wrap ? wrap.querySelector('code') : null;
        var text = explicit && explicit !== '1' ? explicit : (code ? code.textContent : '');
        var done = function () {
          btn.textContent = '已复制';
          btn.setAttribute('aria-live', 'polite');
          setTimeout(function () { btn.textContent = btn.getAttribute('data-copy-label') || '复制'; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        } else fallbackCopy(text, done);
      });
    });
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  /** 落点图（docs/08 §5.4，纯 HTML/CSS 分层图） */
  function dropZone(opts) {
    opts = opts || {};
    var tree = [
      { text: '$DSH_HOME', cmt: '（~/.dsh）' },
      { text: '├─ profiles/<name>/', cmt: '插件与层栈（dsh plugin add 落点）', hits: opts.hit === 'profiles' },
      { text: '├─ skills/', cmt: '技能包', hits: opts.hit === 'skills' },
      { text: '├─ .agent-presets/', cmt: '预设与人设', hits: opts.hit === 'presets' },
      { text: '├─ AGENTS.md', cmt: '全局指令', hits: opts.hit === 'instructions' },
      { text: '└─ cordis.patch.yml', cmt: '机器级 patch 层', hits: opts.hit === 'patch' },
      { text: '' },
      { text: '项目根/.dsh/skills', cmt: '项目级技能（跟随 cwd）', hits: opts.hit === 'project' }
    ];
    var body = tree.map(function (l) {
      var line = el('span', { class: l.hits ? 'hits' : null, text: l.text });
      var cmt = l.cmt ? el('span', { class: 'cmt', text: '   ' + l.cmt }) : null;
      return frag([line, cmt, document.createTextNode('\n')]);
    });
    return el('section', { class: 'dropzone', 'aria-label': '「装在哪」落点图' }, [
      el('div', { class: 'dropzone__head', text: '装在哪：DSH 资源落点' }),
      el('pre', { class: 'dropzone__tree' }, body),
      el('div', { class: 'dropzone__foot', text: '插件落在 profile 目录；技能分全局与项目两级；patch 层是机器级的配置覆盖。' })
    ]);
  }

  /* ------------------------------------------------------------ 词条页 */

  function statusBadge(status) {
    var s = STATUS[status] || { cls: 'unknown', icon: '?', label: status ? String(status) : '状态未声明' };
    return badge(s.icon + ' ' + s.label, s.cls);
  }

  function sourceBadge(kind) {
    var label = SOURCE_ZH[kind] || (isPresent(kind) ? String(kind) : '来源未声明');
    var cls = kind === 'manual' || kind === '人工' ? 'manual' : kind === 'verified' || kind === '已核实' ? 'verified' : isPresent(kind) ? 'auto' : 'none';
    return badge(label, cls, '字段来源口径');
  }

  function riskBadges(list) {
    return asArray(list).map(function (r) {
      var key = String(r);
      var zh = RISK_ZH[key] || key;
      var note = RISK_NOTE[key] || '';
      var full = '风险提示：' + zh + (note ? '——' + note : '');
      // title 给鼠标，aria-label 给读屏：title 对键盘与触屏都不出现，不能只靠它
      return el('span', { class: 'badge badge--risk', text: '⚠ ' + zh, title: full, 'aria-label': full });
    });
  }

  /* 兼容条目归一：字符串 / {version,status} / {dsh,source} 都吃 */
  function compatEntry(item) {
    if (typeof item === 'string') return { version: item, status: statusOfVersion(item), raw: item };
    if (isPlainObject(item)) {
      var v = item.version || item.v || item.dsh || item.value || item.name || '';
      return { version: String(v), status: item.status || item.scope || statusOfVersion(v), note: item.note || null, raw: item };
    }
    return { version: String(item), status: 'unknown', raw: item };
  }

  /** 口径：版本字符串里带「实测」→ 已核实；带「未核实」→ 未核实；否则未声明 */
  function statusOfVersion(v) {
    var s = String(v || '');
    if (s.indexOf('未核实') >= 0 || s.indexOf('未验证') >= 0) return 'unknown';
    if (s.indexOf('实测') >= 0 || s.indexOf('verified') >= 0) return 'verified';
    return 'unknown';
  }

  function compatSymbol(status) {
    if (status === 'verified' || status === 'ok') return { cls: 'cell-ok', icon: '✔', text: '实测' };
    if (status === 'incompatible' || status === 'bad' || status === 'fail') return { cls: 'cell-bad', icon: '✘', text: '不兼容' };
    if (status === 'na' || status === 'n/a' || status === 'not-applicable') return { cls: 'cell-na', icon: '–', text: '不适用' };
    return { cls: 'cell-unknown', icon: '?', text: '未核实' };
  }

  function compatCell(status) {
    var s = compatSymbol(status);
    return el('span', { class: s.cls, text: s.icon + ' ' + s.text });
  }

  function matrixLegend() {
    return el('ul', { class: 'legend' }, [
      el('li', { class: 'cell-ok', text: '✔ 实测可用' }),
      el('li', { class: 'cell-bad', text: '✘ 已知不兼容' }),
      el('li', { class: 'cell-unknown', text: '? 未核实（≠ 不兼容）' }),
      el('li', { class: 'cell-na', text: '– 不适用' })
    ]);
  }

  function renderEntry(entry) {
    GLOBAL.entry = entry;
    var kind = entry.kind || (window.__PEDIA__ || {}).kind || '';
    var n = isPresent(entry.n) ? entry.n : (window.__PEDIA__ || {}).n;
    var id = isPresent(entry.id) ? entry.id : kind + '/' + n;
    var zone = entry.zone && isPresent(entry.zone.id) ? entry.zone : { id: KIND_ZONE[kind] || 'plugins', title: zoneMeta(KIND_ZONE[kind] || 'plugins').label };
    var main = $('#main');
    clear(main);

    if (entry.status === 'deleted') {
      renderMasthead({ currentZone: zone.id });
      main.appendChild(tombstone(entry, id, kind, zone));
      bindCopyButtons(main);
      return;
    }

    var prose = el('div', { class: 'prose', html: entry.html || '' });
    var computedToc = tocFromHtml(prose);
    var toc = asArray(entry.toc).length ? entry.toc : computedToc;
    // entry.toc 的锚点必须能在正文里找到，否则回退到实测锚点
    if (asArray(entry.toc).length && !anchorExists(prose, entry.toc[0].anchor)) toc = computedToc;

    var aside = renderAside(entry, id, kind, toc, zone);
    var tabs = renderTabs(entry, id, kind, prose);

    main.appendChild(frag([
      crumbs(entry, kind, zone),
      titleBar(entry, id, kind, zone),
      statusNotice(entry, id),
      el('div', { class: 'entry-grid' }, [
        // 两栏：正文 + 信息栏（「相关」已并入信息栏，不再单开左侧一列——评审：太占空间）
        el('div', { class: 'entry-grid__main' }, [leadBlock(entry), tabs, backlinksBlock(entry)]),
        el('div', { class: 'entry-grid__aside' }, aside)
      ]),
      dataFootnote(entry, id)
    ]));

    renderMasthead({ currentZone: zone.id });

    if (entry.title) document.title = String(entry.title) + ' | DSH百科';

    bindTabs(main);
    bindCopyButtons(main);
    bindToc(main);
  }

  /**
   * 分区扩展的首屏块（docs/13）：基础格式之外，「这一类最该先看到的东西」。
   * 配方 → 可复制的片段；规范 → 版本与状态；整合包 → 包形态与下载量。
   * **数据缺了就整块不渲染**——不编、不留空壳。
   */
  function leadBlock(entry) {
    var lead = entry.presentation && entry.presentation.lead;
    if (!lead) return null;
    var meta = entry.meta || {};
    var head = el('div', { class: 'lead__head' }, [
      el('span', { class: 'lead__kind', text: kindZh(entry.kind) }),
      el('span', { class: 'lead__label', text: lead.label || { code: '可直接粘贴', facts: '要点' }[lead.type] || '要点' })
    ]);

    if (lead.type === 'code') {
      var text = meta[lead.field];
      if (!isPresent(text)) return null;
      var block = el('div', { class: 'codeblock lead__code' }, [
        el('button', { type: 'button', class: 'codeblock__copy', 'data-copy': '1', text: '复制' }),
        el('pre', { class: 'codeblock__pre' }, el('code', { text: String(text).replace(/\s+$/, '') }))
      ]);
      var notes = asArray(lead.note).map(function (k) {
        if (!isPresent(meta[k])) return null;
        return el('span', { class: 'lead__note' }, [
          document.createTextNode((FIELD_ZH[k] || k) + '：'),
          el('b', { text: leadValue(meta[k]) })
        ]);
      }).filter(Boolean);
      return el('section', { class: 'lead', 'aria-label': lead.label || '要点' },
        [head, block].concat(notes.length ? [el('div', { class: 'lead__notes' }, notes)] : []));
    }

    if (lead.type === 'facts') {
      var facts = asArray(lead.fields).map(function (k) {
        if (!isPresent(meta[k])) return null;
        return el('div', { class: 'lead__fact' }, [
          el('span', { class: 'lead__k', text: FIELD_ZH[k] || k }),
          el('span', { class: 'lead__v', text: leadValue(meta[k]) })
        ]);
      }).filter(Boolean);
      if (!facts.length) return null;
      return el('section', { class: 'lead', 'aria-label': '要点' }, [head, el('div', { class: 'lead__facts' }, facts)]);
    }

    return null;
  }

  /** 把任意字段值压成一行可读文本（对象只展开一层，够用且不猜语义） */
  function leadValue(v) {
    if (Array.isArray(v)) return v.map(leadValue).join('、');
    if (v && typeof v === 'object') {
      return Object.keys(v).map(function (k) {
        var x = v[k];
        if (x === null || x === undefined || x === '') return null;
        return k + ' ' + (typeof x === 'object' ? leadValue(x) : String(x));
      }).filter(Boolean).join(' · ');
    }
    return String(v);
  }

  /** 「我来维护」表单：标题里带操作名与词条编号——
   *  GitHub **不支持**用 URL 预填 YAML 表单字段，只有标题能预填，所以编号放标题里，
   *  机器人从标题尾部取编号（docs/14 §1.2）。 */
  function claimHref(id) {
    return issueForm('1-claim.yml', { title: '[认领维护] ' + id });
  }

  /** 只给**真能机械补**的字段一个可粘贴片段；写内容类的字段不给（不硬凑） */
  function repairSnippet(field) {
    if (field === 'updatedAt') return 'updatedAt: ' + localToday();
    return null;
  }

  function localToday() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function anchorExists(root, anchor) {
    if (!isPresent(anchor)) return false;
    return !!root.querySelector('[id="' + String(anchor).replace(/"/g, '\\"') + '"]');
  }

  function crumbs(entry, kind, zone) {
    var items = [
      el('li', {}, el('a', { href: BASE, text: '首页' })),
      el('li', {}, el('a', { href: zoneUrl(zone.id), text: zone.title || zoneMeta(zone.id).label }))
    ];
    var cats = asArray(entry.meta && entry.meta.category);
    if (cats.length) {
      items.push(el('li', {}, el('span', { text: catLabel(cats[0]) })));
    }
    items.push(el('li', {}, el('span', { text: entry.title || String(entry.id || ''), 'aria-current': 'page' })));
    return el('nav', { class: 'crumbs', 'aria-label': '面包屑' }, el('ol', {}, items));
  }

  function catLabel(id) {
    if (!isPresent(id)) return '未分类';
    var parts = String(id).split('.');
    return parts[parts.length - 1];
  }

  function titleBar(entry, id, kind, zone) {
    var meta = entry.meta || {};
    var badges = [statusBadge(entry.status)];
    badges = badges.concat(riskBadges(meta.risk));

    if (isPresent(meta.role)) badges.push(badge(ROLE_ZH[meta.role] || String(meta.role), 'source'));
    if (isPresent(meta.packType)) badges.push(badge('包形态：' + meta.packType, 'source'));
    if (isPresent(meta.origin)) badges.push(badge(meta.origin === 'external' ? '外部索引卡' : '自写', 'source'));
    if (isPresent(meta.sourceKind)) badges.push(badge('源类型：' + meta.sourceKind, 'source'));

    var subBits = [];
    if (isPresent(entry.aliases)) {
      subBits.push(frag([document.createTextNode('别名：'), document.createTextNode(asArray(entry.aliases).join(' · '))]));
    }
    subBits.push(frag([document.createTextNode('属于：'), el('a', { href: zoneUrl(zone.id), text: zone.title || zoneMeta(zone.id).label })]));

    var tags = asArray(meta.tags);
    if (tags.length) {
      subBits.push(frag([document.createTextNode('标签：'),
        el('span', { class: 'tagset' }, tags.map(function (t) { return tagChip(t); }))
      ]));
    }
    var tutCount = asArray(entry.referencedByTutorials).length;
    if (kind === 'plugin') {
      subBits.push(document.createTextNode(tutCount ? tutCount + ' 篇教程引用过它' : '暂无教程引用'));
    }

    var actions = el('div', { class: 'titlebar__actions' }, [
      el('a', { class: 'btn', href: editHref(id), rel: 'noopener noreferrer external', target: '_blank', text: '编辑此条' }),
      // 机器人代改通道（docs/14）：小改动填表单即可，机器人只改这一处并开 PR，维护者审核后合并。
      // 标题里同时带操作名与编号：GitHub 不能预填 YAML 表单字段，能预填的只有标题。
      el('a', {
        class: 'btn',
        href: issueForm('3-replace.yml', { title: '[改正文里的一句话] ' + id }),
        rel: 'noopener noreferrer external',
        target: '_blank',
        text: '改一句话',
        title: '只说清「原文 → 改成」，机器人替你把这一处改掉并开 PR（改动大请直接编辑）'
      }),
      el('a', {
        class: 'btn',
        href: issueForm('2-field.yml', { title: '[改一个字段] ' + id }),
        rel: 'noopener noreferrer external',
        target: '_blank',
        text: '改字段',
        title: '补或改头部字段（更新日期、标签、安装命令…），机器人代改并开 PR'
      }),
      el('a', { class: 'btn', href: correctHref(id, entry.title), rel: 'noopener noreferrer external', target: '_blank', text: '纠错' }),
      kind === 'tutorial' || kind === 'concept' ? null : el('a', {
        class: 'btn',
        href: deriveHref('tutorial', entry.title),
        rel: 'noopener noreferrer external',
        target: '_blank',
        text: '为它写一篇教程'
      }),
      kind === 'concept' ? null : el('a', {
        class: 'btn',
        href: deriveHref('concept', entry.title),
        rel: 'noopener noreferrer external',
        target: '_blank',
        text: '派生概念'
      })
    ]);

    return el('header', { class: 'titlebar' }, [
      el('div', { class: 'titlebar__row' }, [
        el('h1', { text: entry.title || String(entry.id || '') }),
        isPresent(entry.titleEn) ? el('span', { class: 'titlebar__en', text: entry.titleEn }) : null,
        actions
      ]),
      el('div', { class: 'titlebar__badges' }, badges),
      el('p', { class: 'titlebar__sub' }, joinWith(subBits, '')),
      isPresent(entry.summary) ? el('p', { class: 'titlebar__sub', text: entry.summary }) : null
    ]);
  }

  function statusNotice(entry, id) {
    if (entry.status === 'draft') {
      return el('p', { class: 'notice notice--warn' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '✎ 草稿：内容待完善。' }),
        el('a', { href: correctHref(id, entry.title), rel: 'noopener noreferrer external', target: '_blank', text: '补充或纠错' })
      ]);
    }
    if (entry.status === 'archived') {
      return el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '▣ 已归档：' }),
        document.createTextNode(isPresent(entry.meta && entry.meta.archivedNote) ? String(entry.meta.archivedNote) : '上游已归档或停止维护，本条保留供查证。')
      ]);
    }
    return null;
  }

  function tombstone(entry, id, kind, zone) {
    var main = $('#main');
    var succ = entry.meta && (entry.meta.replacedBy || entry.meta.supersededBy);
    return el('article', { class: 'tombstone' }, [
      el('nav', { class: 'crumbs', 'aria-label': '面包屑' }, el('ol', {}, [
        el('li', {}, el('a', { href: BASE, text: '首页' })),
        el('li', {}, el('a', { href: zoneUrl(zone.id), text: zone.title || zoneMeta(zone.id).label })),
        el('li', {}, el('span', { text: entry.title || id, 'aria-current': 'page' }))
      ])),
      el('h1', { text: '本词条已撤下' }),
      el('p', { class: 'muted' }, [
        document.createTextNode('「' + (entry.title || id) + '」已撤下（' + id + '）。编号不复用，链接不会烂——这一页会一直在这里。')
      ]),
      succ ? el('p', {}, [document.createTextNode('替代词条：'), entryLink(String(succ), null)]) : el('p', { class: 'faint', text: '没有登记替代词条。' }),
      el('p', {}, [
        document.createTextNode('找不到你要的东西？'),
        el('a', { href: BASE, text: '回首页搜索' }),
        document.createTextNode('，或'),
        el('a', { href: SITE.issueNew + '?title=' + encodeURIComponent('[收录申请] ' + (entry.title || id)), rel: 'noopener noreferrer external', target: '_blank', text: '申请收录这一条' }),
        document.createTextNode('。')
      ]),
      isPresent(entry.summary) ? el('p', { class: 'faint', text: '原摘要：' + entry.summary }) : null
    ]);
  }

  /* ----- 分块 tab ----- */

  function tabSpecs(entry, id, kind, prose) {
    var meta = entry.meta || {};
    var specs = [];

    specs.push({
      key: 'body',
      label: '正文',
      count: null,
      build: function () { return prose; }
    });

    var relCount = asArray(entry.relations).length;
    if (relCount) {
      specs.push({
        key: 'relations',
        label: '关系',
        count: relCount,
        build: function () { return el('div', {}, [matrixLegendNote('关系按适用的 DSH 版本段分组；已失效（until）的关系标灰保留，不删除。'), relationsBlock(entry)]); }
      });
    }

    var compat = meta.compat;
    if (isPresent(compat)) {
      var compatCount = compatRowCount(compat);
      specs.push({
        key: 'compat',
        label: '兼容',
        count: compatCount || null,
        build: function () { return compatBlock(compat, meta); }
      });
    }

    if (kind === 'plugin') {
      specs.push({
        key: 'provided',
        label: '它提供了什么',
        count: providedCount(meta),
        build: function () { return providedBlock(meta); }
      });
      specs.push({
        key: 'packs',
        label: '出现在哪些整合包',
        count: asArray(entry.usedInPacks).length,
        build: function () { return packsBlock(entry); }
      });
      specs.push({
        key: 'install',
        label: '装它会发生什么',
        count: installEffectCount(meta),
        build: function () { return installBlock(entry); }
      });
    }

    // 「哪些教程用了它」不再是插件专属：任何类型的词条，只要被教程的 plugins 块或正文
    // 提到过，就会出现这个页签（数据来自构建期的 referencedByTutorials）
    if (asArray(entry.referencedByTutorials).length) {
      specs.push({
        key: 'tutorials',
        label: '哪些教程用了它',
        count: asArray(entry.referencedByTutorials).length,
        build: function () { return tutorialsBlock(entry); }
      });
    }

    if (kind === 'pack') {
      specs.push({ key: 'composition', label: '包成分表', count: compositionCount(meta), build: function () { return compositionBlock(entry); } });
      specs.push({ key: 'plugins', label: '引用的插件', count: asArray(entry.plugins).length, build: function () { return refCards(entry.plugins); } });
    }

    if (kind === 'tutorial') {
      specs.push({ key: 'plugins', label: '引用的插件', count: asArray(entry.plugins).length, build: function () { return refCards(entry.plugins); } });
      specs.push({ key: 'external', label: '原站与适用性', count: null, build: function () { return externalBlock(entry); } });
    }

    if (kind === 'concept' || kind === 'launcher' || kind === 'source') {
      if (asArray(entry.plugins).length) {
        specs.push({ key: 'plugins', label: '引用的插件', count: asArray(entry.plugins).length, build: function () { return refCards(entry.plugins); } });
      }
    }

    specs.push({
      key: 'sources',
      label: '数据来源',
      count: Object.keys(entry.sources || {}).length || null,
      build: function () { return sourcesBlock(entry, id); }
    });

    specs.push({
      key: 'backlinks',
      label: '谁引用了这一条',
      count: asArray(entry.backlinks).length,
      build: function () { return backlinksBlock(entry); }
    });

    return specs;
  }

  function matrixLegendNote(text) {
    return el('p', { class: 'faint', text: text });
  }

  function renderTabs(entry, id, kind, prose) {
    var specs = tabSpecs(entry, id, kind, prose);
    var list = el('div', { class: 'tabs', role: 'tablist', 'aria-label': '词条分块' });
    var panels = el('div', {});

    specs.forEach(function (spec, i) {
      var selected = i === 0;
      var btnId = 'tab-' + spec.key;
      var panelId = 'tabpanel-' + spec.key;
      var btn = el('button', {
        type: 'button',
        class: 'tabs__btn',
        role: 'tab',
        id: btnId,
        'aria-controls': panelId,
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1'
      }, [
        document.createTextNode(spec.label),
        isPresent(spec.count) ? el('span', { class: 'tabs__count', text: ' (' + spec.count + ')' }) : null
      ]);
      list.appendChild(btn);

      var panel = el('div', {
        class: 'tabpanel',
        role: 'tabpanel',
        id: panelId,
        'aria-labelledby': btnId,
        tabindex: '0',
        hidden: !selected
      }, spec.build());
      panels.appendChild(panel);
    });

    return el('div', {}, [list, panels]);
  }

  function bindTabs(root) {
    var tabs = root.querySelectorAll('[role="tab"]');
    if (!tabs.length) return;
    Array.prototype.forEach.call(tabs, function (tab, i) {
      tab.addEventListener('click', function () { activate(i); });
      tab.addEventListener('keydown', function (e) {
        var delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        var next = (i + delta + tabs.length) % tabs.length;
        activate(next);
        tabs[next].focus();
        e.preventDefault();
      });
    });
    function activate(idx) {
      Array.prototype.forEach.call(tabs, function (t, j) {
        var on = j === idx;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    }
  }

  function bindToc(root) {
    root.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
  }

  /* ----- 信息表（分组 dl） ----- */

  function renderAside(entry, id, kind, toc, zone) {
    var out = [];
    out.push(completenessBlock(entry, id));
    // 「相关」放在完整度之后：它是短的跳转列表，应该不滚动就能看到；
    // 它此前是正文左边独立的一列（240px），评审判定「太占空间」，已并入信息栏
    if (zone) out.push(relatedBlock(entry, zone));
    out.push(infoTable(entry, id, kind));
    out.push(tocBlock(toc));
    if (kind === 'plugin') out.push(dropZone({ hit: 'profiles' }));
    if (kind === 'pack') out.push(dropZone({ hit: 'profiles' }));
    return out;
  }

  function infoTable(entry, id, kind) {
    var meta = entry.meta || {};
    var sources = entry.sources || {};
    var known = {};
    Object.keys(FIELD_ZH).forEach(function (k) { known[k] = FIELD_ZH[k]; });

    // 字段组按 kind 走展示契约（docs/13）：基础格式给出默认四组，
    // 分区扩展可以改顺序/取舍/加专属组（例如 spec 的「版本与状态」、pack 的「包成分」）。
    // 产物里没有 presentation 时退回默认——旧产物或单页调试也不会白屏。
    var declared = (entry.presentation && asArray(entry.presentation.groups).length)
      ? entry.presentation.groups
      : FIELD_GROUPS;
    var groups = declared.map(function (g) {
      var rows = asArray(g.keys).filter(function (k) {
        return k !== 'status' && k !== 'updatedAt' ? isPresent(meta[k]) || (k === 'install' && isPresent(meta.install)) : isPresent(meta[k]);
      }).map(function (k) {
        return infoRow(known[k] || k, k, meta[k], sources[k], entry, kind);
      });
      return rows.length ? { title: g.title, rows: rows } : null;
    }).filter(Boolean);

    // 采集与聚合字段（不落库，只引用）
    var provRows = [];
    if (isPresent(entry.snapshot) || isPresent(entry.updatedAt)) {
      provRows.push(el('div', { class: 'infotable__row' }, [
        el('dt', { text: '快照 / 更新' }),
        el('dd', {}, [
          document.createTextNode(isPresent(entry.snapshot) ? '外部源快照 ' + fmtDate(entry.snapshot) : ''),
          isPresent(entry.snapshot) && isPresent(entry.updatedAt) ? document.createTextNode(' · ') : null,
          document.createTextNode(isPresent(entry.updatedAt) ? '词条更新 ' + fmtDate(entry.updatedAt) : '')
        ])
      ]));
    }
    var prov = meta.providedBy;
    if (isPlainObject(prov)) {
      Object.keys(prov).forEach(function (src) {
        var info = prov[src];
        if (!isPresent(info)) return;
        provRows.push(el('div', { class: 'infotable__row' }, [
          el('dt', { text: '引用自 ' + src }),
          el('dd', {}, [providedValue(info), info && info.at ? el('span', { class: 'infotable__note', text: '快照 ' + fmtDate(info.at) }) : null])
        ]));
      });
    }
    if (provRows.length) groups.push({ title: '外部源指针', rows: provRows });

    return el('section', { class: 'box', 'aria-label': '信息表' }, [
      el('div', { class: 'box__head' }, [
        el('span', { text: '信息表' }),
        el('span', { class: 'faint', text: KIND_LABEL_TAIL(kind) })
      ]),
      el('dl', { class: 'infotable' }, groups.map(function (g) {
        return el('div', { class: 'infotable__group' }, [
          el('div', { class: 'infotable__grouphead', text: g.title }),
          frag(g.rows)
        ]);
      }))
    ]);
  }

  function KIND_LABEL_TAIL(kind) {
    return kind === 'plugin' ? '聚合页' : kind === 'pack' ? '含成分表' : kind === 'source' ? '资源源' : '';
  }

  function infoRow(label, key, value, sourceKind, entry, kind) {
    var dd = el('dd', {}, valueNode(key, value));
    if (isPresent(sourceKind)) dd.appendChild(el('span', { class: 'infotable__note' }, [sourceBadge(sourceKind), document.createTextNode(' · ' + (entry.updatedAt ? '更新 ' + fmtDate(entry.updatedAt) : '快照 ' + (entry.snapshot ? fmtDate(entry.snapshot) : '无数据'))) ]));
    return el('div', { class: 'infotable__row' }, [el('dt', { text: label }), dd]);
  }

  function valueNode(key, value) {
    if (!isPresent(value)) return missing();
    switch (key) {
      case 'repo':
        return extLink('https://github.com/' + String(value).replace(/^https?:\/\/github\.com\//, ''), String(value));
      case 'npm':
        return extLink('https://www.npmjs.com/package/' + String(value).replace(/^npm:/, ''), String(value));
      case 'install':
        return codeBlock(value, '安装命令');
      case 'maintainers':
        // 链接到主页：维护者是「谁在跟进这一条」，读者应该能点过去看是谁
        return frag(asArray(value).map(function (m, i) {
          var u = String(m).replace(/^@/, '');
          return frag([
            document.createTextNode(i ? ' · ' : ''),
            extLink('https://github.com/' + u, '@' + u)
          ]);
        }));
      case 'license':
        return document.createTextNode(String(value));
      case 'licenseRefs':
        return frag(asArray(value).map(function (l, i) {
          if (typeof l === 'string') return el('span', { text: (i ? ' · ' : '') + l });
          return frag([
            document.createTextNode((i ? ' · ' : '') + (l.name || l.id || '')),
            isPresent(l.url) ? extLink(l.url, ' ↗') : null,
            isPresent(l.note) ? el('span', { class: 'infotable__note', text: l.note }) : null
          ]);
        }));
      case 'role':
        return document.createTextNode(ROLE_ZH[value] || String(value));
      case 'category':
        return document.createTextNode(asArray(value).join(' · '));
      case 'dshVersion':
      case 'dshVersions':
        return document.createTextNode(asArray(value).join(' · '));
      case 'downloads':
        if (isPlainObject(value)) {
          var parts = Object.keys(value).map(function (k) {
            return isPresent(value[k]) ? k + ' ' + value[k] : k + ' 无数据';
          });
          return parts.length ? document.createTextNode(parts.join(' · ')) : missing();
        }
        return document.createTextNode(String(value));
      case 'launchers':
        if (isPlainObject(value)) {
          var keys = Object.keys(value).filter(function (k) { return isPresent(value[k]); });
          return keys.length ? document.createTextNode(keys.join(' · ')) : missing();
        }
        return document.createTextNode(asArray(value).join(' · '));
      case 'appliesTo':
        return frag([document.createTextNode(String(value)), document.createTextNode(' '), compatCell(statusOfVersion(value))]);
      default:
        if (isPlainObject(value)) {
          var ks = Object.keys(value);
          return ks.length ? document.createTextNode(ks.map(function (k) { return k + '：' + plainText(value[k]); }).join(' · ')) : missing();
        }
        if (Array.isArray(value)) return value.length ? document.createTextNode(plainText(value)) : missing();
        return document.createTextNode(String(value));
    }
  }

  function providedValue(info) {
    if (!isPlainObject(info)) return document.createTextNode(String(info));
    // 嵌套对象要展开，不能 String() 成 `[object Object]`（pack 的 providedBy 里就带 fields 对象）
    var bits = Object.keys(info).filter(function (k) {
      return k !== 'at' && k !== 'href' && isPresent(info[k]);
    }).map(function (k) {
      var v = info[k];
      return k + ' ' + (isPlainObject(v) || Array.isArray(v) ? leadValue(v) : String(v));
    });
    var node = el('span', {}, bits.length ? document.createTextNode(bits.join(' · ')) : missing());
    if (isPresent(info.href)) {
      node.appendChild(document.createTextNode(' '));
      node.appendChild(extLink(info.href, '详情页'));
    }
    return node;
  }

  /* ----- 完整度（docs/01 §4.4） ----- */

  function completenessBlock(entry, id) {
    var c = entry.completeness;
    var box = el('section', { class: 'completeness', 'aria-label': '完整度' });
    if (!isPlainObject(c) || !isPresent(c.score)) {
      box.classList.add('bar--unknown');
      box.appendChild(el('div', { class: 'completeness__row' }, [
        el('span', { class: 'completeness__label', text: '完整度' }),
        missing('无数据'),
        el('span', { class: 'faint', text: '（构建期派生，尚未提供）' })
      ]));
      return box;
    }
    var score = Math.max(0, Math.min(100, Number(c.score)));
    box.appendChild(el('div', { class: 'completeness__row' }, [
      el('span', { class: 'completeness__label', text: '完整度' }),
      el('span', { class: 'completeness__score', text: score + '%' }),
      el('span', { class: 'bar', role: 'img', 'aria-label': '完整度 ' + score + '%' }, el('span', { class: 'bar__fill', style: 'width:' + score + '%' }))
    ]));
    // 「谁在跟进这一条」要看得出来：认领之后没有正面反馈，等于白认领（docs/14 §1.4）。
    // 缺维护者时下面的缺项清单会给「我来维护 →」，这里只管**已有维护者**的情形。
    var owners = asArray(entry.meta && entry.meta.maintainers).filter(isPresent);
    if (owners.length) {
      box.appendChild(el('div', { class: 'completeness__owner' }, [
        el('span', { class: 'completeness__owner-k', text: '维护者' }),
        el('span', { class: 'completeness__owner-v' }, joinWith(owners.map(function (m) {
          var u = String(m).replace(/^@/, '');
          return extLink('https://github.com/' + u, '@' + u);
        }), ' · ')),
        el('span', { class: 'completeness__owner-note', text: '改这一条的请求会先请他们过目' })
      ]));
    }
    var missingItems = asArray(c.missing);
    if (missingItems.length) {
      box.appendChild(el('ul', { class: 'completeness__missing' }, missingItems.map(function (m) {
        var field = isPresent(m.field) ? String(m.field) : '';
        var label = isPresent(m.label) ? String(m.label) : '缺 ' + (field || '字段');
        // 每个缺口都要有**能做完的动作**，不是一句抱怨：
        //   maintainers —— 认领不需要写内容，走表单 + Action 自动改文件开 PR；
        //   其它字段 —— 直达 GitHub 网页编辑器；能机械补的再给一个可复制片段。
        var acts = [];
        if (field === 'maintainers') {
          acts.push(el('a', {
            class: 'completeness__act',
            href: claimHref(id),
            rel: 'noopener noreferrer external',
            target: '_blank',
            text: '我来维护 →',
            title: '填一个表单：机器人会把你的用户名加进 maintainers 并开 PR，你不用改文件'
          }));
        } else {
          acts.push(el('a', {
            class: 'completeness__act',
            href: editHref(id),
            rel: 'noopener noreferrer external',
            target: '_blank',
            text: '去编辑 →',
            title: '打开这一条的 GitHub 网页编辑器：改完提交即可，GitHub 会问你要不要开 PR'
          }));
          var snip = repairSnippet(field);
          if (snip) {
            acts.push(el('button', {
              type: 'button',
              class: 'completeness__act completeness__act--copy',
              'data-copy': snip,
              'data-copy-label': '复制片段',
              text: '复制片段',
              title: '复制这一行，粘进编辑器即可'
            }));
          }
        }
        return el('li', {}, [
          el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '⚠' }),
          el('span', { class: 'completeness__field', text: label }),
          isPresent(m.hint) ? el('span', { class: 'hint', text: m.hint }) : null,
          el('span', { class: 'completeness__acts' }, acts)
        ]);
      })));
    } else {
      box.appendChild(el('p', { class: 'faint', text: '没有登记的缺项。' }));
    }
    return box;
  }

  /* ----- 关系（按版本段分组，失效标灰） ----- */

  function relationsBlock(entry) {
    var groups = groupRelations(asArray(entry.relations));
    var wrap = el('div', {});
    if (!groups.length) {
      wrap.appendChild(el('p', { class: 'faint', text: '没有登记关系。' }));
      return wrap;
    }
    groups.forEach(function (g) {
      wrap.appendChild(el('section', { class: 'relgroup' + (g.stale ? ' relgroup--stale' : '') }, [
        el('h3', { class: 'relgroup__head' }, [
          document.createTextNode(g.title),
          el('span', { class: 'faint', text: g.subtitle })
        ]),
        el('ul', { class: 'rellist' }, g.rows.map(function (r) {
          var target = isPresent(r.target)
            ? entryLink(String(r.target), r.targetTitle || null, { known: entryIsKnown(String(r.target)) })
            : missing('目标未声明');
          return el('li', { class: r.stale ? 'is-stale' : null }, [
            el('span', { class: 'reltype', text: REL_ZH[r.type] || (isPresent(r.type) ? String(r.type) : '相关') }),
            target,
            isPresent(r.note) ? el('span', { class: 'relnote', text: '· ' + r.note }) : null,
            isPresent(r.until) ? el('span', { class: 'relnote', text: '（适用至 ' + String(r.until) + '，已失效）' }) : null,
            isPresent(r.since) && !isPresent(r.until) ? el('span', { class: 'relnote', text: '（自 ' + String(r.since) + '）' }) : null
          ]);
        }))
      ]));
    });
    return wrap;
  }

  function groupRelations(relations) {
    var current = { title: '现行（未标版本段）', subtitle: ' · 适用于全部版本', stale: false, rows: [] };
    var segs = {};
    var order = [];

    relations.forEach(function (r) {
      if (!isPlainObject(r)) return;
      var hasSeg = isPresent(r.since) || isPresent(r.until);
      if (!hasSeg) {
        current.rows.push(r);
        return;
      }
      var key = String(r.since || '—') + '~' + String(r.until || '—');
      if (!segs[key]) {
        segs[key] = {
          title: '版本段 ' + (r.since ? String(r.since) : '最早') + ' → ' + (r.until ? String(r.until) : '现行'),
          subtitle: isPresent(r.until) ? ' · 已失效（标灰保留）' : ' · 仍适用于该段',
          stale: isPresent(r.until),
          rows: []
        };
        order.push(key);
      }
      var row = Object.assign({}, r);
      if (isPresent(r.until)) row.stale = true;
      segs[key].rows.push(row);
    });

    var out = [];
    if (current.rows.length) out.push(current);
    order.forEach(function (k) { out.push(segs[k]); });
    return out;
  }

  /* ----- 兼容（矩阵：符号 + 文字） ----- */

  function compatRowCount(compat) {
    if (!isPlainObject(compat)) return 0;
    var n = 0;
    if (isPresent(compat.dsh)) n += asArray(compat.dsh).length;
    if (isPresent(compat.runtime)) n += asArray(compat.runtime).length;
    if (isPresent(compat.platforms)) n += asArray(compat.platforms).length;
    return n;
  }

  function compatBlock(compat, meta) {
    var wrap = el('div', {});
    if (!isPlainObject(compat)) {
      wrap.appendChild(el('p', { class: 'faint' }, ['兼容性', missing('无数据'), document.createTextNode('（未声明 ≠ 不兼容）')]));
      return wrap;
    }
    wrap.appendChild(matrixLegend());

    var dsh = asArray(compat.dsh);
    if (dsh.length) {
      var rows = dsh.map(function (item) {
        var c = compatEntry(item);
        var runtime = asArray(compat.runtime).join(' / ');
        return el('tr', {}, [
          el('th', { scope: 'row', class: 'mono', text: c.version }),
          el('td', {}, compatCell(c.status)),
          el('td', { class: 'mono', text: runtime || '未声明' }),
          el('td', { text: c.note ? String(c.note) : '—' })
        ]);
      });
      wrap.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data matrix' }, [
        el('caption', { text: 'DSH 版本 × 兼容口径（口径来自词条字段，缺失即未核实）' }),
        el('thead', {}, el('tr', {}, [
          el('th', { scope: 'col', text: 'DSH 版本' }),
          el('th', { scope: 'col', text: '口径' }),
          el('th', { scope: 'col', text: '运行形态' }),
          el('th', { scope: 'col', text: '备注' })
        ])),
        el('tbody', {}, rows)
      ])));
    } else {
      wrap.appendChild(el('p', { class: 'faint', text: 'DSH 版本兼容性：未声明（未声明 ≠ 不兼容）。' }));
    }

    var facts = [
      ['运行形态', asArray(compat.runtime).map(function (r) { return FORM_ZH[r] || r; }).join(' · ')],
      ['平台', asArray(compat.platforms).join(' · ')],
      ['包声明的 DSH 版本', asArray(meta && meta.dshVersions).join(' · ')],
      ['启动器', isPlainObject(meta && meta.launchers) ? Object.keys(meta.launchers).join(' · ') : asArray(meta && meta.launchers).join(' · ')]
    ];
    var rows2 = facts.map(function (f) {
      return el('tr', {}, [el('th', { scope: 'row', text: f[0] }), el('td', {}, isPresent(f[1]) ? document.createTextNode(f[1]) : missing())]);
    });
    wrap.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: '项' }), el('th', { scope: 'col', text: '值' })])),
      el('tbody', {}, rows2)
    ])));
    return wrap;
  }

  /* ----- 插件：提供了什么 / 出现在哪些包 / 哪些教程 / 装它会发生什么 ----- */

  function providedCount(meta) {
    if (!isPlainObject(meta)) return 0;
    var keys = ['provides', 'tools', 'commands', 'slots', 'configs', 'features'];
    var n = 0;
    keys.forEach(function (k) { n += asArray(meta[k]).length; });
    return n;
  }

  function providedBlock(meta) {
    var groups = [
      { key: 'provides', label: '提供的能力' },
      { key: 'tools', label: '工具' },
      { key: 'commands', label: '命令' },
      { key: 'slots', label: '占用的 slot（UI 插槽）' },
      { key: 'configs', label: '配置项' },
      { key: 'features', label: '功能' }
    ].filter(function (g) { return asArray(meta[g.key]).length; });

    if (!groups.length) {
      return el('div', {}, [
        el('p', { class: 'notice notice--unknown' }, [
          el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
          document.createTextNode('它提供了什么：未声明（没有采集到就显示未声明，不推断）。')
        ])
      ]);
    }
    return el('div', {}, groups.map(function (g) {
      return el('section', { class: 'relgroup' }, [
        el('h3', { class: 'relgroup__head' }, [document.createTextNode(g.label), el('span', { class: 'faint', text: ' · ' + asArray(meta[g.key]).length + ' 项' })]),
        el('ul', { class: 'rellist' }, asArray(meta[g.key]).map(function (item) {
          if (isPlainObject(item)) {
            return el('li', {}, [
              el('span', { class: 'mono', text: item.name || item.id || item.slot || JSON.stringify(item) }),
              isPresent(item.note) ? el('span', { class: 'relnote', text: '· ' + item.note }) : null
            ]);
          }
          return el('li', {}, el('span', { class: 'mono', text: String(item) }));
        }))
      ]);
    }));
  }

  function packsBlock(entry) {
    var packs = asArray(entry.usedInPacks);
    if (!packs.length) {
      return el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
        document.createTextNode('没有查到使用它的整合包（未查到 ≠ 没有）。'),
        el('a', { href: zoneUrl('packs'), text: '看整合包分区' })
      ]);
    }
    return el('div', {}, [
      el('p', { class: 'faint', text: '反查已收录整合包的 bundles / dependencies 得到，构建期自动生成。' }),
      el('ul', { class: 'rellist' }, packs.map(function (p) {
        var name = typeof p === 'string' ? p : p.name || p.id || '';
        var id = typeof p === 'object' && isPresent(p.entry) ? p.entry : null;
        return el('li', {}, [
          id ? entryLink(String(id), String(name)) : el('span', { class: 'mono', text: String(name) }),
          el('a', { href: zoneUrl('packs') + '#q=' + encodeURIComponent(String(name)), text: '在分区里筛选' })
        ]);
      }))
    ]);
  }

  function tutorialsBlock(entry) {
    var tuts = asArray(entry.referencedByTutorials);
    if (!tuts.length) {
      return el('div', {}, [
        el('p', { class: 'notice notice--unknown' }, [
          el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
          document.createTextNode('还没有教程引用它。')
        ]),
        el('p', {}, el('a', {
          class: 'btn',
          href: deriveHref('tutorial', entry.title),
          rel: 'noopener noreferrer external',
          target: '_blank',
          text: '为它写一篇教程（领号）'
        }))
      ]);
    }
    return el('ul', { class: 'rellist' }, tuts.map(function (t) {
      var id = typeof t === 'string' ? t : t.id;
      var title = typeof t === 'object' && isPresent(t.title) ? t.title : null;
      return el('li', {}, [entryLink(String(id), title ? String(title) : null)]);
    }));
  }

  function installEffectCount(meta) {
    var n = 0;
    ['installEffects', 'writes', 'capabilities', 'slots', 'buildScripts'].forEach(function (k) {
      n += asArray(meta && meta[k]).length;
    });
    return n;
  }

  function installBlock(entry) {
    var meta = entry.meta || {};
    var install = meta.install;
    var wrap = el('div', {});

    wrap.appendChild(el('p', { class: 'faint', text: '装它会发生什么：把「装了之后机器上多了什么、我失去多少控制权」结构化呈现。没有采集到的项显示「未声明」，不默认「安全」。' }));

    if (isPresent(install)) {
      wrap.appendChild(codeBlock(install, '安装命令'));
      wrap.appendChild(el('p', { class: 'faint', text: '命令由词条人工维护；本站没有后端，不提供「一键安装」。' }));
    } else {
      wrap.appendChild(el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
        document.createTextNode('安装命令：未声明')
      ]));
    }

    var effects = asArray(meta.installEffects);
    if (effects.length) {
      wrap.appendChild(el('ul', { class: 'rellist' }, effects.map(function (e) {
        if (isPlainObject(e)) {
          return el('li', {}, [
            el('span', { class: 'reltype', text: e.label ? String(e.label) : String(e.key || '') }),
            el('span', {}, document.createTextNode(isPresent(e.value) ? String(e.value) : '未声明'))
          ]);
        }
        return el('li', {}, el('span', { text: String(e) }));
      })));
    }

    var rows = [
      ['会写入磁盘的路径', asArray(meta.writes)],
      ['申请到的能力', asArray(meta.capabilities)],
      ['占用的 slot', asArray(meta.slots)],
      ['是否触发构建脚本', isPresent(meta.buildScripts) ? asArray(meta.buildScripts) : (isPresent(meta.triggersBuildScripts) ? [meta.triggersBuildScripts ? '会触发（allowBuilds）' : '不触发'] : [])]
    ];
    var trs = rows.map(function (r) {
      var v = r[1];
      var text = plainText(v);
      return el('tr', {}, [
        el('th', { scope: 'row', text: r[0] }),
        el('td', {}, text ? el('span', { class: 'mono', text: text }) : missing('未声明'))
      ]);
    });
    wrap.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
      el('caption', { text: '安装可视化（docs/01 §5.1）：未采集项显示「未声明」，不默认安全' }),
      el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: '项' }), el('th', { scope: 'col', text: '值' })])),
      el('tbody', {}, trs)
    ])));

    return wrap;
  }

  /* ----- 教程 / 包的插件引用卡（docs/01 §4.2） ----- */

  function refCards(plugins) {
    var list = asArray(plugins);
    if (!list.length) return el('p', { class: 'faint', text: '这一条没有引用插件。' });
    return el('div', {}, list.map(function (p) {
      return refCard(p);
    }));
  }

  function refCard(p) {
    if (typeof p === 'string') p = { name: p };
    var compat = isPlainObject(p.compat) ? p.compat : {};
    var facts = [];
    if (isPresent(p.npm)) facts.push(el('span', { class: 'mono', text: 'npm ' + p.npm }));
    if (isPresent(p.repo)) {
      var repo = String(p.repo).replace(/^https?:\/\/github\.com\//, '');
      facts.push(el('span', {}, [document.createTextNode('github: '), extLink('https://github.com/' + repo, repo)]));
    }
    asArray(p.sources).forEach(function (s) {
      facts.push(badge(String(s), 'source'));
    });

    var compatBits = [];
    asArray(compat.dsh).forEach(function (c) {
      var ce = compatEntry(c);
      compatBits.push(frag([document.createTextNode(ce.version + ' '), compatCell(ce.status)]));
    });
    if (isPresent(compat.runtime)) compatBits.push(document.createTextNode(asArray(compat.runtime).map(function (r) { return FORM_ZH[r] || r; }).join(' / ')));

    var foot = [];
    if (isPresent(p.notes)) foot.push(el('span', { class: 'relnote', text: '坑：' + p.notes }));
    foot.push(isPresent(p.entry)
      ? frag([document.createTextNode('词条 → '), entryLink(String(p.entry), null)])
      : el('a', { class: 'redlink', href: redlinkHref(null, p.name), dataset: { redlink: '1' }, text: '尚无词条（写这一条）', title: '尚未收录 · 写这一条' }));
    Object.keys(isPlainObject(p.links) ? p.links : {}).forEach(function (k) {
      if (isPresent(p.links[k])) foot.push(extLink(linkHref(k, p.links[k]), LINKS_ZH[k] || k));
    });

    return el('article', { class: 'refcard', 'aria-label': '插件引用卡：' + (p.name || '') }, [
      el('div', { class: 'refcard__head' }, [
        el('span', { class: 'refcard__name', text: p.name || '未命名' }),
        riskBadges(p.risk).map(function (b) { return b; })
      ]),
      isPresent(p.why) ? el('p', { class: 'refcard__why', text: '在这篇内容里的作用：' + p.why }) : el('p', { class: 'refcard__why faint', text: '为什么用它：未声明' }),
      facts.length ? el('div', { class: 'refcard__facts' }, facts) : null,
      compatBits.length ? el('div', { class: 'refcard__facts' }, [document.createTextNode('兼容 ')].concat(compatBits)) : null,
      isPresent(p.install) ? codeBlock(p.install, '安装命令') : null,
      el('div', { class: 'refcard__foot' }, foot)
    ]);
  }

  /* ----- 包成分表（docs/01 §5） ----- */

  function compositionCount(meta) {
    var c = meta && meta.composition;
    if (!isPlainObject(c)) return 0;
    var n = 0;
    ['bundles', 'dependencies', 'skills', 'presets', 'instructions'].forEach(function (k) { n += asArray(c[k]).length; });
    if (isPlainObject(c.patch)) n += Object.keys(c.patch).length;
    return n;
  }

  function compositionBlock(entry) {
    var c = entry.meta && entry.meta.composition;
    if (!isPlainObject(c)) {
      return el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
        document.createTextNode('包成分表：无数据（采集未提供，或这个包尚未解析）。')
      ]);
    }
    var sections = [
      { key: 'bundles', label: '层栈 bundles' },
      { key: 'dependencies', label: '依赖 dependencies' },
      { key: 'instructions', label: '全局指令 instructions' }
    ];
    var wrap = el('div', {});

    sections.forEach(function (s) {
      var items = asArray(c[s.key]);
      if (!items.length) return;
      wrap.appendChild(el('section', { class: 'relgroup' }, [
        el('h3', { class: 'relgroup__head' }, [document.createTextNode(s.label), el('span', { class: 'faint', text: ' · ' + items.length })]),
        el('ul', { class: 'rellist' }, items.map(function (it) {
          if (isPlainObject(it)) {
            var label = it.name || it.id || it.path || '';
            var entryId = isPresent(it.entry) ? String(it.entry) : null;
            return el('li', {}, [
              entryId ? entryLink(entryId, String(label)) : el('span', { class: 'mono', text: String(label) }),
              isPresent(it.version) ? el('span', { class: 'relnote', text: '@' + String(it.version) }) : null,
              isPresent(it.entry) ? null : el('a', { class: 'redlink', href: redlinkHref(null, String(label)), dataset: { redlink: '1' }, text: '写这一条' })
            ]);
          }
          return el('li', {}, el('span', { class: 'mono', text: String(it) }));
        }))
      ]));
    });

    // skills / presets：profile 形态必须在页面上说清楚「需解包读取」
    ['skills', 'presets'].forEach(function (key) {
      var items = asArray(c[key]);
      var isProfile = entry.meta && entry.meta.packType === 'profile';
      wrap.appendChild(el('section', { class: 'relgroup' }, [
        el('h3', { class: 'relgroup__head' }, [document.createTextNode(key === 'skills' ? '技能 skills' : '预设 presets')]),
        isProfile && !items.length
          ? el('p', { class: 'notice notice--unknown' }, [
            el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
            document.createTextNode('本包为 profile 形态：技能/预设需解包读取（清单里看不到 ≠ 没有）。')
          ])
          : items.length
            ? el('ul', { class: 'rellist' }, items.map(function (it) {
              return el('li', {}, el('span', { class: 'mono', text: typeof it === 'string' ? it : String(it.name || it.id || '') }));
            }))
            : el('p', { class: 'faint', text: '无数据。' })
      ]));
    });

    if (isPlainObject(c.patch)) {
      var keys = Object.keys(c.patch);
      wrap.appendChild(el('section', { class: 'relgroup' }, [
        el('h3', { class: 'relgroup__head' }, [document.createTextNode('patch 层'), el('span', { class: 'faint', text: ' · ' + keys.length + ' 条 config 覆盖' })]),
        el('ul', { class: 'rellist' }, keys.slice(0, 12).map(function (k) {
          var v = c.patch[k];
          return el('li', {}, [
            el('span', { class: 'mono', text: k }),
            el('span', { class: 'relnote', text: isPlainObject(v) || Array.isArray(v) ? JSON.stringify(v).slice(0, 120) : String(v) })
          ]);
        })),
        keys.length > 12 ? el('p', { class: 'faint', text: '（其余 ' + (keys.length - 12) + ' 条见原始数据）' }) : null
      ]));
    }
    return wrap;
  }

  /* ----- 外部教程索引卡 ----- */

  function externalBlock(entry) {
    var meta = entry.meta || {};
    var ext = meta.external;
    if (!isPlainObject(ext)) {
      return el('p', { class: 'faint', text: '这是自写教程（origin: original），没有外部原站信息。' });
    }
    var rows = [
      ['原站', isPresent(ext.site) ? String(ext.site) : null],
      ['作者', isPresent(ext.author) ? String(ext.author) : null],
      ['语言', isPresent(ext.lang) ? String(ext.lang) : null],
      ['适用性判断', isPresent(ext.verdict) ? String(ext.verdict) : null],
      ['我们复查于', isPresent(ext.reviewedAt) ? fmtDate(ext.reviewedAt) : null]
    ].map(function (r) {
      return el('tr', {}, [el('th', { scope: 'row', text: r[0] }), el('td', {}, isPresent(r[1]) ? document.createTextNode(r[1]) : missing())]);
    });
    return el('div', {}, [
      el('p', { class: 'notice notice--warn' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '↗' }),
        document.createTextNode('外部教程索引卡：我们只写「它讲了什么、适合谁、哪里会过时」，不转载原文。')
      ]),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [el('tbody', {}, rows)])),
      isPresent(ext.url) ? el('p', {}, extLink(ext.url, '去原站阅读')) : null
    ]);
  }

  /* ----- 数据来源 / 反链 / 页脚 ----- */

  function sourcesBlock(entry, id) {
    var sources = entry.sources || {};
    var keys = Object.keys(sources);
    var wrap = el('div', {});
    if (!keys.length) {
      wrap.appendChild(el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
        document.createTextNode('字段级来源未声明。')
      ]));
    } else {
      wrap.appendChild(el('ul', { class: 'sourcelist' }, keys.map(function (k) {
        return el('li', {}, [
          el('span', { class: 'sourcelist__field', text: FIELD_ZH[k] || k }),
          sourceBadge(sources[k]),
          el('span', { class: 'faint', text: k }),
          el('span', { class: 'faint', text: (sources[k] === 'manual' || sources[k] === '人工' ? '人工核实 · ' : '自动采集 · 快照 ') + (isPresent(entry.updatedAt) ? fmtDate(entry.updatedAt) : isPresent(entry.snapshot) ? fmtDate(entry.snapshot) : '无数据') })
        ]);
      })));
    }

    if (isPlainObject(entry.meta && entry.meta.providedBy)) {
      wrap.appendChild(el('p', { class: 'faint', text: '外部源事实只引用、不落库：' }));
      wrap.appendChild(el('ul', { class: 'sourcelist' }, Object.keys(entry.meta.providedBy).map(function (src) {
        var info = entry.meta.providedBy[src];
        return el('li', {}, [
          el('span', { class: 'sourcelist__field', text: src }),
          providedValue(info)
        ]);
      })));
    }

    wrap.appendChild(el('p', { class: 'faint' }, [
      document.createTextNode('快照 '),
      isPresent(entry.snapshot) ? document.createTextNode(fmtDate(entry.snapshot)) : missing(),
      document.createTextNode(' · 词条更新 '),
      isPresent(entry.updatedAt) ? document.createTextNode(fmtDate(entry.updatedAt)) : missing(),
      document.createTextNode(' · '),
      el('a', { href: SITE.contributing, rel: 'noopener noreferrer external', target: '_blank', text: '贡献指南' })
    ]));
    return wrap;
  }

  function backlinksBlock(entry) {
    var links = asArray(entry.backlinks);
    if (!links.length) {
      return el('p', { class: 'faint', text: '暂无其它词条引用这一条。' });
    }
    return el('ul', { class: 'rellist' }, links.map(function (b) {
      var id = typeof b === 'string' ? b : b.id;
      var title = typeof b === 'object' && isPresent(b.title) ? b.title : null;
      return el('li', {}, [
        entryLink(String(id), title ? String(title) : null),
        el('span', { class: 'faint', text: kindZh(String(id).split('/')[0]) })
      ]);
    }));
  }

  function dataFootnote(entry, id) {
    return el('footer', { class: 'footnote' }, [
      document.createTextNode('数据来源：'),
      el('a', { href: editHref(id), rel: 'noopener noreferrer external', target: '_blank', text: '词条源文件' }),
      document.createTextNode(' · '),
      el('a', { href: SITE.contributing, rel: 'noopener noreferrer external', target: '_blank', text: '贡献指南' }),
      document.createTextNode(' · 快照 '),
      isPresent(entry.snapshot) ? document.createTextNode(fmtDate(entry.snapshot)) : missing(),
      document.createTextNode(' · 更新 '),
      isPresent(entry.updatedAt) ? document.createTextNode(fmtDate(entry.updatedAt)) : missing()
    ]);
  }

  /* ----- 相关（并进右侧信息栏；不再占正文左边的整列） ----- */

  /**
   * 「相关」：所属分区 + `related` / `prereq` 指向的词条。
   *
   * 历史：它曾经是正文左边独立的一列（240px，`--w-nav`），而里面只放这么一小块——
   * 正文被挤窄，评审直接点出来「不要放在左边，太占空间」。现在它是信息栏里的一格。
   * 同时**不再把词条自己列一遍**：你就在这一页上。
   */
  function relatedBlock(entry, zone) {
    var items = [el('a', { href: zoneUrl(zone.id), text: zone.title || zoneMeta(zone.id).label })];
    var related = asArray(entry.meta && (entry.meta.related || entry.meta.prereq));
    related.forEach(function (r) {
      if (!isPresent(r)) return;
      items.push(entryLink(String(r), null));
    });
    // 相关教程（构建期派生：教程的 plugins 块或正文提及）——它是**这一条的元数据**，
    // 所以放在「相关」格里单独一个小标题，不跟"所属分区 / 相关词条"混在一个列表里。
    var tutorials = asArray(entry.referencedByTutorials).filter(isPresent);

    return el('div', { class: 'box' }, [
      el('div', { class: 'box__head', text: '相关' }),
      el('div', { class: 'box__body' }, [
        el('ul', { class: 'toc__list' }, items.map(function (n) {
          return el('li', {}, n);
        })),
        tutorials.length ? el('div', { class: 'box__subhead', text: '相关教程' }) : null,
        tutorials.length ? el('ul', { class: 'toc__list' }, tutorials.map(function (t) {
          return el('li', {}, entryLink(String(t), null));
        })) : null
      ])
    ]);
  }

  function tocBlock(toc) {
    var list = asArray(toc);
    if (!list.length) {
      return el('details', { class: 'collapse' }, [
        el('summary', { text: '本页目录' }),
        el('div', { class: 'toc__empty', text: '这一条没有分节标题。' })
      ]);
    }
    var ul = el('ul', { class: 'toc__list' }, list.map(function (t) {
      return el('li', { class: t.level >= 3 ? 'lvl3' : null }, el('a', { href: '#' + String(t.anchor), text: String(t.text) }));
    }));
    // 窄屏折叠；宽屏（≥768）用 details[open] 常开
    var d = el('details', { class: 'collapse toc', open: true }, [
      el('summary', { text: '本页目录' }),
      ul
    ]);
    return d;
  }

  /* ------------------------------------------------------------ 分区页 */

  /**
   * 二级分区块（docs/06 §2.0.1）：标题 + 条数 + 一句说明 + 可选编辑综述 + 该组的卡片。
   * `introHtml` 由构建期渲染（已转义），这里只负责插进 DOM。
   */
  function sectionBlock(sec, list, items, zone, zoneId) {
    var anchor = 'sec-' + (sec.id || 'none');
    var children = [
      el('div', { class: 'subsec__head' }, [
        el('h2', { class: 'subsec__title', text: sec.title || sec.id }),
        el('span', { class: 'subsec__count', text: list.length + ' 条' }),
        el('a', { class: 'subsec__anchor', href: '#' + anchor, text: '#', 'aria-label': '这一节的链接' })
      ])
    ];
    if (isPresent(sec.desc)) children.push(el('p', { class: 'subsec__desc', text: sec.desc }));
    if (isPresent(sec.introHtml)) {
      var intro = el('div', { class: 'subsec__intro' });
      intro.innerHTML = sec.introHtml; // 构建期已渲染并转义（pedia 的 markdown 渲染器先转义再替换）
      children.push(intro);
    }
    children.push(el('ul', { class: 'cards', id: 'zone-cards-' + (sec.id || 'none') },
      list.map(function (it) { return cardFor(it, items, zone, zoneId); })));
    return el('section', { class: 'subsection', id: anchor, 'aria-label': sec.title || sec.id }, children);
  }

  /** 给卡片打上它在 items 里的下标：分组后卡片不再同处一个 ul，筛选必须按 data-idx 认领数据 */
  function cardFor(it, items, zone, zoneId) {
    var card = zoneCard(it, zone, zoneId);
    var idx = items.indexOf(it);
    if (card && card.dataset) card.dataset.idx = String(idx < 0 ? '' : idx);
    return card;
  }

  function renderZone(zone) {
    GLOBAL.zone = zone;
    var main = $('#main');
    clear(main);

    var id = zone.id || (window.__PEDIA__ || {}).kind || '';
    var items = asArray(zone.items);

    renderMasthead({ currentZone: id });

    main.appendChild(el('header', { class: 'pagehead' }, [
      el('nav', { class: 'crumbs', 'aria-label': '面包屑' }, el('ol', {}, [
        el('li', {}, el('a', { href: BASE, text: '首页' })),
        el('li', {}, el('span', { text: zone.title || zoneMeta(id).label, 'aria-current': 'page' }))
      ])),
      el('h1', { text: zone.title || zoneMeta(id).label }),
      el('p', { class: 'pagehead__desc', text: isPresent(zone.desc) ? zone.desc : zoneMeta(id).desc }),
      el('p', { class: 'pagehead__meta' }, [
        document.createTextNode('怎么用：'),
        isPresent(zone.howto) ? document.createTextNode(zone.howto) : missing(),
        document.createTextNode(' · 数据快照 '),
        isPresent(zone.snapshot) ? document.createTextNode(fmtDate(zone.snapshot)) : missing(),
        document.createTextNode(' · 条目 ' + items.length)
      ])
    ]));

    if (id === 'plugins' || id === 'packs') {
      main.appendChild(el('details', { class: 'collapse', open: false }, [
        el('summary', { text: '「装在哪」落点图' }),
        el('div', { class: 'box__body' }, dropZone({ hit: 'profiles' }))
      ]));
    }

    main.appendChild(filterBar(items, id));

    // 二级分区（docs/06 §2.0.1）：一级分区回答「这是哪一层」，二级回答「同一层里属于哪一类」。
    var sections = asArray(zone.sections);
    if (sections.length) {
      var bySection = {};
      items.forEach(function (it) {
        var key = isPresent(it.section) ? String(it.section) : '';
        (bySection[key] = bySection[key] || []).push(it);
      });
      var renderedItems = [];
      sections.forEach(function (sec) {
        var list = bySection[sec.id] || [];
        if (!list.length) return;
        main.appendChild(sectionBlock(sec, list, items, zone, id));
        renderedItems = renderedItems.concat(list);
      });
      var ungrouped = bySection[''] || [];
      if (ungrouped.length) {
        main.appendChild(sectionBlock(
          { id: 'none', title: '未分组', desc: '还没有归到二级分区的条目：补上 section 就会自动归位' },
          ungrouped, items, zone, id,
        ));
        renderedItems = renderedItems.concat(ungrouped);
      }
      // 声明了却一条都没有的二级分区：如实说出来，而不是静默消失
      var missingSections = sections.filter(function (sec) { return !(bySection[sec.id] || []).length; });
      if (missingSections.length) {
        main.appendChild(el('p', { class: 'section__empty' }, document.createTextNode(
          '这几个二级分区还没有条目：' + missingSections.map(function (s) { return s.title || s.id; }).join(' / '),
        )));
      }
      // 兜底：section 写成了没声明的 id（校验器会报错）时，条目也不能从页面上消失
      var leftovers = items.filter(function (it) { return renderedItems.indexOf(it) < 0; });
      if (leftovers.length) {
        main.appendChild(el('ul', { class: 'cards', id: 'zone-cards-leftover' },
          leftovers.map(function (it) { return cardFor(it, items, zone, id); })));
      }
    } else {
      main.appendChild(el('ul', { class: 'cards', id: 'zone-cards' }, items.map(function (it) { return cardFor(it, items, zone, id); })));
    }
    var empty = el('p', { class: 'notice notice--unknown', id: 'zone-empty', hidden: true }, [
      el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
      document.createTextNode('没有匹配的条目。'),
      el('a', { href: BASE, text: '回首页搜索' })
    ]);
    main.appendChild(empty);
    if (!items.length) {
      main.appendChild(el('p', { class: 'notice notice--unknown' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '?' }),
        document.createTextNode('这个分区暂时没有条目（空分区是硬要求违反项）。'),
        el('a', {
          href: issueForm('4-zone-item.yml', { title: '[补充分区条目] ' + id }),
          rel: 'noopener noreferrer external',
          target: '_blank',
          text: '补充一条',
          title: '填名称 + 一句话 + 外链，机器人写进这个分区并开 PR（标题里已带分区，表单里再选一次也行）'
        })
      ]));
    }

    bindZoneFilter(items, zone, id);
    bindCopyButtons(main);
    if (zone.title) document.title = String(zone.title) + ' | DSH百科';
  }

  function filterBar(items, zoneId) {
    var tags = {};
    items.forEach(function (it) {
      asArray(it.tags).forEach(function (t) {
        var k = String(t);
        tags[k] = (tags[k] || 0) + 1;
      });
    });
    var names = Object.keys(tags).sort(function (a, b) { return a.localeCompare(b, 'zh'); });

    var chips = [el('button', { type: 'button', class: 'tag tag--on', dataset: { tag: '*' }, 'aria-pressed': 'true', text: '全部 · ' + items.length })];
    names.forEach(function (t) {
      chips.push(tagChip(t, { button: true, label: t + ' · ' + tags[t] }));
    });

    var input = el('input', {
      type: 'search',
      class: 'search__input',
      id: 'zone-filter',
      placeholder: '筛这一页的条目 …',
      'aria-label': '筛选本分区条目',
      autocomplete: 'off'
    });

    return el('div', { class: 'filterbar' }, [
      el('span', { class: 'filterbar__label', text: '二级标签' }),
      el('span', { class: 'tagset', role: 'group', 'aria-label': '按二级标签筛选' }, chips),
      el('span', { class: 'filterbar__label', text: '搜索' }),
      el('div', { class: 'search', style: 'flex:0 1 220px' }, input)
    ]);
  }

  function bindZoneFilter(items, zone, zoneId) {
    // 分组后卡片分散在多个 ul 里（zone-cards-<section>），所以按 id 前缀一次取全，
    // 并且用每张卡自己的 data-idx 认领数据——不能再靠循环下标（顺序已经变了）。
    var cards = document.querySelectorAll('[id^="zone-cards"] > li');
    var chips = document.querySelectorAll('.filterbar .tag');
    var input = document.getElementById('zone-filter');
    var empty = document.getElementById('zone-empty');
    var state = { tag: '*', q: '' };

    function apply() {
      var shown = 0;
      Array.prototype.forEach.call(cards, function (card) {
        var idx = Number(card.getAttribute('data-idx'));
        var it = Number.isFinite(idx) ? (items[idx] || {}) : {};
        var okTag = state.tag === '*' || asArray(it.tags).map(String).indexOf(state.tag) >= 0;
        var hay = [it.name, it.blurb, asArray(it.tags).join(' '), asArray(it.risk).join(' ')].join(' ').toLowerCase();
        var okQ = !state.q || hay.indexOf(state.q) >= 0;
        var on = okTag && okQ;
        card.hidden = !on;
        if (on) shown++;
      });
      // 整组被筛空时，连二级分区标题一起收起来（否则会留下一排空标题）
      Array.prototype.forEach.call(document.querySelectorAll('.subsection'), function (sec) {
        var visible = sec.querySelectorAll('[id^="zone-cards"] > li:not([hidden])').length;
        sec.hidden = visible === 0;
      });
      if (empty) empty.hidden = shown !== 0;
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        state.tag = chip.getAttribute('data-tag');
        Array.prototype.forEach.call(chips, function (c) {
          var on = c === chip;
          c.classList.toggle('tag--on', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        writeHash(zoneId, state.tag, state.q);
        apply();
      });
    });

    if (input) {
      input.addEventListener('input', function () {
        state.q = input.value.trim().toLowerCase();
        writeHash(zoneId, state.tag, state.q);
        apply();
      });
    }

    // 支持从 hash 进入筛选态（#tag=… / #q=…）
    var h = parseHash();
    if (h.tag) {
      state.tag = h.tag;
      Array.prototype.forEach.call(chips, function (c) {
        var on = c.getAttribute('data-tag') === h.tag;
        c.classList.toggle('tag--on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    if (h.q && input) {
      input.value = h.q;
      state.q = h.q.toLowerCase();
    }
    if (h.tag || h.q) apply();

    window.addEventListener('hashchange', function () {
      var nh = parseHash();
      if (nh.tag === state.tag && (nh.q || '') === state.q) return;
      state.tag = nh.tag || '*';
      state.q = nh.q || '';
      if (input) input.value = state.q;
      Array.prototype.forEach.call(chips, function (c) {
        var on = c.getAttribute('data-tag') === state.tag;
        c.classList.toggle('tag--on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      apply();
    });
  }

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var out = { tag: null, q: null };
    if (!raw) return out;
    raw.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      if (k === 'tag' || k === 'cat' || k === 't') out.tag = v;
      if (k === 'q' || k === 'search') out.q = v;
    });
    if (raw.indexOf('=') < 0 && raw) out.tag = decodeURIComponent(raw);
    return out;
  }

  function writeHash(zoneId, tag, q) {
    var bits = [];
    if (tag && tag !== '*') bits.push('tag=' + encodeURIComponent(tag));
    if (q) bits.push('q=' + encodeURIComponent(q));
    // 注意：不能只传 `'#tag=…'`。页面里有 `<base href="/">`，浏览器会拿它去解析这个片段 URL，
    // 于是地址栏会变成 `/#tag=…`（根路径 = 首页），筛选其实生效了、URL 却是错的，
    // 复制出去的链接会把人带到首页。所以这里用 location.pathname 拼绝对路径。
    var next = location.pathname + location.search + (bits.length ? '#' + bits.join('&') : '');
    history.replaceState(null, '', next);
  }

  function zoneCard(it, zone, zoneId) {
    var itemFields = asArray(zone.itemFields).map(String);
    var risk = riskBadges(it.risk);
    var known = isPresent(it.entry) ? true : false;

    var nameNode = known
      ? el('a', { class: 'card__name', href: entryUrl(String(it.entry)), dataset: { entry: String(it.entry) }, text: String(it.name || '') })
      : el('span', { class: 'card__name', text: String(it.name || '') });

    var entryNode;
    if (known) {
      entryNode = frag([
        document.createTextNode('词条 '),
        el('a', { href: entryUrl(String(it.entry)), dataset: { entry: String(it.entry) }, text: '→ ' + String(it.entry) }),
        isPresent(it.completeness) ? miniBar(it.completeness) : null
      ]);
    } else {
      entryNode = el('a', {
        class: 'redlink',
        href: redlinkHref(null, it.name),
        dataset: { redlink: '1' },
        title: '尚未收录 · 写这一条',
        text: '写这一条'
      });
    }

    var linkItems = [];
    if (isPlainObject(it.links)) {
      Object.keys(it.links).forEach(function (k) {
        if (!isPresent(it.links[k])) return;
        linkItems.push(el('li', {}, extLink(linkHref(k, it.links[k]), LINKS_ZH[k] || k)));
      });
    }

    var fieldBits = [];
    if (isPlainObject(it.extra)) {
      itemFields.forEach(function (f) {
        if (!isPresent(it.extra[f])) return;
        fieldBits.push(frag([
          el('span', { class: 'k', text: (FIELD_ZH[f] || f) + '：' }),
          el('span', { class: 'v', text: formatExtra(f, it.extra[f]) })
        ]));
      });
    }

    var sourceBadges = [];
    asArray(it.source).forEach(function (s) { sourceBadges.push(badge(String(s), 'source')); });
    if (isPresent(it.extra && it.extra.shippedBy)) {
      sourceBadges.push(badge(SHIPPED_ZH[it.extra.shippedBy] || String(it.extra.shippedBy), it.extra.shippedBy === 'official' ? 'ok' : 'source'));
    }

    return el('li', { class: 'card' }, [
      el('div', { class: 'card__head' }, [nameNode].concat(sourceBadges).concat(risk)),
      el('div', { class: 'card__actions' }, entryNode),
      el('p', { class: 'card__body', text: isPresent(it.blurb) ? String(it.blurb) : '（一句话介绍待补）' }),
      fieldBits.length ? el('div', { class: 'card__fields' }, fieldBits) : null,
      el('div', { class: 'card__meta' }, [
        asArray(it.tags).length ? el('span', { class: 'tagset' }, asArray(it.tags).map(function (t) {
          return tagChip(t, { button: true });
        })) : null,
        isPresent(it.version) ? el('span', { class: 'mono', text: 'v' + String(it.version) }) : null,
        isPresent(it.updatedAt) ? el('span', { text: '更新 ' + fmtDate(it.updatedAt) }) : null,
        linkItems.length ? el('ul', { class: 'card__links' }, linkItems) : missing('外部链接：无数据')
      ])
    ]);
  }

  function formatExtra(field, value) {
    if (field === 'form') return FORM_ZH[value] || String(value);
    if (field === 'shippedBy') return SHIPPED_ZH[value] || String(value);
    if (Array.isArray(value)) return value.map(function (v) { return FORM_ZH[v] || String(v); }).join(' · ');
    if (isPlainObject(value)) return JSON.stringify(value);
    return String(value);
  }

  function miniBar(score) {
    var n = Math.max(0, Math.min(100, Number(score)));
    return el('span', { class: 'mini-bar', title: '完整度 ' + n + '%' }, [
      el('span', { class: 'mini-bar__track' }, el('span', { class: 'mini-bar__fill', style: 'width:' + n + '%' })),
      document.createTextNode(n + '%')
    ]);
  }

  /* -------------------------------------------------------------- 首页 */

  /* ----------------------------------------------- 按类型浏览（#/browse/<kind>） */

  var KIND_ORDER = ['client', 'launcher', 'plugin', 'mcp', 'theme', 'asset', 'skill', 'preset', 'recipe', 'pack', 'tool', 'spec', 'concept', 'tutorial', 'source'];

  /** kind/n 的确定性排序：先按 KIND_ORDER 的固定次序，再按 n 的数字大小 */
  function compareEntryIds(a, b) {
    var pa = String(a).split('/');
    var pb = String(b).split('/');
    var ka = KIND_ORDER.indexOf(pa[0]);
    var kb = KIND_ORDER.indexOf(pb[0]);
    if (ka !== kb) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
    var na = Number(pa[1]);
    var nb = Number(pb[1]);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  }

  /** `#/browse/all` 或 `#/browse/<kind>`；不是浏览路由就返回 null（交回原有分发） */
  function browseKindFromHash() {
    var m = /^#\/browse\/([a-z]+)\/?$/.exec(String(location.hash || ''));
    if (!m) return null;
    var k = m[1];
    if (k === 'all') return 'all';
    return KIND_ORDER.indexOf(k) >= 0 ? k : 'all';
  }

  /**
   * 按类型浏览全部词条。
   * 数据来自 search.json（全站轻量索引：id/kind/title/aliases/tags/summary），
   * 所以这一页只发一个请求——不必为了列表把 12 个词条 JSON 全拉下来。
   */
  function renderBrowse(kindFilter) {
    var main = $('#main');
    return DATA.get('search.json').then(function (index) {
      clear(main);
      var items = asArray(index && index.items).filter(function (it) { return it && isPresent(it.id); });
      var kinds = kindFilter === 'all' ? KIND_ORDER : [kindFilter];
      var groups = kinds.map(function (k) {
        return {
          kind: k,
          list: items.filter(function (it) { return String(it.kind) === k; })
            .sort(function (a, b) { return compareEntryIds(a.id, b.id); })
        };
      }).filter(function (g) { return g.list.length > 0; });
      var total = groups.reduce(function (sum, g) { return sum + g.list.length; }, 0);
      var label = kindFilter === 'all' ? '全部词条' : kindZh(kindFilter) + '词条';

      main.appendChild(el('nav', { class: 'crumbs', 'aria-label': '面包屑' }, el('ol', {}, [
        el('li', {}, el('a', { href: BASE, text: '首页' })),
        el('li', {}, el('span', { text: label }))
      ])));

      main.appendChild(el('div', { class: 'section__head' }, [
        el('h1', { class: 'page__title', text: label }),
        el('span', {
          class: 'section__note',
          text: total > 0
            ? total + ' 条 · 数据来自 registry 与 search.json · 墓碑词条不计入'
            : '这一类还没有词条'
        })
      ]));

      // 类型导航：始终给全六类的入口，让人一眼看到「词条都在这」
      main.appendChild(el('ul', { class: 'kindchips' }, KIND_ORDER.map(function (k) {
        var count = items.filter(function (it) { return String(it.kind) === k; }).length;
        var on = kindFilter === k;
        return el('li', {}, el('a', {
          class: 'kindchip' + (on ? ' kindchip--on' : ''),
          href: '#/browse/' + k,
          'aria-current': on ? 'true' : 'false'
        }, [
          el('span', { class: 'kindchip__name', text: kindZh(k) }),
          el('span', { class: 'kindchip__count', text: count + ' 条' })
        ]));
      }).concat([
        el('li', {}, el('a', {
          class: 'kindchip' + (kindFilter === 'all' ? ' kindchip--on' : ''),
          href: '#/browse/all',
          'aria-current': kindFilter === 'all' ? 'true' : 'false'
        }, [
          el('span', { class: 'kindchip__name', text: '全部' }),
          el('span', { class: 'kindchip__count', text: items.length + ' 条' })
        ]))
      ])));

      if (total === 0) {
        main.appendChild(el('p', { class: 'faint' }, [document.createTextNode('暂时没有词条 '), missing()]));
      }

      groups.forEach(function (g) {
        main.appendChild(el('section', { class: 'section', 'aria-label': kindZh(g.kind) }, [
          el('div', { class: 'section__head' }, [
            el('h2', { text: kindZh(g.kind) + '（' + g.list.length + '）' }),
            el('span', { class: 'section__note', text: kindBlurb(g.kind) })
          ]),
          el('ul', { class: 'cards' }, g.list.map(function (it) {
            return el('li', { class: 'card' }, [
              el('div', { class: 'card__head' }, el('span', { class: 'card__name' }, entryLink(it.id, it.title))),
              el('p', { class: 'card__body', text: it.summary || '' }),
              el('div', { class: 'card__meta' }, [badge(kindZh(it.kind), 'unknown')].concat(
                asArray(it.tags).slice(0, 4).map(function (t) { return badge(String(t), 'unknown'); })
              ))
            ]);
          }))
        ]));
      });

      renderMasthead({ currentZone: null });
      bindCopyButtons(main);
      document.title = label + ' | DSH百科';
    });
  }

  function kindBlurb(kind) {
    return {
      client: '界面与客户端：用什么界面使用 DSH',
      launcher: '启动器：canonical ID 与血缘',
      plugin: '插件聚合页：定位、关系、兼容与坑',
      mcp: 'MCP 接入：把外部工具接成模型能调的能力',
      theme: '主题与皮肤：换掉界面的样子',
      asset: '素材与本地化：图标、字体、界面文案',
      skill: '技能包：以 SKILL.md 为单位的可加载能力',
      preset: '预设与人设：决定这个智能体是什么',
      recipe: '指令与配方：一小段可粘贴的配置',
      pack: '整合包：组成与适合谁',
      tool: '工具：在 DSH 之外运行的那些',
      spec: '规范文件：有争议时以它为准',
      concept: '本体机制：DSH 自己怎么跑起来',
      tutorial: '教程：自写 + 外部教程的索引卡',
      source: '资源源：外部渠道收录什么、怎么用'
    }[kind] || '';
  }

  function renderIndex() {
    var main = $('#main');
    clear(main);

    var entries = registryEntries(GLOBAL.registry);
    var live = entries.filter(function (e) { return e.status !== 'deleted'; });
    var byKind = {};
    live.forEach(function (e) {
      if (!isPresent(e.kind)) return;
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    });

    var totalKnown = live.length > 0;
    var zones = zoneNavItems();

    var heroSearchInput = el('input', {
      type: 'search',
      class: 'search__input',
      id: 'hero-search',
      placeholder: '搜索 词条 / 插件 / 教程 …',
      'aria-label': '站内搜索',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'hero-search-panel',
      'aria-autocomplete': 'list'
    });

    main.appendChild(el('section', { class: 'hero' }, [
      el('h1', { class: 'hero__name', text: SITE.name }),
      el('p', { class: 'hero__tagline', text: SITE.tagline }),
      el('div', { class: 'hero__search' }, el('div', { class: 'search' }, [
        heroSearchInput,
        el('div', { class: 'search__panel', id: 'hero-search-panel', role: 'listbox', 'aria-label': '搜索结果', hidden: true })
      ])),
      el('p', { class: 'hero__stats' }, [
        totalKnown
          ? document.createTextNode('词条 ' + live.length + ' 个 · ' + Object.keys(byKind).sort().map(function (k) {
            return kindZh(k) + ' ' + byKind[k];
          }).join(' · ') + ' · 分区 ' + zones.length + ' 个')
          : frag([document.createTextNode('词条数 '), missing(), document.createTextNode(' · 分区 ' + zones.length + ' 个')])
      ])
    ]));

    // 分区导航（十二个，全部可达）
    main.appendChild(el('section', { class: 'section', 'aria-label': '十二个一级分区' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: '十二个一级分区' }),
        el('span', { class: 'section__note', text: '按「装配位置」分层：从界面到规范' })
      ]),
      el('ul', { class: 'zonegrid' }, zones.map(function (z) {
        var meta = zoneMeta(z.id);
        return el('li', {}, el('a', { class: 'zonecard', href: zoneUrl(z.id) }, [
          el('span', { class: 'zonecard__count', dataset: { zoneCount: z.id }, text: '条目 无数据' }),
          el('span', { class: 'zonecard__name', text: meta.title || z.label }),
          el('span', { class: 'zonecard__desc', text: meta.desc || '' })
        ]));
      }))
    ]));

    // 全部词条：最容易被问「词条在哪」的那一步，先给足入口
    var kindCounts = KIND_ORDER.map(function (k) { return { kind: k, n: byKind[k] || 0 }; })
      .filter(function (x) { return x.n > 0; });
    main.appendChild(el('section', { class: 'section', 'aria-label': '全部词条' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: '全部词条（' + live.length + '）' }),
        el('a', { href: '#/browse/all', text: '按类型浏览全部 →' })
      ]),
      kindCounts.length
        ? el('ul', { class: 'kindchips' }, kindCounts.concat([{ kind: 'all', n: live.length }]).map(function (x) {
          return el('li', {}, el('a', { class: 'kindchip', href: '#/browse/' + x.kind }, [
            el('span', { class: 'kindchip__name', text: x.kind === 'all' ? '全部' : kindZh(x.kind) }),
            el('span', { class: 'kindchip__count', text: x.n + ' 条' })
          ]));
        }))
        : el('p', { class: 'faint' }, [document.createTextNode('还没有词条 '), missing(), document.createTextNode('（领号后出现在这里）')])
    ]));

    // 教程（我们侧重的那一半）
    var tutorials = entries.filter(function (e) { return e.kind === 'tutorial' && e.status !== 'deleted'; })
      .sort(function (a, b) { return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')); })
      .slice(0, 6);
    main.appendChild(el('section', { class: 'section', 'aria-label': '教程' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: '教程' }),
        el('a', { href: '#/browse/tutorial', text: '全部教程 →' })
      ]),
      tutorials.length
        ? el('ul', { class: 'updatelist' }, tutorials.map(function (t) {
          return el('li', {}, [
            el('span', { class: 'kind', text: '教程' }),
            entryLink(t.kind + '/' + t.n, t.title),
            el('span', { class: 'when', text: fmtDate(t.updatedAt || t.createdAt) })
          ]);
        }))
        : el('p', { class: 'faint' }, ['教程 ' , missing(), document.createTextNode('（registry 里还没有教程词条）')])
    ]));

    // 最近更新
    var recent = entries.filter(function (e) { return e.status !== 'deleted'; })
      .sort(function (a, b) {
        var ka = String(b.updatedAt || b.createdAt || '');
        var kb = String(a.updatedAt || a.createdAt || '');
        return ka.localeCompare(kb);
      })
      .slice(0, 10);
    main.appendChild(el('section', { class: 'section', 'aria-label': '最近更新' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: '最近更新' }),
        el('span', { class: 'section__note', text: '按 updatedAt / 创建时间排序，来自 registry' })
      ]),
      recent.length
        ? el('ul', { class: 'updatelist' }, recent.map(function (t) {
          return el('li', {}, [
            el('span', { class: 'kind', text: kindZh(t.kind) }),
            entryLink(t.kind + '/' + t.n, t.title),
            el('span', { class: 'when', text: fmtDate(t.updatedAt || t.createdAt) })
          ]);
        }))
        : el('p', { class: 'faint' }, [document.createTextNode('最近更新 '), missing(), document.createTextNode('（registry 为空或未生成）')])
    ]));

    // 资源源块：首屏就承认「插件全量收录不在我们这里」
    main.appendChild(el('section', { class: 'section', 'aria-label': '资源源' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: '插件生态不止我们一家 · 资源源' }),
        el('span', { class: 'section__note', text: '我们做解释与整合，不做全量收录' })
      ]),
      el('ul', { class: 'cards' }, ECO.map(function (e) {
        return el('li', { class: 'card' }, [
          el('div', { class: 'card__head' }, el('span', { class: 'card__name', text: e.label })),
          el('div', { class: 'card__actions' }, extLink(e.url, '去源头')),
          el('p', { class: 'card__body', text: ecoBlurb(e.label) })
        ]);
      }))
    ]));

    main.appendChild(el('section', { class: 'section', 'aria-label': '装在哪' }, [dropZone({})]));

    renderMasthead({ currentZone: null });
    attachSearch(heroSearchInput, $('#hero-search-panel'));
    bindCopyButtons(main);
    primeZoneFiles();
  }

  function ecoBlurb(label) {
    if (label.indexOf('awesome') === 0) return '插件目录：全量条目、分类、安装命令。';
    if (label.indexOf('dshbase') === 0) return '中文指南与排错：入门交给它。';
    if (label.indexOf('市场') >= 0) return '整合包索引与下载：装包去这里。';
    return '规范与协议的事实源。';
  }

  /* --------------------------------------------------------------- 渲染 */

  function showLoadError(err) {
    var main = $('#main');
    if (!main) return;
    clear(main);
    main.appendChild(el('div', { class: 'loaderror' }, [
      el('p', { class: 'notice notice--danger' }, [
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '✖' }),
        document.createTextNode('数据加载失败：' + (err && err.message ? err.message : String(err)))
      ]),
      el('p', { class: 'muted' }, [
        document.createTextNode('本站是纯静态站点，页面数据来自构建产物 '),
        el('code', { text: BASE + 'data/' }),
        document.createTextNode('。请先运行 '),
        el('code', { text: 'node scripts/build.mjs' }),
        document.createTextNode('，并确认通过 HTTP 打开本页（file:// 下 fetch 会被浏览器拒绝）。')
      ]),
      el('p', {}, el('a', { href: BASE, text: '回首页' }))
    ]));
  }

  function run() {
    bootTheme();

    var P = window.__PEDIA__ || {};
    var page = P.page || (document.body && document.body.getAttribute('data-page')) || 'index';

    // 顶栏与页脚都要用 registry / zones/index，所以先取数据再渲染外壳。
    var pre = Promise.all([
      DATA.soft('registry.json'),
      DATA.soft('zones/index.json')
    ]).then(function (r) {
      GLOBAL.registry = r[0];
      GLOBAL.entryIndex = buildEntryIndex(r[0]);
      registerZoneIndex(r[1]);
      renderFooter();
    });

    pre
      .then(function () {
        var browseKind = browseKindFromHash();
        if (browseKind) return renderBrowse(browseKind);
        if (page === 'entry') {
          var kind = P.kind || (document.body && document.body.getAttribute('data-kind'));
          var n = P.n;
          if (!isPresent(kind) || !isPresent(n)) throw new Error('window.__PEDIA__ 缺少 kind/n');
          return DATA.get('entries/' + kind + '-' + n + '.json').then(renderEntry);
        }
        if (page === 'zone') {
          var zoneId = P.kind || P.zone || (document.body && document.body.getAttribute('data-zone'));
          if (!isPresent(zoneId)) throw new Error('window.__PEDIA__ 缺少 kind（分区 id）');
          return DATA.get('zones/' + zoneId + '.json').then(function (zone) {
            if (!isPresent(zone.id)) zone.id = zoneId;
            if (!GLOBAL.zoneIndex) GLOBAL.zoneIndex = {};
            if (!GLOBAL.zoneIndex[zoneId]) {
              GLOBAL.zoneIndex[zoneId] = {
                title: zone.title || (zoneFallback(zoneId) || {}).label || zoneId,
                desc: zone.desc || '',
                count: asArray(zone.items).length
              };
            }
            return renderZone(zone);
          });
        }
        return renderIndex();
      })
      .catch(showLoadError);
  }

  // 分区条目数：先渲染「无数据」，数据到了再就地补上（无数据 ≠ 0）
  function primeZoneFiles() {
    return loadZoneFiles().then(function (list) {
      list.forEach(function (z) {
        var node = document.querySelector('[data-zone-count="' + z.id + '"]');
        if (node) node.textContent = asArray(z.items).length + ' 条';
      });
    });
  }

  // 浏览路由是纯 hash 的：在站内点「按类型浏览」时不需要重载页面。
  // 分区页自己的 tag/搜索 hash 由它内部的 hashchange 处理，这里只管 #/browse/…
  window.addEventListener('hashchange', function () {
    var browseKind = browseKindFromHash();
    if (browseKind) renderBrowse(browseKind).catch(showLoadError);
  });

  // 侧栏状态尽早落地：defer 脚本在解析后、首次绘制前执行，避免侧栏闪一下才收起
  applyInitialRailState();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // 便于自测：暴露少量只读入口
  window.__PEDIA_APP__ = {
    base: BASE,
    mdToHtml: mdToHtml,
    renderZone: renderZone,
    renderEntry: renderEntry
  };
})();
