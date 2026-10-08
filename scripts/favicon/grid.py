"""把裁剪截图变成 N×N 像素网格，输出 favicon SVG。**支持多种两色化方案。**

## ⚠️ 核心矛盾：太极有一半必然与底板同色
太极 = 黑白各半；favicon 只有 ink `#12151f` + parchment `#fffaf0` 两色。
「白鱼= 纯白 #FFF」与「底板 = 米白 #FFFAF0」亮度只差 **0.02**，
经 BOX 面积平均降采样后彻底消失 ⇒ 直白做法只剩黑鱼（深色占比仅 25%）。

## 方案表
| key | 底板 | 圆内 | 两半可见 | 备注 |
|---|---|---|---|---|
| `ring` | 米白 |原样 + 墨色圆环 |✅ | 环把白鱼围出来；环在 16px 会不会被吃掉是关键风险 |
| `invert` | 墨色 | 原样 | ✅ | 白鱼被墨底包围，最稳；代价 = 墨底在深色标签栏会陷进去 |
| `direct` | 米白 | 原样 | ❌ | 只剩黑鱼（留作反例基线，不用于产物） |

## 为什么圆内白鱼与圆外留白**在截图里无法区分**
两者颜色完全相同（都是米白），像素层面无从下手 ⇒ 只能用**几何**（圆心/半径）
把圆内圆外分开。圆心半径由 `scripts/favicon/render.cjs` 的差分定位给出，写进 `_work/favicon/meta.json`，
这里直接读—— **判据与产物同源**，不重新目测。
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

SHOTS = Path('_work/favicon')
INK = '#12151f'      # 项目 @theme --color-ink
PAPER = '#fffaf0'    # 项目 @theme --color-parchment-lit


def load_shot_and_geom():
    """读回裁剪截图 + 圆的几何（占画幅的比例）。

    截图是 SS×SS，圆心在正中、半径 = SS × frac / 2。
    圆心半径来自 `scripts/favicon/render.cjs` 的差分定位，写进 `_work/favicon/meta.json`。
    """
    meta = json.loads((SHOTS / 'meta.json').read_text(encoding='utf-8'))
    shot = SHOTS / '_shot.png'
    im = Image.open(shot).convert('L')
    s = im.size[0]
    return im, s, s / 2.0, s * meta['frac'] / 2.0, meta


def to_grid(im: Image.Image, n: int, scheme: str, cc: float, cr: float, s: float):
    """降采样成 n×n 布尔网格（True = 墨色）。"""
    small = im.resize((n, n), Image.Resampling.BOX)
    px = list(small.getdata())
    g = [[px[y * n + x] / 255.0 < 0.5 for x in range(n)] for y in range(n)]

    if scheme == 'direct':
        return g

    # 圆心/半径换算到 n×n 网格坐标
    k = n / s
    ncc, ncr = cc * k, cr * k

    def inside(x, y):
        dx, dy = (x + 0.5) - ncc, (y + 0.5) - ncc
        return dx * dx + dy * dy <= ncr * ncr

    if scheme == 'invert':
        # 圆外填墨色 ⇒ 白鱼被墨底包围
        for y in range(n):
            for x in range(n):
                if not inside(x, y):
                    g[y][x] = True
        return g

    if scheme == 'ring':
        # 米白底 + 墨色圆环：环把白鱼与底板隔开
        #
        # ⚠️⚠️ 环**不能**用「格心距圆心 ∈ [r-1, r]」的距离带来判——
        # 斜率大的位置相邻格判定跳变，环出现**断裂**
        # （实测 16px 上断 3 处 ⇒ 白鱼从缺口漏进底板 ⇒ 16px 下白鱼消失）。
        #
        # 改用「**圆周是否穿过该格**」判定（9 点采样 = 4 角 + 4 边中点 + 中心）：
        #   9 点全在外 → 圆外 ⇒ 底板，不动
        #   9 点全在内 → 圆内深处 ⇒ 保持原样（黑鱼墨 / 白鱼米白）
        #   内外混合   → 圆周穿过 ⇒ 墨色（环）
        # 「圆周穿过的格子集合」八连通 ⇒ 环恒闭合，与方向无关。
        #
        # ⚠️⚠️⚠️ 采样点**必须显式包含 4 个角点**，且**不能用面积阈值**调环厚：
        # 1. 纯内部子采样（如 8×8）会漏掉角点 —— 实测 20px 第 9 行左端：
        #    格 (2,9) 角点距圆心 8.06（在外 ⇒ 应上环），
        #    但格内最远只有 7.52（全在圆内 ⇒ 判为「圆内原样」）
        #    ⇒ 环凭空断一格，白鱼漏进底板。
        # 2. 加「cov < 0.9×满」这类阈值控环厚也不行：同一阈值在正切线与
        #    斜切线方向解出的环厚不同（1 格 vs 2 格），
        #    某些方向上环内侧格被判成「圆内原样」而若是白鱼就米白 ⇒ 同样断。
        # 环厚由「圆周是否穿过」自然决定（恒为 1 格），不需要额外参数。
        PTS = [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (2, 0), (2, 1), (2, 2)]
        for y in range(n):
            for x in range(n):
                ins = 0
                for px_, py_ in PTS:
                    ddx = x + px_ / 2 - ncc
                    ddy = y + py_ / 2 - ncc
                    if ddx * ddx + ddy * ddy <= ncr * ncr:
                        ins += 1
                if 0 < ins < 9:
                    g[y][x] = True
        return g

    raise SystemExit(f'未知方案 {scheme}')


def runs(g: list[list[bool]]) -> list[tuple[int, int, int]]:
    """行内**深色**连续段合并成 (x, y, w)。

    ⚠️ 只收深色段。行内连续段有深有浅，而 to_svg() 给每段都涂 INK——
    若把浅色段也吐出来，整张图会全黑。
    （真实踩过：SVG 全黑而 ASCII 正常，因为 ASCII 直接读 g[y][x]。
    **判据与产物必须同源**，否则「ASCII 对」会掩盖「SVG 错」。** 空间换正确性。"""
    n = len(g)
    out = []
    for y in range(n):
        x = 0
        while x < n:
            if not g[y][x]:
                x += 1
                continue
            w = 1
            while x + w < n and g[y][x + w]:
                w += 1
            out.append((x, y, w))
            x += w
    return out


def to_svg(g: list[list[bool]]) -> str:
    n = len(g)
    body = '\n'.join(
        f'  <rect x="{x}" y="{y}" width="{w}" height="1" fill="{INK}"/>'
        for x, y, w in runs(g)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{n}" height="{n}" '
        f'viewBox="0 0 {n} {n}" shape-rendering="crispEdges">\n'
        f'  <rect width="{n}" height="{n}" fill="{PAPER}"/>\n{body}\n</svg>\n'
    )


def read_back(svg_text: str, n: int) -> list[list[bool]]:
    """把 SVG 解析回 n×n 网格 —— **自校验产物与网格一致**。"""
    g = [[False] * n for _ in range(n)]
    for x, y, w in re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)"', svg_text.split('>', 2)[2]):
        for i in range(int(w)):
            g[int(y)][int(x) + i] = True
    return g


def show(g: list[list[bool]]) -> str:
    return '\n'.join(''.join('#' if c else '.' for c in row) for row in g)


if __name__ == '__main__':
    args = sys.argv[1:]
    scheme = 'ring'
    if args and args[0].startswith('--scheme='):
        scheme = args.pop(0).split('=', 1)[1]
    im, s, cc, cr, meta = load_shot_and_geom()
    sizes = [int(a) for a in args] or meta['sizes']
    print(
        f'源截图 {s}x{s}  frac={meta["frac"]}  鱼眼={"保留" if meta.get("eyes") else "已去"}  '
        f'圆心({cc:.0f},{cc:.0f}) 半径{cr:.0f}  方案={scheme}\n'
    )

    for n in sizes:
        g = to_grid(im, n, scheme, cc, cr, s)
        svg = to_svg(g)
        assert read_back(svg, n) == g, f'{n}x{n}: SVG 与网格不一致（产物与判据路径分叉）'
        (SHOTS / f'taiji-{n}.svg').write_text(svg, encoding='utf-8')
        dark = sum(sum(r) for r in g)
        print(f'=== {n}x{n} === runs={len(runs(g))} 深色={dark}/{n * n} ({dark / (n * n):.0%})')
        if n <= 32:
            print(show(g))