import { createI18n } from 'vue-i18n';
// 带 import attributes：selftest 在裸 node 下 import 本模块（对账断言要过 lib），
// node ESM 的 JSON 导入必须显式声明类型；Vite 侧同样支持。
import en from '../locales/en.json' with { type: 'json' };
import zh from '../locales/zh.json' with { type: 'json' };

/**
 * i18n 装配（2026-10-13 B2 方案：全量抽取 + 中英双语 + 覆盖闸门）。
 *
 * 三条硬纪律，全部来自 DevEco Code 的反面教材——它有 i18next 骨架 +
 * 语言切换对话框，实际覆盖约 16/719（3%），用户切到中文「几乎没变化」：
 * **机制给了承诺，内容没兑现，比不提供切换更伤**。
 *
 * 1. **缺键 = 抛错，绝不静默回退**：不设 fallbackLocale——回退到另一种语言
 *    就是 DevEco 式背叛（中文用户看到英文，还以为是「设置了没生效」）。
 *    对账闸门（selftest / conventions:check 的 i18n 节）保证它永远不该触发；
 *    真触发了就大声死，而不是 silent fallback 糊弄用户。
 * 2. **语言偏好走 localStorage**：hash 路由下 location.search 永远是空串
 *    （项目纪律），偏好不是视图状态，不进 URL。
 * 3. **`<html lang>` 与 `<title>`/meta description 跟随语言**（a11y）：
 *    见 App.vue 的 watcher。
 *
 * 消息文本全部是开发期常量、无用户输入流入，故关掉 warnHtmlMessage
 * （「填充率 < 60%」这类含 `<` 的文案会误触它的 HTML 警告）。
 */
export type Locale = 'zh-CN' | 'en';
export const LOCALE_STORAGE_KEY = 'specworld:locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {
    /* 隐私模式等读不到 localStorage：用默认语言，不炸 */
  }
  return 'zh-CN';
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale(),
  warnHtmlMessage: false,
  missing: (_locale, key) => {
    throw new Error(
      `[i18n] 缺少翻译键：${key}（对账闸门应已拦截，这是运行时兜底——请补 locales 或修闸门，别静默）`,
    );
  },
  messages: { 'zh-CN': zh, en },
});

/** 切语言：写 i18n + 持久化。切换器与任何编程式切换都走这里 */
export function setLocale(next: Locale): void {
  i18n.global.locale.value = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* 写不进去不影响当次会话 */
  }
}

/**
 * 当前语言 —— **lib 层唯一的语言入口**（2026-10-13 定）。
 *
 * 为什么不让 lib 函数各自接一个 `locale` 参数：那条路会把「当前语言」变成
 * **第二真源**。lib 里同时有 `t()`（读全局）和 `locale` 参数（读调用方）两种来源，
 * 两者不一致时会产出中英混排——而且只在「调用方忘了传/传错」这种静默路径上出现，
 * 没有任何闸门能报（典型 A 层缺陷）。所以统一：lib 一律读全局，调用方零负担。
 *
 * 响应式也不是问题：`locale` 是 ref，在 `computed()` 里读过就会被追踪，
 * 切语言时依赖它的派生值自动重算。
 */
export function currentLocale(): string {
  return i18n.global.locale.value;
}

/** 语言感知的「取英文还是中文」：数据侧 label/labelEn 双字段的解析器 */
export function pickLocale(
  zh: string,
  en: string | null | undefined,
  locale = currentLocale(),
): string {
  return locale === 'en' ? (en ?? zh) : zh;
}
