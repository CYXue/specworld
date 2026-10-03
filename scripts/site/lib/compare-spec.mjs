/**
 * 对比页的行定义。**这是设计的唯一实现源**：改对比页显示什么、怎么比、高亮阈值，
 * 只改这个文件，不要改组件。理由见 docs/COMPARE-DESIGN.md。
 *
 * 每个行对象：
 *   id         行标识
 *   group      所属分组（组的顺序 = 这个文件里第一次出现的顺序）
 *   label      参数名
 *   path       契约字段路径；函数则接收 ProductRecord
 *   unit       单位（用于 Δ 列与格式化）
 *   compare    'higher' | 'lower' | 'none' | 'incomparable'
 *              'none'        只并列，不判胜负（手机的大多数参数属于此类）
 *              'incomparable'口径不同，整行不做任何比较（会给斜纹底）
 *   threshold  有意义差异的阈值，Δ 列只在超过它时出现
 *   caliber    口径说明（会以角标显示，悬浮给原文）
 *   caution    这一行容易读错的地方，会进 tooltip
 *   fold       true = 默认收进折叠区
 */

export const GROUPS = {
  meta: '一眼定位',
  body: '手感与机身',
  display: '屏幕',
  perf: '性能与存储',
  camera: '影像',
  battery: '续航与充电',
  connect: '连接与系统',
  incomparable: '不可比项',
  folded: '完整规格',
};

/** 有意义差异的阈值。低于它就不标——标了就是噪音 */
export const THRESHOLDS = {
  weightG: 10,
  thicknessMm: 0.3,
  screenIn: 0.2,
  ppi: 20,
  refreshHz: 30,
  brightnessNits: 200,
  batteryMah: 300,
  wiredChargeW: 10,
  wirelessChargeW: 5,
  priceCny: 300,
  storageSteps: 1,
  ramGb: 4,
};

export const ROWS = [
  /* ---------------- A 一眼定位 ---------------- */
  { id: 'releaseDate', group: 'meta', label: '上市时间', path: 'releaseDate', compare: 'higher', threshold: 0,
    caution: '精度可能是「日 / 月 / 年」，界面按 precision 字段如实标注' },
  { id: 'price', group: 'meta', label: '起售价', path: (p) => minPrice(p), unit: '元', compare: 'lower',
    threshold: THRESHOLDS.priceCny, caution: '官方指导价，非实时成交价' },
  { id: 'status', group: 'meta', label: '在售状态', path: 'status', compare: 'none' },
  { id: 'persona', group: 'meta', label: '一句话定位', path: null, compare: 'none',
    caution: '由结构化字段套模板生成，可逐字追溯到数据' },

  /* ---------------- B 手感与机身 ---------------- */
  { id: 'height', group: 'body', label: '高度', path: 'body.heightMm', unit: 'mm', compare: 'none' },
  { id: 'width', group: 'body', label: '宽度', path: 'body.widthMm', unit: 'mm', compare: 'none' },
  { id: 'thickness', group: 'body', label: '厚度', path: 'body.thicknessMm', unit: 'mm', compare: 'lower',
    threshold: THRESHOLDS.thicknessMm, winLabel: '更薄' },
  { id: 'weight', group: 'body', label: '重量', path: 'body.weightG', unit: 'g', compare: 'lower',
    threshold: THRESHOLDS.weightG, winLabel: '更轻' },
  { id: 'ip', group: 'body', label: '防尘抗水', path: 'body.ipRating', compare: 'none',
    caution: 'IP 等级不可跨标准比较，仅并列展示' },
  { id: 'colors', group: 'body', label: '配色', path: (p) => (p.body.colors ?? []).length || null, unit: '种', compare: 'none' },

  /* ---------------- C 屏幕 ---------------- */
  { id: 'screenSize', group: 'display', label: '屏幕尺寸', path: 'display.sizeIn', unit: '英寸', compare: 'higher',
    threshold: THRESHOLDS.screenIn, winLabel: '更大',
    caution: '对角线长度，圆角矩形；官方文案里的「实际可视区域」另有一值' },
  { id: 'panelType', group: 'display', label: '面板类型', path: 'display.type', compare: 'none' },
  { id: 'resolution', group: 'display', label: '分辨率', path: (p) => fmtRes(p.display.resolutionPx), compare: 'none',
    caution: '分辨率单独看没有意义，配合 ppi 与屏幕尺寸才有' },
  { id: 'ppi', group: 'display', label: '像素密度', path: 'display.ppi', unit: 'ppi', compare: 'higher',
    threshold: THRESHOLDS.ppi, winLabel: '更细腻' },
  { id: 'refresh', group: 'display', label: '刷新率', path: (p) => maxRefresh(p.display.refreshHz), unit: 'Hz',
    compare: 'higher', threshold: THRESHOLDS.refreshHz, winLabel: '更流畅',
    caution: '自适应刷新只写上限；上限相同不代表体验相同' },
  { id: 'brightness', group: 'display', label: '峰值亮度', path: 'display.brightnessPeakNits', unit: 'nits',
    compare: 'higher', threshold: THRESHOLDS.brightnessNits, winLabel: '更亮',
    caliber: '峰值（HDR 局部）', caution: '与「典型亮度」不是一个口径，永不并成一列比较' },
  { id: 'brightnessTypical', group: 'display', label: '典型亮度', path: 'display.brightnessTypicalNits', unit: 'nits',
    compare: 'higher', threshold: THRESHOLDS.brightnessNits, caliber: '典型（全屏持续）' },

  /* ---------------- D 性能与存储 ---------------- */
  { id: 'chip', group: 'perf', label: '芯片', path: 'chipset.name', compare: 'none',
    caution: '本站不提供跑分，因此不对芯片做任何强弱判断；名字不同 ≠ 更强' },
  { id: 'cpu', group: 'perf', label: 'CPU', path: (p) => p.chipset.cpuCores ? `${p.chipset.cpuCores} 核` : null, compare: 'none' },
  { id: 'gpu', group: 'perf', label: 'GPU', path: 'chipset.gpu', compare: 'none' },
  { id: 'ram', group: 'perf', label: '运行内存', path: (p) => maxOf(p.memory.ramGb), unit: 'GB', compare: 'higher',
    threshold: THRESHOLDS.ramGb, caution: '苹果官方不公布 RAM，缺失时显示「官方未公布」而不是 0' },
  { id: 'storage', group: 'perf', label: '最高存储', path: (p) => maxOf(p.memory.storageGb), unit: 'GB', compare: 'higher' },

  /* ---------------- E 影像 ---------------- */
  { id: 'rearCount', group: 'camera', label: '后摄数量', path: (p) => (p.camera.rear ?? []).length || null, unit: '颗', compare: 'none',
    caution: '数量不等于成像质量，本站不做影像排名' },
  { id: 'mainCam', group: 'camera', label: '主摄', path: (p) => fmtCam(p.camera.rear, 'main'), compare: 'none' },
  { id: 'ultrawide', group: 'camera', label: '超广角', path: (p) => fmtCam(p.camera.rear, 'ultrawide'), compare: 'none' },
  { id: 'tele', group: 'camera', label: '长焦', path: (p) => fmtCam(p.camera.rear, 'tele') ?? fmtCam(p.camera.rear, 'periscope'), compare: 'none' },
  { id: 'front', group: 'camera', label: '前摄', path: (p) => (p.camera.front?.mp ? `${p.camera.front.mp} 万像素` : null), compare: 'none' },
  { id: 'video', group: 'camera', label: '视频最高规格', path: 'camera.videoMax', compare: 'none' },

  /* ---------------- F 续航与充电 ---------------- */
  { id: 'battery', group: 'battery', label: '电池容量', path: 'battery.capacityMah', unit: 'mAh', compare: 'higher',
    threshold: THRESHOLDS.batteryMah, winLabel: '更大', caliber: (p) => p.battery.capacityCaliber,
    caution: '口径分「典型值 / 额定值」，两者相差几十 mAh，不注明口径的对比是耍流氓' },
  { id: 'wired', group: 'battery', label: '有线充电', path: 'battery.wiredChargeW', unit: 'W', compare: 'higher',
    threshold: THRESHOLDS.wiredChargeW, winLabel: '更快', caliber: '峰值',
    caution: '标称峰值功率；实际充满时间还取决于电池与温控曲线，官方不给曲线' },
  { id: 'wireless', group: 'battery', label: '无线充电', path: 'battery.wirelessChargeW', unit: 'W', compare: 'higher',
    threshold: THRESHOLDS.wirelessChargeW, winLabel: '更快', caliber: '峰值' },

  /* ---------------- G 连接与系统 ---------------- */
  { id: 'fiveG', group: 'connect', label: '5G', path: (p) => yn(p.connectivity.fiveG), compare: 'none' },
  { id: 'wifi', group: 'connect', label: 'WLAN', path: 'connectivity.wifi', compare: 'none' },
  { id: 'bt', group: 'connect', label: '蓝牙', path: 'connectivity.bluetooth', compare: 'none' },
  { id: 'nfc', group: 'connect', label: 'NFC', path: (p) => yn(p.connectivity.nfc), compare: 'none' },
  { id: 'esim', group: 'connect', label: 'eSIM', path: (p) => yn(p.connectivity.esim), compare: 'none' },
  { id: 'satellite', group: 'connect', label: '卫星通信', path: 'connectivity.satellite', compare: 'none' },
  { id: 'os', group: 'connect', label: '出厂系统', path: 'os.launch', compare: 'none' },

  /* ---------------- 不可比清单（并列但不判定） ---------------- */
  { id: 'vendorHours', group: 'incomparable', label: '厂商标称续航', path: 'battery.vendorClaimedVideoHours', unit: '小时',
    compare: 'incomparable',
    caution: '两家的测试条件不同（播放内容、亮度、网络），数字不可横向比较，只作参考' },

  /* ---------------- 折叠区 ---------------- */
  { id: 'sensors', group: 'folded', label: '感应器', path: 'rawOfficial.sensors', compare: 'none', fold: true },
  { id: 'inTheBox', group: 'folded', label: '包装清单', path: 'rawOfficial.inTheBox', compare: 'none', fold: true },
  { id: 'bands', group: 'folded', label: '网络频段', path: 'rawOfficial.bands', compare: 'none', fold: true,
    caution: '仅华为官网提供，苹果官网不列频段' },
];

/* ------------------------------- 工具函数 ------------------------------- */

function maxOf(arr) {
  const list = (arr ?? []).filter((v) => typeof v === 'number' && v > 0);
  return list.length ? Math.max(...list) : null;
}
function minPrice(p) {
  const list = (p.skus ?? []).map((s) => s.priceCny).filter((v) => typeof v === 'number' && v > 0);
  return list.length ? Math.min(...list) : null;
}
function fmtRes(r) {
  return r ? `${r.w} × ${r.h}` : null;
}
function fmtCam(list, role) {
  const c = (list ?? []).find((x) => x.role === role);
  if (!c?.mp) return null;
  return c.aperture ? `${c.mp} 万像素 ${c.aperture}` : `${c.mp} 万像素`;
}
function maxRefresh(v) {
  if (!v) return null;
  const nums = String(v).match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}
function yn(v) {
  if (v === null || v === undefined) return null;
  return v ? '支持' : '不支持';
}

/**
 * 差异等级。**这是全站最容易被改坏的一个函数**，改之前先读 docs/COMPARE-DESIGN.md 第五节。
 * 返回：'none' | 'weak' | 'strong' | 'missing' | 'incomparable'
 */
export function diffLevel(row, a, b) {
  if (row.compare === 'incomparable') return 'incomparable';
  if (a === null || a === undefined || b === null || b === undefined) return 'missing';
  if (row.compare === 'none' || !row.threshold) return 'none';
  const numA = typeof a === 'number' ? a : Number(a);
  const numB = typeof b === 'number' ? b : Number(b);
  if (!Number.isFinite(numA) || !Number.isFinite(numB)) return 'none';
  const delta = Math.abs(numA - numB);
  if (delta < row.threshold) return 'none';
  return delta >= row.threshold * 2 ? 'strong' : 'weak';
}

/** 优势方：'a' | 'b' | null（不判定时返回 null） */
export function winner(row, a, b) {
  if (row.compare !== 'higher' && row.compare !== 'lower') return null;
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isFinite(numA) || !Number.isFinite(numB) || numA === numB) return null;
  const aWins = row.compare === 'higher' ? numA > numB : numA < numB;
  return aWins ? 'a' : 'b';
}
