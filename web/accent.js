/* 主题色选择器（独立文件：与 pedia.js 解耦，避免与并行改动互相覆盖）
 *
 * 为什么单独一个文件：pedia.js 是那个"大渲染器"，别人也在改它；主题色是本站自己的
 * 一层，放这里两边互不干扰。侧栏由 pedia.js 异步搭好，所以这里等它出现再挂进去。
 */
(function () {
  'use strict';

  var STORE = 'dsh-pedia-accent';
  var ACCENTS = [
    { id: 'ocean', label: '海洋蓝（默认）' },
    { id: 'deepseek', label: 'DeepSeek 蓝' },
    { id: 'teal', label: '青绿' }
  ];
  // 手机地址栏颜色跟着主题色 + 明暗走
  var META = {
    ocean: { light: '#2f6fb8', dark: '#7cc4ff' },
    deepseek: { light: '#4d6bfe', dark: '#8b9dff' },
    teal: { light: '#0f7a70', dark: '#3fd0bd' }
  };

  function current() {
    return document.documentElement.getAttribute('data-accent') || 'ocean';
  }

  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function syncMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var pair = META[current()] || META.ocean;
    meta.setAttribute('content', isDark() ? pair.dark : pair.light);
  }

  function setAccent(id) {
    // 海洋是默认色：不写属性，accent.css 里的 :root 就是它
    if (id === 'ocean') document.documentElement.removeAttribute('data-accent');
    else document.documentElement.setAttribute('data-accent', id);
    try {
      if (id === 'ocean') localStorage.removeItem(STORE);
      else localStorage.setItem(STORE, id);
    } catch (e) { /* 无痕模式等：不持久化也能用 */ }
    var dots = document.querySelectorAll('.accent__dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('aria-pressed', dots[i].getAttribute('data-accent') === id ? 'true' : 'false');
    }
    syncMeta();
  }

  function buildPicker() {
    var row = document.createElement('div');
    row.className = 'accent';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '主题色');
    ACCENTS.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'accent__dot accent__dot--' + a.id;
      b.title = a.label;
      b.setAttribute('aria-label', a.label + '主题色');
      b.setAttribute('data-accent', a.id);
      b.setAttribute('aria-pressed', a.id === current() ? 'true' : 'false');
      b.addEventListener('click', function () { setAccent(a.id); });
      row.appendChild(b);
    });
    return row;
  }

  function mount() {
    var tools = document.querySelector('.masthead__tools');
    if (!tools || tools.querySelector('.accent')) return false;
    tools.appendChild(buildPicker());
    return true;
  }

  if (!mount()) {
    // 侧栏还没搭好：轮询 + MutationObserver 双保险，8 秒后放弃（不影响别的功能）
    var tries = 0;
    var timer = setInterval(function () {
      if (mount() || ++tries > 40) clearInterval(timer);
    }, 100);
    if (window.MutationObserver) {
      var obs = new MutationObserver(function () { if (mount()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 8000);
    }
  }

  // 明暗切换时同步地址栏颜色
  if (window.MutationObserver) {
    new MutationObserver(syncMeta).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme', 'data-accent']
    });
  }
  syncMeta();
})();
