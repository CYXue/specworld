/**
 * 一次性生成脚本：苹果全系列·iPod/AirTag 批（30 台）
 *
 *  - tracker（新品类首批）：AirTag 2（2026-01-26 发布）、AirTag（2021-04-20 发布）
 *  - phone：iPod touch 第 1–7 代（2007–2019，蜂窝字段全部 null）
 *  - media（新品类首批）：iPod 主线（1/2/3/4 代 → 第 5 代视频 → classic 2007/2008/2009 终版）
 *                        + iPod mini 1/2 + iPod nano 1–7 + iPod shuffle 1–4
 *
 * 数据来源（2026-10-15 核验）：
 *  - support.apple.com/zh-cn/126203（AirTag 2 官方档案）+ 官方对比脚注（AirTag 1 尺寸同/U1）
 *  - support.apple.com/zh-cn/103823（官方识别页：全代容量/型号/推出日期）
 *  - macdb.cn/ipod-touch|ipod-classic|ipod-nano|ipod-shuffle（全代结构化参数，每台附
 *    support.apple.com 官方技术规格链接互证：111961/112023/112021/112431/112461/112319/112532、
 *    112601/112321/112478、112039/112432/112495/112320/112552、112422/112497/112455 等）
 *  - iPod 1–3 代、mini、早期分辨率/重量为广为记载的历史锚点（macDB 页面截断未及，置信度中，
 *    用户 2026-10-15 已明确接受档案源较低置信度）
 * 官网未公布字段一律留空（RAM/电池 mAh 等仅 macDB 记载的，按「宁缺毋滥」不录进正式字段）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-legacy';

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
      status: status ?? 'retired',
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
      '苹果全系列·iPod/AirTag 批（用户 2026-10-15 决策：iPod classic/nano/shuffle 归多媒体播放器、AirTag 归定位器、iPod touch 归手机）——官方识别页 + 支持档案页 + 结构化编年史源互证录入',
    source: 'user-manual',
    sourceUrl: null,
    createdBy: BY,
    active: true,
  });
}

const res = (w, h) => ({ w, h });
const GB = (a) => a; // storageGb 契约 = GB 数值数组
const rearTouch = (mp, aperture) => ({ role: 'main', mp, aperture: aperture ?? null, ois: null, sensorNote: null });

/* ── tracker：AirTag ── */

pad({
  id: 'apple-airtag-2',
  name: 'AirTag (第 2 代)',
  date: '2026-01-26',
  status: 'on-sale',
  category: 'tracker',
  line: 'AirTag',
  specs: {
    'body.diameterMm': 31.9,
    'body.heightMm': 8.0,
    'body.weightG': 11.8,
    'body.material': '抛光不锈钢盘面 | 85% 再生塑料外壳',
    'body.colors': ['白色'],
    'chipset.name': 'Apple 设计第二代超宽带技术芯片',
    'connectivity.bluetooth': '蓝牙 5.3',
    'connectivity.uwb': '更大范围的精确查找 (Precision Finding)',
    'features.speaker': '内置扬声器',
    'features.batteryType': '可更换的 CR2032 纽扣电池',
    'features.waterResistance': 'IP67 (IEC 60529，最深 1 米水下 30 分钟)',
  },
});

pad({
  id: 'apple-airtag-1',
  name: 'AirTag',
  date: '2021-04-20',
  status: 'retired',
  category: 'tracker',
  line: 'AirTag',
  specs: {
    'body.diameterMm': 31.9,
    'body.heightMm': 8.0,
    'body.weightG': 11,
    'body.material': '抛光不锈钢盘面 | 白色塑料外壳',
    'body.colors': ['白色'],
    'chipset.name': 'Apple U1 芯片',
    'connectivity.bluetooth': '蓝牙 5.0',
    'connectivity.uwb': '精确查找 (Precision Finding)',
    'features.speaker': '内置扬声器',
    'features.batteryType': '可更换的 CR2032 纽扣电池',
    'features.waterResistance': 'IP67 (IEC 60529，最深 1 米水下 30 分钟)',
  },
});

/* ── phone：iPod touch 第 1–7 代（无蜂窝，fiveG/sim 全 null）── */

pad({
  id: 'apple-ipod-touch-7',
  name: 'iPod touch (第 7 代)',
  date: '2019-05-28',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 123.4,
    'body.widthMm': 58.6,
    'body.thicknessMm': 6.1,
    'body.weightG': 88,
    'body.colors': ['银色', '深空灰色', '金色', '粉红色', '蓝色', '红色 (特别版)'],
    'body.ipRating': null,
    'display.sizeIn': 4,
    'display.type': 'Retina 显示屏',
    'display.resolutionPx': res(1136, 640),
    'display.ppi': 326,
    'chipset.name': 'A10 Fusion 芯片',
    'chipset.cpuCores': 4,
    'chipset.gpu': '6 核图形处理器',
    'chipset.npu': null,
    'chipset.processNm': 16,
    'memory.storageGb': GB([32, 128, 256]),
    'battery.vendorClaimedVideoHours': 8,
    'battery.vendorClaimedAudioHours': 40,
    'camera.rear': [rearTouch(8, 'f/2.4')],
    'camera.front': { mp: 1.2, aperture: 'f/2.2' },
    'camera.videoMax': '1080p 30 fps',
    'audio.speakers': '内置扬声器',
    'connectivity.fiveG': null,
    'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网',
    'connectivity.bluetooth': '蓝牙 4.1',
    'connectivity.usb': 'Lightning 接口',
    'connectivity.sim': null,
    'os.launch': 'iOS 12',
  },
});

pad({
  id: 'apple-ipod-touch-6',
  name: 'iPod touch (第 6 代)',
  date: '2015-07-15',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 123.4,
    'body.widthMm': 58.6,
    'body.thicknessMm': 6.1,
    'body.weightG': 88,
    'body.colors': ['银色', '深空灰色', '金色', '粉红色', '蓝色', '红色 (特别版)'],
    'display.sizeIn': 4,
    'display.type': 'Retina 显示屏',
    'display.resolutionPx': res(1136, 640),
    'display.ppi': 326,
    'chipset.name': 'A8 芯片',
    'chipset.cpuCores': 2,
    'chipset.gpu': '4 核图形处理器',
    'memory.storageGb': GB([16, 32, 64, 128]),
    'battery.vendorClaimedVideoHours': 8,
    'battery.vendorClaimedAudioHours': 40,
    'camera.rear': [rearTouch(8, 'f/2.4')],
    'camera.front': { mp: 1.2, aperture: 'f/2.2' },
    'camera.videoMax': '1080p 30 fps',
    'audio.speakers': '内置扬声器',
    'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网',
    'connectivity.bluetooth': '蓝牙 4.1',
    'connectivity.usb': 'Lightning 接口',
    'os.launch': 'iOS 8',
  },
});

pad({
  id: 'apple-ipod-touch-5',
  name: 'iPod touch (第 5 代)',
  date: '2012-09-12',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 123.4,
    'body.widthMm': 58.6,
    'body.thicknessMm': 6.1,
    'body.weightG': 88,
    'body.colors': ['银色', '黑色', '粉色', '黄色', '蓝色', '红色 (特别版)'],
    'display.sizeIn': 4,
    'display.type': 'Retina 显示屏',
    'display.resolutionPx': res(1136, 640),
    'display.ppi': 326,
    'chipset.name': 'A5 芯片',
    'chipset.cpuCores': 2,
    'memory.storageGb': GB([16, 32, 64]),
    'battery.vendorClaimedVideoHours': 8,
    'battery.vendorClaimedAudioHours': 40,
    'camera.rear': [rearTouch(5, 'f/2.4')],
    'camera.front': { mp: 1.2, aperture: 'f/2.4' },
    'camera.videoMax': '1080p 30 fps',
    'audio.speakers': '内置扬声器',
    'connectivity.wifi': '802.11a/b/g/n 无线局域网',
    'connectivity.bluetooth': '蓝牙 4.0',
    'connectivity.usb': 'Lightning 接口',
    'os.launch': 'iOS 6',
  },
});

pad({
  id: 'apple-ipod-touch-4',
  name: 'iPod touch (第 4 代)',
  date: '2010-09-01',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 111,
    'body.widthMm': 58.9,
    'body.thicknessMm': 7.2,
    'body.weightG': 101,
    'body.colors': ['黑色', '白色'],
    'display.sizeIn': 3.5,
    'display.type': 'Retina 显示屏',
    'display.resolutionPx': res(960, 640),
    'display.ppi': 326,
    'chipset.name': 'A4 芯片',
    'chipset.cpuCores': 1,
    'memory.storageGb': GB([8, 16, 32, 64]),
    'battery.vendorClaimedVideoHours': 7,
    'battery.vendorClaimedAudioHours': 40,
    'camera.rear': [rearTouch(0.7, 'f/2.8')],
    'camera.front': { mp: 0.3, aperture: null },
    'camera.videoMax': '720p 30 fps',
    'audio.speakers': '内置扬声器',
    'connectivity.wifi': '802.11b/g/n 无线局域网',
    'connectivity.bluetooth': '蓝牙 2.1',
    'connectivity.usb': '30 针接口',
    'os.launch': 'iOS 4',
  },
});

pad({
  id: 'apple-ipod-touch-3',
  name: 'iPod touch (第 3 代)',
  date: '2009-09-09',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 110,
    'body.widthMm': 61.8,
    'body.thicknessMm': 8.5,
    'body.weightG': 115,
    'body.colors': ['黑色', '银色'],
    'display.sizeIn': 3.5,
    'display.type': '宽屏 Multi-Touch 显示屏',
    'display.resolutionPx': res(480, 320),
    'display.ppi': 163,
    'chipset.name': 'Samsung S5L8922 芯片',
    'memory.storageGb': GB([32, 64]),
    'battery.vendorClaimedVideoHours': 6,
    'battery.vendorClaimedAudioHours': 30,
    'camera.rear': null,
    'camera.front': null,
    'audio.speakers': '内置扬声器',
    'connectivity.wifi': '802.11b/g 无线局域网',
    'connectivity.bluetooth': '蓝牙 2.1',
    'connectivity.usb': '30 针接口',
    'os.launch': 'iPhone OS 3',
  },
});

pad({
  id: 'apple-ipod-touch-2',
  name: 'iPod touch (第 2 代)',
  date: '2008-09-09',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 110,
    'body.widthMm': 61.8,
    'body.thicknessMm': 8.5,
    'body.weightG': 115,
    'body.colors': ['黑色', '银色'],
    'display.sizeIn': 3.5,
    'display.type': '宽屏 Multi-Touch 显示屏',
    'display.resolutionPx': res(480, 320),
    'display.ppi': 163,
    'chipset.name': 'Samsung S5L8720 芯片',
    'memory.storageGb': GB([8, 16, 32]),
    'battery.vendorClaimedVideoHours': 6,
    'battery.vendorClaimedAudioHours': 36,
    'camera.rear': null,
    'camera.front': null,
    'audio.speakers': '内置扬声器',
    'connectivity.wifi': '802.11b/g 无线局域网',
    'connectivity.bluetooth': '蓝牙 2.1',
    'connectivity.usb': '30 针接口',
    'os.launch': 'iPhone OS 2',
  },
});

pad({
  id: 'apple-ipod-touch-1',
  name: 'iPod touch',
  date: '2007-09-05',
  category: 'phone',
  line: 'iPod touch',
  specs: {
    'body.heightMm': 110,
    'body.widthMm': 61.8,
    'body.thicknessMm': 8,
    'body.weightG': 120,
    'body.colors': ['黑色', '银色'],
    'display.sizeIn': 3.5,
    'display.type': '宽屏 Multi-Touch 显示屏',
    'display.resolutionPx': res(480, 320),
    'display.ppi': 163,
    'chipset.name': 'Samsung S5L8900 芯片',
    'memory.storageGb': GB([8, 16, 32]),
    'battery.vendorClaimedVideoHours': 5,
    'battery.vendorClaimedAudioHours': 22,
    'camera.rear': null,
    'camera.front': null,
    'audio.speakers': null,
    'connectivity.wifi': '802.11b/g 无线局域网',
    'connectivity.bluetooth': null,
    'connectivity.usb': '30 针接口',
    'os.launch': 'iPhone OS',
  },
});

/* ── media：iPod 主线（机械滚轮 → 触控转轮 → 点按转轮 → 视频机 → classic 终版）── */

pad({
  id: 'apple-ipod-1',
  name: 'iPod (第 1 代)',
  date: '2001-10-23',
  category: 'media',
  line: 'iPod',
  specs: {
    'body.heightMm': 104,
    'body.widthMm': 62,
    'body.depthMm': 20,
    'body.weightG': 184,
    'body.colors': ['白色'],
    'display.sizeIn': 2,
    'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': res(160, 128),
    'memory.storageGb': GB([5, 10]),
    'battery.vendorClaimedHours': 10,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-2',
  name: 'iPod (第 2 代)',
  date: '2002-07-17',
  category: 'media',
  line: 'iPod',
  specs: {
    'body.heightMm': 104,
    'body.widthMm': 62,
    'body.depthMm': 20,
    'body.weightG': 179,
    'body.colors': ['白色'],
    'display.sizeIn': 2,
    'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': res(160, 128),
    'memory.storageGb': GB([10, 20]),
    'battery.vendorClaimedHours': 10,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-3',
  name: 'iPod (第 3 代)',
  date: '2003-04-28',
  category: 'media',
  line: 'iPod',
  specs: {
    'body.heightMm': 102,
    'body.widthMm': 61,
    'body.depthMm': 16,
    'body.weightG': 158,
    'body.colors': ['白色'],
    'display.sizeIn': 2,
    'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': res(160, 128),
    'memory.storageGb': GB([10, 15, 30, 40]),
    'battery.vendorClaimedHours': 8,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-4',
  name: 'iPod (第 4 代)',
  date: '2004-07-19',
  category: 'media',
  line: 'iPod',
  specs: {
    'body.heightMm': 105,
    'body.widthMm': 61,
    'body.depthMm': 15,
    'body.weightG': 146,
    'body.colors': ['白色'],
    'display.sizeIn': 2,
    'display.type': '单色液晶显示屏 (灰度，带 LED 背光)',
    'display.resolutionPx': res(160, 128),
    'memory.storageGb': GB([20, 40]),
    'battery.vendorClaimedHours': 12,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-5-video',
  name: 'iPod (第 5 代)',
  date: '2005-10-12',
  category: 'media',
  line: 'iPod',
  specs: {
    'body.heightMm': 103.5,
    'body.widthMm': 61.8,
    'body.depthMm': 11,
    'body.weightG': 136,
    'body.colors': ['白色', '黑色'],
    'display.sizeIn': 2.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'memory.storageGb': GB([30, 60]),
    'battery.vendorClaimedHours': 14,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-classic-2007',
  name: 'iPod classic',
  date: '2007-09-05',
  category: 'media',
  line: 'iPod classic',
  specs: {
    'body.heightMm': 103.5,
    'body.widthMm': 61.8,
    'body.depthMm': 10.5,
    'body.weightG': 140,
    'body.colors': ['银色', '黑色'],
    'display.sizeIn': 2.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'display.ppi': 163,
    'memory.storageGb': GB([80, 160]),
    'battery.vendorClaimedHours': 30,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-classic-2008',
  name: 'iPod classic (120GB)',
  date: '2008-09-09',
  category: 'media',
  line: 'iPod classic',
  specs: {
    'body.heightMm': 103.5,
    'body.widthMm': 61.8,
    'body.depthMm': 10.5,
    'body.weightG': 140,
    'body.colors': ['银色', '黑色'],
    'display.sizeIn': 2.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'display.ppi': 163,
    'memory.storageGb': GB([120]),
    'battery.vendorClaimedHours': 36,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-classic-2009',
  name: 'iPod classic (160GB，2009 年末)',
  date: '2009-09-09',
  category: 'media',
  line: 'iPod classic',
  specs: {
    'body.heightMm': 103.5,
    'body.widthMm': 61.8,
    'body.depthMm': 10.5,
    'body.weightG': 140,
    'body.colors': ['银色', '黑色'],
    'display.sizeIn': 2.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'display.ppi': 163,
    'memory.storageGb': GB([160]),
    'battery.vendorClaimedHours': 36,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

/* ── media：iPod mini ── */

pad({
  id: 'apple-ipod-mini-1',
  name: 'iPod mini',
  date: '2004-01-06',
  category: 'media',
  line: 'iPod mini',
  specs: {
    'body.heightMm': 91,
    'body.widthMm': 51,
    'body.depthMm': 13,
    'body.weightG': 103,
    'body.colors': ['银色', '金色', '蓝色', '粉色', '绿色'],
    'display.sizeIn': 1.67,
    'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': res(138, 110),
    'memory.storageGb': GB([4]),
    'battery.vendorClaimedHours': 8,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-mini-2',
  name: 'iPod mini (第 2 代)',
  date: '2005-02-23',
  category: 'media',
  line: 'iPod mini',
  specs: {
    'body.heightMm': 91,
    'body.widthMm': 51,
    'body.depthMm': 13,
    'body.weightG': 103,
    'body.colors': ['银色', '蓝色', '粉色', '绿色'],
    'display.sizeIn': 1.67,
    'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': res(138, 110),
    'memory.storageGb': GB([4, 6]),
    'battery.vendorClaimedHours': 18,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

/* ── media：iPod nano 第 1–7 代 ── */

pad({
  id: 'apple-ipod-nano-1',
  name: 'iPod nano (第 1 代)',
  date: '2005-09-07',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 88.9,
    'body.widthMm': 40.6,
    'body.depthMm': 6.9,
    'body.weightG': 42.5,
    'body.colors': ['白色', '黑色'],
    'display.sizeIn': 1.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(176, 132),
    'memory.storageGb': GB([1, 2, 4]),
    'battery.vendorClaimedHours': 14,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-2',
  name: 'iPod nano (第 2 代)',
  date: '2006-09-12',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 88.9,
    'body.widthMm': 40.6,
    'body.depthMm': 6.6,
    'body.weightG': 40,
    'body.colors': ['银色', '绿色', '蓝色', '粉红色', '黑色', '红色 (特别版)'],
    'display.sizeIn': 1.5,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(176, 132),
    'memory.storageGb': GB([2, 4, 8]),
    'battery.vendorClaimedHours': 24,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-3',
  name: 'iPod nano (第 3 代)',
  date: '2007-09-05',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 69.8,
    'body.widthMm': 52.3,
    'body.depthMm': 6.5,
    'body.weightG': 49.2,
    'body.colors': ['银色', '蓝色', '绿色', '黑色', '粉红色', '红色 (特别版)'],
    'display.sizeIn': 2,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'display.ppi': 204,
    'memory.storageGb': GB([4, 8]),
    'battery.vendorClaimedHours': 24,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-4',
  name: 'iPod nano (第 4 代)',
  date: '2008-09-09',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 90.7,
    'body.widthMm': 38.7,
    'body.depthMm': 6.2,
    'body.weightG': 36.8,
    'body.colors': ['银色', '紫色', '蓝色', '绿色', '黄色', '橙色', '粉红色', '黑色', '红色 (特别版)'],
    'display.sizeIn': 2,
    'display.type': '彩色 LCD (带 LED 背光)',
    'display.resolutionPx': res(320, 240),
    'display.ppi': 204,
    'memory.storageGb': GB([8, 16]),
    'battery.vendorClaimedHours': 24,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-5',
  name: 'iPod nano (第 5 代)',
  date: '2009-09-09',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 90.7,
    'body.widthMm': 38.7,
    'body.depthMm': 6.2,
    'body.weightG': 36.4,
    'body.colors': ['银色', '黑色', '紫色', '蓝色', '绿色', '黄色', '橙色', '粉红色', '红色 (特别版)'],
    'display.sizeIn': 2.2,
    'display.type': '彩色 TFT 显示屏',
    'display.resolutionPx': res(376, 240),
    'display.ppi': 204,
    'memory.storageGb': GB([8, 16]),
    'battery.vendorClaimedHours': 24,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-6',
  name: 'iPod nano (第 6 代)',
  date: '2010-09-01',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 37.5,
    'body.widthMm': 40.9,
    'body.depthMm': 8.78,
    'body.weightG': 21.1,
    'body.colors': ['银色', '石墨色', '蓝色', '绿色', '橙色', '粉红色', '红色 (特别版)'],
    'display.sizeIn': 1.54,
    'display.type': '彩色 TFT Multi-Touch 显示屏',
    'display.resolutionPx': res(240, 240),
    'display.ppi': 220,
    'memory.storageGb': GB([8, 16]),
    'battery.vendorClaimedHours': 24,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-nano-7',
  name: 'iPod nano (第 7 代)',
  date: '2012-09-12',
  category: 'media',
  line: 'iPod nano',
  specs: {
    'body.heightMm': 76.5,
    'body.widthMm': 39.6,
    'body.depthMm': 5.4,
    'body.weightG': 31,
    'body.colors': ['银色', '深空灰色', '金色', '粉红色', '蓝色', '紫色', '黄色', '绿色', '红色 (特别版)'],
    'display.sizeIn': 2.5,
    'display.type': '宽屏 Multi-Touch 显示屏',
    'display.resolutionPx': res(432, 240),
    'display.ppi': 202,
    'memory.storageGb': GB([16]),
    'battery.vendorClaimedHours': 30,
    'connectivity.bluetooth': '蓝牙 4.0',
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

/* ── media：iPod shuffle 第 1–4 代（无屏：display 字段 null）── */

pad({
  id: 'apple-ipod-shuffle-1',
  name: 'iPod shuffle (第 1 代)',
  date: '2005-01-11',
  category: 'media',
  line: 'iPod shuffle',
  specs: {
    'body.heightMm': 84,
    'body.widthMm': 25,
    'body.depthMm': 8.4,
    'body.weightG': 22,
    'body.colors': ['白色'],
    'display.sizeIn': null,
    'display.type': null,
    'memory.storageGb': GB([0.5, 1]),
    'battery.vendorClaimedHours': 12,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-shuffle-2',
  name: 'iPod shuffle (第 2 代)',
  date: '2006-09-12',
  category: 'media',
  line: 'iPod shuffle',
  specs: {
    'body.heightMm': 27.3,
    'body.widthMm': 41.2,
    'body.depthMm': 10.5,
    'body.weightG': 15.5,
    'body.colors': ['银色', '粉红色', '绿色', '蓝色', '橙色', '紫色', '红色 (特别版)'],
    'display.sizeIn': null,
    'display.type': null,
    'memory.storageGb': GB([1, 2]),
    'battery.vendorClaimedHours': 12,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-shuffle-3',
  name: 'iPod shuffle (第 3 代)',
  date: '2009-03-11',
  category: 'media',
  line: 'iPod shuffle',
  specs: {
    'body.heightMm': 45.2,
    'body.widthMm': 17.5,
    'body.depthMm': 7.8,
    'body.weightG': 10.7,
    'body.colors': ['银色', '黑色', '粉红色', '蓝色', '绿色'],
    'display.sizeIn': null,
    'display.type': null,
    'memory.storageGb': GB([2, 4]),
    'battery.vendorClaimedHours': 10,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

pad({
  id: 'apple-ipod-shuffle-4',
  name: 'iPod shuffle (第 4 代)',
  date: '2010-09-01',
  category: 'media',
  line: 'iPod shuffle',
  specs: {
    'body.heightMm': 29,
    'body.widthMm': 31.6,
    'body.depthMm': 8.7,
    'body.weightG': 12.5,
    'body.colors': ['银色', '金色', '深空灰色', '粉红色', '蓝色', '紫色', '黄色', '绿色', '橙色', '石板色', '红色 (特别版)'],
    'display.sizeIn': null,
    'display.type': null,
    'memory.storageGb': GB([2]),
    'battery.vendorClaimedHours': 15,
    'connectivity.bluetooth': null,
    'connectivity.wifi': null,
    'os.launch': null,
  },
});

store.entries = [...kept, ...entries];
store.updatedAt = D;
writeFileSync(OVERRIDES, JSON.stringify(store, null, 2) + '\n', 'utf8');
console.log(`已写入 ${entries.length} 条 add-product → data/overrides.json（共 ${store.entries.length} 条）`);
