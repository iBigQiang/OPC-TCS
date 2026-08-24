#!/usr/bin/env python3
"""把参考站的 118 张背景图下载、压缩、按 bj_n- 编号写入 backgrounds/。

一次性脚本，跑完即冻结：118 张已全部入库，平时不用跑。留在仓库里只为可复现。
幂等——目标文件已存在就跳过，写入走 .part + os.replace 原子改名，中断可重跑。

这里的 slug 与编号和 gen_backgrounds.py 的 PHOTOS 清单有重叠（文件名），
但**新增背景只改 gen_backgrounds.py**，本脚本不再维护，所以不存在需要同步的两份清单。
中文名与搜索关键词从来只在 gen_backgrounds.py 里。
"""
import concurrent.futures as cf
import io
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "backgrounds")

BASE = "https://dontbesilent-tweet-card-studio.vercel.app/backgrounds/"

# (源站 slug, 本项目编号)。8 张具名占 25–32，travel-001..110 顺次占 33–142。
NAMED = ["misty-valley", "mountain-valley", "harbor-blue", "city-night",
         "skyline", "cloud-mountain", "coast-road", "forest-light"]
SOURCES = [(slug, 25 + i) for i, slug in enumerate(NAMED)]
SOURCES += [(f"travel-{i:03d}", 32 + i) for i in range(1, 111)]

MAX_W = 1080      # 导出画布宽 1080，再大的像素进不了成品
CAP = 200 * 1024  # 单张体积上限
Q_HI, Q_LO = 84, 64


def compress(raw: bytes) -> bytes:
    """质量自适应递减到 CAP 以下。

    两个反直觉的地方：
    1. 只在超宽时缩，绝不放大——源图多为 960 宽，放大到 1080 不增信息只增体积。
    2. 产物比原图还大就退回原图。实测 photo-snow-peaks.jpg（413KB/1080×1440）
       重编码 q82 反而涨到 446KB：高细节图在原始量化表下已经很紧了。
    """
    im = Image.open(io.BytesIO(raw))
    w, h = im.size
    im = im.convert("RGB")
    if w > MAX_W:
        im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
    out = raw
    for q in range(Q_HI, Q_LO - 1, -4):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        out = buf.getvalue()
        if len(out) <= CAP:
            break
    return out if len(out) < len(raw) else raw


def fetch_one(job):
    slug, n = job
    dst = os.path.join(DST, f"bj_{n}-{slug}.jpg")
    if os.path.exists(dst):
        return ("skip", dst, 0)
    raw = urllib.request.urlopen(BASE + slug + ".jpeg", timeout=60).read()
    data = compress(raw)
    # 先写临时文件再原子改名：直写目标文件的话，中断留下的半截 JPG
    # 会被下次重跑的 os.path.exists 当成已完成而跳过，「随时中断重跑」就成了空话。
    tmp = dst + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dst)
    return ("ok", dst, len(data))


def main():
    os.makedirs(DST, exist_ok=True)
    done = skipped = failed = 0
    total_bytes = 0
    with cf.ThreadPoolExecutor(8) as ex:
        futures = {ex.submit(fetch_one, j): j for j in SOURCES}
        for fut in cf.as_completed(futures):
            slug, n = futures[fut]
            try:
                status, dst, size = fut.result()
            except Exception as exc:  # 单张失败不该拖垮整批，重跑即可补齐
                failed += 1
                print(f"  失败 bj_{n}-{slug}: {exc}", file=sys.stderr)
                continue
            if status == "skip":
                skipped += 1
            else:
                done += 1
                total_bytes += size
    print(f"新增 {done} 张（{total_bytes / 2**20:.1f} MB），跳过 {skipped} 张，失败 {failed} 张")
    if failed:
        print("有失败项，重跑本脚本可补齐（已存在的会跳过）")
        sys.exit(1)


if __name__ == "__main__":
    main()
