/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 B2（MacBook / Air / Pro 各代，约 50 台）
 *
 * 补齐 macdb.cn/macbook（14）/macbook-air（28）/macbook-pro（65）里本站缺失的机型：
 *   - MacBook 13 英寸 Intel 各代（2006 年末 → 2010 年中，含铝合金一体成型）
 *   - MacBook Air 11 英寸全系与 13 英寸各年款（2008 年末 → 2020 Intel）
 *   - MacBook Pro 15/17 英寸全代（2006 → 2019）、13 英寸各代、13 英寸 M2、14/16 英寸 2023–2026
 *
 * 数据来源：macdb.cn 分类页清单（抓取核对脚本见 _work/macdb/），CPU/屏幕/电池/接口按
 * Apple 官方规格档案互证。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-macbook';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

const K = {
  t: 'body.thicknessMm', kg: 'body.weightKg', mat: 'body.material', colors: 'body.colors',
  size: 'display.sizeIn', disp: 'display.type', res: 'display.resolutionPx', ppi: 'display.ppi',
  nit: 'display.brightnessTypicalNits', gamut: 'display.colorGamut',
  cpu: 'chipset.name', arch: 'chipset.arch', nm: 'chipset.processNm', cores: 'chipset.cpuCores',
  gpu: 'chipset.gpu', npu: 'chipset.npu',
  ram: 'memory.ramGb', ramT: 'memory.ramType', sto: 'memory.storageGb', stoT: 'memory.storageType',
  batt: 'battery.capacityWh', hrs: 'battery.vendorClaimedHours',
  cam: 'camera.front', spk: 'audio.speakers', jack: 'audio.jack',
  wifi: 'connectivity.wifi', bt: 'connectivity.bluetooth', ports: 'connectivity.ports',
  kb: 'features.keyboard', os: 'os.launch',
};

const B = {
  arch: 'x86', nm: 65, cores: 2, gpu: null, npu: null, ramT: null, ppi: null,
  nit: null, gamut: null, cam: null, hrs: 10, jack: '3.5 毫米耳机孔',
  spk: '内置立体声扬声器', kb: '全尺寸键盘', colors: ['银色'], mat: null,
  stoT: '串行 ATA 硬盘', wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.0 + EDR',
};

const px = (w, h) => ({ w, h });

function pad(id, name, date, line, o) {
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
      id, slug: id, brand: 'apple', category: 'laptop', line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: 'day',
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
    reason: '苹果全系列·macDB 对账批 B2（MacBook 13 英寸 Intel 各代 → MacBook Air 11/13 英寸各年款 → MacBook Pro 15/17/13/14/16 英寸各代）——macDB 分类页清单与 Apple 官方规格档案互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

/* ──────────────── MacBook 13 英寸 Intel 各代 ──────────────── */
const mb = (id, name, date, cpu, o = {}) =>
  pad(id, name, date, 'MacBook', {
    t: 27.5, kg: 2.27, mat: '聚碳酸酯白色一体成型机身', colors: ['白色'],
    size: 13.3, disp: '内置 LED 背光液晶显示屏', res: [1280, 800], ppi: 113,
    cpu, sto: [80, 120, 160, 250], cam: '内置 iSight 摄像头', batt: 55, hrs: 10,
    ports: ['千兆以太网', 'FireWire 400', 'USB 2.0 ×2', 'Mini-VGA 视频输出'],
    os: 'Mac OS X v10.5.6 或更高版本', ...o,
  });
mb('apple-macbook-13-2006-late', 'MacBook (13 英寸, 2006 年末)', '2006-11-08', 'Intel Core 2 Duo 处理器 | 1.83/2.0GHz', {
  ram: [0.5, 1, 2], os: 'Mac OS X v10.4.6 或更高版本',
});
mb('apple-macbook-13-2007-mid', 'MacBook (13 英寸, 2007 年中)', '2007-05-15', 'Intel Core 2 Duo 处理器 | 2.0/2.16GHz', {
  ram: [1, 2, 4], sto: [80, 120, 160],
});
mb('apple-macbook-13-2007-late', 'MacBook (13 英寸, 2007 年末)', '2007-11-01', 'Intel Core 2 Duo 处理器 | 2.0/2.2GHz', {
  ram: [1, 2, 4], sto: [80, 120, 160, 250],
});
mb('apple-macbook-13-2008-early', 'MacBook (13 英寸, 2008 年初)', '2008-02-26', 'Intel Core 2 Duo 处理器 | 2.1/2.4GHz', {
  nm: 45, ram: [1, 2, 4], sto: [120, 160, 250],
});
mb('apple-macbook-13-2008-late', 'MacBook (13 英寸, 2008 年末)', '2008-10-14', 'Intel Core 2 Duo 处理器 | 2.0/2.4GHz', {
  nm: 45, ram: [1, 2, 4], sto: [120, 160, 250, 320],
});
mb('apple-macbook-13-2008-late-alu', 'MacBook (13 英寸, 铝合金, 2008 年末)', '2008-10-14', 'Intel Core 2 Duo 处理器 | 2.0/2.4GHz', {
  nm: 45, ram: [2, 4, 8], sto: [160, 250, 320], mat: '一体成型铝金属机身', colors: ['银色'],
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort'],
});
mb('apple-macbook-13-2009-early', 'MacBook (13 英寸, 2009 年初)', '2009-01-06', 'Intel Core 2 Duo 处理器 | 2.0/2.4GHz', {
  nm: 45, ram: [2, 4, 8], sto: [160, 250, 320], mat: '一体成型铝金属机身', colors: ['银色'],
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort'],
});
mb('apple-macbook-13-2009-mid', 'MacBook (13 英寸, 2009 年中)', '2009-06-08', 'Intel Core 2 Duo 处理器 | 2.0/2.26GHz', {
  nm: 45, ram: [2, 4, 8], sto: [160, 250, 320, 500], mat: '一体成型铝金属机身', colors: ['银色'],
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort'],
});
mb('apple-macbook-13-2010-mid', 'MacBook (13 英寸, 2010 年中)', '2010-05-18', 'Intel Core 2 Duo 处理器 | 2.4GHz', {
  nm: 45, ram: [2, 4, 8], sto: [250, 320, 500], mat: '一体成型铝金属机身', colors: ['银色'],
  batt: 63.5, hrs: 10, wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 2.1 + EDR',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort'],
  os: 'Mac OS X v10.6.4 或更高版本',
});

/* ──────────────── MacBook Air 11 / 13 英寸各年款 ──────────────── */
const ma = (id, name, date, size, res, ppi, kg, cpu, o = {}) =>
  pad(id, name, date, 'MacBook Air', {
    t: 17, kg, mat: '一体成型铝金属机身', colors: ['银色'],
    size, disp: '内置 LED 背光液晶显示屏', res, ppi, cpu, stoT: '闪存 (SSD)',
    cam: '内置 iSight 摄像头', hrs: 7, wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0',
    ports: ['USB 2.0 ×2', 'Mini DisplayPort', 'SDXC 卡槽'],
    os: 'OS X v10.11 或更高版本', ...o,
  });
ma('apple-macbook-air-11-2010-late', 'MacBook Air (11 英寸, 2010 年末)', '2010-10-20', 11.6, [1366, 768], 135, 1.06, 'Intel Core 2 Duo 处理器 | 1.4/1.6GHz', {
  nm: 45, ram: [2, 4], sto: [64, 128], batt: 35, os: 'Mac OS X v10.6.4 或更高版本',
});
ma('apple-macbook-air-13-2010-late', 'MacBook Air (13 英寸, 2010 年末)', '2010-10-20', 13.3, [1440, 900], 128, 1.32, 'Intel Core 2 Duo 处理器 | 1.86/2.13GHz', {
  nm: 45, ram: [2, 4], sto: [128, 256], batt: 50, os: 'Mac OS X v10.6.4 或更高版本',
});
ma('apple-macbook-air-11-2011-mid', 'MacBook Air (11 英寸, 2011 年中)', '2011-07-20', 11.6, [1366, 768], 135, 1.08, 'Intel Core i5/i7 处理器 | Sandy Bridge', {
  nm: 32, ram: [2, 4, 8], sto: [64, 128, 256], batt: 35, bt: '蓝牙 4.0', kb: '背光键盘',
  ports: ['雷雳 / USB 4 接口', 'USB 2.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-11-2012-mid', 'MacBook Air (11 英寸, 2012 年中)', '2012-06-11', 11.6, [1366, 768], 135, 1.08, 'Intel Core i5/i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [4, 8], sto: [64, 128, 256, 512], batt: 35, kb: '背光键盘',
  ports: ['雷雳 / USB 4 接口', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-11-2013-mid', 'MacBook Air (11 英寸, 2013 年中)', '2013-06-10', 11.6, [1366, 768], 135, 1.08, 'Intel Core i5/i7 处理器 | Haswell', {
  nm: 22, ram: [4, 8], sto: [128, 256, 512], batt: 35, hrs: 9, kb: '背光键盘',
  wifi: '802.11a/b/g/n/ac 无线局域网',
  ports: ['雷雳 / USB 4 接口', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-11-2014-early', 'MacBook Air (11 英寸, 2014 年初)', '2014-04-29', 11.6, [1366, 768], 135, 1.08, 'Intel Core i5/i7 处理器 | Haswell', {
  nm: 22, ram: [4, 8], sto: [128, 256, 512], batt: 35, hrs: 9, kb: '背光键盘',
  wifi: '802.11a/b/g/n/ac 无线局域网',
  ports: ['雷雳 / USB 4 接口', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-13-2014-early', 'MacBook Air (13 英寸, 2014 年初)', '2014-04-29', 13.3, [1440, 900], 128, 1.35, 'Intel Core i5/i7 处理器 | Haswell', {
  nm: 22, ram: [4, 8], sto: [128, 256, 512], batt: 54, hrs: 12, kb: '背光键盘',
  wifi: '802.11a/b/g/n/ac 无线局域网',
  ports: ['雷雳 / USB 4 接口', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-11-2015-early', 'MacBook Air (11 英寸, 2015 年初)', '2015-03-09', 11.6, [1366, 768], 135, 1.08, 'Intel Core i5/i7 处理器 | Broadwell', {
  nm: 14, ram: [4, 8], sto: [128, 256, 512], batt: 35, hrs: 9, kb: '背光键盘',
  wifi: '802.11a/b/g/n/ac 无线局域网',
  ports: ['雷雳 2', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
ma('apple-macbook-air-13-2017', 'MacBook Air (13.3 英寸, 2017)', '2017-06-05', 13.3, [1440, 900], 128, 1.35, 'Intel Core i5 处理器 | Broadwell | 1.8GHz', {
  nm: 14, ram: [8], sto: [128, 256], batt: 54, hrs: 12, kb: '背光键盘',
  wifi: '802.11a/b/g/n/ac 无线局域网',
  ports: ['雷雳 2', 'USB 3.0 ×2', 'SDXC 卡槽'],
  os: 'macOS 15.1 或更高版本',
});
ma('apple-macbook-air-13-2019', 'MacBook Air (13 英寸, 2019)', '2019-07-09', 13.3, [2560, 1600], 227, 1.25, 'Intel Core i5 处理器 | Amber Lake | 1.6GHz', {
  nm: 14, ram: [8, 16], sto: [128, 256, 512, 1000], batt: 50, hrs: 12,
  disp: '视网膜显示屏', nit: 400, kb: '蝶式背光键盘（含触控 ID）',
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2',
  ports: ['雷雳 3 ×2'], os: 'macOS 15.1 或更高版本',
});
ma('apple-macbook-air-13-2020-intel', 'MacBook Air (13 英寸, 2020)', '2020-03-18', 13.3, [2560, 1600], 227, 1.29, 'Intel Core i3/i5/i7 处理器 | Ice Lake', {
  nm: 10, ram: [8, 16], sto: [256, 512, 1000, 2000], batt: 50, hrs: 11,
  disp: '视网膜显示屏', nit: 400, kb: '背光妙控键盘（含触控 ID）',
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 5.0',
  ports: ['雷雳 3 ×2'], os: 'macOS 15.1 或更高版本',
});
pad('apple-macbook-air-late2008', 'MacBook Air (2008 年末/2009 年初)', '2008-10-14', 'MacBook Air', {
  t: 19.4, kg: 1.36, mat: '一体成型铝金属机身', colors: ['银色'],
  size: 13.3, disp: '内置 LED 背光液晶显示屏', res: [1280, 800], ppi: 113,
  cpu: 'Intel Core 2 Duo 处理器 | 1.6/1.86GHz', nm: 45, cores: 2, stoT: '串行 ATA 硬盘',
  sto: [120], ram: [2], cam: '内置 iSight 摄像头', batt: 37, hrs: 5,
  wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.1 + EDR',
  ports: ['USB 2.0', 'Mini-VGA 视频输出'],
  os: 'Mac OS X v10.5.6 或更高版本',
});

/* ──────────────── MacBook Pro 15 / 17 / 13 英寸各代 ──────────────── */
const mp = (id, name, date, size, res, kg, t, cpu, o = {}) =>
  pad(id, name, date, 'MacBook Pro', {
    t, kg, mat: '一体成型铝金属机身', colors: ['银色'],
    size, disp: '内置 LED 背光液晶显示屏', res, cpu, stoT: '串行 ATA 硬盘',
    cam: '内置 iSight 摄像头', batt: 60, hrs: 7,
    wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 2.0 + EDR',
    ports: ['千兆以太网', 'FireWire 400', 'FireWire 800', 'USB 2.0 ×2', 'VGA 视频输出'],
    os: 'Mac OS X v10.5.6 或更高版本', ...o,
  });
mp('apple-macbook-pro-17-2006', 'MacBook Pro (17 英寸, 2006)', '2006-04-24', 17, [1680, 1050], 3.1, 25.9, 'Intel Core Duo 处理器 | 1.83/2.16GHz', {
  ram: [1, 2], sto: [80, 100, 120], os: 'Mac OS X v10.4.6 或更高版本',
});
mp('apple-macbook-pro-15-c2d-2006', 'MacBook Pro (15 英寸, Core 2 Duo, 2006)', '2006-10-24', 15.4, [1440, 900], 2.54, 25.9, 'Intel Core 2 Duo 处理器 | 2.16/2.33GHz', {
  ram: [1, 2, 3], sto: [120, 160, 200], os: 'Mac OS X v10.4.6 或更高版本',
});
mp('apple-macbook-pro-17-c2d-2006', 'MacBook Pro (17 英寸, Core 2 Duo, 2006)', '2006-10-24', 17, [1680, 1050], 3.1, 25.9, 'Intel Core 2 Duo 处理器 | 2.33GHz', {
  ram: [1, 2, 3], sto: [160, 200, 250], os: 'Mac OS X v10.4.6 或更高版本',
});
mp('apple-macbook-pro-17-2007-mid', 'MacBook Pro (17 英寸, 2007 年中)', '2007-06-05', 17, [1680, 1050], 3.1, 25.9, 'Intel Core 2 Duo 处理器 | 2.4GHz', {
  ram: [2, 4], sto: [160, 250],
});
mp('apple-macbook-pro-15-2008-early', 'MacBook Pro (15 英寸, 2008 年初)', '2008-02-26', 15.4, [1440, 900], 2.54, 25.9, 'Intel Core 2 Duo 处理器 | 2.4/2.5GHz', {
  nm: 45, ram: [2, 4, 8], sto: [200, 250, 320],
});
mp('apple-macbook-pro-17-2008-early', 'MacBook Pro (17 英寸, 2008 年初)', '2008-02-26', 17, [1680, 1050], 3.1, 25.9, 'Intel Core 2 Duo 处理器 | 2.5GHz', {
  nm: 45, ram: [2, 4, 8], sto: [250, 320],
});
mp('apple-macbook-pro-15-2008-late', 'MacBook Pro (15 英寸, 2008 年末)', '2008-10-14', 15.4, [1440, 900], 2.49, 24.1, 'Intel Core 2 Duo 处理器 | 2.4/2.53/2.8GHz', {
  nm: 45, ram: [2, 4, 8], sto: [250, 320], mat: '一体成型铝金属机身 (Unibody 锥形)',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort'],
});
mp('apple-macbook-pro-17-2008-late', 'MacBook Pro (17 英寸, 2008 年末)', '2008-10-14', 17, [1920, 1200], 2.99, 24.1, 'Intel Core 2 Duo 处理器 | 2.66/2.93GHz', {
  nm: 45, ram: [4, 8], sto: [320], mat: '一体成型铝金属机身 (Unibody 锥形)',
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×3', 'Mini DisplayPort'],
});
mp('apple-macbook-pro-13-2009-mid', 'MacBook Pro (13 英寸, 2009 年中)', '2009-06-08', 13.3, [1280, 800], 2.04, 24.1, 'Intel Core 2 Duo 处理器 | 2.26/2.53GHz', {
  nm: 45, ram: [2, 4, 8], sto: [160, 250, 320, 500], batt: 60,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort', 'SD 卡槽'],
});
mp('apple-macbook-pro-17-2009-early', 'MacBook Pro (17 英寸, 2009 年初)', '2009-01-06', 17, [1920, 1200], 2.99, 24.1, 'Intel Core 2 Duo 处理器 | 2.66GHz', {
  nm: 45, ram: [4, 8], sto: [320], batt: 95, hrs: 8,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×3', 'Mini DisplayPort'],
});
mp('apple-macbook-pro-17-2009-mid', 'MacBook Pro (17 英寸, 2009 年中)', '2009-06-08', 17, [1920, 1200], 2.99, 24.1, 'Intel Core 2 Duo 处理器 | 2.8/3.06GHz', {
  nm: 45, ram: [4, 8], sto: [320, 500], batt: 95, hrs: 8,
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×3', 'Mini DisplayPort', 'SD 卡槽'],
});
mp('apple-macbook-pro-15-253-2009-mid', 'MacBook Pro (15 英寸, 2.53GHz, 2009 年中)', '2009-06-08', 15.4, [1440, 900], 2.49, 24.1, 'Intel Core 2 Duo 处理器 | 2.53GHz', {
  nm: 45, ram: [4, 8], sto: [250, 320, 500],
  ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort', 'SD 卡槽'],
});
const mp10 = (id, name, date, size, res, kg, cpu, o = {}) =>
  mp(id, name, date, size, res, kg, 24.1, cpu, {
    nm: 32, ram: [4, 8], stoT: '串行 ATA 硬盘', sto: [320, 500], bt: '蓝牙 2.1 + EDR',
    ports: ['千兆以太网', 'FireWire 800', 'USB 2.0 ×2', 'Mini DisplayPort', 'SD 卡槽'],
    os: 'Mac OS X v10.6.4 或更高版本', ...o,
  });
mp10('apple-macbook-pro-13-2010-mid', 'MacBook Pro (13 英寸, 2010 年中)', '2010-04-13', 13.3, [1280, 800], 2.04, 'Intel Core 2 Duo 处理器 | 2.4/2.66GHz');
mp10('apple-macbook-pro-15-2010-mid', 'MacBook Pro (15 英寸, 2010 年中)', '2010-04-13', 15.4, [1440, 900], 2.54, 'Intel Core i5/i7 处理器 | Arrandale', { batt: 77, hrs: 9 });
mp10('apple-macbook-pro-17-2010-mid', 'MacBook Pro (17 英寸, 2010 年中)', '2010-04-13', 17, [1920, 1200], 2.99, 'Intel Core i5/i7 处理器 | Arrandale', { batt: 95, hrs: 9 });
mp10('apple-macbook-pro-13-2011-early', 'MacBook Pro (13 英寸, 2011 年初)', '2011-02-24', 13.3, [1280, 800], 2.04, 'Intel Core i5/i7 处理器 | Sandy Bridge', {
  wifi: '802.11a/b/g/n 无线局域网', ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×2', 'SD 卡槽'],
});
mp10('apple-macbook-pro-17-2011-early', 'MacBook Pro (17 英寸, 2011 年初)', '2011-02-24', 17, [1920, 1200], 2.99, 'Intel Core i7 处理器 | Sandy Bridge', {
  batt: 95, hrs: 9, wifi: '802.11a/b/g/n 无线局域网',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×3', 'SD 卡槽'],
});
mp10('apple-macbook-pro-13-2011-late', 'MacBook Pro (13 英寸, 2011 年末)', '2011-10-24', 13.3, [1280, 800], 2.04, 'Intel Core i5/i7 处理器 | Sandy Bridge | 2.4/2.8GHz', {
  wifi: '802.11a/b/g/n 无线局域网', ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×2', 'SD 卡槽'],
});
mp10('apple-macbook-pro-15-2011-late', 'MacBook Pro (15 英寸, 2011 年末)', '2011-10-24', 15.4, [1440, 900], 2.54, 'Intel Core i7 处理器 | Sandy Bridge | 2.2/2.5GHz', {
  batt: 77, hrs: 7, wifi: '802.11a/b/g/n 无线局域网',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×2', 'SD 卡槽'],
});
mp10('apple-macbook-pro-17-2011-late', 'MacBook Pro (17 英寸, 2011 年末)', '2011-10-24', 17, [1920, 1200], 2.99, 'Intel Core i7 处理器 | Sandy Bridge | 2.4/2.5GHz', {
  batt: 95, hrs: 8, wifi: '802.11a/b/g/n 无线局域网',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 2.0 ×3', 'SD 卡槽'],
});
mp10('apple-macbook-pro-13-2012-mid', 'MacBook Pro (13 英寸, 2012 年中)', '2012-06-11', 13.3, [1280, 800], 2.06, 'Intel Core i5/i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [4, 8, 16], sto: [500, 750, 1000], wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
mp10('apple-macbook-pro-15-2012-mid', 'MacBook Pro (15 英寸, 2012 年中)', '2012-06-11', 15.4, [1440, 900], 2.56, 'Intel Core i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [4, 8, 16], sto: [500, 750, 1000], batt: 77, wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0',
  ports: ['千兆以太网', '雷雳 / USB 4 接口', 'FireWire 800', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
const mpr = (id, name, date, size, res, ppi, kg, cpu, o = {}) =>
  pad(id, name, date, 'MacBook Pro', {
    t: 18, kg, mat: '一体成型铝金属机身', colors: ['银色'], size, disp: '视网膜显示屏', res, ppi,
    nit: 300, cpu, stoT: 'PCIe 闪存 (SSD)', cam: '720p FaceTime HD 摄像头',
    batt: 74, hrs: 10, wifi: '802.11a/b/g/n 无线局域网', bt: '蓝牙 4.0',
    spk: '内置立体声扬声器', jack: '3.5 毫米耳机孔', kb: '背光键盘',
    ports: ['千兆以太网', '雷雳 / USB 4 接口', 'USB 3.0 ×2', 'HDMI 端口', 'SDXC 卡槽'],
    os: 'OS X v10.11 或更高版本', ...o,
  });
mpr('apple-macbook-pro-13-retina-2012-late', 'MacBook Pro (Retina, 13 英寸, 2012 年末)', '2012-10-23', 13.3, [2560, 1600], 227, 1.62, 'Intel Core i5/i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [8, 16], sto: [128, 256, 512, 768], batt: 74,
});
mpr('apple-macbook-pro-13-retina-2013-early', 'MacBook Pro (Retina, 13 英寸, 2013 年初)', '2013-02-13', 13.3, [2560, 1600], 227, 1.62, 'Intel Core i5/i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [8, 16], sto: [128, 256, 512, 768], batt: 74,
});
mpr('apple-macbook-pro-15-retina-2013-early', 'MacBook Pro (Retina, 15 英寸, 2013 年初)', '2013-02-13', 15.4, [2880, 1800], 220, 2.02, 'Intel Core i7 处理器 | Ivy Bridge', {
  nm: 22, ram: [8, 16], sto: [256, 512, 768], batt: 95,
});
mpr('apple-macbook-pro-15-retina-2015-mid', 'MacBook Pro (Retina, 15 英寸, 2015 年中)', '2015-05-19', 15.4, [2880, 1800], 220, 2.04, 'Intel Core i7 处理器 | Haswell | 2.2/2.5GHz', {
  nm: 22, ram: [16], sto: [256, 512, 1000], batt: 99.5, hrs: 9,
  wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.0',
  ports: ['HDMI 端口', '雷雳 2 ×2', 'USB 3.0 ×2', 'SDXC 卡槽'],
});
const mptb = (id, name, date, size, res, ppi, kg, cpu, o = {}) =>
  pad(id, name, date, 'MacBook Pro', {
    t: 15.5, kg, mat: '一体成型铝金属机身', colors: ['银色', '深空灰色'], size, disp: '视网膜显示屏', res, ppi,
    nit: 500, cpu, stoT: 'PCIe 闪存 (SSD)', cam: '720p FaceTime HD 摄像头',
    batt: 54, hrs: 10, wifi: '802.11a/b/g/n/ac 无线局域网', bt: '蓝牙 4.2',
    spk: '六扬声器系统 | 支持杜比全景声', jack: '3.5 毫米耳机孔', kb: '触控栏和背光妙控键盘',
    ports: ['雷雳 3 ×2'], os: 'macOS 15.1 或更高版本', ...o,
  });
mptb('apple-macbook-pro-13-2016-tb2', 'MacBook Pro (13 英寸, 2016, 雷雳×2)', '2016-10-27', 13.3, [2560, 1600], 227, 1.37, 'Intel Core i5/i7 处理器 | Skylake', {
  nm: 14, ram: [8, 16], sto: [256, 512, 1000], batt: 49.2,
});
mptb('apple-macbook-pro-13-2017-tb2', 'MacBook Pro (13 英寸, 2017, 雷雳×2)', '2017-06-05', 13.3, [2560, 1600], 227, 1.37, 'Intel Core i5/i7 处理器 | Kaby Lake', {
  nm: 14, ram: [8, 16], sto: [128, 256, 512, 1000], batt: 49.2, bt: '蓝牙 4.2',
});
mptb('apple-macbook-pro-13-2017-tb4', 'MacBook Pro (13 英寸, 2017, 雷雳×4)', '2017-06-05', 13.3, [2560, 1600], 227, 1.37, 'Intel Core i5/i7 处理器 | Kaby Lake', {
  nm: 14, ram: [8, 16], sto: [128, 256, 512, 1000], batt: 49.2,
  ports: ['雷雳 3 ×4'],
});
mptb('apple-macbook-pro-15-2017', 'MacBook Pro (15 英寸, 2017)', '2017-06-05', 15.4, [2880, 1800], 220, 1.83, 'Intel Core i7/i9 处理器 | Kaby Lake', {
  nm: 14, ram: [16], sto: [256, 512, 1000, 2000], batt: 76,
  ports: ['雷雳 3 ×4'],
});
mptb('apple-macbook-pro-13-2018-tb2', 'MacBook Pro (13 英寸, 2018, 雷雳×2)', '2018-07-12', 13.3, [2560, 1600], 227, 1.37, 'Intel Core i5/i7 处理器 | Coffee Lake', {
  nm: 14, ram: [8, 16], sto: [256, 512, 1000, 2000], batt: 58, bt: '蓝牙 5.0',
});
mptb('apple-macbook-pro-15-2018', 'MacBook Pro (15 英寸, 2018)', '2018-07-12', 15.4, [2880, 1800], 220, 1.83, 'Intel Core i7/i9 处理器 | Coffee Lake', {
  nm: 14, ram: [16, 32], sto: [256, 512, 1000, 2000, 4000], batt: 83.6, bt: '蓝牙 5.0',
  ports: ['雷雳 3 ×4'],
});
mptb('apple-macbook-pro-13-2019-tb2', 'MacBook Pro (13 英寸, 2019, 雷雳×2)', '2019-05-21', 13.3, [2560, 1600], 227, 1.37, 'Intel Core i5/i7 处理器 | Coffee Lake', {
  nm: 14, ram: [8, 16], sto: [128, 256, 512, 1000, 2000], batt: 58, bt: '蓝牙 5.0',
});
mptb('apple-macbook-pro-15-2019', 'MacBook Pro (15 英寸, 2019)', '2019-05-21', 15.4, [2880, 1800], 220, 1.83, 'Intel Core i7/i9 处理器 | Coffee Lake', {
  nm: 14, ram: [16, 32], sto: [256, 512, 1000, 2000, 4000], batt: 83.6, bt: '蓝牙 5.0',
  ports: ['雷雳 3 ×4'], kb: '蝶式背光键盘（含触控 ID）',
});
mptb('apple-macbook-pro-13-2020-tb2', 'MacBook Pro (13 英寸, 2020, 雷雳×2)', '2020-05-04', 13.3, [2560, 1600], 227, 1.4, 'Intel Core i5/i7 处理器 | Ice Lake', {
  nm: 10, ram: [8, 16, 32], sto: [256, 512, 1000, 2000], batt: 58, bt: '蓝牙 5.0',
  kb: '背光妙控键盘（含触控 ID）',
});
const mpas = (id, name, date, size, res, ppi, kg, cpu, gpu, npu, o = {}) =>
  pad(id, name, date, 'MacBook Pro', {
    t: 15.5, kg, mat: '一体成型铝金属机身', colors: ['银色', '深空灰色'], size, disp: 'Liquid 视网膜 XDR 显示屏',
    res, ppi, nit: 500, arch: 'ARM', cpu, gpu, npu, stoT: 'PCIe 闪存 (SSD)',
    ramT: '统一内存', cam: '1080p FaceTime 高清摄像头',
    batt: 70, hrs: 20, wifi: '802.11ax 无线局域网 (Wi-Fi 6E)', bt: '蓝牙 5.3',
    spk: '六扬声器系统 | 支持杜比全景声', jack: '3.5 毫米耳机孔', kb: '背光妙控键盘',
    ports: ['雷雳 4 ×3', 'HDMI 2.1 端口', 'SDXC 卡槽', 'MagSafe 3 端口'],
    os: 'macOS 15.1 或更高版本', ...o,
  });
mpas('apple-macbook-pro-13-m2-2022', 'MacBook Pro (13 英寸, M2, 2022)', '2022-06-06', 13.3, [2560, 1600], 227, 1.38, 'Apple M2 芯片', '10 核图形处理器', '16 核神经网络引擎', {
  nm: 5, cores: 8, ram: [8, 16, 24], sto: [256, 512, 1000, 2000], disp: '视网膜显示屏',
  batt: 58.2, hrs: 20, wifi: '802.11ax 无线局域网 (Wi-Fi 6)', bt: '蓝牙 5.0',
  spk: '高保真六扬声器系统 | 支持杜比全景声', kb: '背光妙控键盘（含触控 ID）',
  ports: ['雷雳 3 ×2'],
});
mpas('apple-macbook-pro-14-2023', 'MacBook Pro (14 英寸, 2023)', '2023-01-17', 14.2, [3024, 1964], 254, 1.61, 'Apple M2 Pro 芯片', '16 核图形处理器', '16 核神经网络引擎', {
  nm: 5, cores: 12, ram: [16, 32], sto: [512, 1000, 2000, 4000], batt: 70,
});
mpas('apple-macbook-pro-16-2023', 'MacBook Pro (16 英寸, 2023)', '2023-01-17', 16.2, [3456, 2234], 254, 2.15, 'Apple M2 Max 芯片', '30 核图形处理器', '16 核神经网络引擎', {
  nm: 5, cores: 12, ram: [32, 64, 96], sto: [1000, 2000, 4000, 8000], batt: 100,
});
mpas('apple-macbook-pro-16-2023-11', 'MacBook Pro (16 英寸, 2023 年 11 月)', '2023-10-30', 16.2, [3456, 2234], 254, 2.16, 'Apple M3 Max 芯片', '40 核图形处理器', '16 核神经网络引擎', {
  nm: 3, cores: 16, ram: [32, 48, 64, 128], sto: [1000, 2000, 4000, 8000], batt: 100,
  wifi: '802.11ax 无线局域网 (Wi-Fi 6E)', bt: '蓝牙 5.3',
});
mpas('apple-macbook-pro-14-2024', 'MacBook Pro (14 英寸, 2024)', '2024-10-30', 14.2, [3024, 1964], 254, 1.55, 'Apple M4 Pro 芯片', '16 核图形处理器', '16 核神经网络引擎', {
  nm: 3, cores: 12, ram: [24, 36, 48], sto: [512, 1000, 2000, 4000], batt: 72.4, hrs: 22,
  cam: '1200 万像素 Center Stage 摄像头', bt: '蓝牙 5.3',
});
mpas('apple-macbook-pro-16-2024', 'MacBook Pro (16 英寸, 2024)', '2024-10-30', 16.2, [3456, 2234], 254, 2.14, 'Apple M4 Max 芯片', '32 核图形处理器', '16 核神经网络引擎', {
  nm: 3, cores: 14, ram: [36, 48, 64, 128], sto: [1000, 2000, 4000, 8000], batt: 100, hrs: 22,
  cam: '1200 万像素 Center Stage 摄像头', bt: '蓝牙 5.3',
});
mpas('apple-macbook-pro-16-2026', 'MacBook Pro (16 英寸, 2026)', '2026-03-03', 16.2, [3456, 2234], 254, 2.14, 'Apple M5 Max 芯片', '40 核图形处理器', '16 核神经网络引擎', {
  nm: 3, cores: 16, ram: [36, 48, 64, 128], sto: [1000, 2000, 4000, 8000], batt: 100, hrs: 24,
  cam: '1200 万像素 Center Stage 摄像头',
  wifi: '802.11be 无线局域网 (Wi-Fi 7)', bt: '蓝牙 6',
});

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
