/**
 * 单位与口径解析。规范化层的地基，全部是纯函数，可单测。
 *
 * 三条纪律：
 *   1. **解析不出来就返回 null，绝不猜、绝不兜底成 0。** 「没有数据」和「数据是 0」
 *      在界面上必须长得不一样。
 *   2. **口径跟着数值一起出来。** 电池 mAh 是典型值还是额定值、亮度是峰值还是典型，
 *      解析函数必须把它一并返回，缺口径的数值不许进快照（闸门会拦）。
 *   3. **只认「第一个合理数字」**，不做跨字段推断。宁可 null，不要错。
 */

/** 官网文本里混杂的零宽字符（&#8203; &#8288; 等），会污染名称与数值比对 */
export function stripInvisible(s) {
  return String(s ?? '')
    // 各类非常规空格（U+2000–200A 等）与零宽字符（U+200B–200F、U+2060–2064）一并去掉。
    // 华为页面的机型名会写成「非<U+2008>凡<U+2008>大<U+2008>师」，不去掉就没法与别处对齐。
    .replace(/[\u2000-\u200F\u2028\u2029\u202F\u205F\u2060-\u2064\uFEFF]/g, '')
    .replace(/&(?:#8203|#8288|#8199|nbsp);/gi, '')
    .trim();
}

/** 归一化键名用于别名匹配：去空格/全角括号/下划线，便于「运行内存（RAM）」≈「运行内存」 */
export function normalizeKey(key) {
  return stripInvisible(key)
    .replace(/[\s\u3000]/g, '')
    .replace(/[（）()【】\[\]]/g, '')
    .replace(/[·.。:：/\\|]/g, '')
    .toLowerCase();
}

/** 取文本里第一个数字（支持千位分隔与小数） */
export function firstNumber(text) {
  const m = String(text ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 全部数字 */
export function allNumbers(text) {
  return (String(text ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const withUnit = (text, unitRe) => {
  const m = String(text ?? '').replace(/,/g, '').match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(?:${unitRe})`, 'i'));
  return m ? Number(m[1]) : null;
};

export const parseMm = (t) => withUnit(t, 'mm|毫米');
/*
 * 注意 `\b` 在 JS 里是 ASCII 词边界：`克\b` 永远匹配不上（`克` 与后面的空格都不是 \w）。
 * 所以非 ASCII 单位单独一支，不加 \b。
 */
export const parseG = (t) => withUnit(t, 'g\\b|克|gram');
export const parseInch = (t) => withUnit(t, '英寸|inch|"|″');
export const parsePpi = (t) => withUnit(t, 'ppi');
export const parseWatt = (t) => withUnit(t, 'w|瓦');
export const parseNits = (t) => withUnit(t, 'nits|尼特');
export const parseHz = (t) => withUnit(t, 'hz');

/**
 * 电池容量：同时给出数值与口径。
 * 华为写「6800 mAh（典型值）」，额定值常出现在章节脚注（`_notes.电池`）里。
 * @returns {{value:number|null, caliber:'typical'|'rated'|null}}
 */
export function parseCapacity(text) {
  const s = stripInvisible(text);
  const value = withUnit(s, 'mah|毫安时');
  let caliber = null;
  if (/额定/.test(s)) caliber = 'rated';
  else if (/典型/.test(s)) caliber = 'typical';
  return { value, caliber };
}

/**
 * 存储 / 内存档位：`256 GB / 512 GB / 1 TB` → [256,512,1024]（去重升序）。
 * 单位不是 GB/TB 的（如「12 GB RAM」混在 ROM 字段里）交由调用方按字段区分。
 */
export function parseStorageList(text) {
  const s = stripInvisible(text);
  const out = new Set();
  const re = /(\d+(?:\.\d+)?)\s*(tb|gb)\b/gi;
  let m;
  while ((m = re.exec(s))) {
    const v = Number(m[1]) * (m[2].toLowerCase() === 'tb' ? 1024 : 1);
    if (Number.isFinite(v) && v > 0) out.add(Math.round(v));
  }
  return [...out].sort((a, b) => a - b);
}

/** 分辨率：`2622 x 1206 像素` / `2868×1320` */
export function parseResolution(text) {
  const s = stripInvisible(text).replace(/,/g, '');
  const m = s.match(/(\d{3,5})\s*[x×*]\s*(\d{3,5})/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * 刷新率：官网写法五花八门——`最高可达 120Hz`、`1-120Hz 自适应`、`120Hz`。
 * 上限取最大值，区间原样保留为字符串（区间本身是有信息量的：只有上限会掩盖 LTPO）。
 */
export function parseRefresh(text) {
  const s = stripInvisible(text);
  if (!s || !/hz/i.test(s)) return null;
  const nums = allNumbers(s.slice(0, s.toLowerCase().indexOf('hz') + 2));
  if (!nums.length) return null;
  const max = Math.max(...nums);
  const range = nums.length >= 2 && Math.min(...nums) < max ? `${Math.min(...nums)}-${max}` : null;
  return { maxHz: max, text: range ?? `${max}`, raw: s };
}

/**
 * 重量：华为 `234 g`（可能含「标准版 234g / 典藏版 235g」并列写法）。
 * 并列时取**第一个**并在 note 里说明，绝不取平均（平均值是编造）。
 */
export function parseWeight(text) {
  const s = stripInvisible(text);
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:g\b|克|gram)/gi)].map((m) => Number(m[1]));
  if (!nums.length) return { value: null, note: null };
  const note = nums.length > 1 ? `原文含 ${nums.length} 个重量值（${nums.join(' / ')} g），取第一个，口径需人工确认` : null;
  return { value: nums[0], note };
}

/** 从「峰值亮度 2000 尼特」这类文本里分辨口径 */
export function parseBrightness(text) {
  const s = stripInvisible(text);
  const nums = [...s.matchAll(/(\d[\d,]*)\s*(?:尼特|nits?)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
  if (!nums.length) return { peak: null, typical: null, values: [] };
  const isPeak = /峰值|HDR|局部/.test(s);
  const isTypical = /典型|全屏|持续/.test(s);
  return {
    peak: isPeak ? Math.max(...nums) : null,
    typical: isTypical ? Math.max(...nums) : null,
    values: nums,
  };
}

/**
 * 把「同一页含多机型」的文本按机型名切片。
 * 输入形如 `[iPhone 18 Pro] 71.9 毫米 …… [iPhone 18 Pro Max] 78.0 毫米 ……`，
 * 返回 `{ 'iPhone 18 Pro': '…', 'iPhone 18 Pro Max': '…' }`。
 * 找不到任何机型名时返回 null，由调用方决定怎么处理——**不要瞎切**。
 */
export function sliceByVariants(text, variantNames) {
  const s = stripInvisible(text);
  if (!variantNames?.length) return null;
  const hits = [];
  for (const name of variantNames) {
    const idx = s.indexOf(name);
    if (idx >= 0) hits.push({ name, idx });
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.idx - b.idx);
  const out = {};
  for (let i = 0; i < hits.length; i += 1) {
    const end = i + 1 < hits.length ? hits[i + 1].idx : s.length;
    // 切片会带上标记本身的方括号与分隔符，一并清掉：
    //   `[iPhone 18 Pro] 71.9 毫米 …… [iPhone 18 Pro Max]` → 需要 `71.9 毫米 ……`
    out[hits[i].name] = s
      .slice(hits[i].idx + hits[i].name.length, end)
      .replace(/^[\s\];,，、|]+/, '')
      .replace(/[\s[（(]+$/, '')
      .trim();
  }
  return out;
}

/** 机型名 → slug：`iPhone 17 Pro Max` → `iphone-17-pro-max`；`Mate 90 RS 非凡大师` → `mate90-rs` */
export function slugify(name) {
  return stripInvisible(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 简单单测：node scripts/normalize/parse.mjs --selftest */
if (process.argv.includes('--selftest')) {
  const cases = [
    ['parseMm', parseMm('150.0 毫米 (5.91 英寸)'), 150],
    ['parseWeight', parseWeight('211 克 (7.44 盎司)').value, 211],
    ['parseWeight并列', parseWeight('标准版 234g / 典藏版 235g').value, 234],
    ['parseCapacity', parseCapacity('6800 mAh（典型值）').value, 6800],
    ['parseCapacity口径', parseCapacity('6800 mAh（典型值）').caliber, 'typical'],
    ['parseStorageList', JSON.stringify(parseStorageList('256 GB / 512 GB / 1 TB')), JSON.stringify([256, 512, 1024])],
    ['parseResolution', JSON.stringify(parseResolution('2622 x 1206 像素分辨率')), JSON.stringify({ w: 2622, h: 1206 })],
    ['parseRefresh', parseRefresh('ProMotion 自适应刷新率技术，最高可达 120Hz').maxHz, 120],
    ['parseNits', parseNits('峰值亮度 2000 尼特'), 2000],
    ['stripInvisible', stripInvisible('Mate 90 RS 非\u2008凡\u2008大\u2008师'), 'Mate 90 RS 非凡大师'],
    ['sliceByVariants', JSON.stringify(sliceByVariants('[A] 1 [B] 2', ['A', 'B'])), JSON.stringify({ A: '1', B: '2' })],
  ];
  let bad = 0;
  for (const [name, got, want] of cases) {
    const ok = String(got) === String(want);
    if (!ok) bad += 1;
    console.log(`${ok ? '✅' : '❌'} ${name} → ${got}${ok ? '' : `（期望 ${want}）`}`);
  }
  console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
}
