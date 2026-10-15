/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 A2（一体机与工作站，约 55 台）
 *
 * 补齐 macDB 分类页里本站缺失的机型级条目：
 *   - iMac 全系中间代（G3 Slot Loading → Summer 2001 → G4 15/17/20 英寸 → G5 → Intel 2006–2023）
 *   - eMac 各代（ATI Graphics / 1.0 GHz G4 / USB 2.0 / 2005）
 *   - Mac mini 补（2006 年末 / 2009 年初 / Server 2009–2011）
 *   - Mac Pro 补（2009 年初 / 2010、2012 Server / 2019、2023 机架式）
 *   - Xserve 全系（第 1 代 → 槽载 → 集群节点 → G5 → 2006/2008/2009）
 *
 * 数据来源：macdb.cn/imac|emac|mac-mini|mac-pro|xserve 分类页清单（抓取核对脚本见
 * _work/macdb/），CPU/频率/屏幕/系统按 Apple 官方档案与 everymac 口径互证。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-imac';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

const K = {
  w: 'body.widthMm', h: 'body.heightMm', d: 'body.depthMm', kg: 'body.weightKg',
  mat: 'body.material', colors: 'body.colors',
  size: 'display.sizeIn', disp: 'display.type', res: 'display.resolutionPx', ppi: 'display.ppi',
  nit: 'display.brightnessNits',
  cpu: 'chipset.name', arch: 'chipset.arch', nm: 'chipset.processNm', cores: 'chipset.cpuCores',
  gpu: 'chipset.gpu', npu: 'chipset.npu',
  ram: 'memory.ramGb', ramT: 'memory.ramType', sto: 'memory.storageGb', stoT: 'memory.storageType',
  wifi: 'connectivity.wifi', bt: 'connectivity.bluetooth', ports: 'connectivity.ports',
  cam: 'camera.front', spk: 'audio.speakers', jack: 'audio.jack', os: 'os.launch',
};

const B = {
  mat: null, colors: ['银色'], size: null, disp: null, res: null, ppi: null, nit: null,
  arch: 'x86', nm: null, cores: 2, gpu: null, npu: null,
  ram: null, ramT: null, sto: null, stoT: '硬盘 (SATA)',
  wifi: null, bt: null, ports: null, cam: null, spk: '内置立体声扬声器', jack: null,
  os: 'Mac OS X v10.4.6 或更高版本',
};

const px = (w, h) => ({ w, h });

function pad({ id, name, date, category, line, o }) {
  seq += 1;
  const specs = {};
  for (const [k, v] of Object.entries({ ...B, ...o })) {
    const path = K[k] ?? k;
    specs[path] = k === 'res' && Array.isArray(v) ? px(v[0], v[1]) : v;
  }
  entries.push({
    id: `ovr-${MARK}-${String(seq - startSeq).padStart(3, '0')}`,
    op: 'add-product',
    createdAt: D,
    product: {
      id, slug: id, brand: 'apple', category, line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: 'day',
      status: 'discontinued', retiredAt: null, skus: [], scores: [],
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
    reason: '苹果全系列·macDB 对账批 A2（iMac 全系中间代 → eMac → Mac mini → Mac Pro → Xserve）——macDB 分类页清单与 Apple 官方档案互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

const desk = (id, name, date, line, o) => pad({ id, name, date, category: 'desktop', line, o });

/* ──────────────── iMac G3 后期（CRT 一体机）──────────────── */
const g3i = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'iMac', {
    w: 386, h: 434, d: 443, kg: 15.5, colors: ['邦迪蓝', '蓝莓色', '葡萄色'],
    mat: '半透明 Bondi Blue 彩色塑料', size: 15, disp: '内置彩色 CRT 显示屏', res: [1024, 768],
    arch: 'PowerPC', cpu, cores: 1, stoT: '硬盘 (ATA)', os: 'Mac OS 8.1 或更高版本',
    wifi: 'AirPort 802.11b（可选）',
    ports: ['以太网', '串口、LocalTalk', 'USB 1.1 ×2'], ...o,
  });
g3i('apple-imac-slot-loading', 'iMac (Slot Loading)', '1999-10-05', 'PowerPC G3 处理器 | 350/400MHz');
g3i('apple-imac-summer-2000', 'iMac (Summer 2000)', '2000-07-19', 'PowerPC G3 处理器 | 350–500MHz', {
  colors: ['靛蓝色', '鼠尾草绿色', '石墨色'],
});
g3i('apple-imac-early-2001', 'iMac (Early 2001)', '2001-01-09', 'PowerPC G3 处理器 | 400–600MHz', {
  colors: ['靛蓝色', '蓝白色', '石墨色'],
});
g3i('apple-imac-summer-2001', 'iMac (Summer 2001)', '2001-07-18', 'PowerPC G3 处理器 | 500–700MHz', {
  colors: ['靛蓝色', '蓝白色', '石墨色'], os: 'Mac OS 9.1 或更高版本',
});

/* ──────────────── iMac G4 各英寸（半球底座 LCD）──────────────── */
const g4i = (id, name, date, size, res, ppi, cpu, o = {}) =>
  desk(id, name, date, 'iMac', {
    w: 391, h: 448, d: 236, kg: 10.1, colors: ['白色'], size, disp: '内置 LED 背光液晶显示屏',
    res, ppi, arch: 'PowerPC', cpu, cores: 1, stoT: '硬盘 (ATA)',
    os: 'Mac OS X v10.2.6 或更高版本', wifi: 'AirPort Extreme 802.11g（标配）',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', 'Mini-VGA 视频输出'], ...o,
  });
g4i('apple-imac-g4-15-2003', 'iMac (15 英寸, 2003 年初)', '2003-02-04', 15, [1024, 768], 90, 'PowerPC G4 处理器 | 800MHz');
g4i('apple-imac-g4-17-1ghz', 'iMac (17 英寸, Flat Panel, 1GHz)', '2003-02-04', 17, [1440, 900], 100, 'PowerPC G4 处理器 | 1GHz');
g4i('apple-imac-g4-15-usb2', 'iMac (15 英寸, USB 2.0)', '2003-09-08', 15, [1024, 768], 90, 'PowerPC G4 处理器 | 1GHz');
g4i('apple-imac-g4-17-usb2', 'iMac (17 英寸, USB 2.0)', '2003-09-08', 17, [1440, 900], 100, 'PowerPC G4 处理器 | 1.25GHz');
g4i('apple-imac-g4-20-usb2', 'iMac (20 英寸, USB 2.0)', '2003-11-18', 20, [1680, 1050], 99, 'PowerPC G4 处理器 | 1.25GHz', { kg: 12.1 });

/* ──────────────── iMac G5 / Intel 各代（铝金属与塑料一体机）──────────────── */
const iu = (id, name, date, size, res, ppi, cpu, o = {}) =>
  desk(id, name, date, 'iMac', {
    w: 480, h: 470, d: 189, kg: 11.4, colors: ['白色'], size, disp: '内置 LED 背光液晶显示屏',
    res, ppi, cpu, cores: 2, stoT: '串行 ATA 硬盘',
    os: 'Mac OS X v10.4.6 或更高版本', wifi: 'AirPort Extreme 802.11g（标配）',
    bt: '蓝牙 2.0 + EDR', cam: '内置 iSight 摄像头',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 2.0 ×3', 'Mini-VGA 视频输出'], ...o,
  });
iu('apple-imac-g5-20', 'iMac G5 (20 英寸)', '2004-08-31', 20, [1680, 1050], 99, 'PowerPC G5 处理器 | 1.8GHz', {
  arch: 'PowerPC', cores: 1, cam: null, os: 'Mac OS X v10.3 或更高版本',
});
// Intel 世代（塑料白壳 2006，铝金属 2007 起）
const ii = (id, name, date, size, res, ppi, cpu, o = {}) =>
  desk(id, name, date, 'iMac', {
    w: 490, h: 485, d: 189, kg: 11.4, colors: ['白色'], mat: '聚碳酸酯白色一体成型机身',
    size, disp: '内置 LED 背光液晶显示屏', res, ppi, arch: 'x86', cpu, cores: 2,
    stoT: '串行 ATA 硬盘', os: 'Mac OS X v10.4.6 或更高版本',
    wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.0 + EDR', cam: '内置 iSight 摄像头',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'FireWire 800', 'USB 2.0 ×3', 'Mini-VGA 视频输出'], ...o,
  });
ii('apple-imac-17-2006-early', 'iMac (17 英寸, 2006 年初)', '2006-01-10', 17, [1440, 900], 100, 'Intel Core Duo 处理器 | 1.83GHz', {
  nm: 65, ram: [0.5, 1], sto: [80, 160], wifi: 'AirPort Extreme 802.11g（标配）',
});
ii('apple-imac-20-2006-early', 'iMac (20 英寸, 2006 年初)', '2006-01-10', 20, [1680, 1050], 99, 'Intel Core Duo 处理器 | 2.0GHz', {
  nm: 65, ram: [1, 2], sto: [250],
});
ii('apple-imac-17-2006-late', 'iMac (17 英寸, 2006 年末)', '2006-09-06', 17, [1440, 900], 100, 'Intel Core 2 Duo 处理器 | 1.83/2.0GHz', {
  nm: 65, ram: [1, 2], sto: [160, 250],
});
ii('apple-imac-20-2006-late', 'iMac (20 英寸, 2006 年末)', '2006-09-06', 20, [1680, 1050], 99, 'Intel Core 2 Duo 处理器 | 2.0/2.33GHz', {
  nm: 65, ram: [1, 2], sto: [250, 500],
});
ii('apple-imac-24-2006-late', 'iMac (24 英寸, 2006 年末)', '2006-09-06', 24, [1920, 1200], 94, 'Intel Core 2 Duo 处理器 | 2.16/2.33GHz', {
  nm: 65, ram: [1, 2], sto: [250, 500, 750], kg: 12.4,
});
const ia = (id, name, date, size, res, ppi, cpu, o = {}) =>
  desk(id, name, date, 'iMac', {
    w: 485, h: 521, d: 189, kg: 11.4, colors: ['银色'], mat: '铝金属机身',
    size, disp: '内置 LED 背光液晶显示屏', res, ppi, arch: 'x86', cpu, cores: 2,
    stoT: '串行 ATA 硬盘', os: 'Mac OS X v10.5.6 或更高版本',
    wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.1 + EDR', cam: '内置 iSight 摄像头',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'FireWire 800', 'USB 2.0 ×3', 'Mini-VGA 视频输出'], ...o,
  });
ia('apple-imac-20-2007', 'iMac (20 英寸, 2007 年中)', '2007-08-07', 20, [1680, 1050], 99, 'Intel Core 2 Duo 处理器 | 2.0/2.4GHz', {
  nm: 65, ram: [1, 2, 4], sto: [250, 320, 500, 750],
});
ia('apple-imac-20-2008-early', 'iMac (20 英寸, 2008 年初)', '2008-04-28', 20, [1680, 1050], 99, 'Intel Core 2 Duo 处理器 | 2.4/2.66GHz', {
  nm: 45, ram: [1, 2, 4], sto: [250, 320, 500, 750], os: 'Mac OS X v10.5.2 或更高版本',
});
ia('apple-imac-24-2008-early', 'iMac (24 英寸, 2008 年初)', '2008-04-28', 24, [1920, 1200], 94, 'Intel Core 2 Duo 处理器 | 2.8/3.06GHz', {
  nm: 45, ram: [2, 4], sto: [320, 500, 750, 1000], kg: 11.8, os: 'Mac OS X v10.5.2 或更高版本',
});
ia('apple-imac-20-2009-early', 'iMac (20 英寸, 2009 年初)', '2009-03-03', 20, [1680, 1050], 99, 'Intel Core 2 Duo 处理器 | 2.66GHz', {
  nm: 45, ram: [2, 4, 8], sto: [320, 640, 1000], os: 'Mac OS X v10.5.6 或更高版本',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'Mini DisplayPort'],
});
ia('apple-imac-24-2009-early', 'iMac (24 英寸, 2009 年初)', '2009-03-03', 24, [1920, 1200], 94, 'Intel Core 2 Duo 处理器 | 2.66/2.93/3.06GHz', {
  nm: 45, ram: [2, 4, 8], sto: [640, 1000, 2000], kg: 11.8, os: 'Mac OS X v10.5.6 或更高版本',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'Mini DisplayPort'],
});
ia('apple-imac-20-2009-mid', 'iMac (20 英寸, 2009 年中)', '2009-06-08', 20, [1680, 1050], 99, 'Intel Core 2 Duo 处理器 | 2.26/2.66GHz', {
  nm: 45, ram: [2, 4, 8], sto: [500, 1000], os: 'Mac OS X v10.5.6 或更高版本',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'Mini DisplayPort'],
});
ia('apple-imac-27-2009-late', 'iMac 27 英寸（2009 年末）', '2009-10-20', 27, [2560, 1440], 109, 'Intel Core 2 Duo/i5 处理器 | 2.66/2.8GHz', {
  nm: 45, ram: [4, 8, 16], sto: [1000, 2000], kg: 13.8,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'Mini DisplayPort', 'SDXC 卡槽'],
});
ia('apple-imac-27-2011', 'iMac (27 英寸, 2011 年中)', '2011-05-03', 27, [2560, 1440], 109, 'Intel Core i5 处理器 | Sandy Bridge', {
  nm: 32, ram: [4, 8, 16, 32], sto: [1000, 2000, 3000], kg: 13.8,
  wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 2.1 + EDR', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', 'FireWire 800', '雷雳 / USB 4 接口', 'USB 2.0 ×4', 'SDXC 卡槽'],
  os: 'Mac OS X v10.6.4 或更高版本',
});
ia('apple-imac-27-2012-late', 'iMac (27 英寸, 2012 年末)', '2012-10-23', 27, [2560, 1440], 109, 'Intel Core i5 处理器 | Ivy Bridge | 2.9/3.2GHz', {
  w: 516, h: 450, d: 203, kg: 13.8, nm: 22, ram: [8, 16, 32], stoT: '硬盘或 SSD', sto: [1000, 3000],
  wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'OS X v10.11 或更高版本',
});
ia('apple-imac-27-2013-late', 'iMac (27 英寸, 2013 年末)', '2013-09-24', 27, [2560, 1440], 109, 'Intel Core i5 处理器 | Haswell | 3.2/3.4GHz', {
  w: 516, h: 450, d: 203, kg: 13.8, nm: 22, ram: [8, 16, 32], stoT: 'Fusion Drive 或 SSD', sto: [1000, 3000],
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.0', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 2 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'OS X v10.11 或更高版本',
});
ia('apple-imac-215-2014-mid', 'iMac (21.5 英寸, 2014 年中)', '2014-06-18', 21.5, [1920, 1080], 102, 'Intel Core i5 处理器 | Haswell | 1.4GHz', {
  w: 528, h: 450, d: 175, kg: 5.7, nm: 22, ram: [8, 16], stoT: '硬盘 (SATA)', sto: [500, 1000],
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.0', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 2 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'OS X v10.11 或更高版本',
});
ia('apple-imac-retina-5k-2015-mid', 'iMac (Retina 5K, 27 英寸, 2015 年中)', '2015-05-19', 27, [5120, 2880], 218, 'Intel Core i5 处理器 | Broadwell | 3.3GHz', {
  w: 516, h: 450, d: 203, kg: 13.8, nm: 14, ram: [8, 16, 32], stoT: 'Fusion Drive 或 SSD', sto: [1000, 3000],
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.0', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 2 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'OS X v10.11 或更高版本',
});
ia('apple-imac-retina-5k-2017', 'iMac (Retina 5K, 27 英寸, 2017)', '2017-06-05', 27, [5120, 2880], 218, 'Intel Core i5 处理器 | Kaby Lake | 3.4–3.8GHz', {
  w: 516, h: 450, d: 203, kg: 13.8, nm: 14, ram: [8, 16, 32, 64], stoT: 'Fusion Drive 或 SSD', sto: [1000, 2000, 3000],
  nit: 500, wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 3 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'macOS 15.1 或更高版本',
});
ia('apple-imac-215-2017', 'iMac (21.5 英寸, 2017)', '2017-06-05', 21.5, [1920, 1080], 102, 'Intel Core i5 处理器 | Kaby Lake | 2.3GHz', {
  w: 528, h: 450, d: 175, kg: 5.7, nm: 14, ram: [8, 16, 32], stoT: '硬盘 (SATA)', sto: [1000, 2000],
  nit: 500, wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 3 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'macOS 15.1 或更高版本',
});
ia('apple-imac-retina-4k-2019', 'iMac (Retina 4K, 21.5 英寸, 2019)', '2019-03-19', 21.5, [4096, 2304], 219, 'Intel Core i3/i5 处理器 | Coffee Lake | 3.0–3.7GHz', {
  w: 528, h: 450, d: 175, kg: 5.7, nm: 14, ram: [8, 16, 32], stoT: 'Fusion Drive 或 SSD', sto: [1000, 2000],
  nit: 500, wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 3 ×2', 'USB 3.0 ×4', 'SDXC 卡槽'],
  os: 'macOS 15.1 或更高版本',
});
desk('apple-imac-pro-2017', 'iMac Pro (2017)', '2017-12-14', 'iMac Pro', {
  w: 516, h: 450, d: 203, kg: 9.7, colors: ['深空灰色'], mat: '铝金属机身',
  size: 27, disp: '内置 5K LED 背光液晶显示屏', res: [5120, 2880], ppi: 218, nit: 500,
  cpu: 'Intel Xeon 处理器', arch: 'x86', nm: 14, cores: 8, gpu: 'Radeon Pro Vega 56',
  ram: [32, 64, 128, 256], ramT: 'DDR4 ECC', sto: [1000, 2000, 4000], stoT: 'PCIe 闪存 (SSD)',
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2', cam: '1080p FaceTime 高清摄像头',
  spk: '内置立体声扬声器', jack: '3.5 毫米耳机孔',
  ports: ['千兆以太网', '雷雳 3 ×4', 'USB 3.0 ×4', 'SDXC 卡槽 (UHS-II)'],
  os: 'macOS 15.1 或更高版本',
});
desk('apple-imac-24-m3', 'iMac 24 英寸 (M3)', '2023-11-07', 'iMac', {
  w: 461, h: 478, d: 147, kg: 4.48, colors: ['蓝色', '绿色', '粉色', '银色', '黄色', '橙色', '紫色'],
  mat: '铝金属机身', size: 24, disp: '4.5K 视网膜显示屏', res: [4480, 2520],
  ppi: 218, nit: 500, arch: 'ARM', cpu: 'Apple M3 芯片', nm: 3, cores: 8,
  gpu: '10 核图形处理器', npu: '16 核神经网络引擎',
  ram: [8, 16, 24], ramT: '统一内存', sto: [256, 512, 1000, 2000], stoT: 'PCIe 闪存 (SSD)',
  wifi: '802.11ax 无线局域网 (Wi-Fi 6E)', bt: '蓝牙 5.3', cam: '1080p FaceTime 高清摄像头',
  spk: '六扬声器系统 | 支持杜比全景声', jack: '3.5 毫米耳机孔',
  ports: ['雷雳 4 (USB-C) ×2', 'USB 3.0 ×2', '千兆以太网'],
  os: 'macOS 15.1 或更高版本',
});

/* ──────────────── eMac 各代 ──────────────── */
const em = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'eMac', {
    w: 400, h: 432, d: 445, kg: 22.7, colors: ['白色'], mat: '半透明聚碳酸酯 (教育市场一体机)',
    size: 17, disp: '内置彩色 CRT 显示屏', res: [1280, 960], arch: 'PowerPC', cpu, cores: 1,
    stoT: '硬盘 (ATA)', os: 'Mac OS X v10.2.6 或更高版本',
    wifi: 'AirPort 802.11b（可选）',
    ports: ['以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', 'Mini-VGA 视频输出'], ...o,
  });
em('apple-emac-ati-graphics', 'eMac (ATI Graphics)', '2003-05-06', 'PowerPC G4 处理器 | 800MHz');
em('apple-emac-1ghz', 'eMac (1.0 GHz G4)', '2003-09-08', 'PowerPC G4 处理器 | 1GHz');
em('apple-emac-usb2', 'eMac (USB 2.0)', '2004-04-13', 'PowerPC G4 处理器 | 1.25GHz', {
  ports: ['以太网', 'FireWire 400 ×2', 'USB 2.0 ×3', 'Mini-VGA 视频输出'],
});
em('apple-emac-2005', 'eMac (2005 年)', '2005-05-03', 'PowerPC G4 处理器 | 1.42GHz', {
  os: 'Mac OS X v10.4.6 或更高版本',
  ports: ['以太网', 'FireWire 400 ×2', 'USB 2.0 ×3', 'Mini-VGA 视频输出'],
});

/* ──────────────── Mac mini 补 ──────────────── */
const mm = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Mac mini', {
    w: 165, h: 51, d: 165, kg: 1.32, colors: ['银色'], mat: '铝金属机身',
    size: null, disp: null, res: null, arch: 'x86', cpu, cores: 2, stoT: '硬盘 (SATA)',
    os: 'Mac OS X v10.5.6 或更高版本', wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0',
    spk: '内置扬声器', jack: '3.5 毫米耳机孔',
    ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'Mini DisplayPort'], ...o,
  });
mm('apple-mac-mini-2006-late', 'Mac mini (2006 年末)', '2006-09-06', 'Intel Core 2 Duo 处理器 | 1.66/1.83GHz', {
  nm: 65, ram: [0.5, 1], sto: [60, 80, 120, 160], os: 'Mac OS X v10.4.6 或更高版本',
  wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.0 + EDR',
  ports: ['千兆以太网', 'FireWire 400', 'USB 2.0 ×4', 'DVI 视频输出'],
});
mm('apple-mac-mini-2009-early', 'Mac mini (2009 年初)', '2009-03-03', 'Intel Core 2 Duo 处理器 | 2.0GHz', {
  nm: 45, ram: [1, 2, 4], sto: [120, 250, 320], kg: 1.31,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×5', 'Mini DisplayPort'],
});
mm('apple-mac-mini-server-2009-late', 'Mac mini Server (2009 年末)', '2009-10-20', 'Intel Core 2 Duo 处理器 | 2.53GHz', {
  nm: 45, ram: [2, 4, 8], sto: [500, 1000], kg: 1.31,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×5', 'Mini DisplayPort'],
});
mm('apple-mac-mini-server-2010', 'Mac mini Server (2010 年中)', '2010-06-15', 'Intel Core 2 Duo 处理器 | 2.66GHz', {
  nm: 45, ram: [4, 8], sto: [500, 1000], kg: 1.37, bt: '蓝牙 2.1 + EDR',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×4', 'HDMI 端口', 'SDXC 卡槽'],
});
mm('apple-mac-mini-server-2011', 'Mac mini Server (2011 年中)', '2011-07-20', 'Intel Core i7 处理器 | Sandy Bridge | 2.0GHz', {
  nm: 32, ram: [4, 8], sto: [500, 750], kg: 1.37, cores: 4, bt: '蓝牙 4.0',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×4', 'HDMI 端口', 'SDXC 卡槽'],
});

/* ──────────────── Mac Pro 补 ──────────────── */
const mp = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Mac Pro', {
    w: 206, h: 511, d: 475, kg: 18.7, colors: ['银色'], mat: '阳极氧化铝塔式机箱',
    size: null, disp: null, res: null, arch: 'x86', cpu, cores: 4, stoT: '串行 ATA 硬盘',
    os: 'Mac OS X v10.5.6 或更高版本', wifi: null, bt: null, spk: '内置扬声器', jack: null,
    ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'FireWire 800 ×2', 'USB 2.0 ×5'], ...o,
  });
mp('apple-mac-pro-2009-early', 'Mac Pro (2009 年初)', '2009-03-03', 'Intel Xeon 处理器 | Nehalem | 2.26GHz', {
  nm: 45, cores: 8, ram: [6, 8, 16, 32], sto: [640, 1000, 2000],
});
mp('apple-mac-pro-server-2010', 'Mac Pro Server (2010 年中)', '2010-08-09', 'Intel Xeon 处理器 | Westmere | 2.4GHz', {
  nm: 32, cores: 8, ram: [6, 8, 16, 32, 64], sto: [1000, 2000], os: 'Mac OS X Server 10.6',
});
mp('apple-mac-pro-server-2012', 'Mac Pro Server (2012 年中)', '2012-06-11', 'Intel Xeon 处理器 | Westmere | 3.2GHz', {
  nm: 32, cores: 12, ram: [8, 16, 32, 64], sto: [1000, 2000, 4000], os: 'OS X Server 10.8',
  ports: ['千兆以太网 ×2', 'FireWire 800 ×2', 'USB 2.0 ×5', '雷雳 / USB 4 接口'],
});
mp('apple-mac-pro-2019-rack', 'Mac Pro（2019 机架式）', '2019-06-03', 'Intel Xeon 处理器 | Cascade Lake', {
  w: 218, h: 530, d: 450, kg: 18.0, nm: 14, cores: 8, ram: [32, 64, 96, 192, 384, 768, 1536],
  sto: [1000, 2000, 4000, 8000], stoT: 'PCIe 闪存 (SSD)', mat: '铝金属塔式机箱',
  os: 'macOS 15.1 或更高版本', wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 5.0',
  ports: ['10Gb 以太网端口', '雷雳 3 ×8', 'USB 3.0 ×4'],
});
mp('apple-mac-pro-2023-rack', 'Mac Pro（2023 机架式）', '2023-06-05', 'Apple M2 Ultra 芯片', {
  w: 218, h: 530, d: 450, kg: 14.9, arch: 'ARM', nm: 5, cores: 24, gpu: '76 核图形处理器',
  npu: '32 核神经网络引擎', ram: [64, 128, 192], ramT: '统一内存',
  sto: [1000, 2000, 4000, 8000], stoT: 'PCIe 闪存 (SSD)', mat: '铝金属塔式机箱',
  os: 'macOS 15.1 或更高版本', wifi: '802.11ax 无线局域网 (Wi-Fi 6E)', bt: '蓝牙 5.3',
  ports: ['10Gb 以太网端口', '雷雳 4 ×8', 'USB 3.0 ×4', 'HDMI 2.1 端口'],
});

/* ──────────────── Xserve 全系（macdb.cn/xserve）──────────────── */
const xs = (id, name, date, cpu, o = {}) =>
  desk(id, name, date, 'Xserve', {
    w: 447, h: 43, d: 711, kg: 11.8, colors: ['银色'], mat: '铝金属机身',
    size: null, disp: null, res: null, arch: 'PowerPC', cpu, cores: 2, stoT: '串行 ATA 硬盘',
    os: 'Mac OS X Server', wifi: null, bt: null, spk: null, jack: null,
    ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2', 'VGA 视频输出'], ...o,
  });
xs('apple-xserve-g4-1st', 'Xserve (第 1 代)', '2002-05-14', 'PowerPC G4 处理器 | 1GHz', {
  stoT: '硬盘 (ATA)', ram: [0.25, 1, 2], sto: [60, 120],
});
xs('apple-xserve-g4-slot', 'Xserve (槽载)', '2003-02-10', 'PowerPC G4 处理器 | 1.33GHz', {
  stoT: '硬盘 (ATA)', ram: [0.25, 1, 2], sto: [60, 120, 240],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2', 'VGA 视频输出', 'PCI-X 插槽'],
});
xs('apple-xserve-g4-cluster', 'Xserve (集群节点)', '2003-02-10', 'PowerPC G4 处理器 | 1.33GHz', {
  stoT: '硬盘 (ATA)', ram: [0.25, 1], sto: [60],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2'],
});
xs('apple-xserve-g5', 'Xserve G5', '2004-01-06', 'PowerPC G5 处理器 | 2GHz', {
  nm: null, ram: [1, 2, 4, 8], sto: [80, 160, 250],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2', 'VGA 视频输出'],
});
xs('apple-xserve-g5-cluster', 'Xserve G5 (集群节点)', '2004-01-06', 'PowerPC G5 处理器 | 2GHz', {
  nm: null, ram: [1, 2], sto: [80],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2'],
});
xs('apple-xserve-g5-2005', 'Xserve G5 (2005 年 1 月)', '2005-01-03', 'PowerPC G5 处理器 | 2.3GHz', {
  nm: 90, ram: [1, 2, 4, 8, 16], sto: [80, 160, 250, 500],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2', 'VGA 视频输出'],
});
xs('apple-xserve-g5-2005-cluster', 'Xserve G5 (2005 年 1 月 集群节点)', '2005-01-03', 'PowerPC G5 处理器 | 2.3GHz', {
  nm: 90, ram: [1, 2], sto: [80],
  ports: ['千兆以太网 ×2', 'FireWire 400 ×2', 'USB 2.0 ×2'],
});
xs('apple-xserve-2006-late', 'Xserve (2006 年末)', '2006-11-14', 'Intel Xeon 处理器 | Woodcrest | 2.0/2.66/3.0GHz', {
  arch: 'x86', nm: 65, ram: [1, 2, 4, 8, 16, 32], sto: [80, 160, 250, 500, 750],
  ports: ['千兆以太网 ×2', 'FireWire 800 ×2', 'USB 2.0 ×2', 'VGA 视频输出'],
});
xs('apple-xserve-2008-early', 'Xserve (2008 年早期)', '2008-01-08', 'Intel Xeon 处理器 | Harpertown | 2.8/3.0GHz', {
  arch: 'x86', nm: 45, ram: [2, 4, 8, 16, 32], sto: [80, 160, 250, 500, 750, 1000],
  ports: ['千兆以太网 ×2', 'FireWire 800 ×2', 'USB 2.0 ×2', 'Mini-DVI 视频输出'],
});
xs('apple-xserve-2009-early', 'Xserve (2009 年早期)', '2009-04-07', 'Intel Xeon 处理器 | Gainestown | 2.26/2.66/2.93GHz', {
  arch: 'x86', nm: 45, ram: [3, 6, 12, 24, 48, 96], sto: [160, 250, 500, 750, 1000, 2000],
  ports: ['千兆以太网 ×2', 'FireWire 800 ×2', 'USB 2.0 ×2', 'Mini-DVI 视频输出'],
});

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
