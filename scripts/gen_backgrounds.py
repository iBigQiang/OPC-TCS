#!/usr/bin/env python3
"""生成 backgrounds/ 下的渐变背景（SVG，3:4 竖图 1080x1440），并输出 backgrounds/manifest.json。

manifest.json 是本文件的生成物，手改会被下次重跑覆盖。加照片的正确姿势：
图片丢进 backgrounds/ → 在 PHOTOS 里加一行（文件名带 bj_<下一个未用序号>- 前缀）→ 重跑本脚本。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "backgrounds")

# (slug, 中文名, [渐变色停靠点], 渐变角度, 噪点透明度)。序号见 SVG_BASE。
PALETTES = [
    ("ink-dawn",     "墨色黎明", ["#0f1420", "#1c2a44", "#3b537a"], 160, 0.05, "渐变 深蓝 夜"),
    ("deep-forest",  "深林夜色", ["#0a1410", "#16302a", "#2e5747"], 150, 0.05, "渐变 深绿 夜"),
    ("ember",        "暮色余烬", ["#1a1210", "#4a2c1e", "#8a5a33"], 200, 0.06, "渐变 暖橙 暮色"),
    ("harbor",       "海港渐变", ["#0c1622", "#173754", "#2f6a8f"], 145, 0.05, "渐变 蓝 海港"),
    ("violet-night", "紫夜",     ["#120f1e", "#2c2250", "#5b4a8f"], 170, 0.05, "渐变 紫 夜"),
    ("slate",        "石板灰",   ["#15171c", "#2a2f38", "#4a525f"], 155, 0.04, "渐变 灰 极简"),
    ("plum-smoke",   "烟紫",     ["#1c1420", "#3d2438", "#6d4260"], 190, 0.05, "渐变 紫 烟"),
    ("midnight",     "午夜",     ["#05070c", "#0d1526", "#1d2f52"], 160, 0.04, "渐变 深蓝 午夜"),
    ("paper-warm",   "暖纸",     ["#efe8dc", "#e2d5c0", "#cdb99b"], 150, 0.05, "渐变 浅色 暖 纸"),
    ("mist",         "晨雾",     ["#dfe5ea", "#c3ced8", "#9fb0bf"], 160, 0.04, "渐变 浅色 灰蓝 雾"),
]

SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <defs>
    <linearGradient id="g" gradientTransform="rotate({angle} 0.5 0.5)">
      <stop offset="0%" stop-color="{c0}"/>
      <stop offset="55%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="{noise}"/></feComponentTransfer>
      <feComposite operator="over" in2="SourceGraphic"/>
    </filter>
  </defs>
  <rect width="1080" height="1440" fill="url(#g)"/>
  <rect width="1080" height="1440" fill="url(#glow)"/>
  <rect width="1080" height="1440" filter="url(#noise)" opacity="0.6" fill="none"/>
</svg>"""

# (文件名, 中文名, 搜索关键词)。显示名的三位序号从文件名的 bj_<n>- 派生，不在这里重复写——
# 两处各写一遍迟早会不一致。序号一次性固定、绝不按列表位置计算：往中间插图不该导致后面全部改名。
# 顺序即界面里的顺序，第一条是页面默认背景。
PHOTOS = [
    ("bj_1-ibigqiang.jpg",   "人物竖屏",   "人物 竖屏 写真 肖像"),
    ("bj_2-misty-marsh.jpg", "雾泽晨光",   "雾 湿地 晨光 自然"),
    ("bj_3-forest-coast.jpg", "森林海岸",  "森林 海岸 自然 绿色"),
    ("bj_4-pebble-beach.jpg", "冷调海滩",  "海滩 冷调 石滩 海"),
    ("bj_5-rocky-bay.jpg",   "礁石海湾",   "礁石 海湾 海 岩石"),
    ("bj_6-snow-peaks.jpg",  "雪山云影",   "雪山 雪景 云 山"),
    ("bj_7-dusk-forest.jpg", "暮色林线",   "森林 暮色 黄昏 树"),
    ("bj_8-flower-dusk.jpg", "花田黄昏",   "花田 黄昏 花 田野"),
    ("bj_9-golden-field.jpg", "金色草原",  "草原 金色 田野 秋"),
    ("bj_10-desert-dusk.jpg", "沙丘暮色",  "沙漠 沙丘 暮色 荒野"),
    ("bj_11-forest-path.jpg", "林间小路",  "森林 小路 树林 绿色"),
    ("bj_12-lighthouse.jpg", "灯塔黑白",   "灯塔 黑白 海 建筑"),
    ("bj_13-white-town.jpg", "白色小镇",   "小镇 白色 建筑 地中海"),
    ("bj_14-canal-town.jpg", "运河小镇",   "运河 小镇 水 建筑"),
    # 城市 / 街景
    ("bj_15-city-bridge-night.jpg", "大桥夜色",  "城市 大桥 夜景 灯光"),
    ("bj_16-london-night.jpg",      "伦敦夜色",  "城市 伦敦 夜景 街道"),
    ("bj_17-foggy-street.jpg",      "雾夜街灯",  "街道 雾 夜景 路灯"),
    ("bj_18-far-city-lights.jpg",   "远城灯火",  "城市 夜景 灯火 远景"),
    ("bj_19-city-rooftops.jpg",     "城市屋顶",  "城市 屋顶 建筑 俯瞰"),
    ("bj_20-city-crosswalk.jpg",    "街头行人",  "城市 街头 行人 斑马线"),
    ("bj_21-old-town-door.jpg",     "老城门廊",  "老城 门廊 建筑 复古"),
    ("bj_22-concrete-block.jpg",    "清水混凝土", "混凝土 建筑 极简 灰"),
    ("bj_23-vintage-cars.jpg",      "街角老爷车", "老爷车 街角 汽车 复古"),
    ("bj_24-cafe-silhouette.jpg",   "街角咖啡馆", "咖啡馆 街角 剪影 城市"),
    # 以下取自参考站图库，中文名与关键词沿用其源码里的定义
    ("bj_25-misty-valley.jpg",    "雾谷晨光", "山谷 自然 清晨 雾"),
    ("bj_26-mountain-valley.jpg", "山野远景", "山野 自然 蓝天"),
    ("bj_27-harbor-blue.jpg",     "海港蓝调", "香港 海港 城市 蓝调"),
    ("bj_28-city-night.jpg",      "城市夜行", "城市 夜景 街头"),
    ("bj_29-skyline.jpg",         "天际线",   "城市 高楼 天际线"),
    ("bj_30-cloud-mountain.jpg",  "群山云海", "群山 云海 自然"),
    ("bj_31-coast-road.jpg",      "海岸公路", "海岸 公路 旅行"),
    ("bj_32-forest-light.jpg",    "森林微光", "森林 自然 绿色"),
]

# 参考站的 travel-001..110。它源码里这批也是 Array.from 批量生成的，没有逐张起名。
# 关键词只写「旅行 素材」，不照搬源站那串「旅行 城市 山海 雪景 汽车 风景 建筑」——
# 照搬会让搜「城市」命中全部 110 张，把真正叫「城市屋顶」的那几张淹掉。
PHOTOS += [(f"bj_{32 + i}-travel-{i:03d}.jpg", "旅行素材", "旅行 素材") for i in range(1, 111)]


NUM_RE = re.compile(r"bj_(\d+)-")

# 渐变接在照片最大序号之后。这个值从 PHOTOS 派生而不是手写 142：手写的话它和
# travel 段的 `32 + i` 是同一套编号的两端却互不相关，往 PHOTOS 末尾加一张具名图
# 就会与渐变段撞号。
SVG_BASE = max(int(NUM_RE.match(fn).group(1)) for fn, _, _ in PHOTOS)


def numbered(file: str, name: str) -> str:
    """显示名 = 中文名 + 三位序号，序号取自文件名的 bj_<n>- 前缀。"""
    n = int(NUM_RE.match(file).group(1))
    return f"{name} {n:03d}"


def check_numbers(files):
    """撞号不会报错，只会静默产出两个同名条目（比如两个「旅行素材 143」），
    连带把前端搜索和分享链接一起带错。所以在写 manifest 之前先拦一道。"""
    nums = [int(NUM_RE.match(f).group(1)) for f in files]
    dup = sorted({n for n in nums if nums.count(n) > 1})
    if dup:
        raise SystemExit(f"序号重复 {dup}：新图取下一个未用序号接在末尾，别插进中间")
    # 空洞只提示不报错：删图会留空洞，而「插图不该导致后面全部改名」是本项目的既定取舍
    gaps = sorted(set(range(1, max(nums) + 1)) - set(nums))
    if gaps:
        print(f"提示：序号有空洞 {gaps[:10]}（删图留下的，不影响使用）")


def main():
    os.makedirs(DST, exist_ok=True)
    svg_files = [f"bj_{SVG_BASE + i}-{slug}.svg" for i, (slug, *_) in enumerate(PALETTES, 1)]
    check_numbers([fn for fn, _, _ in PHOTOS] + svg_files)

    manifest = [
        {"file": fn, "name": numbered(fn, name), "keywords": kw}
        for fn, name, kw in PHOTOS
        if os.path.exists(os.path.join(DST, fn))
    ]
    missing = [fn for fn, _, _ in PHOTOS if not os.path.exists(os.path.join(DST, fn))]

    for fn, (slug, name, colors, angle, noise, kw) in zip(svg_files, PALETTES):
        svg = SVG.format(c0=colors[0], c1=colors[1], c2=colors[2], angle=angle, noise=noise)
        with open(os.path.join(DST, fn), "w", encoding="utf-8") as f:
            f.write(svg)
        manifest.append({"file": fn, "name": numbered(fn, name), "keywords": kw})

    # encoding 必须显式指定：Windows 默认 GBK，写出的 manifest 浏览器会读成乱码
    with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    photos = len(manifest) - len(PALETTES)
    print(f"manifest: {len(manifest)} backgrounds ({photos} photos + {len(PALETTES)} gradients)")
    if missing:
        print(f"清单里有 {len(missing)} 张文件不存在，已跳过: {missing[:5]}")


if __name__ == "__main__":
    main()
