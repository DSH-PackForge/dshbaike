/* 索引页内链（给人看的那一层）
 *
 * 为什么需要：构建期已经把「按标签/平台浏览」写进预渲染，但前端接管后会把它整个移除，
 * 所以真实用户看不到那些入口——只有爬虫看得到。这个文件把那行也挂到真实页面上，
 * 让人和爬虫看到同一批链接。
 *
 * 单独一个文件、不改 pedia.js：pedia.js 是那个大渲染器，别人也在改它。
 *
 * 标签从哪来（两种页面不一样，实测）：
 *   · 分区页：筛选 chip 与卡片标签都带 data-tag → 直接收集页面上的即可；
 *   · 词条页：**根本没有 data-tag**（标签不是 chip 形式）→ 只能读该词条的 JSON。
 */
(function () {
  'use strict';

  var BASE = (window.__PEDIA_BASE__ || './');

  function pageKind() {
    return (document.body && document.body.getAttribute('data-page')) || 'index';
  }

  /** 页面上出现过的标签名（分区页的筛选 chip 与卡片标签都带 data-tag） */
  function tagsOnPage() {
    var set = [];
    var nodes = document.querySelectorAll('[data-tag]');
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].getAttribute('data-tag');
      if (t && t !== '*' && set.indexOf(t) < 0) set.push(t);
    }
    return set;
  }

  function buildRow(hits, dimZh) {
    var p = document.createElement('p');
    p.className = 'faint indexlinks';
    p.appendChild(document.createTextNode('按' + dimZh + '浏览：'));
    hits.forEach(function (h, i) {
      if (i) p.appendChild(document.createTextNode(' · '));
      var a = document.createElement('a');
      a.href = h.kind + '/' + h.slug + '.html';
      a.textContent = h.name;
      p.appendChild(a);
      p.appendChild(document.createTextNode('（' + h.count + '）'));
    });
    return p;
  }

  function mount(indexes, names, allowRetry) {
    if (document.querySelector('.indexlinks')) return true; // 已经挂过
    if (!names.length) return !allowRetry; // 还没拿到名字：可重试时返回 false
    var hits = [];
    indexes.forEach(function (i) {
      if (i.kind === 'tag' && names.indexOf(i.name) >= 0 && !hits.some(function (h) { return h.slug === i.slug; })) hits.push(i);
    });
    if (!hits.length) return true; // 这一页的标签都没有索引页（门槛不足 2 条），不挂

    var host = document.querySelector('.filterbar') || document.querySelector('.tagset') ||
      document.querySelector('.titlebar__badges');
    if (!host) return false; // 外壳还没搭好，等下一轮
    var row = buildRow(hits, '标签');
    if (host.classList.contains('filterbar')) {
      row.style.flexBasis = '100%'; // 在横向排布的筛选条里独占一行
      row.style.margin = '4px 0 0';
    }
    host.appendChild(row);
    return true;
  }

  /** 词条页：标签不在 DOM 里，读该词条的 JSON */
  function entryTags(done) {
    var P = window.__PEDIA__ || {};
    if (P.page !== 'entry' || !P.kind || P.n === null || P.n === undefined) return done([]);
    fetch(BASE + 'data/entries/' + P.kind + '-' + P.n + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (e) { done((e && e.tags) || []); })
      .catch(function () { done([]); });
  }

  function start() {
    fetch(BASE + 'data/indexes/index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var indexes = (data && data.indexes) || [];
        if (!indexes.length) return;
        var kind = pageKind();
        var names = tagsOnPage();
        var retryable = kind === 'zone' || kind === 'entry';

        if (kind === 'entry' && !names.length) {
          // 词条页没有 chip：等 JSON 回来再挂
          entryTags(function (tags) {
            if (!mount(indexes, tags, false)) retryMount(indexes, tags);
          });
          return;
        }
        if (!mount(indexes, names, retryable)) retryMount(indexes, names);
      })
      .catch(function () { /* 拿不到映射就什么都不做，不影响页面 */ });
  }

  /** 外壳（顶栏/侧栏/正文）是 pedia.js 异步搭的：轮询 + MutationObserver 双保险 */
  function retryMount(indexes, names) {
    var tries = 0;
    var timer = setInterval(function () {
      var names2 = names.length ? names : tagsOnPage();
      if (mount(indexes, names2, true) || ++tries > 50) clearInterval(timer);
    }, 150);
    // 只用轮询，不用 MutationObserver：后者挂在 document.body 的 subtree 上，
    // 渲染分区页时会被触发成百上千次（每次都要重跑一次全文档查询），
    // 而这里每 150ms 轮询一次足够（最多 50 次、命中即停，开销可以忽略）。
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
