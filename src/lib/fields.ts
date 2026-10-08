import type { Product } from '../types';

// 把一个产品摊成「分组 → 行」的结构，详情页和对比页共用。
// 缺失一律显示「—」，对应页面上标注「官方未公布」，绝不编造。
const d = (x: unknown): string => (x == null || x === '' ? '—' : String(x));

/**
 * 把 `display.refreshHz` 归一为**单个数值代表值**，供排序 / 比较 / 归一化横条使用。
 *
 * 为什么要这个：`refreshHz` 真实数据是 `1-120`（可变量程）、`120`、`60/90`（多档）这类
 * **字符串**（见 `Display.refreshHz` 注释）。直接把它当 number 做算术会字符串拼接成
 * `"1201"`、求平均得 `NaN`——这是本项目踩过的类型漂移坑。
 *
 * 口径（**这是展示/排序用的代表值，不是「真实刷新率」**，页面上仍显示官网原文）：
 * - `120` → 120；`1-120` → 120（取上界，可变量程的峰值）；`60/90` → 90（取多档最高档）。
 * - 纯数字字符串同样解析。
 * - 无法解析出数字时返回 `null`（**不返回 0**：0 与「未公布」在语义上完全不同）。
 */
export function refreshHzNumber(hz: string | number | null | undefined): number | null {
  if (hz == null) return null;
  if (typeof hz === 'number') return Number.isFinite(hz) ? hz : null;
  // 抓字符串里的所有数字，取最大者：`1-120`→120、`60/90`→90、`120`→120
  const nums = hz.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const max = Math.max(...nums.map(Number));
  return Number.isFinite(max) ? max : null;
}

export interface SpecRow {
  label: string;
  value: string;
}
export interface SpecGroup {
  title: string;
  rows: SpecRow[];
}

export function specGroups(p: Product): SpecGroup[] {
  const rear = p.camera?.rear ?? [];
  const cam = (role: string, name: string): SpecRow => {
    const c = rear.find((x) => x.role === role);
    if (!c) return { label: name, value: '—' };
    const bits = [c.mp != null ? `${c.mp} MP` : null, c.aperture, c.ois ? 'OIS' : null].filter(
      Boolean,
    );
    return { label: name, value: bits.length ? bits.join(' · ') : '—' };
  };

  const dims = [p.body?.heightMm, p.body?.widthMm, p.body?.thicknessMm].filter(
    (x): x is number => x != null,
  );

  return [
    {
      title: '机身',
      rows: [
        {
          label: '尺寸',
          value:
            dims.length === 3
              ? `${dims[0]}×${dims[1]}×${dims[2]} mm`
              : dims.length
                ? `${dims.join('×')} mm`
                : '—',
        },
        { label: '重量', value: p.body?.weightG != null ? `${p.body.weightG} g` : '—' },
        { label: '材质', value: d(p.body?.material) },
        { label: '防护', value: d(p.body?.ipRating) },
        { label: '配色', value: p.body?.colors?.length ? p.body.colors.join('、') : '—' },
      ],
    },
    {
      title: '屏幕',
      rows: [
        { label: '类型', value: d(p.display?.type) },
        { label: '尺寸', value: p.display?.sizeIn != null ? `${p.display.sizeIn} 英寸` : '—' },
        {
          label: '分辨率',
          value: p.display?.resolutionPx
            ? `${p.display.resolutionPx.w}×${p.display.resolutionPx.h}`
            : '—',
        },
        { label: 'PPI', value: p.display?.ppi != null ? String(p.display.ppi) : '—' },
        {
          label: '刷新率',
          value: p.display?.refreshHz != null ? `${p.display.refreshHz} Hz` : '—',
        },
        {
          label: '亮度',
          value:
            p.display?.brightnessPeakNits != null
              ? `典型 ${d(p.display?.brightnessTypicalNits)} / 峰值 ${p.display.brightnessPeakNits} nits`
              : d(p.display?.brightnessTypicalNits) !== '—'
                ? `典型 ${p.display?.brightnessTypicalNits} nits`
                : '—',
        },
      ],
    },
    {
      title: '芯片与存储',
      rows: [
        { label: '芯片', value: d(p.chipset?.name) },
        { label: '制程', value: p.chipset?.processNm != null ? `${p.chipset.processNm} nm` : '—' },
        {
          label: 'CPU 核心',
          value: p.chipset?.cpuCores != null ? String(p.chipset.cpuCores) : '—',
        },
        {
          label: '内存',
          value: p.memory?.ramGb?.length ? p.memory.ramGb.join(' / ') + ' GB' : '—',
        },
        {
          label: '存储',
          value: p.memory?.storageGb?.length ? p.memory.storageGb.join(' / ') + ' GB' : '—',
        },
      ],
    },
    {
      title: '电池与充电',
      rows: [
        {
          label: '容量',
          value: p.battery?.capacityMah != null ? `${p.battery.capacityMah} mAh` : '—',
        },
        {
          label: '有线充电',
          value: p.battery?.wiredChargeW != null ? `${p.battery.wiredChargeW} W` : '—',
        },
        {
          label: '无线充电',
          value: p.battery?.wirelessChargeW != null ? `${p.battery.wirelessChargeW} W` : '—',
        },
        {
          label: '官方续航',
          value:
            p.battery?.vendorClaimedVideoHours != null
              ? `${p.battery.vendorClaimedVideoHours} 小时（视频）`
              : '—',
        },
      ],
    },
    {
      title: '影像',
      rows: [
        cam('main', '主摄'),
        cam('ultrawide', '超广角'),
        cam('tele', '长焦'),
        cam('periscope', '潜望长焦'),
      ],
    },
  ];
}
