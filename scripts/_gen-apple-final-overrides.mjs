/**
 * 一次性生成脚本：苹果全系列收官批（6 台 + headset/home 两个新品类首批）
 *
 *  - headset：Apple Vision Pro（M2，2023-06-05 WWDC 发布 / 2024-02-02 发售，已停产）
 *             Apple Vision Pro (M5)（2025-10-15 发布 / 10-22 发售，在售）
 *  - display：Pro Display XDR（2019-06-03 WWDC19，已停产——官网页重定向到现役页）
 *             Studio Display（2022-03-08，已停产——被 2026 款取代）
 *  - audio：  HomePod mini 2（2026-10-13 发布 / 10-30 发售，国行有售）
 *  - home：   Apple TV 4K（第 4 代，2026-10-13 发布 / 11-13 发售，国行未公布）
 *
 * 数据来源（2026-10-15 当场核验）：
 *  - apple.com/apple-vision-pro/specs/（M5 现役页）、apple.com/apple-tv-4k/specs/、
 *    apple.com/homepod-mini/specs/（mini 2 现役页）
 *  - support.apple.com/117810（Vision Pro M2 初代档案，中英对照）、
 *    support.apple.com/111892（Pro Display XDR）、support.apple.com/111890（Studio Display 2022）
 *  - apple.com.cn 新闻稿（Vision Pro M5 发布/发售日、HomePod mini 2 国行价与配色）
 * HomeView 未录：官网无 specs 页（11-13 才发售），新闻源屏幕尺寸互相矛盾——宁缺毋滥。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-final';

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
      status: status ?? 'on-sale',
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
      '苹果全系列收官批（头显/显示器历史/智能家居）——官网现役 specs 页 + support.apple.com 官方档案页逐台核查录入，官网未公布字段留空',
    source: 'user-manual',
    sourceUrl: null,
    createdBy: BY,
    active: true,
  });
}

const res = (w, h) => ({ w, h });
const GB = (a) => a; // storageGb 契约 = GB 数值数组

/* ── headset：Apple Vision Pro ── */

pad({
  id: 'apple-vision-pro',
  name: 'Apple Vision Pro',
  date: '2023-06-05',
  status: 'discontinued',
  category: 'headset',
  line: 'Apple Vision Pro',
  specs: {
    'body.weightG': 600,
    'body.material': '铝金属机身 | Solo Knit Band 头带',
    'body.colors': null,
    'display.type': '2300 万像素 3D 显示系统 (micro-OLED)',
    'display.refreshHz': '90-100',
    'display.colorGamut': '92% DCI-P3',
    'chipset.name': 'Apple M2 芯片 | Apple R1 芯片',
    'chipset.cpuCores': 8,
    'chipset.gpu': '10 核图形处理器',
    'chipset.npu': '16 核神经网络引擎',
    'memory.ramGb': [16],
    'memory.storageGb': GB([256, 512, 1024]),
    'battery.vendorClaimedHours': 2,
    'camera.front': '立体 3D 主摄系统 | 18 毫米 | ƒ/2.00 光圈 | 左右各 650 万像素',
    'features.sensors': [
      '两个高分辨率主摄',
      '六个面向外界的追踪摄像头',
      '四个眼动追踪摄像头',
      '原深感摄像头',
      '激光雷达扫描仪',
      '四个惯性测量单元 (IMU)',
      '防闪烁传感器',
      '环境光传感器',
    ],
    'connectivity.wifi': '无线局域网 (802.11ax)',
    'connectivity.bluetooth': '蓝牙 5.3',
    'os.launch': 'visionOS',
  },
});

pad({
  id: 'apple-vision-pro-m5-2025',
  name: 'Apple Vision Pro (M5)',
  date: '2025-10-15',
  category: 'headset',
  line: 'Apple Vision Pro',
  specs: {
    'body.weightG': 750,
    'body.material': '铝金属机身 | 双圈编织头带',
    'body.colors': null,
    'display.type': '2300 万像素 3D 显示系统 (micro-OLED)',
    'display.refreshHz': '90-120',
    'display.colorGamut': '92% DCI-P3',
    'chipset.name': 'Apple M5 芯片 | Apple R1 芯片',
    'chipset.cpuCores': 10,
    'chipset.gpu': '10 核图形处理器',
    'chipset.npu': '16 核神经网络引擎',
    'memory.ramGb': [16],
    'memory.storageGb': GB([256, 512, 1024]),
    'battery.vendorClaimedHours': 2.5,
    'camera.front': '立体 3D 主摄系统 | 18 毫米 | ƒ/2.00 光圈 | 左右各 650 万像素',
    'features.sensors': [
      '两个高分辨率主摄',
      '六个面向外界的追踪摄像头',
      '四个眼动追踪摄像头',
      '原深感摄像头',
      '激光雷达扫描仪',
      '四个惯性测量单元 (IMU)',
      '防闪烁传感器',
      '环境光传感器',
    ],
    'connectivity.wifi': '无线局域网 (802.11ax)',
    'connectivity.bluetooth': '蓝牙 5.3',
    'os.launch': 'visionOS 26',
  },
});

/* ── display：历史两款（Apple 支持档案页）── */

pad({
  id: 'apple-pro-display-xdr-2019',
  name: 'Pro Display XDR',
  date: '2019-06-03',
  status: 'discontinued',
  category: 'display',
  line: 'Pro Display XDR',
  specs: {
    'body.heightMm': 412,
    'body.widthMm': 718,
    'body.depthMm': 27,
    'body.weightG': 7480,
    'body.colors': ['银色'],
    'display.sizeIn': 32,
    'display.type': '6K 视网膜显示屏 (IPS LCD) | 氧化物 TFT',
    'display.resolutionPx': res(6016, 3384),
    'display.ppi': 218,
    'display.refreshHz': '47.95-60',
    'display.brightnessTypicalNits': 500,
    'display.brightnessPeakNits': 1600,
    'display.colorGamut': 'P3 广色域 | 10 位色深 | 原彩显示',
    'camera.front': null,
    'audio.speakers': null,
    'connectivity.ports': ['雷雳 3 上行端口 (以 96 瓦功率为主机供电)', 'USB-C (USB 2) ×3'],
    'connectivity.hostCharging': '96W',
  },
});

pad({
  id: 'apple-studio-display-2022',
  name: 'Studio Display (2022)',
  date: '2022-03-08',
  status: 'discontinued',
  category: 'display',
  line: 'Studio Display',
  specs: {
    'body.heightMm': 478,
    'body.widthMm': 623,
    'body.depthMm': 168,
    'body.weightG': 6300,
    'body.colors': ['银色'],
    'display.sizeIn': 27,
    'display.type': '5K 视网膜显示屏',
    'display.resolutionPx': res(5120, 2880),
    'display.ppi': 218,
    'display.refreshHz': '60',
    'display.brightnessTypicalNits': 600,
    'display.colorGamut': 'P3 广色域 | 原彩显示 | 10 亿色彩',
    'camera.front': '1200 万像素 Center Stage 摄像头',
    'audio.speakers': '高保真六扬声器系统 | 力消低音单元 | 支持空间音频',
    'connectivity.ports': ['雷雳 3 (USB-C) 上行端口', 'USB-C ×3'],
    'connectivity.hostCharging': '96W',
  },
});

/* ── audio：HomePod mini 2（2026-10-13 发布，10-30 发售）── */

pad({
  id: 'apple-homepod-mini-2',
  name: 'HomePod mini 2',
  date: '2026-10-13',
  status: 'upcoming',
  category: 'audio',
  line: 'HomePod',
  specs: {
    'body.heightMm': 84.3,
    'body.diameterMm': 97.9,
    'body.weightG': 335,
    'body.material': '网眼织物',
    'body.colors': ['粉色', '绿色', '蓝色', '白色', '午夜色'],
    'audio.driverUnit': '全频段驱动单元 | 双被动式辐射器',
    'audio.anc': false,
    'audio.spatialAudio': true,
    'chipset.name': 'S10 芯片',
    'connectivity.wifi': '802.11ax 无线局域网 (Wi-Fi 6E)',
    'connectivity.bluetooth': '蓝牙 6',
    'connectivity.thread': 'Thread 网络技术',
    'os.launch': 'homeOS',
  },
});

/* ── home：Apple TV 4K（第 4 代，2026-10-13 发布，11-13 发售）── */

pad({
  id: 'apple-tv-4k-4',
  name: 'Apple TV 4K (第 4 代)',
  date: '2026-10-13',
  status: 'upcoming',
  category: 'home',
  line: 'Apple TV',
  specs: {
    'body.heightMm': 31,
    'body.widthMm': 93.24,
    'body.depthMm': 93.24,
    'body.weightG': 217,
    'body.colors': null,
    'display.sizeIn': null,
    'display.type': null,
    'chipset.name': 'A19 芯片',
    'chipset.cpuCores': null,
    'chipset.gpu': null,
    'chipset.npu': null,
    'memory.storageGb': GB([128]),
    'connectivity.wifi': '802.11be 无线局域网 (Wi-Fi 7)',
    'connectivity.bluetooth': '蓝牙 6',
    'connectivity.thread': 'Thread 网络技术',
    'connectivity.ports': ['HDMI 2.1', '千兆以太网', '内置电源'],
    'camera.front': null,
    'audio.speakers': null,
    'features.remote': 'Siri Remote (第 4 代)',
    'os.launch': null,
  },
});

store.entries = [...kept, ...entries];
store.updatedAt = D;
writeFileSync(OVERRIDES, JSON.stringify(store, null, 2) + '\n', 'utf8');
console.log(`已写入 ${entries.length} 条 add-product → data/overrides.json（共 ${store.entries.length} 条）`);
