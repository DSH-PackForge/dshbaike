#!/usr/bin/env bash
# 第 5 类机器代改（新增词条）的隔离彩排。
#
# 为什么必须隔离跑：这个操作会**真的领号**（写 data/registry.yml）。在真仓库里试一次
# 就吃掉一个永久编号，所以整棵 dsh-pedia 拷到临时目录里跑。
#
# 用法：bash scripts/test-new-entry.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== 1) 拷一棵临时工作树（不碰真仓库）=="
cp -r "$REPO_DIR" "$WORK/pedia"
cd "$WORK/pedia"
git rev-parse --short HEAD >/dev/null 2>&1 || true

cat > "$WORK/pedia/_drive.mjs" <<'DRIVER'
// 合成表单 → 跑 new-entry 操作 → 落盘（模拟 apply-issue 的调用方）。
const mode = process.argv[2] || 'ok';
const forms = {
  ok: {
    'GitHub 用户名': 'yyh-001',
    '词条类型': 'launcher（启动器）',
    '标题': 'DSH-Z · 彩排用合成启动器',
    '一句话摘要': '彩排用的合成词条，不进入真仓库。',
    '初稿正文（可选）': '## 它是什么\n\n彩排正文。',
    '事实来源': 'https://example.invalid/spec/9.1',
  },
  same: null, // 与 ok 同一份表单（测幂等）
  'miss-source': null,
  'bad-kind': null,
};
const form = { ...(forms.ok) };
if (mode === 'miss-source') delete form['事实来源'];
if (mode === 'bad-kind') form['词条类型'] = '不存在的类型';

const { OPS } = await import('./scripts/lib/ops.mjs');
const op = OPS['new-entry'];
const r = op.apply({ form, target: '' });
if (!r.ok) {
  console.log('RESULT fail ' + r.reason + ' ' + r.message);
  process.exit(0);
}
for (const w of r.writes) {
  const fs = await import('node:fs');
  fs.writeFileSync(w.path, w.text);
}
console.log('RESULT ok ' + r.id + ' credited=' + r.credited + ' changed=' + r.changed);
DRIVER

echo "== 2) 第一次领号（launcher 现有 1..9，应当拿到 10）=="
OUT="$(node "_drive.mjs" ok)"
echo "  $OUT"
echo "$OUT" | grep -q 'RESULT ok launcher/10 ' && ok "领到 launcher/10" || bad "没领到 launcher/10：$OUT"
[ -f data/launcher/10.md ] && ok "词条文件已生成 data/launcher/10.md" || bad "词条文件没生成"
grep -q '^status: draft' data/launcher/10.md && ok "骨架是 draft（不合并就不上线）" || bad "骨架不是 draft"
grep -q '彩排用的合成词条' data/launcher/10.md && ok "表单的「一句话摘要」写进了 summary" || bad "摘要没写进去"
grep -q '## 事实来源' data/launcher/10.md && ok "正文带「事实来源」一节" || bad "正文缺事实来源"
grep -q 'example.invalid/spec/9.1' data/launcher/10.md && ok "来源链接原样保留（维护者可核对）" || bad "来源链接丢了"
echo "$OUT" | grep -q 'credited=yyh-001' && ok "署名 = 表单里的 GitHub 用户名" || bad "署名不对"

echo "== 3) registry：条目与计数器都到位 =="
grep -q '彩排用合成启动器' data/registry.yml && ok "registry 里有这条记录" || bad "registry 里没有记录"
grep -qE '^\s+launcher:\s*10' data/registry.yml && ok "counters.launcher = 10" || bad "counters 没更新"

echo "== 4) 校验器认它（draft 态宽松，但不能报 error）=="
set +e
VL="$(node scripts/validate.mjs 2>&1)"; VRC=$?
set -e
echo "$VL" | tail -n 1 | sed 's/^/  /'
if [ $VRC -eq 0 ]; then ok "validate 通过（含新草稿）"; else bad "validate 失败：$(echo "$VL" | tail -n 3)"; fi

echo "== 5) 幂等：同一份表单再跑一次，必须复用编号、不再吃号 =="
OUT2="$(node "_drive.mjs" same)"
echo "  $OUT2"
echo "$OUT2" | grep -q 'RESULT ok launcher/10 ' && ok "复用了 launcher/10（没有变成 11）" || bad "又吃了一个号：$OUT2"
[ ! -f data/launcher/11.md ] && ok "没有生成 11.md" || bad "生成了 11.md（吃号了）"
grep -qE '^\s+launcher:\s*10' data/registry.yml && ok "counters.launcher 仍是 10" || bad "counters 被重复加"

echo "== 6) 表单不全 / 类型非法：拒绝而不是猜 =="
OUT3="$(node "_drive.mjs" miss-source)"
echo "  $OUT3"
echo "$OUT3" | grep -q 'RESULT fail incomplete' && ok "缺「事实来源」→ incomplete（拒绝）" || bad "缺来源竟然通过了：$OUT3"
OUT4="$(node "_drive.mjs" bad-kind)"
echo "  $OUT4"
echo "$OUT4" | grep -q 'RESULT fail incomplete' && ok "类型非法 → incomplete（拒绝）" || bad "类型非法竟然通过了：$OUT4"

echo
echo "== 结果：通过 $PASS 项，失败 $FAIL 项 =="
[ "$FAIL" -eq 0 ] || exit 1
