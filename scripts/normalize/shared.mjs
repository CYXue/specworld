/**
 * 规范化层共享工具与常量（从 index.mjs 抽出的纯函数，零依赖）。
 * 品牌映射文件（brands/huawei.mjs、brands/apple.mjs）与 index.mjs 都从这里取。
 */
import {
  firstNumber as firstNum,
  allNumbers as nums,
  parseCapacity,
  parseInch,
  parseMm,
  parsePpi,
  parseRefresh,
  parseResolution,
  parseStorageList,
  parseWatt,
  parseWeight,
  sliceByVariants,
  stripInvisible,
} from './parse.mjs';
const HW = 'huawei-official';
const AP = 'apple-official';
const AC = 'apple-compare';

/** 对比页矩阵里表示「该机型无此项」的占位符。原样保留在 raw 里，由规范化层丢弃 */
const PLACEHOLDERS = new Set(['-', '—', '–', '--', '不适用', '—不适用', '无', 'N/A', 'n/a']);

/* ══════════════════════════════════════════════════════════════════════════
 * 0. 通用小工具
 * ══════════════════════════════════════════════════════════════════════════ */

/** 官网节选：去掉零宽字符、修掉源头的一处多余引号、压平换行 */
const tidy = (s) =>
  stripInvisible(s)
    .replace(/^"+/, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

/** 占位符 / 空串 → undefined（等价「官网没给」） */
const realValue = (v) => {
  if (v === undefined || v === null) return undefined;
  const t = tidy(v);
  if (!t || PLACEHOLDERS.has(t)) return undefined;
  return t;
};

/** 单位换算后的瓦数：`60 瓦` → 60；`100 W` → 100。只认明确带瓦的写法，不认 V×A 推算 */
const wattOf = (t) => {
  const v = parseWatt(t);
  return v !== null && v > 0 ? v : null;
};

/**
 * 苹果 `外观` 原文 = `配色 | 材质设计 | 面板(正面) | 背板(背面) 一段图片描述`。
 * 图片描述里含有同样的关键词（「超瓷晶面板」），所以必须先切段再判定：
 *   · 配色段：顿号分隔、短、不含「面板/玻璃/金属/设计」
 *   · 材质段：含金属/玻璃/超瓷晶
 *   · 面板段：含「超瓷晶面板」且带 (正面)/(背面)
 */
function parseAppleAppearance(look) {
  const text = look.join(' | ');
  const segs = text
    .split(/\s*[|｜]\s*/)
    .map(tidy)
    .filter(Boolean)
    // 图片描述段（超过一句、带句号，或以机型名开头）一律排除
    .filter((s) => !/。/.test(s) && !/外观，|展示|机身中央|标志。/.test(s));

  const colorSeg = segs.find(
    (s) =>
      /、/.test(s) &&
      !/[（）()]/.test(s) &&
      !/(面板|玻璃|金属|设计|超瓷晶)/.test(s) &&
      s.length <= 40,
  );
  const colors = colorSeg
    ? colorSeg
        .split(/[、,，]/)
        .map(tidy)
        .filter(Boolean)
    : [];

  const designSeg = segs.find((s) => /(金属|超瓷晶|玻璃|面板)/.test(s) && !/[（）()]/.test(s));
  const material = designSeg ?? null;

  const panelSegs = segs.filter((s) => /超瓷晶面板/.test(s) && /[（(]/.test(s));
  const protection = panelSegs.length
    ? panelSegs.join(' | ')
    : (segs.find((s) => /超瓷晶|纳米纹理/.test(s)) ?? null);

  return { colors, material, protection, segments: segs };
}

/**
 * 屏幕像素密度。官网给 ppi 就用官网的；官网只给分辨率+尺寸时按标准公式推：
 *   ppi = √(w²+h²) / 对角英寸
 * 这是两组官网数字的纯计算，来源记 `derived`，并在 note 里写明官网未直接公布。
 * 官网标称对角英寸是圆角矩形标注值，实测与推算会在 ±2 ppi 内摆动（已用官网同时给出
 * 两者的 12 个样本核对过）。拿不到分辨率或尺寸时返回 null，绝不猜。
 */
function derivePpi(sizeIn, res) {
  if (!sizeIn || !res || !res.w || !res.h) return null;
  const v = Math.round(Math.sqrt(res.w * res.w + res.h * res.h) / sizeIn);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 分辨率：17 Pro 这类页面会给出 2622×1206 与 2868×1320 双值，取第一个 */
const pickFirstRes = (texts) => {
  for (const t of texts) {
    const r = t ? parseResolution(t) : null;
    if (r) return r;
  }
  return null;
};

/** 刷新率字符串：优先保留区间原文（`1-120`），区间不可得时退回上限 */
function refreshText(blob) {
  const parsed = parseRefresh(blob);
  return parsed ? parsed.text : null;
}

/** 官网的长句用中文逗号，字段值是给界面/比对用的短标签 → 统一成 ASCII 逗号 */
const normalizeType = (s) => (s ? tidy(s).replace(/，/g, ', ') : null);

/** 让 a[path] = value 同时登记来源；value 为「空」时不写（保持 null 语义） */
function put(record, path, value, source) {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return;
  record.provenance[path] = source;
}

/**
 * 对象型字段的 provenance 登记。
 *
 * 修复记录（2026-10-03，由 scripts/qa/coverage.mjs 抓到）：
 * 原实现叫 `putInto`，调用处一律写死 `.w` 后缀（`putInto(rec,'display.resolutionPx.w', ...)`），
 * 于是「登记了哪些子字段」这件事只存在于调用点的字面量里：
 *   · display.resolutionPx.h 从来没被登记过（0/60），高度同样没人管；
 *   · 换个对象型字段就会静默沿用 `.w`，不报错。
 *
 * 改成显式传子字段列表：登记结果不再依赖调用点的后缀习惯。
 * 父路径也一并登记，这样按父路径查provenance 的代码（如 sync/validate.mjs）
 * 不需要知道这个字段是对象型的。
 */
function putObject(record, path, value, source, subKeys) {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return;
  record.provenance[path] = source;
  for (const k of subKeys) {
    const v = value[k];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    record.provenance[`${path}.${k}`] = source;
  }
}

/**
 * 折叠屏/多形态标注的取值：官网会写成
 *   `折叠态：6.5 英寸；三屏态：10.2 英寸`
 *   `内屏：8 英寸 外屏：6.49 英寸`
 *   `外屏：5.4 英寸 | 内屏：7.7 英寸`
 * 契约字段是单值，取**第一条**（内屏/折叠态），其余记 note。
 * 判定「这是多形态」要比对标签，不能拿 `[内外三单双]` 去 split —— 那会把
 * 「内屏：6.3 英寸 | 外屏：3.5 英寸」切成单个汉字，parseInch 反而读不到数。
 * @returns {{text:string, multi:boolean}}
 */
function multiPartValue(text) {
  const s = stripInvisible(text);
  if (!s) return { text: '', multi: false };
  const LABEL = '(?:内屏|外屏|折叠态|展开态|三屏态|双屏态|单屏态)';
  if (/[|｜；;]/.test(s)) {
    const parts = s
      .split(/\s*[|｜；;]\s*/)
      .map(tidy)
      .filter(Boolean);
    return { text: parts[0] ?? s, multi: parts.length > 1 };
  }
  // 没有分隔符，但第二个形态标签以空格紧跟在后：`内屏：8 英寸 外屏：6.49 英寸`
  const m = s.match(new RegExp(`^([\\s\\S]*?)\\s+${LABEL}\\s*[:：]`));
  if (m && m[1]) return { text: tidy(m[1]), multi: true };
  return { text: s, multi: false };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 空记录骨架（保证每台机器的形状完全一致，前端不必做存在性判断）
 * ══════════════════════════════════════════════════════════════════════════ */

function emptyRecord({ id, brand, line, name, nameZh, granularity, firstSeenAt, lastSeenAt }) {
  return {
    id,
    slug: id,
    brand,
    line,
    name,
    nameZh: nameZh ?? null,
    // 发布日期由 scripts/sync/index.mjs 从 _work/release-dates.json 回填，此处留空
    releaseDate: null,
    releaseDatePrecision: null,
    status: 'on-sale',
    retiredAt: null,
    body: {
      heightMm: null,
      widthMm: null,
      thicknessMm: null,
      weightG: null,
      ipRating: null,
      material: null,
      colors: [],
      folded: null,
    },
    display: {
      sizeIn: null,
      type: null,
      resolutionPx: null,
      ppi: null,
      refreshHz: null,
      brightnessTypicalNits: null,
      brightnessPeakNits: null,
      protection: null,
    },
    chipset: { name: null, processNm: null, cpuCores: null, gpu: null, npu: null },
    memory: { ramGb: [], storageGb: [] },
    battery: {
      capacityMah: null,
      capacityCaliber: null,
      wiredChargeW: null,
      wirelessChargeW: null,
      vendorClaimedVideoHours: null,
      measuredHours: null,
    },
    camera: { rear: [], front: null, videoMax: null },
    connectivity: {
      fiveG: null,
      wifi: null,
      bluetooth: null,
      nfc: null,
      satellite: null,
      usb: null,
      sim: null,
      esim: null,
    },
    os: { launch: null, upgradableTo: null },
    skus: [],
    scores: [],
    granularity,
    /** 额外产出：官网原文节选（对比页折叠区展示用）。键 = 中文章节名 */
    rawOfficial: {},
    notes: [],
    provenance: {},
    firstSeenAt,
    lastSeenAt,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 官网原文节选（rawOfficial）与 note
 * ══════════════════════════════════════════════════════════════════════════ */

/** 精选 6–10 个有代表性的章节原文；同一个中文章节名只留第一条 */
function pushOfficial(record, label, value, limit = 320) {
  const t = realValue(value);
  if (!t || record.rawOfficial[label]) return;
  record.rawOfficial[label] = t.length > limit ? `${t.slice(0, limit)}…` : t;
}

const addNote = (record, text) => {
  if (text && !record.notes.includes(text)) record.notes.push(text);
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 影像解析
 * ══════════════════════════════════════════════════════════════════════════ */

/** 光圈：`F1.4-F4.0` → "f/1.4-4.0"；`ƒ/1.48、ƒ/1.8` → "f/1.48、f/1.8" */
function parseAperture(text) {
  const s = stripInvisible(text)
    .replace(/[ƒ]/g, 'f')
    .replace(/f\s*\/\s*/gi, 'F');
  const range = s.match(/F\s*(\d+(?:\.\d+)?)\s*[-–~]\s*F?\s*(\d+(?:\.\d+)?)/i);
  if (range) return `f/${range[1]}-${range[2]}`;
  const list = [...s.matchAll(/F\s*(\d+(?:\.\d+)?)/gi)].map((m) => `f/${m[1]}`);
  return list.length ? [...new Set(list)].join('、') : null;
}

/** OIS：官网明确写「防抖」才算 true；明确写「不支持/无」才算 false；其余 null */
function parseOis(text) {
  const s = stripInvisible(text);
  if (/不支持光学防抖|无光学防抖/.test(s)) return false;
  if (/OIS|光学防抖|防抖/.test(s)) return true;
  return false;
}

/**
 * 影像角色判定。顺序即优先级：潜望/超广角先判，避免「超广角微距」被归到微距。
 * 不认识的写法一律落到 main —— 官网列在「后置摄像头」首行的是主摄。
 * 红枫原色 / 多光谱 / 3D 深感 / 景深 这类没有像素指标的辅助器件归 depth。
 */
function cameraRole(text) {
  const s = stripInvisible(text);
  if (/多光谱|红枫|深感|景深|超光谱/.test(s)) return 'depth';
  if (/潜望/.test(s)) return 'periscope';
  if (/超广角|广角/.test(s)) return 'ultrawide';
  if (/长焦/.test(s)) return 'tele';
  if (/微距/.test(s)) return 'macro';
  return 'main';
}

/**
 * 一条镜头原文 → Camera。
 * mp 只认官网明确写出的「N 万像素」：N 万 × 0.01 = 百万像素。
 *   5000 万像素 → 50      2 亿像素 → 200
 * 「150 万多光谱通道」的「万」是光谱通道数、不是像素数，按 note 原样保留、mp 记 null，
 * 绝不做「万 → 百万像素」的形式换算（那等于给一个不存在的数字盖章）。
 */
/** 一条镜头原文 → Camera。先砍掉第一个冒号之后的描述，避免把整段焦距/像素说明塞进 sensorNote */
function parseLens(text, fallbackRole = 'main') {
  const full = stripInvisible(text);
  const s = full.split(/[:：]/)[0].trim() || full;
  const role = cameraRole(s) === 'main' && fallbackRole !== 'main' ? fallbackRole : cameraRole(s);
  let mp = null;
  const yi = s.match(/(\d+(?:\.\d+)?)\s*亿\s*像素/);
  const wan = s.match(/(\d+(?:\.\d+)?)\s*万\s*像素/);
  if (yi) mp = Number(yi[1]) * 100;
  else if (wan) mp = Number(wan[1]) / 100;
  const aperture = parseAperture(s);
  const noteParts = [
    /可变光圈|连续可变光圈/.test(s) ? '可变光圈' : null,
    /RYYB/.test(s) ? 'RYYB' : null,
    /传感器位移防抖/.test(s) ? '传感器位移防抖' : null,
    /多光谱|红枫|超光谱/.test(s) && /万/.test(s) && !/像素/.test(s)
      ? `官网原文标注「${(s.match(/(\d+(?:\.\d+)?)\s*万多光谱通道[^，,）)]*/) ?? [])[0] ?? '多光谱'}」——非像素指标，故 mp 记 null`
      : null,
    /1\/[\d.]+/.test(s) ? `传感器 ${(s.match(/1\/[\d.]+/) ?? [])[0]}` : null,
  ].filter(Boolean);
  return {
    role,
    mp,
    aperture,
    ois: parseOis(s),
    sensorNote: noteParts.length ? noteParts.join('；') : null,
  };
}

/**
 * 后置多摄原文 → Camera[]。三种分隔写法都要认：
 *   · `…摄像头（…） | …摄像头（…）`         管道分隔（Mate 90 系）
 *   · `后置单摄：… + 200 万像素微距摄像头`  加号分隔（畅享 70S）
 *   · `5000 万像素超光变摄像头（…） 4000 万像素超广角摄像头（…）` 纯空格分隔（Mate X7）
 * 空格分隔的判据：数字后面紧跟「万/亿像素」——那是新镜头的开头，段落内部的空格不会这么排队。
 */
function parseRearLenses(text, limit = 8) {
  const s = stripInvisible(text);
  if (!s) return [];
  const MARK = /(?<=[\s\u3000）)])(?=\d[\d.]*[\s\u3000]*[亿万]像素)/;
  const segments = /[|｜]/.test(s)
    ? s.split(/\s*[|｜]\s*/)
    : /\+/.test(s)
      ? s.split(/\s*\+\s*/)
      : s.split(MARK);
  return segments
    .map((x) => tidy(x))
    .filter(Boolean)
    .slice(0, limit)
    .map((x) => parseLens(x));
}

/** 前置：华为常把「外屏/内屏」并列，取第一段即可，其余进 note */
function parseFront(text) {
  const s = stripInvisible(text);
  if (!s) return null;
  const parts = s
    .split(/\s*[|｜]\s*/)
    .map(tidy)
    .filter(Boolean);
  if (!parts.length) return null;
  const lens = parseLens(parts[0], 'main');
  return { mp: lens.mp, aperture: lens.aperture };
}

/**
 * 视频最高规格。
 *   苹果：`4K 杜比视界视频拍摄，24 fps、…、100 fps (融合式主摄) 或 120 fps (融合式主摄)`
 *         → 有「最高可达」时以该上限为准；否则取该行 fps 最大值 → `4K100`
 *   华为：`最大支持 4K（3840 × 2160）视频录制…1080p@960fps 超级慢动作` → `4K`
 *         （960fps 是慢动作档，不是常规上限，故不写进 videoMax）
 * 只在官网明确出现「4K」时才这么写，否则退回 1080p / 720p。
 */
function parseVideoMax(text) {
  const s = stripInvisible(text);
  if (!s) return null;
  if (/4K|3840/.test(s)) {
    const window = s.slice(0, s.search(/4K|3840/) + 80);
    const cap = window.match(/最高可达\s*(\d{2,3})\s*fps/i);
    if (cap) return `4K${Number(cap[1])}`;
    if (/@\s*(\d{2,3})\s*fps/i.test(s)) return '4K'; // 华为慢动作写法，不当作常规上限
    const fps = [...window.matchAll(/(\d{2,3})\s*fps/gi)].map((m) => Number(m[1]));
    const max = fps.length ? Math.max(...fps) : null;
    return max && max >= 100 ? `4K${max}` : '4K';
  }
  if (/1080p|1920/.test(s)) return '1080p';
  if (/720p|1280/.test(s)) return '720p';
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 华为规格页通道（A）
 * ══════════════════════════════════════════════════════════════════════════ */

/** 华为某些页面把详情写进「后置摄像头.后置摄像头配置 / 像素配置」而不是「后置摄像头」本身 */
const HW_REAR_KEYS = ['后置摄像头', '后置摄像头.后置摄像头配置', '后置摄像头.后置摄像头像素配置'];
const HW_FRONT_KEYS = ['前置摄像头', '前置摄像头.前置摄像头像素'];

const HW_SERIES_LINE = {
  'Mate 系列': 'Mate',
  'Pura 系列': 'Pura',
  'Pocket 系列': 'Pocket',
  'nova 系列': 'nova',
  畅享系列: '畅享',
};

/**
 * 变体键解析：键形如 `屏幕.尺寸@HUAWEI Mate 90 Pro Max 典藏版`、`电池.HUAWEI Mate X7`。
 * 优先级（这是硬性规则 6）：
 *   ① 不带 @ 后缀的基键永远优先；
 *   ② 退而求其次，选**匹配当前机型名**的那个变体。匹配方向必须是
 *      「变体名 startsWith 机型名」（变体名通常比机型名更长，如「… 典藏版」），
 *      反方向会漏掉基名本身；在多个前缀命中里取最短的那个（即最接近基名）；
 *   ③ 再退，按键序取第一个，并在 rawOfficial / notes 里保留原文。
 * 返回值同时给出选中的 key，调用方负责把「用了变体键」这件事记进 notes。
 */
function hwLookup(raw, base, productName) {
  const candidates = Object.keys(raw).filter(
    (k) => k.split('@')[0].split('.')[0] === base || k.split('@')[0] === base,
  );
  if (!candidates.length) return { value: undefined, key: null, variant: null };

  const bare = candidates.find((k) => !k.includes('@') && k.split('.')[0] === base);
  if (bare) return { value: realValue(raw[bare]), key: bare, variant: null };

  const name = stripInvisible(productName);
  const withVariant = candidates.map((k) => {
    // 变体名可能写在 @ 后面，也可能写在 `.` 后面（`电池.HUAWEI Mate X7`）
    const m = k.match(/@(.+)$/);
    const variant = m ? m[1] : k.slice(base.length + 1);
    return { key: k, variant: tidy(variant) };
  });
  // ① 变体名与机型名完全相同（最干净）
  const exact = withVariant.find((c) => c.variant === name);
  if (exact) return { value: realValue(raw[exact.key]), key: exact.key, variant: exact.variant };
  // ② 变体名以机型名开头（`HUAWEI Mate X7 典藏版` ← `HUAWEI Mate X7`），取最短者
  const prefixed = withVariant
    .filter((c) => name && c.variant.startsWith(name))
    .sort((a, b) => a.variant.length - b.variant.length);
  if (prefixed.length)
    return {
      value: realValue(raw[prefixed[0].key]),
      key: prefixed[0].key,
      variant: prefixed[0].variant,
    };
  // ③ 兜底：键序第一个
  const first = withVariant[0];
  return { value: realValue(raw[first.key]), key: first.key, variant: first.variant };
}

/** 取第一个有值的键（用于「同一字段官网有多个候选键名」的情况） */
function firstOf(raw, keys, productName) {
  for (const k of keys) {
    const hit = hwLookup(raw, k, productName);
    if (hit.value !== undefined) return { ...hit, base: k };
  }
  return { value: undefined, key: null, variant: null, base: keys[0] };
}

/** 电池：容量 + 口径。典型值常在正文，额定值常在 `_notes.电池` 脚注 */
function hwBattery(raw, productName) {
  const body = firstOf(raw, ['电池'], productName);
  const notes = hwLookup(raw, '_notes.电池', productName).value ?? '';
  // 典藏版/非凡大师版的电池可能与主版本不同（Mate X6：5110 / 5200），
  // 单独把「带机型名的电池键」也读出来，只作为 note 提示，不覆盖主值。
  const altKeys = Object.keys(raw).filter(
    (k) => !k.startsWith('_') && k.split('@')[0].split('.')[0] === '电池' && k !== body.key,
  );
  const altMap = new Map();
  for (const k of altKeys) {
    const text = realValue(raw[k]);
    if (!text) continue;
    // 同一个值可能有多个别名键（`电池@HUAWEI Mate X7` 与 `电池.HUAWEI Mate X7`），按文本去重
    if (text === body.value) continue;
    if (!altMap.has(text)) altMap.set(text, k);
  }
  const alternates = [...altMap].map(([text, key]) => ({ key, text }));
  return {
    raw: body.value,
    rawKey: body.key,
    variant: body.variant,
    notes: tidy(notes),
    alternates,
  };
}

/** 充电：有的机型分 `充电.有线充电` / `充电.无线充电`，有的合并在一行 `充电` 里 */
function hwCharging(raw, productName) {
  // 键名个别页面带全角/半角冒号（`充电.有线充电：`），统一按冒号前的名字匹配
  const find = (prefix, wants) => {
    const key = Object.keys(raw).find((k) => {
      const [sec, sub = ''] = k.split('@')[0].split('.');
      if (sec !== prefix) return false;
      if (k.includes('@')) return false;
      const name = sub.replace(/[:：]\s*$/, '');
      return wants.some((w) => name === w);
    });
    return key ? realValue(raw[key]) : undefined;
  };
  const wired =
    find('充电', ['有线充电', '有线快充']) ??
    firstOf(raw, ['充电.有线充电', '充电.有线充电：', '充电.有线快充'], productName).value;
  const wireless =
    find('充电', ['无线充电']) ??
    firstOf(raw, ['充电.无线充电', '充电.无线充电：'], productName).value;
  const merged = firstOf(raw, ['充电'], productName).value;
  const pick = (label) => {
    const fromMerged = merged?.split(/\s*[|｜]\s*/).find((seg) => seg.startsWith(label));
    return fromMerged ?? undefined;
  };
  return {
    wired: wired ?? pick('有线充电') ?? pick('有线快充'),
    wireless: wireless ?? pick('无线充电'),
    merged,
  };
}

/** 存储 / 内存档位。有的页面分 `存储.运行内存（RAM）` 与 `存储.机身内存（ROM）`，
 *  有的整段塞在 `存储` / `存储@变体` / `存储.<机型名>` 里，需要再拆一层。 */
function hwMemory(raw, productName) {
  // 变体式整段键：`存储@HUAWEI Mate XT 2 非凡大师` / `存储.HUAWEI Mate X6 典藏版`
  const merged = firstOf(raw, ['存储', '存储.运行内存（RAM）+ 机身内存（ROM）'], productName);
  const byName = Object.keys(raw)
    .filter(
      (k) =>
        k.split('@')[0].split('.')[0] === '存储' &&
        k.split('@')[0].split('.')[1]?.startsWith('HUAWEI'),
    )
    .sort((a, b) => a.localeCompare(b));
  const nameKey = byName.find((k) => !/典藏版|非凡大师|灵盾|手写笔/.test(k)) ?? byName[0];

  let ram = firstOf(raw, ['存储.运行内存（RAM）', '存储.运行内存'], productName).value;
  let rom = firstOf(raw, ['存储.机身内存（ROM）', '存储.机身内存'], productName).value;
  const source = merged.value ?? (nameKey ? realValue(raw[nameKey]) : undefined);
  const sourceKey = merged.key ?? nameKey ?? null;

  if (!ram && !rom && source) {
    // `16 GB RAM + 256 GB / 512 GB / 1 TB ROM`；也有只有 RAM 一段的写法
    const ramPart = /RAM/i.test(source) ? source.split(/RAM/i)[0] : source;
    const romPart = /ROM/i.test(source) ? source.split(/ROM/i)[0].split(/RAM/i).pop() : '';
    ram = ramPart;
    rom = romPart || undefined;
  }
  return {
    ramText: ram,
    romText: rom,
    ramVariant: merged.variant,
    rawKeys: [sourceKey].filter(Boolean),
    sourceKey,
  };
}

export {
  tidy,
  realValue,
  wattOf,
  parseAppleAppearance,
  derivePpi,
  pickFirstRes,
  refreshText,
  normalizeType,
  put,
  putObject,
  multiPartValue,
  emptyRecord,
  pushOfficial,
  addNote,
  parseAperture,
  parseOis,
  cameraRole,
  parseLens,
  parseRearLenses,
  parseFront,
  parseVideoMax,
  HW_REAR_KEYS,
  HW_FRONT_KEYS,
  HW_SERIES_LINE,
  hwLookup,
  firstOf,
  hwBattery,
  hwCharging,
  hwMemory,
  HW,
  AP,
  AC,
  firstNum,
  nums,
  parseCapacity,
  parseInch,
  parseMm,
  parsePpi,
  parseRefresh,
  parseResolution,
  parseStorageList,
  parseWatt,
  parseWeight,
  sliceByVariants,
  stripInvisible,
};
