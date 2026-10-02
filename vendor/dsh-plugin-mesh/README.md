# vendor/dsh-plugin-mesh —— 全量插件生态图（第三方）

这是 [WTStarMark/dsh-plugin-mesh](https://github.com/WTStarMark/dsh-plugin-mesh) 的**原样副本**，
用来在 `dshbaike.com/mesh/` 提供那张**全量插件生态图**（2625 个仓库、19 个功能扇区）。

**为什么用它的，而不是我们自己画一张**：我们的词条是人工核实的，目前 31 条、关系数据更少
（`relations` 还是 0 条）；而这张图的价值在**全量**与**自动更新**——那是机器采集的活，
不是百科该做的事。两者是两种东西：

| | 这张图（它） | 我们的 `data/graph.json` |
| --- | --- | --- |
| 数据来源 | GitHub topic 采集（每小时一轮） | 人工填的 front-matter + 构建期反向索引 |
| 边是什么 | topic 共现 / 同作者（**相似度**） | 前置 / 相关 / 教程引用 / 整合包引用（**带出处**） |
| 规模 | 2625 仓库 | 31 条词条 |

## 来源与许可

| 项 | 值 |
| --- | --- |
| 上游 | <https://github.com/WTStarMark/dsh-plugin-mesh> |
| 许可 | **MIT**（`LICENSE` 原样保留在此目录） |
| 副本对应的上游提交 | `4ea09662ca514ae9113c79679369fb3a6e8cec11` |
| 本地修改 | **无**。目录内所有文件与上游逐字节一致（含 `data/mesh.json`） |

MIT 要求随副本保留版权声明与许可原文 —— 这就是 `LICENSE` 放在这里的原因。
署名另外出现在**入口处**（插件分区页那张卡的说明文字）与本站 `README.md`，
这样读者点进来之前就知道这是谁做的、以及它是**自动采集、未经本站核实**的数据。

## 更新数据（不是更新代码）

本站不跑它的采集器（那要 GitHub 令牌与常驻进程）。数据由**定时工作流**
`.github/workflows/mesh-snapshot.yml` 每天从上游仓库抓一份 `data/mesh.json` 覆盖进来，
只有内容变了才提交 —— 所以仓库里这份**始终是某一天的快照**，快照时间写在
`data/mesh.json` 的 `meta.generatedAt` 里（当前那份见该字段）。

要手动更新一次：

```bash
gh api repos/WTStarMark/dsh-plugin-mesh/contents/data/mesh.json \
  -H 'Accept: application/vnd.github.raw' > vendor/dsh-plugin-mesh/data/mesh.json
node scripts/build.mjs            # 拷进 web/mesh/
```

## 要更新它的代码（上游发了新版本）

上游改动会带来新功能（例如新的筛选或布局）。更新代码时**整套换掉**、保持"零本地修改"，
并在上面那张表里登记新的上游提交号：

```bash
git clone --depth 1 https://github.com/WTStarMark/dsh-plugin-mesh /tmp/mesh
cp /tmp/mesh/index.html /tmp/mesh/styles.css /tmp/mesh/LICENSE vendor/dsh-plugin-mesh/
cp /tmp/mesh/src/*.js vendor/dsh-plugin-mesh/src/
# data/mesh.json 用上面的快照流程拿，不要用 clone 里的（可能比快照旧）
node scripts/build.mjs
```

## 运维要点

- 它向**同源** `/api/ping` 要访问统计；本站没有这个接口 → 请求 404，
  它的代码会**整栏隐藏**（上游 README 明说「拿不到接口时整栏隐藏」），所以不是坏掉；
- 头像与 favicon 直接取 `github.com`（HTTPS，不构成混合内容）；
- 它被放在 `web/mesh/`，取数是**相对路径** `./data/mesh.json`，所以子路径部署也能用；
- 我们不修改它的任何文件：将来它坏了，先看上游是否已修，再整套更新。
