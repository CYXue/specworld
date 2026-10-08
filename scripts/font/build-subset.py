#!/usr/bin/env python3
"""
生成像素字体子集（一次性资产脚本，产物入 public/fonts/）。

为什么需要它
────────────
站点原带的 `pixel-zh.woff2` 只覆盖项目实际用到的汉字的 45%（478/1059），
其余字形缺失 → 浏览器静默回退到系统无衬线字体。
症状是「同一个标题里，有的字是像素的、有的字是圆滑的」，肉眼一看就是风格没统一。
这种缺口靠看代码发现不了（没有任何报错），必须**遍历全站字形**逐个对账。

本脚本：
  1. 扫描 src/**、index.html、data/*.json 里出现的每一个字符
  2. 并上 GB2312 一级常用字（3755）作缓冲 —— 数据每天在变，
     只按当前字符裁剪的话，明天多一个生僻字就又漏一个
  3. 用 fontTools 做 woff2 子集

命名
────
Fusion Pixel 是 OFL-1.1。OFL 规定「修改过的版本必须改名」，
子集属于修改，所以字体名从 `Fusion Pixel …` 改为 `SpecPixel …`，
避免与上游同名造成混淆。许可证原文随字体放在 public/fonts/OFL.txt。

手动运行（改了字表或换上游版本时才需要）：
    python scripts/font/build-subset.py
"""

import glob
import hashlib
import json
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_FONT = os.path.join(ROOT, "_work", "font", "fusion-pixel-12px-proportional-zh_hans.otf.woff2")
OUT_FONT = os.path.join(ROOT, "public", "fonts", "pixel-zh.woff2")
OUT_LICENSE = os.path.join(ROOT, "public", "fonts", "OFL.txt")
OUT_COVERAGE = os.path.join(ROOT, "public", "fonts", "coverage.json")

# 上游发行版（GitHub 直连被 reset 时换 gh-proxy 前缀）
RELEASE = "2026.09.25"
ASSET = f"fusion-pixel-font-12px-proportional-otf.woff2-v{RELEASE}.zip"
MIRRORS = [
    f"https://gh-proxy.com/https://github.com/TakWolf/fusion-pixel-font/releases/download/{RELEASE}/{ASSET}",
    f"https://ghproxy.net/https://github.com/TakWolf/fusion-pixel-font/releases/download/{RELEASE}/{ASSET}",
]

# 项目里出现但字体可能没有的符号，需要显式列出并校验
EXTRA = (
    "、。，：；！？（）「」【】《》—…·×÷°′″±≈≤≥"
    "→←↑↓★☆◆■□▲▼●○✓✗§¶±"
    "“”‘’　"
)


def collect_chars() -> set[str]:
    """扫全站字形：src 源码 + index.html + data 产物。"""
    chars: set[str] = set()

    for path in glob.glob(os.path.join(ROOT, "src", "**", "*.*"), recursive=True) + [
        os.path.join(ROOT, "index.html")
    ]:
        if os.path.isfile(path):
            chars.update(open(path, encoding="utf8", errors="ignore").read())

    def walk(node):
        if isinstance(node, str):
            chars.update(node)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for path in glob.glob(os.path.join(ROOT, "data", "*.json")):
        walk(json.load(open(path, encoding="utf8")))

    return chars


def gb2312_level1() -> set[str]:
    """GB2312 一级汉字（3755 个常用字），作缓冲池。"""
    out: set[str] = set()
    for hi in range(16, 56):
        for lo in range(1, 95):
            try:
                ch = bytes([hi + 0xA0, lo + 0xA0]).decode("gb2312")
            except Exception:
                continue
            if 0x4E00 <= ord(ch) <= 0x9FFF:
                out.add(ch)
    return out


def fetch_source() -> None:
    if os.path.exists(SRC_FONT):
        return
    os.makedirs(os.path.dirname(SRC_FONT), exist_ok=True)
    last = None
    for url in MIRRORS:
        try:
            print(f"下载上游字体：{url}")
            urllib.request.urlretrieve(url, SRC_FONT + ".zip")
            with zipfile.ZipFile(SRC_FONT + ".zip") as z:
                with z.open("fusion-pixel-12px-proportional-zh_hans.otf.woff2") as src:
                    open(SRC_FONT, "wb").write(src.read())
                with z.open("OFL.txt") as src:
                    open(OUT_LICENSE, "wb").write(src.read())
            return
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f"上游字体下载失败：{last}")


def main() -> int:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print("需要 fontTools + brotli：pip install fonttools brotli", file=sys.stderr)
        return 1

    chars = collect_chars()
    cjk = {c for c in chars if 0x4E00 <= ord(c) <= 0x9FFF}

    fetch_source()

    text = (
        set(chars)
        | gb2312_level1()
        | {chr(i) for i in range(0x20, 0x7F)}
        | set(EXTRA)
    )

    font = TTFont(SRC_FONT)
    original = set(font.getBestCmap().keys())

    missing = sorted(c for c in chars if ord(c) > 0x7F and ord(c) not in original)
    if missing:
        # 这不是致命错误（浏览器会回退），但必须报出来 —— 缺口是静默的，
        # 只有这一步会把它变成显式失败。
        print(f"⚠ 上游字体缺 {len(missing)} 个字符：{''.join(missing)}")

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text="".join(sorted(text)))
    subsetter.subset(font)

    # OFL 要求改名
    for rec in font["name"].names:
        if rec.nameID in (1, 4, 6, 16):
            try:
                value = rec.toUnicode()
            except Exception:  # noqa: BLE001
                continue
            rec.string = value.replace("Fusion Pixel", "SpecPixel")

    font.flavor = "woff2"
    font.save(OUT_FONT)

    # 落下覆盖清单 + 字体哈希。
    # 为什么要有它：浏览器端测不出字形是否回退（见 scripts/publish/check-font-coverage.mjs
    # 的注释：canvas measureText 对 CJK 恒等、像素比对的对照组又不可靠），
    # 唯一的权威判据是 cmap。这里在**生成时**读一次，之后闸门只做比对，
    # 既准确又让闸门保持零依赖（CI 的 selftest job 只装 Node）。
    # 哈希用来防「换了字体忘了重生成清单」—— 那种情况下闸门会拿旧数据报绿。
    with open(OUT_FONT, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    with open(OUT_COVERAGE, "w", encoding="utf8") as fh:
        json.dump(
            {
                "font": "pixel-zh.woff2",
                "fontSha256": sha,
                "upstream": "TakWolf/fusion-pixel-font 12px proportional zh_hans",
                "license": "OFL-1.1（改名 SpecPixel）",
                "codePoints": sorted(set(font.getBestCmap().keys())),
            },
            fh,
            ensure_ascii=False,
            indent=0,
        )

    size_kb = os.path.getsize(OUT_FONT) / 1024
    print(f"✅ {OUT_FONT}  {size_kb:.1f} KB  （{len(text)} 个字符，其中汉字 {len(cjk)} 个）")
    print(f"✅ {OUT_LICENSE}")
    print(f"✅ {OUT_COVERAGE}  （{len(set(font.getBestCmap().keys()))} 个码位 + sha256）")
    print("\n校验：node scripts/publish/check-font-coverage.mjs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
