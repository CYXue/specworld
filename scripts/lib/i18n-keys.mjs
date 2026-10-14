/**
 * i18n 对账闸门（2026-10-13 B2 方案落地）。
 *
 * 为什么需要它：DevEco Code 有 i18next 骨架 + 语言切换对话框，实际覆盖约 16/719（3%）——
 * **机制给了承诺，内容没兑现**。那种半吊子不是「翻译没做完」，是**没有任何闸门知道
 * 翻译没做完**。所以本模块做的是「让漏翻这件事必须发出声音」。
 *
 * 四条红灯，缺一不可：
 *   1. **两包键集必须完全一致**（差集双向 —— 只查一边等于只防一半）；
 *   2. **键被引用 → 两包都必须有值**（防「切过去一片空白」）；
 *   3. **键在包里 → 必须被引用**（防「译了一堆没人用」的僵尸键，也防拼错键名）；
 *   4. **数据侧双语对账**：schema / 视图字典 / 策展字典 / 品类注册表的 `labelEn`
 *      必须齐全（页面取的是数据里的标签，缺一列就是英文页里混进中文）。
 *
 * ⚠️ **键必须写成字面量**（`t('a.b')`，不能 `t('a.' + k)`）：本模块扫的是源码里的
 * 字符串字面量，拼出来的键它看不见 —— 拼错键名就只能在运行时炸。这是有意的取舍：
 * 宁可要求代码多写几行，也不给「看不见的键」留后门。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const LOCALES_DIR = 'src/locales';
export const SRC_DIR = 'src';
export const SCRIPTS_DIR = 'scripts';

/** 扁平化：`{a:{b:'x'}}` → `Map { 'a.b' => 'x' }` */
export function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

export function loadLocalePack(root, file) {
  return flatten(JSON.parse(readFileSync(join(root, LOCALES_DIR, file), 'utf8')));
}

function walk(dir, out = []) {
  // 目录不存在就当空（selftest 的反向测试在 tmpdir 里造局部夹具，没有 scripts/）
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    const st = statSync(p);
    // .mjs 是管线侧扩展名：sync/index.mjs 会把键名写进数据，必须一起扫
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|vue|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * 剥注释。**这一步不能省，也不是可选的洁癖**（本项目 2026-10-04 的老坑：
 * 闸门把「配置文件里那行说明注释」当成真实配置命中，于是真改坏了也检不出来）。
 * 注释里天然会出现 `product.display.sizeIn`、`about.principle*` 这类**长得像键**的
 * 字符串，不剥掉就是恒真的假命中 + 真漏报被淹没。
 *
 * 启发式的边界（都说了，免得以后被「优化」掉）：
 * - `//` 前面是 `:` 的不剥（那是 `https://`，剥了会把 URL 拦腰截断）；
 * - 只剥注释，**不动字符串内容**（字符串里出现 `//` 不影响键提取）。
 */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:])\/\/[^\n]*/g, '$1');
}

/**
 * 收集源码里被**引用**的键。
 *
 * 判定方式：取语言包的顶层命名空间（meta/brand/nav/…），扫源码里形如
 * `'nav.home'` 的**引号包裹的字面量**。这样能同时覆盖三种写法：
 *   - 组件模板 `{{ t('nav.home') }}` / `$t('nav.home')`
 *   - lib 里的键表 `{ id: 'release', labelKey: 'sort.release' }`（键不在 t() 括号里，
 *     只按 `t('…')` 扫会整片漏掉 —— 这是最容易失守的一类）
 *   - 常量映射 `FORM_LABEL_KEY = { foldable: 'facet.formValue.foldable' }`
 *
 * ⚠️ 只认**单/双引号**，不认反引号：模板串里大量出现 `` `/product/${product.id}` ``
 * 这种路径，把反引号当引号会把路由路径误判成键。
 */
/**
 * 扩大扫描范围到 scripts/ 之后冒出来的两类噪声，逐条写明为什么不算引用：
 * - `scripts/selftest.mjs` 自己：它断言的是**数据字段路径**（`product.id`），
 *   不是界面键；把它算进来会让「注释里的假键」那条反向用例直接失去意义。
 * - `scripts/sources/**`：取数适配器只碰官网 HTML 与文件名（`compare.html`），
 *   不产出任何面向用户的文案。
 * 排除的是「确定不写键的地方」，不是「看着不顺眼的地方」—— 剩下 scripts/ 里的
 * .mjs 全在扫描范围内，管线写了不存在的键照样报红。
 */
function isScriptNoise(f) {
  const p = f.replace(/\\/g, '/');
  return p.endsWith('scripts/selftest.mjs') || p.includes('scripts/sources/');
}

export function collectUsedKeys(root, namespaces) {
  // ⚠️ 扫描范围含 `scripts/`：管线会把**键名写进数据**（如 sync/index.mjs 给
  // snapshot.sources 写 `noteKey: 'about.sourceAppleOfficial'`），前端再按语言渲染。
  // 只扫 src/ 的话这类键会被当成「僵尸键」误报 —— 而反向的风险同样真实：
  // 管线写了个语言包里不存在的键，运行时缺键抛错，闸门必须能提前看见。
  const files = [
    ...walk(join(root, SRC_DIR)).filter((f) => !f.includes(`${SRC_DIR}/locales/`)),
    ...walk(join(root, SCRIPTS_DIR)).filter((f) => !isScriptNoise(f)),
  ];
  const ns = namespaces.join('|');
  // ⚠️ 开引号前不能是 `=` / `.` / 标识符字符：Vue 模板里 `:id="product.id"`、
  // `:value="filter.q"` 这些**属性值**同样被引号包着，不加这条限制会把它们误判成键
  // （误报一样是闸门失效 —— 噪音会让人开始忽略闸门）。
  // 段数用 `+`（**至少要有一个点**）：只写顶层名（`home` / `brand` / `sort` 这类
  // 单词）在源码里大量是路由名、图标名、变量名，一旦允许无点匹配就是十几个假警
  // —— 假警和漏报一样是闸门失效。本项目的键全部是 `<命名空间>.<名>` 两段起，
  // 这个约束不损失覆盖；真出现顶层标量键时，闸门会以「僵尸键」的形式提醒你改结构。
  const re = new RegExp(`(?<![=.\\w$'"])['"]((?:${ns})(?:\\.[A-Za-z][A-Za-z0-9]*)+)['"]`, 'g');
  const used = new Map(); // key → 出现处（报错要给得出位置）
  for (const f of files) {
    const text = stripComments(readFileSync(f, 'utf8'));
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!used.has(m[1])) used.set(m[1], relative(root, f));
    }
  }
  return used;
}

/** 顶层命名空间（用于构造扫描正则；新增顶层分组自动纳入）。
 *  ⚠️ `flatten` 只留叶子键（`meta.title`），所以顶层名要从叶子键的首段取。 */
export function namespacesOf(pack) {
  return [...new Set([...pack.keys()].map((k) => k.split('.')[0]))].sort();
}

/**
 * 主检查。返回问题数组（空 = 通过）。
 * `extra` 允许调用方追加自定义断言（selftest 用它挂数据侧对账）。
 */
export function checkI18n(root, { extra = [] } = {}) {
  const zh = loadLocalePack(root, 'zh.json');
  const en = loadLocalePack(root, 'en.json');
  const problems = [];

  // 1. 两包键集一致（双向）
  for (const k of zh.keys()) if (!en.has(k)) problems.push(`en.json 缺少键 ${k}`);
  for (const k of en.keys()) if (!zh.has(k)) problems.push(`zh.json 缺少键 ${k}`);

  // 2/3. 引用 ↔ 定义 双向
  const used = collectUsedKeys(root, namespacesOf(zh));
  for (const [k, where] of used) {
    if (!zh.has(k)) problems.push(`引用了不存在的键 ${k}（${where}）`);
  }
  for (const k of zh.keys()) {
    if (!used.has(k)) problems.push(`语言包有键 ${k} 但源码无人引用（僵尸键 / 拼错）`);
  }

  // 4. 插值参数一致：同一个键在两包里的 {占位符} 必须同名同数
  const params = (s) => (String(s).match(/\{(\w+)\}/g) ?? []).sort().join(',');
  for (const [k, v] of zh) {
    if (!en.has(k)) continue;
    if (params(v) !== params(en.get(k))) {
      problems.push(`键 ${k} 的中英插值参数不一致：${params(v)} vs ${params(en.get(k))}`);
    }
  }

  for (const fn of extra) {
    try {
      fn({ problems, root, zh, en });
    } catch (e) {
      problems.push(`自定义 i18n 断言抛错：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return problems;
}

// ── 数据侧双语对账 ──

/** 检查「有 label 就必须有 labelEn」的通用器 */
export function assertBilingual(problems, where, rows, label = 'label') {
  for (const [i, r] of rows.entries()) {
    if (r[label] == null) continue;
    if (!r[`${label}En`]) problems.push(`${where}[${i}]（${r[label]}）缺少 ${label}En`);
  }
}

/** 数据侧双语：schema / 视图字典 / 策展字典 / 品类注册表 */
export function checkDataBilingual(root) {
  const problems = [];
  const rd = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

  const schema = rd('data/schemas/phone.json');
  assertBilingual(problems, 'data/schemas/phone.json fields', schema.fields);
  for (const f of schema.fields) {
    if (f.subfields) assertBilingual(problems, `schema ${f.path} subfields`, f.subfields);
    if (f.unit && !f.unitEn && /[^\x00-\x7F]/.test(f.unit)) {
      problems.push(`schema ${f.path} 的单位「${f.unit}」是中文但缺 unitEn`);
    }
  }

  const view = rd('data/view-phone.json');
  for (const g of view.groups) {
    if (!g.titleEn) problems.push(`view-phone.json 组 ${g.id}（${g.title}）缺 titleEn`);
    assertBilingual(
      problems,
      `view-phone.json 组 ${g.id} rows`,
      g.rows.filter((r) => r.label),
    );
  }

  const curated = rd('data/curated/facets.json');
  assertBilingual(problems, 'curated variants', curated.variants);
  for (const [id, b] of Object.entries(curated.series.brands ?? {})) {
    assertBilingual(problems, `curated series ${id}`, b.series);
    if (b.foldVariant && !b.foldVariant.labelEn)
      problems.push(`curated series ${id}.foldVariant 缺 labelEn`);
  }
  assertBilingual(problems, 'curated priceBuckets', curated.priceBuckets);

  for (const c of rd('data/categories.json').categories) {
    if (!c.labelEn) problems.push(`data/categories.json 品类 ${c.id} 缺 labelEn`);
  }
  return problems;
}
