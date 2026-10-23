/**
 * 苹果 RF 暴露页 SAR 解析（纯函数，无 IO、无网络）。
 *
 * 定位
 * ----
 * regulatoryinfo.apple.com/rfexposure/<identifier>/<lang> 是 Angular 客户端渲染页
 * （直连 HTML 无值，reginfoapi.apple.com 有 412 前置校验），取值走无头浏览器渲染
 * （scripts/ingest/apple-sar.mjs），本文件只负责把**渲染后的文本**解析成结构化行。
 *
 * 口径纪律
 * --------
 * 苹果同页给两套口径：1.6 W/kg (over 1 g)（美标）与 2.0 W/kg (over 10 g)（欧盟/中国进网）。
 * 本项目存储口径**钉死为 over 10g**（phone schema 的 note 有记载）——解析只取 2.0 段，
 * 1g 段的数字绝不混入。页面无 2.0 段 = 官网没公布 = 返回空数组（unknown），不许编。
 *
 * 页面形态（渲染文本，多 Model 段并列）：
 *   ### Model A2849
 *   1.6 W/kg (over 1 g) SAR Limit
 *   Head : 1.07
 *   Body : 1.11
 *   2.0 W/kg (over 10 g) SAR Limit
 *   Head : 0.98
 *   Body : 0.98
 */

/** 从渲染文本解析 SAR 行：[{ model, head10g, body10g }] */
export function parseSarText(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const rows = [];
  // 以 "Model" 段切分；同一段内找 2.0 (over 10 g) 小节里的 Head/Body
  let current = null; // { model, section10g }
  let in10g = false;
  for (const line of lines) {
    // Model 段标题：渲染文本里是纯 "Model A2221"（innerText），markdown 渲染可能是 "### Model A2221"，
    // 两种形态都接受——# 号个数是展示层的产物，不是数据的一部分
    const modelMatch = line.match(/^#{0,6}\s*Model\s+(.+)$/i);
    if (modelMatch) {
      if (current && current.head10g !== undefined) rows.push(current);
      current = { model: modelMatch[1].trim() };
      in10g = false;
      continue;
    }
    if (current === null) continue;
    // 只认 2.0/10g 小节开始；1.6/1g 小节显式退出（防止旧页只有 1g 时误取）
    if (/2\.0\s*W\/kg\s*\(over\s*10\s*g\)/i.test(line)) {
      in10g = true;
      continue;
    }
    if (/1\.6\s*W\/kg\s*\(over\s*1\s*g\)/i.test(line)) {
      in10g = false;
      continue;
    }
    if (!in10g) continue;
    const head = line.match(/^Head\s*[:：]\s*([0-9.]+)\s*$/i);
    if (head) {
      current.head10g = Number(head[1]);
      continue;
    }
    const body = line.match(/^Body\s*[:：]\s*([0-9.]+)\s*$/i);
    if (body) {
      current.body10g = Number(body[1]);
      continue;
    }
  }
  if (current && current.head10g !== undefined) rows.push(current);
  // 只收完整行（Head+Body 都有）；缺 Body 的口径残缺行丢弃——半行数据比没有更危险
  return rows.filter((r) => typeof r.head10g === 'number' && typeof r.body10g === 'number');
}
