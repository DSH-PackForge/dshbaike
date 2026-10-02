# 参与 DSH 百科

本站是**社区整理**的 DSH（DeepSeek Harness）资料站，与 DeepSeek 官方无隶属关系。
所有内容都在 git 里：**没有审核后台、没有数据库**，站上每一页都是某个 Markdown/YAML 文件渲染出来的。

设计文档在 [`docs/`](docs/)：先看 [01 信息架构](docs/01-information-architecture.md)（站点长什么样）、[02 数据契约](docs/02-data-contract.md)（字段与校验规则）、[10 M1 接口冻结](docs/10-m1-interface.md)（工具链行为）。

---

## 先选一条路：三种改法，按「你要改什么」分

**不需要任何本地工具**——前两条全程在浏览器里完成。别一上来就 clone 仓库。

| 你要做的事 | 走哪条路 | 你要做的 | 成本 |
| --- | --- | --- | --- |
| **认领一条词条**（⚠ 没有维护者） | 词条页点 **「我来维护 →」** | 填一个表单（词条 id 已预填 + 你的 GitHub 用户名） | **1 次表单**，机器人改文件并开 PR |
| **改正文里的一句话**（数字过时、写错） | 词条页点 **「改一句话」** | 填「原文片段 → 改成」 | 1 次表单，机器人代改并开 PR |
| **补/改头部字段**（更新日期、标签、安装命令…） | 词条页点 **「改字段」** | 填字段名 + 新值 | 1 次表单，同上 |
| **给分区加一条资源** | 分区页点 **「补充一条」** | 填分区 / 二级分区 id / 名称 / 一句话 / 外链 | 1 次表单，同上 |
| **改一个错字、一句话、一个链接**（想自己动手） | 站内词条页右上角 **「编辑此条」**（或缺口清单里的「去编辑 →」） | GitHub 会打开该文件的网页编辑器；改完在提交对话框里选「**Commit directly to main**」（有写权限）或「**Create a new branch and start a pull request**」 | 1 次编辑 + 1 次提交 |
| **报告问题，但不想自己动文件** | 站内 **「纠错」** | 填表单（词条 / 问题类型 / 哪里不对 / 建议改法 / 出处） | 1 次表单 |
| **改动大**（重写一节、调结构、加新章节） | **fork + PR** | 见下面的「本地工作流」 | 需要 Node 22+ |

> **机器人代改通道**（前三行）：表单 → 机器人只改它声明的那一处 → 跑校验 → 开 PR →
> **维护者审核后合并**。机器人**从不自己合并**。
> 如果改动落在它不能安全处理的范围内（嵌套字段、定位不唯一、要理解语义），
> 它会**明确拒绝**并告诉你去 fork + PR，而不是猜着改。设计与边界见 [14](docs/14-contribution-system.md)。

## 本地工作流（可选，只有批量改动才需要）

```bash
# 1. 领号（编号是身份，永不复用；墓碑号不会被回收）
node scripts/new.mjs tutorial "为什么 DSH 升级后插件会失效"
#    → 分配 tutorial/6，写入 data/registry.yml，生成 data/tutorial/6.md 骨架

# 2. 写正文（front-matter 与正文都在同一个文件里）

# 3. 本地校验 + 构建
node scripts/validate.mjs      # 必须 0 errors
node scripts/build.mjs         # 产出 web/data/** 与分页

# 3.5 写完准备发布：一条命令同时改文件与 registry 的状态（别手改，容易只改一处）
node scripts/status.mjs tutorial/6 published

# 4. 本地看效果
node scripts/build.mjs && node scripts/dev-server.mjs   # → http://127.0.0.1:8811/
#    词条列表：http://127.0.0.1:8811/#/browse/all
#    子路径部署的样子（GitHub Pages 就是这种）：先改构建根，再让服务器挂在前缀下
node scripts/build.mjs --base=/dshbaike/ && node scripts/dev-server.mjs 8812 --prefix=/dshbaike/

# 5. 提交 PR
```

**不要手改 `data/registry.yml` 的计数器**，也不要跳号或复用已删除的号——校验器会拒绝。

> **`draft` 是宽容状态**：骨架默认 `status: draft`，此时「缺分类 / 分类不在树里」这类问题只提示不拦截，方便你先写完再收口；改成 `published` 后才会被卡。**改状态用 `node scripts/status.mjs <kind>/<n> published`**——它会同时改词条文件与 `registry.yml`（校验规则 2 要求两处一致，手改常漏一处）。
>
> **删除留墓碑**：`node scripts/status.mjs <kind>/<n> deleted`，页面会继续存在并显示「本词条已撤下」，但会从搜索索引与计数里移除——**号永不复用**。
>
> **合并与发布**：改 `data/**`、`web/**`、`scripts/**` 的 PR 会跑 CI（`validate.mjs` + 两次构建比对，确认构建确定性）；CI 绿了维护者才合并。合并进 `main` 之后，`.github/workflows/pages.yml` 会自动构建并发布——**构建失败就不会发布**，所以站点不会停在半坏的状态。

---

## 十四类词条：一个分区一种

**每个分区都有自己的词条类型**（见 [12](docs/12-m2-kinds.md)），所以每个分区的条目都能长出百科详情，而不只是外链卡片。

### 分区类型（十一种）

| 类型 | 位置 | 归属分区 | 写什么 |
| --- | --- | --- | --- |
| `client` | `data/client/<n>.md` | 界面与客户端 | 用什么界面使用 DSH（`form`: 桌面 / 终端 / 浏览器 / CLI） |
| `launcher` | `data/launcher/<n>.md` | 启动器 | canonical ID、血缘、平台、支持的 manifest 版本 |
| `plugin` | `data/plugin/<n>.md` | 插件 | 插件**聚合页**：定位 / 关系 / 兼容 / 坑 + 外部源指针。**不整篇复制上游 README** |
| `theme` | `data/theme/<n>.md` | 主题与皮肤 | 它改了界面的哪几部分（`targets`）、怎么装、跟其它外观类冲突吗 |
| `asset` | `data/asset/<n>.md` | 素材与本地化 | 字体 / 图标 / 壁纸 / 界面文案（`assetType`、`locale`） |
| `skill` | `data/skill/<n>.md` | 技能包 | 以 SKILL.md 为单位的能力：在哪个发现根生效（`roots`）、关键文件 |
| `preset` | `data/preset/<n>.md` | 预设与人设 | agent preset / 人设：`presetKind` + `files` + 权限档位 |
| `recipe` | `data/recipe/<n>.md` | 指令与配方 | 一小段可粘贴的配置或指令模板：`snippet` + `why` + 落点层 |
| `pack` | `data/pack/<n>.md` | 整合包 | 包成分由采集注入，人写的部分是「适合谁」（`fitFor`） |
| `tool` | `data/tool/<n>.md` | 工具链 | 在 DSH 之外运行的工具：形态、语言、提供什么、需要什么 |
| `spec` | `data/spec/<n>.md` | 规范与协议 | 规范文件一页：版本、状态、仓库内路径。**有争议时以它为准** |

### 跨分区类型（三种）

| 类型 | 位置 | 写什么 |
| --- | --- | --- |
| `concept` | `data/concept/<n>.md` | 机制级概念（patch 层序、profile、slot…）。**必须能指到权威出处**（`spec`：代码路径或规范 URL） |
| `tutorial` | `data/tutorial/<n>.md` | 教程。自写用 `origin: original`；外部教程做**索引卡**（`origin: external` + 我们的适用性判断，不转载正文） |
| `source` | `data/source/<n>.md` | 资源源：外部站/渠道一页（收录什么、提供哪些字段、怎么投稿、与我们的关系） |

**插件只在满足收录门槛时才建词条**（被教程引用 / 被整合包使用 / 有人认领，见 [02 §1.2](docs/02-data-contract.md)）——我们不与 `awesome-dsh-plugin.com`、`dshbase.com` 比收录量，那两家的全量列表才是「去哪发现」的答案。

**分区文件要声明自己收哪种类型**（`data/zones/<分区>.yml` 里的 `kinds: [theme]`）：构建期据此把词条归到分区，校验规则 24 要求「一种类型恰好属于一个分区」。

---

## 四条内容纪律

1. **有出处**。每个事实都要能指回来源；采集来的字段带快照日期，人写的字段标人工。
2. **口径要显式**。「实测 / 未核实 / 未声明」三态必须写清，**「无数据」不等于 0**，也**不等于不兼容**。
3. **不复制、只引用**。上游 README、外部教程正文、外部源的元数据都不进我们的仓库；引用时给名称 + 链接 + 快照日期。
4. **不替别人声明许可**。写许可证只写「哪里写着什么」并附链接，不要替上游宣布协议（我们自己踩过一次坑，见 [04 §7.3](docs/04-mcmod-reference.md)）。

---

## 改分区层（资源整合）

分区数据在 `data/zones/<zone>.yml`，十一个分区按「装配位置」分层（见 [06 §2](docs/06-zones-and-entries.md)）。

- 条目必填 `name` / `blurb` / `links`（至少一个链接）；`blurb` 是**你自己写的一句话**，不抄上游 description。
- 想让一个条目指向词条，填 `entry: plugin/12`；留空即渲染成红链「写这一条」——**红链是允许的状态**，不是错误。
- 分区专属字段走 `itemFields` 白名单（例如 `clients` 的 `form`/`shippedBy`/`profile`/`platforms`）。**白名单外的键会被校验器拒绝**。
- **任何一个分区页都不允许是空的**：主标语承诺「一站式」，空页会当场打脸（见 [08 §8.6](docs/08-visual-system.md)）。一个分区至少给出一个可用入口（本站词条，或明确的外部源）。

---

## 新增一个外部源

源是复数的，而且会继续长出来（见 [07](docs/07-multi-source-zones.md)）。接入一个源 = **加一条配置**：

1. 在 `data/source/` 领号写一条源词条，front-matter 里带 `adapter`（`endpoint` / `format` / `auth` / `fields` 映射 / `cadence` / `reliability`）与 `zones`（它覆盖哪些分区）；
2. 还没打算写词条的源，可以先放 `data/sources/<slug>.yml`（纯配置，页面标「未文档化」）——**同 slug 的源词条与裸配置不能并存**；
3. 外部元数据**只引用、不落库**；`refs` 由采集写入，人工只维护 `entities.yml` 的 `id` 与 `keys`。

---

## 提 PR 前的最小自检

- [ ] `node scripts/validate.mjs` → **0 errors**（warn 可以）
- [ ] `node scripts/build.mjs` → 构建成功；**连续跑两次产出逐字节一致**
- [ ] 新词条的编号只来自 `new.mjs`；没有手改计数器
- [ ] 正文里的 `[[kind/n]]` 站内链接**目标都存在**（校验器会报 error）
- [ ] 没有整段复制上游正文；引用都带出处
- [ ] 分区页没有变空；新增专属字段已加进该分区的 `itemFields`

---

## 维护者

词条 front-matter 的 `maintainers` 填 GitHub 用户名。`status: protected` 的词条只接受维护者修改；
`status: archived` 表示上游已归档，必须写清归档原因（校验器会 warn）。

## 许可（已定，完整说明见 [LICENSE](LICENSE)）

- **词条正文**（`data/<kind>/*.md`）：**CC BY-SA 4.0**（署名 + 相同方式共享）
- **其余全部 CC0 1.0**：代码与脚本、结构化数据（`registry` / `taxonomy` / `sources` / `entities` / `zones`）、采集与构建产物、设计文档
- 外部源与上游仓库的元数据：**只引用（带快照日期）与外链**，不落副本

所以你写进词条的正文会以 CC BY-SA 4.0 发布；你写的分区条目、结构化数据会以 CC0 发布——**提 PR 即表示同意这两种发布方式**。
