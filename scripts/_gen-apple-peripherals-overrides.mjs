/**
 * 一次性生成脚本：苹果全系列·外围配件批（键鼠/打印机/电源适配器，41 台）
 *
 *  - input（新品类首批 25）：键盘 12（ADB 时代 → Magic Keyboard USB-C）+ 鼠标 10
 *    （ADB Mouse II → Magic Mouse USB-C）+ 触控板 3
 *  - printer（新品类首批 8）：ImageWriter/II、LaserWriter/Plus/II NTX/Personal LS、
 *    StyleWriter/II、Color StyleWriter 2500
 *  - accessory（新品类首批 8）：USB 电源适配器 5W×2/10W/12W/29W/20W + iSight + Apple Remote
 *
 * 数据来源：macdb.cn/early-keyboard-mouse|keyboard|mouse|trackpad|power-adapters（结构化
 * 参数 + 官方订购编号互证）；打印机为广为记载的历史锚点（Apple 打印线档案页大多下架，
 * 置信度中，用户已接受）；适配器全参数（macDB 27 台页）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = 'data/overrides.json';
const D = '2026-10-15';
const BY = '同志';
const MARK = 'gen-apple-peripherals';

const store = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const kept = (store.entries ?? []).filter((e) => !String(e.id).includes(MARK));
const startSeq = kept.length;
const entries = [];
let seq = startSeq;

// 日期精度从日期形状派生（2026-10-17 审计 A3）：'YYYY-01-01'+day 是假精度（闸门16 拒），
// 手工把精度降成 year 又会留下「形状不符」——精度与形状同源，永远一致
const precisionOf = (d) => (d.split('-').length === 3 ? 'day' : d.split('-').length === 2 ? 'month' : 'year');

function pad({ id, name, date, status, category, line, specs }) {
  seq += 1;
  entries.push({
    id: `ovr-${MARK}-${String(seq - startSeq).padStart(3, '0')}`,
    op: 'add-product',
    createdAt: D,
    product: {
      id, slug: id, brand: 'apple', category, line, name, nameZh: null,
      releaseDate: date, releaseDatePrecision: precisionOf(date),
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
    reason: '苹果全系列·外围配件批（键盘/鼠标/触控板/打印机/电源适配器）——macDB 结构化参数与官方订购编号互证',
    source: 'user-manual', sourceUrl: null, createdBy: BY, active: true,
  });
}

// ── 键盘 12 台（ADB → USB → 蓝牙 → Magic Keyboard USB-C，四代接口史）──
pad({ id: 'apple-keyboard-standard-1987', name: 'Apple Keyboard', date: '1987-03-02', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': 44, 'body.widthMm': 419, 'body.depthMm': 142, 'body.weightG': 1000, 'body.colors': ['米白色'], 'input.buttons': null, 'input.tracking': null, 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'System 6.0.7 或更高版本' } });
pad({ id: 'apple-keyboard-extended-1987', name: 'Apple Extended Keyboard', date: '1987-03-02', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['米白色'], 'input.buttons': null, 'input.tracking': null, 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-keyboard-ii-1990', name: 'Apple Keyboard II', date: '1990-10-15', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': 33, 'body.widthMm': 406, 'body.depthMm': 150, 'body.weightG': 890, 'body.colors': ['米白色'], 'input.buttons': null, 'input.tracking': null, 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-keyboard-extended-ii-1990', name: 'Apple Extended Keyboard II', date: '1990-10-15', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': 40, 'body.widthMm': 475, 'body.depthMm': 196, 'body.weightG': 1200, 'body.colors': ['米白色'], 'input.buttons': null, 'input.tracking': null, 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-keyboard-appledesign-1994', name: 'AppleDesign Keyboard', date: '1994-03-01', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': 40, 'body.widthMm': 475, 'body.depthMm': 196, 'body.weightG': 1200, 'body.colors': ['米白色'], 'input.buttons': null, 'input.tracking': null, 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-keyboard-usb-1998', name: 'Apple USB Keyboard', date: '1998-08-15', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['邦迪蓝', '蓝莓色', '葡萄色', '草莓色', '橘橙色', '青柠色', '石墨色'], 'input.buttons': 98, 'input.tracking': null, 'connectivity.type': 'USB（含 2 个下游 USB 端口）', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS 8.1 或更高版本' } });
pad({ id: 'apple-keyboard-pro-2000', name: 'Apple Pro Keyboard', date: '2000-07-19', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色', '黑色'], 'input.buttons': 108, 'input.tracking': null, 'connectivity.type': 'USB（含 2 个内置 USB 端口）', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS 9.0.4 或更高版本' } });
pad({ id: 'apple-keyboard-wireless-2003', name: 'Apple Wireless Keyboard', date: '2003-09-16', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'input.buttons': 109, 'input.tracking': null, 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙 1.1', 'power.type': '4 节 5 号电池', 'power.batteryLifeMonths': 9, 'os.launch': 'Mac OS X v10.2.6 或更高版本' } });
pad({ id: 'apple-keyboard-alu-2007', name: 'Apple Keyboard（铝合金）', date: '2007-08-07', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['银色'], 'input.buttons': 109, 'input.tracking': null, 'connectivity.type': 'USB（两端各 1 个下游 USB 2.0 端口）', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.5.6 或更高版本' } });
pad({ id: 'apple-keyboard-wireless-alu-2007', name: 'Apple Wireless Keyboard（铝合金）', date: '2007-08-07', category: 'input', line: 'Keyboard', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['银色'], 'input.buttons': 78, 'input.tracking': null, 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '3 节 5 号电池（后改 2 节）', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.4.10 或更高版本' } });
pad({ id: 'apple-magic-keyboard-2015', name: 'Magic Keyboard', date: '2015-10-13', category: 'input', line: 'Magic Keyboard', specs: { 'body.heightMm': 11.49, 'body.widthMm': 279, 'body.depthMm': 109, 'body.weightG': 231, 'body.colors': ['银色'], 'input.buttons': 78, 'input.tracking': null, 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '内置可充电电池（Lightning 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'OS X v10.11 或更高版本' } });
pad({ id: 'apple-magic-keyboard-touch-id-2021', name: 'Magic Keyboard（带有 Touch ID）', date: '2021-05-18', category: 'input', line: 'Magic Keyboard', specs: { 'body.heightMm': 11.49, 'body.widthMm': 278.9, 'body.depthMm': 109, 'body.weightG': 243, 'body.colors': ['银色'], 'input.buttons': 78, 'input.tracking': null, 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '内置可充电电池（Lightning 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'macOS 11.4 或更高版本' } });
pad({ id: 'apple-magic-keyboard-usb-c-2024', name: 'Magic Keyboard（带有 Lock 键）(USB-C)', date: '2024-10-28', category: 'input', line: 'Magic Keyboard', specs: { 'body.heightMm': 11.49, 'body.widthMm': 279, 'body.depthMm': 109, 'body.weightG': 239, 'body.colors': ['银色'], 'input.buttons': 78, 'input.tracking': null, 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '内置可充电电池（USB-C 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'macOS 15.1 或更高版本' } });
// ── 鼠标 10 台（「泪滴」形态从 1993 延续至今）──
pad({ id: 'apple-adb-mouse-ii-1993', name: 'Apple Desktop Bus Mouse II', date: 1993, category: 'input', line: 'Mouse', specs: { 'body.heightMm': 33, 'body.widthMm': 61, 'body.depthMm': 107, 'body.weightG': 132, 'body.colors': ['铂金色'], 'input.buttons': 1, 'input.tracking': '机械滚珠', 'connectivity.type': 'ADB（Apple Desktop Bus）', 'connectivity.bluetooth': null, 'power.type': 'ADB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-usb-mouse-1998', name: 'Apple USB Mouse（冰球鼠标）', date: '1998-08-15', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['邦迪蓝', '蓝莓色', '葡萄色', '草莓色', '橘橙色'], 'input.buttons': 1, 'input.tracking': '机械滚珠', 'connectivity.type': 'USB', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS 8.1 或更高版本' } });
pad({ id: 'apple-pro-mouse-2000', name: 'Apple Pro Mouse', date: '2000-07-19', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色', '黑色'], 'input.buttons': 1, 'input.tracking': '光电', 'connectivity.type': 'USB', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS 9.0.4 或更高版本' } });
pad({ id: 'apple-mouse-2003', name: 'Apple Mouse', date: '2003-05-06', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'input.buttons': 1, 'input.tracking': '光电', 'connectivity.type': 'USB', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': null } });
pad({ id: 'apple-wireless-mouse-2003', name: 'Apple Wireless Mouse', date: '2003-09-16', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'input.buttons': 1, 'input.tracking': '光电', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙 1.1', 'power.type': '2 节 5 号电池', 'power.batteryLifeMonths': 3, 'os.launch': 'Mac OS X v10.2.6 或更高版本' } });
pad({ id: 'apple-mighty-mouse-2005', name: 'Apple Mighty Mouse', date: '2005-08-02', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'input.buttons': 4, 'input.tracking': '光电（360° 滚动球）', 'connectivity.type': 'USB', 'connectivity.bluetooth': null, 'power.type': 'USB 总线供电', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.4.2 或更高版本' } });
pad({ id: 'apple-mighty-mouse-wireless-2006', name: 'Apple Mighty Mouse（无线）', date: '2006-07-25', category: 'input', line: 'Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'input.buttons': 4, 'input.tracking': '激光（360° 滚动球）', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '1 节或 2 节 5 号电池', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.4.6 或更高版本' } });
pad({ id: 'apple-magic-mouse-2009', name: 'Magic Mouse', date: '2009-10-20', category: 'input', line: 'Magic Mouse', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色', '银色'], 'input.buttons': 1, 'input.tracking': '多点触控（激光追踪）', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '2 节 5 号电池', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.5.8 或更高版本' } });
pad({ id: 'apple-magic-mouse-2-2015', name: 'Magic Mouse 2', date: '2015-10-13', category: 'input', line: 'Magic Mouse', specs: { 'body.heightMm': 21.6, 'body.widthMm': 57.1, 'body.depthMm': 113.5, 'body.weightG': 99, 'body.colors': ['银色'], 'input.buttons': 1, 'input.tracking': '多点触控（激光追踪）', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙 3.0', 'power.type': '内置可充电锂离子电池（1986 mAh，Lightning 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'OS X v10.11 或更高版本' } });
pad({ id: 'apple-magic-mouse-usb-c-2024', name: 'Magic Mouse (USB-C)', date: '2024-10-28', category: 'input', line: 'Magic Mouse', specs: { 'body.heightMm': 21.6, 'body.widthMm': 57.1, 'body.depthMm': 113.5, 'body.weightG': 99, 'body.colors': ['银色'], 'input.buttons': 1, 'input.tracking': '多点触控（激光追踪）', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙 3.0', 'power.type': '内置可充电锂离子电池（1986 mAh，USB-C 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'macOS 15.1 或更高版本' } });

// ── 触控板 3 台 ──
pad({ id: 'apple-magic-trackpad-2010', name: 'Magic Trackpad', date: '2010-07-27', category: 'input', line: 'Magic Trackpad', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['银色'], 'input.buttons': 1, 'input.tracking': '多点触控', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '2 节 5 号电池', 'power.batteryLifeMonths': null, 'os.launch': 'Mac OS X v10.6.4 或更高版本' } });
pad({ id: 'apple-magic-trackpad-2-2015', name: 'Magic Trackpad 2', date: '2015-10-13', category: 'input', line: 'Magic Trackpad', specs: { 'body.heightMm': 11.49, 'body.widthMm': 160, 'body.depthMm': 114.9, 'body.weightG': 231, 'body.colors': ['银色'], 'input.buttons': 1, 'input.tracking': '多点触控、力度触控', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '内置可充电锂离子电池（2024 mAh，Lightning 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'OS X v10.11 或更高版本' } });
pad({ id: 'apple-magic-trackpad-usb-c-2024', name: 'Magic Trackpad (USB-C)', date: '2024-10-28', category: 'input', line: 'Magic Trackpad', specs: { 'body.heightMm': 11.49, 'body.widthMm': 160, 'body.depthMm': 114.9, 'body.weightG': 230, 'body.colors': ['银色'], 'input.buttons': 1, 'input.tracking': '多点触控、力度触控', 'connectivity.type': '无线', 'connectivity.bluetooth': '蓝牙', 'power.type': '内置可充电锂离子电池（2024 mAh，USB-C 接口充电）', 'power.batteryLifeMonths': 1, 'os.launch': 'macOS 15.1 或更高版本' } });
// ── 打印机 8 台（LaserWriter 与 Macintosh 组成的桌面出版系统改变了印刷业）──
pad({ id: 'apple-imagewriter-1983', name: 'ImageWriter', date: '1983-12-01', category: 'printer', line: 'ImageWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['米白色'], 'printer.tech': '针式点阵', 'printer.color': '黑白', 'printer.dpi': 144, 'printer.speedPpm': null, 'printer.paperSize': '单页纸与卷筒纸', 'connectivity.type': '串口', 'os.launch': null } });
pad({ id: 'apple-imagewriter-ii-1985', name: 'ImageWriter II', date: '1985-09-01', category: 'printer', line: 'ImageWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': 6600, 'body.colors': ['米白色'], 'printer.tech': '针式点阵', 'printer.color': '黑白', 'printer.dpi': 144, 'printer.speedPpm': null, 'printer.paperSize': '单页纸、连续纸与卷筒纸', 'connectivity.type': '串口', 'os.launch': null } });
pad({ id: 'apple-laserwriter-1985', name: 'LaserWriter', date: '1985-01-15', category: 'printer', line: 'LaserWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': 15900, 'body.colors': ['米白色'], 'printer.tech': '激光（内置 PostScript 解释器）', 'printer.color': '黑白', 'printer.dpi': 300, 'printer.speedPpm': 8, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口、LocalTalk', 'os.launch': null } });
pad({ id: 'apple-laserwriter-plus-1986', name: 'LaserWriter Plus', date: '1986-06-01', category: 'printer', line: 'LaserWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': 15900, 'body.colors': ['米白色'], 'printer.tech': '激光（内置 PostScript，字体增至 35 种）', 'printer.color': '黑白', 'printer.dpi': 300, 'printer.speedPpm': 8, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口、LocalTalk', 'os.launch': null } });
pad({ id: 'apple-laserwriter-ii-ntx-1988', name: 'LaserWriter II NTX', date: '1988-09-01', category: 'printer', line: 'LaserWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['米白色'], 'printer.tech': '激光（可升级控制器设计）', 'printer.color': '黑白', 'printer.dpi': 300, 'printer.speedPpm': 8, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口、LocalTalk、并口', 'os.launch': null } });
pad({ id: 'apple-personal-laserwriter-ls-1991', name: 'Personal LaserWriter LS', date: '1991-10-01', category: 'printer', line: 'LaserWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': 7300, 'body.colors': ['米白色'], 'printer.tech': '激光（QuickDraw，非 PostScript）', 'printer.color': '黑白', 'printer.dpi': 300, 'printer.speedPpm': 4, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口', 'os.launch': null } });
pad({ id: 'apple-stylewriter-1991', name: 'StyleWriter', date: '1991-08-01', category: 'printer', line: 'StyleWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['米白色'], 'printer.tech': '喷墨', 'printer.color': '黑白', 'printer.dpi': 360, 'printer.speedPpm': 1, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口', 'os.launch': null } });
pad({ id: 'apple-color-stylewriter-2500-1996', name: 'Color StyleWriter 2500', date: '1996-04-01', category: 'printer', line: 'StyleWriter', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['灰白色'], 'printer.tech': '喷墨', 'printer.color': '彩色', 'printer.dpi': 720, 'printer.speedPpm': 5, 'printer.paperSize': 'Letter / A4', 'connectivity.type': '串口、LocalTalk', 'os.launch': null } });
// ── 配件 8 台（「五福一安」横跨 iPhone 3G–11 十一年）──
pad({ id: 'apple-5w-usb-adapter-2004', name: '5W USB 电源适配器（初代）', date: '2004-06-01', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 5, 'power.outputSpec': '5V1A', 'power.protocol': 'Apple 1.0A', 'connectivity.type': 'USB-A', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-5w-usb-adapter-2008', name: '5W USB 电源适配器', date: '2008-07-11', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': 28, 'body.widthMm': 26, 'body.depthMm': 26, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 5, 'power.outputSpec': '5V1A', 'power.protocol': 'Apple 1.0A', 'connectivity.type': 'USB-A', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-10w-usb-adapter-2010', name: '10W USB 电源适配器', date: '2010-04-03', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': 28, 'body.widthMm': 57, 'body.depthMm': 57, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 10, 'power.outputSpec': '5.1V2.1A', 'power.protocol': 'Apple 2.1A', 'connectivity.type': 'USB-A', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-12w-usb-adapter-2012', name: '12W USB 电源适配器', date: '2012-11-02', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': 28, 'body.widthMm': 57, 'body.depthMm': 57, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 12, 'power.outputSpec': '5.2V2.4A', 'power.protocol': 'Apple 2.4A', 'connectivity.type': 'USB-A', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-29w-usb-c-adapter-2015', name: '29W USB-C 电源适配器', date: '2015-04-10', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': 28, 'body.widthMm': 56, 'body.depthMm': 56, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 29, 'power.outputSpec': '14.5V2A | 5.2V2.4A', 'power.protocol': 'USB PD', 'connectivity.type': 'USB-C', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-20w-usb-c-adapter-2020', name: '20W USB-C 电源适配器', date: '2020-09-15', category: 'accessory', line: '电源适配器', specs: { 'body.heightMm': 27, 'body.widthMm': 42, 'body.depthMm': 41, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '电源适配器', 'power.outputW': 20, 'power.outputSpec': '9V2.22A | 5V3A', 'power.protocol': 'USB PD', 'connectivity.type': 'USB-C', 'camera.mp': null, 'os.launch': null } });
pad({ id: 'apple-isight-2004', name: 'iSight', date: '2004-06-28', category: 'accessory', line: 'iSight', specs: { 'body.heightMm': 66.7, 'body.widthMm': 63.8, 'body.depthMm': 63.8, 'body.weightG': 63.5, 'body.colors': ['银色'], 'accessory.type': '摄像头', 'power.outputW': null, 'power.outputSpec': null, 'power.protocol': null, 'connectivity.type': 'FireWire 400', 'camera.mp': 0.3, 'os.launch': 'Mac OS X v10.3 或更高版本' } });
pad({ id: 'apple-remote-2005', name: 'Apple Remote', date: '2005-10-12', category: 'accessory', line: 'Apple Remote', specs: { 'body.heightMm': null, 'body.widthMm': null, 'body.depthMm': null, 'body.weightG': null, 'body.colors': ['白色'], 'accessory.type': '遥控器', 'power.outputW': null, 'power.outputSpec': null, 'power.protocol': null, 'connectivity.type': '红外', 'camera.mp': null, 'os.launch': 'Mac OS X v10.4（Front Row）' } });

const out = { ...store, entries: [...kept, ...entries] };
writeFileSync(OVERRIDES, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`外围配件批：写入 ${entries.length} 条 → ${OVERRIDES}`);
