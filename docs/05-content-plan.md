# 05 · 首版内容计划（词条清单与范围）

> 状态：**设计稿 v2（定位收敛后重写，待评审）**。本文回答「第一批到底写哪几条」，字段定义见 [02](02-data-contract.md)，页面形态见 [01](01-information-architecture.md)。
>
> 定位前提（本版）：**侧重资源整合与教程**。插件词条要做，但**只做「被用到或被认领」的那些**，不追求生态全覆盖（全貌交给 `awesome-dsh-plugin.com` 的 4400 条与 `dshbase.com`）。
>
> 数据口径：整合包与插件名来自对 `dsh-pack-market/index/packs/*/manifest.json` 的全量解析（8 个包）；概念事实来自对 DSH 权威实现副本（`~/.dsh/profiles/node_modules/@deepseek-ai/`，实测 `@deepseek-ai/dsh` = `0.1.0-rc.6`）的核查；外部源数据来自 2026-10-01 的实际抓取。**都是快照，不是实时值。**
>
> ⚠️ **本文表格里的「事实源」列是旧口径**（`external-index` / `curated-list`）：那套「分区优先消费外部源、无源才人工清单」的模型已废弃（理由见 [07](07-multi-source-zones.md) 顶部）。实际落地见 [12](12-m2-kinds.md) 与 [06 §2.0.1](06-zones-and-entries.md)：分区由 `kinds` + 二级分区 `sections` + 条目组成，内容我们自己写，外部数字以「引用 + 快照」出现。**数量目标仍然有效。**

---

## 1. 优先级

| 优先级 | 类型 | 为什么先做 |
| --- | --- | --- |
| **P0** | **分区层（十一个一级分区骨架）** | 主站的一半功能，也是全部流量的入口。界面与客户端 / 插件 / 整合包 / 启动器 / 规范 五个分区可走外部索引或官方形态，其余先各放 1–3 条人工条目；**红链入口是词条增长的主要来源**（见 [06](06-zones-and-entries.md)） |
| **P0** | 教程 | 本版的侧重。自写「别处没有的」，并给外部教程做索引卡（`origin: external`） |
| **P0** | 插件词条 | MC百科 `/class/<n>.html` 的对应物；按门槛收录（被教程引用 / 被整合包使用 / 有人认领），起步十几条 |
| **P1** | 概念 | 百科骨架，也是插件与教程互相链接的落点；走**机制级 + 能指到权威出处**，不写成入门科普 |
| **P1** | 资源源 | 「资源整合」的骨架：一个外部源一页（awesome / dshbase / 市场 / npm / GitHub 话题 / 工具链 / 规范） |
| **P1** | 整合包 | 数据几乎全自动（市场索引 + manifest + 归档），人工只写「适合谁」 |
| **P1** | 启动器 | canonical ID 有权威来源、只有 5 条、零争议 |
| **M3 可选** | 资料（`resource`） | MC百科最深的护城河，但需要先验证半自动提取通道（见 [03](03-directory-and-pipeline.md) §10 第 7 条） |

---

## 1.1 分区层的首版内容

十一个一级分区与数据源策略见 [06](06-zones-and-entries.md) §2。首版各分区的最小内容：

| 分区 | 数据源 | 首版放什么 |
| --- | --- | --- |
| **界面与客户端** | `curated-list` + 官方形态 | 4 条官方形态：官方 Web UI（`dsh web`，等价 `--profile web`）、官方桌面端、`dsh-cli`（无启动器直用命令行）、headless 跑法；第三方桌面端与 TUI 各留 1–2 条占位并标「欢迎补充」。**不拿插件冒充客户端**（边界见 [06](06-zones-and-entries.md) §2.3） |
| 插件 | `external-index`（awesome `catalog.json`） | 顶部**来源区块列四个源**（awesome 4400 / dshbase 7800+ / npm / GitHub topic，见 [07](07-multi-source-zones.md) §1）；条目**默认只展示「有本站词条 + 被整合包使用过」的子集**，并显式外链「看全量去源头」 |
| 整合包 | `external-index`（市场 `index.json`） | 8 条全收，全部指向对应词条 |
| 启动器 | `external-index`（`launchers.json`） | 5 条全收，全部指向对应词条 |
| 主题与皮肤 | `curated-list` | `dsh-myskin`（主题引擎）、`dsh-wallpaper-engine`（壁纸）、图标包 1 条 |
| 技能包 | `curated-list` | `cad-ppt-skills`（含 `autocad-draw` / `pptx-editor`）、`dsh-bcut-edit`、`dsh-simple-drawing`、`publish-to-github` |
| 预设与人设 | `curated-list` | 内置四个（`minimal` / `standard` / `code` / `cordis`）+ 说明「自定义预设随包分发」 |
| **指令与配方** | `curated-list` | 3 条 patch 片段（禁用内置 UI 组件 / 改默认模型 / 换配色令牌）+ 1 份 `AGENTS.md` 模板 |
| 工具链 | `curated-list` | `dsh-packforge-app`（GUI + `dspack` CLI）、市场索引工具、`awesome` / `dshbase`（作为「别人家的工具」也要列，并说明去向） |
| 规范与协议 | `external-index`（规范仓库） | manifest v1–v5、pack-structure v1–v3、index、publishing、launcher-registry |
| 素材与本地化 | `curated-list` | 暂放 1–2 条占位并在页面上说明「欢迎贡献」，不硬凑 |

> 「指令与配方」是 DSH 独有、外部源完全没有收录的一类（见 [06](06-zones-and-entries.md) §7 想法 3）。它体量小、可复制粘贴、极高频，是首版最值得投入的差异点之一。

---

## 2. 教程（P0）

### 2.1 自写（`origin: original`，7 篇）

选的都是「别处查不到、且能被词条挂住」的题。**入门向内容不写**——`dshbase.com` 已经占住「DSH 是什么、怎么装、怎么排错」。

| # | 标题 | 读者 | 为什么是我们写 |
| --- | --- | --- | --- |
| 1 | 为什么 DSH 升级后插件会失效 | 所有用户 | 直通 `dsh-loader` 与 patch 层概念；README 不会解释机制 |
| 2 | 写一个 DSH 插件（bundle 声明 + patch 层） | 开发者 | 涉及 `package.json` 的 `dsh.bundle.patch`、双半端与 `cordis.patch.yml` 的确切语义 |
| 3 | 装插件时到底发生了什么 | 所有用户 | 依赖树 / 落盘路径 / `allowBuilds` / slot 占用——「装了它会怎样」的结构化解释 |
| 4 | 用 `dspack` 打包并发布整合包 | 包作者 | 有现成的 [发布教程](https://github.com/DSH-PackForge/DSH-PackForge/blob/main/docs/publishing-tutorial.md) 可据以改写并与词条互链 |
| 5 | 怎么读一个整合包的成分表 | 普通用户 | 教读者用我们的包成分表视图：层栈 → 坐标钉死版本 → patch 改了什么 |
| 6 | 技能怎么写（`SKILL.md` 契约） | 技能作者 | `whenToUse` / `disable-model-invocation` 的字段坑与「技能存在但没生效」 |
| 7 | 整合包作者的兼容性声明怎么写 | 包作者 | `dshVersions` 为什么是枚举不是 range；`launchers` 的简式与全式 |

### 2.2 外部教程索引卡（`origin: external`，首批 5 张）

不是转载，也不是链接清单：一张卡 = 结构化元信息（原站 / 作者 / 语言 / 复查日期）+ **我们写的适用性判断**（`verdict`：适合谁、哪里会过时、我们补充了什么）。

首批目标（由人工登记，不爬站）：

| 来源 | 选什么 | 我们的判断要写什么 |
| --- | --- | --- |
| `dshbase.com` | 入门与排错类教程 | 哪几篇适合先读、哪些结论随版本失效 |
| `awesome-dsh-plugin.com` | 安装与构建授权说明（`allowBuilds`、`ERR_PNPM_*`） | 它讲的是操作，我们补「为什么会这样」并链到概念词条 |
| 各插件仓库 README | 值得单独成篇的长文（如 22 个工具的桌面操控） | 摘要 + 风险提示 + 与本站教程的互补关系 |
| DSH 官方文档 / 规范仓库 | `publishing/v1.md`、`pack-structure/v3.md` | 规范是权威事实源，教程只写「怎么照着做」 |

> 边界纪律：**外部教程的正文不进我们的仓库**。卡片可以引用关键片段（注明出处），但不整篇复制——上游许可各异，且这正是 awesome 详情页在做的事。

---

## 3. 插件词条（P0，按门槛收录）

### 3.1 门槛与起步清单

收录门槛（[02](02-data-contract.md) §1.2）：被本站教程引用 / 被至少一个已收录整合包使用 / 有 maintainer 认领。三条里满足任意一条即可。

**第一批 12 条**（4 条已登记的 + 8 条按「被最多包使用」挑）：

| 词条 | 依据（门槛） | 备注 |
| --- | --- | --- |
| `dsh-loader` | 已登记（市场精选）+ 教程①引用 | 兼容层，教程①的主角 |
| `dsh-packforge-app` | 已登记 | 图形客户端 + `dspack` CLI |
| `dsh-pack-plugin` | 已登记 + 被 2 个包使用 | 整合包管理 |
| `dsh-wallpaper-engine` | 已登记 | 外观类，示例「含 Web UI 的插件」 |
| `dsh-context` | 被 2 个包使用 | 上下文洞察 |
| `dsh-computer-use-win` | 被 1 个包使用 + 教程③引用 | 22 个工具、安全护栏——风险提示的样板 |
| `@linxin666/dsh-client-ui-task-board` | 被 1 个包使用 | 客户端 UI 类样板 |
| `dsh-smooth-stream` | 被 1 个包使用 | 流式输出 |
| `dsh-myskin` | 被 1 个包使用 | 主题类，patch 层配置大户 |
| `dsh-whale-girl-pet` / `dsh-plugin-whale-pet` | 被 1 个包使用 | 桌宠，两类来源各一 |
| `dsh-wildmon` | 被 1 个包使用 | 同一实体两种坐标写法（`dsh-wildmon` 与 `github:swaylq/dsh-wildmon`），`sources.yml` 的样板 |
| `dsh-better-sidebar-loader` | 被 1 个包使用 | 前置/加载器类，关系与门槛的样板 |

### 3.2 候选池（先登记、后决定）

对 8 个包的 manifest 做全量解析，共得 **27 个坐标 / 26 个不同包名**（多出的一个是同一实体的两种写法）。完整清单：

```
@deepseek-ai/dsh-base(8)              @deepseek-ai/dsh-web-app(8)
@deepseek-ai/dsh-experimental-auto-review(1)  @dsh-packforge/dsh-pack-plugin(2)
@dsh-plugin/dsh-loader(1)             @dsh-plugin/dsh-better-sidebar-loader(1)
@goodandready/dsh-context-lens(1)     @hellosz/dsh-pets(1)
@linxin666/dsh-client-ui-git-graph(1) @linxin666/dsh-client-ui-task-board(1)
@michengai/dsh-btw(1)                 @michengai/dsh-code-review(1)
@michengai/dsh-codex-ui(1)            @michengai/dsh-simplify(1)
dsh-bottom-info-bar(1)                dsh-computer-use-win(1)
dsh-context(2)                        dsh-cost-meter(1)
dsh-effort-slider(1)                  dsh-myskin(1)
dsh-plugin-marketplace(1)             dsh-plugin-model-proxy(1)
dsh-plugin-whale-pet(1)               dsh-smooth-stream(1)
dsh-whale-girl-pet(1)                 dsh-wildmon(1) / github:swaylq/dsh-wildmon(1)
```

（括号内是「被几个整合包使用」。）

三个必须处理的工程问题：

1. **npm 包名 ≠ GitHub 仓库**：清单里绝大多数是 npm 名（含 scope）。`data/sources.yml` 要承担映射；映射不到的插件词条只能给 npm 名与 `dsh plugin add <npm>` 命令，并在页面上标「仓库归属待核」——**不猜**。
2. **官方包与第三方分开**：`@deepseek-ai/*` 是 DSH 本体的一部分（基座、Web 应用、实验包），混进插件词条会让分类失真。建议它们走**概念/本体词条**，或单列 taxonomy `ecosystem.official`。
3. **热度数字引用外部源**：建条时从 `awesome-dsh-plugin.com` 的 `catalog.json` 抓一次 star / 下载量 / 收录日期，写进 `providedBy` 并标快照日期；页面显示「引用自 awesome」。

---

## 4. 概念词条（P1，16 条）

每条都要能指到权威出处（`spec`），这是概念词条与「随手写的博客」的区别。

| # | 词条 | 一句话 | 出处方向 |
| --- | --- | --- | --- |
| 1 | Cordis | DSH 的插件框架，是在上游 Cordis 基础上 **vendored** 的元框架，非 DeepSeek 原创 | `@deepseek-ai/cordis`（4.0.1，author Shigma，`directory: vendor/cordis`） |
| 2 | plugin bundle | 插件以 npm 包分发，用 `package.json` 的 `dsh.bundle.patch` 声明自己带的补丁层 | `dsh-app-boot` 的 bundle 声明解析 |
| 3 | patch 层 | 层序：bundle（按 `dsh.profile.bundles` 顺序）→ profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` → telemetry；`config` 是**整段替换**不是深合并 | `profile-boot` 的层序装配 |
| 4 | profile | 一套可切换的插件层栈，落在 `$DSH_HOME/profiles/<name>`；`--profile` 必填，`dsh web` 只是别名 | profile 目录布局与 CLI 定义 |
| 5 | `$DSH_HOME` | 用户数据根：优先级「显式配置 > `$DSH_HOME` > `~/.dsh`」；内含 `settings.yaml`、`skills/`、`.agent-presets/`、`sessions/`、`storages/` | `dsh-home-paths` |
| 6 | slot（插槽） | 客户端 UI 的挂载点：预置唯一根槽 `root`，四种 kind（`single` / `keyed` / `list` / `chain`），槽名点分命名；**优先级数值越小越优先** | `dsh-client-ui-slots` |
| 7 | skill（技能） | `SKILL.md` + front-matter，按**六个发现根**分级（rank 小者优先），模型通过 `skill` 工具调用 | skill 发现与校验实现 |
| 8 | agent preset | `.agent-presets/<id>/` 内的 `agent.cordis.yml`（必需）+ `preset.yml`（仅显示）；内置 `minimal` / `standard` / `code` / `cordis`；**先出现的根赢同名 id** | preset 加载与 id 校验 |
| 9 | workspace | 对一个**已存在目录**的持久注册（不是 `.dsh` 项目目录），记录 path / title / sessionIds | `storages/workspace.json` |
| 10 | session | 会话：`sessions/<cwd 转义目录>/<uuid>/session.jsonl.zstd`，header 带 `parentSession` / `seedLength`；fork 是复制事件日志到某个 `seq` 边界 | 会话存储实现 |
| 11 | 权限三档 | `read-only` / `workspace-write` / `danger-full-access` | `dsh-base` 默认配置 |
| 12 | client 半端 | `package.json` 的 `dsh.client` 声明 + 产物 `lib/client.js`，经 `/client.js` 路由注入；`window.__DSH_BOOT__` 是入口图 | client bundle 路由与注入 |
| 13 | manifest v5 | 清单契约：`type` 分 `profile` / `dshhome`，`bundles` + `dependencies` 钉死版本 | [`specs/manifest/v5.md`](https://github.com/DSH-PackForge/DSH-PackForge/blob/main/specs/manifest/v5.md) |
| 14 | `.dspack` 与安装 | ZIP 容器 + `dspack.json` + `overrides/` + 可选 `home/`；安装 = 落盘 + `pnpm install` + `reconcileProfile` | [`specs/pack-structure/v3.md`](https://github.com/DSH-PackForge/DSH-PackForge/blob/main/specs/pack-structure/v3.md) |
| 15 | 产品与版本号辨析 | `@deepseek-ai/dsh`（本体，实测 `0.1.0-rc.6`）≠ `dsh-versions` 启动器（`0.1.13`）≠ Electron（`44.0.0`） | 各 `package.json` / `version` 文件 |
| 16 | 作用域与隔离 | preset 的 `isolate` 组如何把工具/提示段限定在某个 agent 内（`cordis:group` + `isolate`） | `dsh-agent-presets` 与内置 preset 样例 |

> 还有一批**代码里查不到、必须人工撰写**的概念（约 8 条）分三类：**术语与译名统一**（entry / row / layer / tree / slot 的官方中文说法）、**设计动机**（为什么选可 patch 的插件树、为什么 `$DSH_HOME/cordis.patch.yml` 高于 per-profile 层、双半端的取舍）、**最佳实践**（何时该 patch 而不是新写 bundle、`config` 整段替换的坑、权限三档的使用建议、fork 边界的选取）。这是百科「解释」价值的最高点，正式排期时单独列一类。

---

## 5. 资源源（P1，7 条）

「资源整合」的骨架：一个外部源一页，写清它收录什么、提供哪些字段、与我们的关系、怎么用与怎么投稿。

| 资源源 | sourceKind | 已核实事实 | 我们写什么 |
| --- | --- | --- | --- |
| `awesome-dsh-plugin.com` | `plugin-directory` | 4400 条、24 分类、中英双语、有详情页（约 8800 URL）、`catalog.json` 字段 `cat`/`stars`/`dl`/`npm`/`cmd`/`href`、投稿走 PR + `dsh-plugin` topic | 插件发现的首选去处；我们的插件词条从它引用热度数字 |
| `dshbase.com` | `guide` | 自我定位「中文指南、教程与插件生态」，含教程、场景包、皮肤、审计、排错 | 入门与排错的首选去处；也是我们教程索引卡的主要来源 |
| `dsh-pack-market` | `market` | 8 个包、索引 schemaVersion 2、懒加载 manifest、下载量口径 | 整合包分发的唯一去处；我们读它的索引 |
| npm registry | `registry` | 大量插件以 npm 包名分发（实测各包 `bundles` 绝大多数是 npm 名） | 讲清 npm 名与 GitHub 仓库的关系，这是最容易混淆的一点 |
| GitHub topic `dsh-plugin` | `topic` | 社区声称 ≥ 6000 个仓库（引用方自述、未独立验证） | 只做「去哪发现」的介绍，不做扫描 |
| `dsh-packforge-app` | `tool` | Electron GUI + `dspack` CLI；`inspectPack()` / `summarizeHome()` 是现成解析器 | 打包、安装与「包成分表」的数据来源 |
| DSH 规范仓库 | `spec` | manifest v1–v5、pack-structure v1–v3、index、publishing、launcher-registry | 一切字段争议的最终裁判；概念词条的 `spec` 多指向它 |

---

## 6. 整合包词条（P1，8 条）

| marketId | 版本 | manifest | DSH 版本 | bundle | 依赖 | 作者 |
| --- | --- | --- | --- | --- | --- | --- |
| `hxh230802.smoother-deepseek-harness` | 1.0.3 | v5 / profile | 未声明 | 9 | 7 | HXH |
| `yukitakasama.better-deepseek-harness-codex` | 2.0.0 | v5 / profile | 0.2.0-rc.2（`dshVersions` 2 项） | 12 | 10 | yukitakasama |
| `1900992335.desktop-pack` | 1.0.0 | v5 / profile | 0.2.0-rc.2 | 7 | 4 | 1900992335 |
| `LQH-A-A-O.dsh-simple-drawing` | 1.1.0 | v5 / profile | 未声明 | 2 | 0 | 涟崎桦 |
| `LQH-A-A-O.dsh-bcut-edit` | 1.0.0 | v5 / profile | 未声明 | 2 | 0 | 涟崎桦 |
| `LQH-A-A-O.cad-ppt-skills` | 1.1.0 | v5 / profile | 未声明 | 2 | 0 | 涟崎桦 |
| `hxh230802.pokemon` | 1.0.0 | v5 / profile | 0.1.5-alpha.2 | 4 | 2 | HXH |
| `hxh230802.better-sidebar` | 1.0.0 | v4 / profile | 未声明 | 4 | 2 | HXH |

写词条时要正面呈现三件生态实况：

- **`dshVersion` 普遍缺省**（8 个包有 4 个是空字符串）→ 词条写「作者未声明」，**不替作者推断**；
- **`type` 全是 `profile`**（0 个 dshhome 真实样本）→ 包成分表的技能/预设格子需解包才能填，页面要说明；
- **`manifestVersion` 有 v4 混用** → 词条要能显示「本包仍在用 v4」。

---

## 7. 启动器词条（P1，5 条）

| canonical ID | 名称 | 定位 |
| --- | --- | --- |
| `dshl` | DSHL · DeepSeek Harness Launcher | PCL2 魔改，Windows 一站式，四段式版本自报 |
| `hdsl` | HDSL · Hello DeepSeek Launcher | HMCL 内核 JavaFX；`.dspack` 市场采纳者，另维护自有 `.hdslp` |
| `dsh-packforge-app` | DSH PackForge GUI / `dspack` CLI | 官方工具链 |
| `official-desktop` | DeepSeek Harness 官方桌面端 | 官方 |
| `dsh-cli` | 裸 `dsh` 命令行 | 无启动器 |

必须点明：**`dshl` 与 `hdsl` 只差一个字母、完全无关**（前者 PCL 系、后者 HMCL 系）。这句提醒在规范里就有，正是词条该替读者挡住的混淆。

---

## 8. 首版不写的

| 不写 | 理由 |
| --- | --- |
| 插件全量收录 | 交给 awesome（4400 条）与 dshbase；我们只收「被用到或有人认领」的 |
| 技能、预设的独立词条 | 随包分发或本机安装态，单独成页与整合包词条重复；写进教程与包成分 |
| 资料（`resource`）二级词条 | M3 可选，先验证半自动提取通道（[03](03-directory-and-pipeline.md) §10 第 7 条） |
| 「DSH 是什么 / 怎么装」类入门教程 | `dshbase.com` 已占住 |
| 站内下载与授权体系 | 分发由 GitHub Release / npm / `.dspack` 侧车承担 |

---

## 9. 数量目标

| 里程碑 | 词条数 | 构成 |
| --- | --- | --- |
| M1 | 12 | 教程 3 + 插件 3 + 概念 4 + 资源源 2 |
| M2 | 50+ | 教程 12（自写 7 + 外部卡 5）+ 插件 12 + 概念 16 + 资源源 7 + 整合包 8 + 启动器 5 |
| M3 | 55 + 资料（可选） | 资料先从 `dsh-computer-use-win`（22 个工具）与 `dsh-pack-plugin` 试点 |
| M4 | 持续 | 靠「写教程时顺手引用插件 → 顺手建条」这条路径生长 |
