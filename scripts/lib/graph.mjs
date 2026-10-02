/**
 * graph.mjs —— 生态全景图（docs/01 §路由 `#/graph`、docs/02 §产物 `graph.json`）。
 *
 * 两条铁律，和整站一致：
 *   1. **确定性**：不写时间戳、不用 Math.random、一切按 id 排序 → 同一份数据逐字节一致。
 *   2. **可解释**：每条边都带 `why`（它是从哪个字段来的）与 `type`（是什么关系）。
 *      「像不像」不算关系——本项目只画**能指到出处**的边，相似度不进来。
 *
 * 边一共六类，前四类是我们的语义数据，后两类是派生事实：
 *   relations（前置/推荐/冲突/替代/联动，目前 0 条）· prereq（前置）· related（相关）
 *   tutorial（教程引用了它）· pack（整合包引用了它）· wiki（正文里提到了它，默认不画）
 */
import { compareIds } from './util.mjs';

/** 边的展示定义：颜色 / 线型 / 是否画箭头 / 默认是否可见 / 中文名 */
export const EDGE_TYPES = {
  relations: { zh: '关系（前置/联动/冲突…）', color: '#c98ac9', dash: null, arrow: true, defaultOn: true },
  prereq: { zh: '前置', color: '#b09ae8', dash: null, arrow: true, defaultOn: true },
  related: { zh: '相关', color: '#8bbf5e', dash: null, arrow: false, defaultOn: true },
  tutorial: { zh: '教程引用', color: '#f0a42a', dash: '6 4', arrow: false, defaultOn: true },
  pack: { zh: '整合包引用', color: '#5aa8e8', dash: '2 4', arrow: false, defaultOn: true },
  wiki: { zh: '正文提到（派生）', color: '#9aa5b1', dash: '1 5', arrow: false, defaultOn: false },
};

/** 跨分区类型：它们不属于任何一层，画在内圈 */
const CROSS_KINDS = new Set(['concept', 'tutorial', 'source']);
const INNER_COLORS = { concept: '#7fd3c8', tutorial: '#f0a42a', source: '#5aa8e8' };

const SIZE = 1240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_INNER = 150;
const R0 = 232;
const R1 = 452;

/**
 * 从构建期模型里算出图数据。
 * @param {{model: object, entryOutputs: Map<string, object>, reverse: object}} input
 */
export function buildGraph({ model, entryOutputs, reverse }) {
  const outputs = [...entryOutputs.values()].filter((o) => o.status !== 'deleted');
  const byId = new Map(outputs.map((o) => [o.id, o]));

  const zoneOrder = model.registry?.data?.zoneOrder ?? [];
  const zoneTitle = new Map((model.zones ?? []).map((z) => [z.zone, z.data?.title ?? z.zone]));

  // ---- 节点 --------------------------------------------------------------
  const centerId = byId.has('plugin/1') ? 'plugin/1' : [...byId.keys()].sort(compareIds)[0] ?? null;
  const nodes = outputs.map((o) => {
    const zoneId = o.zone && o.zone.id ? o.zone.id : null;
    return {
      id: o.id,
      kind: o.kind,
      n: o.n,
      title: o.title ?? o.id,
      zone: zoneId,
      band: zoneId ? 'outer' : 'inner',
      // 完整度分三档决定方块大小（8 / 11 / 14）
      completeness: o.completeness?.score ?? null,
      status: o.status ?? 'published',
    };
  });
  nodes.sort((a, b) => compareIds(a.id, b.id));

  // ---- 边 ----------------------------------------------------------------
  const edges = [];
  const seen = new Set();
  const add = (source, target, type, why) => {
    if (!byId.has(source) || !byId.has(target) || source === target) return;
    const key = `${source}|${target}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, type, why });
  };

  for (const entry of model.entries) {
    if (!entry.data || !byId.has(entry.id)) continue;
    const data = entry.data;
    for (const rel of Array.isArray(data.relations) ? data.relations : []) {
      const target = typeof rel?.target === 'string' ? rel.target.trim() : null;
      if (target) add(entry.id, target, 'relations', `front-matter: relations.${rel?.type ?? '?'}`);
    }
    // prereq：本词条需要先读的那一条（有向：我 → 前置）
    for (const target of Array.isArray(data.prereq) ? data.prereq : []) {
      if (typeof target === 'string') add(entry.id, target.trim(), 'prereq', 'front-matter: prereq');
    }
    for (const target of Array.isArray(data.related) ? data.related : []) {
      if (typeof target === 'string') add(entry.id, target.trim(), 'related', 'front-matter: related');
    }
  }
  // 教程引用了它 / 整合包引用了它：构建期派生（反向索引）
  for (const out of outputs) {
    for (const t of out.referencedByTutorials ?? []) add(String(t), out.id, 'tutorial', '反向索引：教程引用');
    for (const b of out.backlinks ?? []) add(out.id, b.id, 'wiki', '反向索引：正文提到');
  }
  for (const item of reverse?.plugins ?? []) {
    if (!item.entryId) continue;
    for (const p of item.packs ?? []) add(String(p), item.entryId, 'pack', '反向索引：整合包引用');
  }
  edges.sort((a, b) => compareIds(a.source, b.source) || compareIds(a.target, b.target) || (a.type < b.type ? -1 : 1));

  const byType = {};
  for (const e of edges) byType[e.type] = (byType[e.type] ?? 0) + 1;

  const usedZones = zoneOrder.filter((z) => nodes.some((n) => n.zone === z));
  const extraZones = [...new Set(nodes.map((n) => n.zone).filter((z) => z && !usedZones.includes(z)))].sort();

  return {
    center: centerId,
    size: SIZE,
    zones: [...usedZones, ...extraZones].map((id) => ({
      id,
      title: zoneTitle.get(id) ?? id,
      count: nodes.filter((n) => n.zone === id).length,
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

/** 极坐标 → 画布坐标 */
const px = (r, a) => CX + Math.cos(a) * r;
const py = (r, a) => CY + Math.sin(a) * r;

/**
 * 把图渲染成**构建期就画好**的 SVG：无 JS 也能看，且逐字节确定。
 * 交互（切换提及边、hover 高亮邻居）由 pedia.js 在这份 DOM 上做渐进增强。
 */
export function renderGraphSvg(graph) {
  const pos = new Map();
  const parts = [];

  // 圆心
  const center = graph.nodes.find((n) => n.id === graph.center);
  if (center) pos.set(center.id, { x: CX, y: CY, r: 0 });

  // 外圈：分区为臂。臂的角度按 registry 的 zoneOrder 定，臂内按 id 排序、
  // 半径在外圈区间里交错，避免排成一条直线（交错量是确定的，不用随机数）。
  const arms = graph.zones;
  arms.forEach((zone, zi) => {
    const a0 = (zi / arms.length) * Math.PI * 2 - Math.PI / 2;
    const members = graph.nodes.filter((n) => n.zone === zone.id && n.id !== graph.center);
    members.forEach((n, i) => {
      const t = members.length === 1 ? 0.62 : i / (members.length - 1);
      const r = R0 + (R1 - R0) * t;
      const zig = (i % 2 === 0 ? 1 : -1) * (Math.PI / arms.length) * 0.28 * (1 - t * 0.5);
      pos.set(n.id, { x: px(r, a0 + zig), y: py(r, a0 + zig), r: (r - R0) / (R1 - R0) });
    });
  });

  // 内圈：跨分区类型（概念 / 教程 / 资源源）——它们不属于任何一层，画成内环
  const inner = graph.nodes.filter((n) => n.band === 'inner' && n.id !== graph.center);
  inner.forEach((n, i) => {
    const a = (i / Math.max(1, inner.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, { x: px(R_INNER, a), y: py(R_INNER, a), r: -1 });
  });

  // 图例用的箭头标记
  parts.push(`<defs>`);
  for (const [key, def] of Object.entries(EDGE_TYPES)) {
    if (!def.arrow) continue;
    parts.push(
      `<marker id="arw-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
        `<path d="M 0 0 L 10 5 L 0 10 z" fill="${def.color}"/></marker>`
    );
  }
  parts.push(`</defs>`);

  // 臂的背景扇形 + 臂名（标签画在画布内，避免溢出）
  arms.forEach((zone, zi) => {
    const a0 = (zi / arms.length) * Math.PI * 2 - Math.PI / 2;
    const half = Math.PI / arms.length;
    const P = (r, a) => `${px(r, a).toFixed(1)} ${py(r, a).toFixed(1)}`;
    parts.push(
      `<path class="graph__arm" data-zone="${esc(zone.id)}" d="M ${P(R_INNER + 26, a0 - half * 0.86)} L ${P(R1 + 34, a0 - half * 0.86)} ` +
        `A ${R1 + 34} ${R1 + 34} 0 0 1 ${P(R1 + 34, a0 + half * 0.86)} L ${P(R_INNER + 26, a0 + half * 0.86)} Z"/>`
    );
    const lr = R1 + 62;
    const lx = px(lr, a0);
    const ly = py(lr, a0);
    const cos = Math.cos(a0);
    const anchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
    parts.push(
      `<text class="graph__armlabel" x="${lx.toFixed(0)}" y="${ly.toFixed(0)}" text-anchor="${anchor}">` +
        `${esc(zone.title)} <tspan class="graph__armcount">${zone.count}</tspan></text>`
    );
  });

  // 边（先画边，节点压在上面）
  for (const e of graph.edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (!a || !b) continue;
    const def = EDGE_TYPES[e.type] ?? EDGE_TYPES.wiki;
    const dash = def.dash ? ` stroke-dasharray="${def.dash}"` : '';
    const arrow = def.arrow ? ` marker-end="url(#arw-${e.type})"` : '';
    parts.push(
      `<line class="graph__edge graph__edge--${esc(e.type)}" data-source="${esc(e.source)}" data-target="${esc(e.target)}" ` +
        `x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
        `stroke="${def.color}" stroke-width="1.2"${dash}${arrow}/>`
    );
  }

  // 节点：方块（延续站点的像素风）。用 <a> 包住 → 无 JS 也能点进词条；<title> 自带悬停提示。
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const isCenter = n.id === graph.center;
    const size = isCenter ? 26 : n.completeness >= 95 ? 14 : n.completeness >= 88 ? 11 : 8;
    const fill = n.zone
      ? `hsl(${(arms.findIndex((z) => z.id === n.zone) * (360 / Math.max(1, arms.length)) + 200) % 360} 62% 62%)`
      : INNER_COLORS[n.kind] ?? '#9aa5b1';
    const href = `${n.kind}/${n.n}.html`;
    const tip = `${n.title}（${n.id}）· ${isCenter ? '圆心 · ' : ''}${
      n.zone ? arms.find((z) => z.id === n.zone)?.title ?? n.zone : '跨分区'
    }${n.completeness != null ? ` · 完整度 ${n.completeness}%` : ''}`;
    parts.push(
      `<a class="graph__node${isCenter ? ' graph__node--center' : ''}" href="${esc(href)}" data-id="${esc(n.id)}">` +
        `<title>${esc(tip)}</title>` +
        `<rect x="${(p.x - size / 2).toFixed(1)}" y="${(p.y - size / 2).toFixed(1)}" width="${size}" height="${size}" ` +
        `fill="${isCenter ? '#3fd0bd' : fill}"${isCenter ? '' : ' stroke="#0e1f1d" stroke-width="1.2"'}/>` +
        `</a>`
    );
  }
  if (center) {
    parts.push(
      `<text class="graph__centerlabel" x="${CX}" y="${(CY + 40).toFixed(0)}" text-anchor="middle">${esc(center.title)}</text>`
    );
  }

  return (
    `<svg class="graph__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" ` +
    `width="${SIZE}" height="${SIZE}" role="img" aria-label="DSH 生态全景图：${graph.counts.nodes} 个词条、${graph.counts.edges} 条关系" ` +
    `data-nodes="${graph.counts.nodes}" data-edges="${graph.counts.edges}">${parts.join('')}</svg>`
  );
}
