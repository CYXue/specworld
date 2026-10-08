"""从 WPS 表格的 xlsx 里读回两色像素网格。

## 为什么不用 openpyxl
两个可用 Python 环境都没装 openpyxl，而装它只是为了读**填充色**。
xlsx 本质 = zip + XML ⇒ 直接解析即可，零新增依赖。

## ⚠️⚠️⚠️ 头号坑：`c@s` 是 **cellXfs** 的下标，不是 **fills** 的下标
xlsx 里样式是**两层间接**：

    单元格 c@s  ──→  cellXfs[s].fillId  ──→  fills[fillId].patternFill/fgColor

把 `s` 直接当 fillId 用，会读到**另一条fill**。本项目的真实数据：

| 下标 | cellXfs  entry                | → fillId | → 颜色 |
|---|---|---|---|
| 0 | `fillId="0"`                   | 0 | `<patternFill/>`（**无填充**） |
| 1 | `fillId="2"`                   | 2 | `solid fgColor=FFFFFFFF`（白） |
| 2 | `fillId="3"`                   | 3 | `solid fgColor=FF000000`（**黑**） |

若误用 `fills[s]`：`s=2` 会被读成 `fills[2]`=**白**，
而它真实是 `fills[3]`=**黑** ⇒ **黑白整体判反**。
症状极具欺骗性：网格「看起来完全正常」，只是太极手性与参考图相反
——像一个刻意设计的变体，于是被当成设计意图接受下来。

⇒ 本模块**必须**按 `cellXfs → fillId → fills` 三级解析。

## ⚠️⚠️ 为什么不能读 value
WPS 导出的这种网格表**单元格里没有值**（`data_only=True` 读出来全是 None），
真源是 `cell.fill.fgColor`。这与「值是 None 就跳过该格」的直觉相反 ——
按 value 读会得到一张全空的表，看起来「数据没了」，实则是读错了字段。

## ⚠️ 无填充也是一种颜色
`fills[0] = <patternFill/>`（无 patternType）就是**无填充**，
本项目里它对应**其中一种颜色**（`None` 与实心色恰好各 512 格，频次完全相同）
⇒ **不能按频次分两色**，必须按亮度。

用法: python scripts/favicon/from-xlsx.py <xlsx路径> [sheet名]
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
}
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def load_styles(z):
    """styles.xml → (fills, cellxfs_to_fillid)。

    `fills[i]` = ('solid', 'rrggbb') 或 None（无填充 / 非solid）。
    `cellxfs_to_fillid[s]` = 样式 s 实际用的 fill 下标。
    """
    root = ET.fromstring(z.read('xl/styles.xml'))
    fills = []
    for f in root.findall('.//m:fills/m:fill', NS):
        pf = f.find('m:patternFill', NS)
        #⚠️ 必须是 `solid`：无 patternType 的是「无填充」，
        # 而 `gray125` 之类的图案填充既不是实色、也不是无填充（本项目未用）。
        if pf is None or pf.get('patternType') != 'solid':
            fills.append(None)
            continue
        fg = pf.find('m:fgColor', NS)
        rgb = fg.get('rgb') if fg is not None else None
        # indexed / theme 色本项目未用⇒ 显式报错好过悄悄当成无填充。
        if not (rgb and len(rgb) == 8):# AARRGGBB
            raise SystemExit(
                f'❌ fill {len(fills)} 用了非 rgb 颜色（rgb={rgb!r}）—— '
                '本脚本只处理 AARRGGBB 实心填充，别默默降级。'
            )
        fills.append(rgb[2:].lower())
    cellxfs = [
        int(x.get('fillId') or 0)
        for x in root.findall('.//m:cellXfs/m:xf', NS)
    ]
    if not cellxfs:
        raise SystemExit('❌ styles.xml 里没有 cellXfs —— 无法把 s 映射到 fill。')
    return fills, cellxfs


def load_sheet(z, path, fills, cellxfs):
    """返回 {row: {col: 'rrggbb'|None}}。⚠️ 三级解析，见模块docstring。"""
    root = ET.fromstring(z.read(path))
    out = {}
    for row in root.findall('.//m:sheetData/m:row', NS):
        # ⚠️⚠️ 行号是 **1 基**（A1 那个 1），而列号下面转成了 **0 基**。
        # 少减这一个 1 ⇒ 网格整体下移一行：第0 行成了不存在的phantom（全白），
        # 而真实的最后一行被 `to_grid` 的 `range(n)` 丢掉。
        # 症状是「顶部多一行白、底部少一行」，看起来像构图本身如此。
        r = int(row.get('r')) - 1
        for c in row.findall('m:c', NS):
            s = int(c.get('s') or 0)
            if s >= len(cellxfs):
                raise SystemExit(f'❌ 单元格样式 s={s} 越界（cellXfs 只有 {len(cellxfs)} 项）。')
            fi = cellxfs[s]
            color = fills[fi] if fi < len(fills) else None
            out.setdefault(r, {})[col_of(c.get('r'))] = color
    return out


def col_of(ref):
    """'BC12' → 54（0 基）。"""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def to_grid(grid, n):
    """→ (grid[是否墨色], states)。

    判据是**绝对亮度**，不能按频次：本项目两色恰好各 512 格，
    按频次分会把黑白判反（见模块 docstring 的索引坑）。
    """
    cnt = Counter()
    for row in grid.values():
        cnt.update(row.values())
    if len(cnt) < 2:
        raise SystemExit(
            f'❌ 只找到 {len(cnt)} 种状态 {dict(cnt)} —— 无法分出两色。'
        )
    colors = list(cnt)
    # 亮度：0.2126R + 0.7152G + 0.0722B（Rec.709），0~255
    def lum(hexs):
        if hexs is None:
            return None
        r, g, b = (int(hexs[i:i + 2], 16) for i in (0, 2, 4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    known = [(c, lum(c)) for c in colors if c is not None]
    if len(known) != 2:
        raise SystemExit(
            f'❌ 实心色恰好 {len(known)} 种 {known} —— 期望恰好 2 种纯色。'
        )
    (dark_c, dark_l), (light_c, light_l) = sorted(known, key=lambda t: t[1])
    if dark_l > 100 or light_l < 155:
        raise SystemExit(
            f'❌ 两色不是「黑/白」：暗={dark_c}(L={dark_l:.0f}) 亮={light_c}(L={light_l:.0f})。'
            '判据只对纯黑白成立。'
        )
    g = [[grid.get(r, {}).get(c) == dark_c for c in range(n)] for r in range(n)]
    return g, colors, cnt


def pick_sheet(z, name=None):
    """→ zip内 sheet 的路径。⚠️ 必须走 workbook.xml + rels，不能靠文件名排序。"""
    paths = {
        p for p in z.namelist()
        if p.startswith('xl/worksheets/sheet') and p.endswith('.xml')
    }
    if not name:
        return sorted(paths)[0]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rid = None
    for s in wb.findall('.//m:sheets/m:sheet', NS):
        if s.get('name') == name:
            rid = s.get(REL_NS)
    if rid is None:
        raise SystemExit(f'❌ 没有名为 {name!r} 的 sheet。')
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    tgt = next(
        (r.get('Target') for r in rels
         if r.get('Id') == rid), None)
    if not tgt:
        raise SystemExit(f'❌ rels 里找不到 {rid}。')
    # Target 形如 `/xl/worksheets/sheet3.xml` 或 `worksheets/sheet3.xml`
    cand = tgt.lstrip('/')
    if cand not in paths and('xl/' + cand) in paths:
        cand = 'xl/' + cand
    if cand not in paths:
        raise SystemExit(f'❌ Target={tgt!r} 不在 zip 里。')
    return cand


def main():
    src = sys.argv[1]
    sheet = sys.argv[2] if len(sys.argv) > 2 else None
    with zipfile.ZipFile(src) as z:
        fills, cellxfs = load_styles(z)
        path = pick_sheet(z, sheet)
        grid = load_sheet(z, path, fills, cellxfs)
    maxr = max(grid)
    maxc = max(max(r) for r in grid.values())
    n = max(maxr, maxc + 1)
    g, states, cnt = to_grid(grid, n)
    print(f'# {src}  sheet={path}')
    print(f'# 网格 {n}x{n}  颜色分布 {cnt.most_common()}')
    print('# 「#」= 暗色（黑），「.」= 亮色（白）—— 判据是亮度，不是频次。')
    for row in g:
        print(''.join('#' if v else '.' for v in row))
    print(f'\n暗格 {sum(sum(r) for r in g)}/{n * n}')
    # 机器可读行：两色各是什么、亮的是哪个
    print('# COLORS ' + ' '.join(
        (s if s else 'none') for s in states))


if __name__ == '__main__':
    main()
