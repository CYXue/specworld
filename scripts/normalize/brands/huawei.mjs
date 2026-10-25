/**
 * 通道 A：华为规格页 → ProductRecord。
 * 纯函数，依赖来自 ../shared.mjs 与 ../parse.mjs（经 shared 再导出）。
 */
import { parseBrightness } from '../parse.mjs';
import {
  emptyRecord,
  put,
  putObject,
  hwLookup,
  firstOf,
  hwBattery,
  hwCharging,
  hwMemory,
  parseRearLenses,
  parseFront,
  parseVideoMax,
  parseCellularBands,
  parseWlanBands,
  parseIrBlaster,
  multiPartValue,
  refreshText,
  derivePpi,
  normalizeType,
  tidy,
  realValue,
  addNote,
  pushOfficial,
  HW_REAR_KEYS,
  HW_FRONT_KEYS,
  HW_SERIES_LINE,
  parseCapacity,
  parseInch,
  parseMm,
  parsePpi,
  parseResolution,
  parseStorageList,
  parseWeight,
  stripInvisible,
  firstNum,
  HW,
  wattOf,
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
    addNote(
      rec,
      `厚度原文为多态标注「${foldedThickness.text}」；body.thicknessMm 取折叠态，展开态见 rawOfficial`,
    );
  }
  const weight = parseWeight(wt.value ?? '');
  if (weight.note) addNote(rec, `重量原文「${tidy(wt.value)}」：${weight.note}`);
  if (/屏幕表面层/.test(dimNotes))
    addNote(rec, `官网脚注另给含屏幕表面层的重量，未采用：${tidy(dimNotes)}`);

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
    addNote(
      rec,
      `屏幕尺寸原文为多态标注「${tidy(sizeText)}」；display.sizeIn 取第一条（内屏/折叠态），其余见 rawOfficial`,
    );
  }

  // 分辨率：`折叠态：2442 × 1140 像素 三屏态：2232 × 3184 像素` / `内屏：2416 × 2210 像素 | 外屏：2444 × 1080 像素`
  const resText = res.value ?? '';
  const resPart = multiPartValue(resText);
  const resolutionPx = parseResolution(resPart.text) ?? parseResolution(resText);
  if (resPart.multi) {
    addNote(
      rec,
      `分辨率原文为多态标注「${tidy(resText)}」；display.resolutionPx 取第一条，其余见 rawOfficial`,
    );
  }

  const ppiPart = multiPartValue(ppiHit.value ?? '');
  const declaredPpi = ppiPart.text ? parsePpi(ppiPart.text) : null;
  let ppi = declaredPpi;
  if (ppi === null) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) {
      addNote(
        rec,
        `官网未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived`,
      );
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
  // 候选键放宽：不同机型/时期的官网把芯片放在不同键下（「处理器」「处理器.CPU
  // 型号」「处理器.芯片」「芯片」「SOC」等），只认前两个会漏掉其余键下的旗舰芯片。
  // 纯加法：仅当首个有值的键被采用，已正确取值的机型不受影响。
  const cpu = firstOf(
    raw,
    ['处理器', '处理器.CPU 型号', '处理器.CPU', '处理器.芯片', '处理器.处理器型号', '芯片', 'SOC'],
    name,
  );
  const gpu = firstOf(raw, ['处理器.GPU'], name);
  if (cpu.value) {
    // `麒麟9050 Pro 麒麟9050` 是「主型号 + 变体型号」并列，取第一个完整型号名
    const tokens = tidy(cpu.value)
      .split(/\s{2,}|\s*[|｜]\s*/)
      .map(tidy)
      .filter(Boolean);
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
        addNote(
          rec,
          `官网另有配置专属电池容量「${alt.key}：${alt.text}」；契约字段是单值，主值未覆盖，请按配置核对`,
        );
      }
    }
  }

  const charge = hwCharging(raw, name);
  rec.battery.wiredChargeW = wattOf(charge.wired ?? '');
  rec.battery.wirelessChargeW = /不支持/.test(charge.wireless ?? '')
    ? null
    : wattOf(charge.wireless ?? '');
  if (charge.wired && rec.battery.wiredChargeW === null) {
    addNote(
      rec,
      `有线充电原文「${tidy(charge.wired)}」未出现明确的「N W」标称，battery.wiredChargeW 记 null（不按 V×A 推算）`,
    );
  }
  if (/不支持/.test(charge.wireless ?? '')) {
    addNote(rec, '官网明确「无线充电：不支持」→ battery.wirelessChargeW 记 null（表示无此能力）');
  }

  /* ---- 影像 ------------------------------------------------------------ */
  const rear = firstOf(raw, HW_REAR_KEYS, name);
  const front = firstOf(raw, HW_FRONT_KEYS, name);
  const rearVideo = firstOf(
    raw,
    ['后置摄像头.后置摄像头摄像分辨率', '后置摄像头.后置摄像头视频拍摄'],
    name,
  );
  rec.camera.rear = parseRearLenses(rear.value ?? '');
  rec.camera.front = parseFront(front.value ?? '');
  rec.camera.videoMax = parseVideoMax(rearVideo.value ?? '');
  if (rear.value) {
    addNote(
      rec,
      `后置影像原文见 rawOfficial「后置摄像头」；未标注像素的辅助器件（红枫原色/多光谱/深感）role 记 depth、mp 记 null`,
    );
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
  // 「不支持」包含子串「支持」，必须先排除否定写法再判肯定
  rec.connectivity.nfc = nfcText ? (!/不支持/.test(nfcText) && /支持/.test(nfcText)) : null;
  // NFC 支持程度 = 官网原文（如「支持读卡器模式、卡模拟模式（华为钱包支付，SIM 卡支付*，HCE 支付）」）。
  // 与苹果口径不对称（苹果只写读卡器模式）→ 只存原文并列展示，不折算模式数量、不排名。
  rec.connectivity.nfcDetail = rec.connectivity.nfc === true ? tidy(nfcText) : null;
  rec.connectivity.esim = esimText ? /^支持/.test(tidy(esimText)) : null;
  rec.connectivity.satellite = satText ?? null;
  // 红外遥控（智能遥控）：华为规格页目前无此条目 → null（unknown）。
  // ⚠️ 判据只认「遥控」语义并显式排除「红外传感器」——后者在华为传感器清单里大量出现，
  // 是接近检测/人脸补光的被动器件，与遥控发射完全是两回事（parseIrBlaster 内守这条）。
  const irText = firstOf(raw, ['红外遥控', '数据连接.红外遥控', '遥控'], name).value;
  rec.connectivity.irBlaster = parseIrBlaster(irText);
  // WLAN 频段：优先取独立条目「WLAN 频段」。
  // ⚠️ 华为多数机型（50 台里 47 台）把频段写在「WLAN」条目的第一段
  // （原文「2.4 GHz 和 5 GHz | IEEE 802.11a/b/g/n/ac/ax/be，2 × 2 MIMO，EHT160…」），
  // 只有极少数机型另给独立的「WLAN 频段」键 —— 只认那个键会静默漏掉 45 台，
  // 而「少取一个值」是闸门唯一完全挡不住的错误类型。故做两级回退。
  const wlanText =
    hwLookup(raw, '数据连接.WLAN 频段', name).value ??
    hwLookup(raw, '数据连接.WLAN', name).value ??
    null;
  rec.connectivity.wlanBands = parseWlanBands(wlanText);
  // 蜂窝频段：华为规格页只给「网络制式」（4G/3G/2G 运营商制式），不列蜂窝频段 → null。
  // 不拿网络制式冒充频段，也不从第三方补 —— 官网没列就是 unknown。
  rec.connectivity.cellularBands = null;
  // 华为规格页不写「5G」章节；只有少数机型明确只列 4G 网络制式，此时才记 false，
  // 其余留 null —— 「官网没写」不等于「没有 5G」，绝不替官网下结论。
  const netMode = hwLookup(raw, '网络制式', name).value;
  if (netMode && !/5G/i.test(netMode)) rec.connectivity.fiveG = false;

  rec.os.launch = hwLookup(raw, '操作系统', name).value ?? null;
  // 华为规格页不给「可升级到」→ upgradableTo 保持 null

  /* ---- 机身其他 -------------------------------------------------------- */
  const ipRaw = hwLookup(raw, '防尘抗水', name).value;
  if (ipRaw) {
    const ips = [
      ...new Set(
        [...ipRaw.matchAll(/IP\s?\d{2}/gi)].map((m) => m[0].replace(/\s/g, '').toUpperCase()),
      ),
    ];
    rec.body.ipRating = ips.length ? ips.join('/') : null;
  }
  // 材质：华为规格页把机身材质放在不同键下（「中框」「机身材质」「材质」「外壳」
  // 「后盖」等），只认「中框」会漏掉绝大多数机型。两级回退，取第一个有值者；
  // 已正确取值的机型不受影响（首个 hwLookup 即有值）。
  rec.body.material =
    hwLookup(raw, '中框', name).value ??
    hwLookup(raw, '机身材质', name).value ??
    hwLookup(raw, '材质', name).value ??
    hwLookup(raw, '外壳', name).value ??
    hwLookup(raw, '后盖', name).value ??
    null;
  const colors = hwLookup(raw, '颜色', name).value;
  if (colors)
    rec.body.colors = colors
      .split(/[、,，]/)
      .map(tidy)
      .filter(Boolean);

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
  pushOfficial(
    rec,
    '尺寸与重量',
    [h.value, w.value, t.value, wt.value].filter(Boolean).join(' | '),
  );
  pushOfficial(
    rec,
    '屏幕',
    [size.value, type.value, res.value, ppiHit.value, glass.value].filter(Boolean).join(' | '),
  );
  pushOfficial(rec, '处理器', cpu.value);
  pushOfficial(rec, '存储', [mem.ramText, mem.romText].filter(Boolean).join(' | '));
  pushOfficial(rec, '电池', bat.raw);
  pushOfficial(
    rec,
    '充电',
    charge.merged ?? [charge.wired, charge.wireless].filter(Boolean).join(' | '),
  );
  pushOfficial(rec, '后置摄像头', rear.value);
  pushOfficial(rec, '前置摄像头', front.value);
  pushOfficial(rec, '防尘抗水', ipRaw);
  pushOfficial(
    rec,
    '数据连接',
    [
      rec.connectivity.wifi,
      rec.connectivity.bluetooth,
      rec.connectivity.usb,
      rec.connectivity.satellite,
    ]
      .filter(Boolean)
      .join(' | '),
  );
  for (const [label, path] of [
    ['屏幕脚注', '_notes.屏幕'],
    ['电池脚注', '_notes.电池'],
    ['充电脚注', '_notes.充电'],
  ]) {
    pushOfficial(rec, label, hwLookup(raw, path, name).value, 200);
  }

  if (variantKeys.length) {
    addNote(
      rec,
      `以下字段使用了带 @变体 后缀的键（基键不存在），已取匹配本机型的第一个变体：${variantKeys.join('、')}`,
    );
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
  for (const k of [
    'fiveG',
    'wifi',
    'bluetooth',
    'nfc',
    'nfcDetail',
    'irBlaster',
    'cellularBands',
    'wlanBands',
    'satellite',
    'usb',
    'sim',
    'esim',
  ]) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], HW);
  }
  put(rec, 'os.launch', rec.os.launch, HW);
  put(rec, 'skus', rec.skus, HW);

  return rec;
}

/**
 * 通道 A2：华为平板规格页 → ProductRecord（category='tablet'）。
 *
 * 与手机通道共用同一套解析助手（parseMm/parseWeight/parseInch/parseCapacity/…），
 * 但映射目标以 data/schemas/tablet.json 为准，三处分叉必须记住：
 *   1. 平板 schema 用 battery.capacityMah（华为官网公布 mAh），苹果平板走 capacityWh——
 *      两个口径各记各的官方原文，**绝不互换算**（换算 = 估算，数据诚信红线）。
 *   2. 华为平板充电原文是「5V/2A 或 … 或 20V/3.3A 输出」（V×A 形式），没有明确「N W」
 *      标称 → wiredChargeW 记 null（不按 V×A 推算，与手机通道 wattOf 同一纪律）。
 *   3. audio/features/device 前缀不在 sync 的 SPEC_GROUPS 里，直接写进 rec.specs 容器
 *      （sync 的 flattenSpecs 会保留已存在的 specs 键）。
 */
function mapHuaweiTablet(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: HW_SERIES_LINE[realValue(raw['_catalog.series']) ?? ''] ?? 'MatePad',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'tablet'; // 数据源层显式声明品类（sync 闸门校验，不再由 sync 兜底）

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  rec.body.heightMm = parseMm(hwLookup(raw, '尺寸与重量.长度', name).value ?? '');
  rec.body.widthMm = parseMm(hwLookup(raw, '尺寸与重量.宽度', name).value ?? '');
  rec.body.thicknessMm = parseMm(hwLookup(raw, '尺寸与重量.厚度', name).value ?? '');
  rec.body.weightG = parseWeight(hwLookup(raw, '尺寸与重量.重量', name).value ?? '').value;

  /* ---- 屏幕 ------------------------------------------------------------ */
  // 平板规格页**有**「屏幕.亮度」（手机页没有），且不带「峰值/典型」限定词——
  // parseBrightness 的 isPeak/isTypical 都不命中 → peak/typical 均 null，
  // 只落在 values[0]。这里显式取 values[0] 记 brightnessTypicalNits 并注明口径存疑。
  const sizeText = hwLookup(raw, '屏幕.尺寸', name).value ?? '';
  const sizeIn = parseInch(multiPartValue(sizeText).text);
  const resText = hwLookup(raw, '屏幕.分辨率', name).value ?? '';
  const resolutionPx = parseResolution(multiPartValue(resText).text) ?? parseResolution(resText);
  let ppi = parsePpi(hwLookup(raw, '屏幕.PPI', name).value ?? '');
  let ppiFrom = 'HW';
  if (ppi === null) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) {
      ppiFrom = 'derived';
      addNote(rec, 'display.ppi 由官网分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived');
    }
  }
  const bri = parseBrightness(hwLookup(raw, '屏幕.亮度', name).value ?? '');
  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(hwLookup(raw, '屏幕.类型', name).value ?? '');
  rec.display.resolutionPx = resolutionPx;
  rec.display.ppi = ppi;
  rec.display.brightnessTypicalNits = bri.typical ?? bri.values[0] ?? null;
  if (bri.typical === null && bri.values.length) {
    addNote(
      rec,
      `屏幕亮度原文「${tidy(hwLookup(raw, '屏幕.亮度', name).value)}」无峰值/典型限定词，取数值记 brightnessTypicalNits`,
    );
  }
  rec.display.colorGamut = hwLookup(raw, '屏幕.色彩', name).value ?? null;

  /* ---- 处理器 ---------------------------------------------------------- */
  // 平板原文「麒麟X90 / 麒麟X90A」是并列型号（` / ` 分隔），取第一个，其余进 note。
  const cpuText = tidy(hwLookup(raw, '处理器', name).value ?? '');
  if (cpuText) {
    const tokens = cpuText.split(/\s*[/｜|]\s*/).map(tidy).filter(Boolean);
    rec.chipset.name = tokens[0] ?? null;
    if (tokens.length > 1) {
      addNote(rec, `处理器原文含并列型号「${cpuText}」，chipset.name 取第一个：${tokens[0]}`);
    }
  }
  // processNm / cpuCores / gpu / npu：华为平板规格页不给 → null，不从型号名推断

  /* ---- 存储与内存 ------------------------------------------------------ */
  rec.memory.ramGb = parseStorageList(
    hwLookup(raw, '内存.运行内存（RAM）', name).value ??
      hwLookup(raw, '内存.运行内存', name).value ??
      '',
  );
  rec.memory.storageGb = parseStorageList(
    hwLookup(raw, '内存.机身内存（ROM）', name).value ??
      hwLookup(raw, '内存.机身内存', name).value ??
      '',
  );

  /* ---- 电池与充电 ------------------------------------------------------ */
  const bat = hwBattery(raw, name);
  if (bat.raw) {
    const fromBody = parseCapacity(bat.raw);
    const fromNotes = parseCapacity(bat.notes);
    rec.battery.capacityMah = fromBody.value ?? fromNotes.value;
    rec.battery.capacityCaliber = fromBody.caliber ?? fromNotes.caliber;
    if (fromBody.value === null && fromNotes.value !== null) {
      addNote(rec, `电池容量数值取自官网章节脚注：${bat.notes}`);
    }
  }
  // 平板充电原文没有「N W」标称（是 V/A 组合输出）→ null，绝不按 V×A 推算
  const chargeText =
    hwLookup(raw, '充电.充电器规格', name).value ??
    hwLookup(raw, '充电.标配充电器', name).value ??
    '';
  rec.battery.wiredChargeW = wattOf(chargeText);
  if (chargeText && rec.battery.wiredChargeW === null) {
    addNote(
      rec,
      `充电原文「${tidy(chargeText)}」为 V/A 组合输出、无「N W」标称，battery.wiredChargeW 记 null（不按 V×A 推算）`,
    );
  }

  /* ---- 影像 ------------------------------------------------------------ */
  const rear = firstOf(raw, ['摄像头.后置摄像头配置', '后置摄像头.后置摄像头配置'], name);
  const front = firstOf(raw, ['摄像头.前置摄像头配置', '前置摄像头.前置摄像头配置'], name);
  const rearVideo = firstOf(
    raw,
    ['后置摄像头.后置摄像头摄像分辨率', '摄像头.后置主摄像头摄像分辨率'],
    name,
  );
  rec.camera.rear = parseRearLenses(rear.value ?? '');
  rec.camera.front = parseFront(front.value ?? '');
  rec.camera.videoMax = parseVideoMax(rearVideo.value ?? '');

  /* ---- 连接与系统 ------------------------------------------------------ */
  rec.connectivity.wifi = hwLookup(raw, '数据连接.WLAN', name).value ?? null;
  rec.connectivity.wlanBands = parseWlanBands(
    hwLookup(raw, '数据连接.WLAN 频段', name).value ??
      hwLookup(raw, '数据连接.WLAN', name).value ??
      null,
  );
  rec.connectivity.bluetooth = hwLookup(raw, '数据连接.蓝牙', name).value ?? null;
  rec.connectivity.usb = hwLookup(raw, '数据连接.USB', name).value ?? null;
  rec.connectivity.gnss = hwLookup(raw, '定位', name).value ?? null;
  rec.connectivity.satellite = hwLookup(raw, '数据连接.卫星通信', name).value ?? null;
  rec.connectivity.cellularBands = null; // 平板规格页只给 WLAN，不列蜂窝频段 → unknown
  rec.connectivity.fiveG = null; // 官网不写蜂窝制式 → unknown，绝不替官网下结论
  rec.os.launch = hwLookup(raw, '操作系统', name).value ?? null;

  /* ---- 平板特有（specs 容器直写）---------------------------------------
   * audio 前缀不在 SPEC_GROUPS 里 → 嵌套组会被 sync 漏拍，直接写 specs。
   * 「扬声器」原文形如「立体声扬声器 × 6」，如实存原文不折算数量。 */
  const speakers = hwLookup(raw, '扬声器', name).value ?? null;
  if (speakers) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': tidy(speakers) };
    rec.provenance['audio.speakers'] = HW;
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '屏幕', raw['屏幕.材质'] ?? raw['屏幕.对比度']);
  pushOfficial(rec, '处理器', raw['处理器']);
  pushOfficial(rec, '电池', bat.raw);
  pushOfficial(rec, '充电', chargeText);
  pushOfficial(rec, '包装清单', raw['包装清单']);
  pushOfficial(rec, '感应器', raw['感应器']);

  /* ---- provenance（与手机通道同一批来源标记 HW）------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, rec.display.ppi === null ? HW : ppiFrom);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.capacityMah', rec.battery.capacityMah, HW);
  put(rec, 'battery.capacityCaliber', rec.battery.capacityCaliber, HW);
  put(rec, 'battery.wiredChargeW', rec.battery.wiredChargeW, HW);
  put(rec, 'camera.rear', rec.camera.rear, HW);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, HW);
  put(rec, 'camera.videoMax', rec.camera.videoMax, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'connectivity.wlanBands', rec.connectivity.wlanBands, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.usb', rec.connectivity.usb, HW);
  put(rec, 'connectivity.gnss', rec.connectivity.gnss, HW);
  put(rec, 'connectivity.satellite', rec.connectivity.satellite, HW);
  put(rec, 'os.launch', rec.os.launch, HW);

  return rec;
}

/**
 * 通道 A3：华为穿戴规格页 → ProductRecord（category='wearable'）。
 *
 * 穿戴页与手机/平板差异大，映射前先记住四条官网口径：
 *   1. 「尺寸」是「长 × 宽 × 高」三元文本（表壳对角 ≈ 第一、二个数，表壳高度 = 第三个数）
 *      → caseSizeMm 取第一个数（表壳直径/边长），thicknessMm 取第三个数（表壳高度）。
 *   2. 屏幕亮度只给峰值（「3000 nits」），schema 单字段 brightnessNits 记峰值并注明口径。
 *   3. 「理论工作时间」按场景分档（全能/省电/AOD…），vendorClaimedHours 取
 *      「常规使用」档（无则第一条），天→小时换算是单位换算不是估算。
 *   4. 「存储」形如「2 GB RAM + 64 GB ROM」→ 只取 ROM 段（RAM 不混进存储档位）。
 */
function mapHuaweiWearable(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: HW_SERIES_LINE[realValue(raw['_catalog.series']) ?? ''] ?? 'WATCH',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'wearable'; // 数据源层显式声明品类

  /* ---- 尺寸与重量：表壳三元 + 整机重量 ---------------------------------- */
  const dimsText =
    hwLookup(raw, '尺寸', name).value ??
    hwLookup(raw, '尺寸.手表尺寸', name).value ??
    hwLookup(raw, '尺寸.长 × 宽 × 高', name).value ??
    '';
  // 尺寸文本有两种形状：逐值带单位（「46 mm × 47.9 mm × 12.5 mm」）与
  // 仅末位带单位（手环「43.45 × 24.86 × 8.99 mm」）。只要含 mm 就抓全部数字
  // 按位取值；逐值正则会漏掉无单位的前两位（曾让 caseSizeMm 取到厚度 8.99）。
  const dims = tidy(dimsText).includes('mm')
    ? (tidy(dimsText).match(/\d+(?:\.\d+)?/g) ?? []).map((s) => parseFloat(s))
    : [];
  rec.body.caseSizeMm = dims.length ? dims[0] : null;
  rec.body.thicknessMm = dims.length >= 3 ? dims[2] : null;
  if (dims.length >= 3) {
    addNote(rec, `表壳尺寸原文「${tidy(dimsText)}」：caseSizeMm 取第一个数，thicknessMm 取第三个数（表壳高度）`);
  }
  rec.body.weightG = parseWeight(hwLookup(raw, '重量', name).value ?? '').value;
  const ipText =
    hwLookup(raw, '防尘抗水', name).value ?? hwLookup(raw, '防护等级', name).value ?? '';
  if (ipText) {
    // 只存第一段防水等级（如「防水：20 ATM + IP68 + IP69，潜水（最大深度 150 米）」），
    // 保修免责等长尾文本不进契约字段，原文见 rawOfficial
    rec.body.waterResistance = tidy(ipText.split(/\s*[|｜]\s*/)[0]);
  }

  /* ---- 屏幕 ------------------------------------------------------------ */
  const sizeText = hwLookup(raw, '屏幕.尺寸', name).value ?? '';
  const sizeIn = parseInch(sizeText);
  const resText = hwLookup(raw, '屏幕.分辨率', name).value ?? '';
  const resolutionPx = parseResolution(resText);
  // 穿戴页把 PPI 直接写在分辨率行（「466 × 466 pixels, PPI 310」）——注意官网这个值
  // 是横向像素密度口径（466/1.5≈310），与对角线公式（439）不同。官网有值必须用官网的，
  // 只在官网没写时才允许 √(w²+h²) 推导。
  const ppiHit = resText.match(/PPI\s*(\d+(?:\.\d+)?)/i);
  let ppi = ppiHit ? Number(ppiHit[1]) : parsePpi(resText);
  let ppiFrom = 'HW';
  if (ppi === null) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) {
      ppiFrom = 'derived';
      addNote(rec, 'display.ppi 由官网分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived');
    }
  }
  const bri = parseBrightness(
    hwLookup(raw, '屏幕.峰值亮度', name).value ??
      hwLookup(raw, '屏幕.最高亮度', name).value ??
      '',
  );
  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(hwLookup(raw, '屏幕.类型', name).value ?? '');
  rec.display.resolutionPx = resolutionPx;
  rec.display.ppi = ppi;
  // 穿戴 schema 只有一个亮度字段（display.brightnessNits），官网也只给一个值（峰值口径）
  rec.display.brightnessNits = bri.peak ?? bri.values[0] ?? null;
  if (bri.values.length && bri.peak === null) {
    addNote(rec, `屏幕亮度原文无「峰值」限定词，取数值记 brightnessNits（官网仅给一个亮度值）`);
  }

  /* ---- 处理器 / 存储 / 系统 -------------------------------------------- */
  rec.chipset.name = tidy(hwLookup(raw, '处理器', name).value ?? '') || null;
  // 存储形如「2 GB RAM + 64 GB ROM」→ 只取 ROM 段；无 RAM/ROM 标注则整段解析
  const storageText = hwLookup(raw, '存储', name).value ?? '';
  const romSeg = storageText.split(/\+\s*/).find((s) => /ROM/i.test(s)) ?? storageText;
  rec.memory.storageGb = parseStorageList(romSeg);
  rec.os.launch = hwLookup(raw, '操作系统', name).value ?? null;

  /* ---- 续航：场景分档取「常规使用」------------------------------------- */
  const batteryText =
    hwLookup(raw, '理论工作时间', name).value ??
    hwLookup(raw, '理论工作时间.典型使用场景续航 2 天', name).value ??
    '';
  if (batteryText) {
    const segs = batteryText.split(/\s*[|｜]\s*/);
    const regular = segs.find((s) => /常规|典型|综合续航/.test(s)) ?? segs[0];
    const dayM = regular.match(/(\d+(?:\.\d+)?)\s*天/);
    const hourM = regular.match(/(\d+(?:\.\d+)?)\s*小时/);
    if (dayM) {
      rec.battery.vendorClaimedHours = Number(dayM[1]) * 24; // 天→小时：单位换算
      rec.battery.capacityCaliber = null; // 口径字段不用于续航
    } else if (hourM) {
      rec.battery.vendorClaimedHours = Number(hourM[1]);
    }
    if (rec.battery.vendorClaimedHours !== null) {
      addNote(rec, `续航取自官网「${tidy(regular)}」档位，换算为小时；全部分档见 rawOfficial`);
    }
    pushOfficial(rec, '理论工作时间', batteryText);
  }

  /* ---- 传感器 / 充电方式 ------------------------------------------------ */
  const sensors = hwLookup(raw, '传感器', name).value ?? '';
  if (sensors) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'features.sensors': sensors.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['features.sensors'] = HW;
  }
  const chargeMethods = hwLookup(raw, '充电.充电方式', name).value ?? '';
  if (chargeMethods) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'battery.chargingMethods': chargeMethods.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['battery.chargingMethods'] = HW;
  }

  /* ---- 连接 ------------------------------------------------------------ */
  rec.connectivity.wifi = hwLookup(raw, '数据连接.WLAN', name).value ?? null;
  rec.connectivity.bluetooth = hwLookup(raw, '数据连接.蓝牙', name).value ?? null;
  rec.connectivity.gnss =
    hwLookup(raw, '数据连接.GNSS', name).value ?? hwLookup(raw, '定位', name).value ?? null;
  rec.connectivity.cellular = hwLookup(raw, '网络制式', name).value ?? null;
  const nfcText = hwLookup(raw, 'NFC', name).value ?? hwLookup(raw, '数据连接.NFC', name).value;
  rec.connectivity.nfc = nfcText ? !/不支持/.test(nfcText) && /支持/.test(nfcText) : null;

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '表壳', raw['表壳.材质'] ?? raw['表壳']);
  pushOfficial(rec, '表带', raw['表带']);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.caseSizeMm', rec.body.caseSizeMm, HW);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.waterResistance', rec.body.waterResistance, HW);
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, rec.display.ppi === null ? HW : ppiFrom);
  put(rec, 'display.brightnessNits', rec.display.brightnessNits, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.vendorClaimedHours', rec.battery.vendorClaimedHours, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.gnss', rec.connectivity.gnss, HW);
  put(rec, 'connectivity.cellular', rec.connectivity.cellular, HW);
  put(rec, 'connectivity.nfc', rec.connectivity.nfc, HW);
  put(rec, 'os.launch', rec.os.launch, HW);

  return rec;
}

/**
 * 通道 A4：华为显示器规格页 → ProductRecord（category='display'）。
 *
 * 显示器页口径（实测 2026-10-24）：
 *   1. 「尺寸.机身尺寸」是「长 × 高 × 厚」三元，长→widthMm、高→heightMm、厚→depthMm；
 *      高度可能是区间（「362~472 mm」含可调支架）→ 取下限并在 note 保留原文。
 *   2. 重量官网用 kg（「约 4.5 kg」）→ ×1000 换算成 g（单位换算不是估算）。
 *   3. 亮度标「（典型值）」→ brightnessTypicalNits；GT 系没标口径 → 按典型值记 + note。
 *   4. 「接口」按 | 切成 ports 数组；SoundBar 扬声器功率进 audio.speakers。
 */
function mapHuaweiMonitor(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: 'MateView',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'display'; // 数据源层显式声明品类

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const dimsText =
    hwLookup(raw, '尺寸.机身尺寸', name).value ??
    hwLookup(raw, '尺寸.尺寸（长 × 高 × 深）', name).value ??
    hwLookup(raw, '尺寸.尺寸（长 × 高 × 厚）', name).value ??
    '';
  // 优先按标签解析（GT 2026 写「长度：… 厚度：… 高度：…」），否则按位置三元
  // 只解析「整机含支架」段（文本里还混有屏幕面板尺寸与底座尺寸）。
  const bodySeg = tidy(dimsText).split(/屏幕尺寸|底座尺寸/)[0];
  const label = (cn) => bodySeg.match(new RegExp(`${cn}[：:]\\s*([\\d.]+)`));
  if (label('长度') && label('高度')) {
    rec.body.widthMm = Number(label('长度')[1]);
    rec.body.heightMm = Number(label('高度')[1]);
    rec.body.depthMm = label('厚度') ? Number(label('厚度')[1]) : null;
  } else {
    const dims = (bodySeg.match(/(\d+(?:\.\d+)?)\s*mm/g) ?? []).map((s) => parseFloat(s));
    if (dims.length >= 3) {
      rec.body.widthMm = dims[0]; // 官网第一元是「长」（显示器横向宽度）
      rec.body.heightMm = dims[1];
      rec.body.depthMm = dims[2];
    }
  }
  if (/~|—/.test(bodySeg)) {
    addNote(rec, `机身尺寸原文含可调区间「${bodySeg.slice(0, 80)}…」：heightMm 取区间下限，原文见 rawOfficial`);
  }
  const weightText = hwLookup(raw, '尺寸.重量', name).value ?? hwLookup(raw, '尺寸.机身重量', name).value ?? '';
  const kgM = tidy(weightText).match(/([\d.]+)\s*kg/);
  rec.body.weightG = kgM ? Math.round(Number(kgM[1]) * 1000) : parseWeight(weightText).value;
  if (kgM) addNote(rec, `重量原文「${tidy(weightText)}」以 kg 标注，×1000 换算为 g`);

  /* ---- 屏幕 ------------------------------------------------------------ */
  const sizeText = hwLookup(raw, '屏幕.屏幕尺寸', name).value ?? '';
  const sizeIn = parseInch(sizeText);
  const resText = hwLookup(raw, '屏幕.分辨率', name).value ?? '';
  const resolutionPx = parseResolution(resText);
  const ppiHit = resText.match(/(\d+(?:\.\d+)?)\s*PPI/i);
  let ppi = ppiHit ? Number(ppiHit[1]) : parsePpi(resText);
  let ppiFrom = 'HW';
  if (ppi === null || ppi === undefined) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) {
      ppiFrom = 'derived';
      addNote(rec, 'display.ppi 由官网分辨率与屏幕尺寸推得，来源记 derived');
    }
  }
  const bri = parseBrightness(hwLookup(raw, '屏幕.亮度', name).value ?? '');
  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(hwLookup(raw, '屏幕.面板类型', name).value ?? '');
  rec.display.resolutionPx = resolutionPx;
  rec.display.ppi = ppi ?? null;
  // 刷新率存纯数字形式（「320 Hz」→「320」）：闸门对 refreshHz 做数字区间校验，
  // 带单位原文会让 Number() 全部 NaN 而误报「没有可解析的数字」
  const hzNums = (tidy(hwLookup(raw, '屏幕.刷新率', name).value ?? '').match(/\d+(?:\.\d+)?/g) ?? []);
  rec.display.refreshHz = hzNums.length ? hzNums.join('/') : null;
  rec.display.brightnessTypicalNits = bri.typical ?? bri.values[0] ?? null;
  if (bri.values.length && bri.typical === null) {
    addNote(rec, `亮度原文未标口径，按典型值记 brightnessTypicalNits：${tidy(hwLookup(raw, '屏幕.亮度', name).value)}`);
  }
  rec.display.colorGamut = hwLookup(raw, '屏幕.色域', name).value ?? null;

  /* ---- 接口 / 扬声器 ---------------------------------------------------- */
  const portsText = hwLookup(raw, '接口', name).value ?? '';
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }
  const speakers =
    hwLookup(raw, '特性.SoundBar 双扬声器', name).value ?? hwLookup(raw, '扬声器', name).value ?? '';
  if (speakers) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': tidy(speakers) };
    rec.provenance['audio.speakers'] = HW;
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '支架', raw['支架.高度调节']);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, rec.display.ppi === null ? HW : ppiFrom);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);

  return rec;
}

/**
 * 通道 A5：华为笔记本规格页 → ProductRecord（category='laptop'）。
 *
 * 笔记本页口径（实测 2026-10-24）：
 *   1. 官网「长度/厚度」标签错位（MateBook X Pro 把 13.5mm 标成长度、222mm 标成厚度）。
 *      laptop schema 只收 thicknessMm —— 取三值中的最小值（厚度必为三维最小，结构性
 *      判定而非估算），其余维度不入契约，原文进 rawOfficial。
 *   2. 重量官网用 g（「约 980 g」）→ schema weightKg，÷1000 单位换算。
 *   3. 处理器/内存/存储常为多配置并列（「 | 」分隔）→ chipset.name 取第一段并留 note，
 *      内存/存储存全部档位。
 *   4. 电池「70 Wh（额定容量）」→ capacityWh 直接取数值。
 */
function mapHuaweiLaptop(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: 'MateBook',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'laptop'; // 数据源层显式声明品类

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const dimsText = ['长度', '宽度', '厚度', '高度', '深度']
    .map((k) => hwLookup(raw, `尺寸与重量.${k}`, name).value)
    .filter(Boolean)
    .join(' | ');
  const dims = (dimsText.match(/(\d+(?:\.\d+)?)\s*mm/g) ?? []).map(parseFloat);
  if (dims.length) {
    rec.body.thicknessMm = Math.min(...dims); // 厚度 = 三维最小（官网键位标签错位，见函数注释）
    addNote(
      rec,
      `官网尺寸键位与物理维度错位（长度/厚度标签混用），body.thicknessMm 取全部维度值的最小值；原文见 rawOfficial`,
    );
  }
  const weightText = hwLookup(raw, '尺寸与重量.重量', name).value ?? '';
  const w = parseWeight(weightText).value;
  rec.body.weightKg = w !== null ? w / 1000 : null; // 官网 g → schema kg：单位换算

  /* ---- 屏幕 ------------------------------------------------------------ */
  const sizeText = hwLookup(raw, '屏幕.尺寸', name).value ?? '';
  const sizeIn = parseInch(sizeText);
  const resText = hwLookup(raw, '屏幕.分辨率', name).value ?? '';
  const resolutionPx = parseResolution(resText);
  const ppiHit = resText.match(/(\d+(?:\.\d+)?)\s*ppi/i);
  let ppi = ppiHit ? Number(ppiHit[1]) : parsePpi(resText);
  let ppiFrom = 'HW';
  if (!ppi) {
    ppi = derivePpi(sizeIn, resolutionPx);
    if (ppi !== null) ppiFrom = 'derived';
  }
  const bri = parseBrightness(hwLookup(raw, '屏幕.亮度', name).value ?? '');
  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(hwLookup(raw, '屏幕.类型', name).value ?? '');
  rec.display.resolutionPx = resolutionPx;
  rec.display.ppi = ppi ?? null;
  // 刷新率存纯数字斜杠形式（「144 Hz」→「144」；「Windows 版：120 Hz* | Linux 版：120 Hz」→「120」）：
  // 闸门对 refreshHz 做数字区间校验，带单位原文会让 Number() 全部 NaN 而误报
  const laptopHzNums = [
    ...new Set((tidy(hwLookup(raw, '屏幕.刷新率', name).value ?? '').match(/\d+(?:\.\d+)?/g) ?? [])),
  ];
  rec.display.refreshHz = laptopHzNums.length ? laptopHzNums.join('/') : null;
  rec.display.brightnessTypicalNits = bri.typical ?? bri.values[0] ?? null;
  if (bri.values.length && bri.typical === null) {
    addNote(rec, `亮度原文未标口径，按典型值记 brightnessTypicalNits：${tidy(hwLookup(raw, '屏幕.亮度', name).value)}`);
  }
  rec.display.colorGamut = hwLookup(raw, '屏幕.色域', name).value ?? null;

  /* ---- 芯片 / 内存 / 存储 ----------------------------------------------- */
  const cpuText = tidy(hwLookup(raw, '处理器', name).value ?? '');
  if (cpuText) {
    const tokens = cpuText.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean);
    rec.chipset.name = tokens[0] ?? null;
    if (tokens.length > 1) {
      addNote(rec, `处理器原文含多配置并列「${cpuText}」，chipset.name 取第一段：${tokens[0]}`);
    }
  }
  rec.chipset.gpu = tidy(hwLookup(raw, '显卡', name).value ?? '') || null;
  rec.memory.ramGb = parseStorageList(hwLookup(raw, '内存', name).value ?? '');
  rec.memory.storageGb = parseStorageList(hwLookup(raw, '存储', name).value ?? '');

  /* ---- 电池 ------------------------------------------------------------- */
  const whM = tidy(hwLookup(raw, '电池.容量', name).value ?? '').match(/([\d.]+)\s*Wh/);
  if (whM) rec.battery.capacityWh = Number(whM[1]);

  /* ---- 连接 / 影像 / 音频 ------------------------------------------------ */
  rec.connectivity.wifi = hwLookup(raw, '无线连接.WLAN', name).value ?? null;
  rec.connectivity.bluetooth = hwLookup(raw, '无线连接.蓝牙', name).value ?? null;
  const portsText = hwLookup(raw, '接口', name).value ?? '';
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }
  rec.camera.front = tidy(hwLookup(raw, '摄像头', name).value ?? '') || null;
  const audioText = tidy(hwLookup(raw, '音频', name).value ?? '');
  const spkSeg = audioText.split(/\s*[|｜]\s*/).find((s) => /扬声器/.test(s));
  if (spkSeg) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': spkSeg };
    rec.provenance['audio.speakers'] = HW;
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '键盘和触控板', raw['键盘和触控板']);
  pushOfficial(rec, '包装清单', raw['包装清单']);
  pushOfficial(rec, '尺寸与重量', dimsText);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, HW);
  put(rec, 'body.weightKg', rec.body.weightKg, HW);
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, !rec.display.ppi ? HW : ppiFrom);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);
  put(rec, 'chipset.gpu', rec.chipset.gpu, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'battery.capacityWh', rec.battery.capacityWh, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'camera.front', rec.camera.front, HW);

  return rec;
}

/**
 * 通道 A6：华为音频规格页 → ProductRecord（category='audio'）。
 *
 * 音频页口径（实测 2026-10-24，耳机 FreeBuds/FreeClip 系 + 音箱 Sound 系两种版式）：
 *   1. 耳机续航按场景分档（降噪开/关 × 质量优先/稳定优先），budHours 取「耳机单次充电」
 *      的最大值、withCaseHours 取「配合充电盒」的最大值——官网给的是各档位，取最大
 *      档是「官网公布的最好成绩」口径，全部档位进 rawOfficial。
 *   2. 降噪是布尔：音频技术原文含「主动降噪」→ true；没提 → null（不替官网下结论）。
 *   3. 音箱页（Sound 系）键结构与耳机不同，本映射器只取两版式共有的键，缺的留空。
 */
function mapHuaweiAudio(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: /FreeBuds|FreeClip|FreeArc/i.test(name) ? 'FreeBuds' : /Sound/i.test(name) ? 'Sound' : 'Eyewear',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'audio'; // 数据源层显式声明品类

  /* ---- 尺寸与重量（耳机版式）------------------------------------------- */
  rec.body.budWeightG = parseWeight(hwLookup(raw, '重量.单耳机', name).value ?? '').value;
  rec.body.weightG = parseWeight(hwLookup(raw, '重量.整机（含包装）', name).value ?? '').value;
  const caseText = hwLookup(raw, '尺寸.充电盒', name).value ?? '';
  if (caseText) rec.body.material = null; // 充电盒配色文本不进 material（诚实留空）
  const waterText = hwLookup(raw, '防水防尘等级', name).value ?? '';
  if (waterText) rec.body.waterResistance = tidy(waterText);

  /* ---- 音频特性 --------------------------------------------------------- */
  const techText = hwLookup(raw, '音频技术', name).value ?? '';
  if (techText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      ...( /主动降噪/.test(techText) ? { 'audio.anc': true } : {}),
      ...( /空间音频|全景声/.test(techText) ? { 'audio.spatialAudio': true } : {}),
    };
    if (/主动降噪/.test(techText)) rec.provenance['audio.anc'] = HW;
    if (/空间音频|全景声/.test(techText)) rec.provenance['audio.spatialAudio'] = HW;
  }
  const driver = hwLookup(raw, '发声单元', name).value ?? '';
  if (driver) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.driverUnit': tidy(driver) };
    rec.provenance['audio.driverUnit'] = HW;
  }

  /* ---- 续航：耳机单次 / 配合充电盒 -------------------------------------- */
  const batteryText = hwLookup(raw, '电池.续航时间', name).value ?? '';
  if (batteryText) {
    const hours = [...batteryText.matchAll(/(\d+(?:\.\d+)?)\s*小时/g)].map((m) => Number(m[1]));
    const bud = [...batteryText.matchAll(/耳机单次充电使用\s*(\d+(?:\.\d+)?)\s*小时/g)].map((m) => Number(m[1]));
    const withCase = [
      ...batteryText.matchAll(/配合充电盒使用\s*(\d+(?:\.\d+)?)\s*小时/g),
    ].map((m) => Number(m[1]));
    if (bud.length) rec.battery.budHours = Math.max(...bud);
    if (withCase.length) rec.battery.withCaseHours = Math.max(...withCase);
    if (!bud.length && !withCase.length && hours.length) {
      rec.battery.budHours = Math.max(...hours); // 音箱/其他版式只有一个续航数
    }
    if (rec.battery.budHours !== null || rec.battery.withCaseHours !== null) {
      addNote(rec, '续航取官网各档位中的最大值（官网公布的最好成绩），全部档位见 rawOfficial');
    }
    pushOfficial(rec, '电池.续航时间', batteryText);
  }
  const chargeMethods = hwLookup(raw, '电池.充电方式', name).value ?? '';
  if (chargeMethods) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'battery.chargingMethods': chargeMethods.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['battery.chargingMethods'] = HW;
  }

  /* ---- 连接 ------------------------------------------------------------- */
  rec.connectivity.bluetooth = hwLookup(raw, '无线连接.蓝牙版本', name).value ?? null;

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '音频技术', techText);
  pushOfficial(rec, '防水防尘等级', waterText);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.budWeightG', rec.body.budWeightG, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.waterResistance', rec.body.waterResistance, HW);
  put(rec, 'battery.budHours', rec.battery.budHours, HW);
  put(rec, 'battery.withCaseHours', rec.battery.withCaseHours, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);

  return rec;
}

/**
 * 通道 A7：华为智慧屏规格页 → ProductRecord（category='media'，与 Apple TV 同品类）。
 *
 * 智慧屏页口径（实测 2026-10-24）：
 *   1. 一页多尺寸变体（65/75/85/98 英寸各一套规格键），hwLookup 前缀匹配取最短变体名
 *      （= 最小尺寸档），note 说明；其余尺寸原文进 rawOfficial。
 *   2. media schema 无亮度原字段——亮度原文只进 rawOfficial，不造字段；
 *      刷新率按 recipe 补了 media schema 的 display.refreshHz。
 */
function mapHuaweiVision(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: name.includes('MateTV') ? 'MateTV' : 'Vision',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'media'; // 数据源层显式声明品类

  /* ---- 屏幕 ------------------------------------------------------------ */
  const sizeText = hwLookup(raw, '屏幕.尺寸', name).value ?? '';
  const sizeIn = parseInch(sizeText);
  const resText = hwLookup(raw, '屏幕.分辨率', name).value ?? '';
  const resolutionPx = parseResolution(resText);
  rec.display.sizeIn = sizeIn;
  rec.display.type = normalizeType(hwLookup(raw, '屏幕.屏幕类型', name).value ?? '');
  rec.display.resolutionPx = resolutionPx;
  // 刷新率存纯数字斜杠形式（「120 Hz / 240 Hz」→「120/240」）：闸门对 refreshHz
  // 做数字区间校验，带单位原文会让 Number() 全部 NaN 而误报
  const hzNums = (tidy(hwLookup(raw, '屏幕.屏幕刷新率/倍频刷新率', name).value ?? '').match(/\d+(?:\.\d+)?/g) ?? []);
  rec.display.refreshHz = hzNums.length ? hzNums.join('/') : null;
  rec.display.colorGamut = hwLookup(raw, '屏幕.色域', name).value ?? null;
  if (/\d{2}\s*英寸/.test(tidy(sizeText))) {
    addNote(rec, `一页多尺寸变体，取最短变体名（最小尺寸档）：${tidy(sizeText)}`);
  }

  /* ---- 机身 ------------------------------------------------------------- */
  const dimsText = hwLookup(raw, '尺寸.不含底座', name).value ?? '';
  const dims = (tidy(dimsText).match(/(\d+(?:\.\d+)?)\s*mm/g) ?? []).map(parseFloat);
  if (dims.length >= 3) {
    // 官网「不含底座」是「长 × 高 × 厚」：长→widthMm、高→heightMm、厚→depthMm
    rec.body.widthMm = dims[0];
    rec.body.heightMm = dims[1];
    rec.body.depthMm = dims[2];
  }
  const weightText = hwLookup(raw, '重量.不含底座', name).value ?? '';
  const kgM = tidy(weightText).match(/([\d.]+)\s*kg/);
  rec.body.weightG = kgM ? Math.round(Number(kgM[1]) * 1000) : parseWeight(weightText).value;
  if (kgM) addNote(rec, `重量原文「${tidy(weightText)}」以 kg 标注，×1000 换算为 g`);

  /* ---- 系统 / 接口 / 扬声器 ---------------------------------------------- */
  rec.os.launch = hwLookup(raw, '操作系统', name).value ?? null;
  const portsText = hwLookup(raw, '接口', name).value ?? '';
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }
  const speakers = hwLookup(raw, '扬声器', name).value ?? hwLookup(raw, '音频', name).value ?? '';
  if (speakers) {
    rec.specs = { ...(rec.specs ?? {}), 'audio.speakers': tidy(speakers) };
    rec.provenance['audio.speakers'] = HW;
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '亮度', raw['屏幕.亮度']);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'display.sizeIn', rec.display.sizeIn, HW);
  put(rec, 'display.type', rec.display.type, HW);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, HW, ['w', 'h']);
  put(rec, 'display.refreshHz', rec.display.refreshHz, HW);
  put(rec, 'display.colorGamut', rec.display.colorGamut, HW);
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'os.launch', rec.os.launch, HW);

  return rec;
}

/**
 * 通道 A8：华为路由器规格页 → ProductRecord（category='network'）。
 *
 * 路由器页口径（实测 2026-10-24，家用路由凌霄/X/BE/AX 系 + 随行 WiFi 系两种版式）：
 *   1. 家用路由尺寸是「天线折叠/天线直立」两种形态文本 → 厚度取折叠态（最小三维），
 *      与笔记本「三维最小 = 厚度」同一结构性判定；随行 WiFi 是常规长宽高。
 *   2. WLAN 规格（传输标准/无线速率/频段）全量进 connectivity.wifi 拼接原文；
 *      网口列表进 connectivity.ports。
 *   3. 随行 WiFi 电池原文只记 note 不进契约（network schema 无电池字段，不造字段）。
 */
function mapHuaweiRouter(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: /mobile-wifi|随行/i.test(name) ? '随行WiFi' : '路由',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'network'; // 数据源层显式声明品类

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const foldText = hwLookup(raw, '尺寸与重量.天线折叠', name).value;
  const upText = hwLookup(raw, '尺寸与重量.天线直立', name).value;
  const h = hwLookup(raw, '尺寸与重量.高度', name).value;
  const w = hwLookup(raw, '尺寸与重量.宽度', name).value;
  const t = hwLookup(raw, '尺寸与重量.厚度', name).value;
  const dimsText = foldText ?? upText ?? [h, w, t].filter(Boolean).join(' | ');
  const dims = (tidy(dimsText).match(/(\d+(?:\.\d+)?)\s*mm/g) ?? []).map(parseFloat);
  if (foldText && upText) {
    // 两种形态都给：折叠态尺寸更小，取折叠态记入契约（整机收纳尺寸），直立态进 rawOfficial
    const fold = (tidy(foldText).match(/(\d+(?:\.\d+)?)\s*mm/g) ?? []).map(parseFloat);
    if (fold.length >= 3) {
      rec.body.widthMm = Math.max(...fold);
      rec.body.heightMm = [...fold].sort((a, b) => b - a)[1];
      rec.body.depthMm = Math.min(...fold);
      addNote(rec, `天线折叠/直立两种形态，body 三维取折叠态（收纳尺寸）；直立态见 rawOfficial`);
    }
  } else if (dims.length >= 3) {
    const sorted = [...dims].sort((a, b) => b - a);
    rec.body.widthMm = sorted[0];
    rec.body.heightMm = sorted[1];
    rec.body.depthMm = sorted[2];
  }
  rec.body.weightG = parseWeight(hwLookup(raw, '尺寸与重量.重量', name).value ?? '').value;

  /* ---- WLAN / 网口 / 内存 ---------------------------------------------- */
  const wlanParts = [
    hwLookup(raw, 'WLAN 规格.传输标准', name).value,
    hwLookup(raw, 'WLAN 规格.无线速率', name).value,
    hwLookup(raw, 'WLAN 规格.无线频段', name).value,
    hwLookup(raw, '传输标准', name).value,
    hwLookup(raw, '无线速率', name).value,
    hwLookup(raw, '无线频段', name).value,
  ].filter(Boolean);
  rec.connectivity.wifi = wlanParts.map(tidy).join(' | ') || null;
  const portsText = hwLookup(raw, '接口', name).value ?? hwLookup(raw, '网口', name).value ?? '';
  if (portsText) {
    rec.specs = {
      ...(rec.specs ?? {}),
      'connectivity.ports': portsText.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean),
    };
    rec.provenance['connectivity.ports'] = HW;
  }
  // 「存储.运行内存（RAM）+ 机身内存（ROM）」形如「512 MB + 128 MB」
  const memText = hwLookup(raw, '存储.运行内存（RAM）+ 机身内存（ROM）', name).value ?? '';
  const ramM = tidy(memText).match(/([\d.]+)\s*(MB|GB)\s*\+/i);
  const romM = tidy(memText).match(/\+\s*([\d.]+)\s*(MB|GB)/i);
  const toGb = (n, u) => (u.toUpperCase() === 'GB' ? Number(n) : Math.round((Number(n) / 1024) * 100) / 100);
  if (ramM) rec.memory.ramGb = [toGb(ramM[1], ramM[2])];
  if (romM) rec.memory.storageGb = [toGb(romM[1], romM[2])];
  if (ramM && romM) {
    addNote(rec, `内存原文「${tidy(memText)}」：MB→GB 是单位换算（除以 1024）`);
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '电池', raw['电池.电池容量']);
  pushOfficial(rec, '安全', raw['安全.防火墙安全管理'] ?? raw['安全.防火墙']);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);

  return rec;
}

export {
  mapHuawei,
  mapHuaweiTablet,
  mapHuaweiWearable,
  mapHuaweiMonitor,
  mapHuaweiLaptop,
  mapHuaweiAudio,
  mapHuaweiVision,
  mapHuaweiRouter,
};
