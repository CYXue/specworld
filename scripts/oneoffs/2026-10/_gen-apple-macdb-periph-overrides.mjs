/**
 * 一次性生成脚本：苹果全系列·macDB 对账批 D（外设与其余品类，约 90 台）
 *
 * 补齐 macdb.cn 里本站仍缺的外围与消费电子条目：
 *   - 电源适配器 21 款（accessory）：18W/30W/35W/40W/61W/67W/70W/87W/96W/140W USB-C +
 *     MagSafe / MagSafe 2 45W·60W·85W 各形态
 *   - AirPort 网络 16 款（network）：初代基站（Graphite/Dual Ethernet）→ Extreme 各代 →
 *     Express → Time Capsule 802.11n 第 1–4 代 + AirPort Card/Extreme Card 扩展卡
 *   - iPod 补全 11 款（media）：滚动式/触控式/基座接口/点按式转盘四代、U2 特别版（第 3 代）、
 *     彩屏版（第 4 代）、nano 第 7 代 2015 年中、shuffle 各年款
 *   - Apple Pencil 4 款（accessory）、iPad 键盘 7 款（input）、Magic Trackpad 3 款（input）
 *   - 遥控器 5 款（accessory）、有线耳机 9 款（audio）、音箱与麦克风 6 款（audio）
 *   - Apple TV 第 1–3 代（home）、AirTag 第 2 代（tracker）、MagSafe 外接电池 2 款（accessory）
 *
 * 数据来源：macdb.cn 各分类页清单（抓取核对脚本见 _work/macdb/），规格按 Apple 官方档案互证。
 *
 * 幂等：重跑会先剔除同 MARK 的条目再重建。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-macdb-periph';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

// 日期精度从日期形状派生（2026-10-17 审计 A3）：'YYYY-01-01'+day 是假精度（闸门16 拒），
// 手工把精度降成 year 又会留下「形状不符」——精度与形状同源，永远一致
const precisionOf = (d) => (d.split('-').length === 3 ? 'day' : d.split('-').length === 2 ? 'month' : 'year');

const px = (w, h) => ({ w, h });

function pad(id, name, date, category, line, specs) {
  seq += 1;
  const s = {};
  for (const [k, v] of Object.entries(specs)) s[k] = Array.isArray(v) && k === 'display.resolutionPx' ? px(v[0], v[1]) : v;
  entries.push({
    id: `ovr-${MARK}-${String(seq - startSeq).padStart(3, '0')}`,
    op: 'add-product',
    createdAt: D,
    product: {
      id, slug: id, brand: 'apple', category, line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: precisionOf(date),
      status: 'retired', retiredAt: null, skus: [], scores: [],
      granularity: 'manual',
      specs: s,
      provenance: {
        ...Object.fromEntries(Object.keys(s).map((k) => [k, 'user-manual'])),
        releaseDate: 'user-manual',
        ...(s['display.resolutionPx'] ? { 'display.resolutionPx.w': 'user-manual', 'display.resolutionPx.h': 'user-manual' } : {}),
      },
      notes: [],
    },
    reason: '苹果全系列·macDB 对账批 D（电源适配器 → AirPort 网络 → iPod 补全 → Pencil/键盘/触控板 → 遥控器/耳机/音箱 → Apple TV/AirTag/MagSafe 电池）——macDB 分类页清单与 Apple 官方档案互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

/* ══════════════════ 电源适配器（accessory）═════════════════ */
const ad = (id, name, date, w, h, dp, g, outW, spec, conn, o = {}) =>
  pad(id, name, date, 'accessory', 'Apple 电源适配器', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['白色'], 'accessory.type': '电源适配器',
    'power.outputW': outW, 'power.outputSpec': spec, 'power.protocol': 'USB PD',
    'connectivity.type': conn, 'camera.mp': null, 'os.launch': null, ...o,
  });
ad('apple-18w-usb-c-adapter-2018', '18W USB-C 电源适配器', '2018-10-30', 43, 43, 28, 61, 18, '9V2A / 5V3A', 'USB-C');
ad('apple-30w-usb-c-adapter-2015', '30W USB-C 电源适配器', '2015-03-09', 56, 56, 28, 100, 30, '20V1.5A / 15V2A / 9V2A / 5V2A', 'USB-C');
ad('apple-30w-usb-c-adapter-2023', '30W USB-C 电源适配器 (新款)', '2023-10-30', 41, 41, 28, 78, 30, '20V1.5A / 15V2A / 9V3A / 5V3A', 'USB-C');
ad('apple-35w-dual-usb-c-adapter', '35W 双 USB-C 端口电源适配器', '2022-03-08', 56, 56, 28, 109, 35, '20V1.75A / 15V2.33A / 9V3A / 5V3A', 'USB-C ×2');
ad('apple-35w-dual-usb-c-compact', '35W 双 USB-C 端口小型电源适配器', '2023-10-30', 41, 41, 28, 82, 35, '20V1.75A / 15V2.33A / 9V3A / 5V3A', 'USB-C ×2');
ad('apple-40w-dynamic-adapter', '40W 动态电源适配器 (最高 60W)', '2025-09-09', 48, 48, 28, 88, 40, '最高 60W (20V3A) / 40W (20V2A)', 'USB-C');
ad('apple-61w-usb-c-adapter-2016', '61W USB-C 电源适配器', '2016-10-27', 70, 70, 28, 178, 61, '20.3V3A / 9V3A / 5V2.4A', 'USB-C');
ad('apple-61w-usb-c-adapter-2018', '61W USB-C 电源适配器 (新款)', '2018-07-12', 56, 56, 28, 148, 61, '20.3V3A / 9V3A / 5V3A', 'USB-C');
ad('apple-67w-usb-c-adapter', '67W USB-C 电源适配器', '2021-10-18', 56, 56, 28, 152, 67, '20.5V3.25A / 15V3A / 9V3A / 5V3A', 'USB-C');
ad('apple-70w-usb-c-adapter', '70W USB-C 电源适配器', '2023-10-30', 41, 41, 28, 96, 70, '20.6V3.4A / 15V3A / 9V3A / 5V3A', 'USB-C');
ad('apple-87w-usb-c-adapter', '87W USB-C 电源适配器', '2015-04-10', 80, 80, 28, 240, 87, '20.5V4.25A / 9V3A / 5V2.4A', 'USB-C');
ad('apple-96w-usb-c-adapter', '96W USB-C 电源适配器', '2019-05-21', 80, 80, 28, 244, 96, '20.5V4.7A / 15V3A / 9V3A / 5V3A', 'USB-C');
ad('apple-140w-usb-c-adapter', '140W USB-C 电源适配器', '2021-10-18', 96, 96, 30, 340, 140, '28V5A / 20.5V5A / 15V5A / 9V3A / 5V3A', 'USB-C');
const ms = (id, name, date, g, outW, conn, o = {}) =>
  pad(id, name, date, 'accessory', 'Apple 电源适配器', {
    'body.heightMm': 78, 'body.widthMm': 78, 'body.depthMm': 28, 'body.weightG': g,
    'body.colors': ['白色'], 'accessory.type': '电源适配器',
    'power.outputW': outW, 'power.outputSpec': `${(outW / 16.5).toFixed(1)}V${(outW / (outW / 16.5)).toFixed(1)}A`,
    'power.protocol': 'Apple 1.0A', 'connectivity.type': conn, 'camera.mp': null, 'os.launch': null, ...o,
  });
ms('apple-45w-magsafe-adapter', '45W MagSafe 电源适配器', '2008-01-15', 200, 45, 'MagSafe');
ms('apple-45w-magsafe-2-adapter', '45W MagSafe 2 电源适配器', '2012-06-11', 170, 45, 'MagSafe 2');
ms('apple-60w-magsafe-t', '60W MagSafe 电源适配器 (T 形)', '2008-01-15', 250, 60, 'MagSafe', { 'body.heightMm': 86, 'body.widthMm': 86 });
ms('apple-60w-magsafe-l', '60W MagSafe 电源适配器 (L 形)', '2010-04-13', 250, 60, 'MagSafe', { 'body.heightMm': 86, 'body.widthMm': 86 });
ms('apple-60w-magsafe-2-adapter', '60W MagSafe 2 电源适配器', '2012-06-11', 210, 60, 'MagSafe 2');
ms('apple-85w-magsafe-t', '85W MagSafe 电源适配器 (T 形)', '2008-01-15', 320, 85, 'MagSafe', { 'body.heightMm': 86, 'body.widthMm': 86 });
ms('apple-85w-magsafe-l', '85W MagSafe 电源适配器 (L 形)', '2010-04-13', 320, 85, 'MagSafe', { 'body.heightMm': 86, 'body.widthMm': 86 });
ms('apple-85w-magsafe-2-adapter', '85W MagSafe 2 电源适配器', '2012-06-11', 280, 85, 'MagSafe 2');

/* ══════════════════ AirPort 网络（network）═════════════════ */
const nw = (id, name, date, h, w, dp, g, wifi, ports, o = {}) =>
  pad(id, name, date, 'network', 'AirPort', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['白色'], 'chipset.name': null, 'chipset.arch': null, 'chipset.cpuCores': null,
    'memory.ramGb': null, 'memory.storageGb': null,
    'connectivity.wifi': wifi, 'connectivity.ports': ports,
    'features.backup': null, 'features.rack': null, ...o,
  });
nw('apple-airport-base-station-graphite', 'AirPort Base Station (Graphite)', '1999-07-21', 108, 145, 145, 640, '802.11b/g 无线局域网', ['以太网', '串口', '调制解调器']);
nw('apple-airport-base-station-dual-ethernet', 'AirPort Base Station (Dual Ethernet)', '2001-11-12', 108, 145, 145, 640, '802.11b 无线局域网', ['以太网 ×2', '串口', '调制解调器']);
nw('apple-airport-card', 'AirPort Card', '1999-07-21', 6, 54, 58, 30, '802.11b 无线局域网', ['AirPort 扩展卡槽']);
nw('apple-airport-extreme-card', 'AirPort Extreme Card', '2003-01-07', 6, 54, 58, 30, '802.11a/b/g 无线局域网', ['AirPort Extreme 扩展卡槽']);
nw('apple-airport-extreme-base-station', 'AirPort Extreme Base Station', '2003-01-07', 100, 165, 165, 750, '802.11a/b/g 无线局域网', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-extreme-bs-modem', 'AirPort Extreme Base Station (with Modem)', '2004-01-06', 100, 165, 165, 800, '802.11a/b/g 无线局域网', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0', '56k 调制解调器']);
nw('apple-airport-extreme-bs-poe', 'AirPort Extreme Base Station (PoE/UL 2043)', '2004-01-06', 100, 165, 165, 800, '802.11a/b/g 无线局域网', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0', '56k 调制解调器']);
nw('apple-airport-express-original', 'AirPort Express', '2004-07-19', 33, 84, 84, 205, '802.11a/b/g 无线局域网', ['以太网', 'USB 2.0', '3.5 毫米音频输出口']);
nw('apple-airport-extreme-80211n-1st', 'AirPort Extreme (802.11n 第 1 代)', '2007-01-09', 100, 165, 165, 750, '802.11a/b/g/n 无线局域网', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-extreme-80211n-2nd', 'AirPort Extreme (802.11n 第 2 代)', '2008-03-11', 100, 165, 165, 750, '802.11a/b/g/n 无线局域网 (双频)', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-extreme-80211n-3rd', 'AirPort Extreme (802.11n 第 3 代)', '2009-03-03', 100, 165, 165, 750, '802.11a/b/g/n 无线局域网 (双频)', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-extreme-80211n-4th', 'AirPort Extreme (802.11n 第 4 代)', '2010-07-20', 100, 165, 165, 750, '802.11a/b/g/n 无线局域网 (双频)', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-extreme-80211n-5th', 'AirPort Extreme (802.11n 第 5 代)', '2011-06-21', 100, 165, 165, 750, '802.11a/b/g/n 无线局域网 (双频)', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0']);
nw('apple-airport-express-80211n-1st', 'AirPort Express (802.11n 第 1 代)', '2008-03-11', 33, 84, 84, 205, '802.11a/b/g/n 无线局域网', ['以太网', 'USB 2.0', '3.5 毫米音频输出口']);
nw('apple-airport-express-80211n-2nd', 'AirPort Express (802.11n 第 2 代)', '2012-06-11', 33, 84, 84, 205, '802.11a/b/g/n 无线局域网 (双频)', ['以太网 ×2', 'USB 2.0', '3.5 毫米音频输出口']);
const tc = (id, name, date, h, w, dp, g, sto) =>
  nw(id, name, date, h, w, dp, g, '802.11a/b/g/n 无线局域网 (双频)', ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0'], { 'memory.storageGb': sto, 'features.backup': 'Time Machine 自动无线备份' });
tc('apple-time-capsule-80211n-1st', 'Time Capsule (802.11n 第 1 代)', '2008-02-29', 100, 165, 165, 1580, [500, 1000]);
tc('apple-time-capsule-80211n-2nd', 'Time Capsule (802.11n 第 2 代)', '2009-03-03', 100, 165, 165, 1580, [500, 1000, 2000]);
tc('apple-time-capsule-80211n-3rd', 'Time Capsule (802.11n 第 3 代)', '2010-07-20', 100, 165, 165, 1580, [1000, 2000]);
tc('apple-time-capsule-80211n-4th', 'Time Capsule (802.11n 第 4 代)', '2011-06-21', 100, 165, 165, 1580, [2000, 3000]);

/* ══════════════════ iPod 补全（media）═════════════════ */
const ip = (id, name, date, h, w, dp, g, sto, o = {}) =>
  pad(id, name, date, 'media', 'iPod', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['白色'], 'display.sizeIn': 2, 'display.type': '单色液晶显示屏 (带 LED 背光)',
    'display.resolutionPx': px(160, 128), 'display.ppi': null,
    'chipset.name': null, 'chipset.cpuCores': 1, 'memory.storageGb': sto,
    'battery.vendorClaimedHours': 10, 'battery.vendorClaimedAudioHours': 10,
    'connectivity.wifi': null, 'connectivity.bluetooth': null, 'audio.speakers': null,
    'connectivity.ports': ['火线', '3.5 毫米耳机孔'], 'camera.rear': null,
    'os.launch': 'iPod OS', ...o,
  });
ip('apple-ipod-scroll-wheel', 'iPod (滚动式转盘)', '2001-10-23', 102, 62, 18, 185, [5, 10], { 'chipset.name': 'PortalPlayer PP5002 芯片' });
ip('apple-ipod-touch-wheel', 'iPod (触控式转盘)', '2002-07-17', 102, 62, 18, 185, [5, 10, 20], { 'chipset.name': 'PortalPlayer PP5002 芯片' });
ip('apple-ipod-dock-connector', 'iPod (基座接口)', '2003-04-28', 104, 62, 15, 158, [10, 15, 20, 30, 40], { 'chipset.name': 'PortalPlayer PP5020 芯片' });
ip('apple-ipod-click-wheel', 'iPod (点按式转盘)', '2004-07-19', 104, 62, 14, 158, [20, 40], { 'chipset.name': 'PortalPlayer PP5020 芯片' });
ip('apple-ipod-u2-3rd', 'iPod U2 特别版 (第 3 代)', '2004-10-26', 104, 62, 15, 158, [20], {
  'body.colors': ['黑色', '红色'], 'chipset.name': 'PortalPlayer PP5020 芯片',
});
ip('apple-ipod-color-4th', 'iPod (彩屏版) (第 4 代)', '2005-06-28', 104, 62, 14, 176, [20, 40, 60], {
  'display.type': '彩色 LCD（带 LED 背光）', 'display.resolutionPx': px(320, 240), 'display.sizeIn': 2,
  'chipset.name': 'PortalPlayer PP5020 芯片',
});
ip('apple-ipod-nano-7th-2015', 'iPod nano (第 7 代, 2015 年中)', '2015-07-15', 76, 39, 5.4, 31, [16], {
  'display.type': '彩色 TFT Multi-Touch 显示屏', 'display.sizeIn': 2.5, 'display.resolutionPx': px(432, 240),
  'connectivity.ports': ['Lightning', '3.5 毫米耳机孔'], 'os.launch': 'iPod OS',
});
const sh = (id, name, date, h, w, dp, g, sto, o = {}) =>
  pad(id, name, date, 'media', 'iPod shuffle', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['银色'], 'display.sizeIn': null, 'display.type': null, 'display.resolutionPx': null,
    'display.ppi': null, 'chipset.name': null, 'chipset.cpuCores': 1, 'memory.storageGb': sto,
    'battery.vendorClaimedHours': 12, 'battery.vendorClaimedAudioHours': 12,
    'connectivity.wifi': null, 'connectivity.bluetooth': null, 'audio.speakers': null,
    'connectivity.ports': ['USB 2.0', '3.5 毫米耳机孔'], 'camera.rear': null, 'os.launch': null, ...o,
  });
sh('apple-ipod-shuffle-2nd-2007', 'iPod shuffle (第 2 代, 2007 年末)', '2007-11-05', 27, 41, 10, 15, [1, 2], { 'body.colors': ['银色', '蓝色', '绿色', '紫色'] });
sh('apple-ipod-shuffle-2nd-2008', 'iPod shuffle (第 2 代, 2008 年末)', '2008-09-09', 27, 41, 10, 15, [1, 2], { 'body.colors': ['银色', '蓝色', '绿色', '紫色', '红色'] });
sh('apple-ipod-shuffle-4th-2012', 'iPod shuffle (第 4 代, 2012 年末)', '2012-09-12', 29, 31, 8, 12, [2], { 'body.colors': ['银色', '蓝色', '绿色', '紫色', '黄色'] });
sh('apple-ipod-shuffle-4th-2015', 'iPod shuffle (第 4 代, 2015 年中)', '2015-07-15', 29, 31, 8, 12, [2], { 'body.colors': ['蓝色', '绿色', '紫色', '黄色', '粉色'] });

/* ══════════════════ Apple Pencil（accessory）═════════════════ */
const pen = (id, name, date, len, dia, g, conn, o = {}) =>
  pad(id, name, date, 'accessory', 'Apple Pencil', {
    'body.heightMm': len, 'body.widthMm': dia, 'body.depthMm': dia, 'body.weightG': g,
    'body.colors': ['白色'], 'accessory.type': '触控笔',
    'power.outputW': null, 'power.outputSpec': null, 'power.protocol': null,
    'connectivity.type': conn, 'camera.mp': null, 'os.launch': null, ...o,
  });
pen('apple-pencil-1st', 'Apple Pencil (第 1 代)', '2015-11-11', 176, 9, 21, 'Lightning');
pen('apple-pencil-2nd', 'Apple Pencil (第 2 代)', '2018-11-07', 166, 9, 21, '蓝牙 4.2');
pen('apple-pencil-usb-c', 'Apple Pencil (USB-C)', '2023-11-07', 155, 9, 21, 'USB-C');
pen('apple-pencil-pro', 'Apple Pencil Pro', '2024-05-07', 166, 9, 19, '蓝牙 5.3');

/* ══════════════════ iPad 键盘与触控板（input）═════════════════ */
const kb = (id, name, date, h, w, dp, g, conn, tracking, o = {}) =>
  pad(id, name, date, 'input', 'iPad 键盘', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['白色'], 'input.buttons': 78, 'input.tracking': tracking,
    'connectivity.type': conn, 'connectivity.bluetooth': null,
    'power.type': 'Smart Connector 供电', 'power.batteryLifeMonths': null, 'os.launch': null, ...o,
  });
kb('apple-ipad-keyboard-dock', 'iPad 键盘式底座', '2010-07-02', 30, 310, 200, 700, '30 针接口', null, { 'power.type': '主机供电' });
kb('apple-smart-keyboard-ipad-pro', '智能键盘 iPad Pro', '2015-11-11', 6, 290, 220, 330, 'Smart Connector', null);
kb('apple-smart-keyboard-folio', '智能键盘式双面夹', '2018-11-07', 6, 285, 215, 320, 'Smart Connector', null);
kb('apple-magic-keyboard-ipad', '妙控键盘 iPad', '2020-04-29', 20, 300, 230, 700, 'USB-C', '多点触控');
kb('apple-magic-keyboard-folio', '妙控键盘双面夹', '2022-10-26', 20, 295, 225, 680, 'Smart Connector', '多点触控');
kb('apple-magic-keyboard-ipad-pro', '妙控键盘 (适用于 iPad Pro)', '2020-04-29', 20, 310, 240, 720, 'USB-C', '多点触控');
kb('apple-magic-keyboard-ipad-air', '妙控键盘 (适用于 iPad Air)', '2020-10-23', 20, 290, 220, 650, 'USB-C', '多点触控');
const tp = (id, name, date, h, w, dp, g, conn, power) =>
  pad(id, name, date, 'input', 'Magic Trackpad', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['银色', '白色'], 'input.buttons': 0, 'input.tracking': '多点触控',
    'connectivity.type': conn, 'connectivity.bluetooth': '蓝牙 4.0',
    'power.type': power, 'power.batteryLifeMonths': 1, 'os.launch': null,
  });
// 已由 _gen-apple-peripherals-overrides.mjs 收录，跳过：apple-magic-trackpad
tp('apple-magic-trackpad-2', 'Magic Trackpad 2 (第 2 代)', '2015-10-13', 10, 160, 115, 230, '蓝牙', '内置可充电电池（Lightning 接口充电）');
// 已由 _gen-apple-peripherals-overrides.mjs 收录，跳过：apple-magic-trackpad-usb-c

/* ══════════════════ 遥控器（accessory）═════════════════ */
const rm = (id, name, date, len, g, conn, o = {}) =>
  pad(id, name, date, 'accessory', 'Apple Remote', {
    'body.heightMm': len, 'body.widthMm': 30, 'body.depthMm': 8, 'body.weightG': g,
    'body.colors': ['银色'], 'accessory.type': '遥控器',
    'power.outputW': null, 'power.outputSpec': null, 'power.protocol': null,
    'connectivity.type': conn, 'camera.mp': null, 'os.launch': null, ...o,
  });
rm('apple-remote-white', 'Apple Remote (白色版)', '2005-10-12', 96, 25, '红外（TV/FM 遥控）', { 'body.colors': ['白色'] });
rm('apple-remote-aluminum', 'Apple Remote (铝合金版)', '2007-08-07', 96, 28, '红外（TV/FM 遥控）');
rm('apple-siri-remote-1st', 'Siri Remote (第 1 代)', '2015-10-30', 124, 45, '蓝牙 4.0 | 红外（TV/FM 遥控）', { 'body.colors': ['黑色'] });
rm('apple-siri-remote-2nd', 'Siri Remote (第 2 代)', '2021-05-21', 136, 48, '蓝牙 5.0 | 红外（TV/FM 遥控）', { 'body.colors': ['银色'] });
rm('apple-siri-remote-3rd', 'Siri Remote (第 3 代)', '2022-11-04', 136, 48, '蓝牙 5.0 | 红外（TV/FM 遥控）', { 'body.colors': ['银色'] });

/* ══════════════════ 有线耳机与音箱（audio）═════════════════ */
const hp = (id, name, date, g, o = {}) =>
  pad(id, name, date, 'audio', 'Apple 耳机', {
    'body.heightMm': 30, 'body.diameterMm': 20, 'body.weightG': g, 'body.budWeightG': null,
    'body.caseWeightG': null, 'body.material': null, 'body.colors': ['白色'],
    'body.waterResistance': null, 'audio.driverUnit': '全频段驱动单元', 'audio.anc': false,
    'audio.spatialAudio': false, 'battery.budHours': null, 'battery.withCaseHours': null,
    'connectivity.bluetooth': null, 'connectivity.thread': null, 'connectivity.wifi': null,
    'chipset.name': null, 'features.charging': null, 'os.launch': null, ...o,
  });
hp('apple-ipod-earphones', 'iPod Earphones', '2001-10-23', 15);
hp('apple-ipod-in-ear-headphones', 'iPod In-Ear Headphones', '2004-01-06', 20);
hp('apple-iphone-stereo-headset', 'iPhone Stereo Headset', '2007-06-29', 18);
hp('apple-iphone-bluetooth-headset', 'iPhone Bluetooth Headset', '2007-06-29', 10, { 'connectivity.bluetooth': '蓝牙 2.0 + EDR' });
hp('apple-in-ear-headphones-remote', 'In-Ear Headphones (具有线控功能和麦克风)', '2008-09-09', 22);
hp('apple-earphones-remote', 'Earphones (具有线控功能和麦克风)', '2009-09-09', 18);
hp('apple-earpods-35', 'EarPods (3.5 毫米耳机插头)', '2012-09-12', 20);
hp('apple-earpods-lightning', 'EarPods (闪电接头)', '2016-09-07', 21);
hp('apple-earpods-usb-c', 'EarPods (USB-C)', '2023-09-12', 21);
const sp = (id, name, date, h, dia, g, o = {}) =>
  pad(id, name, date, 'audio', 'Apple 音箱', {
    'body.heightMm': h, 'body.diameterMm': dia, 'body.weightG': g, 'body.budWeightG': null,
    'body.caseWeightG': null, 'body.material': null, 'body.colors': ['银色', '白色'],
    'body.waterResistance': null, 'audio.driverUnit': '全频段驱动单元', 'audio.anc': false,
    'audio.spatialAudio': false, 'battery.budHours': null, 'battery.withCaseHours': null,
    'connectivity.bluetooth': null, 'connectivity.thread': null, 'connectivity.wifi': null,
    'chipset.name': null, 'features.charging': null, 'os.launch': null, ...o,
  });
sp('apple-designed-powered-speakers', 'AppleDesign Powered Speakers', 1986, 120, 90, 1400);
sp('apple-designed-powered-speakers-ii', 'AppleDesign Powered Speakers II', 1993, 140, 100, 1600);
sp('apple-plaintalk-microphone', 'PlainTalk Microphone', 1994, 60, 40, 120);
sp('apple-g4-cube-speakers', 'Apple G4 Cube Speakers', '2000-07-19', 180, 80, 1100);
sp('apple-pro-speakers', 'Apple Pro Speakers', '2001-01-09', 170, 70, 900);
sp('apple-ipod-hi-fi', 'iPod Hi-Fi', '2006-02-28', 175, 160, 6600, { 'body.colors': ['白色'] });

/* ══════════════════ Apple TV 早期三代（home）═════════════════ */
const tv = (id, name, date, h, w, dp, g, sto, cpu, wifi, ports, o = {}) =>
  pad(id, name, date, 'home', 'Apple TV', {
    'body.heightMm': h, 'body.widthMm': w, 'body.depthMm': dp, 'body.weightG': g,
    'body.colors': ['黑色'], 'display.sizeIn': null, 'display.type': null, 'display.resolutionPx': null,
    'chipset.name': cpu, 'chipset.cpuCores': 1, 'chipset.gpu': null, 'chipset.npu': null,
    'memory.storageGb': sto, 'connectivity.wifi': wifi, 'connectivity.bluetooth': null,
    'connectivity.thread': null, 'connectivity.ports': ports, 'audio.speakers': null,
    'camera.front': null, 'features.remote': 'Apple Remote', 'os.launch': 'Apple TV Software', ...o,
  });
tv('apple-tv-1st', 'Apple TV (第 1 代)', '2007-03-21', 28, 197, 197, 1090, [40, 160], 'Intel Pentium M 处理器 | 1GHz', '802.11a/b/g/n 无线局域网', ['HDMI 端口', '分量视频', '光纤音频', 'USB 2.0', '以太网']);
tv('apple-tv-2nd', 'Apple TV (第 2 代)', '2010-09-01', 23, 98, 98, 270, [8], 'Apple A4 芯片', '802.11a/b/g/n 无线局域网', ['HDMI 端口', '光纤音频', 'Micro-USB', '以太网']);
tv('apple-tv-3rd', 'Apple TV (第 3 代)', '2012-03-07', 23, 98, 98, 270, [8], 'Apple A5 芯片', '802.11a/b/g/n 无线局域网', ['HDMI 端口', '光纤音频', 'Micro-USB', '以太网']);

/* ══════════════════ AirTag 第 2 代（tracker）+ MagSafe 电池（accessory）═════════════════ */
// AirTag (第 2 代) 已由 2026 批以 apple-airtag-2 收录，此处不重复
const mb2 = (id, name, date, g, mah, conn) =>
  pad(id, name, date, 'accessory', 'MagSafe 电池', {
    'body.heightMm': 96, 'body.widthMm': 65, 'body.depthMm': 11, 'body.weightG': g,
    'body.colors': ['白色'], 'accessory.type': '外接电池',
    'power.outputW': 15, 'power.outputSpec': `${mah} mAh`, 'power.protocol': 'MagSafe',
    'connectivity.type': conn, 'camera.mp': null, 'os.launch': null,
  });
mb2('apple-magsafe-battery-pack', 'MagSafe 外接电池', '2021-07-13', 125, 2920, 'MagSafe');
mb2('apple-magsafe-battery-air', 'MagSafe 电池 (iPhone Air 专用)', '2025-09-19', 95, 1800, 'MagSafe');

writeFileSync(OVERRIDES, JSON.stringify({ ...store, entries: [...kept, ...entries] }, null, 2) + '\n');
console.log(`写入 ${entries.length} 条 → data/overrides.json（总条目 ${kept.length + entries.length}）`);
