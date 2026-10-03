/**
 * 多语言基础设施。
 *
 * ## 为什么现在就搭，而不是等要做英文时再说
 *
 * 因为**文案不是集中存放的**。它散在三处：
 *   1. `scripts/site/lib/ui.mjs` —— 页面壳、导航、通用格式化函数
 *   2. `scripts/site/build.mjs` —— 各页面的标题与正文
 *   3. `scripts/lib/derive.mjs` —— 一句话定位、头衔（数据派生文案）
 *
 * 现在不抽字典，第二期就得逐个函数加 `lang` 参数，
 * 而那正是最容易漏的地方——漏掉一个 `lang`，那一处就永远只出中文，
 * 而且**不报错、不崩溃、只是静静地在英文页里留一行中文**。
 *
 * ## 架子长什么样
 *
 *   - `DICT` 一份纯数据，键用点号路径，值是文案或 `{zh, en}` 二选一
 *   - `t(dict, key, lang)` 取值。**缺键抛错**，绝不静默回退到中文——
 *     静默回退是 i18n 里最常见的错误来源（页面混着两种语言，没人发现）
 *   - `pick(dict, lang)` 用于数据派生的枚举值（那些来自 derive/analyze 层）
 *   - 站点构建时全量过一遍 `assertNoMissingKeys`，把缺键变成构建失败
 *
 * ## 现在是什么状态
 *
 * **`en` 字典尚未填写。** 当前 `DEFAULT_LANG = 'zh'`，英文处于「架子已备、内容待填」状态。
 * 这不是半吊子，而是刻意的：字典结构可以先定下来并被CI 检查（键必须两个语言都有），
 * 但**在没有真实英文页面之前硬填一份英文，等于给自己造一份永远没人校对过的翻译**。
 *
 * 填英文时的顺序建议：先 `site.*` 与 `nav.*`（页面壳，出现在每一页），
 * 再各页面的 `lede`，最后是 derive 层的定位文案。
 * 数据派生的文案（`analogiesOf` / `buildPersona` 的「最轻（170 g）」）
 * 拆成「形容词 + 数值」更好翻，不要整句翻译。
 */

export const LANGS = ['zh', 'en'];

/**
 * @typedef {'zh' | 'en'} Lang
 */

export const DEFAULT_LANG = 'zh';

/** BCP 47 语言标签，输出到 `<html lang>` 与页面元信息 */
const HTML_LANG = { zh: 'zh-CN', en: 'en' };

/* ------------------------------------------------------------------ *
 * 字典
 * ------------------------------------------------------------------ *
 *
 * 值的三种写法：
 *   '中文'                 —— 只有中文。en 键存在时由 key 派生，缺失时构建报错
 *   { zh: '中文', en: 'En' } —— 两种语言都有
 *
 * 键命名：`层.分组.键`。层只用 site / nav / filter / label / msg / metric。
 * 不给内容本身起命名空间（如 `nav.home` 而不是 `pageTitles.home`），
 * 是为了第二期加英文页时不用再动键名。
 */
export const DICT = {
  site: {
    name: { zh: '手机参数世界', en: 'Phone Spec World' },
    tagline: {
      zh: '华为与苹果在售手机参数的可核查对比',
      en: 'A verifiable comparison of Huawei and Apple phones on sale',
    },
    description: {
      zh: '华为与苹果在售手机参数的可核查对比。数据全部来自厂商官网，缺失项标注「官方未公布」，不做估算。',
      en: 'A verifiable comparison of Huawei and Apple phones on sale. All data comes from manufacturer pages; undisclosed items are marked as such, never estimated.',
    },
    /** 页脚三句话：数据来源声明、不做跑分的理由、生成时间 */
    footerSource: {
      zh: '参数全部取自厂商官网规格页与官方对比页，缺失项一律标注「官方未公布」，本站不做任何估算或填充。',
      en: 'Specifications come from manufacturer spec pages and official comparison pages. Undisclosed items are marked as such; nothing is estimated or filled in.',
    },
    footerNoBench: {
      zh: '本站不做跑分评分：手机圈没有可公开核查的第三方成绩源，给不出「综合性能分」，因此只展示官方客观参数。',
      en: 'No benchmark scores here: the phone industry has no publicly verifiable third-party score source, so only official specifications are shown.',
    },
    footerGenerated: { zh: '数据快照', en: 'Snapshot' },
  },

  nav: {
    home: { zh: '今日格局', en: 'Today' },
    categories: { zh: '分类', en: 'Categories' },
    rankings: { zh: '排行榜', en: 'Rankings' },
    brands: { zh: '厂商', en: 'Brands' },
    timeline: { zh: '时间线', en: 'Timeline' },
    all: { zh: '全部机型', en: 'All models' },
    compare: { zh: '对比', en: 'Compare' },
  },

  search: {
    placeholder: { zh: '搜机型、厂商、能力…', en: 'Search models, brands, features…' },
    label: { zh: '搜索', en: 'Search' },
    empty: { zh: '没有匹配的机型', en: 'No matching models' },
    hint: { zh: '模型名、厂商名、能力关键词都能搜', en: 'Model names, brands, or capability keywords' },
    /** {q} 会被替换成用户输入的关键词 */
    noMatch: { zh: '没有匹配「{q}」的机型', en: 'No model matches “{q}”' },
    noMatchHint: { zh: '试试：折叠 / 长续航 / 便宜 / 苹果', en: 'Try: foldable / long battery / budget / Apple' },
  },

  /** 页面里反复出现的几个固定片段 */
  common: {
    unpublished: { zh: '官方未公布', en: 'Not disclosed' },
    insufficientData: { zh: '官方数据不足，本站不排名', en: 'Not enough official data to rank' },
    sourceNote: { zh: '数据来源', en: 'Source' },
    inPool: { zh: '在售池', en: 'On sale' },
    since: { zh: '起', en: 'since' },
    total: { zh: '台', en: 'models' },
    viewAll: { zh: '查看全部', en: 'View all' },
    back: { zh: '返回', en: 'Back' },
    noData: { zh: '暂无数据', en: 'No data' },
    /** 分位说明，全站多处出现，措辞必须一致 */
    percentileMeaning: {
      zh: '分位 = 该机在当前在售池中的位置（100 = 池内最好）',
      en: 'Percentile = this model’s position in the current on-sale pool (100 = best in pool)',
    },
    noBenchTitle: {
      zh: '为什么没有「性能最强」这一栏？',
      en: 'Why is there no “fastest phone” column?',
    },
    noBenchBody: {
      zh: '手机圈没有可公开核查的第三方成绩源（安兔兔需登录、Geekbench 无公开 API、3DMark 收费）。本站不给性能分，只展示官方客观参数 —— 没测过就是没测过，不用估算值填坑。',
      en: 'The phone industry has no publicly verifiable third-party score source (AnTuTu needs login, Geekbench has no public API, 3DMark is paid). No performance score is given here — only official specifications. Untested means untested; gaps are never filled with estimates.',
    },
  },

  /** 六个维度的名字。分位加权，页面上要展示权重表 */
  dims: {
    screen: { zh: '屏幕', en: 'Screen' },
    camera: { zh: '影像', en: 'Camera' },
    battery: { zh: '续航', en: 'Battery' },
    light: { zh: '轻薄', en: 'Lightness' },
    storage: { zh: '存储', en: 'Storage' },
    value: { zh: '性价比', en: 'Value' },
  },

  /** 头条衔。与 derive.mjs 的 TITLES 一一对应 */
  titles: {
    lightest: { zh: '最轻', en: 'Lightest' },
    thinnest: { zh: '最薄', en: 'Thinnest' },
    'biggest-screen': { zh: '屏幕最大', en: 'Largest screen' },
    sharpest: { zh: '最细腻', en: 'Sharpest' },
    brightest: { zh: '屏幕最亮', en: 'Brightest' },
    'longest-battery': { zh: '电池最大', en: 'Largest battery' },
    'fastest-charge': { zh: '充电最快', en: 'Fastest charging' },
    'most-storage': { zh: '存储最大', en: 'Most storage' },
    newest: { zh: '最新发布', en: 'Newest' },
  },

  /** 指标名。与 derive.mjs 的 METRICS.label 一一对应 */
  metrics: {
    weightG: { zh: '重量', en: 'Weight' },
    thicknessMm: { zh: '厚度', en: 'Thickness' },
    screenIn: { zh: '屏幕尺寸', en: 'Screen size' },
    ppi: { zh: '像素密度', en: 'Pixel density' },
    brightnessPeakNits: { zh: '峰值亮度', en: 'Peak brightness' },
    batteryMah: { zh: '电池容量', en: 'Battery capacity' },
    wiredChargeW: { zh: '有线充电', en: 'Wired charging' },
    storageMaxGb: { zh: '最大存储', en: 'Max storage' },
    priceCny: { zh: '起售价', en: 'Starting price' },
    releaseDate: { zh: '发布时间', en: 'Release date' },
    refreshHzMax: { zh: '刷新率上限', en: 'Max refresh rate' },
    rearCount: { zh: '后摄颗数', en: 'Rear cameras' },
    mainMp: { zh: '主摄像素', en: 'Main camera' },
    teleMp: { zh: '长焦像素', en: 'Telephoto' },
    periscope: { zh: '潜望长焦', en: 'Periscope' },
    wirelessChargeW: { zh: '无线充电', en: 'Wireless charging' },
    specPerYuan: { zh: '每千元规格量', en: 'Specs per ¥1,000' },
  },

  /** 形态与价格档 */
  kind: {
    slab: { zh: '直板', en: 'Slab' },
    foldable: { zh: '折叠', en: 'Foldable' },
    flip: { zh: '翻盖', en: 'Flip' },
    mini: { zh: '小屏', en: 'Compact' },
    tablet: { zh: '平板', en: 'Tablet' },
  },

  brand: {
    apple: { zh: '苹果', en: 'Apple' },
    huawei: { zh: '华为', en: 'Huawei' },
    /** 厂商分区标题 */
    domestic: { zh: '国内', en: 'Domestic' },
    foreign: { zh: '国外', en: 'International' },
  },

  /** 来源名。出现在溯源信息里 */
  source: {
    'apple-official': { zh: '苹果官网', en: 'Apple' },
    'huawei-official': { zh: '华为官网', en: 'Huawei' },
    'apple-compare': { zh: '苹果官方对比页', en: 'Apple comparison page' },
    'apple-prices': { zh: '苹果官方价格页', en: 'Apple pricing page' },
    derived: { zh: '由屏幕尺寸与分辨率推导', en: 'Derived from screen size and resolution' },
    manual: { zh: '人工核对', en: 'Manually verified' },
  },
};

/* ------------------------------------------------------------------ *
 * 取值
 * ------------------------------------------------------------------ */

/** @typedef {string | { zh: string, en: string }} DictNode */

function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * 取一条文案。
 *
 * **缺键抛错，不静默回退。** 这是本模块最重要的一条纪律。
 * 静默回退到中文会让英文页面里混进中文，而这种错误：
 * 不抛异常、不影响构建、页面上也不显眼 —— 通常要等读者投诉才发现。
 * 让它构建失败，成本是一个键名；放过它，成本是一份没人校对过的英文站。
 */
export function t(dict, key, lang) {
  const node = getPath(dict, key);
  if (node === undefined) {
    throw new Error(`[i18n] 字典缺键：${key}`);
  }
  if (typeof node === 'string') {
    if (lang === DEFAULT_LANG) return node;
    throw new Error(
      `[i18n] 键 ${key} 只有中文，没有 ${lang}。` +
      '把值改成 { zh:…, en:… }，或在 build 期补齐英文。',
    );
  }
  const v = node[lang];
  if (!v) throw new Error(`[i18n] 键 ${key} 缺少 ${lang} 分支`);
  return v;
}

/**
 * 从数据派生的枚举值里挑一种语言的写法。
 *
 * 用于那些**值本身来自数据层**的文案，比如 analyze.mjs 的 FORM_FACTORS、
 * derive.mjs 的 METRICS.label。它们在各自的模块里是单语言的常量，
 * 这里按「中文值 → 键」的映射表反查，而不是让数据层也改成双语言——
 * 那会让管线层背上它不该背的包袱。
 */
export function pick(entries, lang) {
  const out = {};
  for (const [k, v] of Object.entries(entries)) {
    if (lang === 'zh') out[k] = v.zh ?? v.label ?? v;
    else out[k] = v.en ?? v.zh ?? v.label ?? v;
  }
  return out;
}

/** 列表页每页条数等布局常量，不参与翻译 */
export const LAYOUT = {
  leagueTableLimit: 10,
};

/** 供 shell 用：`<html lang>` 属性值 */
export const htmlLang = (lang) => HTML_LANG[lang] ?? 'zh-CN';

/**
 * 构建期检查：走遍整份字典，报告每个键在每种语言下是否齐备。
 *
 * 与 selftest.mjs 不同，这个是**数据驱动**的：新增键时它会自动发现漏了哪门语言，
 * 不需要有人记得手动改断言。
 */
export function auditDict(dict = DICT, langs = LANGS) {
  const problems = [];

  /**
   * 递归规则（踩过一次坑才写对的）：
   *   叶子 = `{ zh, en }` 对象，或纯字符串。
   *   中间层 = 它的值**全部是对象且不含 zh/en 键**的分组节点（如 `site`、`nav`）。
   *
   * 第一版没区分两者，把 `site` / `nav` 这些分组也当成叶子查「缺 zh 分支」，
   * 于是报出 22 条「：缺 zh 分支」这种毫无意义的错。
   */
  const isLeaf = (node) =>
    typeof node === 'string' ||
    (node && typeof node === 'object' && langs.some((l) => l in node));

  const walk = (node, path) => {
    if (isLeaf(node)) {
      if (typeof node === 'string') {
        // 纯字符串视为「只有中文」
        for (const l of langs) {
          if (l !== DEFAULT_LANG) problems.push(`${path || '(根)'}：只有中文，缺 ${l}`);
        }
        return;
      }
      for (const l of langs) {
        const v = node[l];
        if (!v || !String(v).trim()) {
          problems.push(`${path || '(根)'}：${l} 分支${v === '' ? '为空' : '缺失'}`);
        }
      }
      return;
    }
    // 分组节点：继续下钻
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, `${path ? `${path}.${k}` : k}`);
    }
  };

  walk(dict, '');
  return problems;
}