// macDB 参数折叠：按 match-table.json 把结构化参数折进 data/overrides.json。
// 只填空缺字段；默认预演，--apply 才写盘。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = HERE.replace(/scripts\/macdb-sync\/$/, '');
const WORK = ROOT + '_work/';

// ---- 品类 schema 注册表 ----
const reg = {};
for (const f of readdirSync(ROOT + 'data/schemas')) {
  if (!f.endsWith('.json')) continue;
  const cat = f.replace('.json', '');
  const s = JSON.parse(readFileSync(ROOT + 'data/schemas/' + f, 'utf8'));
  reg[cat] = new Map(s.fields.map(x => [x.path, { type: x.type, range: x.range }]));
}

const ours = JSON.parse(readFileSync(ROOT + 'data/products.json', 'utf8'));
const prods = new Map((ours.products || ours).map(p => [p.id, p]));
const matchTable = JSON.parse(readFileSync(HERE + 'match-table.json', 'utf8'))
  .filter(m => m.productId && m.cat && reg[m.cat]);

const num = s => { const m = String(s).match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const MM = v => { const n = num(v); return n === null ? null : /cm/i.test(v) ? n * 10 : n; };

function pageTokens(slug) {
  const f = WORK + `macdb-all/${slug}.html`;
  if (!existsSync(f)) return null;
  let h = readFileSync(f, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '|').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\|+/g, '|');
  const s0 = h.indexOf('|关键规格|'), s = h.indexOf('|详细参数|'), e = h.indexOf('与上一代对比', s);
  if (s < 0) return null;
  let body = '';
  if (s0 >= 0 && s0 < s) body += h.slice(s0 + 6, s) + '|';
  body += h.slice(s + 6, e > 0 ? e : undefined);
  return body.split('|').map(t => t.trim()).filter(Boolean);
}

// label → [field, parser]（按品类注册表过滤后生效）
const COMMON = {
  '芯片工艺': [['chipset.processNm', v => { const m = v.match(/(\d+(?:\.\d+)?)\s*(?:nm|纳米)/i); return m ? +m[1] : null; }]],
  '制程': [['chipset.processNm', v => { const m = v.match(/(\d+(?:\.\d+)?)\s*(?:nm|纳米)/i); return m ? +m[1] : null; }]],
  '芯片配置': [['chipset.config', v => v]],
  '性能核心': [['chipset.cpuClocks', v => /GHz/i.test(v) ? v : null]],
  '性能核心数': [['chipset.cpuCores', v => num(v)]],
  '处理器架构': [['chipset.arch', v => v]],
  '处理器': [['chipset.name', v => v]],
  'CPU': [['chipset.name', v => v]],
  '处理器速率': [['chipset.cpuClocks', v => v]],
  'GPU': [['chipset.gpu', v => v]],
  '显卡': [['chipset.gpu', v => v]],
  '图形内存': [['chipset.gpuMemory', v => v]],
  'NPU': [['chipset.npu', v => v]],
  '神经网络引擎': [['chipset.npu', v => v]],
  '内存': [
    ['memory.ramGb', v => { const m = v.match(/(\d+(?:\.\d+)?)\s*GB/i); return m ? [+m[1]] : null; }],
    ['memory.ramType', v => { const m = v.match(/(LPDDR\w*|DDR\w*|GDDR\w*)/i); return m ? m[1] : null; }],
  ],
  '存储容量': [['memory.storageGb', v => {
    const arr = [...v.matchAll(/(\d+(?:\.\d+)?)\s*(TB|G|GB)/gi)].map(m => m[2].toUpperCase() === 'TB' ? +m[1] * 1024 : +m[1]);
    return arr.length ? arr : null;
  }]],
  '存储类型': [['memory.storageType', v => v]],
  '硬盘接口': [['memory.storageInterface', v => v]],
  '扩展插槽': [['memory.expansionSlots', v => v]],
  '光驱': [['memory.opticalDrive', v => v]],
  '屏幕尺寸': [['display.sizeIn', v => { const n = num(v); return n && n < 40 ? n : null; }]],
  '屏幕类型': [['display.type', v => v]],
  '分辨率': [['display.resolutionPx', v => { const m = v.match(/(\d{3,5})\s*[×x*]\s*(\d{3,5})/); return m ? { w: +m[1], h: +m[2] } : null; }]],
  'PPI': [['display.ppi', v => num(v)]],
  '刷新率': [['display.refreshHz', v => { const n = num(v); return n ? String(n) : null; }]],
  '典型亮度': [['display.brightnessTypicalNits', v => num(v)]],
  '峰值亮度': [['display.brightnessPeakNits', v => num(v)]],
  'HDR 亮度': [['display.brightnessHdrNits', v => num(v)]],
  '亮度': [['display.brightnessNits', v => num(v)]],
  '无线局域网续航': [['battery.vendorClaimedWebHours', v => num(v)]],
  '蜂窝网络续航': [['battery.vendorClaimedCellularHours', v => num(v)]],
  '传感器': [['features.sensors', v => v.split(/\s*[/、，,]\s*/).filter(Boolean)]],
  '电池容量': [
    ['battery.capacityMah', v => { const m = v.match(/(\d{3,6})\s*mAh/i); return m ? +m[1] : null; }],
    ['battery.capacityWh', v => { const m = v.match(/(\d+(?:\.\d+)?)\s*Wh/i); return m ? +m[1] : null; }],
  ],
  '充电方式': [['battery.chargingMethods', v => v.split(/\s*[/、，,]\s*/).filter(Boolean)]],
  '充电功率': [['battery.wiredChargeW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }]],
  '有线充电': [['battery.wiredChargeW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }]],
  '无线充电': [['battery.wirelessChargeW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }]],
  '视频续航': [['battery.vendorClaimedVideoHours', v => num(v)]],
  '流媒体续航': [['battery.vendorClaimedStreamingHours', v => num(v)]],
  '音频续航': [['battery.vendorClaimedAudioHours', v => num(v)]],
  '电池续航': [['battery.vendorClaimedHours', v => num(v)]],
  '续航时长': [['battery.vendorClaimedHours', v => num(v)]],
  '续航': [['battery.vendorClaimedHours', v => num(v)]],
  '单次充电续航': [['battery.budHours', v => num(v)]],
  '耳机续航': [['battery.budHours', v => num(v)]],
  '搭配充电盒续航': [['battery.withCaseHours', v => num(v)]],
  '使用充电盒续航': [['battery.withCaseHours', v => num(v)]],
  '备份电池': [['battery.backup', v => v]],
  '无线网络': [['connectivity.wifi', v => v]],
  '蓝牙': [['connectivity.bluetooth', v => v]],
  '基带': [['connectivity.baseband', v => v]],
  '有线接口': [['connectivity.usb', v => v]],
  '端口': [['connectivity.ports', v => v]],
  '机身端口': [['connectivity.ports', v => v.split(/\s*\/\s*/).filter(Boolean)], ['connectivity.type', v => v]],
  '接口类型': [['connectivity.type', v => v], ['connectivity.ports', v => v]],
  '接口': [['connectivity.ports', v => v.split(/\s*\/\s*/).filter(Boolean)]],
  '连接方式': [['connectivity.type', v => v]],
  '机身材料': [['body.material', v => v]],
  '防水等级': [['body.ipRating', v => /IP\d/i.test(v) ? v.match(/IP\d+/i)[0].toUpperCase() : null]],
  '解锁方式': [['security.unlock', v => v]],
  '安全芯片': [['security.chip', v => v]],
  '高度': [['body.heightMm', v => MM(v)]],
  '宽度': [['body.widthMm', v => MM(v)]],
  '厚度': [['body.thicknessMm', v => MM(v)]],
  '深度': [['body.depthMm', v => MM(v)]],
  '重量': [
    ['body.weightG', v => { const n = num(v); if (n === null) return null; return /kg|千克/i.test(v) ? n * 1000 : n; }],
    ['body.weightKg', v => { const n = num(v); return /kg|千克/i.test(v) && n ? n : null; }],
  ],
  '外观颜色': [['body.colors', v => v.split(/\s*[/、，,]\s*/).filter(c => c && !/^(可选颜色|无)$/.test(c.trim())).slice(0, 8)]],
  '机型标识符': [['device.identifier', v => /^[A-Za-z]+\d+,\d+$/.test(v.trim()) ? v.trim() : null]],
  '型号标识': [['device.identifier', v => /^[A-Za-z]+\d+,\d+$/.test(v.trim()) ? v.trim() : null]],
  '模具型号': [['device.modelVariants', v => v.includes(',') ? v.split(/\s*\/\s*/) : null]],
  '型号': [['device.modelCodes', v => v.split(/\s*\/\s*/).filter(s => /^A\d{4}/.test(s.trim()))]],
  '支持系统': [['os.launch', v => v.split(/~|～/)[0].trim()]],
  '操作系统': [['os.launch', v => v]],
  '摄像头': [['camera.front', v => /^(摄像头参数|后置摄像头|前置摄像头|摄像头)$/.test(v.trim()) ? null : v]],
  '主摄': [['camera.rearMain', v => v]],
  '摄像头参数': [['camera.rearMain', v => v]],
  '扬声器': [['audio.speakers', v => v]],
  '音频系统': [['audio.system', v => v]],
  '键数': [['input.buttons', v => num(v)]],
  '输入方式': [['features.input', v => v.split(/\s*[/、，,]\s*/).filter(Boolean)]],
  '电池': [['features.batteryType', v => v]],
  '电池类型': [['features.batteryType', v => v]],
  '输出功率': [['power.outputW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }]],
  '输出规格': [['power.outputSpec', v => v]],
  'PDO': [['power.outputSpec', v => v]],
  '快充协议': [['power.protocol', v => v]],
  '供电协议': [['power.protocol', v => v]],
  '功率': [['power.outputW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }]],
  '电源': [
    ['power.adapterW', v => { const m = v.match(/(\d+)\s*W/i); return m ? +m[1] : null; }],
    ['power.source', v => v],
    ['power.outputSpec', v => v],
    ['connectivity.hostCharging', v => /供电/.test(v) ? v : null],
  ],
  '供电方式': [['power.type', v => v]],
  '供电': [['power.type', v => v]],
};

function parsePage(slug, cat) {
  const toks = pageTokens(slug);
  if (!toks) return null;
  const out = {};
  for (let i = 0; i < toks.length; i++) {
    const pairs = COMMON[toks[i]];
    if (!pairs) continue;
    const raw = toks[i + 1];
    if (!raw || COMMON[raw]) continue;
    for (const [field, parser] of pairs) {
      if (!reg[cat].has(field)) continue;
      let v = null;
      try { v = parser(raw); } catch { v = null; }
      if (v === null || v === undefined || v === '') continue;
      const f = reg[cat].get(field);
      if (f && f.type === 'number' && typeof v === 'number' && Array.isArray(f.range)) {
        const [lo, hi] = f.range;
        if (v < lo || v > hi) { const fx = v * 10; if (fx >= lo && fx <= hi) v = fx; else continue; }
      }
      out[field] = v;
    }
  }
  return out;
}

const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const overrides = JSON.parse(readFileSync(ROOT + 'data/overrides.json', 'utf8'));
const addedById = new Map();
for (const e of overrides.entries) {
  if (e.op === 'add-product' && e.product?.id) addedById.set(e.product.id, e);
}
const keptIds = new Set([...prods.keys()].filter(id => !addedById.has(id)));
// set-field id 续编基线：取现有 ovr-macdb-fill-* 的最大序号，避免重复 id
let fillSeq = 0;
for (const e of overrides.entries) {
  const mm = /ovr-macdb-fill-(\d+)/.exec(e.id || '');
  if (mm) fillSeq = Math.max(fillSeq, +mm[1]);
}
const nextId = () => `ovr-macdb-fill-${String(++fillSeq).padStart(4, '0')}`;

const setFields = [];
const log = { pageFail: 0, folded: 0, dupFold: 0, setField: 0, skippedHasValue: 0 };
for (const m of matchTable) {
  const p = prods.get(m.productId);
  if (!p) continue;
  const mac = parsePage(m.slug, m.cat);
  if (!mac) { log.pageFail++; continue; }
  const cat = m.cat;
  for (const [field, v] of Object.entries(mac)) {
    if (addedById.has(m.productId)) {
      const ap = addedById.get(m.productId);
      const s = ap.product.specs = ap.product.specs || {};
      if (!isEmpty(s[field])) { log.dupFold++; continue; }
      s[field] = v;
      ap.product.provenance = ap.product.provenance || {};
      ap.product.provenance[field] = 'macdb-cn';
      if (field === 'display.resolutionPx') ap.product.provenance['display.resolutionPx.w'] = 'macdb-cn';
      if (/^battery\.capacity(Mah|Wh)$/.test(field) && reg[cat].has('battery.capacityCaliber') && !s['battery.capacityCaliber']) {
        s['battery.capacityCaliber'] = 'rated';
        ap.product.provenance['battery.capacityCaliber'] = 'macdb-cn';
      }
      log.folded++;
    } else if (keptIds.has(m.productId)) {
      const cur = p.specs || {};
      const prov = p.provenance || {};
      if (!isEmpty(cur[field]) || prov[field]) { log.skippedHasValue++; continue; }
      setFields.push({
        id: nextId(),
        op: 'set-field', productId: m.productId, field, value: v,
        reason: `macDB 参数密度补全（来源 macdb.cn 机型页 ${m.slug}，仅填空缺字段）`,
        source: 'macdb-cn',
        createdAt: new Date().toISOString().slice(0, 10), active: true,
      });
      log.setField++;
    }
  }
}

// 串号防线：identifier 同 brand+line 内唯一，owner = 最早发布
{
  const IDENT = 'device.identifier';
  const groups = new Map();
  for (const e of overrides.entries) {
    if (e.op !== 'add-product') continue;
    const v = e.product?.specs?.[IDENT];
    if (typeof v !== 'string' || !v) continue;
    const key = e.product.brand + '||' + e.product.line + '||' + v;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
  }
  let removed = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.product.releaseDate || '9999').localeCompare(b.product.releaseDate || '9999')
      || a.product.id.localeCompare(b.product.id));
    for (const e of arr.slice(1)) {
      delete e.product.specs[IDENT];
      if (e.product.provenance) delete e.product.provenance[IDENT];
      removed++;
    }
  }
  log.serialDedup = removed;
}

// modelCode 串号防线：同 brand+line 内每个型号代码只能归属一台（owner = 最早发布）
{
  const FIELD = 'device.modelCodes';
  const groups = new Map();
  for (const e of overrides.entries) {
    if (e.op !== 'add-product') continue;
    const codes = e.product?.specs?.[FIELD];
    if (!Array.isArray(codes)) continue;
    for (const c of codes) {
      const key = e.product.brand + '||' + e.product.line + '||' + c;
      (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
    }
  }
  let removed = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.product.releaseDate || '9999').localeCompare(b.product.releaseDate || '9999')
      || a.product.id.localeCompare(b.product.id));
    for (const e of arr.slice(1)) {
      const s = e.product.specs;
      if (!Array.isArray(s[FIELD])) continue;
      s[FIELD] = s[FIELD].filter(c => !arr[0].product.specs[FIELD]?.includes(c));
      if (!s[FIELD].length) { delete s[FIELD]; if (e.product.provenance) delete e.product.provenance[FIELD]; }
      removed++;
    }
  }
  log.modelCodeDedup = removed;
}

console.log('匹配:', matchTable.length, JSON.stringify(log));
if (APPLY) {
  if (setFields.length) overrides.entries.push(...setFields);
  writeFileSync(ROOT + 'data/overrides.json', JSON.stringify(overrides, null, 2) + '\n');
  console.log('已写盘。请跑：npm run selftest && node scripts/pipeline.mjs --data-only');
} else {
  console.log('（预演模式，未写盘。--apply 生效）');
  writeFileSync(WORK + 'macdb-fill-preview.json', JSON.stringify(setFields, null, 1));
}
