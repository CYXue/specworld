/**
 * 一次性生成脚本：苹果全系列·早期 Mac 批（7 台，置信度中）
 *
 *  - desktop：Macintosh 128K（1984-01-24，第一台 Macintosh）、iMac G3（1998-08-15 Bondi Blue）、
 *             iMac G4（2002-01-07）、iMac G5（2004-08-31）、Power Mac G5（2003-06-23，首台 64 位 Mac）
 *  - laptop： PowerBook G4 (Titanium)（2001-01-09）、iBook G3 蛤壳（1999-07-21）
 *
 * ⚠️ 置信度说明（用户 2026-10-15 明确接受）：1984–2004 年代产品官网技术规格页已不存在，
 * 数据取自广为记载的历史锚点（发布日期/CPU/核心尺寸重量/分辨率），未给出的毫米级细节
 * 一律 null。provenance 仍标 user-manual（人工核查），与「官网现役页批次」同为最高可得精度。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-classic-mac';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;

const entries = [];
let seq = startSeq;

function pad({ id, name, date, status, category, line, specs }) {
  seq += 1;
  entries.push({
    id: `ovr-${MARK}-${String(seq - startSeq).padStart(3, '0')}`,
    op: 'add-product',
    createdAt: D,
    product: {
      id,
      slug: id,
      brand: 'apple',
      category,
      line,
      name,
      nameZh: null,
      releaseDate: date,
      releaseDatePrecision: 'day',
      status: status ?? 'discontinued',
      retiredAt: null,
      skus: [],
      scores: [],
      granularity: 'manual',
      specs,
      provenance: {
        ...Object.fromEntries(Object.keys(specs).map((k) => [k, 'user-manual'])),
        releaseDate: 'user-manual',
        ...(specs['display.resolutionPx']
          ? {
              'display.resolutionPx.w': 'user-manual',
              'display.resolutionPx.h': 'user-manual',
            }
          : {}),
      },
      notes: [],
    },
    reason:
      '苹果全系列·早期 Mac 批（第一台 Macintosh 起的代际锚点）——1984–2004 年代官网规格页已不存在，按广为记载的历史锚点录入，毫米级细节宁缺毋滥（置信度中，用户已接受）',
    source: 'user-manual',
    sourceUrl: null,
    createdBy: BY,
    active: true,
  });
}

const res = (w, h) => ({ w, h });
const GB = (a) => a;

/* ── desktop ── */

pad({
  id: 'apple-macintosh-128k',
  name: 'Macintosh 128K',
  date: '1984-01-24',
  category: 'desktop',
  line: 'Macintosh',
  specs: {
    'body.widthMm': 345,
    'body.heightMm': 343,
    'body.depthMm': 277,
    'body.weightKg': 7.5,
    'body.colors': ['米白色'],
    'display.sizeIn': 9,
    'display.type': '内置单色 CRT 显示屏',
    'display.resolutionPx': res(512, 342),
    'chipset.name': 'Motorola 68000 处理器',
    'chipset.arch': '68k',
    'chipset.cpuCores': 1,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.ramType': null,
    'memory.storageGb': null,
    'memory.storageType': '400K 软盘驱动器',
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': null,
    'camera.front': null,
    'audio.speakers': '内置扬声器',
    'audio.jack': null,
    'os.launch': 'Macintosh System 1',
  },
});

pad({
  id: 'apple-imac-g3-1998',
  name: 'iMac G3',
  date: '1998-08-15',
  category: 'desktop',
  line: 'iMac',
  specs: {
    'body.widthMm': 386,
    'body.heightMm': 401,
    'body.depthMm': 447,
    'body.weightKg': 17.2,
    'body.material': '半透明 Bondi Blue 彩色塑料',
    'body.colors': ['邦迪蓝'],
    'display.sizeIn': 15,
    'display.type': '内置 CRT 显示屏',
    'display.resolutionPx': res(1024, 768),
    'chipset.name': 'PowerPC G3 处理器 | 233MHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 1,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([4]),
    'memory.storageType': '硬盘',
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['100BASE-TX 以太网', '内置 56k 调制解调器', '红外端口'],
    'camera.front': null,
    'audio.speakers': '内置立体声扬声器',
    'audio.jack': null,
    'os.launch': 'Mac OS 8.1',
  },
});

pad({
  id: 'apple-imac-g4-2002',
  name: 'iMac G4',
  date: '2002-01-07',
  category: 'desktop',
  line: 'iMac',
  specs: {
    'body.widthMm': 399,
    'body.heightMm': 419,
    'body.depthMm': 381,
    'body.weightKg': 9.7,
    'body.material': '半球底座 + 可动臂液晶屏',
    'body.colors': ['白色'],
    'display.sizeIn': 15,
    'display.type': '内置液晶显示屏',
    'display.resolutionPx': res(1024, 768),
    'chipset.name': 'PowerPC G4 处理器 | 700/800MHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 1,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([40, 60]),
    'memory.storageType': '硬盘',
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['100BASE-TX 以太网', '内置 56k 调制解调器'],
    'camera.front': null,
    'audio.speakers': '内置扬声器',
    'audio.jack': null,
    'os.launch': 'Mac OS X 10.1',
  },
});

pad({
  id: 'apple-imac-g5-2004',
  name: 'iMac G5',
  date: '2004-08-31',
  category: 'desktop',
  line: 'iMac',
  specs: {
    'body.widthMm': 444,
    'body.heightMm': 410,
    'body.depthMm': 132,
    'body.weightKg': 5.9,
    'body.material': '一体薄板 (屏幕与主机合一)',
    'body.colors': ['白色'],
    'display.sizeIn': 17,
    'display.type': '内置液晶显示屏',
    'display.resolutionPx': res(1440, 900),
    'chipset.name': 'PowerPC G5 处理器 | 1.6/1.8GHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 1,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([80, 160]),
    'memory.storageType': '硬盘',
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['10/100BASE-TX 以太网', '内置 56k 调制解调器'],
    'camera.front': null,
    'audio.speakers': '内置立体声扬声器',
    'audio.jack': null,
    'os.launch': 'Mac OS X 10.3',
  },
});

pad({
  id: 'apple-power-mac-g5-2003',
  name: 'Power Mac G5',
  date: '2003-06-23',
  category: 'desktop',
  line: 'Power Mac',
  specs: {
    'body.widthMm': 207,
    'body.heightMm': 499,
    'body.depthMm': 457,
    'body.weightKg': 19.7,
    'body.material': '阳极氧化铝金属机箱',
    'body.colors': ['银色'],
    'display.sizeIn': null,
    'display.type': null,
    'chipset.name': 'PowerPC G5 处理器 | 2GHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 2,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([80, 160]),
    'memory.storageType': '硬盘 (SATA)',
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['千兆以太网', 'FireWire 800', 'USB 2.0'],
    'camera.front': null,
    'audio.speakers': null,
    'audio.jack': null,
    'os.launch': 'Mac OS X 10.2',
  },
});

/* ── laptop ── */

pad({
  id: 'apple-powerbook-g4-2001',
  name: 'PowerBook G4 (Titanium)',
  date: '2001-01-09',
  category: 'laptop',
  line: 'PowerBook',
  specs: {
    'body.thicknessMm': 26,
    'body.weightKg': 2.6,
    'body.material': '钛金属机身',
    'body.colors': ['钛灰色'],
    'display.sizeIn': 15.2,
    'display.type': '内置液晶显示屏',
    'display.resolutionPx': res(1152, 768),
    'display.ppi': null,
    'display.refreshHz': null,
    'display.brightnessTypicalNits': null,
    'display.colorGamut': null,
    'chipset.name': 'PowerPC G4 处理器 | 400/500MHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 1,
    'chipset.processNm': null,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([10, 20]),
    'memory.storageType': '硬盘',
    'battery.capacityWh': null,
    'battery.vendorClaimedHours': 5,
    'camera.front': null,
    'audio.speakers': '内置扬声器',
    'audio.jack': null,
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['10/100BASE-TX 以太网', 'FireWire', 'USB'],
    'features.keyboard': null,
    'os.launch': 'Mac OS 9',
  },
});

pad({
  id: 'apple-ibook-g3-1999',
  name: 'iBook G3 (Clamshell)',
  date: '1999-07-21',
  category: 'laptop',
  line: 'iBook',
  specs: {
    'body.thicknessMm': 46,
    'body.weightKg': 3.1,
    'body.material': '半透明彩色塑料 (蛤壳设计，带提手)',
    'body.colors': ['蓝莓色', '柑橘色'],
    'display.sizeIn': 12.1,
    'display.type': '内置液晶显示屏',
    'display.resolutionPx': res(800, 600),
    'display.ppi': null,
    'display.refreshHz': null,
    'display.brightnessTypicalNits': null,
    'display.colorGamut': null,
    'chipset.name': 'PowerPC G3 处理器 | 300MHz',
    'chipset.arch': 'PowerPC',
    'chipset.cpuCores': 1,
    'chipset.processNm': null,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.ramGb': null,
    'memory.storageGb': GB([3.2]),
    'memory.storageType': '硬盘',
    'battery.capacityWh': null,
    'battery.vendorClaimedHours': 6,
    'camera.front': null,
    'audio.speakers': '内置立体声扬声器',
    'audio.jack': null,
    'connectivity.wifi': null,
    'connectivity.bluetooth': null,
    'connectivity.ports': ['10/100BASE-TX 以太网', '56k 调制解调器', 'USB'],
    'features.keyboard': null,
    'os.launch': 'Mac OS 8.6',
  },
});

store.entries = [...kept, ...entries];
store.updatedAt = D;
writeFileSync(OVERRIDES, JSON.stringify(store, null, 2) + '\n', 'utf8');
console.log(`已写入 ${entries.length} 条 add-product → data/overrides.json（共 ${store.entries.length} 条）`);
