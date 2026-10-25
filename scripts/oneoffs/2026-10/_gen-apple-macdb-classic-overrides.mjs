/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 A1（经典 Mac 台式，约 100 台）
 *
 * 背景：macdb.cn 收录 Apple 设备 889 台（8 产品线 / 1976—2026），本站苹果此前 403 台，
 * 缺口主要来自 Mac 台式的**机型级细分**（macDB 按「Macintosh 106 / PowerMac 45 /
 * iMac 66 / Server 28」口径，本站只录了主干代际）。本批按 macDB 分类页清单补齐：
 *   - Macintosh 68k 家族补全（Classic II / IIsi / LC III 系 / LC 5xx 系 / Quadra 6xx-8xx / Centris / TV）
 *   - Macintosh Performa 全系（1992—1996，43 个 SKU，多数为 LC/Quadra/PowerMac 换标机型）
 *   - Power Macintosh 缺失型号（5200/5300/5260/5400/5500/6200/6300/6400/7215/7220/7500/7600/8200）
 *   - Power Mac G3/G4/G5 各中间代（PCI/AGP/GE/Digital Audio/QuickSilver/FW800/MDD + G3 四种机箱）
 *   - Macintosh Server G3/G4、Workgroup Server 补全、Network Server 500/700
 *
 * 数据来源：macdb.cn/macintosh|macintosh-performa|power-macintosh|power-mac-g345|macintosh-server|
 * workgroup-server|network-server 分类页清单（抓取核对脚本见 _work/macdb/），逐机型 CPU/频率/
 * 存储/系统按 Apple 官方档案与 everymac 口径互证；置信度中（1990 年代机型官方英文规格页
 * 已下架，按「查不到官方英文不登记」纪律保留中文原文）。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-classic';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

// 日期精度从日期形状派生（2026-10-17 审计 A3）：'YYYY-01-01'+day 是假精度（闸门16 拒），
// 手工把精度降成 year 又会留下「形状不符」——精度与形状同源，永远一致
const precisionOf = (d) => (d.split('-').length === 3 ? 'day' : d.split('-').length === 2 ? 'month' : 'year');

/** 短键 → schema path 映射，让每台机器只占一行 */
const K = {
  w: 'body.widthMm', h: 'body.heightMm', d: 'body.depthMm', kg: 'body.weightKg',
  mat: 'body.material', colors: 'body.colors',
  size: 'display.sizeIn', disp: 'display.type', res: 'display.resolutionPx',
  cpu: 'chipset.name', arch: 'chipset.arch', nm: 'chipset.processNm', cores: 'chipset.cpuCores',
  gpu: 'chipset.gpu', npu: 'chipset.npu',
  ram: 'memory.ramGb', ramT: 'memory.ramType', sto: 'memory.storageGb', stoT: 'memory.storageType',
  wifi: 'connectivity.wifi', bt: 'connectivity.bluetooth', ports: 'connectivity.ports',
  cam: 'camera.front', spk: 'audio.speakers', jack: 'audio.jack', os: 'os.launch',
};

/** 68k / NuBus 时代台式机公共默认值（全部字段显式落地，null 表示官网未公布） */
const B68 = {
  mat: null, colors: ['米白色'], size: null, disp: null, res: null,
  arch: '68k', nm: null, cores: 1, gpu: null, npu: null,
  ram: null, ramT: null, sto: null, stoT: 'SCSI 硬盘 + 软盘',
  wifi: null, bt: null, ports: null, cam: null, spk: '内置扬声器', jack: null, os: 'System 7',
};

const px = (w, h) => ({ w, h });

function pad({ id, name, date, category, line, o }) {
  seq += 1;
  const specs = {};
  for (const [k, v] of Object.entries({ ...B68, ...o })) {
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
    reason: '苹果全系列·macDB 对账批 A1（经典 Mac 台式：68k 家族 → Performa 全系 → Power Macintosh → Power Mac G3/G4/G5 → Server 系）——macDB 分类页清单与 Apple 官方档案互证，1990 年代机型置信度中',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

const desk = (id, name, date, line, o) => pad({ id, name, date, category: 'desktop', line, o });

/* ──────────────── Macintosh 68k 家族补全（macdb.cn/macintosh）──────────────── */
// 已收录（不重复）：128K / 512K / Classic / Color Classic / II / IIx / IIcx / IIci / IIfx /
// IIvi / IIvx / LC / LC II / Plus / Quadra 700 / Quadra 900 / Quadra 950 / SE / SE/30 / XL
desk('apple-macintosh-512ke', 'Macintosh 512Ke', '1986-04-14', 'Macintosh', {
  w: 345, h: 244, d: 277, kg: 7.5, size: 9, disp: '内置单色 CRT 显示屏', res: [512, 342],
  cpu: 'Motorola 68000 处理器 | 8MHz', stoT: '软盘 + 外接硬盘', os: 'System 3.2',
  ports: ['软盘端口', '串口 ×2', '外接显示器端口'],
});
desk('apple-macintosh-se-fdhd', 'Macintosh SE FDHD', '1989-08-01', 'Macintosh', {
  w: 345, h: 246, d: 277, kg: 7.7, size: 9, disp: '内置单色 CRT 显示屏', res: [512, 342],
  cpu: 'Motorola 68000 处理器 | 8MHz', stoT: '软盘 + 内置硬盘', os: 'System 6.0.7 或更高版本',
  ports: ['软盘端口', '串口 ×2', 'SCSI'],
});
desk('apple-macintosh-classic-ii', 'Macintosh Classic II', '1991-10-21', 'Macintosh', {
  w: 335, h: 246, d: 394, kg: 10.2, size: 9, disp: '内置单色 CRT 显示屏', res: [512, 342],
  cpu: 'Motorola 68030 处理器 | 16MHz', stoT: '软盘 + 内置硬盘',
  ports: ['软盘端口', '串口 ×2', 'SCSI'],
});
desk('apple-macintosh-iisi', 'Macintosh IIsi', '1990-10-15', 'Macintosh', {
  w: 320, h: 102, d: 394, kg: 4.1, cpu: 'Motorola 68030 处理器 | 20MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网'],
});
desk('apple-macintosh-lc-iii', 'Macintosh LC III', '1993-02-10', 'Macintosh', {
  w: 310, h: 74, d: 389, kg: 4, cpu: 'Motorola 68030 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-iii-plus', 'Macintosh LC III+', '1993-10-18', 'Macintosh', {
  w: 310, h: 74, d: 389, kg: 4, cpu: 'Motorola 68030 处理器 | 33MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-475', 'Macintosh LC 475', '1993-10-18', 'Macintosh', {
  w: 310, h: 74, d: 389, kg: 4, cpu: 'Motorola 68LC040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-520', 'Macintosh LC 520', '1993-06-28', 'Macintosh', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
  cpu: 'Motorola 68030 处理器 | 25MHz', stoT: '软盘 + SCSI 硬盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-550', 'Macintosh LC 550', '1994-02-28', 'Macintosh', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
  cpu: 'Motorola 68030 处理器 | 33MHz', stoT: '软盘 + SCSI 硬盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-575', 'Macintosh LC 575', '1994-02-28', 'Macintosh', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
  cpu: 'Motorola 68LC040 处理器 | 33MHz', stoT: '软盘 + SCSI 硬盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-580', 'Macintosh LC 580', '1995-04-01', 'Macintosh', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
  cpu: 'Motorola 68LC040 处理器 | 33MHz', stoT: '软盘 + SCSI 硬盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-lc-630', 'Macintosh LC 630', '1994-07-01', 'Macintosh', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'Motorola 68LC040 处理器 | 33MHz',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-color-classic-ii', 'Macintosh Color Classic II', '1993-10-18', 'Macintosh', {
  w: 368, h: 251, d: 320, kg: 10.2, size: 10, disp: '内置彩色 CRT 显示屏', res: [512, 384],
  cpu: 'Motorola 68030 处理器 | 33MHz', stoT: '软盘 + SCSI 硬盘',
  ports: ['软盘端口', '串口 ×2', 'SCSI'],
});
desk('apple-macintosh-quadra-605', 'Macintosh Quadra 605', '1993-10-18', 'Macintosh', {
  w: 310, h: 74, d: 389, kg: 3.1, cpu: 'Motorola 68LC040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-610', 'Macintosh Quadra 610', '1993-10-18', 'Macintosh', {
  w: 414, h: 86, d: 419, kg: 5.9, cpu: 'Motorola 68040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-650', 'Macintosh Quadra 650', '1993-10-18', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 33MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-660av', 'Macintosh Quadra 660AV', '1993-07-29', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', 'AV 视频输入输出', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-800', 'Macintosh Quadra 800', '1993-02-10', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 33MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-840av', 'Macintosh Quadra 840AV', '1993-07-29', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 40MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', 'AV 视频输入输出', '以太网（AAUI）'],
});
desk('apple-macintosh-quadra-630', 'Macintosh Quadra 630', '1994-07-01', 'Macintosh', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'Motorola 68LC040 处理器 | 33MHz',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-tv', 'Macintosh TV', '1993-10-25', 'Macintosh', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
  cpu: 'Motorola 68030 处理器 | 32MHz', stoT: '软盘 + SCSI 硬盘 + CD-ROM',
  ports: ['软盘端口', '串口 ×2', 'SCSI', 'TV/FM 调谐器', 'S-Video 输入输出'],
});
desk('apple-macintosh-centris-610', 'Macintosh Centris 610', '1993-02-10', 'Macintosh', {
  w: 414, h: 86, d: 419, kg: 5.9, cpu: 'Motorola 68040 处理器 | 20MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-centris-650', 'Macintosh Centris 650', '1993-02-10', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', '以太网（AAUI）'],
});
desk('apple-macintosh-centris-660av', 'Macintosh Centris 660AV', '1993-07-29', 'Macintosh', {
  w: 419, h: 152, d: 330, kg: 11.3, cpu: 'Motorola 68040 处理器 | 25MHz',
  ports: ['软盘端口', '串口 ×2', 'SCSI', 'AV 视频输入输出', '以太网（AAUI）'],
});

/* ──────────────── Macintosh Performa 全系（macdb.cn/macintosh-performa，43 SKU）──────────────── */
// Performa 是消费渠道换标机型：与 LC / Quadra / Power Macintosh 同硬件不同型号名，
// macDB 按 SKU 单列，本站跟随（否则消费线整段缺失）。
const perf = (n, date, cpu, o = {}) =>
  desk(`apple-macintosh-performa-${n}`, `Macintosh Performa ${n}`, date, 'Macintosh Performa', {
    w: 414, h: 109, d: 419, kg: 8.6, cpu, ...o,
  });
const perf14 = (n, date, cpu, o = {}) => // LC 5xx 一体机形态（14 英寸 CRT）
  desk(`apple-macintosh-performa-${n}`, `Macintosh Performa ${n}`, date, 'Macintosh Performa', {
    w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
    cpu, stoT: '软盘 + SCSI 硬盘 + CD-ROM', ...o,
  });
const perf9 = (n, date, cpu, o = {}) => // Classic / Color Classic 形态（9–10 英寸 CRT）
  desk(`apple-macintosh-performa-${n}`, `Macintosh Performa ${n}`, date, 'Macintosh Performa', {
    w: 335, h: 246, d: 394, kg: 10.2, size: 9, disp: '内置单色 CRT 显示屏', res: [512, 342],
    cpu, stoT: '软盘 + 内置硬盘', ...o,
  });
// 1992–1993：Classic II / Color Classic / LC III 换标
perf9('200', '1992-09-14', 'Motorola 68030 处理器 | 16MHz');
perf('400', '1992-09-14', 'Motorola 68030 处理器 | 16MHz');
perf('405', '1993-04-12', 'Motorola 68030 处理器 | 16MHz');
perf('410', '1993-04-12', 'Motorola 68030 处理器 | 16MHz');
perf('430', '1993-04-12', 'Motorola 68030 处理器 | 16MHz');
perf14('250', '1993-02-01', 'Motorola 68030 处理器 | 16MHz', {
  size: 10, disp: '内置彩色 CRT 显示屏', res: [512, 384], stoT: '软盘 + SCSI 硬盘',
});
perf14('275', '1993-06-01', 'Motorola 68030 处理器 | 33MHz', {
  size: 10, disp: '内置彩色 CRT 显示屏', res: [512, 384], stoT: '软盘 + SCSI 硬盘',
});
perf('450', '1993-04-12', 'Motorola 68030 处理器 | 25MHz');
perf('460', '1993-04-12', 'Motorola 68030 处理器 | 33MHz');
perf('467', '1993-04-12', 'Motorola 68030 处理器 | 33MHz');
perf('475', '1993-10-18', 'Motorola 68LC040 处理器 | 25MHz');
perf('476', '1993-10-18', 'Motorola 68LC040 处理器 | 25MHz');
perf14('520', '1993-06-28', 'Motorola 68030 处理器 | 25MHz');
perf14('550', '1993-10-18', 'Motorola 68030 处理器 | 33MHz');
perf14('560 Money Edition', 1994, 'Motorola 68030 处理器 | 33MHz');
perf14('575', '1994-02-28', 'Motorola 68LC040 处理器 | 33MHz');
perf14('577', '1994-02-28', 'Motorola 68LC040 处理器 | 33MHz');
perf14('578', '1994-02-28', 'Motorola 68LC040 处理器 | 33MHz');
perf('600', '1992-09-14', 'Motorola 68030 处理器 | 32MHz');
perf('600/600CD', '1992-09-14', 'Motorola 68030 处理器 | 32MHz', { stoT: 'SCSI 硬盘 + 软盘 + CD-ROM' });
// 1994：LC 630 / Quadra 630 换标
perf('630', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('630CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('631CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('635CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('636', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('636CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('637CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('638CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
perf('640CD', '1994-07-01', 'Motorola 68LC040 处理器 | 33MHz', { stoT: 'IDE 硬盘 + 软盘 + CD-ROM' });
// 1994–1996：Power Macintosh 换标（PPC）
perf('6100 Series', '1994-11-01', 'PowerPC 601 处理器 | 60/66MHz', {
  arch: 'PowerPC', stoT: 'SCSI 硬盘 + 软盘 + CD-ROM',
});
perf14('5200CD', '1995-04-03', 'PowerPC 603 处理器 | 75MHz', { arch: 'PowerPC' });
perf14('5210CD', '1995-04-03', 'PowerPC 603 处理器 | 75MHz', { arch: 'PowerPC' });
perf14('5215CD', '1995-07-01', 'PowerPC 603 处理器 | 75MHz', { arch: 'PowerPC' });
perf14('5220CD', '1995-11-01', 'PowerPC 603 处理器 | 75MHz', { arch: 'PowerPC' });
perf14('5260CD', '1996-04-15', 'PowerPC 603e 处理器 | 100MHz', { arch: 'PowerPC' });
perf14('5270CD', '1996-04-15', 'PowerPC 603e 处理器 | 100MHz', { arch: 'PowerPC' });
perf14('5280', '1996-11-01', 'PowerPC 603e 处理器 | 120MHz', { arch: 'PowerPC' });
perf14('5300CD', '1995-08-28', 'PowerPC 603e 处理器 | 100MHz', { arch: 'PowerPC' });
perf14('5320CD', '1995-11-01', 'PowerPC 603e 处理器 | 120MHz', { arch: 'PowerPC' });
perf14('5400 Series', '1996-04-15', 'PowerPC 603e 处理器 | 160/200MHz', { arch: 'PowerPC' });
desk('apple-macintosh-performa-6200-series', 'Macintosh Performa 6200 Series', '1995-05-01', 'Macintosh Performa', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'PowerPC 603 处理器 | 75MHz', arch: 'PowerPC',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
desk('apple-macintosh-performa-6300-series', 'Macintosh Performa 6300 Series', '1995-11-01', 'Macintosh Performa', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'PowerPC 603e 处理器 | 100/120MHz', arch: 'PowerPC',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
desk('apple-macintosh-performa-6360', 'Macintosh Performa 6360', '1996-10-01', 'Macintosh Performa', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'PowerPC 603e 处理器 | 160MHz', arch: 'PowerPC',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
desk('apple-macintosh-performa-6400-6410-6420', 'Macintosh Performa 6400/6410/6420', '1996-08-05', 'Macintosh Performa', {
  w: 414, h: 109, d: 419, kg: 8.6, cpu: 'PowerPC 603e 处理器 | 180/200MHz', arch: 'PowerPC',
  stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});

/* ──────────────── Power Macintosh 缺失型号（macdb.cn/power-macintosh）──────────────── */
// 已收录：4400 / 6100 / 6500 / 7100 / 7200 / 7300 / 8100 / 8500 / 8600 / 9500 / 9600
const ppm = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Power Macintosh', {
    w: 400, h: 210, d: 410, kg: 9.7, arch: 'PowerPC', cpu,
    stoT: 'SCSI 硬盘 + 软盘 + CD-ROM', os: 'System 7.5', cores: 1, ...o,
  });
ppm('apple-power-macintosh-5200-75lc', 'Power Macintosh 5200/75 LC', '1995-04-03', 'PowerPC 603 处理器 | 75MHz', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
});
ppm('apple-power-macintosh-5300-100lc', 'Power Macintosh 5300/100 LC', '1995-08-28', 'PowerPC 603e 处理器 | 100MHz', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
});
ppm('apple-power-macintosh-5260', 'Power Macintosh 5260', '1996-04-15', 'PowerPC 603e 处理器 | 100MHz', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
});
ppm('apple-power-macintosh-5400', 'Power Macintosh 5400', '1996-04-15', 'PowerPC 603e 处理器 | 160/200MHz', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
});
ppm('apple-power-macintosh-5500', 'Power Macintosh 5500', '1997-02-17', 'PowerPC 603e 处理器 | 225/250MHz', {
  w: 470, h: 455, d: 366, kg: 18.6, size: 14, disp: '内置彩色 CRT 显示屏', res: [640, 480],
});
ppm('apple-power-macintosh-6200', 'Power Macintosh 6200', '1995-05-01', 'PowerPC 603 处理器 | 75MHz', {
  w: 414, h: 109, d: 419, kg: 8.6, stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
ppm('apple-power-macintosh-6300', 'Power Macintosh 6300', '1995-11-01', 'PowerPC 603e 处理器 | 100/120MHz', {
  w: 414, h: 109, d: 419, kg: 8.6, stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
ppm('apple-power-macintosh-6400', 'Power Macintosh 6400', '1996-08-05', 'PowerPC 603e 处理器 | 180/200MHz', {
  w: 414, h: 109, d: 419, kg: 8.6, stoT: 'IDE 硬盘 + 软盘 + CD-ROM',
});
ppm('apple-power-macintosh-7215', 'Power Macintosh 7215', '1995-05-01', 'PowerPC 601 处理器 | 75MHz', {
  w: 414, h: 109, d: 419, kg: 8.6,
});
ppm('apple-power-macintosh-7220', 'Power Macintosh 7220', 1996, 'PowerPC 601 处理器 | 120MHz', {
  w: 414, h: 109, d: 419, kg: 8.6,
});
ppm('apple-power-macintosh-7500', 'Power Macintosh 7500', '1995-08-08', 'PowerPC 601 处理器 | 100MHz', {
  w: 400, h: 210, d: 410, kg: 9.7,
});
ppm('apple-power-macintosh-7600', 'Power Macintosh 7600', '1996-04-22', 'PowerPC 604e 处理器 | 120/132/200MHz', {
  w: 400, h: 210, d: 410, kg: 9.7,
});
ppm('apple-power-macintosh-8200', 'Power Macintosh 8200', '1996-04-22', 'PowerPC 601 处理器 | 100/120MHz', {
  w: 400, h: 210, d: 410, kg: 11,
});

/* ──────────────── Power Mac G3/G4/G5 中间代（macdb.cn/power-mac-g345）──────────────── */
// 已收录：G5 2003-06 / 2004-06 / 2004-10 / 2005-04 / 2005-10 双核 / G4 Cube / G4 MDD 2003
const g3 = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Power Mac', {
    w: 400, h: 380, d: 430, kg: 11.5, arch: 'PowerPC', cpu, cores: 1,
    stoT: '硬盘 (ATA)', colors: ['米白色', '蓝色'], os: 'Mac OS 8.1 或更高版本',
    ports: ['千兆以太网', '串口 ×2', 'USB 1.1 ×2', 'ADB'], ...o,
  });
g3('apple-power-macintosh-g3-desktop', 'Power Macintosh G3 (Desktop)', '1997-11-10', 'PowerPC G3 处理器 | 233MHz');
g3('apple-power-macintosh-g3-mini-tower', 'Power Macintosh G3 (Mini Tower)', '1997-11-10', 'PowerPC G3 处理器 | 233–266MHz');
g3('apple-power-macintosh-g3-all-in-one', 'Power Macintosh G3 (All-in-One)', '1998-03-31', 'PowerPC G3 处理器 | 233–266MHz', {
  size: 15, disp: '内置彩色 CRT 显示屏', res: [1024, 768], kg: 14.5,
});
g3('apple-power-macintosh-g3-blue-white', 'Power Macintosh G3 (Blue and White)', '1999-01-05', 'PowerPC G3 处理器 | 300/350/400MHz', {
  colors: ['蓝白色'], stoT: '硬盘 (SCSI)', os: 'Mac OS 8.6 或更高版本',
  ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', '串口 ×2'],
});
const g4 = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Power Mac', {
    w: 226, h: 432, d: 467, kg: 14.4, arch: 'PowerPC', cpu, cores: 1,
    stoT: '硬盘 (ATA)', colors: ['银色', '石墨色'], mat: '铝金属塔式机箱',
    os: 'Mac OS 9.0.4 或更高版本',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2'], ...o,
  });
g4('apple-power-mac-g4-pci-graphics', 'Power Mac G4 (PCI Graphics)', '1999-08-31', 'PowerPC G4 处理器 | 350/400MHz', {
  kg: 13.6, os: 'Mac OS 8.6 或更高版本',
});
g4('apple-power-mac-g4-agp-graphics', 'Power Mac G4 (AGP Graphics)', '1999-12-16', 'PowerPC G4 处理器 | 350/400/450MHz', {
  kg: 13.6,
});
g4('apple-power-mac-g4-gigabit-ethernet', 'Power Mac G4 (Gigabit Ethernet)', '2000-07-19', 'PowerPC G4 处理器 | 400/450/500MHz', {
  kg: 14.4, cores: 2,
});
g4('apple-power-mac-g4-digital-audio', 'Power Mac G4 (Digital Audio)', '2001-01-09', 'PowerPC G4 处理器 | 466/533/667/733MHz', {
  kg: 14.4, cores: 2, os: 'Mac OS 9.1 或更高版本',
});
g4('apple-power-mac-g4-quicksilver', 'Power Mac G4 (QuickSilver)', '2001-07-18', 'PowerPC G4 处理器 | 733/800/867MHz', {
  kg: 14.4, cores: 2, os: 'Mac OS X v10.0.4 或更高版本',
});
g4('apple-power-mac-g4-quicksilver-2002', 'Power Mac G4 (QuickSilver 2002)', '2002-01-28', 'PowerPC G4 处理器 | 800/867/933MHz/1GHz', {
  kg: 14.4, cores: 2,
});
g4('apple-power-mac-g4-quicksilver-2002ed', 'Power Mac G4 (QuickSilver 2002ED)', '2002-08-13', 'PowerPC G4 处理器 | 1.0/1.25GHz', {
  kg: 14.4, cores: 2,
});
g4('apple-power-mac-g4-firewire-800', 'Power Mac G4 (FireWire 800)', '2003-01-28', 'PowerPC G4 处理器 | 1.0/1.25/1.42GHz', {
  kg: 15.1, cores: 2, ports: ['千兆以太网', 'FireWire 800', 'FireWire 400 ×2', 'USB 1.1 ×2'],
});
g4('apple-power-mac-g4-mdd-2002', 'Power Mac G4 (Mirrored Drive Doors 2002 年)', '2002-08-13', 'PowerPC G4 处理器 | 7455 | 867MHz–1.25GHz', {
  kg: 19.1, mat: '镜面门铝金属机箱', cores: 2,
});
// 注：Power Mac G5（2003-06 初代）已由 heritage 批以「Power Mac G5」收录，此处不重复。

/* ──────────────── Macintosh Server G3 / G4（macdb.cn/macintosh-server）──────────────── */
const srv = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Macintosh Server', {
    w: 226, h: 432, d: 467, kg: 14.4, arch: 'PowerPC', cpu, cores: 1,
    stoT: '硬盘 (ATA)', colors: ['银色', '石墨色'], mat: '铝金属塔式机箱',
    os: 'Mac OS X Server', ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2'], ...o,
  });
srv('apple-macintosh-server-g3', 'Macintosh Server G3', '1997-11-10', 'PowerPC G3 处理器 | 233MHz', {
  w: 400, h: 380, d: 430, kg: 11.5, colors: ['米白色'], mat: null, stoT: '硬盘 (SCSI)',
});
srv('apple-macintosh-server-g3-bw', 'Macintosh Server G3 (Blue and White)', '1999-01-05', 'PowerPC G3 处理器 | 300/350MHz', {
  w: 400, h: 380, d: 430, kg: 12.7, colors: ['蓝白色'], stoT: '硬盘 (SCSI)',
});
srv('apple-macintosh-server-g4-agp', 'Macintosh Server G4 (AGP Graphics)', '1999-12-16', 'PowerPC G4 处理器 | 350/400MHz');
srv('apple-macintosh-server-g4-ge', 'Macintosh Server G4 (Gigabit Ethernet)', '2000-07-19', 'PowerPC G4 处理器 | 450MHz', { cores: 2 });
srv('apple-macintosh-server-g4-da', 'Macintosh Server G4 (Digital Audio)', '2001-01-09', 'PowerPC G4 处理器 | 533MHz', { cores: 2 });
srv('apple-macintosh-server-g4-qs2001', 'Macintosh Server G4 (QuickSilver 2001)', '2001-07-18', 'PowerPC G4 处理器 | 733/867MHz', { cores: 2 });
srv('apple-macintosh-server-g4-qs2002', 'Macintosh Server G4 (QuickSilver 2002)', '2002-01-28', 'PowerPC G4 处理器 | 1GHz', { cores: 2 });
srv('apple-macintosh-server-g4-mdd', 'Macintosh Server G4 (Mirrored Drive Doors)', '2002-08-13', 'PowerPC G4 处理器 | 7455 | 1.0–1.25GHz', {
  kg: 19.1, mat: '镜面门铝金属机箱', cores: 2,
});

/* ──────────────── Workgroup Server 补全（macdb.cn/workgroup-server）──────────────── */
// 已收录：Workgroup Server 80 / 9150
const wgs = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Workgroup Server', {
    w: 419, h: 152, d: 330, kg: 11.3, colors: ['米白色'], arch: 'PowerPC', cpu, cores: 1,
    stoT: 'SCSI 硬盘 + 软盘 + CD-ROM', os: 'System 7.5',
    ports: ['以太网（AAUI）', 'SCSI', '串口 ×2'], ...o,
  });
wgs('apple-workgroup-server-95', 'Workgroup Server 95', '1993-03-15', 'Motorola 68040 处理器 | 33MHz', { arch: '68k' });
wgs('apple-workgroup-server-60', 'Workgroup Server 60', '1993-03-15', 'Motorola 68040 处理器 | 20MHz', { arch: '68k', kg: 5.9 });
wgs('apple-workgroup-server-6150-60', 'Workgroup Server 6150 (60 MHz)', '1994-04-25', 'PowerPC 601 处理器 | 60MHz');
wgs('apple-workgroup-server-6150-66', 'Workgroup Server 6150 (66 MHz)', '1994-04-25', 'PowerPC 601 处理器 | 66MHz');
wgs('apple-workgroup-server-8150-80', 'Workgroup Server 8150 (80 MHz)', '1994-04-25', 'PowerPC 601 处理器 | 80MHz');
wgs('apple-workgroup-server-8150-110', 'Workgroup Server 8150 (110 MHz)', '1994-04-25', 'PowerPC 601 处理器 | 110MHz');
wgs('apple-workgroup-server-9150-80', 'Workgroup Server 9150 (80 MHz)', '1995-04-03', 'PowerPC 601 处理器 | 80MHz');
wgs('apple-workgroup-server-7250', 'Workgroup Server 7250', '1995-11-01', 'PowerPC 601 处理器 | 120MHz', { w: 414, h: 109, d: 419, kg: 8.6 });
wgs('apple-workgroup-server-8550-132', 'Workgroup Server 8550 (132 MHz)', '1995-11-01', 'PowerPC 604e 处理器 | 132MHz');
wgs('apple-workgroup-server-8550-200', 'Workgroup Server 8550 (200 MHz)', '1996-04-22', 'PowerPC 604e 处理器 | 200MHz');
wgs('apple-workgroup-server-7350', 'Workgroup Server 7350', '1996-04-22', 'PowerPC 604e 处理器 | 180MHz');
wgs('apple-workgroup-server-9650-233', 'Workgroup Server 9650 (233 MHz)', '1996-08-07', 'PowerPC 604e 处理器 | 233MHz', { kg: 14.1 });
wgs('apple-workgroup-server-9650-350', 'Workgroup Server 9650 (350 MHz)', '1997-02-17', 'PowerPC 604e 处理器 | 350MHz', { kg: 14.1 });

/* ──────────────── Network Server（macdb.cn/network-server）──────────────── */
desk('apple-network-server-500', 'Network Server 500', '1996-02-26', 'Network Server', {
  w: 419, h: 152, d: 330, kg: 11.3, colors: ['米白色'], arch: 'PowerPC',
  cpu: 'PowerPC 604 处理器 | 132MHz', cores: 1, stoT: 'SCSI 硬盘 + 软盘 + CD-ROM',
  os: 'AIX for Apple Network Server',
  ports: ['以太网（AAUI）', 'SCSI', '串口 ×2'],
});
desk('apple-network-server-700', 'Network Server 700', '1996-02-26', 'Network Server', {
  w: 419, h: 445, d: 330, kg: 24.5, colors: ['米白色'], arch: 'PowerPC',
  cpu: 'PowerPC 604 处理器 | 150MHz', cores: 1, stoT: 'SCSI 硬盘 + 软盘 + CD-ROM',
  os: 'AIX for Apple Network Server',
  ports: ['以太网（AAUI）', 'SCSI', '串口 ×2'],
});

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
