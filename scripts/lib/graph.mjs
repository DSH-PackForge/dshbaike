/**
 * graph.mjs —— 生态全景图（docs/01 §路由、docs/02 §产物 `graph.json`）。
 *
 * 这份文件是 `graph.json` 与全景页 `graph.html` 的**唯一**来源：
 * 先把图算成数据（可机读、可被下游消费），再把它渲染成 SVG（构建期画好，无 JS 也能看）。
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
 * 边的样式分组。`group` 决定怎么画，`type` 保留具体语义（例如 relations 下面还分
 * requires / recommends / conflicts / replaces / integrates）。
 */
export const EDGE_GROUPS = {
  relations: { zh: '关系', color: '#c98ac9', dash: null, arrow: true, defaultOn: true },
  prereq: { zh: '前置', color: '#b09ae8', dash: null, arrow: true, defaultOn: true },
  related: { zh: '相关', color: '#8bbf5e', dash: null, arrow: false, defaultOn: true },
  tutorial: { zh: '教程引用', color: '#f0a42a', dash: '6 4', arrow: false, defaultOn: true },
  pack: { zh: '整合包引用', color: '#5aa8e8', dash: '2 4', arrow: false, defaultOn: true },
  references: { zh: '正文提到（派生）', color: '#9aa5b1', dash: '1 5', arrow: false, defaultOn: false },
};

/** relations 的五种语义 → 同属 relations 组 */
const RELATION_TYPES = new Set(['requires', 'recommends', 'conflicts', 'replaces', 'integrates']);

/** 跨分区类型：不属于任何一层，画在内圈 */
const INNER_COLORS = { concept: '#7fd3c8', tutorial: '#f0a42a', source: '#5aa8e8' };

const SIZE = 1240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_INNER = 150;
const R0 = 232;
const R1 = 452;

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

/* ------------------------------------------------------------------ 渲染 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const px = (r, a) => CX + Math.cos(a) * r;
const py = (r, a) => CY + Math.sin(a) * r;

/** 分区色：按臂序号排成一圈色环（与 dsh-plugin-mesh 的做法同源，但这里位置由分区语义决定） */
function zoneColor(index, total) {
  return `hsl(${Math.round((200 + index * (360 / Math.max(1, total))) % 360)} 62% 62%)`;
}

/**
 * 把图渲染成构建期就画好的 SVG。交互（切换派生边、hover 高亮邻居）由 pedia.js 渐进增强。
 */
export function renderGraphSvg(graph) {
  const pos = new Map();
  const parts = [];
  const centerNode = graph.nodes.find((n) => n.id === graph.center);
  if (centerNode) pos.set(centerNode.id, { x: CX, y: CY, r: 0, color: '#3fd0bd' });

  // 外圈：分区为臂（角度按 registry 的 zoneOrder，臂内按 id 排序，交错量确定）
  const arms = graph.zones;
  const colorOf = new Map();
  arms.forEach((zone, zi) => {
    colorOf.set(zone.id, zoneColor(zi, arms.length));
    const a0 = (zi / arms.length) * Math.PI * 2 - Math.PI / 2;
    const members = graph.nodes.filter((n) => n.zone === zone.id && n.id !== graph.center);
    members.forEach((n, i) => {
      const t = members.length === 1 ? 0.62 : i / (members.length - 1);
      const r = R0 + (R1 - R0) * t;
      const zig = (i % 2 === 0 ? 1 : -1) * (Math.PI / arms.length) * 0.26 * (1 - t * 0.5);
      pos.set(n.id, { x: px(r, a0 + zig), y: py(r, a0 + zig), r: t, color: colorOf.get(zone.id) });
    });
  });

  // 内圈：跨分区类型（concept / tutorial / source）
  const inner = graph.nodes.filter((n) => n.band === 'inner' && n.id !== graph.center);
  inner.forEach((n, i) => {
    const a = (i / Math.max(1, inner.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, { x: px(R_INNER, a), y: py(R_INNER, a), r: -1, color: INNER_COLORS[n.kind] ?? '#9aa5b1' });
  });

  // 箭头标记
  parts.push('<defs>');
  for (const [key, def] of Object.entries(EDGE_GROUPS)) {
    if (!def.arrow) continue;
    const refs = key === 'relations'
      ? ['relations', ...[...RELATION_TYPES].map((t) => `rel-${t}`)]
      : [key];
    for (const id of refs) {
      parts.push(
        `<marker id="arw-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
          `<path d="M 0 0 L 10 5 L 0 10 z" fill="${def.color}"/></marker>`
      );
    }
  }
  parts.push('</defs>');

  // 臂底 + 臂名（标签画在画布内）
  arms.forEach((zone, zi) => {
    const a0 = (zi / arms.length) * Math.PI * 2 - Math.PI / 2;
    const half = Math.PI / arms.length;
    const P = (r, a) => `${px(r, a).toFixed(1)} ${py(r, a).toFixed(1)}`;
    parts.push(
      `<path class="graph__arm" d="M ${P(R_INNER + 26, a0 - half * 0.86)} L ${P(R1 + 34, a0 - half * 0.86)} ` +
        `A ${R1 + 34} ${R1 + 34} 0 0 1 ${P(R1 + 34, a0 + half * 0.86)} L ${P(R_INNER + 26, a0 + half * 0.86)} Z"/>`
    );
    const lr = R1 + 62;
    const lx = px(lr, a0);
    const ly = py(lr, a0);
    const cos = Math.cos(a0);
    const anchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
    parts.push(
      `<text class="graph__armlabel" x="${lx.toFixed(0)}" y="${ly.toFixed(0)}" text-anchor="${anchor}" ` +
        `fill="${colorOf.get(zone.id)}">${esc(zone.title)} <tspan class="graph__armcount">${zone.count}</tspan></text>`
    );
  });

  // 边
  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const def = EDGE_GROUPS[e.group] ?? EDGE_GROUPS.references;
    const dash = def.dash ? ` stroke-dasharray="${def.dash}"` : '';
    const markerId = e.group === 'relations' ? `rel-${e.type}` : e.group;
    const arrow = def.arrow ? ` marker-end="url(#arw-${markerId})"` : '';
    parts.push(
      `<line class="graph__edge graph__edge--${esc(e.group)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" ` +
        `x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
        `stroke="${def.color}" stroke-width="1.2"${dash}${arrow}><title>${esc(`${e.type}（${e.why}）`)}</title></line>`
    );
  }

  // 节点：方块。用 <a> 包住 → 无 JS 也能点进词条；<title> 自带悬停提示。
  // 颜色分工：**填充**是分区色（内联，确定性色环）；**描边与圆心色**交给 CSS 的令牌——
  // 站点有明暗主题与三套主题色（accent.css），硬编码会跟不上。
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const isCenter = n.id === graph.center;
    const size = isCenter ? 26 : n.completeness >= 95 ? 14 : n.completeness >= 88 ? 11 : 8;
    const zoneLabel = n.zone ? arms.find((z) => z.id === n.zone)?.title ?? n.zone : '跨分区';
    const tip = `${n.title}（${n.id}）· ${isCenter ? '圆心 · ' : ''}${zoneLabel}${
      n.completeness != null ? ` · 完整度 ${n.completeness}%` : ''
    }${n.status === 'draft' ? ' · 草稿' : ''}`;
    parts.push(
      `<a class="graph__node${isCenter ? ' graph__node--center' : ''}" href="${esc(`${n.kind}/${n.n}.html`)}" data-id="${esc(n.id)}">` +
        `<title>${esc(tip)}</title>` +
        `<rect x="${(p.x - size / 2).toFixed(1)}" y="${(p.y - size / 2).toFixed(1)}" width="${size}" height="${size}" ` +
        `fill="${isCenter ? 'currentColor' : p.color}"/>` +
        '</a>'
    );
  }
  if (centerNode) {
    parts.push(
      `<text class="graph__centerlabel" x="${CX}" y="${(CY + 42).toFixed(0)}" text-anchor="middle">${esc(centerNode.title)}</text>`
    );
  }

  return (
    `<svg class="graph__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" height="auto" ` +
    `role="img" aria-label="DSH 百科生态全景图：${graph.counts.nodes} 个词条、${graph.counts.edges} 条关系" ` +
    `data-nodes="${graph.counts.nodes}" data-edges="${graph.counts.edges}">${parts.join('')}</svg>`
  );
}
