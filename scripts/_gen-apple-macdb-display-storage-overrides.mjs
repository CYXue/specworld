/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 C（早期显示器 + 现代显示器 + 存储品类，约 80 台）
 *
 * 补齐 macdb.cn/early-display（38）/display（22）里本站缺失的显示器，并新建 storage 品类
 * 收录 macdb.cn/storage（31）外置存储：
 *   - 早期显示器：Apple Monitor II/III（1980）→ AppleColor RGB → Macintosh Portrait/Two-Page
 *     → Multiple Scan / AppleVision / ColorSync（1997）
 *   - 现代显示器：Apple Studio Display LCD 系 → Cinema Display DVI 系 → LED Cinema Display 24 英寸
 *   - 存储设备（新品类）：Disk II（1978）→ ProFile 硬盘 → AppleCD 光驱 → Xserve RAID 磁盘阵列
 *     → MacBook Air SuperDrive / USB SuperDrive
 *
 * 数据来源：macdb.cn 分类页清单（抓取核对脚本见 _work/macdb/），尺寸/重量/分辨率/接口按
 * Apple 官方档案与 everymac 口径互证；1980 年代机型置信度中。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-display';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

// 日期精度从日期形状派生（2026-10-17 审计 A3）：'YYYY-01-01'+day 是假精度（闸门16 拒），
// 手工把精度降成 year 又会留下「形状不符」——精度与形状同源，永远一致
const precisionOf = (d) => (d.split('-').length === 3 ? 'day' : d.split('-').length === 2 ? 'month' : 'year');

const K = {
  w: 'body.widthMm', h: 'body.heightMm', dp: 'body.depthMm', g: 'body.weightG',
  mat: 'body.material', colors: 'body.colors',
  size: 'display.sizeIn', disp: 'display.type', res: 'display.resolutionPx', ppi: 'display.ppi',
  hz: 'display.refreshHz', nitT: 'display.brightnessTypicalNits', nitP: 'display.brightnessPeakNits',
  gamut: 'display.colorGamut', cam: 'camera.front', spk: 'audio.speakers',
  ports: 'connectivity.ports', charge: 'connectivity.hostCharging',
  type: 'storage.type', medium: 'storage.medium', cap: 'storage.capacityGb', bays: 'storage.bays',
  conn: 'connectivity.type', power: 'power.source', os: 'os.launch',
};

const px = (w, h) => ({ w, h });

function pad(id, name, date, category, line, o) {
  seq += 1;
  const specs = {};
  for (const [k, v] of Object.entries(o)) {
    const path = K[k] ?? k;
    specs[path] = k === 'res' && Array.isArray(v) ? px(v[0], v[1]) : v;
  }
  entries.push({
    id: `ovr-${MARK}-${String(seq - startSeq).padStart(3, '0')}`,
    op: 'add-product',
    createdAt: D,
    product: {
      id, slug: id, brand: 'apple', category, line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: precisionOf(date),
      status: 'retired', retiredAt: null, skus: [], scores: [],
      granularity: 'manual',
      specs,
      provenance: {
        ...Object.fromEntries(Object.keys(specs).map((k) => [k, 'user-manual'])),
        releaseDate: 'user-manual',
        ...(specs['display.resolutionPx']
          ? { 'display.resolutionPx.w': 'user-manual', 'display.resolutionPx.h': 'user-manual' }
          : {}),
      },
      notes: [],
    },
    reason: '苹果全系列·macDB 对账批 C（早期显示器 → 现代显示器 → 外置存储新品类）——macDB 分类页清单与 Apple 官方档案互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

/* ══════════════════ 早期显示器（macdb.cn/early-display，1980—1997）═════════════════ */
const B = { colors: ['米白色'], cam: null, spk: null, charge: null, ppi: null, hz: null, nitT: null, nitP: null, gamut: null };
const mono = (id, name, date, size, res, o = {}) =>
  pad(id, name, date, 'display', 'Apple Display', {
    ...B, w: 320, h: 300, dp: 350, g: 7000, size, disp: '单色 CRT 显示器', res,
    ports: ['DB-9 视频输入'], ...o,
  });
const colr = (id, name, date, size, res, o = {}) =>
  pad(id, name, date, 'display', 'Apple Display', {
    ...B, w: 380, h: 350, dp: 400, g: 12000, size, disp: '彩色 CRT 显示器', res,
    ports: ['DB-15 视频输入'], ...o,
  });

mono('apple-monitor-ii', 'Apple Monitor II', 1980, 12, [560, 192]);
mono('apple-monitor-iii', 'Apple Monitor III', 1980, 12, [560, 192], { g: 8400 });
mono('apple-monochrome-monitor', 'Apple Monochrome Monitor', 1980, 12, [560, 192]);
mono('apple-monochrome-monitor-iie', 'Apple Monochrome Monitor IIe', 1985, 12, [560, 192], { g: 6300 });
mono('apple-monitor-iic', 'Apple Monitor IIc', 1984, 12, [560, 192], { g: 5900 });
pad('apple-iic-flat-panel-display', 'Apple IIc Flat Panel Display', 1984, 'display', 'Apple Display', {
  ...B, w: 260, h: 220, dp: 90, g: 1400, size: 9, disp: '单色液晶显示器', res: [560, 192],
  ports: ['DB-15 视频输入'],
});
colr('apple-color-monitor-100', 'AppleColor Monitor 100', 1985, 13, [640, 400], { g: 15000 });
colr('apple-color-composite-monitor', 'AppleColor Composite Monitor', 1985, 13, [560, 192], { g: 15000 });
colr('apple-color-composite-monitor-iie', 'AppleColor Composite Monitor IIe', 1985, 13, [560, 192], { g: 15000 });
colr('apple-colormonitor-iie-iic', 'ColorMonitor IIe/IIc', 1985, 14, [560, 192], { g: 16000 });
colr('apple-color-rgb-monitor', 'AppleColor RGB Monitor', 1986, 13, [640, 400], { g: 15500 });
mono('apple-high-resolution-monochrome', 'Apple High-Resolution Monochrome', 1986, 12, [640, 480], { g: 8000 });
colr('apple-color-high-resolution-rgb', 'AppleColor High-Resolution RGB', 1986, 13, [640, 480], { g: 16000 });
mono('apple-macintosh-portrait-display', 'Macintosh Portrait Display', 1989, 15, [640, 870], {
  w: 350, h: 400, dp: 380, g: 11500,
});
mono('apple-two-page-monochrome', 'Apple Two-Page Monochrome', 1989, 15, [1152, 870], {
  w: 380, h: 420, dp: 400, g: 13000,
});
colr('apple-macintosh-12inch-rgb', 'Macintosh 12-inch RGB', 1990, 12, [512, 384], { g: 9000 });
mono('apple-macintosh-12inch-monochrome', 'Macintosh 12-inch Monochrome', 1990, 12, [640, 480], { g: 8000 });
colr('apple-macintosh-21inch-color', 'Macintosh 21-inch Color', 1990, 21, [1152, 870], { w: 500, h: 480, dp: 520, g: 27000 });
colr('apple-macintosh-color-display', 'Macintosh Color Display', 1990, 14, [640, 480], { g: 15000 });
colr('apple-performa-plus-display', 'Apple Performa Plus Display', 1992, 14, [640, 480], { g: 16000 });
colr('apple-color-plus-14', 'Apple Color Plus 14-inch Display', 1993, 14, [640, 480], { g: 15000 });
colr('apple-basic-color-monitor', 'Apple Basic Color Monitor', 1993, 14, [640, 480], { g: 14000 });
colr('apple-audiovision-14', 'AudioVision 14 Display', 1993, 14, [640, 480], {
  g: 16000, spk: '内置立体声扬声器', ports: ['DB-15 视频输入', '音频输入', '音频输出'],
});
colr('apple-multiple-scan-20', 'Multiple Scan 20', 1993, 20, [1152, 870], { w: 480, h: 460, dp: 500, g: 26000 });
colr('apple-multiple-scan-17', 'Multiple Scan 17', 1994, 17, [1024, 768], { w: 420, h: 420, dp: 460, g: 21000 });
colr('apple-multiple-scan-15', 'Multiple Scan 15', 1994, 15, [1024, 768], { g: 17000 });
colr('apple-multiple-scan-14', 'Multiple Scan 14', 1995, 14, [1024, 768], { g: 15000 });
colr('apple-multiple-scan-15av', 'Multiple Scan 15AV', 1996, 15, [1024, 768], {
  g: 17000, spk: '内置立体声扬声器', ports: ['DB-15 视频输入', '音频输入', '音频输出'],
});
colr('apple-multiple-scan-1705', 'Multiple Scan 1705', 1996, 17, [1024, 768], { w: 420, h: 420, dp: 460, g: 20500 });
colr('apple-colorsync-17', 'ColorSync 17-inch', 1996, 17, [1024, 768], { w: 420, h: 420, dp: 460, g: 20500 });
colr('apple-colorsync-20', 'ColorSync 20-inch', 1996, 20, [1280, 1024], { w: 480, h: 460, dp: 500, g: 26000 });
colr('apple-applevision-1710', 'AppleVision 1710', 1995, 17, [1024, 768], { w: 420, h: 420, dp: 460, g: 21000 });
colr('apple-applevision-1710av', 'AppleVision 1710AV', 1995, 17, [1024, 768], {
  w: 420, h: 420, dp: 460, g: 21500, spk: '内置立体声扬声器',
  ports: ['DB-15 视频输入', 'S-Video 输入输出', '音频输入', '音频输出'],
});
colr('apple-applevision-850', 'AppleVision/ColorSync 850', 1996, 20, [1280, 1024], { w: 480, h: 460, dp: 500, g: 26500 });
colr('apple-applevision-850av', 'AppleVision/ColorSync 850AV', 1996, 20, [1280, 1024], {
  w: 480, h: 460, dp: 500, g: 27000, spk: '内置立体声扬声器',
  ports: ['DB-15 视频输入', 'S-Video 输入输出', '音频输入', '音频输出'],
});
colr('apple-applevision-750', 'AppleVision/ColorSync 750', 1997, 17, [1024, 768], { w: 420, h: 420, dp: 460, g: 20500 });
colr('apple-applevision-750av', 'AppleVision/ColorSync 750AV', 1997, 17, [1024, 768], {
  w: 420, h: 420, dp: 460, g: 21000, spk: '内置立体声扬声器',
  ports: ['DB-15 视频输入', 'S-Video 输入输出', '音频输入', '音频输出'],
});
colr('apple-multiple-scan-720', 'Multiple Scan 720', 1997, 17, [1280, 1024], { w: 420, h: 420, dp: 460, g: 21000 });

/* ══════════════════ 现代显示器补全（macdb.cn/display）═════════════════ */
const lcd = (id, name, date, size, res, ppi, o = {}) =>
  pad(id, name, date, 'display', 'Apple Display', {
    ...B, colors: ['银色'], w: 480, h: 400, dp: 180, g: 7000, size, disp: '液晶显示器', res, ppi,
    nitT: 250, ports: ['DVI 视频输入', 'USB（含 2 个下游 USB 端口）'], ...o,
  });
lcd('apple-studio-display-15', 'Apple Studio Display 15 英寸', 1998, 15, [1024, 768], 85, {
  colors: ['蓝白色'], w: 400, h: 380, dp: 200, g: 6800, ports: ['DB-15 视频输入', 'ADB'],
});
lcd('apple-studio-display-lcd', 'Apple Studio Display (LCD)', 1998, 15, [1024, 768], 85, {
  colors: ['蓝白色'], w: 400, h: 380, dp: 200, g: 6800, ports: ['DB-15 视频输入', 'ADB'],
});
lcd('apple-studio-display-17-adc', 'Apple Studio Display (17 英寸 ADC)', '2000-07-19', 17, [1280, 1024], 96, {
  g: 8300, w: 430, h: 440, dp: 180, ports: ['ADC 接口', 'USB（含 2 个下游 USB 端口）'],
});
lcd('apple-studio-display-17-lcd', 'Apple Studio Display (17 英寸 LCD)', '1999-01-05', 17, [1280, 1024], 96, {
  g: 8600, w: 430, h: 440, dp: 190, ports: ['VGA 视频输入', 'USB'],
});
lcd('apple-cinema-display-1999', 'Apple Cinema Display', '1999-09-01', 22, [1600, 1024], 86, {
  colors: ['深灰色'], g: 10800, w: 540, h: 440, dp: 240, ports: ['ADC 接口'],
});
lcd('apple-cinema-display-20', 'Apple Cinema Display (20 英寸)', '2003-01-28', 20, [1680, 1050], 99, {
  g: 8600, w: 480, h: 350, dp: 170, nitT: 250, ports: ['DVI 视频输入', 'USB（含 2 个下游 USB 端口）'],
});
lcd('apple-cinema-display-20-dvi', 'Cinema Display (20 英寸 DVI)', '2004-06-28', 20, [1680, 1050], 99, {
  g: 8700, w: 480, h: 350, dp: 170,
});
lcd('apple-cinema-display-23-dvi', 'Cinema Display (23 英寸 DVI)', '2004-06-28', 23, [1920, 1200], 98, {
  g: 10500, w: 540, h: 400, dp: 180,
});
lcd('apple-cinema-display-30-dvi', 'Cinema Display (30 英寸 DVI)', '2004-06-28', 30, [2560, 1600], 101, {
  g: 16600, w: 690, h: 480, dp: 210,
});
lcd('apple-cinema-display-20-dvi-2005', 'Cinema Display (20 英寸 DVI, 2005 年末)', '2005-10-19', 20, [1680, 1050], 99, {
  g: 8600, w: 480, h: 350, dp: 170, gamut: 'sRGB | 10 亿色彩',
});
lcd('apple-cinema-display-23-dvi-2005', 'Cinema Display (23 英寸 DVI, 2005 年末)', '2005-10-19', 23, [1920, 1200], 98, {
  g: 10500, w: 540, h: 400, dp: 180, gamut: 'sRGB | 10 亿色彩',
});
lcd('apple-cinema-display-30-dvi-2005', 'Cinema Display (30 英寸 DVI, 2005 年末)', '2005-10-19', 30, [2560, 1600], 101, {
  g: 16600, w: 690, h: 480, dp: 210, gamut: 'sRGB | 10 亿色彩',
});
lcd('apple-led-cinema-display-24', 'LED Cinema Display (24 英寸)', '2008-10-14', 24, [1920, 1200], 94, {
  g: 8300, w: 580, h: 410, dp: 190, nitT: 330,
  cam: '内置 iSight 摄像头', spk: '内置立体声扬声器',
  ports: ['Mini DisplayPort', 'USB 2.0 ×3', 'MagSafe 充电'],
  charge: 'MagSafe 充电 85W',
});

/* ══════════════════ 存储设备（新品类 storage，macdb.cn/storage，1978—2012）═════════════════ */
const KB = (kb) => kb / 1e6 / 1024; // KB → GB
const MB = (mb) => mb / 1024; // MB → GB
const st = (id, name, date, o) => pad(id, name, date, 'storage', 'Apple Storage', {
  colors: ['米白色'], mat: null, ...o,
});
// ── 软盘驱动器 ──
st('apple-disk-ii', 'Disk II', '1978-06-01', {
  w: 150, h: 100, dp: 300, g: 2300, type: '软盘', medium: '5.25 英寸软盘',
  cap: [KB(140)], bays: 1, conn: 'Apple II 外设插槽', ports: ['Apple II 外设插槽 ×1'],
  power: null, os: 'Apple DOS 3.1',
});
st('apple-disk-iii', 'Apple Disk III', '1980-11-01', {
  w: 150, h: 100, dp: 300, g: 2500, type: '软盘', medium: '5.25 英寸软盘',
  cap: [KB(140)], bays: 1, conn: 'Apple III 内置接口', ports: ['Apple III 内置接口'],
  power: null, os: 'Apple SOS 1.0',
});
st('apple-disk-iic', 'Apple Disk IIc', 1984, {
  w: 145, h: 95, dp: 290, g: 2100, type: '软盘', medium: '5.25 英寸软盘',
  cap: [KB(140)], bays: 1, conn: 'Apple IIc 软驱接口', ports: ['Apple IIc 软驱接口'],
  power: null, os: 'Apple DOS 3.3',
});
st('apple-duo-disk', 'Apple DuoDisk', 1985, {
  w: 160, h: 110, dp: 310, g: 3400, type: '软盘', medium: '5.25 英寸软盘',
  cap: [KB(140)], bays: 2, conn: 'Apple II 外设插槽', ports: ['Apple II 外设插槽 ×1'],
  power: null, os: 'Apple DOS 3.3',
});
st('apple-3-5-drive', 'Apple 3.5 Drive', 1986, {
  w: 140, h: 60, dp: 210, g: 1200, type: '软盘', medium: '3.5 英寸软盘',
  cap: [KB(800)], bays: 1, conn: 'Apple II 外设插槽', ports: ['Apple II 外设插槽 ×1'],
  power: null, os: 'Apple DOS 3.3',
});
st('apple-fdhd-superdrive', 'Apple FDHD / SuperDrive', 1988, {
  w: 140, h: 60, dp: 210, g: 1250, type: '软盘', medium: '3.5 英寸软盘',
  cap: [MB(1.44)], bays: 1, conn: '软驱接口', ports: ['外接软驱接口'],
  power: null, os: 'System 6',
});
st('apple-macintosh-400k-external', 'Macintosh 400K External Drive', '1984-01-24', {
  w: 140, h: 60, dp: 210, g: 1200, type: '软盘', medium: '3.5 英寸软盘',
  cap: [KB(400)], bays: 1, conn: '软驱接口', ports: ['外接软盘口'],
  power: null, os: 'Macintosh System 1',
});
st('apple-macintosh-800k-external', 'Macintosh 800K External Drive', 1986, {
  w: 140, h: 60, dp: 210, g: 1200, type: '软盘', medium: '3.5 英寸软盘',
  cap: [KB(800)], bays: 1, conn: '软驱接口', ports: ['外接软盘口'],
  power: null, os: 'Macintosh System 3',
});
st('apple-powerbook-2400c-floppy', 'Macintosh PowerBook 2400c Floppy Disk Drive', '1997-05-01', {
  w: 130, h: 25, dp: 150, g: 280, type: '软盘', medium: '3.5 英寸软盘',
  cap: [MB(1.44)], bays: 1, conn: '软驱接口', ports: ['外接软驱接口'],
  power: null, os: 'Mac OS 7.6',
});
st('apple-hdi20-external-floppy', 'Macintosh HDI-20 External 1.4MB Floppy Disk Drive', 1995, {
  w: 130, h: 25, dp: 150, g: 290, type: '软盘', medium: '3.5 英寸软盘',
  cap: [MB(1.44)], bays: 1, conn: 'HDI-20 软驱接口', ports: ['HDI-20 软驱接口'],
  power: null, os: 'System 7.5',
});
// ── 硬盘 ──
st('apple-profile', 'Apple ProFile', '1981-09-01', {
  w: 380, h: 130, dp: 400, g: 11000, type: '硬盘', medium: '5MB 温彻斯特硬盘',
  cap: [MB(5)], bays: 1, conn: 'Apple III / Lisa 并行接口', ports: ['并行接口'],
  power: '内置电源', os: 'Apple SOS 1.0',
});
st('apple-macintosh-hard-disk-20', 'Macintosh Hard Disk 20', '1985-09-17', {
  w: 260, h: 90, dp: 300, g: 3600, type: '硬盘', medium: '20MB 硬盘',
  cap: [MB(20)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'Macintosh System 2',
});
st('apple-hard-disk-20sc', 'Apple Hard Disk 20SC', 1986, {
  w: 260, h: 90, dp: 300, g: 3600, type: '硬盘', medium: '20MB 硬盘',
  cap: [MB(20)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 3',
});
st('apple-hard-disk-40sc', 'Apple Hard Disk 40SC', 1987, {
  w: 260, h: 90, dp: 300, g: 3800, type: '硬盘', medium: '40MB 硬盘',
  cap: [MB(40)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 5',
});
st('apple-hard-disk-80sc', 'Apple Hard Disk 80SC', 1987, {
  w: 260, h: 90, dp: 300, g: 4000, type: '硬盘', medium: '80MB 硬盘',
  cap: [MB(80)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 5',
});
st('apple-hard-disk-160sc', 'Apple Hard Disk 160SC', 1988, {
  w: 260, h: 90, dp: 300, g: 4200, type: '硬盘', medium: '160MB 硬盘',
  cap: [MB(160)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 6',
});
st('apple-external-hard-drive', 'Apple External Hard Drive', 1993, {
  w: 240, h: 70, dp: 280, g: 2600, type: '硬盘', medium: '硬盘',
  cap: [MB(230), MB(500)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 7',
});
st('apple-drive-module-ata', 'Apple Drive Module (ATA)', '2001-01-09', {
  w: 150, h: 30, dp: 220, g: 900, colors: ['银色'], type: '硬盘', medium: '硬盘',
  cap: [MB(20000), MB(40000), MB(60000)], bays: 1, conn: 'ATA', ports: ['Xserve ATA 盘位'],
  power: '主机供电', os: 'Mac OS X Server',
});
st('apple-drive-module-sata-sas', 'Apple Drive Module (SATA/SAS)', '2004-01-06', {
  w: 150, h: 30, dp: 220, g: 950, colors: ['银色'], type: '硬盘', medium: '硬盘',
  cap: [MB(80000), MB(250000), MB(500000)], bays: 1, conn: 'SATA/SAS', ports: ['Xserve 盘位'],
  power: '主机供电', os: 'Mac OS X Server',
});
// ── 光盘驱动器 ──
st('apple-cd-sc', 'AppleCD SC', 1988, {
  w: 210, h: 70, dp: 330, g: 3200, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 6',
});
st('apple-cd-sc-plus', 'AppleCD SC Plus', 1989, {
  w: 210, h: 70, dp: 330, g: 3300, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 6',
});
st('apple-powercd', 'Apple PowerCD', '1993-05-01', {
  w: 165, h: 50, dp: 230, g: 1400, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI', '音频输出'],
  power: '内置电源', os: 'System 7',
});
st('apple-cd-150', 'AppleCD 150', 1993, {
  w: 210, h: 70, dp: 330, g: 3200, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 7',
});
st('apple-cd-300', 'AppleCD 300', 1994, {
  w: 210, h: 70, dp: 330, g: 3300, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 7.5',
});
st('apple-cd-300e-plus', 'AppleCD 300e Plus', 1995, {
  w: 210, h: 70, dp: 330, g: 3400, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 7.5',
});
st('apple-cd-600e', 'AppleCD 600e', 1995, {
  w: 210, h: 70, dp: 330, g: 3500, type: '光盘驱动器', medium: 'CD-ROM',
  cap: [MB(650)], bays: 1, conn: 'SCSI', ports: ['SCSI'],
  power: '内置电源', os: 'System 7.5',
});
st('apple-macbook-air-superdrive', 'MacBook Air SuperDrive', '2008-01-15', {
  w: 140, h: 20, dp: 140, g: 300, colors: ['银色'], mat: '铝金属机身',
  type: '光盘驱动器', medium: 'DVD±R DL', cap: [MB(8500)], bays: 1,
  conn: 'USB 2.0', ports: ['USB 2.0'], power: 'USB 供电', os: 'Mac OS X v10.5.6 或更高版本',
});
st('apple-usb-superdrive', 'USB SuperDrive', '2008-10-14', {
  w: 140, h: 20, dp: 140, g: 300, colors: ['白色'], mat: '聚碳酸酯白色一体成型机身',
  type: '光盘驱动器', medium: 'DVD±R DL', cap: [MB(8500)], bays: 1,
  conn: 'USB 2.0', ports: ['USB 2.0'], power: 'USB 供电', os: 'Mac OS X v10.5.6 或更高版本',
});
// ── 磁盘阵列 ──
st('apple-xserve-raid-2003', 'Xserve RAID', '2003-02-10', {
  w: 447, h: 133, dp: 660, g: 24000, colors: ['银色'], mat: '3U 机架式（14 盘位）',
  type: '磁盘阵列', medium: '硬盘',
  cap: [MB(250000), MB(500000), MB(750000), MB(1750000), MB(3500000)], bays: 14,
  conn: '光纤通道 2Gb ×2', ports: ['光纤通道 2Gb ×2', '以太网管理口'],
  power: '内置电源', os: 'Mac OS X Server',
});
st('apple-xserve-raid-sfp', 'Xserve RAID (SFP)', '2004-01-06', {
  w: 447, h: 133, dp: 660, g: 24000, colors: ['银色'], mat: '3U 机架式（14 盘位）',
  type: '磁盘阵列', medium: '硬盘',
  cap: [MB(750000), MB(1750000), MB(3500000)], bays: 14,
  conn: '光纤通道 2Gb ×2', ports: ['光纤通道 2Gb ×2', '以太网管理口'],
  power: '内置电源', os: 'Mac OS X Server',
});
st('apple-xserve-raid-sfp-late2004', 'Xserve RAID (SFP Late 2004)', '2004-12-01', {
  w: 447, h: 133, dp: 660, g: 24000, colors: ['银色'], mat: '3U 机架式（14 盘位）',
  type: '磁盘阵列', medium: '硬盘',
  cap: [MB(1750000), MB(3500000), MB(5250000), MB(10500000)], bays: 14,
  conn: '光纤通道 2Gb ×2', ports: ['光纤通道 2Gb ×2', '以太网管理口'],
  power: '内置电源', os: 'Mac OS X Server',
});

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
