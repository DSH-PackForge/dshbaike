# 一次性素材准备：从大肥鱼精灵图里取「待机 + 行走循环」，规范化成两套横排精灵。
#
# 注意：本脚本不属于构建链（CI 不跑它），它需要 Pillow，只在换素材时手动执行一次。
# 产物入库；来源、作者、许可与「已作修改」的说明见 docs/08 §9 与 web/mascot-CREDITS.txt。
#
# 用法：python scripts/prepare-mascot.py [源精灵图路径]
#   默认读 .tmp/ref/fatfish/spritesheet.webp（从上游仓库取，见 CREDITS）
from PIL import Image
import numpy as np
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".tmp/ref/fatfish/spritesheet.webp")
WEB = pathlib.Path("web")
COLS, ROWS = 8, 11
CANVAS = 192          # 每帧画布：正方形，显示尺寸取其一半（2× 供高 DPI），换帧偏移正好 96px
DISPLAY = CANVAS // 2

sheet = Image.open(SRC).convert("RGBA")
cw, ch = sheet.size[0] // COLS, sheet.size[1] // ROWS
print(f"源 {sheet.size[0]}×{sheet.size[1]}，每格 {cw}×{ch}")

def cell(r, c):
    return sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))

# 待机行 r00 有 6 帧：先看它们之间差在哪，才知道有没有眨眼帧值得做成两帧
idle_src = [cell(0, c) for c in range(6)]
base = np.asarray(idle_src[0]).astype(np.int16)
print("待机帧与第 1 帧的差异像素数：", [int((np.abs(np.asarray(f).astype(np.int16) - base).sum(axis=2) > 12).sum()) for f in idle_src])

walk_src = [cell(1, c) for c in range(8)]

def normalize(frames, label):
    """把一组帧按「同一外框」裁切后，底边居中放进正方形画布：换帧时人物不会跳。"""
    boxes = [f.getbbox() for f in frames]
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    crop = (x0, y0, x1, y1)
    gw, gh = x1 - x0, y1 - y0
    scale = min((CANVAS - 8) / gw, (CANVAS - 8) / gh)
    out = []
    for f in frames:
        piece = f.crop(crop)
        piece = piece.resize((max(1, round(gw * scale)), max(1, round(gh * scale))), Image.LANCZOS)
        canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        canvas.paste(piece, ((CANVAS - piece.size[0]) // 2, CANVAS - 4 - piece.size[1]), piece)
        out.append(canvas)
    strip = Image.new("RGBA", (CANVAS * len(out), CANVAS), (0, 0, 0, 0))
    for i, f in enumerate(out):
        strip.paste(f, (i * CANVAS, 0))
    path = WEB / f"mascot-fatfish-{label}.png"
    # 32 位 PNG 太肥（行走 8 帧要 333KB），量化到 160 色仍是 PNG：约 1/5 体积，
    # 96px 显示尺寸下几乎看不出差别（128 色时头发渐变的色带已经能看见了）。
    strip.quantize(colors=160, method=Image.FASTOCTREE).save(path, optimize=True)
    print(f"{path}  {strip.size[0]}×{strip.size[1]}（{len(out)} 帧，每帧 {CANVAS}×{CANVAS}，"
          f"显示 {DISPLAY}×{DISPLAY}，{path.stat().st_size / 1024:.1f} KB）")
    return strip

idle_strip = normalize(idle_src, "idle")
walk_strip = normalize(walk_src, "walk")

# 预览：亮底 / 暗底各一张，按实际显示尺寸（一半）横排
def preview(strip, frames, path, bg):
    fw = strip.size[0] // frames
    im = strip.resize((fw // 2 * frames, CANVAS // 2), Image.LANCZOS)
    sheet_out = Image.new("RGB", (im.size[0] + 32, im.size[1] + 32), bg)
    sheet_out.paste(im, (16, 16), im)
    sheet_out.save(path)

out = pathlib.Path(".tmp")
preview(walk_strip, 8, out / "fatfish-walk-light.png", (255, 255, 255))
preview(walk_strip, 8, out / "fatfish-walk-dark.png", (20, 24, 29))
preview(idle_strip, 6, out / "fatfish-idle-light.png", (255, 255, 255))
print("预览 → .tmp/fatfish-walk-*.png、.tmp/fatfish-idle-light.png")
