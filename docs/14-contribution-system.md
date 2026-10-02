# 14 · 贡献系统：让每个「缺口」都有能做完的动作

评审原话：**「比如你点 ⚠ 没有维护者，应该让他直接可以编辑之类的，PR 那种。」**

原先的 ⚠ 只是一句抱怨：点它跳到一张**纠错表单**，填完还要维护者亲自去改文件。
这不是「用户贡献系统」，这是「给维护者派活」。

---

## 1. 判据：修这一项**要不要写内容**

| 缺口的性质 | 例子 | 该给的动作 | 谁干活 |
| --- | --- | --- | --- |
| **不需要写内容**（机械可修） | `maintainers`、`updatedAt` | **表单 → 机器人改文件 → 开 PR** | 机器 |
| **需要写内容** | `summary`、`compat`、`positioning`、`titleEn` | **直达该文件的网页编辑器** + （能机械化时）可复制的片段 | 提交者 |

一条硬规矩：**勾了「⚠」的那一项，必须能在这一页点一下就开始做**。
做不到就别把它列成可点的东西——那是骗点击。

## 2. 认领维护：唯一一条「全自动」的路

认领是典型的「不需要写内容」：只是把人名加进 `maintainers`。所以它走全自动：

```
词条页「⚠ 没有维护者」→「我来维护 →」
   → Issue 表单（claim.yml）：词条 id（自动预填）+ GitHub 用户名 + 一句关系说明
   → GitHub Action（claim.yml）跑 scripts/claim-from-issue.mjs
        · 解析表单（按**标签**读，改模板字段名必须同步改脚本）
        · scripts/claim.mjs 把用户名加进 front-matter 的 maintainers（幂等、保留原写法）
        · 跑 validate.mjs（认领不能让词条校验挂掉）
   → 开分支 + 提交 + `gh pr create`，并在 Issue 里回帖 PR 链接、关闭 Issue
   → 维护者只点一次「Merge」
```

> **一处组织策略限制（实测）**：本组织在策略里禁止 GitHub Actions 创建 PR
> （`Write permissions for workflows are disabled by the organization`），
> 所以 `gh pr create` 会报 `GitHub Actions is not permitted to create or approve pull requests`。
> workflow 因此带了**回退**：建不了 PR 就把分支推好，并在 Issue 里给出
> `https://github.com/<repo>/pull/new/<branch>`——**只差人点一下**。
> 想完全自动，需要组织管理员在 `Settings → Actions → General → Workflow permissions`
> 打开「允许 GitHub Actions 创建并批准 PR」。
> （另一条路是存一个 PAT 当 secret；**本仓库没有这么做**：把能代表用户身份的长期凭据放进仓库，
> 收益只是一个点击，不值得。）

**为什么不让贡献者直接编辑文件**：认领的收益是「以后能 @ 到人」，成本不该是
「学会 YAML 缩进 + 提 PR」。把成本压到一次表单，愿意认领的人才会真的出现。

**为什么不让维护者代抄**：那正是「累死」的来源。机器能做的一次都不该落在人身上。

## 3. 需要写内容的缺口：只给入口，不假装自动化

`summary` / `compat` / `positioning` 这类字段没有「机器可补」的解——写什么就是内容判断。
所以动作是：

1. **「去编辑 →」**：直达 `github.com/<org>/<repo>/edit/main/data/<kind>/<n>.md`。
   改完在提交对话框里选「Commit directly to main」（有写权限）或「建分支并开 PR」，
   **不需要本地工具、不需要先开 Issue**。
2. **可复制片段**：只有当字段真能机械补时给（例如 `updatedAt: 2026-10-02`）。
   **不硬凑**——给一个没用的片段比不给更糟。

## 4. 三条不越界

1. **机器人只改它声明会改的那一处**（认领只动 `maintainers`），并在 PR 描述里写明。
   拿着 write 权限的自动化改别的东西，是信任的透支。
2. **PR 描述必须写清「怎么触发的」**（Issue 链接）与「改了什么」，让维护者三秒能判断。
3. **机器人不合并**。它可以开 PR、回帖、关 Issue；合并永远是人点的。

## 5. 现状

| 能力 | 状态 |
| --- | --- |
| 认领维护（`maintainers`）全自动 | ✅ 表单 + Action + `scripts/claim.mjs`（本地可测：5 种 YAML 写法、幂等、非法输入都覆盖）。**实测**：Issue #3 → 分支只有 `maintainers` 一处 +1/−1 → 回帖给出「一键开 PR」链接，运行结论 success。建 PR 那一步受组织策略限制，需人点一下（见 §2 的说明） |
| 其它字段「去编辑」直达编辑器 | ✅ 缺口清单里每项一个动作 |
| 机械字段的可复制片段 | ✅ `updatedAt`（今天是唯一能确定的值） |
| `updatedAt` 也全自动 | ⏳ 未做：它需要「我确实核实过」的语义，值得单独一张表单（`verify.yml`），等有需求再加 |
| 新增词条自动领号 + 开 PR | ⏳ 未做：同一套模式（表单 → 改 registry + 骨架 → PR），但要做幂等与并发保护 |
