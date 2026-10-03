/**
 * 通道 A：华为规格页 → ProductRecord。
 * 纯函数，依赖来自 ../shared.mjs 与 ../parse.mjs（经 shared 再导出）。
 */
import {
  emptyRecord, put, putObject, hwLookup, firstOf, hwBattery, hwCharging, hwMemory,
  parseRearLenses, parseFront, parseVideoMax, parseAperture, parseOis, parseLens,
  multiPartValue, refreshText, derivePpi, pickFirstRes, normalizeType, tidy, realValue,
  addNote, pushOfficial, HW_REAR_KEYS, HW_FRONT_KEYS, HW_SERIES_LINE,
  parseCapacity, parseInch, parseMm, parsePpi, parseResolution, parseStorageList, parseWeight, parseWatt,
  sliceByVariants, stripInvisible, firstNum, nums, HW, wattOf,
} from '../shared.mjs';
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
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
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


export { mapHuawei };
