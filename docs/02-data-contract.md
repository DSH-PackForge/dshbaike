# 02 · 数据契约（词条 schema / 编号 / 分类 / 索引）

> 状态：**设计稿 v2（定位收敛后重写，待评审）**。
>
> 本版相对 v1 的关键变化：**不再收录插件词条**（改为教程与包成分里的「插件引用块」+ 外链外部源）、**词条 id 改为 MC百科式的自增数字**、**新增「资源源」词条类型**以承载资源整合。页面形态见 [01](01-information-architecture.md)，工程形态见 [03](03-directory-and-pipeline.md)。

依据的既有契约：`DSH-PackForge/specs/manifest/v5.md`、`specs/index/index.md`（`index.json` schemaVersion 2）、`specs/pack-structure/v3.md`、`specs/launcher-registry.md`，以及外部源 `awesome-dsh-plugin.com` 的 `catalog.json`。

---

## 1. 词条模型：十四类，各自独立编号

**一个分区一种类型** + 三个跨分区类型（扩展设计见 [12](12-m2-kinds.md)）。分区类型与
`data/zones/*.yml` 的 `kinds:` 声明一一对应，校验规则 24 保证「一种类型恰好属于一个分区」。

### 1.1 分区类型（十一种）

| kind | 文件位置 | URL | 归属分区 | 事实源 |
| --- | --- | --- | --- | --- |
| `client` | `data/client/<n>.md` | `/client/<n>.html` | `clients` 界面与客户端 | 人工（`form` 区分桌面/终端/浏览器） |
| `launcher` | `data/launcher/<n>.md` | `/launcher/<n>.html` | `launchers` 启动器 | 人工 + 采集（`launchers.json` 认领表） |
| `plugin` | `data/plugin/<n>.md` | `/plugin/<n>.html` | `plugins` 插件 | 人工撰写 + **外部源聚合**（awesome / npm / GitHub / dshbase），不自建全量登记 |
| `theme` | `data/theme/<n>.md` | `/theme/<n>.html` | `themes` 主题与皮肤 | 人工（`targets` 说明改了界面哪几部分） |
| `asset` | `data/asset/<n>.md` | `/asset/<n>.html` | `assets` 素材与本地化 | 人工（`assetType`：字体/图标/壁纸/文案） |
| `skill` | `data/skill/<n>.md` | `/skill/<n>.html` | `skills` 技能包 | 人工（`roots` 说明在哪个发现根生效） |
| `preset` | `data/preset/<n>.md` | `/preset/<n>.html` | `presets` 预设与人设 | 人工（`presetKind` + `files`） |
| `recipe` | `data/recipe/<n>.md` | `/recipe/<n>.html` | `recipes` 指令与配方 | 人工（`snippet` 可直接粘贴的最小片段） |
| `pack` | `data/pack/<n>.md` | `/pack/<n>.html` | `packs` 整合包 | 人工 + 采集（市场 manifest / stats） |
| `tool` | `data/tool/<n>.md` | `/tool/<n>.html` | `toolchain` 工具链 | 人工（共同点是「在 DSH 之外运行」） |
| `spec` | `data/spec/<n>.md` | `/spec/<n>.html` | `specs` 规范与协议 | 人工（指向规范仓库的文件；**有争议时以它为准**） |

### 1.2 跨分区类型（三种）

| kind | 文件位置 | URL | MC百科对应物 | 事实源 |
| --- | --- | --- | --- | --- |
| `concept` | `data/concept/<n>.md` | `/concept/<n>.html` | 游戏机制 / 概念页 | 人工（须指到权威出处） |
| `tutorial` | `data/tutorial/<n>.md` | `/tutorial/<n>.html` | 教程 `/post/<n>.html` | 人工（原创 + 外部聚合） |
| `source` | `data/source/<n>.md` | `/source/<n>.html` | （无对应物） | 人工 + 采集（外部站） |

**跨分区三种不绑分区**：概念与教程是「读的东西」，不属于任何一层；一条源本身覆盖多个分区（用 `zones:` 声明它覆盖谁），所以也不属于任何一层。

**「资源源」（`source`）是「资源整合」这个定位的落点**：一个外部资源站/渠道一页，写清它收录什么、提供哪些字段、收录量、许可、与我们的互补关系、怎么投稿与怎么用它。首批候选：`awesome-dsh-plugin.com`、`dshbase.com`、`dsh-pack-market`、npm registry、GitHub topic `dsh-plugin`、`dsh-packforge-app`、DSH 官方仓库与规范仓库。

> **为什么「一个分区一种类型」**：在此之前只有六类词条，而分区有十二个——主题、技能、预设、配方、客户端、素材、工具链、规范这八类东西**连发号的地方都没有**，所以那些分区永远只有外链卡片、长不出百科详情。类型一旦发号就永久（`docs/02 §2`），所以这次扩展先冻结契约（[12](12-m2-kinds.md)）再写内容。

### 1.1 插件词条做，但**不做插件全量收录**

这两件事必须分开，是本版定位的要点：

| 做 | 不做 |
| --- | --- |
| **插件词条页**：一页聚合多源事实（外部源指针、star/下载量引用、安装命令）+ 人工写的定位/用途、关系、兼容性、坑，并挂上引用它的教程与使用它的整合包 | **插件全量普查**：不去扫 `dsh-plugin` 话题（声称 6000+）、不批量抓 `package.json` / README 落库、不做第三份插件登记表 |
| 按「被用到」生长：教程引用过、或已被收录整合包使用过、或有人认领 | 追求「生态里有多少插件就有多少词条」——生态全貌交给 `awesome-dsh-plugin.com`（4400 条）与 `dshbase.com` |

其余类型的取舍同样按「是否与既有源重复」判断：

| 不做词条 | 理由 |
| --- | --- |
| 技能、预设的独立词条 | 它们的分布形态是「随包分发」或「本机安装态」，单独成页会与整合包词条重复；写进教程与包成分即可 |
| 资料（`resource`）二级词条 | MC百科最深的护城河，但它的 39 : 1 靠从 Mod 代码批量导出，DSH 插件没有这条通道。**列为 M3 可选机制**：先在插件词条里做「这个插件提供什么」的分块，等验证了半自动提取再决定是否升级为独立词条 |

### 1.2 插件收录门槛（谁配得上一页）

满足**任意一条**即可建词条，不满足的只在教程里以引用块出现：

1. **官方来源**（`repo` 的 owner 或 `npm` 的 scope 是官方组织，如 `deepseek-ai`）——
   本体就是插件的产地，它天然配得上插件区的一页；这一格**客观可核实**，不需要谁来认领；
2. **被至少一篇本站教程引用**（`plugins[].why` 非空）——有机生长，最主要来源；
3. **被至少一个已收录整合包使用**——可从市场 manifest 的 `bundles` / `dependencies` 反查生成候选（实测 8 个包 → 26 个不同包名）；
4. **有维护者认领**（`maintainers` 非空）并说明为什么值得单独一页。

门槛由 `validate.mjs` 检查（第 15 条规则）：不满足任一条件的插件词条会被拒绝，避免词条库退化成第二个 awesome 列表。

> 第 1 条是后补的（2026-10-02）：官方本体条目（插件区第一条）此前**四条都不满足**——
> 它不是第三方插件、没被教程引用、整合包的 `bundles` 写的是官方包名而词条里没有对应坐标、
> 也没人认领。缺这一格的真实后果不是「官方条目收不进来」，而是有人为了让校验通过
> **编一个门槛**（我第一版就写了 `pack`，被规则当场拦下）。

---

### 1.3 分区不是词条（不编号）

主站的另一半是**分区层**（资源整合，见 [06](06-zones-and-entries.md)）。它不进 registry、不编号、不渲染正文，数据放在 `data/zones/<zone>.yml`：

```yaml
zone: themes
title: 主题与皮肤
desc: 换掉 DSH 的样子：主题引擎、配色令牌、壁纸与图标包。      # 一句话定义，必填
howto: 装法与落点随类型不同，见每个条目的说明。                # 顶部「怎么用」，必填
kinds: [theme]                                                 # 这个分区收哪种词条（docs/12）
sections:                                                      # 二级分区（docs/06 §2.0.1）
  - id: packs
    title: 主题包
    desc: 换出来的一整套外观
  - id: loaders
    title: 主题加载器
    desc: 把它加载进界面的那个机制或插件
itemFields: [form, shippedBy, profile, platforms]              # 专属字段白名单（通用字段之外只允许这些）
items:
  - name: dsh-myskin
    section: packs                                             # 归到哪个二级分区
    blurb: 主题引擎一类的实现，换配色与外观。
    form: web                                                  # web | desktop | tui | headless | cli
    shippedBy: third-party                                     # official | third-party | launcher
    links: { github: "deepseek-ai/deepseek-harness" }
    entry: theme/1                         # 可选：本站词条；留空即渲染成红链「写这一条」
    tags: [主题与外观, UI 增强]
    risk: [build-script]                   # 可选：desktop-control | network | credentials | build-script
```

**`risk` 四个取值是什么意思**（卡片上渲染成 `⚠ 桌面操控` 这类徽章；悬停与读屏给出同一句话）：

| 值 | 徽章 | 含义 |
| --- | --- | --- |
| `desktop-control` | 桌面操控 | 装在系统里的**原生程序**，不是沙箱网页：等于把用户权限交给它（读写文件、起进程、装东西），系统权限模型拦不住 |
| `network` | 网络访问 | 会联网下载包与更新、拉远程清单；它装回来的东西本站无法预先核实 |
| `credentials` | 凭据 | 会接触登录凭据 / token |
| `build-script` | 构建脚本 | 安装时会执行仓库里的构建脚本（pnpm 默认拦截，要手动 `allowBuilds` 放行） |

> ⚠️ **当前站点不渲染风险徽章**（2026-10-02 评审决定隐藏：先在标题行挤得标题换行，
> 挪到卡片右栏后仍不需要）。**数据与词典都保留**——`risk:` 字段照写、校验照查、
> `RISK_NOTE` 的解释也还在；恢复渲染只需把 `web/pedia.js` 里的 `SHOW_RISK_BADGES` 改成 `true`。

打徽章的纪律：**只标这条东西确实具备的能力**，不替读者做决定、也不写成免责声明——
一句话说清「它能做什么」就够（[08](08-visual-system.md) §8.3 解释了为什么全站只留一句总声明）。

规则：

1. 条目必填 `name` / `blurb` / `links`（至少一个链接）；**宁缺毋滥**，一条冗余条目比没有更糟。
2. `entry` 指向的词条必须存在（校验 error）；**红链由「没有 `entry`」自然表达**，不需要额外的红链数据结构。
3. **分区页的内容由我们自己写**：`sections` 分组 + 条目（有的指向本站词条，有的是外链入口）。
   外部源的数字以「引用 + 快照」的形式写进二级分区的 `intro` 综述里（样板见插件分区的「插件市场」）。
   > 早先这里是「`dataSource` 为 awesome / market / launchers 的分区，items 由采集生成」——
   > 那套「分区优先消费外部源」的模型已废弃，见 [07](07-multi-source-zones.md) 顶部的说明。
4. **分区层不追求完整**：目标是「找到入口」，不是「穷举生态」。想做全量的冲动应该转成外链。
5. **分区专属字段走 `itemFields` 白名单**；条目出现白名单外的键即 error——防止条目变成随手塞字段的垃圾袋。
   通用卡片键（含 `section`）不必声明进 `itemFields`。
6. **同一个实体可以同时挂在多个分区**。数据只有一份，靠 `entities.yml` 归并；分区页各自渲染一次卡片。分区的划分与生成规则见 [06](06-zones-and-entries.md) §2。

### 1.4 实体归并：多源同物只出现一次（`data/entities.yml`）

一个分区里往往有好几个做同一件事的源（插件分区已知四个），同一个插件可能在多个源里都有条目。归并靠**键**，不靠名字：

```yaml
version: 1
entities:
  - id: plugin/12                        # 已建词条指向词条，未建用 external:<slug>
    keys: ["repo:DSH-PackForge/dsh-pack-plugin", "npm:@dsh-packforge/dsh-pack-plugin"]
    refs:                                # 采集生成，人工不手改
      - source: awesome
        url: https://awesome-dsh-plugin.com/zh/p/DSH-PackForge/dsh-pack-plugin/
        at: 2026-10-01
        fields: { stars: 5159, downloads30d: 464583 }
```

三条铁律：**① 只有 `repo:` / `npm:` 这类键精确匹配才自动归并，名字相似一律不合并**（错并比漏并伤信任）；**② 一个键只能属于一个实体**；**③ 字段冲突照实并列**（`star 5159（awesome）· 最新 0.3.5（npm）`），不取平均、不挑一个。完整机制见 [07](07-multi-source-zones.md) §4。

---

## 2. 编号契约：自增数字、永不复用

MC百科的链接不会烂，靠的是数字即身份。我们照抄这一点：

> **一次例外，已发生（2026-10-02，两步）**：
>
> ① **插件区编号重置**——官方插件（deepseek-harness 仓库）插到 `plugin/1`，原 `plugin/1` dsh-loader 让到 `plugin/3`，
> 原 `plugin/3` dsh-packforge-app 让到 `plugin/4`（`plugin/2` dsh-pack-plugin 不动）；
> ② 随后**取消两条插件词条**——`dsh-loader`（第三方升级兼容层：保留分区卡片与教程里的提及，只是不再有独立词条）
> 与 `dsh-packforge-app`（**它不是插件**：GUI + dspack CLI，已由 `tool/1`、启动器登记表与工具链分区覆盖）。
> 计数器退回 `plugin: 2`，3 / 4 两个号码释放。当时站点尚未对外、没有外部链接指向这些编号，
> 所以**直接改号、不建墓碑**（评审：这次不需要墓碑机制）。
>
> 此后契约严格：**编号一分配就不动，删除留墓碑**（见 §2.1 与规则 4）。

```yaml
# data/registry.yml
version: 1
counters:            # 各 kind 已分配到的最大号
  concept: 16
  tutorial: 5
  pack: 8
  launcher: 5
  source: 4
entries:
  - n: 1
    kind: tutorial
    title: 写一个 DSH 插件
    createdAt: 2026-10-02
  status: published      # published | draft | archived | deleted
  - n: 7
    kind: concept
    title: 已废弃的旧术语
    createdAt: 2026-10-02
    status: deleted        # 墓碑：号保留，永不复用
```

规则：

1. **`id` = 路径里的数字**（`data/tutorial/21.md` → `/tutorial/21.html`），**不写进 front-matter**；写了与 registry 或路径不一致即校验失败。
2. **各 kind 独立计数**（照 MC百科 `/class/`、`/item/`、`/modpack/`、`/post/` 各自编号的做法）。断号不回填、不复用。
3. **删除留墓碑**：`status: deleted` 的词条页仍然存在，显示「本词条已撤下」+ 搜索与指向替代词条，而不是 404。链接不烂是这套编号的**唯一目的**。墓碑**不进搜索索引**、不计入分区与分类计数，但**页面保留**；`registry.yml` 里也保留该条目（`status: deleted`）。
4. **领号必须走脚本**：`node scripts/new.mjs tutorial "写一个 DSH 插件"` → 取下一个空闲号、写 registry、生成 front-matter 骨架。手改 registry 或跳号由 CI 拒绝。
5. 代价要正视：文件名不再自解释。补偿手段是构建期产出 `web/data/registry.json`（数字 → kind / 标题 / 日期 / 状态），供导航、墓碑页与「最近更新」使用。

---

## 3. 词条文件格式

YAML front-matter + Markdown 正文，`---` 分界，正文用中文。

````markdown
---
title: 为什么 DSH 升级后插件会失效
aliases: [插件失效, 升级炸插件, dsh-loader]
category: [plugin.compat]
tags: [兼容性, 升级]
summary: 解释 bundle 挂载与 patch 层的绑定关系，以及为什么升级会打断它。
status: published
maintainers: [dsh-plugins]
updatedAt: 2026-10-02
difficulty: intermediate
prereq: [concept/4, concept/7]
appliesTo: "dsh 0.1.0-rc.6 实测；0.2.x 未核实"
origin: original            # original（自写） | external（外部教程的索引卡）
plugins:                    # 插件引用块，见 §5
  - name: dsh-loader
    npm: "@dsh-plugin/dsh-loader"
    repo: dsh-plugins/dsh-loader
    why: 版本感知的运行时兼容层，升级后不必改插件源码
    install: dsh plugin add github:dsh-plugins/dsh-loader
    compat:
      dsh: ["0.1.0-rc.6"]
      runtime: [cli, desktop, web]
    sources: [awesome, npm, github]
---

## 症状

……
````

### 3.1 公共字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `title` | string | ✅ | 中文标题 |
| `titleEn` | string | 否 | 英文标题 |
| `aliases` | string[] | 否 | 别名/俗称，参与搜索（也承担「拼音/首字母」的替代作用） |
| `category` | string[] | ✅ | taxonomy 叶子节点 id（§4） |
| `tags` | string[] | 否 | 自由标签 |
| `summary` | string | ✅ | 一句话摘要，用于列表与搜索 |
| `status` | enum | ✅ | `draft` \| `published` \| `archived` \| `deleted`（与 registry 的 `status` 必须一致；`archived` = 上游已归档/停止维护，页面挂「已归档」徽标） |
| `maintainers` | string[] | 否 | 维护者 GitHub 用户名 |
| `updatedAt` | string | 否 | 人工核实的日期（`YYYY-MM-DD`） |
| `screenshots` | string[] | 否 | 相对 `data/assets/` 的图片路径 |

### 3.2 按 kind 的专有字段

**`concept`（概念）**——百科的骨架，要求能指到权威出处

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `layer` | enum | `runtime` \| `plugin` \| `agent` \| `workspace` \| `ecosystem` |
| `spec` | string | 权威出处：代码路径（可读实现副本在 `~/.dsh/profiles/node_modules/@deepseek-ai/`）或规范文档 URL |

**`plugin`（插件）**——聚合页，价值在于「外部源没有的那部分」

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `repo` / `npm` | string | 人工 + 采集 | 至少给一个；两个都给最好 |
| `install` | string | 人工 | `dsh plugin …` 形式的安装命令 |
| `role` | enum | 人工 | `bundle`（纯宿主）\| `client`（含 Web UI）\| `bundle+client` \| `theme` \| `compat`（前置/兼容层） |
| `positioning` | string | **人工** | 一句话定位，用生态语境的话说清它解决什么问题（不是照抄上游 description） |
| `relations` | object[] | 人工 | `{ type: requires \| recommends \| conflicts \| replaces \| integrates, target: plugin/<n>, note, since?, until? }`——**这是词条相对外部源的核心增量**：前置与冲突是目录站结构上给不出的信息。`since` / `until` 是**关系适用的 DSH 版本段**（缺失即视为现行）；已 `until` 的关系**标灰保留、不删除**，页面按段分组渲染 |
| `roles` | object[] | 人工 | 参与者与角色：`{ who, role: owner \| maintainer \| contributor \| translator \| upstream, note? }`。`upstream` 用于上游作者（如 Cordis 的作者 Shigma）——把「不是 DeepSeek 原创」这件事写在明面上 |
| `licenseRefs` | object[] | 人工 + 采集 | 许可证条目（可多条，对应 MC百科的「Mod协议」分块）：`{ id, name, url?, note? }`，如「本体 MIT」+「内置图标 CC BY 4.0」 |
| `compat` | object | 人工（可由采集建议） | `dsh`（版本**枚举**，且必须标「实测 / 未核实」）、`runtime`（cli/desktop/web）、`platforms` |
| `providedBy` | object | 采集（**只引用，不落库**） | 外部源事实与快照：`awesome`（stars / dl / added / 详情页 href）、`npm`（latest / publishedAt）、`github`（stars / pushedAt / license / archived）、`dshbase`（是否有中文指南） |
| `usedInPacks` | string[] | 采集 | 反查市场 manifest 的 `bundles` / `dependencies` 得到「出现在哪些整合包」——纯自动，首版就做 |
| `referencedByTutorials` | string[] | 构建期派生 | 提到它的教程（**所有类型都有**）：来源是教程的 `plugins` 引用块**或教程正文里的 `[[]]` 提及**；渲染进右侧「相关」框与「哪些教程用了它」页签。注意它**不影响**插件收录门槛——规则 15 只认 `plugins[].why` 那种刻意引用 |
| `entryGate` | enum | 校验用 | 记录满足的收录门槛：`official` \| `tutorial` \| `pack` \| `maintainer`（见 §1.2） |
| `risk` | enum[] | 风险徽章 | `desktop-control` 桌面操控 / `network` 网络访问 / `credentials` 凭据 / `build-script` 构建脚本。含义见下表 |

> 三个必须遵守的边界：**① 不复制上游正文**（README 整篇搬进词条就退回成 awesome 详情页了，只做摘要 + 出处链接）；**② 热度数字一律引用外部源并标快照时间**，我们不自建统计；**③ 没有采集到的字段显示「未声明」**，不推断。

**`tutorial`（教程）**——自写与外部索引都走同一套 schema

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `difficulty` | enum | `beginner` \| `intermediate` \| `advanced` |
| `prereq` | string[] | 前置词条，形如 `concept/4`、`tutorial/1` |
| `appliesTo` | string | 适用的 DSH / 规范版本，**必须写明是「实测」还是「未核实」** |
| `origin` | enum | `original`（自写正文）\| `external`（外部教程的索引卡） |
| `external` | object | 仅 `origin: external`：`url` / `author` / `site` / `lang` / `reviewedAt` / `verdict`（我们的一句适用性判断） |
| `plugins` | object[] | 插件引用块（§5） |
| `related` | string[] | 相关词条 id |

> `origin: external` 的教程**也必须有正文**，但正文是「这篇教程讲了什么、适合谁、哪里会过时、我们补充了什么」，而不是转载。这既区别于链接清单（awesome 的形态），也不侵犯原作者。

**`pack`（整合包）**

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `marketId` | string | 人工 | 市场 `index.json` 的 `id`（`<owner>.<repo>`），用于反查 |
| `packType` | enum | 采集 | manifest v5 的 `type`：`profile` \| `dshhome` |
| `dshVersion` / `dshVersions` | string / string[] | 采集 | manifest v5 §12 |
| `launchers` | object | 采集 | manifest v5 §13 归一化后的全式形态 |
| `composition` | — | **采集，禁止手写** | 包成分表（层栈 / 依赖 / 技能 / 预设 / 指令 / patch 摘要 / 文件指针） |
| `downloads` | object | 采集 | 市场 `stats.json`；取不到显示「无数据」，**不写 0** |
| `fitFor` | string | **人工** | 这包适合谁（人工判断，是词条相对市场页的增量） |
| `roles` | object[] | 人工 | 同插件词条（作者 / 维护者 / 上游） |
| `licenseRefs` | object[] | 人工 + 采集 | 许可证条目（可多条） |
| `plugins` | object[] | 人工 | 包内值得单独说明的插件引用块（可选，不必穷举） |

**`launcher`（启动器）**

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `launcherId` | string | 采集 | canonical ID：`dshl` / `hdsl` / `dsh-packforge-app` / `official-desktop` / `dsh-cli` |
| `url` / `support` | string | 采集 | 仓库与一句话定位 |
| `platforms` | string[] | 人工 | 支持平台 |
| `supportedManifest` | string[] | 人工 | 支持的 manifest / 包结构版本 |

**`source`（资源源）**——「资源整合」的骨架

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 采集 | 站点或仓库 |
| `zones` | string[] | 人工 | 它覆盖哪些分区（`plugins` / `packs` / `skills`…）——分区页据此自动聚合来源区块 |
| `adapter` | object | 人工 | **抓取配置**：`endpoint` / `format` / `auth` / `fields`（源字段→卡片字段映射）/ `cadence` / `reliability` / `status`。契约见 [07](07-multi-source-zones.md) §3 |
| `sourceKind` | enum | 人工 | `plugin-directory`（插件目录）\| `guide`（中文指南/教程）\| `market`（包市场）\| `registry`（npm 等包注册表）\| `spec`（规范）\| `tool`（工具链）\| `topic`（GitHub 话题） |
| `coverage` | object | 采集 | 收录量 + 快照日期（如 `items: 4400` / `at: 2026-10-01`） |
| `provides` | string[] | 人工 | 它提供哪些字段（如 `cat` / `stars` / `dl` / `cmd`） |
| `license` | string | 采集 | 该源的许可（**口径冲突要标注**，见 [04](04-mcmod-reference.md) §7.3） |
| `relation` | enum | 人工 | `complementary`（互补）\| `overlapping`（重叠）\| `upstream`（上游事实源） |
| `howto` | string | 人工 | 怎么用它 / 怎么向它投稿 |
| `linkOut` | string | 人工 | 我们默认把读者送去哪个 URL |

---

## 4. 分类契约（`data/taxonomy.yml`）

结构同 v1（点分层级、每节点 `label.zh` + `desc` 必填、父节点不可作 `category`、节点只能 `deprecated` 不能删）。分类树是**主题导向**的，不是「一种 kind 一个根」：

| 一级 | 二级 | 收什么 |
| --- | --- | --- |
| `concept` 本体机制 | `concept.runtime` / `concept.plugin` / `concept.agent` / `concept.workspace` / `concept.ecosystem` | 概念词条（与 `layer` 枚举一致） |
| `plugin` 插件与兼容 | `plugin.compat` 前置与兼容 / `plugin.ui` 界面 / `plugin.capability` 能力 / `plugin.data` 数据与记忆 / `plugin.packaging` | 插件词条（**不是**插件目录分类） |
| `pack` 整合包 | `pack.coding` / `pack.media` / `pack.fun` / `pack.general` | 整合包词条 |
| `ops` 运维与排错 | `ops.install` / `ops.upgrade` / `ops.troubleshoot` | 教程 |
| `ecosystem` 生态与分发 | `ecosystem.spec` 规范 / `ecosystem.source` 资源源 / `ecosystem.publish` 发布 | 规范文件、资源源、教程 |
| `meta` 元 | `meta.contributing` | 参与与维护类词条 |
| `interface` 界面与入口 | `interface.desktop` / `interface.tui` / `interface.web` | 客户端词条（M2 新增） |
| `launch` 启动与装载 | `launch.wrapper` / `launch.desktop` / `launch.cli` | 启动器词条（M2 新增；同时补上了 launcher 此前**没有可用叶子**的缺口） |
| `appearance` 外观与素材 | `appearance.theme` / `appearance.asset` / `appearance.locale` | 主题与素材词条（M2 新增） |
| `capability` 能力与配置 | `capability.skill` / `capability.preset` / `capability.recipe` | 技能、预设、配方词条（M2 新增） |
| `tooling` 工具与实践 | `tooling.pack` / `tooling.install` / `tooling.index` | 工具词条（M2 新增） |

> **插件的分类不搬到我们这边**：插件聚合页直接用 `awesome-dsh-plugin.com` 的分类键（`cat`）做筛选标签。同一个插件在两站落进不同的类，读者与下游机器都要多做一次映射，没必要。

---

## 5. 插件引用块（教程与包页里引用插件的统一写法）

在教程与包页里引用插件时，用统一的块，**这是「资源整合」的最小单位**：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 常用名 |
| `entry` | 否 | 若该插件已有词条，填 `plugin/<n>`，教程页据此链到词条页（而不是只链外部源） |
| `npm` / `repo` | 至少一个 | 两个都能给更好；`repo` 用 `owner/repo` |
| `why` | ✅ | **在这篇教程里为什么用它**——空泛的「很好用」由校验器拒绝（最小长度 + 禁止禁用词表） |
| `install` | 否 | 安装命令，必须是 `dsh plugin …` 形式 |
| `compat` | 否 | `dsh` 版本枚举 + `runtime`（cli/desktop/web），与 manifest v5 的 `dshVersions` 同一精神：枚举而非 range |
| `sources` | 否 | 外部源指针：`awesome` / `dshbase` / `npm` / `github` / `market` |
| `notes` | 否 | 坑与冲突（如「与 X 抢同一个 slot」） |

三条纪律：

1. **不复制上游元数据**：star、下载量、README 正文都不进我们的仓库，只在聚合页引用外部源的值并标快照时间。
2. **同一插件不因被多篇教程引用而合并成页面**；构建期生成**反向索引**（`web/data/reverse/plugins.json`：插件 → 引用它的词条），在聚合页与教程页互相可见。这就是「资源整合」在数据层的样子。
3. **引用块不是生态普查**：只引用「这篇内容真的用到」的插件，宁可少。生态全貌交给外部源。

---

## 6. 构建产物（`web/data/`）

| 产物 | 内容 | 用途 |
| --- | --- | --- |
| `entries/<kind>-<n>.json` | 渲染后的 HTML + TOC + 元信息 + 反链 + 引用的插件（含外部源链接）+ **`completeness`（构建期派生：字段完备度 + 缺项清单）** | 词条页 |
| `registry.json` | 数字目录：n / kind / title / createdAt / status（含墓碑） | 导航、最近更新、墓碑页 |
| `taxonomy.json` | 分类树 + 每类计数 | 导航与筛选 |
| `reverse/plugins.json` | **插件 → 引用它的教程**（按 `npm`/`repo` 归并）+ **插件 → 使用它的整合包** | 插件词条页的「出现在哪 / 谁在用」，以及教程页的「还出现在」 |
| `plugins/index.json` | 插件词条的轻量索引（n / 名称 / 定位 / 分类 / 外部源指针 / 快照时间） | 插件索引页（筛选与跳转，数据规模 = 词条数，不是生态全量） |
| `zones/<zone>.json` | 分区页数据：标题 / 定义 / `howto` / `itemFields` 白名单 / 条目卡片（含 `entry` 链接与红链标记 / 标签 / 风险徽章 / 专属字段 / 完整度小标） | 十二个一级分区页 |
| `graph.json` | 生态全景图的数据（docs/01 §路由）：`center` / `size` / `zones` / `nodes`（含 `band`：外圈分区臂或内圈跨分区）/ `edges` / `counts`。边字段 `from` / `to` / `type` / `group` / **`why`**；`type` ∈ `requires`/`recommends`/`conflicts`/`replaces`/`integrates` / `prereq` / `related` / `tutorial` / `pack` / `references`（最后三类是构建期派生）。页面 `graph.html` 与它**同源**：同一份数据渲染 | 生态全景图页 `graph.html` |
| `search.json` | id / kind / title / aliases / tags / summary | 搜索 |

---

## 7. 来源标注

采集字段一律带来源与快照时间，页面显示「自动采集 · 快照 2026-10-01」或「人工核实 · 2026-10-02」；人工字段永不被采集覆盖，采集只填人工留空处（同 [03](03-directory-and-pipeline.md) §4）。**空字符串与空数组一律视为缺失**，不渲染、不参与合并。

---

## 8. 语言策略

中文为主：`title` / `summary` / 正文必填中文。英文按字段可选（`titleEn`、taxonomy 的 `label.en`）。**不做双语正文**；英文站点属后续里程碑。

---

## 9. 校验规则（`scripts/validate.mjs`）

| # | 规则 | 级别 |
| --- | --- | --- |
| 1 | 文件路径与 kind 匹配（`data/<kind>/<n>.md`） | error |
| 2 | 文件名数字在 registry 中存在、kind 一致、`status` 一致 | error |
| 3 | 同一 kind 内数字不重复；`counters[kind] >= max(n)` | error |
| 4 | 已 `deleted` 的号没有被新文件占用（墓碑不可覆盖） | error |
| 5 | front-matter 可解析、无重复键；必填字段齐备 | error |
| 5 | front-matter 可解析、无重复键；必填字段齐备 —— **`status: draft` 时只提示不拦截**（`new.mjs` 生成的骨架本来就是 draft，否则新贡献者一领号就红） | error（draft 为 warn） |
| 6 | `category` 每项都是 taxonomy 的**叶子**节点（`deprecated` 节点 warn）——同上，**draft 时降为 warn** | error（draft 为 warn） |
| 7 | `prereq` / `related` 指向的 `kind/n` 存在（被删词条 warn） | error |
| 8 | 正文里的 `[[kind/n]]` 目标存在 | error |
| 9 | 插件引用块：`name` 与 `why` 必填、`why` 长度下限且不含禁用词、`npm`/`repo` 至少一个、`install` 形如 `dsh plugin …` | error |
| 10 | `origin: external` 必须有 `external.url` / `reviewedAt` / `verdict`，且正文非空 | error |
| 11 | `appliesTo` 必须含「实测」或「未核实」这类口径词，禁止出现无口径的版本断言 | error |
| 12 | 引用/外链可达性（构建期 HEAD 检查，失败降级为 warn 并标注「链接待核」） | warn |
| 13 | `screenshots` 指向的图片存在；枚举字段取值合法 | error |
| 14 | 正文长度下限（防空壳词条） | warn |
| 15 | **插件词条必须满足收录门槛之一**（官方来源 / 被教程引用 / 被整合包使用 / 有 maintainer），且 `entryGate` 与实际相符 | error |
| 16 | 插件词条：`repo`/`npm` 至少一个；`relations[].target` 指向存在的 `plugin/<n>`；`compat.dsh` 每项都带「实测 / 未核实」口径；`providedBy` 的每项都带快照时间 | error |
| 17 | 分区文件：`zone` 唯一、`desc` 与 `howto` 必填、条目 `name`/`blurb`/`links` 齐备 | error |
| 18 | 分区条目的 `entry` 指向存在的词条（**留空即红链，是合法状态**） | error |
| 19 | `entities.yml`：每个键全局唯一；`refs[].source` 指向存在的源；`refs` 只由采集写 | error |
| 20 | 源配置：`adapter.zone` 指向存在的分区；同 slug 的「源词条」与「未文档化源配置」不能并存 | error |
| 21 | `relations[].since` / `until` 若存在必须是合法版本字符串，且 `since ≤ until`；否则照常渲染但置 warn | warn |
| 22 | `status: archived` 的词条必须写明归档原因（`archivedNote`），否则 warn——归档不是垃圾桶，要说清为什么还留着 | warn |
| 23 | 分区条目只允许出现 `itemFields` 白名单内的专属键；分区文件声明了白名单却没有条目使用它 → warn（可能该分区不需要专属字段） | error |

---

## 10. 采集映射（收缩后的范围）

| 数据 | 来源 | 频率 |
| --- | --- | --- |
| 整合包列表与指针 | `dsh-pack-market/index/index.json`（schemaVersion 2） | 每轮 |
| 包的完整 manifest（成分表） | `dsh-pack-market/index/packs/<id>/manifest.json` | 每轮（按 `updatedAt` 增量） |
| 包下载量 | 同目录 `stats.json` | 每轮 |
| 启动器注册表 | `dsh-pack-market/index/launchers.json` | 每轮 |
| 插件聚合数据 | `awesome-dsh-plugin.com/catalog.json`（4400 条，字段 `cat`/`stars`/`dl`/`npm`/`cmd`/`href`） | 每日一次（**只索引，不落元数据副本**） |
| 外部教程来源 | `dshbase.com` 等（仅人工登记 `origin: external` 的条目，不爬站） | 人工 |
| **插件词条的候选** | 反查市场 manifest 的 `bundles` / `dependencies`（实测 26 个不同包名）→ 生成候选清单，人工决定收录 | 每轮 |
| **插件词条的按需引用** | 建词条时对 `repo`/`npm` 抓**一次**（awesome `catalog.json` 里查、npm registry、GitHub API），结果写进 `providedBy` 并记快照时间 | 建条 / 人工触发 |

**明确不采集**：GitHub topic `dsh-plugin` 的全量扫描、插件的 `package.json` / README 批量抓取落库、任何「生态有多少插件」式的普查。这些是外部源的活，我们不接。

---

## 11. 明确不做（与 README 的「不是什么」互为镜像）

1. **插件全量收录**（不是「插件词条」——词条要做，见 §1.2 门槛）与插件资料二级词条（资料列为 M3 可选机制）；
2. 全量插件元数据采集（star / 下载量 / README 副本）；
3. 站内下载托管与授权体系（分发由 GitHub Release / npm / `.dspack` 侧车承担）；
4. 账号、积分、评分、评论与审核后台（等价物是 PR + CI + git 历史）。
