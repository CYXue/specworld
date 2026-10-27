/**
 * 商城 listing 名 → 型号名清洗。
 *
 * 全站粒度口径＝每型号一条（AGENTS.md）：mi.com 商城 listing 名尾部的配置档位
 * （「8GB+256GB」「16GB+1TB」）及其后的配色词不属于产品名——配置/配色已在
 * memory.ramGb / memory.storageGb / body.colors 数组合并，进产品名是双真源。
 *
 * 只剥「配置 token 及其后的配色词」；纯配色后缀（「小米手环11 银色」）与
 * 版本词（「标准版」「46mm」）是型号区分信息，保留不动。
 */
const CONFIG_SUFFIX_RE = /\s+\d+(?:GB|TB)\+\d+(?:GB|TB)(?:\s+\S+)?$/;

export function cleanListingName(raw) {
  if (typeof raw !== 'string') return raw;
  return raw.replace(CONFIG_SUFFIX_RE, '').trim();
}
