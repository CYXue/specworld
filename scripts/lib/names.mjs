/**
 * 商城 listing 名 → 型号名清洗。
 *
 * 全站粒度口径＝每型号一条（AGENTS.md）：mi.com 商城 listing 名尾部的
 * ① 配置档位（「8GB+256GB」「16GB+1TB」）及其后的配色词、
 * ② 尾部纯配色词（「锖色」「冰晶白」）
 * 都不属于产品名——配置/配色已在 memory.ramGb / memory.storageGb /
 * body.colors 数组合并，进产品名是双真源。
 *
 * 保留：纯版本词（「标准版」「焕新版」）、尺寸词（「46mm」「65英寸」）、
 * 复合 token（「黑色氟胶表带款」是表带材质变体、「白色（1主3子）套装」
 * 是组合构成）——它们是型号区分信息，不是配置/配色。
 * 配色词表来自全站 listing 名尾部 token 实测扫描（2026-10-27）。
 */
const CONFIG_SUFFIX_RE = /\s+\d+(?:GB|TB)\+\d+(?:GB|TB)(?:\s+\S+)?$/;

const COLORS = [
  '黑色', '白色', '灰色', '银色', '杏色', '锖色',
  '云灰', '雅灰', '哑黑', '暮黑', '脂白',
  '冰晶白', '冰釉白', '燕麦白', '晴雪白', '皎月银',
  '钛光金', '缎光金', '爵士蓝', '海盐蓝', '天际蓝',
  '流沙橙', '元气绿', '月影黑', '迷雾黑', '子夜黑',
  '星辰黑', '曜石黑', '暗影黑', '暖金白',
];

// 尾部配色：边界为空格/连字符/斜杠，或直接粘连在字母数字（kg/容量）之后，且到串尾
const COLOR_TAIL_RE = new RegExp(`(?:[\\s\\-－/](?:${COLORS.join('|')})|(?<=[A-Za-z0-9])(?:${COLORS.join('|')}))$`);

export function cleanListingName(raw) {
  if (typeof raw !== 'string') return raw;
  let s = raw.replace(CONFIG_SUFFIX_RE, '').trimEnd();
  s = s.replace(COLOR_TAIL_RE, '').trimEnd();
  return s; // 极端情况整名被剥空则还原，宁脏勿空
}
