# -*- coding: utf-8 -*-
"""生成一张示例封面（作者自定义封面的样板）。

约定：图放仓库 `covers/` 下，词条 front-matter 写 `cover: covers/<file>.png`。
本站**不裁不压**（零依赖、没有图像库），所以尺寸与体积由作者负责：
建议 16:10、1200×750 左右、≤ 300KB（png / jpg / webp，**不要 SVG**）。

这张样板用站点配色（墨绿瓷砖 + 白文档 + 琥珀高亮）画一个像素风标题卡，
尺寸 1200×750，跑法：python make-sample-cover.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 750
BG = (18, 121, 111)          # 站点主色（主题色 #12796f）
TILE = (14, 96, 88)          # 深一档的瓷砖
CARD = (252, 252, 250)
INK = (28, 30, 34)
MUTED = (110, 116, 126)
AMBER = (214, 158, 46)

FONTS = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhl.ttc", r"C:\Windows\Fonts\simhei.ttf"]


def font(size):
    for p in FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 像素瓷砖底纹
for y in range(0, H, 50):
    for x in range(0, W, 50):
        if (x // 50 + y // 50) % 2 == 0:
            d.rectangle([x, y, x + 50, y + 50], fill=TILE)

# 白色文档卡（站点 logo 的意象）
card = [90, 120, W - 90, H - 120]
d.rounded_rectangle(card, radius=18, fill=CARD)
d.rectangle([card[0] + 28, card[1] + 26, card[0] + 40, card[3] - 26], fill=AMBER)

x0 = card[0] + 92
y = card[1] + 64
d.text((x0, y), "dsh-pack-plugin", font=font(30), fill=MUTED)
y += 52
d.text((x0, y), "整合包管理插件", font=font(64), fill=INK)
y += 104
d.text((x0, y), "在 DSH 界面里导出 / 安装 .dspack、切换 profile、浏览市场", font=font(26), fill=MUTED)
y += 44
d.text((x0, y), "零官方源码改动 · 双半端 · 宿主运行时只依赖一个 ZIP 库", font=font(26), fill=MUTED)

# 底部标签条
y = card[3] - 96
for i, t in enumerate(("插件", "bundle + client", "MIT", "DSH百科")):
    w = d.textlength(t, font=font(22)) + 34
    d.rounded_rectangle([x0 + i * 0, y, x0 + i * 0 + w, y + 44], radius=10, fill=(238, 240, 244))
    d.text((x0 + i * 0 + 17, y + 9), t, font=font(22), fill=INK)
    x0 += w + 12

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plugin-2.png")
img.save(out, optimize=True)
print("saved:", out, img.size, str(round(os.path.getsize(out) / 1024)) + "KB")
