# 13 · 词条页的展示契约：基础格式 + 分区扩展

评审定调：**「可以有一个基础格式，然后分区扩展。」**

在此之前，数据层早就分开了（14 种类型各有字段契约），**渲染层却只有一套**——
`spec`（文档 + 版本 + 文件路径）、`recipe`（一段可粘贴的代码）、`theme`（要截图）、
`tool`（安装命令 + 子命令表）在页面上长得一模一样，全靠四组固定字段堆出来。

---

## 1. 三层分法

| 层 | 是否按类型变 | 内容 |
| --- | --- | --- |
| **基础格式** | ❌ 不变 | 面包屑 / 标题 / 摘要 / **首屏块位** / 信息表 / 目录 / 正文 / 关系 / 反链 / 脚注。一致性由这一层保证 |
| **分区扩展** | ✅ 按 kind | ① `lead`：这一类**最该先看到的一块**；② `groups`：信息表的字段组取舍与顺序 |
| **缺省降级** | — | 扩展需要的数据缺失时，**整块不渲染**（不编、不留空壳）；没声明扩展的类型走基础格式 |

**为什么不做 14 套模板**：模板是代码，会各自漂移，改一处要改十四处。
把差异收敛成「一张声明表 + 两个通用组件」，新增类型只加十来行声明。

## 2. 声明在哪

`scripts/lib/presentation.mjs`（构建期读，写进词条产物 `presentation` 字段）：

```js
recipe: {
  lead: { type: 'code', field: 'snippet', label: '可直接粘贴的片段', note: ['dshRef', 'targetLayer'] },
  groups: ['basic', 'license'],
  extraGroups: [{ title: '落点与理由', keys: ['recipeKind', 'targetLayer', 'dshRef', 'why'] }],
},
spec: {
  lead: { type: 'facts', fields: ['specVersion', 'specStatus', 'fileName', 'supersedes'] },
  groups: ['basic', 'origin', 'license'],
  extraGroups: [{ title: '版本与状态', keys: ['specVersion', 'specStatus', 'fileName', 'supersedes', 'repo', 'url'] }],
},
```

产物形状（`web/data/entries/<kind>-<n>.json`）：

```jsonc
"presentation": {
  "lead": { "type": "code", "field": "snippet", "label": "可直接粘贴的片段", "note": ["dshRef", "targetLayer"] },
  "groups": [ { "title": "基本信息", "keys": ["…"] }, { "title": "落点与理由", "keys": ["…"] } ]
}
```

前端只认这张声明：`lead` 没有 → 不渲染首屏块；`groups` 缺失 → 退回默认四组（旧产物也不会白屏）。

## 3. 两个通用组件

| `lead.type` | 样子 | 谁在用 |
| --- | --- | --- |
| `code` | 一个等宽块 + **复制按钮**（复用既有的 `data-copy` 机制）+ 一行脚注（如「对应文件 / 落点层」） | `recipe` 的 `snippet` |
| `facts` | 一排「键: 值」小卡（缺的字段自动跳过） | `spec` 的版本与状态、`pack` 的形态与下载量、`theme` 的改造范围、`skill` 的发现根、`preset` 的形态与权限、`tool`/`client`/`launcher` 的形态与平台 |

字段值统一走 `leadValue()`：数组用「、」连接，对象只展开一层（`k v · k v`），
**不做语义猜测**（例如不把 `downloads` 对象猜成「累计/当前」的专门排版）——
真要专门排版，就在声明里加一个新的 `lead.type`，而不是在渲染器里猜。

## 4. 基础格式仍要克制

基础格式负责**一致**，不负责**好看**：
- 不因为某个类型字段多就换一套骨架；
- 新增类型时先问「它需不需要首屏块」，多数类型（`concept` / `tutorial` / `source`）**不需要**，散文本身就是内容；
- 首屏块栏位只有一个：不要出现「两块都想抢首屏」的情况——真有第二个重点，说明该拆词条。

## 5. 现状与待办

| 类型 | 首屏块 | 信息表字段组 |
| --- | --- | --- |
| `recipe` | ✅ 可粘贴片段（含复制） | 基本信息 / 许可证 / 落点与理由 |
| `spec` | ✅ 版本 / 状态 / 文件 / 取代了谁 | 基本信息 / 安装与出处 / 许可证 / 版本与状态 |
| `pack` | ✅ 包形态 / 适用版本 / 下载量 | + 包成分 |
| `theme` `asset` `skill` `preset` `tool` `client` `launcher` | ✅ 该类型的要点条 | 按类型取舍 |
| `plugin` | ⛔ 不加（定位 + 外部源指针 + 引用卡已经够抢眼） | 默认四组 |
| `concept` `tutorial` `source` | ⛔ 不加（散文就是内容） | 默认四组 |

**待办**：`theme` 的 `screenshots` 目前没有真实素材，所以还没做「画廊」这种首屏块——
等有截图再加一个 `lead.type: 'gallery'`，而不是现在就摆一个空相框。
