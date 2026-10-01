# 参与 DSH 百科

本站是**社区整理**的 DSH（DeepSeek Harness）资料站，与 DeepSeek 官方**无隶属关系**；收录不等于背书。
所有内容都在 git 里：**改词条 = 提 PR**，没有账号、没有在线编辑器、没有审核后台。

设计文档在 [`docs/`](docs/)：先看 [01 信息架构](docs/01-information-architecture.md)（站点长什么样）、[02 数据契约](docs/02-data-contract.md)（字段与校验规则）、[10 M1 接口冻结](docs/10-m1-interface.md)（工具链行为）。

---

## 最短路径：写一条词条

```bash
# 1. 领号（编号是身份，永不复用；墓碑号不会被回收）
node scripts/new.mjs tutorial "为什么 DSH 升级后插件会失效"
#    → 分配 tutorial/6，写入 data/registry.yml，生成 data/tutorial/6.md 骨架

# 2. 写正文（front-matter 与正文都在同一个文件里）

# 3. 本地校验 + 构建
node scripts/validate.mjs      # 必须 0 errors
node scripts/build.mjs         # 产出 web/data/** 与分页

# 4. 本地看效果
node scripts/build.mjs && node scripts/dev-server.mjs   # → http://127.0.0.1:8811/
#    词条列表：http://127.0.0.1:8811/#/browse/all
#    也可以在任意静态服务器上打开 web/（纯静态，无构建步骤）

# 5. 提交 PR
```

**不要手改 `data/registry.yml` 的计数器**，也不要跳号或复用已删除的号——校验器会拒绝。

> **`draft` 是宽容状态**：骨架默认 `status: draft`，此时「缺分类 / 分类不在树里」这类问题只提示不拦截，方便你先写完再收口；改成 `published` 后才会被卡。改完记得把 `registry.yml` 里那条的 `status` 一起改（两处必须一致，校验器会查）。
>
> **删除留墓碑**：把词条的 `status` 改成 `deleted`（文件与 registry 两处），页面会继续存在并显示「本词条已撤下」，但会从搜索索引与计数里移除——**号永不复用**。

---

## 六类词条

| 类型 | 位置 | 写什么 |
| --- | --- | --- |
| `concept` | `data/concept/<n>.md` | 机制级概念（patch 层序、profile、slot…）。**必须能指到权威出处**（`spec`：代码路径或规范 URL） |
| `plugin` | `data/plugin/<n>.md` | 插件**聚合页**：人工写的定位 / 关系 / 兼容 / 坑 + 外部源指针。**不整篇复制上游 README** |
| `tutorial` | `data/tutorial/<n>.md` | 教程。自写用 `origin: original`；外部教程做**索引卡**（`origin: external` + 我们的适用性判断，不转载正文） |
| `pack` | `data/pack/<n>.md` | 整合包词条。包成分由采集注入，人写的部分是「适合谁」 |
| `launcher` | `data/launcher/<n>.md` | 启动器词条（canonical ID、血缘、平台） |
| `source` | `data/source/<n>.md` | 资源源：外部站/渠道一页（收录什么、提供哪些字段、怎么投稿、与我们的关系） |

**插件只在满足收录门槛时才建词条**（被本教程引用 / 被整合包使用 / 有人认领，见 [02 §1.2](docs/02-data-contract.md)）——我们不与 `awesome-dsh-plugin.com`、`dshbase.com` 比收录量，那两家的全量列表才是「去哪发现」的答案。

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
