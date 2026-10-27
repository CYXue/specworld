/**
 * 通道 X1：小米商城「关键参数」→ ProductRecord（category='phone'）。
 *
 * 数据口径（实测 2026-10-24，见 scripts/sources/xiaomi.mjs 头注释）：
 *   - 小米商城**没有结构化的完整规格表**（完整参数是图片），官方结构化数据只有
 *     class_parameters「关键参数」name-value 对（15–19 项）。
 *   - 因此本映射器的覆盖率天然偏浅——这是**官网结构性事实**，缺的字段一律 null
 *     （unknown → "—"），绝不从商品名（"12GB+256GB"）反推填充。
 *   - 关键参数值是自由文本（「正屏:6.4英寸|背屏:2.7英寸」「最高16GB」），逐项按
 *     显式映射表解析；解析不出的项原文进 notes，**不猜**。
 *   - 「新品礼（不发货）」这类非实体商品由采集端目录筛选兜住，映射端不重复判断。
 */
import { fieldMap, loadSchema } from '../../lib/schema.mjs';
import {
  emptyRecord,
  put,
  putObject,
  parseInch,
  parseMm,
  parseResolution,
  parseCapacity,
  wattOf,
  normalizeType,
  stripInvisible,
  addNote,
  pushOfficial,
  tidy,
  realValue,
  HW,
} from '../shared.mjs';

/** 小米关键参数名 → 契约路径的显式映射（未列出的键 = 官方给了但契约不收，进 note） */
const XM_KEY_MAP = {
  CPU型号: (rec, v, src) => {
    rec.chipset.name = tidy(v) || null;
    put(rec, 'chipset.name', rec.chipset.name, src);
  },
  电池容量: (rec, v, src) => {
    const cap = parseCapacity(v);
    rec.battery.capacityMah = cap.value;
    rec.battery.capacityCaliber = cap.caliber ?? 'typical';
    put(rec, 'battery.capacityMah', rec.battery.capacityMah, src);
    put(rec, 'battery.capacityCaliber', rec.battery.capacityCaliber, src);
  },
  有线快充: (rec, v, src) => {
    rec.battery.wiredChargeW = wattOf(v);
    if (rec.battery.wiredChargeW === null) {
      addNote(rec, `有线快充原文「${tidy(v)}」无「N W」标称，wiredChargeW 记 null（不按 V×A 推算）`);
    }
    put(rec, 'battery.wiredChargeW', rec.battery.wiredChargeW, src);
  },
  无线快充: (rec, v, src) => {
    rec.battery.wirelessChargeW = /不支持/.test(v) ? null : wattOf(v);
    put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, src);
  },
  运行内存: (rec, v, src) => {
    // 「最高16GB」→ 取最大数值档（官方口径是上限）
    const nums = [...v.matchAll(/(\d+(?:\.\d+)?)\s*GB/gi)].map((m) => Number(m[1]));
    if (nums.length) rec.memory.ramGb = [Math.max(...nums)];
    put(rec, 'memory.ramGb', rec.memory.ramGb, src);
  },
  存储容量: (rec, v, src) => {
    const nums = [...v.matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)/gi)].map((m) =>
      m[2].toUpperCase() === 'TB' ? Number(m[1]) * 1024 : Number(m[1]),
    );
    if (nums.length) rec.memory.storageGb = [Math.max(...nums)];
    put(rec, 'memory.storageGb', rec.memory.storageGb, src);
  },
  NFC: (rec, v, src) => {
    // 「不支持」包含子串「支持」，先排否定再判肯定（与华为通道同一纪律）
    rec.connectivity.nfc = /不支持/.test(v) ? false : /支持/.test(v) ? true : null;
    put(rec, 'connectivity.nfc', rec.connectivity.nfc, src);
  },
  红外遥控: (rec, v, src) => {
    rec.connectivity.irBlaster = /不支持/.test(v) ? false : /支持/.test(v) ? true : null;
    put(rec, 'connectivity.irBlaster', rec.connectivity.irBlaster, src);
  },
  数据接口: (rec, v, src) => {
    rec.connectivity.usb = tidy(v) || null;
    put(rec, 'connectivity.usb', rec.connectivity.usb, src);
  },
  网络类型: (rec, v, src) => {
    // 「5G全网通」→ fiveG=true（官网明确写 5G）；4G/2G 制式文本 → false；其余 null
    if (/5G/i.test(v)) rec.connectivity.fiveG = true;
    else if (/4G|2G/i.test(v) && !/5G/i.test(v)) rec.connectivity.fiveG = false;
    put(rec, 'connectivity.fiveG', rec.connectivity.fiveG, src);
  },
};

/** 屏幕三件套（尺寸/分辨率/类型）结构特殊，单独处理 */
function mapScreen(rec, raw, src) {
  const sizeRaw = raw['屏幕尺寸'];
  const typeRaw = raw['屏幕'];
  const resRaw = raw['屏幕分辨率'];

  // 「正屏:6.4英寸|背屏:2.7英寸」（折叠/双屏）→ 取第一段（正屏），多态原文进 note
  let sizeText = sizeRaw ?? '';
  const parts = sizeText.split(/\s*[|｜]\s*/);
  if (parts.length > 1) {
    addNote(rec, `屏幕尺寸原文为多屏标注「${tidy(sizeText)}」：display.sizeIn 取第一段（正屏），其余见 rawOfficial`);
    sizeText = parts[0].replace(/^[^:：]*[:：]/, '');
  }
  rec.display.sizeIn = parseInch(sizeText);

  if (resRaw) {
    const resText = resRaw.split(/\s*[|｜]\s*/)[0];
    rec.display.resolutionPx = parseResolution(resText);
    if (parseResolution(resRaw) && !parseResolution(resText)) rec.display.resolutionPx = parseResolution(resRaw);
  }
  if (typeRaw) {
    // 「AMOLED」→ display.type；带多段的取第一段
    rec.display.type = tidy(typeRaw.split(/\s*[|｜]\s*/)[0]) || null;
  }
  put(rec, 'display.sizeIn', rec.display.sizeIn, src);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
}

function mapXiaomi(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: (() => {
      const m = name.match(/Xiaomi (1[789]|MIX|Civi)|REDMI (K|Note|Turbo)/i);
      return m ? m[0] : 'Xiaomi';
    })(),
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'phone'; // 数据源层显式声明品类

  const mapped = new Set();
  for (const [key, fn] of Object.entries(XM_KEY_MAP)) {
    if (raw[key] !== undefined) {
      fn(rec, realValue(raw[key]) ?? '', HW);
      mapped.add(key);
    }
  }

  // 屏幕三件套（键名与 XM_KEY_MAP 不同形，单独处理）
  if (raw['屏幕尺寸'] || raw['屏幕分辨率'] || raw['屏幕']) {
    mapScreen(rec, raw, HW);
    ['屏幕尺寸', '屏幕分辨率', '屏幕'].forEach((k) => mapped.add(k));
  }

  // 官方给了但契约不收/结构不合的键 → 透明记录，不丢也不猜
  const unmapped = Object.keys(raw).filter((k) => !k.startsWith('_') && !mapped.has(k));
  if (unmapped.length) {
    const detail = unmapped.map((k) => `${k}=${tidy(raw[k]).slice(0, 40)}`).join('；');
    addNote(rec, `以下关键参数未入契约（结构不合或品类不适用，官网原文见 rawOfficial）：${detail}`);
    pushOfficial(rec, '未入契约的关键参数', unmapped.map((k) => `${k}：${raw[k]}`).join(' | '), 800);
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '后置摄像头', raw['后置摄像头']);
  pushOfficial(rec, '前置摄像头', raw['前置摄像头']);
  pushOfficial(rec, '指纹识别', raw['指纹识别']);
  pushOfficial(rec, '网络模式', raw['网络模式']);

  return rec;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 通道 X2–X8：小米多品类映射器
 *
 * 共同口径（实测 2026-10-24，各品类「关键参数」结构见 _work/_probe-xiaomi/spec-structure.mjs）：
 *   - 关键参数值是自由文本，多档位用「/」分隔（「8GB/12GB」）→ 档位全收；
 *     带「最高/至长」限定的取最大值（官网口径是上限）。
 *   - 带单位的数值（重量 kg、电池 Wh、刷新率 Hz）做单位换算/去单位，不算估算；
 *     官网没给的字段一律 null（关键参数只是官方结构化数据的全集，覆盖率浅是结构事实）。
 * ════════════════════════════════════════════════════════════════════════════ */

/** 抓文本里的全部数字（含小数） */
const allNums = (t) => (tidy(t ?? '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** 「8GB/12GB」→ [8,12]；「1024GB」→ [1024]；TB×1024 换算 */
function gbList(text) {
  const out = [];
  for (const m of (text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)/gi)) {
    out.push(m[2].toUpperCase() === 'TB' ? Number(m[1]) * 1024 : Number(m[1]));
  }
  return out.length ? [...new Set(out)] : null;
}

/** 关键参数取值便捷项 */
const kv = (raw, key) => realValue(raw[key]);

/** 通道 X2：小米平板（category='tablet'，schema data/schemas/tablet.json） */
function mapXiaomiTablet(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: name.includes('Pad') ? 'Pad' : 'Xiaomi',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'tablet';

  /* 屏幕 */
  rec.display.sizeIn = parseInch(kv(raw, '屏幕尺寸'));
  rec.display.type = normalizeType(kv(raw, '屏幕类型') ?? '');
  const resText = kv(raw, '屏幕分辨率');
  rec.display.resolutionPx = resText ? parseResolution(resText) : null;
  const hz = allNums(kv(raw, '屏幕刷新率'));
  rec.display.refreshHz = hz.length ? String(Math.max(...hz)) : null;
  /* 芯片 / 内存 */
  rec.chipset.name = tidy(kv(raw, 'CPU') ?? '') || null;
  rec.memory.ramGb = gbList(kv(raw, '运行内存'));
  rec.memory.storageGb = gbList(kv(raw, '内存容量'));
  /* 电池 / 充电 */
  const cap = parseCapacity(kv(raw, '电池容量'));
  rec.battery.capacityMah = cap.value;
  rec.battery.capacityCaliber = cap.value !== null ? 'typical' : null;
  rec.battery.wiredChargeW = wattOf(kv(raw, '有线快充'));
  rec.battery.wirelessChargeW = /不支持/.test(kv(raw, '无线快充') ?? '')
    ? null
    : wattOf(kv(raw, '无线快充'));
  if ((kv(raw, '无线快充') ?? '').includes('不支持')) {
    addNote(rec, `无线快充原文「${tidy(kv(raw, '无线快充'))}」：官网明示不支持 → null`);
  }
  /* 机身 / 连接 / 系统 */
  rec.body.thicknessMm = parseMm(kv(raw, '厚度'));
  rec.connectivity.usb = tidy(kv(raw, 'USB接口') ?? '') || null;
  rec.connectivity.wifi = tidy(kv(raw, '网络连接') ?? '') || null;
  rec.os.launch = tidy(kv(raw, '操作系统') ?? '') || null;
  /* specs 直写（非 SPEC_GROUPS 前缀） */
  const speakers = kv(raw, '扬声器数量');
  if (speakers) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': tidy(speakers) };
    rec.provenance['audio.speakers'] = HW;
  }
  const stylus = kv(raw, '是否支持专用触控笔');
  if (stylus) {
    // tablet schema 的 features.stylus 是字符串（「支持/不支持」），不是布尔
    rec.specs = {
      ...(rec.specs ?? {}),
      'features.stylus': /不/.test(stylus) ? '不支持' : '支持',
    };
    rec.provenance['features.stylus'] = HW;
  }
  const kb = kv(raw, '是否支持专用键盘');
  if (kb) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'features.keyboard': /支持|是/.test(kb) && !/不/.test(kb) ? '支持' : '不支持',
    };
    rec.provenance['features.keyboard'] = HW;
  }

  /* 摄像头：关键参数只有像素总量（「1300W」），镜头对象需要光圈/防抖等结构
   * 信息 → 不造镜头对象，camera.rear 保持 []，原文进 rawOfficial（与手机通道同纪律） */
  pushOfficial(rec, '后置摄像头', kv(raw, '后置摄像头'));
  pushOfficial(rec, '前置摄像头', kv(raw, '前置摄像头'));

  /* provenance */
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.capacityMah', rec.battery.capacityMah, HW);
  put(rec, 'battery.capacityCaliber', rec.battery.capacityCaliber, HW);
  put(rec, 'battery.wiredChargeW', rec.battery.wiredChargeW, HW);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'connectivity.usb', rec.connectivity.usb, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'os.launch', rec.os.launch, HW);

  return rec;
}

/** 通道 X3：小米笔记本（category='laptop'，schema data/schemas/laptop.json） */
function mapXiaomiLaptop(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: /REDMI/i.test(name) ? 'REDMI Book' : 'Book',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'laptop';

  /* 屏幕（多配置「2560*1600 / 3072*1920」取第一段，全档进 note） */
  const seg = (t) => tidy(t ?? '').split(/\s*[/｜|]\s*/)[0];
  const multi = (t) => (tidy(t ?? '').split(/\s*[/｜|]\s*/).length > 1 ? tidy(t) : null);
  rec.display.sizeIn = parseInch(seg(kv(raw, '屏幕尺寸')));
  rec.display.resolutionPx = parseResolution(seg(kv(raw, '屏幕分辨率')));
  const hzNums = allNums(kv(raw, '屏幕刷新率'));
  rec.display.refreshHz = hzNums.length ? hzNums.join('/') : null;
  const bri = allNums(kv(raw, '屏幕亮度'));
  rec.display.brightnessTypicalNits = bri.length ? bri[0] : null;
  if (multi(kv(raw, '屏幕亮度'))) {
    addNote(rec, `亮度原文多档「${tidy(kv(raw, '屏幕亮度'))}」：取第一档，全档见 rawOfficial`);
  }
  rec.display.colorGamut = kv(raw, '屏幕色域') ? tidy(kv(raw, '屏幕色域')) : null;
  /* 芯片 / 内存 / 存储 */
  rec.chipset.name = seg(kv(raw, 'CPU类型')) ? tidy(seg(kv(raw, 'CPU类型'))) : null;
  if (multi(kv(raw, 'CPU类型'))) {
    addNote(rec, `CPU 原文多配置「${tidy(kv(raw, 'CPU类型'))}」：取第一段`);
  }
  rec.chipset.gpu = tidy(kv(raw, '显卡类型') ?? '') || null;
  rec.memory.ramGb = gbList(kv(raw, '内存容量'));
  rec.memory.storageGb = gbList(kv(raw, '固态硬盘'));
  /* 电池（Wh）/ 机身 */
  const whM = tidy(kv(raw, '电池容量') ?? '').match(/([\d.]+)\s*Wh/);
  rec.battery.capacityWh = whM ? Number(whM[1]) : null;
  const kgM = tidy(kv(raw, '重量(净重)') ?? kv(raw, '重量（净重）') ?? '').match(/([\d.]+)\s*kg/i);
  rec.body.weightKg = kgM ? Number(kgM[1]) : null;
  rec.os.launch = tidy(kv(raw, '操作系统') ?? '') || null;
  const adapterW = allNums(kv(raw, '电源适配器'));
  if (adapterW.length) {
    rec.specs = { ...(rec.specs ?? {}), 'power.adapterW': adapterW[0] };
    rec.provenance['power.adapterW'] = HW;
  }

  pushOfficial(rec, '屏幕亮度', kv(raw, '屏幕亮度'));
  pushOfficial(rec, '屏幕色域', kv(raw, '屏幕色域'));
  pushOfficial(rec, '屏幕刷新率', kv(raw, '屏幕刷新率'));

  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'chipset.gpu', rec.chipset.gpu, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.capacityWh', rec.battery.capacityWh, HW);
  put(rec, 'body.weightKg', rec.body.weightKg, HW);
  put(rec, 'os.launch', rec.os.launch, HW);

  return rec;
}

/** 通道 X4：小米电视（category='media'，schema data/schemas/media.json）。
 * 电视关键参数自带「发布时间」（月精度）——记进 note 供取证表交叉验证，
 * releaseDate 本身仍由 sync 从取证表回填（单一写入路径纪律）。 */
function mapXiaomiVision(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: /REDMI/i.test(name) ? 'REDMI 电视' : '小米电视',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'media';

  rec.display.sizeIn = parseInch(kv(raw, '屏幕尺寸'));
  rec.display.resolutionPx = parseResolution(kv(raw, '屏幕分辨率'));
  const hz = allNums(kv(raw, '刷新率'));
  rec.display.refreshHz = hz.length ? String(Math.max(...hz)) : null;
  rec.display.colorGamut = kv(raw, '色域') ? tidy(kv(raw, '色域')) : null;
  rec.chipset.name = tidy(kv(raw, 'CPU') ?? '') || null;
  rec.memory.ramGb = gbList(kv(raw, '内存'));
  rec.memory.storageGb = gbList(kv(raw, '闪存'));
  rec.connectivity.bluetooth = tidy(kv(raw, '蓝牙') ?? '') || null;
  rec.connectivity.wifi = tidy(kv(raw, 'WIFI') ?? kv(raw, 'WiFi') ?? '') || null;

  /* 机身：官网给「单屏尺寸（宽*高）」与「含底座尺寸（宽*高*厚）」——
   * body 三维取含底座（整机形态），单屏尺寸进 rawOfficial */
  const baseM = tidy(kv(raw, '含底座尺寸（宽*高*厚）mm') ?? '').match(
    /(\d+(?:\.\d+)?)\s*[*×x]\s*(\d+(?:\.\d+)?)\s*[*×x]\s*(\d+(?:\.\d+)?)/,
  );
  if (baseM) {
    rec.body.widthMm = Number(baseM[1]);
    rec.body.heightMm = Number(baseM[2]);
    rec.body.depthMm = Number(baseM[3]);
    addNote(rec, 'body 三维取「含底座尺寸（宽*高*厚）」，单屏尺寸见 rawOfficial');
  }
  const kgM = tidy(kv(raw, '裸机含底座重量') ?? '').match(/([\d.]+)\s*Kg/i);
  rec.body.weightG = kgM ? Math.round(Number(kgM[1]) * 1000) : null;
  if (kgM) addNote(rec, `重量原文「${tidy(kv(raw, '裸机含底座重量'))}」以 Kg 标注，×1000 换算为 g`);

  /* 接口 / 扬声器 */
  const ports = [];
  const hdmi = allNums(kv(raw, 'HDMI'));
  const usb = allNums(kv(raw, 'USB'));
  if (hdmi.length) ports.push(`HDMI x ${hdmi[0]}`);
  if (usb.length) ports.push(`USB x ${usb[0]}`);
  if (ports.length) {
    rec.specs = { ...(rec.specs ?? {}), 'connectivity.ports': ports };
    rec.provenance['connectivity.ports'] = HW;
  }
  const spk = [kv(raw, '扬声器功率'), kv(raw, '扬声器数量')].filter(Boolean).map(tidy).join(' / ');
  if (spk) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': spk };
    rec.provenance['audio.speakers'] = HW;
  }
  /* 功率（media schema power.inputPower） */
  const power = allNums(kv(raw, '整机功率'));
  if (power.length) {
    rec.specs = { ...(rec.specs ?? {}), 'power.inputPower': power[0] };
    rec.provenance['power.inputPower'] = HW;
  }
  /* 官网自带发布时间（月精度）→ note 供取证交叉验证 */
  const rel = kv(raw, '发布时间');
  if (rel) addNote(rec, `官网关键参数自带发布时间「${tidy(rel)}」（月精度）`);

  pushOfficial(rec, '单屏尺寸', kv(raw, '单屏尺寸（宽*高）mm'));
  pushOfficial(rec, '背光方式', kv(raw, '背光方式'));
  pushOfficial(rec, '能效等级', kv(raw, '能效等级'));

  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);

  return rec;
}

/** 通道 X5：小米穿戴（手表/手环，category='wearable'，schema data/schemas/wearable.json） */
function mapXiaomiWearable(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: /REDMI/i.test(name) ? 'REDMI Watch' : 'Xiaomi Watch',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'wearable';

  /* 屏幕 / 机身（「47×47×12.3mm」三元：首=表壳径，末=厚度——与华为穿戴同规则） */
  const screenText = tidy(kv(raw, '屏幕') ?? '');
  rec.display.sizeIn = parseInch(screenText);
  rec.display.type = normalizeType(screenText.replace(/^[\d.]+\s*英寸\s*/, '')) || null;
  rec.display.resolutionPx = parseResolution(kv(raw, '分辨率'));
  const dimsText = kv(raw, '尺寸') ?? '';
  const dims = tidy(dimsText).includes('mm')
    ? (tidy(dimsText).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    : [];
  if (dims.length >= 3) {
    rec.body.caseSizeMm = dims[0];
    rec.body.thicknessMm = dims[2];
  }
  const gM = tidy(kv(raw, '机身重量') ?? '').match(/([\d.]+)/);
  rec.body.weightG = gM ? Number(gM[1]) : null;
  if (gM && /不含表带/.test(kv(raw, '机身重量'))) {
    addNote(rec, `重量原文「${tidy(kv(raw, '机身重量'))}」，不含表带口径`);
  }
  const water = tidy(kv(raw, '防水级别') ?? '') || null;
  if (water) rec.body.waterResistance = water;

  /* 续航：场景分档取「常规」档（跳过 省电/AOD/性能），天→小时单位换算 */
  const batteryText = kv(raw, '续航时长') ?? '';
  const segs = batteryText.split(/\s*[；;/]\s*/);
  const regular = segs.find((s) => /常规/.test(s) && !/AOD/.test(s));
  const dayM = regular ? regular.match(/(\d+(?:\.\d+)?)\s*天/) : null;
  if (dayM) {
    rec.battery.vendorClaimedHours = Number(dayM[1]) * 24;
    addNote(rec, `续航取官网「${tidy(regular)}」档换算为小时；全部分档见 rawOfficial`);
  }
  const cap = parseCapacity(kv(raw, '电池容量'));
  if (cap.value !== null) rec.specs = { ...(rec.specs ?? {}), 'battery.capacityMah': cap.value };
  if (cap.value !== null) rec.provenance['battery.capacityMah'] = HW;

  /* 连接 / 传感器 */
  rec.connectivity.bluetooth = tidy(kv(raw, '蓝牙') ?? '') || null;
  rec.connectivity.gnss = tidy(kv(raw, 'GPS') ?? '') || null;
  const sensors = kv(raw, '传感器');
  if (sensors) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'features.sensors': sensors.split(/[、,，/]/).map(tidy).filter(Boolean),
    };
    rec.provenance['features.sensors'] = HW;
  }

  pushOfficial(rec, '续航时长', batteryText);
  pushOfficial(rec, '运动模式', kv(raw, '运动模式'));

  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'body.caseSizeMm', rec.body.caseSizeMm, HW);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.waterResistance', rec.body.waterResistance, HW);
  put(rec, 'battery.vendorClaimedHours', rec.battery.vendorClaimedHours, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.gnss', rec.connectivity.gnss, HW);

  return rec;
}

/** 通道 X6：小米耳机/音箱（category='audio'，schema data/schemas/audio.json）。
 * 耳机版式参数丰富（降噪 dB/单双耳续航/防水），音箱版式通常只有扬声器/麦克风。 */
function mapXiaomiAudio(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: /Buds/i.test(name) ? 'Buds' : /Sound/i.test(name) ? 'Sound' : 'Xiaomi',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'audio';

  /* 降噪/空间音频是布尔：官网明示才有值（「降噪=55dB」→ true；没提 → null） */
  const anc = kv(raw, '降噪');
  if (anc) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.anc': !/不支持/.test(anc) };
    rec.provenance['audio.anc'] = HW;
  }
  const spatial = kv(raw, '空间音频');
  if (spatial) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.spatialAudio': !/不支持/.test(spatial) };
    rec.provenance['audio.spatialAudio'] = HW;
  }
  /* 音箱版式官网把扬声器叫「扬声器」（「2英寸全频」「4英寸低频+3个1.5英寸全频+3个无源辐射器」），
   * 耳机版式叫「发音单元/发声单元」。三者语义相同 → 同一个契约字段 audio.driverUnit，
   * 口径与华为音频通道一致（那边也是 `发声单元 → 扬声器.扬声器单元 → 扬声器` 回退）。 */
  const driver = kv(raw, '发音单元') ?? kv(raw, '发声单元') ?? kv(raw, '扬声器');
  if (driver) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.driverUnit': tidy(driver) };
    rec.provenance['audio.driverUnit'] = HW;
  }
  /* 续航：「耳机单次续航=8h；Wi-Fi版:10h」→ budHours 取最大；「整体续航=8h/40h」→ withCaseHours 取最大 */
  const budNums = allNums(kv(raw, '耳机单次续航'));
  if (budNums.length) {
    rec.battery.budHours = Math.max(...budNums);
    addNote(rec, '耳机单次续航取官网各档最大值，全档见 rawOfficial');
  }
  const totalNums = allNums(kv(raw, '整体续航'));
  if (totalNums.length) {
    rec.battery.withCaseHours = Math.max(...totalNums);
  }
  /* 重量 / 防水 / 蓝牙 */
  const budW = tidy(kv(raw, '单耳重量') ?? '').match(/([\d.]+)/);
  rec.body.budWeightG = budW ? Number(budW[1]) : null;
  const totW = tidy(kv(raw, '产品净重（含充电盒）') ?? '').match(/([\d.]+)/);
  rec.body.weightG = totW ? Number(totW[1]) : null;
  const water = tidy(kv(raw, '防尘防水') ?? '') || null;
  if (water) rec.body.waterResistance = water;
  rec.connectivity.bluetooth = tidy(kv(raw, '蓝牙版本') ?? kv(raw, '蓝牙') ?? '') || null;
  /* 音箱版式给「Wi-Fi 频段」（「2.4G/5GHz」）→ connectivity.wifi。官网部分页面把单位写重
   * （「2.4G/5GHzHz」），按原文保留并记 note，不做「帮官网改错字」的静默修正。 */
  const wifiBand = tidy(kv(raw, 'Wi-Fi 频段') ?? kv(raw, 'WiFi 频段') ?? '') || null;
  rec.connectivity.wifi = wifiBand;
  if (/HzHz$/i.test(wifiBand ?? '')) {
    addNote(rec, `Wi-Fi 频段原文「${wifiBand}」单位重复（官网笔误），按原文保留：connectivity.wifi`);
  }
  /* 充电方式 */
  const charge = [kv(raw, '充电盒无线充电'), kv(raw, '快充')].filter(Boolean).map(tidy);
  if (charge.length) {
    rec.specs = { ...(rec.specs ?? {}), 'battery.chargingMethods': charge };
    rec.provenance['battery.chargingMethods'] = HW;
  }
  /* 官网自带发布日期（月精度）→ note 供取证交叉验证 */
  const rel = kv(raw, '发布日期');
  if (rel) addNote(rec, `官网关键参数自带发布日期「${tidy(rel)}」（月精度）`);

  pushOfficial(rec, '降噪', anc);
  pushOfficial(rec, '整体续航', kv(raw, '整体续航'));
  pushOfficial(rec, '音频协议', kv(raw, '音频协议'));
  /* 音箱版式没有对应契约字段的项，原文进 rawOfficial（不丢、不猜、不硬塞语义相近的字段）：
   * 「组合立体声」是两台音箱配左右声道，不是空间音频；麦克风/出音方式/语音通话/红外控制
   * 在 audio schema 里也没有字段。 */
  for (const k of ['出音方式', '麦克风', '组合立体声', '语音通话', '红外控制']) {
    pushOfficial(rec, k, kv(raw, k));
  }

  put(rec, 'body.budWeightG', rec.body.budWeightG, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.waterResistance', rec.body.waterResistance, HW);
  put(rec, 'battery.budHours', rec.battery.budHours, HW);
  put(rec, 'battery.withCaseHours', rec.battery.withCaseHours, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);

  return rec;
}

/** 通道 X7：小米显示器（category='display'，schema data/schemas/display.json） */
function mapXiaomiMonitor(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: /REDMI/i.test(name) ? 'REDMI 显示器' : 'Xiaomi 显示器',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'display';

  rec.display.sizeIn = parseInch(kv(raw, '屏幕尺寸'));
  rec.display.type = normalizeType(kv(raw, '面板类型') ?? '') || null;
  rec.display.resolutionPx = parseResolution(kv(raw, '屏幕分辨率'));
  const hz = allNums(kv(raw, '最高刷新率') ?? kv(raw, '刷新率'));
  rec.display.refreshHz = hz.length ? String(Math.max(...hz)) : null;
  /* 接口：「HDMI、DP」→ ports 数组 */
  const portsText = kv(raw, '接口');
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/[、,，]/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }

  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);

  return rec;
}

/** 通道 X8：小米路由器（category='network'，schema data/schemas/network.json） */
function mapXiaomiRouter(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: '路由',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'network';

  rec.connectivity.wifi = [
    kv(raw, '无线协议'),
    kv(raw, '无线速率'),
  ].filter(Boolean).map(tidy).join(' | ') || null;
  const portsText = kv(raw, '整机接口');
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/[、,，/]/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }
  rec.chipset.name = tidy(kv(raw, 'CPU') ?? '') || null;
  const ramM = tidy(kv(raw, '内存') ?? '').match(/([\d.]+)\s*(MB|GB)/i);
  if (ramM) {
    rec.memory.ramGb = [
      ramM[2].toUpperCase() === 'GB' ? Number(ramM[1]) : Math.round((Number(ramM[1]) / 1024) * 100) / 100,
    ];
    put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  }
  const cpu = kv(raw, 'CPU');
  pushOfficial(rec, '天线', kv(raw, '天线'));
  pushOfficial(rec, 'CPU', cpu);

  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);

  return rec;
}

/* ── 家电品类路由与字段表（2026-10-27 家电批）────────────────────────────
 * 背景：官网「关键参数」随品类完全不同，此前只有洗衣机拆出了专用 schema，
 * 其余家电的特有参数整块塞进 rawOfficial —— 详情页只剩名字 + 通用字段
 * （三维/能效/噪音），用户看到的就是「只有名字、没有详细参数」。
 * 现在按官方商品名把家电路由到各自的品类（每个品类一份 schema），
 * 官网给的每个键按下面的显式表落位；没落位的键仍进 rawOfficial（不丢原文）。
 * 纪律：解析不出数值的字段一律留 null（如「变温室容积=-L」），不估算、不补 0。
 */
const APPLIANCE_FAMILY_RULES = [
  ['washer', (n) => /洗衣机|洗烘一体机/.test(n) && !/洗碗机|洗地机/.test(n)],
  ['fridge', (n) => /冰箱/.test(n)],
  /* 「空调伴侣」是插座式遥控配件、不是空调本体（官网把它列在家电目录下） */
  ['aircon', (n) => /空调/.test(n) && !/伴侣/.test(n)],
  ['aircare', (n) => /空气净化器|净化器/.test(n)],
  /* 除湿机/加湿器/蒸发式冷风扇：核心参数是除湿量/加湿量/水箱/风量，home 装不下 */
  ['climate', (n) => /加湿器|除湿机|冷风扇/.test(n)],
  ['waterpurifier', (n) => /净水器|净饮机|净水机/.test(n)],
  ['cleaner', (n) => /洗地机|吸尘器|扫地机器人|扫拖机器人|除螨仪/.test(n)],
  [
    'kitchen',
    (n) =>
      /电饭煲|电压力锅|油烟机|烟灶|微波炉|电水壶|电热水壶|电磁炉|洗碗机|空气炸锅|蒸烤箱|蒸烤一体机/.test(
        n,
      ),
  ],
  ['lock', (n) => /门锁/.test(n)],
];

function applianceFamilyOf(name) {
  for (const [id, test] of APPLIANCE_FAMILY_RULES) if (test(name)) return id;
  return 'home';
}

/** 产品类型由官方商品名的品类词判定（不是参数推算）；顺序敏感：「烟灶套装」先于「油烟机」 */
const APPLIANCE_TYPE_RULES = {
  cleaner: [
    [/洗地机/, '洗地机'],
    [/吸尘器/, '吸尘器'],
    [/扫地机器人|扫拖机器人/, '扫地机器人'],
    [/除螨仪/, '除螨仪'],
  ],
  kitchen: [
    [/烟灶套装/, '烟灶套装'],
    [/油烟机|烟机/, '油烟机'],
    [/电饭煲|电压力锅/, '电饭煲'],
    [/微波炉/, '微波炉'],
    [/电热水壶|电水壶/, '电水壶'],
    [/电磁炉/, '电磁炉'],
    [/洗碗机/, '洗碗机'],
    [/空气炸锅/, '空气炸锅'],
    [/蒸烤箱|蒸烤一体机/, '蒸烤箱'],
  ],
  climate: [
    [/净化加湿器/, '净化加湿器'],
    [/加湿器/, '加湿器'],
    [/除湿机/, '除湿机'],
    [/冷风扇/, '冷风扇'],
  ],
};

/** 多筒容量原文清洗：「大筒10kg、小筒0.5kg +0.5kgkg」→ 去重复 kg、去 + 两侧空格 */
function cleanWasherCapacity(value) {
  return tidy(value ?? '')
    .replace(/kgkg/gi, 'kg')
    .replace(/\s*\+\s*/g, '+');
}

/** 官网原文首个数值（「实测值949m³/h」→949、「21(主电机)Kpa」→21）；无数字 → null */
const firstNum = (text) => {
  const m = tidy(text ?? '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
/** 时间取「N秒」里的 N（不能取首个数字：「接满150ml水杯时间=3秒」首数是 150） */
const secondsNum = (text) => {
  const m = tidy(text ?? '').match(/(\d+(?:\.\d+)?)\s*秒/);
  return m ? Number(m[1]) : null;
};
/** 千克 → 克（官网「主机重量=5.14kg」）；识别不出 kg 单位 → null */
const kgToG = (text) => {
  const m = tidy(text ?? '').match(/(\d+(?:\.\d+)?)\s*kg/i);
  return m ? Math.round(Number(m[1]) * 1000) : null;
};
const spaceList = (text) => tidy(text ?? '').split(/[\s、,，/]+/).map(tidy).filter(Boolean);

/**
 * 家电字段表：`[路径, 官网键, 取值方式]`。
 *   text / num / seconds / kgToG / spaceList / singleList / slashListAll
 * 数值方式识别不出就留 null（不写 0）。
 */
const APPLIANCE_FIELD_MAP = {
  washer: {
    text: [
      ['washer.type', ['产品类型']],
      ['washer.washCapacity', ['洗涤容量'], cleanWasherCapacity],
      ['washer.dryCapacity', ['烘干容量'], cleanWasherCapacity],
      ['washer.motor', ['电机类型']],
      ['washer.sterilization', ['除菌方式']],
      ['washer.drainType', ['排水方式']],
      ['washer.doorType', ['开门方式']],
      ['washer.smart', ['智能互联']],
      ['washer.drumMaterial', ['内筒材质']],
      ['washer.dryMethod', ['烘干方式']],
    ],
    num: [
      ['washer.washRatio', ['洗净比'], 'num'],
      ['washer.maxSpinRpm', ['最高转速'], 'num'],
    ],
  },
  fridge: {
    text: [
      ['fridge.doorType', ['门体类型']],
      ['fridge.placement', ['放置方式']],
      ['fridge.coolingType', ['制冷方式']],
      ['fridge.coolingSystem', ['制冷系统']],
      ['fridge.compressor', ['压缩机类型']],
      ['fridge.panelMaterial', ['面板材质']],
      ['fridge.purifyTech', ['净化技术']],
      ['fridge.freshTech', ['保鲜技术']],
      ['fridge.smart', ['智能互联']],
    ],
    num: [
      ['fridge.totalCapacityL', ['总容量'], 'num'],
      ['fridge.fridgeCapacityL', ['冷藏室容积'], 'num'],
      ['fridge.freezerCapacityL', ['冷冻室容积'], 'num'],
      ['fridge.variableCapacityL', ['变温室容积'], 'num'],
      ['fridge.dailyEnergyKwh', ['耗电量'], 'num'],
    ],
  },
  aircon: {
    text: [
      ['aircon.style', ['款式']],
      ['aircon.series', ['产品系列']],
      ['aircon.coolingHeating', ['冷暖类型']],
      ['aircon.inverter', ['定频/变频']],
      ['aircon.applicableArea', ['适用面积']],
      ['aircon.voiceControl', ['是否支持小爱同学控制']],
    ],
    num: [
      ['aircon.horsepower', ['匹数'], 'num'],
      ['aircon.apf', ['APF值'], 'num'],
      ['aircon.coolingCapacityW', ['制冷量（整机）'], 'num'],
      ['aircon.heatingCapacityW', ['制热量（整机）'], 'num'],
      ['aircon.warrantyYears', ['整机质保期'], 'num'],
    ],
  },
  aircare: {
    text: [
      ['aircare.scene', ['建议场所']],
      ['aircare.purifyType', ['净化类型']],
      ['aircare.measure', ['测量功能']],
      ['aircare.filterType', ['滤网类型']],
    ],
    num: [
      ['aircare.maxAreaM2', ['建议最大适用面积'], 'num'],
      ['aircare.cadrParticle', ['颗粒物CADR'], 'num'],
      ['aircare.cadrFormaldehyde', ['甲醛CADR'], 'num'],
    ],
  },
  cleaner: {
    text: [
      ['cleaner.selfClean', ['滚刷自清洁']],
      ['cleaner.dryMethod', ['干燥方式']],
      ['cleaner.edgeClean', ['滚刷贴边']],
      ['cleaner.brushType', ['滚刷类型']],
      ['cleaner.sterilize', ['除菌方式']],
      ['cleaner.innovation', ['创新技术']],
    ],
    num: [
      ['cleaner.cleanWaterMl', ['净水容量'], 'num'],
      ['cleaner.wasteWaterMl', ['污水容量'], 'num'],
      ['cleaner.suctionKpa', ['最大吸力'], 'num'],
      ['cleaner.runtimeMin', ['续航时间'], 'num'],
      ['cleaner.batteryMah', ['电池标称容量'], 'num'],
      ['body.weightG', ['主机重量'], 'kgToG'],
    ],
  },
  kitchen: {
    text: [
      ['kitchen.heatingMethod', ['加热方式']],
      ['kitchen.innerPot', ['内胆材质']],
      ['kitchen.functions', ['功能']],
      ['kitchen.applicablePeople', ['适用人数']],
      ['kitchen.hoodStyle', ['烟机款式']],
      ['kitchen.hoodSmart', ['烟机智能控制']],
      ['kitchen.panelMaterial', ['面板材质']],
    ],
    num: [
      ['kitchen.capacityL', ['容量'], 'num'],
      ['kitchen.airVolume', ['风量风速'], 'num'],
      ['kitchen.maxStaticPressure', ['最大静压'], 'num'],
      ['kitchen.gasPowerKw', ['火力/气源'], 'num'],
      ['kitchen.thermalEfficiency', ['热效率'], 'num'],
    ],
  },
  waterpurifier: {
    text: [
      ['waterpurifier.filterTech', ['主过滤技术']],
      ['waterpurifier.faucet', ['龙头类型']],
      ['waterpurifier.pureWasteRatio', ['纯废水比']],
      ['waterpurifier.filterLife', ['滤芯寿命']],
      ['waterpurifier.zeroStaleWater', ['零陈水']],
      ['waterpurifier.appSupport', ['米家APP']],
      ['waterpurifier.warranty', ['质保']],
    ],
    num: [
      ['waterpurifier.flowRateLpm', ['常温水流速'], 'num'],
      ['waterpurifier.fillCupTimeS', ['接满150ml水杯时间'], 'seconds'],
      ['waterpurifier.filterCount', ['滤芯数量'], 'num'],
    ],
    list: [['waterpurifier.certifications', ['母婴净水器', '特优水质'], 'slashListAll']],
  },
  climate: {
    text: [
      ['climate.control', ['操控方式']],
      ['climate.placement', ['放置方式']],
      ['climate.inverter', ['变频/定频']],
      ['climate.function', ['功能']],
      ['climate.oscillationAngle', ['摇头角度']],
    ],
    num: [
      ['climate.dehumidifyLpd', ['高温除湿量', '除湿量'], 'num'],
      ['climate.dehumidifyNominalKgph', ['名义除湿量'], 'num'],
      ['climate.humidifyMlph', ['额定加湿量', '加湿量'], 'num'],
      ['climate.tankL', ['水箱容量'], 'num'],
      ['climate.airflowM3h', ['风量'], 'num'],
      ['body.weightG', ['产品净重'], 'kgToG'],
    ],
  },
  lock: {
    text: [
      ['lock.lockCylinder', ['锁芯']],
      ['lock.form', ['门锁形态']],
      ['lock.indoorLock', ['室内反锁']],
      ['lock.doorbell', ['门铃']],
      ['lock.batteryLife', ['门锁续航']],
      ['lock.cameraAngle', ['摄像头角度']],
      ['lock.cameraBattery', ['摄像头续航']],
      ['lock.connectivity', ['连接方式']],
      ['lock.frontPanel', ['前面板材质']],
      ['lock.frameMaterial', ['中框材质']],
    ],
    list: [
      ['lock.unlockMethods', ['开锁方式'], 'spaceList'],
      ['body.colors', ['门锁颜色'], 'singleList'],
    ],
  },
};

/** 家电品类集合（含 home：机顶盒/开关/插座等没有专用字段表的一律留在这里） */
const APPLIANCE_CATS = new Set([
  'home',
  'washer',
  'fridge',
  'aircon',
  'aircare',
  'climate',
  'cleaner',
  'kitchen',
  'waterpurifier',
  'lock',
]);

/** 家电字段写入：body.* 落 v1 组（拍平由 sync 统一做），其余直接落 specs */
function setApplianceField(rec, path, value) {
  if (value === null || value === undefined || value === '') return;
  if (Array.isArray(value) && value.length === 0) return;
  if (path.startsWith('body.')) rec.body[path.slice('body.'.length)] = value;
  else rec.specs = { ...(rec.specs ?? {}), [path]: value };
  rec.provenance[path] = HW;
}

/**
 * 该品类 schema 是否注册了这个路径。
 * 用于能效/噪音这类「跨家电通用、但不是每个品类字段表都收」的字段：
 * 未注册就写进 specs 会被闸门当未注册键拦下（整条管线拒绝写盘），
 * 所以这里先查注册面，不收的键继续走 rawOfficial（原文不丢）。
 */
function schemaHas(category, path) {
  return fieldMap(loadSchema(category)).has(path);
}

/** 通道 X9：米家家电（按名称路由到各自品类，schema 见 data/schemas/<品类>.json）。
 *
 * 尺寸语义：官网按品类给「尺寸」「宽*深*高」两种键，数值序都是 宽、深、高。
 * 能效/噪音是跨家电的通用字段，统一落 power.ratingLevel / features.noiseDb。
 */
function mapXiaomiAppliance(rawProduct) {
  const raw0 = rawProduct.raw ?? {};
  const name = stripInvisible(rawProduct.name);
  /* 键名去尾空格（官网「颗粒物CADR  」实测带两个尾空格，精确匹配会静默漏取） */
  const raw = {};
  for (const [k, v] of Object.entries(raw0)) if (!k.startsWith('_')) raw[k.trim()] = realValue(v);
  const family = applianceFamilyOf(name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'xiaomi',
    line: name.startsWith('米家') ? '米家' : 'Xiaomi',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = family; // 数据源层显式声明品类

  const consumed = new Set();

  /* 尺寸：「524*582*1808mm」（冰箱尺寸）与「宽*深*高 = 598*610*850」（洗衣机）两种键，
   * 数值序一致：宽、深、高 */
  const dimsText = raw['宽*深*高'] ?? raw['尺寸'] ?? '';
  const dims = (tidy(dimsText).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (dims.length >= 3) {
    rec.body.widthMm = dims[0];
    rec.body.depthMm = dims[1];
    rec.body.heightMm = dims[2];
    addNote(rec, `机身三维取官网「${tidy(dimsText)}」（数值序：宽、深、高）`);
    consumed.add(raw['宽*深*高'] !== undefined ? '宽*深*高' : '尺寸');
  }
  /* 能效等级 → power.ratingLevel。官网原文混写（「一级」「1级」「1」「一级级」笔误、
   * 「灶具能效=1级能效」「无能效级」），契约字段做最小归一：数字/中文数字能提取的
   * 统一「N级」，否则直存原文（如「无能效级」）。 */
  const ratingKey = ['能效等级', '能效', '灶具能效'].find((k) => raw[k] !== undefined);
  if (ratingKey && schemaHas(family, 'power.ratingLevel')) {
    const ratingText = tidy(raw[ratingKey]);
    const cnDigit = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
    const level = ratingText.match(/(\d+)\s*级?/) ?? ratingText.match(/([一二三四五])级?/);
    const digit = level
      ? cnDigit[level[1]] ?? Number(level[1])
      : /^\d+$/.test(ratingText)
        ? Number(ratingText)
        : null;
    const normalized = digit !== null && digit !== undefined ? `${digit}级` : ratingText;
    rec.specs = { ...(rec.specs ?? {}), 'power.ratingLevel': normalized };
    rec.provenance['power.ratingLevel'] = HW;
    if (normalized !== ratingText) {
      addNote(rec, `能效等级原文「${ratingText}」归一为「${normalized}」（官网混写/笔误，值语义不变）`);
    }
    consumed.add(ratingKey);
  }
  /* 噪音 → features.noiseDb（首数值）。洗衣机「洗涤噪音值」、烟机「噪音(声功级)」、
   * 净水器「噪音」，键名随品类不同，取值口径一致（官网标称 dB）。 */
  const noiseKey = ['噪音值', '洗涤噪音值', '噪音(声功级)', '噪音'].find(
    (k) => raw[k] !== undefined,
  );
  if (noiseKey && schemaHas(family, 'features.noiseDb')) {
    const noise = allNums(raw[noiseKey]);
    if (noise.length) {
      rec.specs = { ...(rec.specs ?? {}), 'features.noiseDb': noise[0] };
      rec.provenance['features.noiseDb'] = HW;
    }
    consumed.add(noiseKey);
  }

  /* 产品类型：由官方商品名判定（仅清洁/厨电这类一家多子族的品类需要） */
  const typeRules = APPLIANCE_TYPE_RULES[family];
  if (typeRules) {
    const hit = typeRules.find(([re]) => re.test(name));
    if (hit) setApplianceField(rec, `${family}.type`, hit[1]);
  }

  /* 品类字段表：官网逐键落位 */
  const map = APPLIANCE_FIELD_MAP[family];
  if (map) {
    for (const [path, keys, transform] of map.text ?? []) {
      const key = keys.find((k) => raw[k] !== undefined);
      if (!key) continue;
      const text = transform ? transform(raw[key]) : tidy(raw[key]);
      setApplianceField(rec, path, text);
      consumed.add(key);
    }
    for (const [path, keys, kind] of map.num ?? []) {
      const key = keys.find((k) => raw[k] !== undefined);
      if (!key) continue;
      const value =
        kind === 'seconds' ? secondsNum(raw[key])
        : kind === 'kgToG' ? kgToG(raw[key])
        : firstNum(raw[key]);
      setApplianceField(rec, path, value);
      consumed.add(key);
    }
    for (const [path, keys, kind] of map.list ?? []) {
      const present = keys.filter((k) => raw[k] !== undefined);
      if (!present.length) continue;
      let list = [];
      if (kind === 'slashListAll') {
        list = present.flatMap((k) => tidy(raw[k]).split(/\s*\/\s*/)).map(tidy).filter(Boolean);
      } else if (kind === 'spaceList') {
        list = spaceList(raw[present[0]]);
      } else {
        list = [tidy(raw[present[0]])].filter(Boolean);
      }
      if (list.length) setApplianceField(rec, path, [...new Set(list)]);
      present.forEach((k) => consumed.add(k));
    }
  }

  /* 官网给了但本品类未落位的键 → 原文进 rawOfficial（不丢、不猜） */
  const special = Object.keys(raw).filter((k) => !consumed.has(k));
  if (special.length) {
    pushOfficial(
      rec,
      '品类特有参数',
      special.map((k) => `${k}：${raw[k]}`).join(' | '),
      900,
    );
    addNote(
      rec,
      `官网关键参数原文见 rawOfficial（${special.length} 项；本行已按 ${family} schema 落位可量化项）`,
    );
  }

  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);

  return rec;
}

/** 通道 X10：小米历史机型（检索取证式，data/curated/xiaomi-history.json）。
 *
 * 数据来自检索摘要（ZOL/IT之家/快科技等，逐台 sourceUrl），不是官网结构化接口：
 *   - 三维原文顺序随来源不一（「162.6×74.8×8.96」长宽厚 / 「71.5*7.98*152.8」宽厚高）
 *     → 按 高≥宽≥厚 确定性归位（手机三维恒有 高>宽>厚），是排序不是估算；
 *   - 电池容量原文未标典型/额定口径 → capacityCaliber 留 null，note 说明；
 *   - 发布日期在 curated 条目里随批产出，由 _work 脚本同步进 release-dates.json
 *     （日期单一写入路径纪律：normalize 不填 releaseDate，留给 sync 回填）。
 * provenance 统一记 'retrieval'——「这个数从哪来」的答案是检索取证源。
 */
const RETRIEVAL = 'retrieval';
const HISTORY_BATCH_AT = '2026-10-25T00:00:00.000Z';

function mapXiaomiHistory(entry) {
  const name = stripInvisible(entry.name);
  /* 家电条目（curated 里旧的是 home/washer）按官方商品名重新路由到 2026-10-27 拆出的
   * 专用品类：同一台机器不能一半在 home、一半在新品类里。非家电名一律落到 home，
   * 此时仍沿用条目自带的 category（phone/tablet/…）。 */
  const family = applianceFamilyOf(name);
  const declared = entry.category ?? 'phone';
  const category =
    declared === 'home' || declared === 'washer'
      ? family
      : declared === 'phone' && family !== 'home'
        ? family
        : declared;
  const isAppliance = APPLIANCE_CATS.has(category);
  const rec = emptyRecord({
    id: entry.id,
    // 品牌取条目值（M4 起华为历史条目共用本映射器），缺省 xiaomi（既有小米批次）
    brand: entry.brand ?? 'xiaomi',
    // 系列分组：小米按 MIX/Civi/Note/Turbo/K/数字；华为按 Mate/P/nova/Pocket
    line:
      (entry.brand ?? 'xiaomi') === 'huawei'
        ? /Pocket/i.test(name)
          ? 'Pocket'
          : /Mate X/i.test(name)
            ? 'Mate 折叠'
            : /Mate/i.test(name)
              ? 'Mate'
              : /nova/i.test(name)
                ? 'nova'
                : /P\s?\d/i.test(name)
                  ? 'P'
                  : '华为'
        : /MIX/i.test(name)
          ? 'MIX'
          : /Civi/i.test(name)
            ? 'Civi'
            : /Note/i.test(name)
              ? 'REDMI Note'
              : /Turbo/i.test(name)
                ? 'REDMI Turbo'
                : /REDMI|Redmi/i.test(name)
                  ? 'REDMI K'
                  : '小米数字',
    name,
    nameZh: name,
    granularity: 'curated-retrieval',
    firstSeenAt: HISTORY_BATCH_AT,
    lastSeenAt: HISTORY_BATCH_AT,
  });
  rec.category = category; // 数据源层显式声明品类（M3 起平板/穿戴条目自带品类；家电按名称路由）
  const cat = category;
  // 家电条目的产品线与小米手机那条正则无关（否则冰箱/空调会被标成「小米数字」）
  if (isAppliance) rec.line = name.startsWith('米家') ? '米家' : 'Xiaomi';

  /* 屏幕：尺寸原文可能是「6.53英寸」「8.01（内屏）/ 6.52（外屏）」→ 取首个数字
   * （折叠屏取内屏，note 已在 curated 源注明） */
  const sizeNums = entry.screenSizeIn != null
    ? (String(entry.screenSizeIn).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    : [];
  rec.display.sizeIn = sizeNums.length ? sizeNums[0] : null;
  rec.display.resolutionPx = entry.screenResolution
    ? parseResolution(entry.screenResolution)
    : null;
  /* 刷新率：可能是数字或「60」/「60Hz」字符串 → 取首个数字再转字符串（闸门数字校验） */
  const hzNums = entry.screenRefreshHz != null
    ? (String(entry.screenRefreshHz).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    : [];
  rec.display.refreshHz = hzNums.length ? String(hzNums[0]) : null;
  rec.display.type = entry.screenType ? normalizeType(entry.screenType) : null;
  rec.chipset.name = entry.chipset ? tidy(entry.chipset) : null;
  rec.memory.ramGb = Array.isArray(entry.ramGb) && entry.ramGb.length ? [...entry.ramGb] : null;
  /* 存储档位：数组直取；字符串（穿戴的「4」）→ 提取数字数组 */
  const stor = Array.isArray(entry.storageGb)
    ? entry.storageGb
    : entry.storageGb != null
      ? (String(entry.storageGb).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
      : null;
  rec.memory.storageGb = stor && stor.length ? stor : null;
  /* 电池：数字或「6000mAh (typ)」字符串 → 数值 + 从原文识别口径（typ/典型→typical，
   * rated/额定→rated，识别不出→unmarked，不猜） */
  let capNums = [];
  let capText = '';
  if (entry.batteryMah != null) {
    capText = String(entry.batteryMah);
    capNums = (capText.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  }
  rec.battery.capacityMah = capNums.length ? capNums[0] : null;
  if (rec.battery.capacityMah != null) {
    rec.battery.capacityCaliber = /typ|典型/i.test(capText)
      ? 'typical'
      : /rated|额定/i.test(capText)
        ? 'rated'
        : 'unmarked';
    if (rec.battery.capacityCaliber === 'unmarked') {
      addNote(rec, '电池容量为检索摘录数值，原文未标典型/额定口径 → capacityCaliber=unmarked');
    }
  }
  rec.battery.wiredChargeW = entry.wiredChargeW ?? null;
  /* 重量：数字或「约27g（含腕带）」字符串 → 首个数值（口径差异在 curated note） */
  const weightNums = entry.weightG != null
    ? (String(entry.weightG).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    : [];
  rec.body.weightG = weightNums.length ? weightNums[0] : null;

  /* 三维归位：原文顺序随来源不一（长宽厚/宽厚高/高宽厚），且折叠屏展开态数字
   * 可能混入 → 只取**前三个数字**（curated 源纪律：dimsMm 必须是单组三元）。
   * 品类差异：手机/平板按 高≥宽≥厚 归位 height/width/thickness；
   * 穿戴按表壳口径 caseSizeMm=前两数最大值、thicknessMm=第三数
   * （穿戴 schema 无 height/width，手表直径×直径×厚/手环长×宽×厚均适配）。 */
  const dims = Array.isArray(entry.dimsMm)
    ? entry.dimsMm.map(Number).slice(0, 3)
    : entry.dimsMm
      ? (tidy(entry.dimsMm).match(/\d+(?:\.\d+)?/g) ?? []).map(Number).slice(0, 3)
      : [];
  if (dims.length === 3) {
    if (cat === 'wearable') {
      rec.body.caseSizeMm = Math.max(dims[0], dims[1]);
      rec.body.thicknessMm = dims[2];
      addNote(rec, `三维原文「${tidy(entry.dimsMm)}」按穿戴表壳口径归位：caseSize=前两数最大值、thickness=第三数`);
    } else if (cat === 'laptop') {
      // 笔记本契约用 weightKg（长宽厚未入 laptop schema）→ dims 不写，原文留 note
      addNote(rec, `三维原文「${tidy(entry.dimsMm)}」未入契约（laptop schema 无长宽厚字段），见本 note`);
    } else if (APPLIANCE_CATS.has(cat)) {
      // 家电契约是 height/width/depth（深），无 thickness；洗衣机（washer）同口径。
      // 不排序——curated 源已人工归一为 高×宽×深 字面顺序（空调内机 宽>高、
      // 洗衣机 深>宽，机械排序必然错位），note 保留原始口径。
      rec.body.heightMm = dims[0];
      rec.body.widthMm = dims[1];
      rec.body.depthMm = dims[2];
      addNote(rec, `三维按 curated 源归一后的 高×宽×深 字面顺序落位，原始口径见 note（${tidy(entry.dimsMm)}）`);
    } else if (cat === 'media') {
      // 电视：宽>高>厚，curated 源归一为 高×宽×厚 字面顺序（不排序，排序会把宽当高）。
      // media schema 无 thicknessMm（Apple TV/盒子量级无厚度字段）→ 厚度不入契约，留 note。
      rec.body.heightMm = dims[0];
      rec.body.widthMm = dims[1];
      addNote(rec, `三维按 curated 源归一后的 高×宽×厚 字面顺序落位（电视 宽>高，不排序），厚度 ${dims[2] ?? '—'}mm 未入契约`);
    } else {
      const [h, w, t] = [...dims].sort((a, b) => b - a);
      rec.body.heightMm = h;
      rec.body.widthMm = w;
      rec.body.thicknessMm = t;
      addNote(rec, `三维原文「${tidy(entry.dimsMm)}」顺序随来源不一，取前三数按 高≥宽≥厚 归位`);
    }
  }

  /* 笔记本（M3 续批）：契约用 capacityWh/weightKg，与手机的 mAh/g 不同 */
  if (cat === 'laptop') {
    rec.battery.capacityMah = null;
    rec.battery.capacityCaliber = null;
    rec.battery.capacityWh = entry.batteryWh ?? null;
    rec.body.weightG = null;
    rec.body.weightKg = entry.weightKg ?? null;
    if (entry.adapterW != null) {
      rec.specs = { ...(rec.specs ?? {}), 'power.adapterW': entry.adapterW };
      rec.provenance['power.adapterW'] = RETRIEVAL;
    }
    put(rec, 'battery.capacityWh', rec.battery.capacityWh, RETRIEVAL);
    put(rec, 'body.weightKg', rec.body.weightKg, RETRIEVAL);
  }

  /* 家电品类（home 除外）的 schema 没有屏幕/芯片/内存/电池分组。
   * provenance 只登记来源、**不阻止拍平**：flattenSpecs 会把记录里这些组的非空值
   * 原样搬进 specs，未注册键会被闸门拦下（如扫地机器人条目带的 chipset）。
   * 所以必须清空值本身，不能只跳过 put。 */
  if (isAppliance && cat !== 'home') {
    rec.display.sizeIn = null;
    rec.display.type = null;
    rec.display.resolutionPx = null;
    rec.display.refreshHz = null;
    rec.chipset.name = null;
    rec.memory.ramGb = [];
    rec.memory.storageGb = [];
    rec.battery.capacityMah = null;
    rec.battery.capacityCaliber = null;
    rec.battery.wiredChargeW = null;
    rec.battery.wirelessChargeW = null;
  }

  /* 契约字段按品类落位（各自 schema 注册面不同，跨品类乱写会被闸门拦未注册键）：
   *   display 组        仅 phone/tablet/laptop（network/home/audio 无屏或无该组）
   *   chipset           phone/tablet/laptop/network（audio/home 的芯片口径不稳，留 note）
   *   memory            phone/tablet/laptop/network/wearable
   *   battery.capacity  phone/tablet/wearable（laptop 用 Wh 见上；audio 用 budHours）
   *   wiredChargeW      phone/tablet
   *   body.weightG      phone/tablet/wearable/audio
   *   三维               phone/tablet/media/家电（其余见 dims 分支） */
  const hasDisplay = ['phone', 'tablet', 'laptop', 'wearable', 'home', 'media', 'display'].includes(cat);
  if (hasDisplay) {
    put(rec, 'display.sizeIn', rec.display.sizeIn, RETRIEVAL);
    putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, RETRIEVAL, ['w', 'h']);
    put(rec, 'display.refreshHz', rec.display.refreshHz, RETRIEVAL);
    put(rec, 'display.type', rec.display.type, RETRIEVAL);
  }
  // chipset.name：audio 口径不稳、washer 与 2026-10-27 拆出的家电品类无芯片字段
  const NO_CHIPSET = new Set(['audio', 'washer', 'fridge', 'aircon', 'aircare', 'cleaner', 'kitchen', 'waterpurifier', 'lock']);
  if (!NO_CHIPSET.has(cat)) {
    put(rec, 'chipset.name', rec.chipset.name, RETRIEVAL);
  }
  if (!['home', 'audio'].includes(cat) && !NO_CHIPSET.has(cat)) {
    put(rec, 'memory.ramGb', rec.memory.ramGb, RETRIEVAL);
    put(rec, 'memory.storageGb', rec.memory.storageGb, RETRIEVAL);
  }
  if (['phone', 'tablet', 'wearable'].includes(cat)) {
    put(rec, 'battery.capacityMah', rec.battery.capacityMah, RETRIEVAL);
    put(rec, 'battery.capacityCaliber', rec.battery.capacityCaliber, RETRIEVAL);
  }
  if (['phone', 'tablet'].includes(cat)) {
    put(rec, 'battery.wiredChargeW', rec.battery.wiredChargeW, RETRIEVAL);
  }
  // body.weightG 五类 schema 全注册
  put(rec, 'body.weightG', rec.body.weightG, RETRIEVAL);
  if (['phone', 'tablet', 'wearable'].includes(cat)) {
    put(rec, 'body.thicknessMm', rec.body.thicknessMm, RETRIEVAL);
  }
  if (['phone', 'tablet', 'media'].includes(cat)) {
    put(rec, 'body.heightMm', rec.body.heightMm, RETRIEVAL);
    put(rec, 'body.widthMm', rec.body.widthMm, RETRIEVAL);
  }
  if (APPLIANCE_CATS.has(cat)) {
    put(rec, 'body.heightMm', rec.body.heightMm, RETRIEVAL);
    put(rec, 'body.widthMm', rec.body.widthMm, RETRIEVAL);
    put(rec, 'body.depthMm', rec.body.depthMm, RETRIEVAL);
    // 能效/噪音不是每个家电 schema 都收（如 lock 两者皆无、aircon 无噪音）
    if (entry.ratingLevel != null && schemaHas(cat, 'power.ratingLevel')) {
      rec.specs = { ...(rec.specs ?? {}), 'power.ratingLevel': tidy(entry.ratingLevel) };
      rec.provenance['power.ratingLevel'] = RETRIEVAL;
    }
    if (entry.noiseDb != null && schemaHas(cat, 'features.noiseDb')) {
      rec.specs = { ...(rec.specs ?? {}), 'features.noiseDb': Number(entry.noiseDb) };
      rec.provenance['features.noiseDb'] = RETRIEVAL;
    }
  }
  if (cat === 'network') {
    // 路由历史：无线规格是核心参数（schema connectivity.wifi 字符串）
    const wifi = entry.wifiSpec ? tidy(entry.wifiSpec) : null;
    if (wifi) {
      rec.specs = { ...(rec.specs ?? {}), 'connectivity.wifi': wifi };
      rec.provenance['connectivity.wifi'] = RETRIEVAL;
    }
  }
  if (cat === 'audio') {
    // 耳机历史：budHours/withCaseHours/budWeightG/anc/bluetooth（audio schema 注册面）
    if (entry.anc != null) {
      rec.specs = { ...(rec.specs ?? {}), 'audio.anc': !!entry.anc };
      rec.provenance['audio.anc'] = RETRIEVAL;
    }
    if (entry.budHours != null) {
      rec.battery.budHours = entry.budHours;
      put(rec, 'battery.budHours', rec.battery.budHours, RETRIEVAL);
    }
    if (entry.withCaseHours != null) {
      rec.battery.withCaseHours = entry.withCaseHours;
      put(rec, 'battery.withCaseHours', rec.battery.withCaseHours, RETRIEVAL);
    }
    if (entry.budWeightG != null) {
      rec.body.budWeightG = entry.budWeightG;
      put(rec, 'body.budWeightG', rec.body.budWeightG, RETRIEVAL);
    }
    if (entry.bluetooth) {
      rec.connectivity.bluetooth = tidy(entry.bluetooth);
      put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, RETRIEVAL);
    }
  }

  if (entry.sourceUrl) {
    // 取证 URL 不是参数，不进 specs（闸门拦未注册键）——进 rawOfficial 可回溯
    rec.rawOfficial['取证来源'] = `${entry.sourceTitle ?? ''} ${entry.sourceUrl}`.trim();
  }

  return rec;
}

export {
  mapXiaomi,
  mapXiaomiTablet,
  mapXiaomiLaptop,
  mapXiaomiVision,
  mapXiaomiWearable,
  mapXiaomiAudio,
  mapXiaomiMonitor,
  mapXiaomiRouter,
  mapXiaomiAppliance,
  mapXiaomiHistory,
};
