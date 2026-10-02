# 10 · M1 接口冻结（工具链 / 内容 / 站点外壳 三方共用）

> 状态：**实施约束（M1 期间有效）**。设计意图见 [01](01-information-architecture.md)–[09](09-mcmod-entry-deepdive.md)；本文只冻结**三方并行工作时必须一致的接口**：文件所有权、产物字段名、模板占位符、CLI 行为。改这里要先改三份实现。

---

## 1. 文件所有权（并行工作互不越界）

| 工作流 | 拥有 | 禁止改动 |
| --- | --- | --- |
| **A · 工具链** | `scripts/**`、由构建生成的 `web/data/**`、`web/<kind>/<n>.html`、`web/<zone>.html` | `data/**`、`web/*.template.html`、`web/pedia.css`、`web/pedia.js`、`web/index.html` |
| **B · 内容** | `data/**`（registry / taxonomy / sources / entities / zones / 各类词条） | `scripts/**`、`web/**` |
| **C · 站点外壳** | `web/index.html`、`web/entry.template.html`、`web/zone.template.html`、`web/pedia.css`、`web/pedia.js`、`web/assets/**` | `data/**`、`scripts/**` |

**构建产物不入库**（`.gitignore` 已覆盖）；模板与 `web/index.html` 是事实源，必须入库。

---

## 2. 运行环境与硬约束

- **Node 22，ESM（`.mjs`），零第三方依赖**（只用 `node:fs` / `node:path` / `node:url`）。
- 构建**必须能完全离线跑**：`build.mjs` 只读 `data/**` 与 `collected/**`，不联网。
- 工作目录约定：脚本以仓库根为基准（`path.resolve(__dirname, '..')`），不依赖调用时的 cwd。
- Windows 上也要能跑（路径用 `node:path`，不写死 `/`）。

---

## 3. CLI 契约

```bash
node scripts/new.mjs <kind> "<标题>"        # 领号：分配 n、写 registry、生成词条骨架；打印新文件路径与 id
node scripts/validate.mjs                    # 校验：error 退出码 1，warn 不影响退出码；末尾打印 "N errors, M warnings"
node scripts/build.mjs                       # 构建：写 web/data/**、web/<kind>/<n>.html、web/<zone>.html
node scripts/linkcheck.mjs [--write]         # 可选：HEAD 检查外链，写 collected/links.json（不参与 build 必需路径）
```

- `<kind>` ∈ `concept | plugin | tutorial | pack | launcher | source`；非法值报错退出 2。
- `new.mjs` 只改 `data/registry.yml` 的计数器与条目表，并创建 `data/<kind>/<n>.md`；**已删除（`status: deleted`）的号不复用**。
- `validate.mjs` / `build.mjs` 在遇到无法解析的 YAML 时打印文件名与行号（自己实现的极简解析器要给出人话错误）。

---

## 4. 词条产物：`web/data/entries/<kind>-<n>.json`

```jsonc
{
  "id": "plugin/12",              // <kind>/<n>
  "kind": "plugin",
  "n": 12,
  "title": "dsh-loader",
  "titleEn": null,
  "aliases": ["DSH 加载器"],
  "summary": "……",
  "status": "published",          // draft | published | archived | deleted
  "updatedAt": "2026-10-02",
  "html": "<p>…</p>",             // 渲染后的正文（已转义，见 §7）
  "toc": [{ "level": 2, "text": "它解决什么问题", "anchor": "它解决什么问题" }],
  "meta": { },                    // 该 kind 的专有字段原样透传（plugin 的 compat/roles/…）
                                  // 另：`archivedNote` 也放这里（common 可选字段，墓碑/归档页要用）
  "sources": { "license": "auto", "compat": "manual" },   // 字段 → manual|verified|auto
  "completeness": { "score": 78, "missing": [{ "field": "compat", "label": "兼容性未声明", "hint": "补 compat.dsh" }] },
  "plugins": [ { "name": "…", "entry": "plugin/12", "why": "…", "install": "…", "links": {} } ],
  "relations": [ { "type": "requires", "target": "plugin/14", "targetTitle": "…", "since": null, "until": null, "note": null } ],
  "backlinks": [ { "id": "tutorial/1", "title": "写一个 DSH 插件" } ],
  "zone": { "id": "plugins", "title": "插件" },           // 该 kind 默认所属分区
  "usedInPacks": ["hxh230802.pokemon"],                    // 仅 plugin，构建期派生
  "referencedByTutorials": ["tutorial/1"],                 // 所有类型，构建期派生（教程的 plugins 块或正文提及）
  "snapshot": "2026-10-01"                                 // 外部源快照日期（无则 null）
}
```

## 5. 分区产物：`web/data/zones/<zone>.json`

```jsonc
{
  "id": "clients",
  "title": "界面与客户端",
  "desc": "你从哪、以什么界面使用 DSH：……",
  "howto": "装法与落点随类型不同，见每个条目的说明。",
  "kinds": ["client"],             // 这个分区收哪种词条（docs/12）
  "sections": [                    // 二级分区（docs/06 §2.0.1），**顺序即展示顺序**
    { "id": "official", "title": "官方客户端", "desc": "…", "intro": null, "introHtml": null }
  ],
  "itemFields": ["form", "shippedBy", "profile", "platforms"],
  "items": [
    {
      "name": "官方 Web UI",
      "blurb": "浏览器里的完整界面，dsh web 启动。",
      "section": "official",        // 归到哪个二级分区
      "source": "curated",          // 条目级来源徽章：awesome | market | launchers | specs | curated
      "links": { "github": "deepseek-ai/deepseek-harness" },
      "entry": "plugin/12",         // 可空 → 红链
      "entryTitle": "…",               // entry 存在时由构建填充
      "completeness": 78,              // entry 存在时为数字，否则 null
      "tags": ["UI 增强"],
      "version": null,                 // 可选，通用键
      "updatedAt": null,               // 可选，通用键
      "risk": ["build-script"],
      "extra": { "form": "web", "shippedBy": "official", "profile": "web" }   // 只允许 itemFields 内的键
    }
  ]
}
```

> **通用卡片键**（直接写在条目上，**不要**声明进 `itemFields`，否则会被塞进 `extra` 而顶层丢失）：
> `name` / `blurb` / `source` / `links` / `entry` / `completeness` / `tags` / `version` / `updatedAt` / `risk`。
> `itemFields` 只放**分区独有**的字段（如 `clients` 的 `form` / `shippedBy` / `profile` / `platforms`）。校验器对「把通用键写进 itemFields」报 error。

## 6. 其余产物

| 文件 | 结构 |
| --- | --- |
| `web/data/registry.json` | `data/registry.yml` 原样 + `generatedAt`（含 `counters` 与 `entries[]`，墓碑保留） |
| `web/data/search.json` | `{ generatedAt, items: [{ id, kind, title, aliases, tags, summary }] }` |
| `web/data/taxonomy.json` | `{ tree: [...节点原样...], counts: { "core.compat": 3 } }` |
| `web/data/entities.json` | `{ generatedAt, entities: [ { id, keys, refs: [ { source, url, at, fields } ] } ] }` |
| `web/data/reverse/plugins.json` | `{ generatedAt, plugins: [ { key, name, entryId, tutorials: [], packs: [], refs: [] } ] }` |
| `web/data/plugins/index.json` | `{ generatedAt, items: [ { id, n, title, positioning, category, tags, providedBy, completeness } ] }` |
| `web/data/links.json` | `{ checkedAt, links: [ { url, status: "ok"\|"warn"\|"fail", code } ] }`（`linkcheck.mjs` 写，缺失时前端显示「未检查」） |

**排序**：一切数组**按确定性排序**（数字 id 升序、字符串按 `localeCompare('zh')`），保证同样的输入产出同样的字节，避免无意义 diff。

---

## 7. 模板与占位符

两个模板 + 首页外壳：

| 文件 | 谁写 | 用途 |
| --- | --- | --- |
| `web/index.html` | C（手写，不参与生成） | 首页；JS 读 `registry/taxonomy/zones/search` 渲染 |
| `web/entry.template.html` | C | 词条页外壳，构建期为每条词条生成一份 |
| `web/zone.template.html` | C | 分区页外壳，构建期为每个分区生成一份 |

**占位符只有三个**（构建期字符串替换，别用模板引擎）：

```html
<title>{{TITLE}}</title>
<meta name="description" content="{{DESC}}">
...
<!--{{PEDIA_BOOT}}-->
```

- `{{TITLE}}`：`dsh-loader | DSH百科`（首页用全名，见 [08](08-visual-system.md) §8 的 title 模板）。
- `{{DESC}}`：词条用 `summary`；分区页用 `desc`；首页用 OG description 固定句。
- `<!--{{PEDIA_BOOT}}-->` 被替换为：

```html
<script>window.__PEDIA__ = {"base":"/","page":"entry","kind":"plugin","n":12,"title":"dsh-loader"};</script>
```

`page` ∈ `entry | zone | index | static`。前端**只依赖 `window.__PEDIA__` 与 `base`**，不解析 URL 猜页面（除了 hash 路由的分区/筛选状态）。
注意 `static`（维度索引页）的正文是**构建期写好的**：boot() 不移除它、也不重渲染正文，只补站点外壳与交互。
`web/mesh/`（全量插件生态图）是**第三方应用**：应用本体在 `web/mesh/app/`（构建期从 `vendor/` 原样拷来），
外面 `web/mesh/index.html` 是**我们的说明壳**（渲染自 `web/mesh.template.html`：署名、数据来源、
「未经本站核实」的口径 + 同源 iframe）。两边都不走站点外壳——那张图是全屏应用。

**生成路径**：`web/<kind>/<n>.html`（如 `web/plugin/12.html`）、`web/<zone>.html`（如 `web/plugins.html`）、首页仍为 `web/index.html`。

---

## 8. Markdown 渲染（安全边界）

- 自己实现最小渲染器：标题 / 段落 / 无序与有序列表 / 围栏代码块 / 表格 / 行内 `code`、`**粗**`、`*斜*`、链接、`[[kind/n]]` 站内链接。
- **先转义再替换**（照 `dsh-pack-market/web/market.js` 的 `renderMarkdown` 纪律）：`& < > " '` 全部转义，链接只允许 `http(s):`，不允许 `javascript:`。
- `[[kind/n]]` 渲染成 `<a href="{base}{kind}/{n}.html" data-entry="kind/n">`；目标不存在时渲染成红链 `<a class="redlink" data-entry="kind/n" href="#/contributing">`，并在 `validate.mjs` 里报 error。
- 标题生成锚点（中文标题直接用文本做 id，重名追加 `-2`、`-3`）。

---

## 9. 校验器要求（`validate.mjs`）

实现 [02](02-data-contract.md) §9 的 23 条规则；其中 6 / 23 两条（**致命**）必须在 M1 就位：

- **规则 6**：`category` 每项都是 taxonomy 的**叶子**节点。
- **规则 23**：分区条目只允许出现 `itemFields` 白名单内的专属键。

其余规则允许先以 `warn` 输出并在 M1 收尾时收紧。**退出码**：有 error → 1；只有 warn → 0。

---

## 10. 验收（M1 完成即逐条核对）

```bash
node scripts/validate.mjs     # 0 errors（warn 可接受）
node scripts/build.mjs        # 产出 web/data/**、web/<kind>/*.html、web/*.html
npx serve web                 # 人工点通
```

- [ ] 十二个分区页**均非空**（[08](08-visual-system.md) §8.6 的硬要求）
- [ ] `/plugin/12.html` 一类的词条页可直接打开，标题与 OG 正确
- [ ] 搜索能命中词条与分区条目；红链可点且指向贡献入口
- [ ] 反链与 `reverse/plugins.json` 正确（教程引用了插件 → 插件页能反查到）
- [ ] 墓碑页（`status: deleted`）存在且不 404
- [ ] 亮/暗两态、375 / 1024 / 1280 三档宽度不破版
- [ ] 构建两次产出**逐字节一致**（确定性）
