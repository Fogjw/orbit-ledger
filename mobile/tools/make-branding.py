#!/usr/bin/env python3
"""生成 Android 启动图标/启动图：石墨底、黄铜轨道、象牙主星、朱砂伴星。"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'android/app/src/main/res'
BG = (7, 10, 9, 255)
BRASS = (176, 141, 87, 255)
BRASS_DIM = (176, 141, 87, 90)
IVORY = (232, 226, 210, 255)
CINNABAR = (201, 106, 90, 255)
PATINA = (127, 176, 164, 255)
S = 1024


def mark_layer():
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 两条轨道：外圈黄铜，内圈细铜
    d.ellipse((128, 360, 896, 664), outline=BRASS, width=22)
    d.ellipse((205, 420, 819, 604), outline=BRASS_DIM, width=5)
    # 轨道上的两颗小星：朱砂/石绿
    d.ellipse((775, 355, 825, 405), fill=CINNABAR)
    d.ellipse((245, 690, 273, 718), fill=PATINA)
    # 中心八芒星
    cx, cy = 512, 512
    pts = []
    for i in range(16):
        r = 145 if i % 4 == 0 else (72 if i % 2 == 0 else 34)
        import math
        a = -math.pi / 2 + i * math.pi / 8
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.polygon(pts, fill=IVORY)
    d.ellipse((cx - 19, cy - 19, cx + 19, cy + 19), fill=BRASS)
    # 倾斜 -18°：星图不是正圆
    return layer.rotate(-18, resample=Image.Resampling.BICUBIC, center=(S / 2, S / 2))


def full_icon(scale=0.92):
    im = Image.new('RGBA', (S, S), BG)
    layer = mark_layer()
    if scale != 1:
        w = int(S * scale)
        layer = layer.resize((w, w), Image.Resampling.LANCZOS)
        im.alpha_composite(layer, ((S - w) // 2, (S - w) // 2))
    else:
        im.alpha_composite(layer)
    return im


def foreground():
    # adaptive icon 的前景要留安全区：只画图形，透明底
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    layer = mark_layer()
    w = int(S * 0.62)
    layer = layer.resize((w, w), Image.Resampling.LANCZOS)
    im.alpha_composite(layer, ((S - w) // 2, (S - w) // 2))
    return im


def main():
    full = full_icon()
    fg = foreground()
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for dpi, px in sizes.items():
        out = ROOT / f'mipmap-{dpi}'
        out.mkdir(exist_ok=True)
        for name in ('ic_launcher.png', 'ic_launcher_round.png'):
            full.resize((px, px), Image.Resampling.LANCZOS).save(out / name)
        # adaptive foreground 用更高分辨率（108dp 的 2x）
        fg.resize((px * 2, px * 2), Image.Resampling.LANCZOS).save(out / 'ic_launcher_foreground.png')
    # 启动图：深色底 + 居中星图；各 drawable 目录统一 1080×1920
    splash = Image.new('RGBA', (1080, 1920), BG)
    m = mark_layer().resize((520, 520), Image.Resampling.LANCZOS)
    splash.alpha_composite(m, (280, 700))
    for p in ROOT.rglob('splash.png'):
        splash.resize((1080, 1920), Image.Resampling.LANCZOS).save(p)
    print('branding written')


if __name__ == '__main__':
    main()
