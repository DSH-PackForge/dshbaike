# 03 · 目录结构、构建与部署

> 状态：**设计稿（待评审）**。本文只定工程形态与流水线，不定词条字段（见 [02-data-contract.md](02-data-contract.md)）与页面形态（见 [01-information-architecture.md](01-information-architecture.md)）。
>
> 依据：`dsh-pack-market` 的现行工程约定（`web/README.md`、`.github/workflows/deploy-pages.yml`、`scripts/collect.mjs`）、`DSH-PackForge/specs/index/index.md`（index schemaVersion 2）、`DSH-PackForge/specs/manifest/v5.md`。

---

## 1. 仓库形态

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 仓库 | **独立仓库** `DSH-PackForge/dshbaike`，与 `dsh-pack-market`、`dsh-packforge-app` 平级 | 词条内容体量大、贡献者不同（写词条 vs 改规范 vs 写代码）、CI 频率与失败代价不同；混进规范仓库会让「改一句话」也要跑规范评审 |
| 站名 / 域名 | **DSH 百科** / `dshbaike.com`；过渡期先用免费子域 `dshbaike.pages.dev` | 域名是入口、仓库名是工程标识，两者不必一致；品牌规范见 [08](08-visual-system.md) §8 |
| 托管 | **GitHub Pages**（仓库已公开，免费、零 secrets，见 §8），备选 Cloudflare Pages / Vercel / Netlify | 公开仓才可用 Pages；项目站是**子路径**部署，构建期必须传 `--base=/dshbaike/` |
| 站点输出目录 | `web/` | 托管方直接发布该目录；构建产物不入库 |
| 本地目录 | 工作区里的 `dsh-pedia/` 是该仓库的工作副本（仓库已改名为 `dshbaike`）。目录名与仓库名不一致**不影响 git**，句柄释放后手工改名即可对齐 | 同级目录均为独立仓库，根目录只是容器、本身不是仓库 |

---

## 2. 目录结构

```
dshbaike/                       # 仓库名；本地工作副本可能仍是 dsh-pedia/（见 §1 本地目录一行，不影响 git）
├── data/                       # ★ 事实源：人工词条与分类表，PR 只改这里
│   ├── registry.yml            # ★ 编号契约：各 kind 的计数器 + n → 标题/日期/状态（含墓碑）
│   ├── concept/<n>.md          # 概念词条（MC百科式自增数字，永不复用）
│   ├── plugin/<n>.md           # 插件词条（聚合页：外部源指针 + 人工写的关系/兼容/定位）
│   ├── tutorial/<n>.md         # 教程词条（自写 + 外部教程索引卡）
│   ├── client/<n>.md           # 客户端词条（界面与客户端分区）
│   ├── launcher/<n>.md         # 启动器词条
│   ├── theme/<n>.md            # 主题与皮肤词条
│   ├── asset/<n>.md            # 素材与本地化词条
│   ├── skill/<n>.md            # 技能包词条
│   ├── preset/<n>.md           # 预设与人设词条
│   ├── recipe/<n>.md           # 指令与配方词条
│   ├── pack/<n>.md             # 整合包词条
│   ├── tool/<n>.md             # 工具（工具链分区）
│   ├── spec/<n>.md             # 规范文件词条
│   ├── source/<n>.md           # 资源源词条（外部插件源/渠道：awesome、dshbase、npm…）
│   ├── zones/<zone>.yml        # ★ 分区层数据（十二个一级分区：界面与客户端/插件/整合包/启动器/主题/…，不编号）
│   ├── entities.yml            # ★ 多源实体归并：keys（repo:/npm:）→ 词条 id，refs 由采集写
│   ├── sources/<slug>.yml      # 尚未文档化的源（纯抓取配置；与源词条不能并存）
│   ├── taxonomy.yml            # 分类树（人工 curation，每节点带 desc）
│   ├── sources.yml             # 外部实体映射：插件 ↔ npm 包 ↔ GitHub 仓库 ↔ 市场 id
│   └── assets/                 # 词条配图（screenshots 指向这里）
├── collected/                  # 采集产物（机器写，入库以便离线构建与审计）
│   ├── market.json             # 市场 index.json 快照
│   ├── packs/<id>.json         # 每包的完整 manifest 摘要（包成分表用）
│   ├── launchers.json          # 启动器 canonical ID 注册表
│   ├── awesome.json            # awesome 的 catalog.json 快照（只用于引用与候选，不落插件的元数据副本）
│   ├── sources/<id>.json       # 各源的分区条目快照（按 adapter 的字段映射归一）
│   └── links.json              # 外链可达性检查结果（哪些链接待核 / 已失效）
├── scripts/
│   ├── new.mjs                 # ★ 领号：取下一个空闲编号、写 registry、生成 front-matter 骨架
│   ├── collect.mjs             # 采集（网络）：市场索引 + 逐包 manifest + launchers + awesome catalog 快照
│   ├── build.mjs               # 构建（离线）：合并 → Markdown 渲染 → 反链 / 反向索引 / TOC → 写 web/data/
│   ├── validate.mjs            # 校验：编号契约 / schema / 分类 id / 交叉链接 / 收录门槛（CI 门禁）
│   ├── linkcheck.mjs           # 外链与图片可达性检查（HEAD，失败降级为 warn）
│   └── lib/                    # 共享：front-matter 解析、Markdown 渲染、taxonomy 与 registry 读写
├── web/                        # 站点：模板与静态资源是事实源，data/ 与各 kind 目录是构建产物
│   ├── index.html              # 首页（资源源区块 / 教程 / 搜索 / 统计）
│   ├── entry.template.html     # 词条页外壳模板，构建期为每条词条生成一份
│   ├── pedia.css / pedia.js    # 样式与渲染逻辑
│   ├── assets/
│   ├── data/                   # ★ 构建产物，.gitignore
│   ├── <zone>.html             # ★ 构建产物：十二个分区页（/clients、/plugins、/themes…）
│   └── <kind>/<n>.html         # ★ 构建产物：每条词条一个真实路径（见 §5.1）
├── docs/                       # 本设计文档
├── .github/workflows/
│   ├── ci.yml                  # PR：validate + build 干跑
│   └── deploy.yml              # 定时采集 + build + 发布（目标托管方：Cloudflare Pages / 备选 Vercel、Netlify）
├── CONTRIBUTING.md             # 领号 → 写词条 → 提 PR 的流程
├── LICENSE                     # 代码 CC0 1.0；词条正文 CC BY-SA 4.0；结构化数据 CC0（见 §7）
└── README.md
```

**为什么构建产物不入库**：`web/data/` 与 `web/<kind>/` 是纯派生结果（Markdown → HTML + 检索索引 + 反链 + 反向索引），入库只会制造噪音 diff 与合并冲突。事实源只有 `data/`（人工）与 `collected/`（采集）。这一点与市场不同——市场的 `index/index.json` 既是产物又是别的仓库要读的**公开数据接口**，所以必须入库。

**领号流程**（编号是身份，所以分配要集中）：

```bash
node scripts/new.mjs tutorial "为什么升级后插件会失效"
# → 分配 tutorial/6，写入 data/registry.yml，生成 data/tutorial/6.md 骨架
```

规则：只有 `new.mjs` 会改 `counters`；手改 registry、跳号、覆盖墓碑号一律被 `validate.mjs` 拒绝。断号（有人删了草稿）不回填——**编号的意义就是不变**。

---

## 3. 数据流向

```
                    ┌──────────────────────────────┐
                    │ data/  （人工词条，PR 修改） │
                    └───────────────┬──────────────┘
                                    │
  ┌───────────────────┐             │            ┌────────────────────┐
  │ dsh-pack-market   │  采集        │            │ GitHub API         │
  │ index.json +      ├─────────────┼────────────┤ （插件仓库元数据） │
  │ packs/<id>/       │             │            └─────────┬──────────┘
  └───────────────────┘             │                      │
                          ┌─────────▼──────────┐  ┌────────▼─────────┐
                          │ collected/*.json   │  │ collected/       │
                          │ （失败沿用上轮）   │  │ github.json      │
                          └─────────┬──────────┘  └────────┬─────────┘
                                    └──────────┬───────────┘
                                    ┌──────────▼───────────┐
                                    │ scripts/build.mjs    │  离线可跑
                                    │ 合并 / 渲染 / 反链    │
                                    └──────────┬───────────┘
                                    ┌──────────▼───────────┐
                                    │ web/data/*.json      │  浏览器只读这些
                                    └──────────┬───────────┘
                                    ┌──────────▼───────────┐
                                    │ web/ → GitHub Pages  │
                                    └──────────────────────┘
```

---

## 4. 合并规则：人工永远优先

| 字段类别 | 优先级 | 冲突与缺失处理 |
| --- | --- | --- |
| 词条正文（`body`）、分类、别名、关系、资料清单 | **人工独占** | 采集绝不写入；缺失即为缺失，不猜 |
| 版本 / 许可证 / 仓库地址 / 最近提交 / star | 采集（可被人工覆盖） | 词条页显示「来源：自动采集 · 快照 `generatedAt`」；人工核实过的显示「来源：人工核实」 |
| 上游包内组合（`bundles` / `dependencies` / `profiles` / `presets` / `skills` / `instructions`） | 采集（可由人工补注） | 人工可加备注字段，不覆盖原始值 |

三条纪律（沿用市场的可靠性口径）：

1. **采集失败绝不产出残缺数据**：本轮抓取失败就沿用 `collected/` 里上一轮的值，不删、不清空；失败原因打在日志里。
2. **不写「空值」字段**：没有数据就不写该字段，页面显示「无数据」。禁止把「未测得」写成 `0`——市场的下载量口径已经踩过这个坑。
3. **采集永不覆盖人工字段**，只能填人工留空的位置（字段级来源标注，见 [02](02-data-contract.md) §6）。

---

## 5. 为什么把反链、TOC、死链检测放在构建期

联网前的样子：浏览器端要算「哪些词条链接到了本条」，就得把全量词条下载下来——词条上百条后首页会变得很重。

构建期算一次，词条页只读一个 JSON：

| 产物 | 内容 | 消费者 |
| --- | --- | --- |
| `web/data/entries/<kind>-<n>.json` | 渲染好的 HTML + TOC + 元信息 + 反链 + 引用的插件 + **`completeness`（字段完备度与缺项清单，构建期派生）** | 词条页 |
| `web/data/registry.json` | 编号目录：n / kind / title / createdAt / status（含墓碑） | 导航、最近更新、墓碑页 |
| `web/data/reverse/plugins.json` | **插件 → 引用它的教程** + **插件 → 使用它的整合包** | 插件词条页的「谁在用」，教程页的「还出现在」 |
| `web/data/search.json` | 轻量检索索引：id / kind / 标题 / 别名 / 标签 / 摘要 | 首页与搜索结果页（分栏） |
| `web/data/taxonomy.json` | 分类树 + 每类计数 | 导航与筛选 |
| `web/data/plugins/index.json` | 插件词条的轻量索引（规模 = 本站词条数，不是生态全量） | `#/plugins` 索引页 |
| `web/data/zones/<zone>.json` | 分区页数据：标题 / 定义 / `howto` / `kinds`（收哪种词条）/ **`sections` 二级分区（含编辑综述 `introHtml`）** / `itemFields` 白名单 / 条目卡片（按二级分区分组、`entry` 链接与红链标记 / 标签 / 风险徽章 / 专属字段 / 完整度小标）。~~来源区块~~已废弃（[07](07-multi-source-zones.md)） | 十二个分区页 |
| `web/data/entities.json` | 归并后的实体表：`id` / `keys` / `refs`（各源字段并列，带快照时间） | 分区页卡片、插件词条的外部源区 |
| `web/data/links.json` | 外链与图片的可达性检查结果 | 页面上的「链接待核」标注 |

推论：`build.mjs` **必须能完全离线跑**（只读 `data/` 与 `collected/`）。联网只发生在 `collect.mjs`。

死链检测只在构建期做得到：`[[wikilink]]` 指向不存在的词条 id、词条引用的图片不存在，都在 `validate.mjs` 里报错——这是 wiki 不烂掉的关键机制。

### 5.1 词条页的静态生成与 base 路径

`build.mjs` 为每条词条吐一个 `web/<kind>/<n>.html`（如 `web/tutorial/6.html`、`web/plugin/12.html`）：外壳复用 `entry.template.html`，只替换标题、OG meta 与该词条的 `kind/n`。这样分享出去的链接在社交平台能出预览卡，搜索引擎也能逐条收录——hash 路由做不到这两件事。删除的词条也要生成墓碑页（`status: deleted` → 显示「本词条已撤下」+ 指向替代词条），**链接不烂是编号方案存在的理由**。

站点挂在域名根（`https://dshbaike.com/`，过渡期 `https://dshbaike.pages.dev/`），所以 `base` 默认就是 `/`——比挂在项目子路径（如 `user.github.io/repo/`）省事。即便如此，仍把 base 写成**构建期可配置的常量**，以便将来改成子路径部署或本地 `file://` 预览：

```html
<script>window.__PEDIA_BASE__ = "/";</script>
```

`pedia.js` 一律用 `__PEDIA_BASE__ + 'data/…'` 取数据。这一点与市场不同——市场挂在 `dsh-packforge.github.io/dsh-pack-market/` 子路径下，只能靠相对路径兜。

---

## 6. 与其它源的关系：消费者与聚合者，不是第二个采集器

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 整合包列表与指针（`id` / `version` / `displayName` / `downloadUrl` / `sha256` / `size` / `updatedAt` / 计数） | **消费** `dsh-pack-market` 的 `index.json`（schemaVersion 2） | 不自己扫 topic `dsh-pack`，避免同一事实源两处采集后漂移 |
| 包成分表（层栈 / 依赖 / 技能 / 预设 / 指令 / patch 摘要） | 消费市场的 `packs/<owner>.<repo>/manifest.json` + 归档解析 | manifest v5 的 `bundles` / `dependencies` / `profiles` / `presets` / `skills` / `instructions` 是主要来源；profile 形态的技能需扫归档 |
| 启动器注册表 | `dsh-pack-market/index/launchers.json` | 5 条 canonical ID |
| **插件的事实（star / 下载量 / 收录日期 / npm 名 / 安装命令 / 详情页）** | **引用** `awesome-dsh-plugin.com` 的 `catalog.json`（快照入库，只用于引用与候选） | **不落插件的元数据副本**：页面显示「引用自 awesome · 快照 2026-10-01」+ 外链 |
| **插件词条的候选** | 反查市场 manifest 的 `bundles` / `dependencies`（实测 26 个不同包名）+ 本站教程引用过的插件 | 候选进 `collected/`，人工决定建条 |
| **插件分区的多源**（awesome / dshbase / npm / GitHub topic） | 各写一条 `adapter` 配置（[07](07-multi-source-zones.md) §3）；`awesome` 与 `dshbase` 有可抓的 JSON/页面，`npm` 与 topic 只做「跳转入口」不抓 | 源可插拔：新增源 = 加一条配置，分区页自动多一个来源区块 |
| GitHub topic `dsh-plugin` | **只作为「资源源」词条介绍给读者**，我们不做全量扫描 | 它的价值是「去哪发现」，不是「我们要镜像它」 |

代价与对策：百科的整合包与插件数据都依赖外部源可用性。对策是采集产物入库（`collected/*.json`），所以**外部源挂了也能构建**，页面标注数据快照时间。

> 反向深链：整合包词条的「安装」按钮指回市场条目与 `dspack install` 命令；插件词条的外部源区指回 awesome 详情页与 npm；外部源的资源源词条再指回我们（互相导流）。各方都不复制对方的正文。

### 6.1 已经写好的解析器，别再写一遍

`dsh-packforge-app/packages/core/` 里有两处现成实现，包成分表直接站在它们肩上：

| 现成实现 | 已做到什么 | 百科怎么用 |
| --- | --- | --- |
| `src/inspect.js` 的 `inspectPack()` | 解 ZIP → 校验 `dspack.json` 标记 → 校验 manifest → 按 `machine` / `overrides` / `home` / `other` 四类出目录树，返回 `sha256` / `size` / `containerVersion` / `valid` / `manifest` | 采集器调用它产出 `collected/packs/<id>.json`，**不自己写 .dspack 解析** |
| `src/pack.js` 的 `summarizeHome()`、`src/special.js` 的 `summarizeSpecial()` | 把归档里的单元归一成「profile / skill / preset / 指令」四类（`skills/<n>.md` 平铺与 `skills/<n>/SKILL.md` 目录两种布局都归一为 `skills/<n>`） | 包成分表里 profile 形态的技能/预设格子就靠它填 |

一个必须防的现实偏差：参考实现 `all-about-whales` 的 `dspack.json` 写的是 `{"format":"dspack","version":2}`，而**现行规格是 v3**（它的 manifest 也是 v4）。所以解析器要**先读 `dspack.json.version` 再按版本分派**，不要假定 3。

### 6.2 插件词条的候选从哪来（不做普查）

| 来源 | 规模 | 用法 |
| --- | --- | --- |
| 市场 manifest 反查 | 8 个包 → **26 个不同包名**（实测） | 自动生成候选：被真实使用过的插件，优先级最高 |
| 本站教程的引用块 | 随教程增长 | **最主要的生长路径**：写教程时引用 → 顺手建条（见 [02](02-data-contract.md) §1.2 门槛） |
| `awesome-dsh-plugin.com` 的 `catalog.json` | 4400 条（已核实） | 建条时按 `owner`/`name` 查一次，把 star / 下载量 / 收录日期 / 安装命令**引用**进 `providedBy`（带快照），而不是导入成词条 |
| GitHub topic `dsh-plugin` | 社区声称 ≥ 6000（未独立验证） | **不采集**；写成「资源源」词条告诉读者去哪找 |

判据一句话：**我们从「被用到」出发，而不是从「生态里有什么」出发**。前者产出的是一页页有用的解释，后者产出的是第三份列表。

### 6.3 采集规模小而可控

因为不做插件普查，采集量级从「2600+ 条 + README + 图片」降到「8 个包 + 1 份 catalog 快照 + 5 条启动器」：

- 市场侧按 `updatedAt` 与 manifest 内容哈希**增量**；
- `awesome.json` 每天快照一次，只在建条时被查询，不参与全站构建的膨胀；
- 每轮请求数要**先估**（市场 `1 + 包数`；awesome 1 次；launchers 1 次），超预算就降级为「沿用上轮快照」。

---

## 7. 许可证与署名

**已定**，完整许可表与理由见仓库根的 [`LICENSE`](../LICENSE)（以它为准）：

| 对象 | 许可证 | 理由 |
| --- | --- | --- |
| 站点代码（`web/`、`scripts/`） | CC0 1.0 | 与 `dsh-pack-market/web/LICENSE` 一致；下游零摩擦 |
| 词条正文（`data/<kind>/*.md` 的 Markdown 正文） | CC BY-SA 4.0 | 正文是唯一的原创资产：署名 + 相同方式共享，防止被静默搬走再商业化 |
| **结构化数据与构建产物**（`data/registry.yml`、`data/taxonomy.yml`、`data/sources.yml`、`data/entities.yml`、`data/zones/**`、`collected/**`、`web/data/**`） | **CC0 1.0** | 这些要被下游机器消费（市场、启动器、第三方工具）。若套分享-alike，会给出「能不能直接吃这份 JSON」的法律不确定性 |
| 设计文档（`docs/**`） | CC0 1.0 | 让别人能直接拿走改造成自己的百科 |
| 采集的第三方 README / 图片 | **不整篇复制**，只做「摘要 + 出处链接」 | 上游仓库许可证各异，整篇复制会造成许可证冲突 |

**不使用带 NC 的许可**（参照物 MC百科用 BY-NC-SA 3.0）：NC 会让商业化的客户端无法合法消费本站数据，站点会变成数据孤岛，与 DSH 生态「数据可被下游机器消费」的方向冲突。

页脚只做**自愿鸣谢 + 外链**（awesome、dshbase、市场、规范仓库），**不写任何具体协议名**——市场页脚写「awesome-dsh-plugin.com（CC0 1.0）」，而该站 README 自述 **MIT**（见 [04](04-mcmod-reference.md) §7.3），照抄会把一个可能错误的许可证声明传播下去。同时把这条不一致回报给 `dsh-pack-market`。

另外：百科的视觉系统**不再复用市场的「纸墨朱砂」**（见 [08](08-visual-system.md)），所以市场那条「设计灵感源自 awesome-dsh-plugin.com」的署名义务**不适用于百科**；鸣谢是自愿的，不是许可要求。

---

## 8. CI 与部署

| workflow | 触发 | 步骤 | 失败行为 |
| --- | --- | --- | --- |
| `ci.yml` | PR（改 `data/**`、`web/**`、`scripts/**`） | `validate.mjs` → `build.mjs`（干跑，不写 `web/data`） | 校验失败即红色，PR 不可合并；**不**自动往 PR 分支提交产物 |
| `deploy.yml` | 每 6 小时定时（与市场错开，避开同一时刻抓 GitHub） / push `main` / 手动 | `collect.mjs`（失败不致命，沿用上轮）→ `build.mjs` → 上传 `web/` 到托管方（Cloudflare Pages action / `wrangler`；备选 Vercel、Netlify） | 采集失败仍部署上轮数据；构建失败则不部署（宁可站点停在上一版） |

采集与部署合在同一个 workflow，沿用市场的理由：默认 `GITHUB_TOKEN` 推回 `main` 的 push 不会再次触发其它 workflow，拆成两个 workflow 会导致「采集完了但没部署」。

**域名**：2026-10-02 起绑自定义域 `dshbaike.com`（在阿里云解析，指向 GitHub Pages 的 A / AAAA 记录）。
绑域后站点从**项目子路径**变成**根路径**，构建期的 `--base` 也随之从 `/dshbaike/` 改为无（见 `pages.yml` 顶部注释）。

**为什么现在用 GitHub Pages**：仓库已转为**公开**（2026-10-02），组织 free 计划下 Pages 对公开仓免费开放，于是**零外部账号、零 secrets** 就能发布——`.github/workflows/pages.yml` 校验通过后构建 `web/` 并发布到 `https://dsh-packforge.github.io/dshbaike/`。注意项目站是**子路径**部署，构建期必须传 `--base=/dshbaike/`（见 §5.1）。

**什么时候换 Cloudflare Pages**：想挂自定义域 `dshbaike.com` 到**根路径**时（省掉 `/dshbaike/` 前缀），或者需要 Cloudflare Access 那种「非公开预览」。两者都支持从同一份产物构建，所以切换不需要改数据与链接结构。

**采集产物要不要提交回 `main`**：要。`collected/**` 入库是「市场挂了也能构建」的前提。但如果只有 `collected/` 变化、`data/` 没变，仍应提交（词条页上的快照时间会更新），这一点与市场「索引无变化就跳过提交」不同——需要显式确认是否接受这种周期性提交。**待确认项**（见 §10）。

---

## 9. 本地开发

```bash
node scripts/collect.mjs         # 可选：需要网络与 GH_TOKEN（读公开仓库可只读匿名限流）
node scripts/build.mjs           # 离线构建到 web/data/
node scripts/validate.mjs        # 校验词条
node scripts/dev-server.mjs      # 零依赖静态服务器：http://127.0.0.1:8811/（只读 web/，不做构建）
npx serve web                    # 或任意静态服务器；也可直接开 web/index.html 看演示数据
```

取舍说明：

- **不引第三方 npm 包**：Markdown 渲染、front-matter 解析、检索索引都自己写最小实现（市场的 `market.js` 已经有一个无依赖 Markdown 渲染器可以直接搬进 `scripts/lib/`）。理由：CI 快、供应链风险为零、与生态「零外部依赖」的取向一致。
- **不引静态站点生成器**（VitePress / Docusaurus / Astro）：它们的模型是「Markdown → 文档站」，而百科需要分区卡片、包成分表、版本兼容矩阵、关系这些结构化视图；**不引 CSS 框架**（Tailwind/Bootstrap）：视觉系统是自己的一套令牌与组件（见 [08](08-visual-system.md)），手写 CSS 变量比框架的默认语言更贴近「索引式 wiki」的密度要求，也避免样式重置带来的返工。

---

## 10. 待确认项

1. **插件收录门槛的松紧**。门槛本身已定（官方来源 / 被教程引用 / 被整合包使用 / 有 maintainer 认领，见 [02](02-data-contract.md) §1.2），待定的是**是否再加一层配额**（例如首版插件词条不超过 30 条），避免一开始就膨胀。
2. **热度数字的引用方式**：awesome 的 `dl`（近 30 天下载量）与 GitHub star 只在建条时抓一次，还是每次构建都刷新？前者省事但会过期，后者每次构建都要打外部网络（破坏「离线可构建」）。倾向：建条时抓 + 页面上显式标注快照日期。
3. **周期性空提交**：`collected/` 定时刷新会产生「只有快照时间变化」的提交，是否接受（见 §8）。若不可接受，改为「快照时间只在被引用的字段变化时才更新」。
4. **词条正文的语言策略**：中文必填、英文可选（见 [02](02-data-contract.md) §8），是否需要英文站点。
5. **许可证口径不一致**：市场页脚称 awesome 站为 CC0 1.0，该站自述 MIT（见 [04](04-mcmod-reference.md) §7.3）。先回报市场修正页脚，百科自身署名不写协议名。
6. **SKILL.md 的 `invocation` 字段**：仓库里真实技能在用，实现侧的字段白名单里却没有（[02](02-data-contract.md) §3.2 已标为冲突），需实机验证一次。
7. **资料（`resource`）二级词条是否在 M3 启动**：它是 MC百科最深的护城河，但需要先验证「从 `cordis.patch.yml` / `dsh.client.inject` 半自动提取资料候选」这条通道是否走得通。
