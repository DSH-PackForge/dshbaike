/**
 * graph.mjs —— 生态全景图（docs/01 §路由、docs/02 §产物 `graph.json`）。
 *
 * 这份文件只产出**数据**（graph.json，可机读、可被下游消费）。
 * 页面不由本项目渲染：全量生态图用第三方项目 vendor/dsh-plugin-mesh。
 *
 * 三条铁律，和整站一致：
 *   1. **确定性**：不写随机数、节点与边全部排序 → 同一份数据逐字节一致（构建期比对写盘）。
 *   2. **可解释**：每条边都带 `why`（从哪个字段来的）。「像不像」不算关系——
 *      相似度图（topic 共现那类）我们**不做**：它看着热闹，读完无所获。
 *   3. **兼容既有契约**：边的字段名沿用 `from` / `to` / `type`（docs/02 §产物表），
 *      正文提到的边仍叫 `references`；新增的只有 `why` 与 `group`。
 */
import { compareIds } from './util.mjs';

/**
 * 边的分组与语义。`group` 是我们自己的归类（下游按它上色即可），
 * `type` 保留具体语义（relations 下面还分 requires / recommends / conflicts / replaces / integrates）。
 * 页面不再由本项目渲染（全量生态图用 vendor/dsh-plugin-mesh），所以这里只留数据含义、不留画法。
 */
export const EDGE_GROUPS = {
  relations: { zh: '关系' },
  prereq: { zh: '前置' },
  related: { zh: '相关' },
  tutorial: { zh: '教程引用' },
  pack: { zh: '整合包引用' },
  references: { zh: '正文提到（派生）' },
};

/** relations 的五种语义 → 同属 relations 组 */
const RELATION_TYPES = new Set(['requires', 'recommends', 'conflicts', 'replaces', 'integrates']);

/** 画布尺寸：只作为数据里的一个提示字段（下游可视化用），本站不再画它 */
const SIZE = 1240;

/**
 * 从构建期模型算出图数据。
 * @param {{model: object, entryOutputs: Map<string, object>, reverse?: object, generatedAt?: string|null}} input
 */
export function buildEcosystemGraph({ model, entryOutputs, reverse = null, generatedAt = null }) {
  const outputs = [...entryOutputs.values()].filter((o) => o.status !== 'deleted');
  const byId = new Map(outputs.map((o) => [o.id, o]));

  const zoneOrder = model.registry?.data?.zoneOrder ?? [];
  const zoneTitle = new Map((model.zones ?? []).map((z) => [z.zone, z.data?.title ?? z.zone]));

  /* ---- 节点 ------------------------------------------------------------ */
  const center = byId.has('plugin/1')
    ? 'plugin/1'
    : [...byId.keys()].sort(compareIds)[0] ?? null;
  const nodes = outputs
    .map((o) => {
      const zone = o.zone && o.zone.id ? o.zone.id : null;
      return {
        id: o.id,
        kind: o.kind,
        n: o.n,
        title: o.title ?? o.id,
        zone,
        band: zone ? 'outer' : 'inner',
        completeness: o.completeness?.score ?? null,
        status: o.status ?? 'published',
      };
    })
    .sort((a, b) => compareIds(a.id, b.id));

  /* ---- 边 -------------------------------------------------------------- */
  const edges = [];
  const seen = new Set();
  const add = (from, to, type, group, why) => {
    if (!byId.has(from) || !byId.has(to) || from === to) return;
    const key = `${from}|${to}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type, group, why });
  };

  for (const entry of model.entries) {
    if (!entry.data || !byId.has(entry.id)) continue;
    const data = entry.data;
    // relations：带语义方向的关系（requires / recommends / conflicts / replaces / integrates）
    for (const rel of Array.isArray(data.relations) ? data.relations : []) {
      const target = typeof rel?.target === 'string' ? rel.target.trim() : null;
      const type = RELATION_TYPES.has(String(rel?.type)) ? String(rel.type) : 'related';
      if (target) add(entry.id, target, type, type === 'related' ? 'related' : 'relations', `front-matter: relations.${rel?.type ?? '?'}`);
    }
    for (const target of Array.isArray(data.prereq) ? data.prereq : []) {
      if (typeof target === 'string') add(entry.id, target.trim(), 'prereq', 'prereq', 'front-matter: prereq');
    }
    for (const target of Array.isArray(data.related) ? data.related : []) {
      if (typeof target === 'string') add(entry.id, target.trim(), 'related', 'related', 'front-matter: related');
    }
  }
  for (const out of outputs) {
    for (const t of out.referencedByTutorials ?? []) {
      add(String(t), out.id, 'tutorial', 'tutorial', '反向索引：教程引用了它');
    }
    for (const b of out.backlinks ?? []) {
      if (!b?.id) continue;
      add(out.id, b.id, 'references', 'references', '反向索引：正文提到了它');
    }
  }
  for (const item of reverse?.plugins ?? []) {
    if (!item.entryId) continue;
    for (const p of item.packs ?? []) add(String(p), item.entryId, 'pack', 'pack', '反向索引：整合包引用了它');
  }
  edges.sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to) || (a.type < b.type ? -1 : 1));

  const byType = {};
  for (const e of edges) byType[e.type] = (byType[e.type] ?? 0) + 1;

  const listed = zoneOrder.filter((z) => nodes.some((n) => n.zone === z));
  const extra = [...new Set(nodes.map((n) => n.zone).filter((z) => z && !listed.includes(z)))].sort();

  return {
    generatedAt,
    // 圆心：生态的起点（默认是官方插件与半端那一条）。前端把它画在正中。
    center,
    size: SIZE,
    zones: [...listed, ...extra].map((id) => ({
      id,
      title: zoneTitle.get(id) ?? id,
      // 圆心单列在正中，不再算进它所属分区的臂（否则「插件 2」会让人以为臂上有两个）
      count: nodes.filter((n) => n.zone === id && n.id !== center).length,
    })),
    nodes,
    edges,
    counts: { nodes: nodes.length, edges: edges.length, byType },
  };
}
