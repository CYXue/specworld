import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * 跨页面的「已选对比」共享状态。
 *
 * 已选设备 id 写入 URL 的 `sel` 参数（与 facets 的筛选参数 a/b/m/s/v/c/r/y/g/o
 * 不冲突——`c` 已被 chip 维度占用，故对比用 `sel`）。这样对比入口始终可见、
 * 刷新/分享可还原、返回页面保留选择。
 *
 * 用模块级单例 + watch，让底部对比栏与机型库/对比页保持同步，无需逐层 prop 透传。
 */

const PARAM = 'sel';
const MAX = 8; // 对比表可读性上限；超出不再加入并提示

function parse(s: unknown): string[] {
  if (typeof s !== 'string' || !s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const ids = ref<string[]>([]);
let initialized = false;

export function useCompare() {
  const route = useRoute();
  const router = useRouter();

  if (!initialized) {
    initialized = true;
    ids.value = parse(route.query[PARAM]);
  }

  watch(
    () => route.query[PARAM],
    (q) => {
      ids.value = parse(q);
    },
  );

  function persist(next: string[]) {
    ids.value = next;
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(route.query)) {
      if (typeof v === 'string') q[k] = v;
    }
    if (next.length) q[PARAM] = next.join(',');
    else delete q[PARAM];
    router.replace({ path: route.path, query: q }).catch(() => {});
  }

  function has(id: string) {
    return ids.value.includes(id);
  }
  function toggle(id: string) {
    if (has(id)) persist(ids.value.filter((x) => x !== id));
    else if (ids.value.length < MAX) persist([...ids.value, id]);
    else return false; // 超出上限
    return true;
  }
  function remove(id: string) {
    persist(ids.value.filter((x) => x !== id));
  }
  function clear() {
    persist([]);
  }

  return { ids, has, toggle, remove, clear, max: MAX };
}

/**
 * 当前已选 id 的只读快照 —— 给路由守卫（src/router/index.ts）用。
 *
 * 为什么需要它：UI 里的跳转全是裸路径（顶栏入口、底部对比栏、产品卡「详情」
 * 都不带 sel），而下面那个 watcher 拿 URL 当真源 —— 跳转后 URL 一丢 sel，
 * watcher 就当场把已选清空。症状：广场页加入对比后点右上角入口，进去是空的
 * （2026-10-16 用户实测报的真 bug）。守卫在每次跳转前把选择带过去，
 * 这一座桥就是两边的接口。
 */
export function currentSelection(): string[] {
  return [...ids.value];
}
