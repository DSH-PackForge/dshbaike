# 12 · M2 词条类型扩展：让每个分区都有百科详情

**问题**：十一个分区里只有 `plugins` / `packs`（以及零星几条）能链到词条。
其余八个分区**在词条体系里根本没有对应的类型**——不是「还没写」，而是
「写了也没地方发号」：`ENTRY_KINDS` 只有 `concept / plugin / tutorial / pack / launcher / source`，
所以主题、技能、预设、配方、客户端、素材、工具链、规范这八类东西永远不可能有详情页。

**目标**：**一个分区一种词条类型**，让每个分区的每个条目都能有百科详情页。

---

## 1. 十四种词条类型

| kind | 中文 | 归属分区 | 编号前缀 |
| --- | --- | --- | --- |
| `client` | 客户端 | `clients` 界面与客户端 | `client/1` |
| `launcher` | 启动器 | `launchers` 启动器 | `launcher/1` |
| `plugin` | 插件 | `plugins` 插件 | `plugin/1` |
| `theme` | 主题与皮肤 | `themes` 主题与皮肤 | `theme/1` |
| `asset` | 素材与本地化 | `assets` 素材与本地化 | `asset/1` |
| `skill` | 技能包 | `skills` 技能包 | `skill/1` |
| `preset` | 预设与人设 | `presets` 预设与人设 | `preset/1` |
| `recipe` | 指令与配方 | `recipes` 指令与配方 | `recipe/1` |
| `pack` | 整合包 | `packs` 整合包 | `pack/1` |
| `tool` | 工具 | `toolchain` 工具链 | `tool/1` |
| `spec` | 规范文件 | `specs` 规范与协议 | `spec/1` |
| `concept` | 概念 | **跨分区**（阅读材料） | `concept/1` |
| `tutorial` | 教程 | **跨分区**（阅读材料） | `tutorial/1` |
| `source` | 资源源 | **跨分区**（外部渠道，覆盖多个分区） | `source/1` |

**跨分区那三种不绑分区**：概念与教程是「读的东西」，不属于任何一层；
资源源本身覆盖多个分区（一条源词条用 `zones:` 声明它覆盖谁）。

## 2. 分区必须显式声明自己收哪些类型

分区文件新增一个键（**取代原先用正则猜的 `zoneForKinds()`**——猜不准，而且新增分区时静默失效）：

```yaml
zone: themes
title: 主题与皮肤
kinds: [theme]          # 这个分区的条目对应哪种词条
```

多类型分区写多个，例如客户端分区若以后要同时收插件形态的客户端：

```yaml
kinds: [client, plugin]
```

**规则**：`kinds` 里出现的每一种，都必须是自己分区条目的默认落点；
一个 kind 允许只属于一个分区（跨分区那三种不写进任何分区）。

## 3. 各类型的字段契约

公共必填（所有类型）：`title` / `category` / `summary` / `status`。
公共可选：`titleEn` / `aliases` / `tags` / `maintainers` / `updatedAt` / `archivedNote`。

下表只列**该类型独有**的字段；`必` = 必填，`期` = 期望出现（缺了会进完备度缺项清单）。

| kind | 字段 | 说明 |
| --- | --- | --- |
| `client` | `form` 必 · `platforms` 期 · `repo` 期 · `install` · `compat` · `licenseRefs` · `providedBy` · `screenshots` | `form`: `desktop` / `tui` / `web` / `cli` / `ide`。这是「用什么界面使用 DSH」的那一层 |
| `theme` | `targets` 必 · `install` 期 · `repo` · `npm` · `screenshots` · `compat` | `targets`: 它改界面的哪几部分（`shell` / `colors` / `wallpaper` / `icons` / `editor`） |
| `asset` | `assetType` 必 · `locale` · `install` · `repo` · `provides` | `assetType`: `font` / `icons` / `wallpaper` / `locale` / `snippet` |
| `skill` | `skillKind` 期 · `roots` 必 · `files` 期 · `install` · `repo` · `provides` | `roots`: 它按哪种发现优先级生效（`project` / `user` / `builtin` 等，见概念词条的技能扫描根） |
| `preset` | `presetKind` 必 · `files` 必 · `install` 期 · `repo` · `permissions` · `provides` | `presetKind`: `agent` / `client`；`files`: 例如 `agent.cordis.yml` |
| `recipe` | `recipeKind` 必 · `targetLayer` 必 · `dshRef` 期 · `snippet` · `why` | `recipeKind`: `config` / `snippet` / `instructions`；`targetLayer`: `project` / `userspace` / `machine` |
| `pack` | （已有）`marketId` / `packType` / `dshVersions` / `launchers` / `composition` / `downloads` / `fitFor` | 不变 |
| `tool` | `form` 必 · `language` 期 · `repo` 期 · `npm` · `install` · `provides` · `requires` | `form`: `cli` / `app` / `library` / `service`。共同点是「在 DSH 之外运行」 |
| `spec` | `specVersion` 必 · `specStatus` 必 · `fileName` 必 · `url` 期 · `supersedes` | `specStatus`: `current` / `draft` / `deprecated`；`fileName`: 仓库内路径。**有争议时以它为准** |
| `launcher` | （已有）`launcherId` / `url` / `support` / `platforms` / `supportedManifest` | 不变 |
| `plugin` | （已有）`repo` / `npm` / `install` / `role` / `relations` / `compat` / `licenseRefs` / `providedBy` / `entryGate` | 不变 |
| `source` | （已有）`url` / `zones` / `sourceKind` / `coverage` / `relation` / `howto` / `linkOut` | 不变 |

## 4. taxonomy 增补

分类树是**主题导向**的，不是「一种 kind 一个根」。本次新增五个根、十五个叶子：

| 新根 | 叶子 | 给谁用 |
| --- | --- | --- |
| `interface` 界面与入口 | `interface.desktop` / `interface.tui` / `interface.web` | `client` |
| `launch` 启动与装载 | `launch.wrapper` / `launch.desktop` / `launch.cli` | `launcher` |
| `appearance` 外观与素材 | `appearance.theme` / `appearance.asset` / `appearance.locale` | `theme` / `asset` |
| `capability` 能力与配置 | `capability.skill` / `capability.preset` / `capability.recipe` | `skill` / `preset` / `recipe` |
| `tooling` 工具与实践 | `tooling.pack` / `tooling.install` / `tooling.index` | `tool` |

`spec` 复用已有的 `ecosystem.spec` 叶子，不新增。
（`launcher` 此前**没有**可用叶子，属于顺带补上的既有缺口。）

## 5. 编号契约不变

每个 kind 独立自增、断号不回填、删除留墓碑、**永不复用**。
新类型从 `1` 开始；已有词条的 id 一个都不动（`plugin/1–3` 等保持原号）。

## 6. 验收（本轮）

1. `node scripts/validate.mjs` 0 errors / 0 warnings；
2. 十一个分区**每个至少有一条可点的百科详情**（红链不算）；
3. `zone.kinds` 声明生效：`build` 不再用正则猜 kind→分区；
4. 按类型浏览页出现十四类，且空类型如实显示 0 条；
5. 同一输入两次构建逐字节一致。
