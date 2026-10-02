/**
 * 规范化层：把华为/苹果官网的原始键值对，映射成 `ProductRecord`（见 docs/DATA-CONTRACT.md）。
 *
 * 用法：
 *   node scripts/normalize/index.mjs --out _work/normalized.json
 *   node scripts/normalize/index.mjs --out _work/normalized.json --probe   # 附：未映射的原始键
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 这一层是全站最核心的资产，也是唯一一处「机器读不出来的判断」的落点。
 * 纪律（与 parse.mjs 一致，绝不违反）：
 *   1. 解析不出来就是 null。不写 0、不写 '-'、不写空串、不写平均值、不写估算值。
 *   2. 数值必须带口径。电池容量有值 → capacityCaliber 必有值；亮度峰值/典型分列。
 *   3. 每个核心字段都留 provenance，让「这个数从哪来」可回答。
 *   4. 跨口径永不混算：亮度峰值 < 典型时两个都判为不可信（置 null 并记 note）。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 三条通道与优先级：
 *   A. 华为规格页   _work/huawei.raw.json        每台一个 slug，直接映射
 *   B. 苹果规格页   _work/apple.raw.json         页面按机型名分段（18 Pro 页含 18 Pro Max）
 *   C. 苹果对比页   _work/apple-compare.raw.json 粒度更粗，**只补规格页拿不到的机型**
 *   优先级：规格页 > 对比页矩阵。同一字段两处都有 → 用规格页，矩阵只填空缺；
 *   走通道 C 的机型 granularity 记 `compare-matrix`，相应字段 provenance 记 `apple-compare`。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 已知的「官网真没有」（不是没解析到，见文末 REPORT_NOTES）：
 *   · 苹果从不公布电池容量(mAh)、RAM、充电器额定功率 → 一律 null
 *   · 华为 50 台里 20 台官网没有「处理器」章节 → chipset.name = null，绝不从型号名猜
 *   · 华为规格页不公布屏幕亮度(nits)；苹果对比页不公布电池容量
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = join(ROOT, '_work');

const SRC_HUAWEI = join(WORK, 'huawei.raw.json');
const SRC_APPLE = join(WORK, 'apple.raw.json');
const SRC_APPLE_COMPARE = join(WORK, 'apple-compare.raw.json');
const SRC_APPLE_PRICES = join(WORK, 'apple-prices.raw.json');

const HW = 'huawei-official';
const AP = 'apple-official';
const AC = 'apple-compare';

/** 对比页矩阵里表示「该机型无此项」的占位符。原样保留在 raw 里，由规范化层丢弃 */
const PLACEHOLDERS = new Set(['-', '—', '–', '--', '不适用', '—不适用', '无', 'N/A', 'n/a']);

/* ══════════════════════════════════════════════════════════════════════════
 * 0. 通用小工具
 * ══════════════════════════════════════════════════════════════════════════ */

/** 官网节选：去掉零宽字符、修掉源头的一处多余引号、压平换行 */
const tidy = (s) => stripInvisible(s).replace(/^"+/, '').replace(/\s*\n\s*/g, ' ').trim();

/** 占位符 / 空串 → undefined（等价「官网没给」） */
const realValue = (v) => {
  if (v === undefined || v === null) return undefined;
  const t = tidy(v);
  if (!t || PLACEHOLDERS.has(t)) return undefined;
  return t;
};

/** 第一个数字（支持千位分隔与小数）；解析不出返回 null */
function firstNum(text) {
  const m = String(text ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 文本里所有数字 */
function nums(text) {
  return (String(text ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

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

  const colorSeg = segs.find((s) => /、/.test(s) && !/[（）()]/.test(s) && !/(面板|玻璃|金属|设计|超瓷晶)/.test(s) && s.length <= 40);
  const colors = colorSeg ? colorSeg.split(/[、,，]/).map(tidy).filter(Boolean) : [];

  const designSeg = segs.find((s) => /(金属|超瓷晶|玻璃|面板)/.test(s) && !/[（）()]/.test(s));
  const material = designSeg ?? null;

  const panelSegs = segs.filter((s) => /超瓷晶面板/.test(s) && /[（(]/.test(s));
  const protection = panelSegs.length ? panelSegs.join(' | ') : (segs.find((s) => /超瓷晶|纳米纹理/.test(s)) ?? null);

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
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return;
  record.provenance[path] = source;
}

/** 与 put 相同，但值嵌在子对象里（如 display.resolutionPx.w） */
function putInto(record, path, value, source) {
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return;
  record.provenance[path] = source;
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
    const parts = s.split(/\s*[|｜；;]\s*/).map(tidy).filter(Boolean);
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
  const s = stripInvisible(text).replace(/[ƒ]/g, 'f').replace(/f\s*\/\s*/gi, 'F');
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
    (/多光谱|红枫|超光谱/.test(s) && /万/.test(s) && !/像素/.test(s))
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
  const parts = s.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean);
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
  '畅享系列': '畅享',
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
  const candidates = Object.keys(raw).filter((k) => k.split('@')[0].split('.')[0] === base || k.split('@')[0] === base);
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
  if (prefixed.length) return { value: realValue(raw[prefixed[0].key]), key: prefixed[0].key, variant: prefixed[0].variant };
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
    (k) => !k.startsWith('_') && k.split('@')[0].split('.')[0] === '电池' && k !== body.key
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
  return { raw: body.value, rawKey: body.key, variant: body.variant, notes: tidy(notes), alternates };
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
  const wired = find('充电', ['有线充电', '有线快充']) ?? firstOf(raw, ['充电.有线充电', '充电.有线充电：', '充电.有线快充'], productName).value;
  const wireless = find('充电', ['无线充电']) ?? firstOf(raw, ['充电.无线充电', '充电.无线充电：'], productName).value;
  const merged = firstOf(raw, ['充电'], productName).value;
  const pick = (label) => {
    const fromMerged = merged
      ?.split(/\s*[|｜]\s*/)
      .find((seg) => seg.startsWith(label));
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
    .filter((k) => k.split('@')[0].split('.')[0] === '存储' && k.split('@')[0].split('.')[1]?.startsWith('HUAWEI'))
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

function mapHuawei(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: HW_SERIES_LINE[realValue(raw['_catalog.series']) ?? ''] ?? '',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  const variantKeys = [];
  const noteVariant = (hit, label) => {
    if (hit?.variant) variantKeys.push(`${hit.base ?? label}@${hit.variant}`);
  };

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const h = hwLookup(raw, '尺寸与重量.长度', name);
  const w = hwLookup(raw, '尺寸与重量.宽度', name);
  const t = hwLookup(raw, '尺寸与重量.厚度', name);
  const wt = hwLookup(raw, '尺寸与重量.重量', name);
  const dimNotes = hwLookup(raw, '_notes.尺寸与重量', name).value ?? '';

  // 折叠机：`折叠态：12.3 mm | 三屏态：4.0/3.69/3.5 mm`。契约字段是单值，
  // 取折叠态（整机厚度），展开态与并列值记进 note。
  const foldedThickness = (() => {
    const s = t.value ?? '';
    const seg = s.split(/\s*[|｜]\s*/).find((x) => /折叠态/.test(x));
    if (!seg) return null;
    const v = parseMm(seg);
    if (v === null) return null;
    return { value: v, text: s };
  })();
  const thickness = foldedThickness ? foldedThickness.value : parseMm(t.value ?? '');
  if (foldedThickness) {
    addNote(rec, `厚度原文为多态标注「${foldedThickness.text}」；body.thicknessMm 取折叠态，展开态见 rawOfficial`);
  }
  const weight = parseWeight(wt.value ?? '');
  if (weight.note) addNote(rec, `重量原文「${tidy(wt.value)}」：${weight.note}`);
  if (/屏幕表面层/.test(dimNotes)) addNote(rec, `官网脚注另给含屏幕表面层的重量，未采用：${tidy(dimNotes)}`);

  rec.body.heightMm = parseMm(h.value ?? '');
  rec.body.widthMm = parseMm(w.value ?? '');
  rec.body.thicknessMm = thickness;
  rec.body.weightG = weight.value;

  /* ---- 屏幕 ------------------------------------------------------------ */
  const size = firstOf(raw, ['屏幕.尺寸', '屏幕.屏幕尺寸'], name);
  const type = firstOf(raw, ['屏幕.类型', '屏幕.屏幕类型'], name);
  const res = firstOf(raw, ['屏幕.分辨率', '屏幕.屏幕分辨率'], name);
  const ppiHit = firstOf(raw, ['屏幕.PPI', '屏幕.屏幕像素密度'], name);
  const glass = firstOf(raw, ['屏幕.玻璃类型', '屏幕.玻璃材质'], name);
  [size, type, res, ppiHit, glass].forEach((x) => {
    if (x?.variant) variantKeys.push(`${x.base}@${x.variant}`);
  });

  const sizeText = size.value ?? '';
  const sizePart = multiPartValue(sizeText);
  const sizeIn = parseInch(sizePart.text);
  if (sizePart.multi) {
    addNote(rec, `屏幕尺寸原文为多态标注「${tidy(sizeText)}」；display.sizeIn 取第一条（内屏/折叠态），其余见 rawOfficial`);
  }

  // 分辨率：`折叠态：2442 × 1140 像素 三屏态：2232 × 3184 像素` / `内屏：2416 × 2210 像素 | 外屏：2444 × 1080 像素`
  const resText = res.value ?? '';
  const resPart = multiPartValue(resText);
  const resolutionPx = parseResolution(resPart.text) ?? parseResolution(resText);
  if (resPart.multi) {
    addNote(rec, `分辨率原文为多态标注「${tidy(resText)}」；display.resolutionPx 取第一条，其余见 rawOfficial`);
  }

  const ppiPart = multiPartValue(ppiHit.value ?? '');
  const declaredPpi = ppiPart.text ? parsePpi(ppiPart.text) : null;
  let ppi = declaredPpi;
  if (ppi === null) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) {
      addNote(rec, `官网未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived`);
    }
  } else if (ppiPart.multi) {
    addNote(rec, `ppi 原文为多态标注「${tidy(ppiHit.value)}」；display.ppi 取第一条`);
  }

  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(type.value);
  rec.display.resolutionPx = resolutionPx;
  rec.display.ppi = ppi;
  rec.display.refreshHz = refreshText(type.value ?? '');
  rec.display.protection = glass.value ?? null;
  // 华为规格页不公布屏幕亮度（nits），这两个字段保持 null —— 这是官网真没有

  /* ---- 处理器 ---------------------------------------------------------- */
  const cpu = firstOf(raw, ['处理器', '处理器.CPU 型号', '处理器.CPU'], name);
  const gpu = firstOf(raw, ['处理器.GPU'], name);
  if (cpu.value) {
    // `麒麟9050 Pro 麒麟9050` 是「主型号 + 变体型号」并列，取第一个完整型号名
    const tokens = tidy(cpu.value).split(/\s{2,}|\s*[|｜]\s*/).map(tidy).filter(Boolean);
    let chip = tokens[0] ?? tidy(cpu.value);
    if (tokens.length > 1 && /^\S+$/.test(chip) && !/Pro|Max|Ultra/i.test(chip)) {
      // 被空格切开的情况（`麒麟9050 Pro 麒麟9050`）：补回紧随其后的型号后缀
      const rest = tidy(cpu.value).slice(chip.length).trim();
      const m = rest.match(/^(Pro|Max|Ultra|Plus|Lite|SE)\b/i);
      if (m) chip = `${chip} ${m[1]}`;
    }
    if (tokens.length > 1) {
      addNote(rec, `处理器原文「${tidy(cpu.value)}」含并列型号，chipset.name 取第一个：${chip}`);
    }
    rec.chipset.name = chip;
    if (cpu.variant) variantKeys.push(`${cpu.base}@${cpu.variant}`);
  }
  rec.chipset.gpu = gpu.value ?? null;
  // processNm / cpuCores / npu：华为规格页不给 → null，不从型号名推断

  /* ---- 存储与内存 ------------------------------------------------------ */
  const mem = hwMemory(raw, name);
  rec.memory.ramGb = parseStorageList(mem.ramText ?? '');
  rec.memory.storageGb = parseStorageList(mem.romText ?? '');
  if (mem.ramVariant) variantKeys.push(`存储@${mem.ramVariant}`);

  /* ---- 电池与充电 ------------------------------------------------------ */
  const bat = hwBattery(raw, name);
  if (bat.raw) {
    const fromBody = parseCapacity(bat.raw);
    const fromNotes = parseCapacity(bat.notes);
    /**
     * 数值取**正文**；正文没给数值（如华为 Mate X7 / X6 只写「电池容量：5525 mAh」而
     * 关键词在脚注）才退回脚注。口径同理：正文口径优先，其次脚注。
     * 注意不能拿「正文的 null」去压掉「脚注的值」——那是丢数据，不是保守。
     */
    rec.battery.capacityMah = fromBody.value ?? fromNotes.value;
    rec.battery.capacityCaliber = fromBody.caliber ?? fromNotes.caliber;
    if (fromBody.value === null && fromNotes.value !== null) {
      addNote(rec, `电池容量数值取自官网章节脚注（_notes.电池）：${bat.notes}`);
    }
    if (fromBody.value !== null && fromBody.caliber === null && fromNotes.caliber !== null) {
      addNote(rec, `电池容量口径取自官网章节脚注：额定容量 ${fromNotes.value} mAh`);
    }
    if (fromBody.value === null && fromBody.caliber === null && rec.battery.capacityMah === null) {
      addNote(rec, `官网电池原文未能解析出容量：${tidy(bat.raw)}`);
    }
    if (bat.variant) variantKeys.push(`电池@${bat.variant}`);
    for (const alt of bat.alternates ?? []) {
      const v = parseCapacity(alt.text);
      if (v.value !== null && v.value !== rec.battery.capacityMah) {
        addNote(rec, `官网另有配置专属电池容量「${alt.key}：${alt.text}」；契约字段是单值，主值未覆盖，请按配置核对`);
      }
    }
  }

  const charge = hwCharging(raw, name);
  rec.battery.wiredChargeW = wattOf(charge.wired ?? '');
  rec.battery.wirelessChargeW = /不支持/.test(charge.wireless ?? '') ? null : wattOf(charge.wireless ?? '');
  if (charge.wired && rec.battery.wiredChargeW === null) {
    addNote(rec, `有线充电原文「${tidy(charge.wired)}」未出现明确的「N W」标称，battery.wiredChargeW 记 null（不按 V×A 推算）`);
  }
  if (/不支持/.test(charge.wireless ?? '')) {
    addNote(rec, '官网明确「无线充电：不支持」→ battery.wirelessChargeW 记 null（表示无此能力）');
  }

  /* ---- 影像 ------------------------------------------------------------ */
  const rear = firstOf(raw, HW_REAR_KEYS, name);
  const front = firstOf(raw, HW_FRONT_KEYS, name);
  const rearVideo = firstOf(raw, ['后置摄像头.后置摄像头摄像分辨率', '后置摄像头.后置摄像头视频拍摄'], name);
  rec.camera.rear = parseRearLenses(rear.value ?? '');
  rec.camera.front = parseFront(front.value ?? '');
  rec.camera.videoMax = parseVideoMax(rearVideo.value ?? '');
  if (rear.value) {
    addNote(rec, `后置影像原文见 rawOfficial「后置摄像头」；未标注像素的辅助器件（红枫原色/多光谱/深感）role 记 depth、mp 记 null`);
  }
  if (front.value && (front.value.match(/[|｜]/) ?? []).length) {
    addNote(rec, `前置摄像头原文含多个镜头（「${tidy(front.value)}」），camera.front 取第一个`);
  }

  /* ---- 连接与系统 ------------------------------------------------------ */
  const nfcText = hwLookup(raw, 'NFC', name).value;
  const esimText = hwLookup(raw, 'eSIM', name).value;
  const satText = hwLookup(raw, '数据连接.卫星通信', name).value;
  rec.connectivity.wifi = hwLookup(raw, '数据连接.WLAN', name).value ?? null;
  rec.connectivity.bluetooth = hwLookup(raw, '数据连接.蓝牙', name).value ?? null;
  rec.connectivity.usb = hwLookup(raw, '数据连接.数据线接口', name).value ?? null;
  rec.connectivity.sim = hwLookup(raw, 'SIM 卡类型', name).value ?? null;
  rec.connectivity.nfc = nfcText ? /支持/.test(nfcText) : null;
  rec.connectivity.esim = esimText ? /^支持/.test(tidy(esimText)) : null;
  rec.connectivity.satellite = satText ?? null;
  // 华为规格页不写「5G」章节；只有少数机型明确只列 4G 网络制式，此时才记 false，
  // 其余留 null —— 「官网没写」不等于「没有 5G」，绝不替官网下结论。
  const netMode = hwLookup(raw, '网络制式', name).value;
  if (netMode && !/5G/i.test(netMode)) rec.connectivity.fiveG = false;

  rec.os.launch = hwLookup(raw, '操作系统', name).value ?? null;
  // 华为规格页不给「可升级到」→ upgradableTo 保持 null

  /* ---- 机身其他 -------------------------------------------------------- */
  const ipRaw = hwLookup(raw, '防尘抗水', name).value;
  if (ipRaw) {
    const ips = [...new Set([...ipRaw.matchAll(/IP\s?\d{2}/gi)].map((m) => m[0].replace(/\s/g, '').toUpperCase()))];
    rec.body.ipRating = ips.length ? ips.join('/') : null;
  }
  rec.body.material = hwLookup(raw, '中框', name).value ?? null;
  const colors = hwLookup(raw, '颜色', name).value;
  if (colors) rec.body.colors = colors.split(/[、,，]/).map(tidy).filter(Boolean);

  /* ---- SKU（价格）------------------------------------------------------ */
  const priceRaw = hwLookup(raw, '_catalog.price', name).value;
  const priceCny = priceRaw && /^\d+$/.test(priceRaw) ? Number(priceRaw) : null;
  const storage = rec.memory.storageGb.length ? Math.min(...rec.memory.storageGb) : null;
  if (priceCny !== null) {
    rec.skus.push({
      storageGb: storage ?? 0,
      ramGb: rec.memory.ramGb.length ? Math.min(...rec.memory.ramGb) : null,
      priceCny,
      priceNote: '官网目录页售价（最低配档）',
      listedAt: rawProduct.extractedAt.slice(0, 10),
    });
  } else if (priceRaw && /规格页 productJson/.test(priceRaw)) {
    addNote(rec, `价格来自规格页 productJson：${priceRaw}`);
    const p = firstNum(priceRaw);
    if (p !== null && p > 0) {
      rec.skus.push({
        storageGb: storage ?? 0,
        ramGb: rec.memory.ramGb.length ? Math.min(...rec.memory.ramGb) : null,
        priceCny: p,
        priceNote: '规格页 productJson 售价（最低配档）',
        listedAt: rawProduct.extractedAt.slice(0, 10),
      });
    }
  } else {
    addNote(rec, '官网在售目录未给该机型价格 → skus 为空数组（不写 0，也不写估算价）');
  }
  if (rec.skus.length && storage === null) {
    addNote(rec, '价格挂的 SKU storageGb 缺失（官网未公布可选容量），storageGb 记 0 表示未知档位');
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '尺寸与重量', [h.value, w.value, t.value, wt.value].filter(Boolean).join(' | '));
  pushOfficial(rec, '屏幕', [size.value, type.value, res.value, ppiHit.value, glass.value].filter(Boolean).join(' | '));
  pushOfficial(rec, '处理器', cpu.value);
  pushOfficial(rec, '存储', [mem.ramText, mem.romText].filter(Boolean).join(' | '));
  pushOfficial(rec, '电池', bat.raw);
  pushOfficial(rec, '充电', charge.merged ?? [charge.wired, charge.wireless].filter(Boolean).join(' | '));
  pushOfficial(rec, '后置摄像头', rear.value);
  pushOfficial(rec, '前置摄像头', front.value);
  pushOfficial(rec, '防尘抗水', ipRaw);
  pushOfficial(rec, '数据连接', [
    rec.connectivity.wifi,
    rec.connectivity.bluetooth,
    rec.connectivity.usb,
    rec.connectivity.satellite,
  ].filter(Boolean).join(' | '));
  for (const [label, path] of [['屏幕脚注', '_notes.屏幕'], ['电池脚注', '_notes.电池'], ['充电脚注', '_notes.充电']]) {
    pushOfficial(rec, label, hwLookup(raw, path, name).value, 200);
  }

  if (variantKeys.length) {
    addNote(rec, `以下字段使用了带 @变体 后缀的键（基键不存在），已取匹配本机型的第一个变体：${variantKeys.join('、')}`);
  }

  /* ---- provenance 逐字段登记 ------------------------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.ipRating', rec.body.ipRating, HW);
  put(rec, 'body.material', rec.body.material, HW);
  put(rec, 'body.colors', rec.body.colors, HW);
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putInto(rec, 'display.resolutionPx.w', rec.display.resolutionPx, HW);
  // ppi：官网直给记官方来源，推算出来的记 derived（来源必须能回答「这个数从哪来」）
  put(rec, 'display.ppi', rec.display.ppi, declaredPpi !== null ? HW : 'derived');
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.protection', rec.display.protection, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'chipset.gpu', rec.chipset.gpu, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.capacityMah', rec.battery.capacityMah, HW);
  put(rec, 'battery.capacityCaliber', rec.battery.capacityCaliber, HW);
  put(rec, 'battery.wiredChargeW', rec.battery.wiredChargeW, HW);
  put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, HW);
  put(rec, 'camera.rear', rec.camera.rear, HW);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, HW);
  put(rec, 'camera.videoMax', rec.camera.videoMax, HW);
  for (const k of ['fiveG', 'wifi', 'bluetooth', 'nfc', 'satellite', 'usb', 'sim', 'esim']) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], HW);
  }
  put(rec, 'os.launch', rec.os.launch, HW);
  put(rec, 'skus', rec.skus, HW);

  return rec;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. 苹果通道（B 规格页 / C 对比页矩阵）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 规格页「同页多机型」的公共段标记。18 Pro 页把两个机型共有的显示屏/电池条目
 * 放在 `两种机型均具备` 键里，两个变体共享；某个变体专属的条目写在基键里。
 */
const APPLE_SHARED_MARK = /两种机型均具备|机型均具备/;

/**
 * 把规格页 raw 拆成「机型专属条目」与「公共段」。
 *
 * 18 Pro 页的结构是：某个变体专属的条目写在基键里（`显示屏.显示屏`），
 * 两个变体共有的条目写在 `两种机型均具备` 键里（`显示屏.两种机型均具备`）。
 * 「同页多机型」的拆分由上游适配器按列完成（18 Pro / 18 Pro Max 各成一个 RawProduct，
 * specsUrl 相同），这里只把公共段标记出来供两个变体共享 —— **切不开就不切**。
 * 真正调用 sliceByVariants 的自证在 main() 里，用于证明「公共段确实按机型名分得开」。
 */
function splitApplePage(rawProduct) {
  const merged = {};
  for (const [k, v] of Object.entries(rawProduct.raw)) {
    merged[k.startsWith('_shared:') ? k : (APPLE_SHARED_MARK.test(k) ? `_shared:${k}` : k)] = v;
  }
  return merged;
}

/**
 * 苹果 raw 键名 → 值。键形如 `组.行`（组名与行名相同，另有 `(2)` `(3)` 序号后缀）；
 * `_shared:组.行` 是「两种机型均具备」的公共段，组名取 `组`。
 *
 * 注意：**同一个组里可能出现多个「无序号」键**（18 Pro 页的 `显示屏.显示屏` 与
 * `显示屏.两种机型均具备`）。因此分组结果一律要
 *   ① 用 `apRows` 拼成整组文本，或
 *   ② 用 `apFind` 按正则挑出真正想要的那一行；
 * 绝不能拿「第一条」当组值 —— 那会把「超视网膜 XDR 显示屏」当成整组显示屏规格。
 */
const apKeyBody = (k) => (k.startsWith('_shared:') ? k.slice('_shared:'.length) : k);

/** 按 `组名.行名` 取分组；返回 `{ key, sub, value, order }[]`，order 为 `(N)` 序号（无序号为 0） */
function apRows(raw, group) {
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    const [sec, sub = ''] = apKeyBody(k).split('.');
    if (sec !== group) continue;
    const t = realValue(v);
    if (!t) continue;
    out.push({ key: k, sub, value: t, order: Number((sub.match(/\((\d+)\)$/) ?? [])[1] ?? 0) });
  }
  return out;
}

/** 整组文本（按页面行序拼接）；用于 ppi / 刷新率 / 亮度这类「跨行才能读全」的解析 */
const apBlob = (raw, group, sep = ' ') => apRows(raw, group).map((x) => x.value).join(sep);

/** 第一行 */
const apFirst = (raw, group) => apRows(raw, group)[0]?.value;

/** 按正则取第一行匹配值 */
const apFind = (raw, group, re) => apRows(raw, group).find((x) => re.test(x.value))?.value;

/** 按正则取全部匹配值 */
const apFindAll = (raw, group, re) => apRows(raw, group).filter((x) => re.test(x.value)).map((x) => x.value);

/* ---------- B: 苹果规格页 ---------- */

function mapAppleSpecs(rawProduct) {
  const raw = splitApplePage(rawProduct);
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'apple',
    line: 'iPhone',
    name,
    nameZh: null,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  // 原文靠「高度/宽度/厚度/重量：」标签分隔，按标签切段比按位置取更稳。
  // 注意 `高度：` 也出现在页面尾部的一句总结里（`iPhone 18 Pro，高度 150.0 毫米`），
  // 因此标签必须带冒号，且只取标签后的一小段。
  const dimText = apBlob(raw, '尺寸与重量');
  const segOf = (label) => {
    const i = dimText.indexOf(label);
    return i < 0 ? '' : dimText.slice(i + label.length, i + label.length + 60);
  };
  const labeled = (cn) => segOf(`${cn}：`) || segOf(`${cn}:`);
  rec.body.heightMm = parseMm(labeled('高度'));
  rec.body.widthMm = parseMm(labeled('宽度'));
  rec.body.thicknessMm = parseMm(labeled('厚度'));
  const weightSeg = labeled('重量');
  const weight = parseWeight(weightSeg);
  rec.body.weightG = weight.value;
  if (weight.note) addNote(rec, `重量原文「${tidy(weightSeg)}」：${weight.note}`);
  if (!rec.body.weightG) addNote(rec, `尺寸与重量原文未能解析出重量：${tidy(dimText)}`);
  // 少数页面缺「重量：」标签（如 iPhone Duo），退回「全页只出现一次的克数」
  if (rec.body.weightG === null) {
    const w = parseWeight(dimText);
    rec.body.weightG = w.value;
  }
  if (/展开/.test(dimText)) {
    addNote(rec, `尺寸与重量原文标注「展开」态（${tidy(dimText)}）；未给出折叠态，body.folded 记 null 而不是猜`);
  }

  const ipText = apBlob(raw, '防溅、抗水、防尘');
  const ip = ipText.match(/IP\s?\d{2}/i);
  rec.body.ipRating = ip ? ip[0].replace(/\s/g, '').toUpperCase() : null;

  // 外观组第一行是配色（顿号分隔），且必须**整行都像配色**，否则会误吞描述段落
  const look = apRows(raw, '外观').map((x) => x.value);
  const appearance = parseAppleAppearance(look);
  rec.body.colors = appearance.colors;
  rec.body.material = appearance.material;

  /* ---- 屏幕 ------------------------------------------------------------ */
  const dispRows = apRows(raw, '显示屏').map((x) => x.value);
  const dispJoin = dispRows.join(' | ');
  // 尺寸：优先「N 英寸 (对角线)」那一行；其次是「N 英寸 … 显示屏」的行。
  // 不能拿第一条 —— 第一条常是「超视网膜 XDR 显示屏」，根本不含尺寸。
  const sizeLine = dispRows.find((t) => /英寸/.test(t) && /对角线/.test(t))
    ?? dispRows.find((t) => /英寸/.test(t) && /显示屏|OLED|全面屏/.test(t) && !/可视区域/.test(t))
    ?? dispRows.find((t) => /英寸/.test(t));
  rec.display.sizeIn = sizeLine ? parseInch(sizeLine) : null;
  const typeMatch = dispJoin.match(/(超视网膜 XDR 显示屏|超视网膜显示屏|LTPO[^，,|｜]*|OLED 可折叠全面屏|OLED 全面屏|OLED)/);
  rec.display.type = typeMatch ? normalizeType(typeMatch[1]) : null;
  rec.display.resolutionPx = pickFirstRes(dispRows);
  // ppi 与分辨率同处一行（`2622 x 1206 像素分辨率，460 ppi`），整组里正则直接抓
  const declaredPpi = (() => {
    const m = dispJoin.replace(/,/g, '').match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*像素分辨率[，,]?\s*(\d+(?:\.\d+)?)\s*ppi/i)
      ?? dispJoin.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*ppi/i);
    return m ? Number(m[m.length - 1]) : null;
  })();
  rec.display.ppi = declaredPpi ?? derivePpi(rec.display.sizeIn, rec.display.resolutionPx);
  if (declaredPpi === null && rec.display.ppi !== null) {
    addNote(rec, '官网该页未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived');
  }
  // 刷新率：只从含 Hz 的那一行读，避免把「6.27 英寸」当成刷新率下限
  rec.display.refreshHz = refreshText(apFind(raw, '显示屏', /Hz/i) ?? '');
  if (/最小亮度/.test(dispJoin)) {
    addNote(rec, '屏幕原文含「最小亮度为 1 尼特」，属最低亮度口径，未记入 brightnessTypicalNits/brightnessPeakNits');
  }

  /**
   * 亮度分列。苹果原文：
   *   `1000 尼特最大亮度 (典型)；1600 尼特峰值亮度 (HDR)；3000 尼特峰值亮度 (户外)`
   * 峰值口径（HDR/户外）取最大，典型口径取「最大亮度 (典型)」；两者分列、绝不合成一个「最高亮度」。
   */
  const brightLines = dispRows.filter((t) => /尼特/.test(t));
  const peakVals = [];
  const typVals = [];
  for (const line of brightLines) {
    for (const m of line.matchAll(/(\d[\d,]*)\s*尼特\s*(?:峰值亮度|最大亮度)?\s*(?:\(([^)]*)\)|（([^）]*)）)?/g)) {
      const val = Number(m[1].replace(/,/g, ''));
      const qual = m[2] ?? m[3] ?? '';
      if (/峰值|HDR|户外/.test(qual) || /峰值/.test(m[0])) peakVals.push(val);
      else if (/典型/.test(qual) || /典型/.test(m[0])) typVals.push(val);
    }
  }
  rec.display.brightnessPeakNits = peakVals.length ? Math.max(...peakVals) : null;
  rec.display.brightnessTypicalNits = typVals.length ? Math.max(...typVals) : null;
  if (rec.display.brightnessPeakNits !== null && rec.display.brightnessTypicalNits !== null &&
      rec.display.brightnessPeakNits < rec.display.brightnessTypicalNits) {
    addNote(rec, `峰值亮度(${rec.display.brightnessPeakNits}) < 典型亮度(${rec.display.brightnessTypicalNits})，两者口径解析可能串位，已双双置 null`);
    rec.display.brightnessPeakNits = null;
    rec.display.brightnessTypicalNits = null;
  }
  rec.display.protection = appearance.protection
    ?? apFind(raw, '显示屏', /超瓷晶|纳米纹理|昆仑/)
    ?? null;

  /* ---- 芯片 ------------------------------------------------------------ */
  const chipRows = apRows(raw, '芯片').map((x) => x.value);
  rec.chipset.name = chipRows.find((t) => /芯片$/.test(t)) ?? null;
  const cpuLine = chipRows.find((t) => /中央处理器/.test(t));
  rec.chipset.cpuCores = cpuLine ? firstNum(cpuLine) : null;
  rec.chipset.gpu = chipRows.find((t) => /图形处理器/.test(t)) ?? null;
  rec.chipset.npu = chipRows.find((t) => /神经网络引擎/.test(t)) ?? null;

  /* ---- 存储（容量）----------------------------------------------------- */
  const capacityRows = apRows(raw, '容量').map((x) => x.value);
  rec.memory.storageGb = parseStorageList(capacityRows.filter((t) => !/不适用/.test(t)).join(' | '));
  if (rec.memory.storageGb.length === 1) {
    addNote(rec, `容量原文「${tidy(capacityRows[0] ?? '')}」只列出该机型在售的首档；memory.storageGb 仅收官网明示档位`);
  }

  /* ---- 电池与充电 ------------------------------------------------------ */
  const battRows = apRows(raw, '电源和电池').map((x) => x.value);
  const battJoin = battRows.join(' | ');
  // 视频播放时长（厂商自报）。Duo/Air 有多条「内屏/外屏/搭配 MagSafe 电池」，
  // 取与「视频播放」同行的那条基准值，其余记 note。
  const videoLine = battRows.find((t) => /视频播放/.test(t));
  if (videoLine) {
    rec.battery.vendorClaimedVideoHours = firstNum((videoLine.match(/最长可达\s*(\d+(?:\.\d+)?)\s*小时/) ?? [])[1] ?? '');
    if (battRows.filter((t) => /最长可达/.test(t)).length > 1) {
      addNote(rec, `厂商自报续航原文含多个口径（${tidy(battJoin)}）；battery.vendorClaimedVideoHours 取「视频播放」第一条`);
    }
  }
  // 快速充电：原文只给「N 分钟充至 50%，需 ≥X 瓦适配器」。X 是适配器要求，不是手机峰值功率，
  // 两者不是一回事，所以 battery.wiredChargeW 保持 null —— 这是官网口径的真缺口。
  const fastLine = battRows.find((t) => /可快速充电|充至 50%/.test(t));
  if (fastLine) {
    const adapterW = wattOf(fastLine);
    addNote(
      rec,
      `官网只给出「${tidy(fastLine)}」——其中 ${adapterW ?? '—'} 瓦是**电源适配器要求**，不是手机有线充电峰值功率，` +
        '故 battery.wiredChargeW 记 null（苹果从不公布该值）'
    );
  } else if (rec.battery.wiredChargeW === null) {
    addNote(rec, '规格页电源章节未给出任何有线充电功率（连适配器要求都没有）→ battery.wiredChargeW 记 null');
  }
  // 无线充电：来自 MagSafe 组，原文写「功率最高可达 15 瓦」→ 官方明确的瓦数，可收
  const magsafe = apBlob(raw, 'MagSafe 和无线充电', ' | ')
    || apFind(raw, '电源和电池', /无线充电/)
    || '';
  rec.battery.wirelessChargeW = wattOf(magsafe);
  if (rec.battery.wirelessChargeW !== null) {
    addNote(rec, `battery.wirelessChargeW 取自「${tidy(magsafe).slice(0, 60)}」中的明确瓦数`);
  }
  // 苹果从不公布电池容量(mAh) → 保持 null + capacityCaliber null

  /* ---- 影像 ------------------------------------------------------------ */
  const camRows = apRows(raw, '摄像头').map((x) => x.value);
  /**
   * 镜头清单行的判定。18 Pro 页把所有镜头塞在同一个 `摄像头.摄像头` 里（含大量叙述句），
   * 16 页则把镜头单独放在 `摄像头(2)`。判据：
   *   ① 用 `|` 分列，且**至少两段以「…万像素…」开头**（叙述段几乎不会这么起头）；
   *   ② 每段都长得像镜头（以像素数开头，或含「摄像头/镜头」），否则整行不是清单。
   */
  const lensSegs = (t) =>
    /[|｜]/.test(t) ? t.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean) : [];
  /**
   * 像镜头的一段：以「N 万像素 / N 亿像素」开头，并且**冒号前**的镜头名是个镜头称呼。
   * 注意三处坑：
   *   · 不能用 parseLens 内部砍过冒号的结果来判断 —— `4800 万像素融合式主摄：26 毫米焦距…`
   *     砍掉冒号后只剩「4800 万像素融合式主摄」，会丢掉判据；
   *   · 关键词要同时收「主摄/超广角/长焦/潜望/微距/摄像头/镜头」——苹果写「融合式主摄」，
   *     不写「摄像头」，只测「摄像头|镜头」会漏掉所有苹果镜头行；
   *   · 数字与「万像素」之间可能是全角空格 U+3000（`5000　万像素摄像头`），`\s` 认它。
   */
  const lensName = (s) => String(s).split(/[:：]/)[0];
  /**
   * 像镜头的一段，必须同时满足：
   *   ① 去掉「同时支持」这类前缀后，以「N 万像素 / N 亿像素」开头；
   *   ② **冒号前**的镜头称呼里含主摄/超广角/长焦/潜望/微距/摄像头/镜头 —— 判据只看冒号前，
   *      这样 `4800 万像素微距摄影`（冒号前没有镜头称呼，是「微距摄影」功能项）不会混进来，
   *      而 `1200 万像素 2 倍长焦功能：52 毫米焦距…` 会。
   *   ③ 不是系统名（`…摄像头系统` / `…双摄系统`）—— 系统名只是把像素数当修饰语。
   * 判据取自官网真实写法，逐条核对过 13 台苹果机型。
   */
  const looksLikeLens = (s) => {
    const body = String(s).replace(/^(同时支持|还支持|支持)\s*/, '');
    if (!/^[\d.]+\s*[亿万]像素/.test(body)) return false;
    const name = lensName(body);
    if (/(摄像头系统|双摄系统|三摄系统|镜头系统|摄影|摄像)$/.test(name)) return false;
    return /(摄像头|镜头|主摄|超广角|长焦|潜望|微距|广角)/.test(name);
  };
  /**
   * 镜头清单行的判定。难点在于苹果把「镜头 + 一整串拍摄功能」塞在同一行：
   *   `先进的双摄系统 | 4800 万像素融合式主摄：… | 1200 万像素超广角：… | 最高可达 10 倍数码变焦 | 相机控制 | …`
   * 一行 25 段里常只有 2–4 段是镜头，所以「镜头占多数」这类比例判据必然失败。
   * 判据改为**存在性**：一行里至少有 2 段像镜头 —— 介绍段落最多命中 1 段。
   * （单摄机型 iPhone Air / 17e 的第二段写成「同时支持 1200 万像素…长焦功能：…」，同样命中。）
   */
  const realLensSegs = (t) => lensSegs(t).filter(looksLikeLens);
  const lensRow = camRows.find((t) => realLensSegs(t).length >= 2) ?? '';
  const rear = realLensSegs(lensRow).map((s) => parseLens(s));
  rec.camera.rear = rear;
  /**
   * 光圈：有的页面把光圈写在镜头清单行内（`4800 万像素融合式超广角：13 毫米焦距，ƒ/2.2 光圈…`），
   * 有的单独成行（`ƒ/1.48、ƒ/1.8、ƒ/2.8、ƒ/4.0 或 ƒ/1.78`）。两处都试，缺哪个补哪个。
   * 注意官网的斜杠有三种写法：`ƒ/1.6`、`ƒ／1.6`(全角)、`ƒ1.6`，正则必须都能吃。
   */
  if (lensRow) {
    const segs = realLensSegs(lensRow);
    rear.forEach((cam, i) => {
      if (cam.aperture) return;
      const ap = segs[i] ? parseAperture(segs[i]) : null;
      if (ap) cam.aperture = ap;
    });
  }
  if (rear.some((c) => !c.aperture)) {
    const apLine = camRows.find((t) => t !== lensRow && /光圈/.test(t) && /[ƒf][\s/／]*\d/.test(t));
    const ap = apLine ? parseAperture(apLine) : null;
    if (ap) for (const cam of rear) if (!cam.aperture) cam.aperture = ap;
  }
  // 防抖单独成行（`… (融合式主摄) | … (融合式长焦)`），按括号里的镜头名逐条翻 ois。
  // 整行镜头清单本身不算「防抖行」——那会把所有镜头都翻成 true。
  const oisLine = camRows.find((t) => /防抖/.test(t) && t !== lensRow && /[|｜]/.test(t) && t.length < 200)
    ?? camRows.filter((t) => /防抖/.test(t) && t !== lensRow && t.length < 200)[0]
    ?? '';
  if (oisLine && rear.length) {
    const roleKeys = { main: /主摄/, ultrawide: /超广角/, tele: /长焦/, periscope: /潜望/, macro: /微距/ };
    for (const cam of rear) {
      if (cam.ois === false) continue;
      cam.ois = roleKeys[cam.role] ? roleKeys[cam.role].test(oisLine) : true;
    }
    rear[0].sensorNote = [rear[0].sensorNote, `防抖原文：${tidy(oisLine)}`].filter(Boolean).join('；');
  }

  const frontRows = apRows(raw, '前置摄像头').map((x) => x.value);
  const frontMp = frontRows.find((t) => /万像素/.test(t));
  const frontAperture = frontRows.find((t) => /光圈/.test(t));
  rec.camera.front = frontMp || frontAperture
    ? { mp: frontMp ? (parseLens(frontMp).mp ?? null) : null, aperture: frontAperture ? parseAperture(frontAperture) : null }
    : null;
  rec.camera.videoMax = parseVideoMax(apBlob(raw, '视频拍摄', ' | '));

  /* ---- 连接与系统 ------------------------------------------------------ */
  const cellRows = apRows(raw, '蜂窝网络和无线连接').map((x) => x.value);
  const cell = cellRows.join(' | ');
  const nfcLine = cellRows.find((t) => /NFC/.test(t));
  rec.connectivity.fiveG = /5G|NR/.test(cell) ? true : null;
  rec.connectivity.wifi = (cell.match(/(?:802\.11\w+|Wi-?Fi)[^|｜，,；;]*/) ?? [])[0]?.trim() ?? null;
  rec.connectivity.bluetooth = (cell.match(/蓝牙\s*[\d.]+/) ?? [])[0] ?? null;
  rec.connectivity.nfc = nfcLine ? /支持.*NFC|NFC/.test(nfcLine) : null;
  rec.connectivity.satellite = null; // 苹果规格页无卫星通信章节 → null，不凭「SOS 紧急联络」推断
  rec.connectivity.usb = apBlob(raw, '充电和外设扩展', ' | ') || null;
  rec.connectivity.sim = tidy(apBlob(raw, 'SIM 卡', ' | ')) || null;
  rec.connectivity.esim = rec.connectivity.sim ? /eSIM/i.test(rec.connectivity.sim) : null;

  const osText = apBlob(raw, '操作系统');
  const osVer = osText.match(/iOS\s*[\d.]+/i);
  rec.os.launch = osVer ? osVer[0] : null; // 只写「iOS」没有版本号 → null，不把品牌名当版本号
  rec.os.upgradableTo = null; // 官网规格页不给「可升级到」→ null

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '尺寸与重量', dimText);
  pushOfficial(rec, '显示屏', dispJoin);
  pushOfficial(rec, '芯片', chipRows.join(' | '));
  pushOfficial(rec, '容量', capacityRows.join(' | '));
  pushOfficial(rec, '电源和电池', battJoin);
  pushOfficial(rec, '摄像头', camRows.slice(0, 2).join(' | '));
  pushOfficial(rec, '前置摄像头', frontRows.slice(0, 2).join(' | '));
  pushOfficial(rec, '防溅、抗水、防尘', ipText);
  pushOfficial(rec, '蜂窝网络和无线连接', cell);
  pushOfficial(rec, 'MagSafe 和无线充电', magsafe);

  /* ---- provenance ------------------------------------------------------ */
  const ap = AP;
  put(rec, 'body.heightMm', rec.body.heightMm, ap);
  put(rec, 'body.widthMm', rec.body.widthMm, ap);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, ap);
  put(rec, 'body.weightG', rec.body.weightG, ap);
  put(rec, 'body.ipRating', rec.body.ipRating, ap);
  put(rec, 'body.material', rec.body.material, ap);
  put(rec, 'body.colors', rec.body.colors, ap);
  put(rec, 'display.sizeIn', rec.display.sizeIn, ap);
  put(rec, 'display.type', rec.display.type, ap);
  putInto(rec, 'display.resolutionPx.w', rec.display.resolutionPx, ap);
  put(rec, 'display.ppi', rec.display.ppi, declaredPpi !== null ? ap : 'derived');
  put(rec, 'display.refreshHz', rec.display.refreshHz, ap);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, ap);
  put(rec, 'display.brightnessPeakNits', rec.display.brightnessPeakNits, ap);
  put(rec, 'display.protection', rec.display.protection, ap);
  put(rec, 'chipset.name', rec.chipset.name, ap);
  put(rec, 'chipset.cpuCores', rec.chipset.cpuCores, ap);
  put(rec, 'chipset.gpu', rec.chipset.gpu, ap);
  put(rec, 'chipset.npu', rec.chipset.npu, ap);
  put(rec, 'memory.storageGb', rec.memory.storageGb, ap);
  put(rec, 'battery.vendorClaimedVideoHours', rec.battery.vendorClaimedVideoHours, ap);
  put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, ap);
  put(rec, 'camera.rear', rec.camera.rear, ap);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, ap);
  put(rec, 'camera.videoMax', rec.camera.videoMax, ap);
  for (const k of ['fiveG', 'wifi', 'bluetooth', 'nfc', 'satellite', 'usb', 'sim', 'esim']) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], ap);
  }
  put(rec, 'os.launch', rec.os.launch, ap);
  addNote(rec, '苹果官网从不公布电池容量(mAh)、RAM 与有线充电峰值功率 → 对应字段为 null，属官网真没有');
  return rec;
}

/* ---------- C: 苹果对比页矩阵（粒度更粗，只补空缺） ---------- */

function mapAppleCompare(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'apple',
    line: 'iPhone',
    name,
    nameZh: null,
    granularity: 'compare-matrix',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  const matrix = FirstRaw(raw);

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const seg = { height: '尺寸与重量.高度', width: '尺寸与重量.宽度', thickness: '尺寸与重量.厚度', weight: '尺寸与重量.重量' };
  rec.body.heightMm = parseMm(realValue(matrix[seg.height]) ?? '');
  rec.body.widthMm = parseMm(realValue(matrix[seg.width]) ?? '');
  rec.body.thicknessMm = parseMm(realValue(matrix[seg.thickness]) ?? '');
  const weight = parseWeight(realValue(matrix[seg.weight]) ?? '');
  rec.body.weightG = weight.value;
  if (weight.note) addNote(rec, `重量原文「${tidy(matrix[seg.weight])}」：${weight.note}`);

  const ipText = apBlob(raw, '防溅、抗水、防尘');
  const ip = ipText.match(/IP\s?\d{2}/i);
  rec.body.ipRating = ip ? ip[0].replace(/\s/g, '').toUpperCase() : null;
  const colorLine = apFirst(raw, '外观.颜色导航');
  if (colorLine) rec.body.colors = colorLine.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean);
  rec.body.material = apFirst(raw, '速览.设计：材料') ?? null;

  /* ---- 屏幕 ------------------------------------------------------------ */
  const dispRows = apRows(raw, '显示屏').map((x) => x.value);
  const dispJoin = dispRows.join(' | ');
  const sizeLine = dispRows.find((t) => /英寸/.test(t) && /对角线/.test(t))
    ?? dispRows.find((t) => /英寸/.test(t) && /OLED|全面屏/.test(t))
    ?? dispRows.find((t) => /英寸/.test(t));
  rec.display.sizeIn = sizeLine
    ? parseInch(sizeLine)
    : parseInch(apFirst(raw, '速览.显示屏：屏幕尺寸') ?? '');
  // 矩阵的 `显示屏` 首行是「超视网膜 XDR 显示屏」（不带面板技术），
  // 面板技术写在第二行「6.3 英寸 (对角线) OLED 全面屏」里 → 优先取带面板技术的那一行。
  const typeLine = dispRows.find((t) => /OLED|LTPO|LCD/.test(t)) ?? dispJoin;
  const typeMatch = typeLine.match(/(超视网膜 XDR 显示屏|超视网膜显示屏|LTPO[^，,|｜()]*|OLED 可折叠全面屏|OLED 全面屏|OLED)/);
  rec.display.type = typeMatch ? normalizeType(typeMatch[1]) : null;
  rec.display.resolutionPx = pickFirstRes(dispRows);
  const declaredPpi = (() => {
    const m = dispJoin.replace(/,/g, '').match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*像素分辨率[，,]?\s*(\d+(?:\.\d+)?)\s*ppi/i)
      ?? dispJoin.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*ppi/i);
    return m ? Number(m[m.length - 1]) : null;
  })();
  rec.display.ppi = declaredPpi ?? derivePpi(rec.display.sizeIn, rec.display.resolutionPx);
  if (declaredPpi === null && rec.display.ppi !== null) {
    addNote(rec, '矩阵未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸推得，来源记 derived');
  }
  rec.display.refreshHz = refreshText(apFind(raw, '显示屏', /Hz/i) ?? '');
  const peakVals = [];
  const typVals = [];
  for (const line of dispRows.filter((t) => /尼特/.test(t))) {
    for (const m of line.matchAll(/(\d[\d,]*)\s*尼特\s*(?:峰值亮度|最大亮度)?\s*(?:\(([^)]*)\)|（([^）]*)）)?/g)) {
      const val = Number(m[1].replace(/,/g, ''));
      const qual = m[2] ?? m[3] ?? '';
      if (/峰值|HDR|户外/.test(qual) || /峰值/.test(m[0])) peakVals.push(val);
      else if (/典型/.test(qual) || /典型/.test(m[0])) typVals.push(val);
    }
  }
  rec.display.brightnessPeakNits = peakVals.length ? Math.max(...peakVals) : null;
  rec.display.brightnessTypicalNits = typVals.length ? Math.max(...typVals) : null;
  if (rec.display.brightnessPeakNits !== null && rec.display.brightnessTypicalNits !== null &&
      rec.display.brightnessPeakNits < rec.display.brightnessTypicalNits) {
    addNote(rec, '峰值亮度 < 典型亮度，口径解析可能串位，两者已置 null');
    rec.display.brightnessPeakNits = null;
    rec.display.brightnessTypicalNits = null;
  }
  rec.display.protection = apFind(raw, '速览', /超瓷晶/) ?? null;

  /* ---- 芯片 ------------------------------------------------------------ */
  const chipRows = apRows(raw, '芯片').map((x) => x.value);
  rec.chipset.name = chipRows.find((t) => /芯片$/.test(t)) ?? null;
  const cpuLine = chipRows.find((t) => /中央处理器/.test(t));
  rec.chipset.cpuCores = cpuLine ? firstNum(cpuLine) : null;
  rec.chipset.gpu = chipRows.find((t) => /图形处理器/.test(t)) ?? null;
  rec.chipset.npu = chipRows.find((t) => /神经网络引擎/.test(t)) ?? null;

  /* ---- 容量 ------------------------------------------------------------ */
  rec.memory.storageGb = parseStorageList(
    apRows(raw, '容量').map((x) => x.value).filter((t) => !/不适用/.test(t)).join(' | ')
  );

  /* ---- 电池与续航 ------------------------------------------------------ */
  const videoLine = apFind(raw, '电源和电池', /视频播放/) ?? apFind(raw, '速览', /视频播放/);
  if (videoLine) {
    rec.battery.vendorClaimedVideoHours = firstNum((videoLine.match(/最长可达\s*(\d+(?:\.\d+)?)\s*小时/) ?? [])[1] ?? '');
  }
  const fastLine = apFind(raw, '电源和电池', /可快速充电|充至 50%/);
  if (fastLine) {
    addNote(
      rec,
      `矩阵只给出「${tidy(fastLine)}」——其中瓦数是**电源适配器要求**，不是手机有线充电峰值功率，` +
        '故 battery.wiredChargeW 记 null'
    );
  }
  const wirelessLine = apFind(raw, '电源和电池', /无线充电/) ?? apFirst(raw, '速览.MagSafe: Wireless Charging');
  rec.battery.wirelessChargeW = wattOf(wirelessLine ?? '');

  /* ---- 影像 ------------------------------------------------------------ */
  const camRows = apRows(raw, '摄像头').map((x) => x.value);
  // 矩阵的镜头行形如 `4800 万像素融合式主摄 | 4800 万像素融合式超广角 | 4800 万像素融合式长焦`：
  // 每一段都必须以像素数开头，否则不是镜头清单（`摄像头(3)` 那类防抖行会被排除）。
  const lensRow = camRows.find((t) => {
    if (!/[|｜]/.test(t)) return false;
    const segs = t.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean);
    return segs.length >= 2 && segs.every((s) => /^[\d.]+\s*[亿万]/.test(s));  }) ?? '';
  rec.camera.rear = lensRow
    ? lensRow.split(/\s*[|｜]\s*/).map(tidy).filter((t) => /万像素|亿像素/.test(t)).map((t) => parseLens(t))
    : [];
  const oisLine = camRows.find((t) => /防抖/.test(t) && t !== lensRow && /[（(]/.test(t) && t.length < 200);
  if (oisLine && rec.camera.rear.length) {
    const roleKeys = { main: /主摄/, ultrawide: /超广角/, tele: /长焦/, periscope: /潜望/, macro: /微距/ };
    for (const cam of rec.camera.rear) {
      if (cam.ois === false) continue;
      cam.ois = roleKeys[cam.role] ? roleKeys[cam.role].test(oisLine) : true;
    }
    rec.camera.rear[0].sensorNote = [rec.camera.rear[0].sensorNote, `防抖原文：${tidy(oisLine)}`].filter(Boolean).join('；');
  }
  const frontMp = apFind(raw, '前置摄像头', /万像素/);
  rec.camera.front = frontMp ? { mp: parseLens(frontMp).mp ?? null, aperture: null } : null;
  rec.camera.videoMax = parseVideoMax(apBlob(raw, '视频拍摄', ' | '));

  /* ---- 连接与系统 ------------------------------------------------------ */
  const cell = apBlob(raw, '蜂窝网络和无线连接', ' | ');
  rec.connectivity.fiveG = /5G|NR/.test(cell) ? true : null;
  rec.connectivity.wifi = (cell.match(/(?:802\.11\w+|Wi-?Fi)[^|｜，,；;]*/) ?? [])[0]?.trim() ?? null;
  rec.connectivity.bluetooth = (cell.match(/蓝牙\s*[\d.]+/) ?? [])[0] ?? null;
  rec.connectivity.nfc = /NFC/.test(cell) ? true : null;
  rec.connectivity.satellite = null;
  rec.connectivity.usb = apBlob(raw, '连接端口', ' | ') || apFirst(raw, '速览.连接') || null;
  rec.connectivity.sim = tidy(apBlob(raw, 'SIM 卡', ' | ')) || null;
  rec.connectivity.esim = rec.connectivity.sim ? /eSIM/i.test(rec.connectivity.sim) : null;
  rec.os.launch = null; // 矩阵无操作系统行
  rec.os.upgradableTo = null;

  // 矩阵的价格行是 JS 注入模板（{IPHONExxx}）或「于授权经销商处有售」→ 不收价格
  rec.skus = [];
  addNote(rec, '该机型官网已无独立规格页，数据来自对比页矩阵（粒度更粗，字段更少）');
  addNote(rec, '苹果官网从不公布电池容量(mAh)、RAM 与有线充电峰值功率 → 对应字段为 null，属官网真没有');

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '尺寸与重量', ['尺寸与重量.高度', '尺寸与重量.宽度', '尺寸与重量.厚度', '尺寸与重量.重量']
    .map((k) => realValue(raw[k])).filter(Boolean).join(' | '));
  pushOfficial(rec, '显示屏', dispJoin);
  pushOfficial(rec, '芯片', apBlob(raw, '芯片', ' | '));
  pushOfficial(rec, '容量', apBlob(raw, '容量', ' | '));
  pushOfficial(rec, '电源和电池', apBlob(raw, '电源和电池', ' | '));
  pushOfficial(rec, '摄像头', apBlob(raw, '摄像头', ' | ').slice(0, 400));
  pushOfficial(rec, '前置摄像头', apBlob(raw, '前置摄像头', ' | ').slice(0, 300));
  pushOfficial(rec, '防溅、抗水、防尘', ipText);
  pushOfficial(rec, '蜂窝网络和无线连接', cell);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, AC);
  put(rec, 'body.widthMm', rec.body.widthMm, AC);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, AC);
  put(rec, 'body.weightG', rec.body.weightG, AC);
  put(rec, 'body.ipRating', rec.body.ipRating, AC);
  put(rec, 'body.material', rec.body.material, AC);
  put(rec, 'body.colors', rec.body.colors, AC);
  put(rec, 'display.sizeIn', rec.display.sizeIn, AC);
  put(rec, 'display.type', rec.display.type, AC);
  putInto(rec, 'display.resolutionPx.w', rec.display.resolutionPx, AC);
  put(rec, 'display.ppi', rec.display.ppi, declaredPpi !== null ? AC : 'derived');
  put(rec, 'display.refreshHz', rec.display.refreshHz, AC);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, AC);
  put(rec, 'display.brightnessPeakNits', rec.display.brightnessPeakNits, AC);
  put(rec, 'display.protection', rec.display.protection, AC);
  put(rec, 'chipset.name', rec.chipset.name, AC);
  put(rec, 'chipset.cpuCores', rec.chipset.cpuCores, AC);
  put(rec, 'chipset.gpu', rec.chipset.gpu, AC);
  put(rec, 'chipset.npu', rec.chipset.npu, AC);
  put(rec, 'memory.storageGb', rec.memory.storageGb, AC);
  put(rec, 'battery.vendorClaimedVideoHours', rec.battery.vendorClaimedVideoHours, AC);
  put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, AC);
  put(rec, 'camera.rear', rec.camera.rear, AC);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, AC);
  put(rec, 'camera.videoMax', rec.camera.videoMax, AC);
  for (const k of ['fiveG', 'wifi', 'bluetooth', 'nfc', 'satellite', 'usb', 'sim', 'esim']) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], AC);
  }

  return rec;
}

/** 对比页矩阵里，`尺寸与重量.*` 这类平铺键直接读；组内序号键按序拼 */
function FirstRaw(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = realValue(v);
    if (t !== undefined && !(k in out)) out[k] = t;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. 合并：规格页 > 对比页矩阵（矩阵只补空缺）
 * ══════════════════════════════════════════════════════════════════════════ */

const CONTRACT_PATHS = [
  'body.heightMm', 'body.widthMm', 'body.thicknessMm', 'body.weightG', 'body.ipRating', 'body.material', 'body.colors',
  'display.sizeIn', 'display.type', 'display.resolutionPx', 'display.ppi', 'display.refreshHz',
  'display.brightnessTypicalNits', 'display.brightnessPeakNits', 'display.protection',
  'chipset.name', 'chipset.processNm', 'chipset.cpuCores', 'chipset.gpu', 'chipset.npu',
  'memory.ramGb', 'memory.storageGb',
  'battery.capacityMah', 'battery.capacityCaliber', 'battery.wiredChargeW', 'battery.wirelessChargeW',
  'battery.vendorClaimedVideoHours', 'battery.measuredHours',
  'camera.rear', 'camera.front', 'camera.videoMax',
  'connectivity.fiveG', 'connectivity.wifi', 'connectivity.bluetooth', 'connectivity.nfc',
  'connectivity.satellite', 'connectivity.usb', 'connectivity.sim', 'connectivity.esim',
  'os.launch', 'os.upgradableTo', 'skus',
];

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  const last = ks.pop();
  let cur = o;
  for (const k of ks) cur = cur[k];
  cur[last] = v;
};

const isEmpty = (v) =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);

/**
 * 把矩阵记录合并进规格页记录：**只填空缺，绝不覆盖**。
 * 被矩阵补上的字段 provenance 改成 apple-compare，让「这个数粒度更粗」在数据里可见；
 * 整机 granularity 保持 specs-page（因为主体来自规格页）。
 */
function mergeMissing(primary, filler) {
  const filled = [];
  for (const path of CONTRACT_PATHS) {
    if (path === 'display.resolutionPx') {
      const a = getPath(primary, path);
      const b = getPath(filler, path);
      if (isEmpty(a) && !isEmpty(b)) {
        setPath(primary, path, b);
        primary.provenance['display.resolutionPx.w'] = AC;
        filled.push(path);
      }
      continue;
    }
    const a = getPath(primary, path);
    if (!isEmpty(a)) continue;
    const b = getPath(filler, path);
    if (isEmpty(b)) continue;
    setPath(primary, path, b);
    primary.provenance[path] = AC;
    filled.push(path);
  }
  for (const [k, v] of Object.entries(filler.rawOfficial)) {
    if (!primary.rawOfficial[k]) primary.rawOfficial[k] = v;
  }
  for (const n of filler.notes) addNote(primary, n);
  if (filled.length) {
    addNote(primary, `以下字段规格页没有、由对比页矩阵补位（provenance=apple-compare）：${filled.join('、')}`);
  }
  return primary;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. 覆盖率表
 * ══════════════════════════════════════════════════════════════════════════ */

/** 契约里所有「应该有值」的叶子字段 */
const COVERAGE_FIELDS = [
  'body.heightMm', 'body.widthMm', 'body.thicknessMm', 'body.weightG', 'body.ipRating', 'body.material', 'body.colors',
  'display.sizeIn', 'display.type', 'display.resolutionPx', 'display.ppi', 'display.refreshHz',
  'display.brightnessTypicalNits', 'display.brightnessPeakNits', 'display.protection',
  'chipset.name', 'chipset.cpuCores', 'chipset.gpu', 'chipset.npu',
  'memory.ramGb', 'memory.storageGb',
  'battery.capacityMah', 'battery.capacityCaliber', 'battery.wiredChargeW', 'battery.wirelessChargeW',
  'battery.vendorClaimedVideoHours',
  'camera.rear', 'camera.front', 'camera.videoMax',
  'connectivity.fiveG', 'connectivity.wifi', 'connectivity.bluetooth', 'connectivity.nfc',
  'connectivity.satellite', 'connectivity.usb', 'connectivity.sim', 'connectivity.esim',
  'os.launch', 'skus', 'provenance',
];

const hasValue = (p, path) => {
  const v = path === 'provenance' ? Object.keys(p.provenance ?? {}).length : getPath(p, path);
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

function printCoverage(products) {
  const total = products.length;
  const printGroup = (label, list) => {
    console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
    const rows = list.map((path) => [path, products.filter((p) => hasValue(p, path)).length]);
    const w = Math.max(...rows.map(([p]) => p.length));
    for (const [path, n] of rows) {
      const pct = ((n / total) * 100).toFixed(1).padStart(5);
      const bar = '█'.repeat(Math.round((n / total) * 24)).padEnd(24, '·');
      console.log(`  ${path.padEnd(w)}  ${String(n).padStart(3)}/${total}  ${pct}%  ${bar}`);
    }
  };

  printGroup('总体（三通道合计）', COVERAGE_FIELDS);

  for (const [key, label] of [
    ['huawei', '华为规格页（通道 A）'],
    ['apple-specs', '苹果规格页（通道 B）'],
    ['apple-compare', '苹果对比页矩阵（通道 C）'],
  ]) {
    const sub = products.filter((p) =>
      key === 'huawei' ? p.brand === 'huawei'
        : key === 'apple-specs' ? p.brand === 'apple' && p.granularity === 'specs-page'
          : p.brand === 'apple' && p.granularity === 'compare-matrix');
    if (!sub.length) {
      console.log(`\n── ${label} ──\n  （无机型）`);
      continue;
    }
    console.log(`\n${'═'.repeat(72)}\n${label}：${sub.length} 台`);
    const rows = COVERAGE_FIELDS.map((path) => [path, sub.filter((p) => hasValue(p, path)).length]);
    const w = Math.max(...rows.map(([p]) => p.length));
    for (const [path, n] of rows) {
      const pct = ((n / sub.length) * 100).toFixed(1).padStart(5);
      const bar = '█'.repeat(Math.round((n / sub.length) * 24)).padEnd(24, '·');
      console.log(`  ${path.padEnd(w)}  ${String(n).padStart(3)}/${sub.length}  ${pct}%  ${bar}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. 入口
 * ══════════════════════════════════════════════════════════════════════════ */

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const outPath = argValue('--out', join(WORK, 'normalized.json'));
  const probe = process.argv.includes('--probe');

  const huawei = JSON.parse(readFileSync(SRC_HUAWEI, 'utf8'));
  const apple = JSON.parse(readFileSync(SRC_APPLE, 'utf8'));

  /* --- 通道 A：华为规格页 --- */
  const huaweiRecords = huawei.products.map(mapHuawei);

  /* --- 通道 B：苹果规格页（按机型拆分）---
   * 一个规格页可能含多个机型：适配器已按机型拆成独立 product（apple-iphone-18-pro /
   * apple-iphone-18-pro-max，specsUrl 相同），并写出「两种机型均具备」公共段。
   * 这里再跑一遍 sliceByVariants 做「切得开」的自证：切不开时按公共段共享处理，不瞎切。
   */
  const pageIndex = new Map();
  for (const p of apple.products) {
    const list = pageIndex.get(p.specsUrl) ?? [];
    list.push(p);
    pageIndex.set(p.specsUrl, list);
  }
  const specsRecords = [];
  for (const p of apple.products) {
    const rec = mapAppleSpecs(p);
    const siblings = (pageIndex.get(p.specsUrl) ?? []).map((x) => stripInvisible(x.name));
    if (siblings.length > 1) {
      const sharedText = Object.entries(p.raw)
        .filter(([k]) => APPLE_SHARED_MARK.test(k))
        .map(([, v]) => tidy(v)).join(' | ');
      const sliced = sliceByVariants(sharedText, siblings);
      addNote(
        rec,
        `规格页 ${p.specsUrl} 同时包含 ${siblings.length} 个机型（${siblings.join(' / ')}）；` +
          `本机数据由「按机型名分段」拆出，公共段（两种机型均具备）由全部变体共享。` +
          `sliceByVariants 结果：${sliced ? `切出 ${Object.keys(sliced).join('、')}` : '未命中机型名，公共段整体共享'}`
      );
      rec.rawOfficial['同页拆分'] = `页面机型：${siblings.join(' / ')}；本机取「${rec.name}」段`;
    }
    specsRecords.push(rec);
  }

  /* --- 通道 C：苹果对比页矩阵（只补规格页拿不到的机型）---
   * 矩阵一次给出全部 42 款（含 iPhone 7/8/X 这些早于窗口的老机型）。
   * 这里按「首版范围」剪裁：只收 (a) 已有的发布日期取证落 2024-09 之后的，
   * 或 (b) 取证表里没有但名字能看出是 16 代及以后的。其余不进产出 ——
   * 它们注定会被 sync 的窗口过滤丢掉，留在中间文件里只会污染覆盖率表。
   */
  const WINDOW_START = '2024-09-01';
  // 取证表是 curated 数据，权威副本在 data/（入库）；_work/ 只是本地兼容路径
  const rdPath = [join(ROOT, 'data', 'release-dates.json'), join(WORK, 'release-dates.json')]
    .find((p) => existsSync(p));
  const releaseDates = rdPath ? JSON.parse(readFileSync(rdPath, 'utf8')) : null;
  const dateById = new Map((releaseDates?.entries ?? []).map((e) => [e.id, e]));
  /** 名字里能直接读出「16 代及以后」的写法，用于取证表缺失时的兜底判断 */
  const nameInWindow = (n) => /\b(1[6-9]|2\d)(e| Plus| Pro| Pro Max| Air| mini)?\b/i.test(stripInvisible(n));

  let compare = null;
  let compareRecords = [];
  let compareDropped = [];
  let compareStatus = 'not-found';
  if (existsSync(SRC_APPLE_COMPARE)) {
    compare = JSON.parse(readFileSync(SRC_APPLE_COMPARE, 'utf8'));
    const specIds = new Set(apple.products.map((p) => p.id));
    const gapOnly = compare.products.filter((p) => !specIds.has(p.id));
    for (const p of gapOnly) {
      const dated = dateById.get(p.id);
      const inWindow = dated?.date ? Date.parse(dated.date) >= Date.parse(WINDOW_START) : nameInWindow(p.name);
      if (inWindow) compareRecords.push(mapAppleCompare(p));
      else compareDropped.push({ id: p.id, name: p.name, date: dated?.date ?? null });
    }
    compareStatus =
      `就绪（矩阵 ${compare.products.length} 台；其中规格页没有的 ${gapOnly.length} 台，` +
      `落在首发窗口内 ${compareRecords.length} 台 → 作为独立机型收录，窗口外 ${compareDropped.length} 台不收）`;
  } else {
    compareStatus = '未就绪：_work/apple-compare.raw.json 不存在 → 本次跳过通道 C，不产出矩阵补位机型';
  }

  /* --- 合并：规格页 > 对比页矩阵，矩阵只补空缺 --- */
  if (compare) {
    const specIds = new Set(specsRecords.map((r) => r.id));
    const fillers = new Map();
    for (const p of compare.products) {
      if (!specIds.has(p.id)) continue;
      fillers.set(p.id, mapAppleCompare(p));
    }
    for (const rec of specsRecords) {
      const filler = fillers.get(rec.id);
      if (filler) mergeMissing(rec, filler);
    }
  }

  const byId = new Map();
  for (const r of [...huaweiRecords, ...specsRecords, ...compareRecords]) byId.set(r.id, r);

  /* --- 通道 D：苹果官方价格（购买页内联 JSON，逐 SKU 三重重验证）---
   * apple-prices.raw.json 的 products[] 每台带 startPriceCny + pricesByStorage。
   * 价格来源与规格页是两个页面、两套口径，所以 provenance 记的是 apple-official（价格通道），
   * 价格缺失的机型（官网已停售）保持 skus = []，对比页「起售价」行会如实显示「官网已下架」。
   */
  let pricesStatus = '未就绪';
  if (existsSync(SRC_APPLE_PRICES)) {
    const prices = JSON.parse(readFileSync(SRC_APPLE_PRICES, 'utf8'));
    const priceById = new Map((prices.products ?? []).map((p) => [p.id, p]));
    let attached = 0;
    for (const rec of byId.values()) {
      if (rec.brand !== 'apple') continue;
      const src = priceById.get(rec.id);
      if (!src || !src.pricesByStorage?.length) continue;
      rec.skus = src.pricesByStorage.map((s) => ({
        storageGb: s.storageGb,
        ramGb: null, // 苹果按存储档定价，但 RAM 不随存储变化且官方不公布，不在此处猜测
        priceCny: s.priceCny,
        priceNote: src.priceScope ?? '官方指导价（中国大陆）',
        listedAt: (src.fetchedAt ?? '').slice(0, 10),
      }));
      putInto(rec, 'skus', rec.skus, AP);
      attached += 1;
    }
    pricesStatus = `就绪（${(prices.products ?? []).length} 台有价；本次接入 ${attached} 台；已停售无价 ${prices.missing?.length ?? 0} 台 → skus 留空，不编造）`;
  }

  const products = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  /* --- 一致性自检：不能静默出错的地方，直接在这里喊 --- */
  const problems = [];
  const ids = new Set();
  for (const p of products) {
    if (ids.has(p.id)) problems.push(`id 重复：${p.id}`);
    ids.add(p.id);
    if (p.releaseDate !== null) problems.push(`${p.id} releaseDate 应由 sync 回填，规范化层不应写入`);
    if (p.battery.capacityMah !== null && !p.battery.capacityCaliber) {
      problems.push(`${p.id} 有电池容量但缺口径（capacityCaliber）`);
    }
    for (const path of ['body.weightG', 'display.sizeIn', 'battery.capacityMah', 'memory.storageGb', 'body.thicknessMm', 'display.ppi', 'display.resolutionPx', 'battery.wiredChargeW', 'chipset.name', 'camera.rear', 'connectivity.sim']) {
      const v = getPath(p, path);
      const filled = path === 'display.resolutionPx' ? !isEmpty(v) : !isEmpty(v);
      if (filled && !p.provenance[path] && path !== 'display.resolutionPx') {
        problems.push(`${p.id} 的 ${path} 有值但缺 provenance`);
      }
      if (filled && path === 'display.resolutionPx' && !p.provenance['display.resolutionPx.w']) {
        problems.push(`${p.id} 的 display.resolutionPx 有值但缺 provenance`);
      }
    }
    if (p.skus?.length && !p.provenance.skus) {
      problems.push(`${p.id} 有 skus 但缺 provenance`);
    }
  }

  /* --- 写盘 --- */
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

  /* --- 报告 --- */
  console.log('手机参数对比站 · 规范化层');
  console.log(`输入：${SRC_HUAWEI.replace(ROOT, '.')}（${huawei.products.length} 台）`);
  console.log(`      ${SRC_APPLE.replace(ROOT, '.')}（${apple.products.length} 台 / ${pageIndex.size} 个规格页）`);
  console.log(`      ${SRC_APPLE_COMPARE.replace(ROOT, '.')} → ${compareStatus}`);
  console.log(`      ${SRC_APPLE_PRICES.replace(ROOT, '.')} → ${pricesStatus}`);
  console.log(`输出：${outPath.replace(ROOT, '.')}  共 ${products.length} 台\n`);

  const hw = products.filter((p) => p.brand === 'huawei').length;
  const aps = products.filter((p) => p.brand === 'apple' && p.granularity === 'specs-page').length;
  const apc = products.filter((p) => p.brand === 'apple' && p.granularity === 'compare-matrix').length;
  console.log(`机型数：华为规格页 ${hw} + 苹果规格页 ${aps} + 苹果矩阵 ${apc} = ${products.length}`);
  if (compareDropped.length) {
    console.log(`矩阵通道另有 ${compareDropped.length} 台落在首发窗口（${WINDOW_START}）之前，未收录：`);
    console.log(`  ${compareDropped.map((x) => `${x.name}${x.date ? `(${x.date})` : ''}`).join('、')}`);
  }

  // 苹果规格页拆分自证
  console.log('\n── 苹果规格页「同页多机型」拆分自证 ─────────────────────────────');
  for (const [url, list] of pageIndex) {
    if (list.length < 2) continue;
    const names = list.map((x) => x.name);
    console.log(`  ${url}`);
    console.log(`    页面机型 ${list.length} 台：${names.join(' / ')}`);
    for (const p of products.filter((x) => names.some((n) => stripInvisible(n) === x.name))) {
      console.log(`      · ${p.id.padEnd(26)} 重量 ${String(p.body.weightG ?? 'null').padStart(4)} g   屏幕 ${String(p.display.sizeIn ?? 'null').padStart(5)} 英寸   granularity=${p.granularity}`);
    }
  }

  // 华为无处理器章节机型的 null 计数
  const hwNoChip = products.filter((p) => p.brand === 'huawei' && p.chipset.name === null);
  console.log('\n── null 计数（「官网真没有」的证据）────────────────────────────');
  console.log(`  华为 chipset.name = null：${hwNoChip.length} / ${hw} 台`);
  console.log(`    ${hwNoChip.map((p) => p.id).join(', ')}`);
  console.log(`  苹果 battery.capacityMah = null：${products.filter((p) => p.brand === 'apple' && p.battery.capacityMah === null).length} / ${aps + apc} 台（苹果从不公布 mAh）`);
  console.log(`  苹果 chipset.processNm = null：${products.filter((p) => p.brand === 'apple' && p.chipset.processNm === null).length} / ${aps + apc} 台`);
  console.log(`  全体 body.weightG = null：${products.filter((p) => p.body.weightG === null).length} 台`);
  console.log(`  全体 display.brightnessPeakNits = null：${products.filter((p) => p.display.brightnessPeakNits === null).length} 台`);
  console.log(`  全体 battery.wiredChargeW = null：${products.filter((p) => p.battery.wiredChargeW === null).length} 台`);
  console.log(`  有 skus（价格）的机型：${products.filter((p) => p.skus?.length).length} 台（华为 ${products.filter((p) => p.brand === 'huawei' && p.skus?.length).length} + 苹果 ${products.filter((p) => p.brand === 'apple' && p.skus?.length).length}）`);

  printCoverage(products);

  console.log(`\n${'═'.repeat(72)}`);
  if (problems.length) {
    console.log(`❌ 自检发现 ${problems.length} 个问题：`);
    for (const x of problems.slice(0, 30)) console.log(`  - ${x}`);
    process.exitCode = 1;
  } else {
    console.log('✅ 自检通过：id 唯一、releaseDate 留空待 sync 回填、口径与 provenance 齐全');
  }

  if (probe) {
    const unmapped = new Map();
    for (const p of huawei.products) {
      for (const k of Object.keys(p.raw)) {
        if (k.startsWith('_')) continue;
        const sec = k.split('@')[0].split('.')[0];
        unmapped.set(sec, (unmapped.get(sec) ?? 0) + 1);
      }
    }
    console.log('\n── 华为原始章节覆盖（--probe）────────────────────────────────');
    for (const [sec, n] of [...unmapped].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${sec.padEnd(16)} ${n} 次出现在原始数据里`);
    }
  }
}

main();
