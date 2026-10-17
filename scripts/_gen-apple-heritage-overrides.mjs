/**
 * 一次性生成脚本：苹果全系列·heritage 补缺批（26 台）
 *
 *  - home 4：Apple TV HD（2015）/ 4K（2017）/ 4K（2021）/ 4K（2022）——历代机顶盒
 *  - display 3：Apple Cinema HD Display 30（2004）、LED Cinema Display 27（2009）、
 *               Apple Thunderbolt Display（2011）
 *  - network（新品类首批）6：AirPort Extreme 2009/2013、AirPort Express 2012、
 *               Time Capsule 2013、Xserve 2009、Xserve RAID 2003
 *  - desktop 10（1990s–2000s 家族锚点）：Macintosh 512K/Plus/SE/II/Classic/LC、
 *               Quadra 700、Power Macintosh 8100、Power Macintosh G3 1997、
 *               Power Mac G4 Cube 2000、eMac 2002
 *  - laptop 2：PowerBook 100（1991）、PowerBook G3 Wallstreet（1997）
 *
 * 置信度说明：Apple TV 历代/显示器/网络设备为广为记载的官方口径（部分有 support 档案页）；
 * 1990s Macintosh 为历史锚点（官网规格页不存在，1984–1997 年代），用户已明确接受较低置信度。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-heritage';

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
      id, slug: id, brand: 'apple', category, line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: 'day',
      status: status ?? 'retired', retiredAt: null, skus: [], scores: [],
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
    reason: '苹果全系列·heritage 补缺批（Apple TV 历代/显示器线/网络设备/1990 年代 Macintosh 家族）——官方口径与历史锚点互证录入',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

const res = (w, h) => ({ w, h });
const GB = (a) => a;

/* ── home：Apple TV 历代 ── */

pad({ id: 'apple-tv-4k-2022', name: 'Apple TV 4K (第 3 代)', date: '2022-10-18', category: 'home', line: 'Apple TV', specs: { 'body.heightMm': 31, 'body.widthMm': 93, 'body.depthMm': 93, 'body.weightG': 214, 'chipset.name': 'A15 Bionic 芯片', 'memory.storageGb': GB([64, 128]), 'connectivity.wifi': '802.11ax 无线局域网 (Wi-Fi 6)', 'connectivity.bluetooth': '蓝牙 5.0', 'connectivity.thread': 'Thread 网络技术', 'connectivity.ports': ['HDMI 2.1', '千兆以太网 (128GB 版)', '内置电源'], 'features.remote': 'Siri Remote (第 3 代)', 'os.launch': 'tvOS 16' } });
pad({ id: 'apple-tv-4k-2021', name: 'Apple TV 4K (第 2 代)', date: '2021-04-30', category: 'home', line: 'Apple TV', specs: { 'body.heightMm': 35, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 425, 'chipset.name': 'A12 Bionic 芯片', 'memory.storageGb': GB([32, 64]), 'connectivity.wifi': '802.11ax 无线局域网 (Wi-Fi 6)', 'connectivity.bluetooth': '蓝牙 5.0', 'connectivity.thread': 'Thread 网络技术', 'connectivity.ports': ['HDMI 2.1', '千兆以太网', '内置电源'], 'features.remote': 'Siri Remote (第 2 代)', 'os.launch': 'tvOS 14' } });
pad({ id: 'apple-tv-4k-2017', name: 'Apple TV 4K', date: '2017-09-22', category: 'home', line: 'Apple TV', specs: { 'body.heightMm': 35, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 425, 'chipset.name': 'A10X Fusion 芯片', 'memory.storageGb': GB([32, 64]), 'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网', 'connectivity.bluetooth': '蓝牙 5.0', 'connectivity.thread': null, 'connectivity.ports': ['HDMI 2.0a', '千兆以太网', '内置电源'], 'features.remote': 'Siri Remote', 'os.launch': 'tvOS 11' } });
pad({ id: 'apple-tv-hd-2015', name: 'Apple TV HD', date: '2015-10-26', category: 'home', line: 'Apple TV', specs: { 'body.heightMm': 35, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 425, 'chipset.name': 'A8 芯片', 'memory.storageGb': GB([32, 64]), 'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网', 'connectivity.bluetooth': '蓝牙 4.0', 'connectivity.thread': null, 'connectivity.ports': ['HDMI 1.4', '百兆以太网', '内置电源'], 'features.remote': 'Siri Remote', 'os.launch': 'tvOS 9' } });

/* ── display：Apple 独立显示器历史线 ── */

pad({ id: 'apple-thunderbolt-display-2011', name: 'Apple Thunderbolt Display', date: '2011-07-20', category: 'display', line: 'Apple Display', specs: { 'body.heightMm': 491, 'body.widthMm': 650, 'body.depthMm': 207, 'body.weightG': 10600, 'body.colors': ['银色', '黑色'], 'display.sizeIn': 27, 'display.type': '内置 LED 背光液晶显示屏', 'display.resolutionPx': res(2560, 1440), 'display.ppi': 109, 'display.refreshHz': '60', 'display.brightnessTypicalNits': 375, 'display.colorGamut': 'P3 广色域', 'camera.front': 'FaceTime 摄像头', 'audio.speakers': '内置 49 瓦扬声器系统', 'connectivity.ports': ['雷雳 (MagSafe 供电 85W)', 'FireWire 800', 'USB 2.0 ×3'], 'connectivity.hostCharging': '85W' } });
pad({ id: 'apple-led-cinema-display-2009', name: 'LED Cinema Display', date: '2009-10-20', category: 'display', line: 'Apple Display', specs: { 'body.heightMm': 491, 'body.widthMm': 650, 'body.depthMm': 207, 'body.weightG': 9500, 'body.colors': ['银色', '黑色'], 'display.sizeIn': 27, 'display.type': '内置 LED 背光液晶显示屏', 'display.resolutionPx': res(2560, 1440), 'display.ppi': 109, 'display.refreshHz': '60', 'display.brightnessTypicalNits': 375, 'display.colorGamut': 'P3 广色域', 'camera.front': 'iSight 摄像头', 'audio.speakers': '内置 49 瓦扬声器系统', 'connectivity.ports': ['Mini DisplayPort (MagSafe 供电 100W)', 'USB 2.0 ×3'], 'connectivity.hostCharging': '100W' } });
pad({ id: 'apple-cinema-hd-display-2004', name: 'Apple Cinema HD Display', date: '2004-06-30', category: 'display', line: 'Apple Display', specs: { 'body.heightMm': 531, 'body.widthMm': 678, 'body.depthMm': 220, 'body.weightG': 12100, 'body.colors': ['银色'], 'display.sizeIn': 30, 'display.type': '内置液晶显示屏', 'display.resolutionPx': res(2560, 1600), 'display.ppi': 101, 'display.refreshHz': '60', 'display.brightnessTypicalNits': null, 'display.colorGamut': null, 'camera.front': null, 'audio.speakers': null, 'connectivity.ports': ['DVI (FireWire 400 ×2、USB 2.0 ×2 集线器)'], 'connectivity.hostCharging': null } });

/* ── network：AirPort / Time Capsule / Xserve ── */

pad({ id: 'apple-airport-extreme-2013', name: 'AirPort Extreme (802.11ac)', date: '2013-06-10', category: 'network', line: 'AirPort', specs: { 'body.heightMm': 168, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 950, 'body.colors': ['白色'], 'chipset.name': null, 'memory.storageGb': null, 'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网 (三频并发)', 'connectivity.ports': ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0（打印机/硬盘共享）'], 'features.backup': null, 'features.rack': null } });
pad({ id: 'apple-airport-extreme-2009', name: 'AirPort Extreme (802.11n)', date: '2009-03-03', category: 'network', line: 'AirPort', specs: { 'body.heightMm': 168, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 950, 'body.colors': ['白色'], 'chipset.name': null, 'memory.storageGb': null, 'connectivity.wifi': '802.11a/b/g/n 无线局域网 (双频并发)', 'connectivity.ports': ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0（打印机/硬盘共享）'], 'features.backup': null, 'features.rack': null } });
pad({ id: 'apple-airport-express-2012', name: 'AirPort Express (802.11n)', date: '2012-06-11', category: 'network', line: 'AirPort', specs: { 'body.heightMm': 30, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 300, 'body.colors': ['白色'], 'chipset.name': null, 'memory.storageGb': null, 'connectivity.wifi': '802.11a/b/g/n 无线局域网 (双频并发)', 'connectivity.ports': ['千兆以太网 WAN/LAN', 'USB 2.0', '3.5 毫米音频输出口'], 'features.backup': null, 'features.rack': null } });
pad({ id: 'apple-time-capsule-2013', name: 'AirPort Time Capsule (802.11ac)', date: '2013-06-10', category: 'network', line: 'AirPort', specs: { 'body.heightMm': 168, 'body.widthMm': 98, 'body.depthMm': 98, 'body.weightG': 1140, 'body.colors': ['白色'], 'chipset.name': null, 'memory.storageGb': GB([2000, 3000]), 'connectivity.wifi': '802.11a/b/g/n/ac 无线局域网 (三频并发)', 'connectivity.ports': ['千兆以太网 WAN ×1', '千兆以太网 LAN ×3', 'USB 2.0（打印机/硬盘共享）'], 'features.backup': 'Time Machine 自动无线备份', 'features.rack': null } });
pad({ id: 'apple-xserve-2009', name: 'Xserve', date: '2009-04-07', category: 'network', line: 'Xserve', specs: { 'body.heightMm': 43.7, 'body.widthMm': 481, 'body.depthMm': 665, 'body.weightG': 13600, 'body.colors': ['银色'], 'chipset.name': 'Intel Xeon 处理器 | Nehalem | 2.26GHz', 'chipset.arch': 'x86', 'chipset.cpuCores': 8, 'memory.ramGb': null, 'memory.storageGb': GB([80, 160, 240, 480]), 'connectivity.wifi': null, 'connectivity.ports': ['千兆以太网 ×2', 'FireWire 800 ×2', 'USB 2.0 ×3'], 'features.backup': null, 'features.rack': '1U 机架式' } });
// Xserve RAID 2003-02 已迁至 storage 品类（macDB 对账批 C：磁盘阵列是存储设备，不是网络设备）——由 _gen-apple-macdb-display-storage-overrides.mjs 单一真源维护

/* ── desktop：1990s–2000s Macintosh 家族（历史锚点）── */

pad({ id: 'apple-macintosh-512k', name: 'Macintosh 512K', date: '1984-09-10', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 345, 'body.heightMm': 343, 'body.depthMm': 277, 'body.weightKg': 7.5, 'body.colors': ['米白色'], 'display.sizeIn': 9, 'display.type': '内置单色 CRT 显示屏', 'display.resolutionPx': res(512, 342), 'chipset.name': 'Motorola 68000 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '800K 软盘驱动器', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': null, 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'Macintosh System 1' } });
pad({ id: 'apple-macintosh-plus', name: 'Macintosh Plus', date: '1986-01-16', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 345, 'body.heightMm': 343, 'body.depthMm': 277, 'body.weightKg': 7.9, 'body.colors': ['米白色'], 'display.sizeIn': 9, 'display.type': '内置单色 CRT 显示屏', 'display.resolutionPx': res(512, 342), 'chipset.name': 'Motorola 68000 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '800K 软盘驱动器 | SCSI 外接硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口 ×2'], 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'Macintosh System 3' } });
pad({ id: 'apple-macintosh-se', name: 'Macintosh SE', date: '1987-03-02', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 345, 'body.heightMm': 343, 'body.depthMm': 277, 'body.weightKg': 8.7, 'body.colors': ['米白色'], 'display.sizeIn': 9, 'display.type': '内置单色 CRT 显示屏', 'display.resolutionPx': res(512, 342), 'chipset.name': 'Motorola 68000 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘 + 内置硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口 ×2'], 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'Macintosh System 4' } });
pad({ id: 'apple-macintosh-ii', name: 'Macintosh II', date: '1987-03-02', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 470, 'body.heightMm': 140, 'body.depthMm': 370, 'body.weightKg': 5.9, 'body.colors': ['米白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'Motorola 68020 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘 + 内置硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口 ×2', '外接显示器端口'], 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'Macintosh System 4' } });
pad({ id: 'apple-macintosh-classic', name: 'Macintosh Classic', date: '1990-10-15', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 345, 'body.heightMm': 343, 'body.depthMm': 277, 'body.weightKg': 7.3, 'body.colors': ['米白色'], 'display.sizeIn': 9, 'display.type': '内置单色 CRT 显示屏', 'display.resolutionPx': res(512, 342), 'chipset.name': 'Motorola 68000 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘 + 内置硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口 ×2'], 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'System 6' } });
pad({ id: 'apple-macintosh-lc', name: 'Macintosh LC', date: '1990-10-15', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 360, 'body.heightMm': 76, 'body.depthMm': 410, 'body.weightKg': 4.2, 'body.colors': ['米白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'Motorola 68020 处理器', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘 + 内置硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口 ×2', '外接显示器端口'], 'camera.front': null, 'audio.speakers': null, 'os.launch': 'System 6' } });
pad({ id: 'apple-quadra-700', name: 'Macintosh Quadra 700', date: '1991-10-21', category: 'desktop', line: 'Macintosh', specs: { 'body.widthMm': 470, 'body.heightMm': 140, 'body.depthMm': 370, 'body.weightKg': 6.8, 'body.colors': ['米白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'Motorola 68040 处理器 | 25MHz', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘 + 内置硬盘', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['以太网', 'SCSI', '串口 ×2', '外接显示器端口'], 'camera.front': null, 'audio.speakers': '内置扬声器', 'os.launch': 'System 7' } });
pad({ id: 'apple-power-macintosh-8100', name: 'Power Macintosh 8100', date: '1994-03-14', category: 'desktop', line: 'Power Macintosh', specs: { 'body.widthMm': 400, 'body.heightMm': 210, 'body.depthMm': 410, 'body.weightKg': 8.2, 'body.colors': ['米白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'PowerPC 601 处理器 | 80/100MHz', 'chipset.arch': 'PowerPC', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': 'SCSI 硬盘 + 软盘 + CD-ROM', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['以太网', 'SCSI', '串口 ×2', 'AV 视频端口'], 'camera.front': null, 'audio.speakers': null, 'os.launch': 'System 7.1' } });
pad({ id: 'apple-power-macintosh-g3-1997', name: 'Power Macintosh G3', date: '1997-11-10', category: 'desktop', line: 'Power Macintosh', specs: { 'body.widthMm': 386, 'body.heightMm': 386, 'body.depthMm': 386, 'body.weightKg': 13.6, 'body.material': '米白色 | 塔式机箱', 'body.colors': ['米白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'PowerPC G3 处理器 | 233–266MHz', 'chipset.arch': 'PowerPC', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': 'EIDE 硬盘 + 软盘 + CD-ROM', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['以太网', 'SCSI', '串口', 'USB (1998 版起)'], 'camera.front': null, 'audio.speakers': null, 'os.launch': 'Mac OS 8' } });
pad({ id: 'apple-power-mac-g4-cube', name: 'Power Mac G4 Cube', date: '2000-07-19', category: 'desktop', line: 'Power Mac', specs: { 'body.widthMm': 198, 'body.heightMm': 251, 'body.depthMm': 198, 'body.weightKg': 6.4, 'body.material': '8 英寸半透明聚碳酸酯立方体 (无风扇静音设计)', 'body.colors': ['白色'], 'display.sizeIn': null, 'display.type': null, 'chipset.name': 'PowerPC G4 处理器 | 450/500MHz', 'chipset.arch': 'PowerPC', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': GB([20, 40]), 'memory.storageType': '硬盘 (ATA)', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['千兆以太网', 'FireWire 400 ×2', 'USB ×2', 'VGA 视频输出'], 'camera.front': null, 'audio.speakers': 'Harman Kardon 外接扬声器 (随附)', 'os.launch': 'Mac OS 9' } });
pad({ id: 'apple-emac-2002', name: 'eMac', date: '2002-04-29', category: 'desktop', line: 'eMac', specs: { 'body.widthMm': 408, 'body.heightMm': 398, 'body.depthMm': 429, 'body.weightKg': 22.7, 'body.material': '半透明聚碳酸酯 (教育市场一体机)', 'body.colors': ['白色'], 'display.sizeIn': 17, 'display.type': '内置 CRT 显示屏', 'display.resolutionPx': res(1024, 768), 'chipset.name': 'PowerPC G4 处理器 | 700/800MHz', 'chipset.arch': 'PowerPC', 'chipset.cpuCores': 1, 'memory.ramGb': null, 'memory.storageGb': GB([40, 60, 80]), 'memory.storageType': '硬盘 (ATA)', 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['百兆以太网', 'FireWire 400 ×2', 'USB ×3', 'Mini-VGA 视频输出'], 'camera.front': null, 'audio.speakers': '内置立体声扬声器', 'os.launch': 'Mac OS X 10.1' } });

/* ── laptop：PowerBook 早期 ── */

pad({ id: 'apple-powerbook-100', name: 'PowerBook 100', date: '1991-10-21', category: 'laptop', line: 'PowerBook', specs: { 'body.thicknessMm': 45.7, 'body.weightKg': 2.3, 'body.material': '灰白色塑料机身 (前置轨迹球设计)', 'body.colors': ['灰白色'], 'display.sizeIn': 9, 'display.type': '内置单色液晶显示屏', 'display.resolutionPx': res(640, 400), 'display.ppi': null, 'chipset.name': 'Motorola 68HC000 处理器 | 16MHz', 'chipset.arch': '68k', 'chipset.cpuCores': 1, 'chipset.processNm': null, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': '软盘（外接）+ SCSI 硬盘（可选）', 'battery.capacityWh': null, 'battery.vendorClaimedHours': 3.5, 'camera.front': null, 'audio.speakers': null, 'audio.jack': null, 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['SCSI', 'Apple Desktop Bus', '串口', '外接软盘口'], 'features.keyboard': null, 'os.launch': 'System 7' } });
pad({ id: 'apple-powerbook-g3-1997', name: 'PowerBook G3 (Wallstreet)', date: '1997-11-10', category: 'laptop', line: 'PowerBook', specs: { 'body.thicknessMm': 50.8, 'body.weightKg': 3.4, 'body.material': '黑色外壳', 'body.colors': ['黑色'], 'display.sizeIn': 14.1, 'display.type': '内置液晶显示屏', 'display.resolutionPx': res(1024, 768), 'display.ppi': null, 'chipset.name': 'PowerPC G3 处理器 | 233–292MHz', 'chipset.arch': 'PowerPC', 'chipset.cpuCores': 1, 'chipset.processNm': null, 'memory.ramGb': null, 'memory.storageGb': null, 'memory.storageType': 'IDE 硬盘 + 软盘 + CD-ROM', 'battery.capacityWh': null, 'battery.vendorClaimedHours': 5, 'camera.front': null, 'audio.speakers': '内置立体声扬声器', 'audio.jack': null, 'connectivity.wifi': null, 'connectivity.bluetooth': null, 'connectivity.ports': ['以太网', 'SCSI (HDI-30)', '串口', '外接显示器端口'], 'features.keyboard': null, 'os.launch': 'Mac OS 8' } });

store.entries = [...kept, ...entries];
store.updatedAt = D;
writeFileSync(OVERRIDES, JSON.stringify(store, null, 2) + '\n', 'utf8');
console.log(`已写入 ${entries.length} 条 add-product → data/overrides.json（共 ${store.entries.length} 条）`);
