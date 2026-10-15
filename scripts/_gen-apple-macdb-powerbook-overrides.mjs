/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 B1（PowerBook / iBook 全系，约 55 台）
 *
 * 补齐 macdb.cn/powerbook（35）/powerbook-g4（23）/ibook（12）/ibook-g4（8）里
 * 本站缺失的机型：
 *   - PowerBook 100 系列（68k）：Portable / 145 / 145B / 150 / 165 / 165c / 170 / 180 /
 *     190 / 520 / 540 / 550c / Duo 270c / Duo 280 / 500 / 5300c / 5300cs / 5300ce / 1400cs
 *   - PowerBook G3 后期：1998 年 9 月（PDQ）/ Bronze Keyboard（Lombard）/ FireWire（Pismo）
 *   - PowerBook G4 钛金属与铝金属各英寸代：千兆以太网 / DVI / 1GHz / 12"、15"、17" 各代
 *   - iBook G3 各代与 iBook G4 12/14 英寸各代
 *
 * 数据来源：macdb.cn 分类页清单（抓取核对脚本见 _work/macdb/），CPU/屏幕/电池/系统按
 * Apple 官方档案与 everymac 口径互证；1990 年代机型置信度中。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-powerbook';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

const K = {
  t: 'body.thicknessMm', kg: 'body.weightKg', mat: 'body.material', colors: 'body.colors',
  size: 'display.sizeIn', disp: 'display.type', res: 'display.resolutionPx', ppi: 'display.ppi',
  cpu: 'chipset.name', arch: 'chipset.arch', nm: 'chipset.processNm', cores: 'chipset.cpuCores',
  gpu: 'chipset.gpu', npu: 'chipset.npu',
  ram: 'memory.ramGb', ramT: 'memory.ramType', sto: 'memory.storageGb', stoT: 'memory.storageType',
  batt: 'battery.capacityWh', hrs: 'battery.vendorClaimedHours',
  cam: 'camera.front', spk: 'audio.speakers', jack: 'audio.jack',
  wifi: 'connectivity.wifi', bt: 'connectivity.bluetooth', ports: 'connectivity.ports',
  kb: 'features.keyboard', os: 'os.launch',
};

const B = {
  mat: null, colors: ['黑色'], ppi: null, nm: null, cores: 1, gpu: null, npu: null,
  ram: null, ramT: null, sto: null, batt: null, cam: null, jack: null,
  wifi: null, bt: null, spk: '内置扬声器', kb: '全尺寸键盘', arch: '68k',
  stoT: '可换托架硬盘', ports: ['SCSI (HDI-30)', 'Serial', 'ADB'], os: 'System 7',
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
    reason: '苹果全系列·macDB 对账批 B1（PowerBook 100 系列 → PowerBook G3/G4 各代 → iBook G3/G4 各英寸代）——macDB 分类页清单与 Apple 官方档案互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

/* ──────────────── PowerBook 100 系列（68k）──────────────── */
const pb = (id, name, date, size, res, cpu, o = {}) =>
  pad(id, name, date, 'PowerBook', {
    t: 57, kg: 3.1, size, disp: '内置液晶显示屏', res, cpu,
    hrs: 3, spk: '内置扬声器', ...o,
  });
const pbm = (id, name, date, size, res, cpu, o = {}) => // 单色屏
  pb(id, name, date, size, res, cpu, { disp: '内置单色液晶显示屏', ...o });
const pbc = (id, name, date, size, res, cpu, o = {}) => // 彩色屏
  pb(id, name, date, size, res, cpu, { disp: '内置液晶显示屏', ...o });

pad('apple-macintosh-portable', 'Macintosh Portable', '1989-09-20', 'PowerBook', {
  t: 104, kg: 7.2, colors: ['灰白色'], mat: null,
  size: 9.8, disp: '内置单色液晶显示屏', res: [640, 400],
  cpu: 'Motorola 68000 处理器 | 16MHz', arch: '68k', stoT: '软盘 + 内置硬盘',
  hrs: 10, spk: '内置扬声器', os: 'System 6.0.7 或更高版本',
});
pbm('apple-powerbook-145', 'Macintosh PowerBook 145', '1992-08-03', 9, [640, 400], 'Motorola 68030 处理器 | 25MHz', { kg: 2.9, t: 53 });
pbm('apple-powerbook-145b', 'Macintosh PowerBook 145B', '1993-06-07', 9, [640, 400], 'Motorola 68030 处理器 | 25MHz', { kg: 2.9, t: 53 });
pbm('apple-powerbook-150', 'Macintosh PowerBook 150', '1994-07-18', 9, [640, 400], 'Motorola 68030 处理器 | 33MHz', { kg: 2.5, t: 56, colors: ['灰白色'] });
pbm('apple-powerbook-165', 'Macintosh PowerBook 165', '1993-08-16', 10, [640, 400], 'Motorola 68030 处理器 | 33MHz', { kg: 3.1, t: 57 });
pbc('apple-powerbook-165c', 'Macintosh PowerBook 165c', '1993-02-10', 9, [640, 400], 'Motorola 68030 处理器 | 33MHz', { kg: 3.1, t: 57 });
pbm('apple-powerbook-170', 'Macintosh PowerBook 170', '1991-10-21', 10, [640, 400], 'Motorola 68030 处理器 | 25MHz', { kg: 3.1, t: 57 });
pbm('apple-powerbook-180', 'Macintosh PowerBook 180', '1992-10-19', 10, [640, 400], 'Motorola 68030 处理器 | 33MHz', { kg: 3.1, t: 57 });
pbm('apple-powerbook-190', 'Macintosh PowerBook 190', '1995-08-28', 9.5, [640, 480], 'Motorola 68LC040 处理器 | 33MHz', { kg: 2.9, t: 51, arch: '68k' });
pbm('apple-powerbook-520', 'Macintosh PowerBook 520', '1994-05-16', 9.5, [640, 480], 'Motorola 68LC040 处理器 | 25MHz', { kg: 3.0, t: 51 });
pbm('apple-powerbook-540', 'Macintosh PowerBook 540', '1994-05-16', 9.5, [640, 480], 'Motorola 68LC040 处理器 | 33MHz', { kg: 3.2, t: 51 });
pbc('apple-powerbook-550c', 'Macintosh PowerBook 550c', '1995-05-01', 10.4, [640, 480], 'Motorola 68LC040 处理器 | 33MHz', { kg: 3.2, t: 51 });
const duo = (id, name, date, size, res, cpu, o = {}) =>
  pad(id, name, date, 'PowerBook', {
    t: 40.6, kg: 1.9, colors: ['灰白色'], mat: 'Duo 超薄可插入底座设计',
    size, disp: size >= 9 ? '内置单色液晶显示屏' : '内置液晶显示屏', res, cpu,
    arch: '68k', hrs: 3, stoT: '硬盘（Duo Dock 可扩展）', os: 'System 7',
    ports: ['Serial (Mini-Din-8)', 'SCSI', 'Modem 扩展'], spk: '内置扬声器', ...o,
  });
duo('apple-powerbook-duo-270c', 'Macintosh PowerBook Duo 270c', '1993-10-18', 8.4, [640, 480], 'Motorola 68030 处理器 | 33MHz', {
  kg: 2.1, disp: '内置液晶显示屏',
});
duo('apple-powerbook-duo-280', 'Macintosh PowerBook Duo 280', '1994-05-16', 9, [640, 400], 'Motorola 68LC040 处理器 | 33MHz', { kg: 2.0 });
pb('apple-powerbook-500', 'Macintosh PowerBook 500', '1995-05-01', 9.5, [640, 480], 'PowerPC 603e 处理器 | 100MHz', {
  arch: 'PowerPC', kg: 3.0, t: 51, disp: '内置单色液晶显示屏',
});
pb('apple-powerbook-5300c', 'Macintosh PowerBook 5300c', '1995-08-28', 10.4, [640, 480], 'PowerPC 603e 处理器 | 100MHz', {
  arch: 'PowerPC', kg: 2.9, t: 51, disp: '内置液晶显示屏', sto: [0.5, 0.75], hrs: 3, os: 'System 7.5',
  ports: ['SCSI (HDI-30)', 'Serial', 'ADB', 'Mini-15 视频输出', '红外收发器'],
});
pb('apple-powerbook-5300cs', 'Macintosh PowerBook 5300cs', '1995-08-28', 10.4, [800, 600], 'PowerPC 603e 处理器 | 100MHz', {
  arch: 'PowerPC', kg: 2.9, t: 51, disp: '内置液晶显示屏', sto: [0.5, 0.75], hrs: 3, os: 'System 7.5',
  ports: ['SCSI (HDI-30)', 'Serial', 'ADB', 'Mini-15 视频输出', '红外收发器'],
});
pb('apple-powerbook-5300ce', 'Macintosh PowerBook 5300ce', '1995-08-28', 10.4, [800, 600], 'PowerPC 603e 处理器 | 117MHz', {
  arch: 'PowerPC', kg: 2.9, t: 51, disp: '内置液晶显示屏', sto: [0.75, 1.1], hrs: 3, os: 'System 7.5',
  ports: ['SCSI (HDI-30)', 'Serial', 'ADB', 'Mini-15 视频输出', '红外收发器'],
});
pb('apple-powerbook-1400cs', 'Macintosh PowerBook 1400cs', '1996-10-01', 11.3, [800, 600], 'PowerPC 603e 处理器 | 117MHz', {
  arch: 'PowerPC', kg: 3.0, t: 51, disp: '内置液晶显示屏', sto: [0.75, 1, 1.3, 2],
  batt: 29, hrs: 3, os: 'System 7.5',
  ports: ['SCSI (HDI-30)', 'Serial', 'ADB', 'Mini-15 视频输出'],
});

/* ──────────────── PowerBook G3 后期 ──────────────── */
const g3 = (id, name, date, size, res, cpu, o = {}) =>
  pad(id, name, date, 'PowerBook G3', {
    t: 50, kg: 3.2, colors: ['黑色'], size, disp: '内置液晶显示屏', res,
    arch: 'PowerPC', cpu, hrs: 5, stoT: '硬盘', os: 'Mac OS 8.1 或更高版本',
    ports: ['SCSI (HDI-30)', 'Serial', 'ADB', 'Mini-15 视频输出', '红外收发器'], ...o,
  });
g3('apple-powerbook-g3-1998-09', 'PowerBook G3 (1998 年 9 月)', '1998-09-01', 14.1, [1024, 768], 'PowerPC G3 处理器 | 233–292MHz', {
  kg: 3.4, sto: [2, 4, 8],
});
g3('apple-powerbook-g3-bronze', 'PowerBook G3 (Bronze Keyboard)', '1999-05-10', 14.1, [1024, 768], 'PowerPC G3 处理器 | 333/400MHz', {
  kg: 3.4, sto: [2, 4, 6], colors: ['石墨色'],
  ports: ['SCSI (HDI-30)', 'USB 1.1 ×2', 'ADB', 'Mini-15 视频输出'],
});
g3('apple-powerbook-g3-firewire', 'PowerBook G3 (FireWire)', '2000-02-16', 14.1, [1024, 768], 'PowerPC G3 处理器 | 400/500MHz', {
  kg: 3.4, sto: [4, 6, 10], colors: ['石墨色'],
  ports: ['FireWire 400 ×2', 'USB 1.1 ×2', '千兆以太网', 'Mini-15 视频输出'],
});

/* ──────────────── PowerBook G4（钛金属 → 铝金属）──────────────── */
const g4 = (id, name, date, size, res, ppi, cpu, o = {}) =>
  pad(id, name, date, 'PowerBook G4', {
    t: 30, kg: 2.4, colors: ['银色'], mat: '铝金属机身', size, disp: '内置液晶显示屏', res, ppi,
    arch: 'PowerPC', cpu, hrs: 5, stoT: '硬盘 (ATA)', os: 'Mac OS X v10.2.6 或更高版本',
    wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 1.1',
    spk: '内置立体声扬声器', jack: '3.5 毫米耳机孔',
    ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 2.0 ×2', 'DVI 视频输出'], ...o,
  });
const g4ti = (id, name, date, size, res, ppi, cpu, o = {}) =>
  g4(id, name, date, size, res, ppi, cpu, { mat: '钛金属机身', colors: ['银色'], ...o });
g4ti('apple-powerbook-g4-gigabit', 'PowerBook G4 (Gigabit Ethernet)', '2000-12-20', 15.2, [1152, 768], 92, 'PowerPC G4 处理器 | 400/500MHz', {
  kg: 2.4, t: 30, sto: [10, 20, 30], os: 'Mac OS 9.1 或更高版本', bt: null, wifi: 'AirPort 802.11b（可选）',
  ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', 'VGA 视频输出'],
});
g4ti('apple-powerbook-g4-dvi', 'PowerBook G4 (DVI)', '2001-07-18', 15.2, [1280, 854], 101, 'PowerPC G4 处理器 | 550/667MHz', {
  kg: 2.4, t: 30, sto: [20, 30, 40], bt: null, wifi: 'AirPort 802.11b（可选）',
  ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', 'DVI 视频输出'],
});
g4ti('apple-powerbook-g4-1ghz', 'PowerBook G4 (1GHz/867MHz)', '2001-12-06', 15.2, [1280, 854], 101, 'PowerPC G4 处理器 | 667MHz/1GHz', {
  kg: 2.4, t: 30, sto: [30, 40, 60], bt: null, wifi: 'AirPort 802.11b（可选）',
  ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 1.1 ×2', 'DVI 视频输出'],
});
g4('apple-powerbook-g4-12-2003', 'PowerBook G4 (12 英寸, 2003 年初)', '2003-01-07', 12.1, [1024, 768], 106, 'PowerPC G4 处理器 | 867MHz', {
  kg: 2.1, t: 30, sto: [30, 40],
});
g4('apple-powerbook-g4-17-2003', 'PowerBook G4 (17 英寸, 2003 年初)', '2003-01-07', 17, [1440, 900], 99, 'PowerPC G4 处理器 | 1GHz', {
  kg: 3.1, t: 26, sto: [40, 60], mat: '铝金属机身',
  ports: ['千兆以太网', 'FireWire 400 ×2', 'USB 2.0 ×2', 'DVI 视频输出', 'S-Video 输入输出'],
});
g4('apple-powerbook-g4-12-dvi', 'PowerBook G4 (12 英寸 DVI)', '2003-09-16', 12.1, [1024, 768], 106, 'PowerPC G4 处理器 | 1GHz', {
  kg: 2.1, t: 30, sto: [30, 40],
});
g4('apple-powerbook-g4-15-fw800', 'PowerBook G4 (15 英寸 FW800)', '2003-09-16', 15.2, [1280, 854], 101, 'PowerPC G4 处理器 | 1.0/1.25GHz', {
  kg: 2.5, t: 30, sto: [40, 60, 80],
  ports: ['千兆以太网', 'FireWire 800', 'FireWire 400', 'USB 2.0 ×2', 'DVI 视频输出'],
});
g4('apple-powerbook-g4-17-133', 'PowerBook G4 (17 英寸 1.33GHz)', '2003-09-16', 17, [1440, 900], 99, 'PowerPC G4 处理器 | 1.33GHz', {
  kg: 3.1, t: 26, sto: [60, 80],
  ports: ['千兆以太网', 'FireWire 800', 'FireWire 400', 'USB 2.0 ×2', 'DVI 视频输出'],
});
g4('apple-powerbook-g4-12-133', 'PowerBook G4 (12 英寸 1.33GHz)', '2004-04-19', 12.1, [1024, 768], 106, 'PowerPC G4 处理器 | 1.33GHz', {
  kg: 2.1, t: 30, sto: [40, 60],
});
g4('apple-powerbook-g4-15-133-150', 'PowerBook G4 (15 英寸 1.5GHz/1.33GHz)', '2004-04-19', 15.2, [1280, 854], 101, 'PowerPC G4 处理器 | 1.33/1.5GHz', {
  kg: 2.5, t: 30, sto: [60, 80],
});
g4('apple-powerbook-g4-17-150', 'PowerBook G4 (17 英寸 1.5GHz)', '2004-04-19', 17, [1440, 900], 99, 'PowerPC G4 处理器 | 1.5GHz', {
  kg: 3.1, t: 26, sto: [80, 100],
});
g4('apple-powerbook-g4-12-150', 'PowerBook G4 (12 英寸 1.5GHz)', '2005-01-31', 12.1, [1024, 768], 106, 'PowerPC G4 处理器 | 1.5GHz', {
  kg: 2.1, t: 30, sto: [60, 80], bt: '蓝牙 2.0 + EDR',
});
g4('apple-powerbook-g4-15-167', 'PowerBook G4 (15 英寸 1.67GHz)', '2005-01-31', 15.2, [1440, 960], 111, 'PowerPC G4 处理器 | 1.67GHz', {
  kg: 2.5, t: 30, sto: [80, 100], bt: '蓝牙 2.0 + EDR',
});
g4('apple-powerbook-g4-17-167', 'PowerBook G4 (17 英寸 1.67GHz)', '2005-01-31', 17, [1680, 1050], 116, 'PowerPC G4 处理器 | 1.67GHz', {
  kg: 3.1, t: 26, sto: [100, 120], bt: '蓝牙 2.0 + EDR',
});
g4('apple-powerbook-g4-15-dlsd', 'PowerBook G4 (15 英寸 Double-Layer SD)', '2005-10-19', 15.2, [1440, 960], 111, 'PowerPC G4 处理器 | 1.67GHz', {
  kg: 2.5, t: 30, sto: [80, 100, 120], bt: '蓝牙 2.0 + EDR',
  ports: ['千兆以太网', 'FireWire 800', 'FireWire 400', 'USB 2.0 ×2', 'DVI 视频输出', 'S-Video 输入输出'],
});
g4('apple-powerbook-g4-17-dlsd', 'PowerBook G4 (17 英寸 Double-Layer SD)', '2005-10-19', 17, [1680, 1050], 116, 'PowerPC G4 处理器 | 1.67GHz', {
  kg: 3.1, t: 26, sto: [100, 120, 160], bt: '蓝牙 2.0 + EDR',
  ports: ['千兆以太网', 'FireWire 800', 'FireWire 400', 'USB 2.0 ×2', 'DVI 视频输出', 'S-Video 输入输出'],
});

/* ──────────────── iBook G3 / iBook G4 ──────────────── */
const ib = (id, name, date, size, res, cpu, o = {}) =>
  pad(id, name, date, 'iBook', {
    t: 46, kg: 2.7, colors: ['白色', '蓝莓色'], mat: '半透明彩色塑料 (蛤壳设计，带提手)',
    size, disp: '内置液晶显示屏', res, arch: 'PowerPC', cpu, hrs: 6,
    sto: [3, 6], stoT: '硬盘 (ATA)', os: 'Mac OS 8.6 或更高版本',
    wifi: 'AirPort 802.11b（可选）', spk: '内置立体声扬声器', jack: '3.5 毫米耳机孔',
    ports: ['以太网', 'FireWire 400', 'USB 1.1 ×2', 'VGA 视频输出'], ...o,
  });
ib('apple-ibook-se-1999', 'iBook SE', '1999-07-21', 12.1, [800, 600], 'PowerPC G3 处理器 | 300/366MHz', { colors: ['石墨色'] });
ib('apple-ibook-se-firewire', 'iBook SE (FireWire)', '2000-09-13', 12.1, [800, 600], 'PowerPC G3 处理器 | 366/466MHz', {
  colors: ['石墨色', '靛蓝色'], sto: [10], os: 'Mac OS 9.1 或更高版本',
});
ib('apple-ibook-2001-late', 'iBook (2001 年末)', '2001-10-16', 12.1, [1024, 768], 'PowerPC G3 处理器 | 500MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.2, t: 34,
  os: 'Mac OS X v10.1 或更高版本',
});
ib('apple-ibook-14-2002', 'iBook (14 英寸 LCD)', '2002-01-07', 14.1, [1024, 768], 'PowerPC G3 处理器 | 600MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.7, t: 34,
  os: 'Mac OS X v10.1 或更高版本',
});
ib('apple-ibook-12-16vram', 'iBook (12 英寸 16 VRAM)', '2002-05-20', 12.1, [1024, 768], 'PowerPC G3 处理器 | 700MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.2, t: 34,
});
ib('apple-ibook-14-16vram', 'iBook (14 英寸 LCD 16 VRAM)', '2002-05-20', 14.1, [1024, 768], 'PowerPC G3 处理器 | 700MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.7, t: 34,
});
ib('apple-ibook-opaque-16vram', 'iBook (Opaque 16 VRAM)', '2002-11-06', 12.1, [1024, 768], 'PowerPC G3 处理器 | 800MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.2, t: 34,
});
ib('apple-ibook-32vram', 'iBook (32 VRAM)', '2003-04-22', 12.1, [1024, 768], 'PowerPC G3 处理器 | 800MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.2, t: 34, sto: [20, 30],
});
ib('apple-ibook-14-32vram', 'iBook (14 英寸 LCD 32 VRAM)', '2003-04-22', 14.1, [1024, 768], 'PowerPC G3 处理器 | 800MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.7, t: 34, sto: [20, 30],
});
ib('apple-ibook-800-900', 'iBook (800/900 MHz 32 VRAM)', '2003-11-18', 12.1, [1024, 768], 'PowerPC G3 处理器 | 800/900MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.2, t: 34, sto: [30, 40],
});
ib('apple-ibook-14-900', 'iBook (14 英寸 LCD 900 MHz 32 VRAM)', '2003-11-18', 14.1, [1024, 768], 'PowerPC G3 处理器 | 900MHz', {
  colors: ['白色'], mat: '聚碳酸酯白色一体成型机身', kg: 2.7, t: 34, sto: [30, 40],
});
const ibg4 = (id, name, date, size, cpu, o = {}) =>
  pad(id, name, date, 'iBook G4', {
    t: 34, kg: size >= 14 ? 2.7 : 2.2, colors: ['白色'], mat: '聚碳酸酯白色一体成型机身',
    size, disp: '内置液晶显示屏', res: [1024, 768], arch: 'PowerPC', cpu, hrs: 6,
    sto: [30, 40, 60], stoT: '硬盘 (ATA)', os: 'Mac OS X v10.3 或更高版本',
    wifi: 'AirPort Extreme 802.11g（标配）', bt: '蓝牙 1.1',
    spk: '内置立体声扬声器', jack: '3.5 毫米耳机孔',
    ports: ['以太网', 'FireWire 400', 'USB 2.0 ×2', 'VGA 视频输出'], ...o,
  });
ibg4('apple-ibook-g4-14-2003', 'iBook G4 (14 英寸, 2003 年 10 月)', '2003-10-22', 14.1, 'PowerPC G4 处理器 | 1GHz');
ibg4('apple-ibook-g4-12-2004-early', 'iBook G4 (12 英寸, 2004 年初)', '2004-02-23', 12.1, 'PowerPC G4 处理器 | 1.2GHz');
ibg4('apple-ibook-g4-14-2004-early', 'iBook G4 (14 英寸, 2004 年初)', '2004-02-23', 14.1, 'PowerPC G4 处理器 | 1.2GHz');
ibg4('apple-ibook-g4-12-2004-late', 'iBook G4 (12 英寸, 2004 年末)', '2004-10-19', 12.1, 'PowerPC G4 处理器 | 1.2/1.33GHz', { sto: [30, 60] });
ibg4('apple-ibook-g4-14-2004-late', 'iBook G4 (14 英寸, 2004 年末)', '2004-10-19', 14.1, 'PowerPC G4 处理器 | 1.2/1.33GHz', { sto: [30, 60] });
ibg4('apple-ibook-g4-12-2005', 'iBook G4 (12 英寸, 2005 年中期)', '2005-07-26', 12.1, 'PowerPC G4 处理器 | 1.33/1.42GHz', {
  sto: [40, 60, 80], os: 'Mac OS X v10.4.2 或更高版本', bt: '蓝牙 2.0 + EDR',
});
ibg4('apple-ibook-g4-14-2005', 'iBook G4 (14 英寸, 2005 年中期)', '2005-07-26', 14.1, 'PowerPC G4 处理器 | 1.33/1.42GHz', {
  sto: [40, 60, 80], os: 'Mac OS X v10.4.2 或更高版本', bt: '蓝牙 2.0 + EDR',
});

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
