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

/* ══════════════════════════════════════════════════════════════════════════
 * 音频 / 网络两条通道共用的取值助手
 *
 * 华为规格页的键名有两类 hwLookup 取不到的写法（实测 2026-10-27，20 台音频 +
 * 25 台路由逐键核对）：
 *   · 键尾带全角冒号：`电池.续航：` / `WLAN 规格.传输标准：`（新旧版式混用）；
 *   · 分节子键：`防水防尘等级.耳机` / `尺寸与重量.母路由` / `充电方式.有线充电`。
 * hwLookup 是整键或「首段」精确匹配，冒号会让整条取值静默落空——「少取一个值」
 * 正是闸门唯一挡不住的错误类型，所以这两条通道一律走下面三个助手。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 去掉键名末尾的全角/半角冒号 */
const stripColon = (s) => s.replace(/\s*[：:]\s*$/, '').trim();

/** 按「归一后的完整键名」取值（`电池.续航：` → 电池.续航） */
function hwField(raw, base) {
  const target = stripColon(base);
  const key = Object.keys(raw).find((k) => stripColon(k.split('@')[0]) === target);
  return key === undefined ? undefined : realValue(raw[key]);
}

/** 取某分节下的全部子键：`防水防尘等级` → 裸键 + `.耳机` / `.充电盒` */
function hwSection(raw, base) {
  return Object.keys(raw)
    .filter((k) => k.split('@')[0].split('.')[0] === base)
    .map((k) => {
      const sub = stripColon(k.split('@')[0].split('.').slice(1).join('.'));
      const value = realValue(raw[k]);
      return value ? { sub, value } : null;
    })
    .filter(Boolean);
}

/** 从「无线连接」合并行里摘蓝牙版本（`蓝牙：BT 5.4` / `不支持 WLAN，Bluetooth 5.4`） */
function extractBluetooth(text) {
  const t = tidy(text ?? '');
  const labelled = t.match(/蓝牙\s*[：:]\s*([^|｜]+)/);
  if (labelled) return tidy(labelled[1]);
  const word = t.match(/Bluetooth\s*[\d.]+/i);
  return word ? tidy(word[0]) : null;
}

/**
 * 续航原文 → 单次 / 含盒两个最大值。
 * 官网三种写法混用：`电池.续航`（档位用 | 分隔、单位 h）、`电池.续航时间`
 * （`耳机单次充电使用 8 小时，配合充电盒使用 33 小时`）、眼镜的
 * `续航时间.聆听音乐`（`眼镜单次充满电使用 11 小时`）。
 * 取各档位最大值 = 「官网公布的最好成绩」，全部档位进 rawOfficial。
 */
function parseAudioHours(text) {
  const bud = [];
  const withCase = [];
  let mode = null; // 分节小标题决定后续无标签数值归属
  for (const seg of tidy(text ?? '').split(/\s*[|｜]\s*/)) {
    if (!/\d/.test(seg)) {
      if (/单次|单耳|耳机聆听|眼镜单次/.test(seg)) mode = 'bud';
      else if (/配合充电盒|整机|配合满电充电盒/.test(seg)) mode = 'case';
      continue;
    }
    for (const part of seg.split(/[，,；;]/)) {
      const m = part.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b)/i);
      if (!m) continue;
      const target = /配合充电盒|整机|配合满电充电盒/.test(part)
        ? 'case'
        : /单次|单耳|耳机聆听|眼镜单次/.test(part)
          ? 'bud'
          : mode;
      if (target === 'bud') bud.push(Number(m[1]));
      else if (target === 'case') withCase.push(Number(m[1]));
    }
  }
  return {
    bud: bud.length ? Math.max(...bud) : null,
    withCase: withCase.length ? Math.max(...withCase) : null,
  };
}

/**
 * 通道 A6：华为音频规格页 → ProductRecord（category='audio'）。
 *
 * 音频页口径（实测 2026-10-27，耳机 FreeBuds/FreeClip/FreeArc 系、音箱 Sound/悦彰 系、
 * 智能眼镜三种版式）：
 *   1. 耳机续航按场景分档（降噪开/关 × 质量优先/稳定优先），budHours 取「耳机单次充电」
 *      的最大值、withCaseHours 取「配合充电盒」的最大值——官网给的是各档位，取最大
 *      档是「官网公布的最好成绩」口径，全部档位进 rawOfficial。
 *   2. 降噪是布尔：音频技术原文含「主动降噪」→ true；明确写「不支持主动降噪」→ false；
 *      没提 → null（不替官网下结论）。
 *   3. 三种版式的键结构不同，按「耳机 / 音箱 / 眼镜」分别取共有键，缺的留空：
 *      · 耳机：单耳机 / 充电盒 / 整机（含包装）分列，或合并一行 `单耳机：3.8 g | 充电盒：33 g`；
 *      · 音箱：`尺寸.高度` + `尺寸.重量` + `扬声器.扬声器单元` + `连接.WLAN/蓝牙`；
 *      · 眼镜：`重量.<镜框变体>` + `续航时间.聆听音乐` + `数据连接.蓝牙/WLAN`。
 *      audio schema 无长/宽/直径与电池容量字段，这些值只进 rawOfficial，不造字段。
 */
function mapHuaweiAudio(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const isGlasses = /眼镜/.test(name);
  const isSpeaker = /Sound|悦彰|家庭影院/.test(name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: /FreeBuds|FreeClip|FreeArc/i.test(name)
      ? 'FreeBuds'
      : /Sound|悦彰/.test(name)
        ? 'Sound'
        : 'Eyewear',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'audio'; // 数据源层显式声明品类
  rec.specs = {}; // 音频 / features 前缀不在 sync 的 SPEC_GROUPS 里，直写扁平容器

  /* ---- 尺寸（音箱：立方/圆柱机身只有高度对得上 audio schema）------------- */
  if (isSpeaker) {
    const heightText = hwField(raw, '尺寸.高度');
    if (heightText && /环绕音箱|重低音音箱/.test(heightText)) {
      addNote(rec, `尺寸原文按声道音箱/环绕/重低音分列（「${tidy(heightText)}」），多箱体口径不统一，body 三维记 null`);
    } else {
      rec.body.heightMm = parseMm(heightText ?? '');
    }
  }

  /* ---- 重量：耳机分列 / 合并一行 / 音箱净重 / 眼镜按镜框分列 -------------- */
  const w = (k) => hwLookup(raw, k, name);
  const budW = parseWeight(w('重量.单耳机').value ?? w('重量.单只耳机').value ?? w('重量.耳机').value ?? '');
  const caseW = parseWeight(w('重量.充电盒（不含耳机）').value ?? w('重量.充电盒').value ?? '');
  const totalW = parseWeight(w('重量.整机（含包装）').value ?? w('尺寸.重量').value ?? '');
  rec.body.budWeightG = budW.value;
  rec.body.caseWeightG = caseW.value;
  rec.body.weightG = totalW.value;

  const combo = w('重量'); // 合并写法（SE 3）或按镜框分列（眼镜）
  if (combo.value && !budW.value && !caseW.value && !totalW.value) {
    for (const seg of combo.value.split(/\s*[|｜]\s*/)) {
      const one = parseWeight(seg);
      if (one.value === null) continue;
      if (/充电盒/.test(seg)) rec.body.caseWeightG = rec.body.caseWeightG ?? one.value;
      else if (/耳机|镜腿/.test(seg)) rec.body.budWeightG = rec.body.budWeightG ?? one.value;
      else rec.body.weightG = rec.body.weightG ?? one.value;
    }
    if (combo.variant) {
      addNote(rec, `重量原文按镜框分列（${combo.variant} 等），body.weightG 取第一个变体（不带衬片），其余见 rawOfficial`);
    }
  }
  if (!rec.body.weightG && /kg/.test(tidy(w('重量').value ?? ''))) {
    addNote(rec, `重量原文为多箱体 kg 口径（「${tidy(w('重量').value)}」），契约是单值 g，body.weightG 记 null`);
  }

  /* ---- 防水 / 材质 ------------------------------------------------------ */
  const waterSec = [...hwSection(raw, '防水防尘等级'), ...hwSection(raw, '防尘抗水')];
  const waterText = waterSec.map((e) => (e.sub ? `${e.sub}：${e.value}` : e.value)).join(' | ');
  if (waterText) rec.body.waterResistance = waterText;
  if (!isGlasses) {
    // 眼镜的 `材质.<镜框>` 是配色描述（「镜框：亮黑色」），不是材质 → 不映射
    const mat = hwField(raw, '材质') ?? hwField(raw, '材质.耳机');
    if (mat) rec.body.material = tidy(mat);
  }

  /* ---- 音频特性 --------------------------------------------------------- */
  const techText = hwField(raw, '音频技术') ?? '';
  if (/主动降噪/.test(techText)) {
    rec.specs['audio.anc'] = !/不支持主动降噪/.test(techText);
    rec.provenance['audio.anc'] = HW;
  }
  if (/空间音频|全景声/.test(techText)) {
    rec.specs['audio.spatialAudio'] = true;
    rec.provenance['audio.spatialAudio'] = HW;
  }
  // 耳机看 `发声单元`、音箱看 `扬声器.扬声器单元`、多箱体套装看 `扬声器`
  const driver = hwField(raw, '发声单元') ?? hwField(raw, '扬声器.扬声器单元') ?? hwField(raw, '扬声器');
  if (driver) {
    rec.specs['audio.driverUnit'] = tidy(driver);
    rec.provenance['audio.driverUnit'] = HW;
  }
  const sensors = hwField(raw, '传感器');
  if (sensors) {
    rec.specs['features.sensors'] = sensors.split(/[\/／]/).map(tidy).filter(Boolean);
    rec.provenance['features.sensors'] = HW;
  }

  /* ---- 续航：耳机单次 / 配合充电盒 -------------------------------------- */
  const lifeText = hwField(raw, '电池.续航') ?? hwField(raw, '电池.续航时间') ?? hwField(raw, '续航时间.聆听音乐');
  const hours = parseAudioHours(lifeText);
  rec.battery.budHours = hours.bud;
  rec.battery.withCaseHours = hours.withCase;
  if (hours.bud !== null || hours.withCase !== null) {
    addNote(rec, '续航取官网各档位中的最大值（官网公布的最好成绩），全部档位见 rawOfficial');
  }
  pushOfficial(rec, '电池.续航', lifeText);

  /* ---- 充电方式 --------------------------------------------------------- */
  const chargeList = [];
  const chargeBody = hwField(raw, '电池.充电方式');
  if (chargeBody) chargeList.push(...chargeBody.split(/\s*[|｜]\s*/).map(tidy).filter(Boolean));
  for (const e of hwSection(raw, '充电方式')) {
    if (e.sub) chargeList.push(`${e.sub}：${e.value}`);
  }
  if (chargeList.length) {
    rec.specs['battery.chargingMethods'] = chargeList;
    rec.provenance['battery.chargingMethods'] = HW;
  }

  /* ---- 连接 ------------------------------------------------------------- */
  const bt =
    hwField(raw, '无线连接.蓝牙版本') ??
    hwField(raw, '无线连接.蓝牙') ??
    hwField(raw, '数据连接.蓝牙') ??
    hwField(raw, '连接.蓝牙') ??
    extractBluetooth(hwField(raw, '无线连接') ?? hwField(raw, '数据连接'));
  rec.connectivity.bluetooth = bt ? tidy(bt) : null;

  let wifi = hwField(raw, '连接.WLAN') ?? hwField(raw, '数据连接.WLAN');
  if (!wifi) {
    // 合并行（`不支持 WLAN，Bluetooth 5.4`）只摘 WLAN 那一段；耳机行没有 WLAN 则不记
    const combos = hwField(raw, '无线连接') ?? hwField(raw, '数据连接');
    if (combos && /WLAN|Wi-?Fi|802\.11/i.test(combos) && !/不支持\s*WLAN/i.test(combos)) {
      wifi = combos.split(/\s*[|｜]\s*/).find((seg) => /WLAN|Wi-?Fi|802\.11/i.test(seg));
    }
  }
  rec.connectivity.wifi = wifi ? tidy(wifi) : null;

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '音频技术', techText);
  pushOfficial(rec, '防水防尘等级', waterText);
  pushOfficial(
    rec,
    '尺寸',
    [hwField(raw, '尺寸.耳机'), hwField(raw, '尺寸.充电盒'), hwField(raw, '尺寸.长度')]
      .filter(Boolean)
      .join(' | '),
  );
  pushOfficial(
    rec,
    '扬声器',
    [
      hwField(raw, '扬声器.理论功率'),
      hwField(raw, '扬声器.频响范围'),
      hwField(raw, '扬声器.声道'),
    ]
      .filter(Boolean)
      .join(' | '),
  );
  pushOfficial(
    rec,
    '电池',
    hwField(raw, '电池.电池容量') ??
      hwField(raw, '电池.额定容量') ??
      hwField(raw, '电池.容量') ??
      hwField(raw, '电池容量.容量') ??
      hwField(raw, '电池'),
  );
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.budWeightG', rec.body.budWeightG, HW);
  put(rec, 'body.caseWeightG', rec.body.caseWeightG, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'body.waterResistance', rec.body.waterResistance, HW);
  put(rec, 'body.material', rec.body.material, HW);
  put(rec, 'battery.budHours', rec.battery.budHours, HW);
  put(rec, 'battery.withCaseHours', rec.battery.withCaseHours, HW);
  put(rec, 'connectivity.bluetooth', rec.connectivity.bluetooth, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);

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

/* ══════════════════════════════════════════════════════════════════════════
 * 网络设备的「标签口径」三维解析
 *
 * 华为路由规格页有七种尺寸写法（实测 2026-10-27，25 台逐一核对）：
 *   · `288 mm（长）× 195.48 mm（宽）× 72.43 mm（高）`（值在前、标签在括号里）
 *   · `长度：193 mm | 宽度：80 mm | 高度：33 mm`（标签在前、分节子键）
 *   · `98 × 73 × 182.95 mm`（只有数字，顺序由键名「长 × 宽 × 高」给定）
 *   · `高度：250.9 mm | 直径：123.2 mm`（圆柱机身）
 *   · 主子路由分列：`母路由：145.32 mm | 子路由：125 mm`
 *   · 分版本：`天线折叠时… | 天线直立时…`、`8 口母路由 | 5 口母路由 | 子路由`
 *   · 分开的键：`尺寸与重量.高度 / 宽度 / 长度 / 厚度` 或 `尺寸.高度…`
 * 统一先还原成标签字典 {长,宽,高,厚,直径}，再按物理口径落位：
 *   有直径 → 高=高度、宽=厚=直径；
 *   有长   → 宽=长、厚=宽、高=高（或厚）—— 「长 × 宽 × 高」是占地口径；
 *   无长   → 高=高（或厚）、宽=宽、厚=厚 —— 「高 × 宽 × 厚」是立面口径。
 * 不能按数值排序猜（旧实现取最大=宽度，把 BE7 折叠态的 195.48 宽记成了高度）。
 * ══════════════════════════════════════════════════════════════════════════ */

const AXIS_KEYS = { 长度: '长', 宽度: '宽', 高度: '高', 厚度: '厚', 直径: '直径' };

/** 从一段尺寸原文里摘出标签 → 数值（值在前「288 mm（长）」与标签在前「长度：193 mm」两种） */
function dimLabelMap(text) {
  const t = tidy(text ?? '');
  const got = {};
  const set = (label, rawNum) => {
    const v = Number(rawNum);
    if (!Number.isFinite(v) || v <= 0) return;
    const key = /直径/.test(label)
      ? '直径'
      : /厚/.test(label)
        ? '厚'
        : /高/.test(label)
          ? '高'
          : /宽/.test(label)
            ? '宽'
            : '长';
    if (got[key] === undefined) got[key] = v;
  };
  for (const m of t.matchAll(
    /([\d.]+)\s*(?:mm|毫米)\s*[（(]\s*(长|宽|高|厚|厚度|深度|直径)\s*[）)]/g,
  ))
    set(m[2], m[1]);
  for (const m of t.matchAll(
    /(长|宽|高|厚|厚度|深度|直径)\s*度?\s*[：:]\s*([\d.]+)\s*(?:mm|毫米)/g,
  ))
    set(m[1], m[2]);
  return got;
}

/** 无标签的 `98 × 73 × 182.95 mm`：按键名给定的顺序落位（华为一律「长 × 宽 × 高」） */
function positionalDims(text, order = ['长', '宽', '高']) {
  const nums = [...tidy(text ?? '').matchAll(/([\d.]+)\s*(?:mm|毫米)?/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 3) return null;
  const got = {};
  order.forEach((label, i) => {
    got[label] = nums[i];
  });
  return got;
}

/** 标签字典 → body 三维（物理口径，见上方说明） */
function dimsToBody(got) {
  const { 长: L, 宽: W, 高: H, 厚: T, 直径: D } = got;
  if (D !== undefined) {
    return { heightMm: H ?? T ?? null, widthMm: D, depthMm: D };
  }
  if (L !== undefined) {
    return { heightMm: H ?? T ?? null, widthMm: L, depthMm: W ?? T ?? null };
  }
  return {
    heightMm: H ?? T ?? null,
    widthMm: W ?? null,
    depthMm: H !== undefined ? (T ?? null) : null,
  };
}

/** 分轴键（`尺寸与重量.长度` 等）→ 标签字典；每个键取第一个含数值的分段（母路由优先） */
function axisDims(raw) {
  for (const prefix of ['尺寸与重量', '尺寸']) {
    const got = {};
    for (const [k, label] of Object.entries(AXIS_KEYS)) {
      const text = hwField(raw, `${prefix}.${k}`);
      if (!text) continue;
      const seg =
        tidy(text)
          .split(/\s*[|｜]\s*/)
          .find((s) => /([\d.]+)\s*(?:mm|毫米)/.test(s)) ?? '';
      const m = seg.match(/([\d.]+)\s*(?:mm|毫米)/);
      if (m) got[label] = Number(m[1]);
    }
    if (Object.keys(got).length >= 2) return got;
  }
  return null;
}

/** 网口 / 接口原文 → 字符串数组；`8 口母路由： | 6 个…` 的悬空标签与下一段合并 */
function splitPorts(text) {
  const segs = tidy(text ?? '')
    .split(/\s*[|｜]\s*/)
    .map(tidy)
    .filter(Boolean);
  const out = [];
  let label = '';
  for (const s of segs) {
    if (/[：:]$/.test(s)) {
      label = s;
      continue;
    }
    const merged = `${label}${s}`;
    label = '';
    if (/\d/.test(merged)) out.push(merged);
  }
  return out;
}

/** 存储原文 → { ramGb, storageGb }；覆盖华为五种写法（见调用处注释） */
function routerMemory(text) {
  const t = tidy(text ?? '');
  const toGb = (n, u) =>
    u.toUpperCase() === 'GB' ? Number(n) : Math.round((Number(n) / 1024) * 100) / 100;
  const grab = (...patterns) => {
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return toGb(m[1], m[2]);
    }
    return undefined;
  };
  const ram = grab(
    /运行内存\s*[（(]\s*RAM\s*[）)]\s*[：:]\s*([\d.]+)\s*(MB|GB)/i,
    /([\d.]+)\s*(MB|GB)\s*[（(]\s*RAM\s*[）)]/i,
    /([\d.]+)\s*(MB|GB)\s*RAM\b/i,
    /([\d.]+)\s*(MB|GB)\s*[+＋]/i,
  );
  const rom = grab(
    /机身内存\s*[（(]\s*ROM\s*[）)]\s*[：:]\s*([\d.]+)\s*(MB|GB)/i,
    /([\d.]+)\s*(MB|GB)\s*[（(]\s*ROM\s*[）)]/i,
    /([\d.]+)\s*(MB|GB)\s*ROM\b/i,
    /[+＋]\s*([\d.]+)\s*(MB|GB)/i,
  );
  return { ramGb: ram, storageGb: rom };
}

/**
 * 通道 A8：华为路由器规格页 → ProductRecord（category='network'）。
 *
 * 路由器页口径（实测 2026-10-27，家用路由凌霄/X/BE/AX 系 + 移动路由 + 随行 WiFi 三种版式）：
 *   1. 三维按「标签口径」落位（长/宽/高/厚/直径），不按数值排序猜；
 *      主子路由套装取母路由（首个单元）口径，其余单元与分版本尺寸进 rawOfficial。
 *   2. WLAN 规格（传输标准/无线速率/频段）全量进 connectivity.wifi 拼接原文；
 *      网口优先于接口（接口含按键与电源口，不是以太网口口径），分节子键按 `母路由：…` 记录。
 *   3. 内存五种写法归一（`512 MB RAM + 128 MB ROM` / `256 MB（RAM）+ 128 MB（ROM）` /
 *      `运行内存（RAM）：128 MB | 机身内存（ROM）：128 MB` …），MB→GB 除以 1024。
 *   4. 功耗取官网「产品功耗」上限写 power.inputPower；AC/DC 电源或「输入电压」写
 *      power.inputVoltage。wireless/蜂窝/屏幕/电池在 network schema 无字段 → 只进 rawOfficial。
 */
function mapHuaweiRouter(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'huawei',
    line: /mobile-wifi|随行/i.test(name)
      ? '随行WiFi'
      : /mobile-router|移动路由/i.test(name)
        ? '移动路由'
        : '路由',
    name,
    nameZh: name,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  rec.category = 'network'; // 数据源层显式声明品类
  rec.specs = {};

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const dimCandidates = [
    '尺寸与重量.主机尺寸（长 × 宽 × 高）',
    '尺寸与重量.天线折叠',
    '尺寸与重量.母路由',
    '尺寸与重量.子路由',
    '尺寸.不包含支架',
    '尺寸.包含支架',
  ];
  const dimParts = dimCandidates.map((k) => hwField(raw, k)).filter(Boolean);
  for (const prefix of ['尺寸与重量', '尺寸']) {
    for (const k of Object.keys(AXIS_KEYS)) {
      const v = hwField(raw, `${prefix}.${k}`);
      if (v) dimParts.push(`${k}：${v}`);
    }
  }

  let dimSrc = '';
  let gotDims = null;
  for (const k of dimCandidates) {
    const text = hwField(raw, k);
    if (!text) continue;
    const labeled = dimLabelMap(text);
    const parsed = Object.keys(labeled).length >= 2 ? labeled : positionalDims(text);
    if (parsed) {
      gotDims = parsed;
      dimSrc = text;
      break;
    }
  }
  if (!gotDims) {
    const axis = axisDims(raw);
    if (axis) {
      gotDims = axis;
      dimSrc = Object.keys(axis).join('、');
    }
  }
  if (gotDims) {
    const body = dimsToBody(gotDims);
    rec.body.heightMm = body.heightMm;
    rec.body.widthMm = body.widthMm;
    rec.body.depthMm = body.depthMm;
  }
  if (/天线直立/.test(dimSrc) && /天线折叠/.test(dimSrc)) {
    addNote(rec, `天线折叠/直立两种形态，body 三维取折叠态（收纳尺寸）；直立态见 rawOfficial`);
  } else if (/天线直立时/.test(dimSrc) && /天线折叠时/.test(dimSrc)) {
    addNote(rec, `天线折叠/直立两种形态，body 三维取折叠态（收纳尺寸）；直立态见 rawOfficial`);
  } else if (/母路由|子路由/.test(dimSrc)) {
    if (/母路由/.test(dimSrc)) {
      addNote(rec, `尺寸原文按母路由/子路由（或套装版本）分列，body 三维取母路由口径；其余见 rawOfficial`);
    } else {
      addNote(rec, `尺寸原文只公布子路由口径，body 三维记子路由`);
    }
  }

  const weightKeys = ['尺寸与重量.主机重量', '尺寸与重量.母路由重量', '尺寸与重量.重量', '重量'];
  let weightText = '';
  for (const k of weightKeys) {
    const text = hwField(raw, k);
    if (!text) continue;
    weightText = text;
    const segs = tidy(text)
      .split(/\s*[|｜]\s*/)
      .filter((s) => /\d/.test(s));
    const seg = segs.find((s) => /裸机|主机重量|不含包装/.test(s)) ?? segs[0] ?? '';
    const w = parseWeight(seg);
    rec.body.weightG = w.value;
    if (w.value !== null) {
      if (segs.length > 1) {
        addNote(rec, `重量原文按母/子路由或包装版本分列，body.weightG 取主机裸机口径（${tidy(seg)}）；其余见 rawOfficial`);
      }
      break;
    }
  }
  pushOfficial(rec, '重量', weightText);

  /* ---- WLAN / 网口 / 内存 ---------------------------------------------- */
  const wifiStd =
    hwField(raw, 'WLAN 规格.传输标准') ??
    hwField(raw, 'WLAN 规格.WLAN 传输标准') ??
    hwField(raw, 'WLAN 规格.网络传输标准') ??
    hwField(raw, '传输标准');
  const wifiRate =
    hwField(raw, 'WLAN 规格.无线速率') ?? hwField(raw, 'WLAN 速率') ?? hwField(raw, '无线速率');
  const wifiBand =
    hwField(raw, 'WLAN 规格.无线频段') ?? hwField(raw, 'WLAN 频率') ?? hwField(raw, '无线频段');
  rec.connectivity.wifi = [wifiStd, wifiRate, wifiBand].filter(Boolean).map(tidy).join(' | ') || null;

  // 网口优先：分节子键（`网口.母路由`）单独记录单元；无网口才回退到接口
  let portList = splitPorts(hwField(raw, '网口'));
  if (!portList.length) {
    const subPorts = hwSection(raw, '网口');
    if (subPorts.length) portList = subPorts.map((e) => `${e.sub}：${e.value}`);
  }
  if (!portList.length) portList = splitPorts(hwField(raw, '接口'));
  if (portList.length) {
    rec.specs['connectivity.ports'] = portList;
    rec.provenance['connectivity.ports'] = HW;
  }

  // 内存五种写法：`512 MB RAM + 128 MB ROM` / `256 MB（RAM）+ 128 MB（ROM）` /
  // `运行内存（RAM）：128 MB | 机身内存（ROM）：128 MB`（套装取首组=母路由）
  const memText =
    hwField(raw, '存储.运行内存（RAM）+ 机身内存（ROM）') ??
    hwField(raw, '存储') ??
    hwSection(raw, '存储')
      .map((e) => `${e.sub}：${e.value}`)
      .join(' | ');
  const mem = routerMemory(memText);
  if (mem.ramGb !== undefined) rec.memory.ramGb = [mem.ramGb];
  if (mem.storageGb !== undefined) rec.memory.storageGb = [mem.storageGb];
  if (mem.ramGb !== undefined || mem.storageGb !== undefined) {
    if (/母路由|子路由|口母路由/.test(tidy(memText))) {
      addNote(rec, `内存原文按母/子路由分列，memory 取首组（母路由）口径；其余见 rawOfficial`);
    }
    if (/MB/i.test(tidy(memText))) {
      addNote(rec, `内存原文「${tidy(memText)}」：MB→GB 是单位换算（除以 1024）`);
    }
  }
  pushOfficial(rec, '存储', memText);

  /* ---- 功耗 / 输入电压 / 芯片 ------------------------------------------- */
  const powerTexts = ['功耗', '功耗.母路由', '功耗.子路由']
    .map((k) => hwField(raw, k))
    .filter(Boolean);
  const powerText = powerTexts.join(' | ');
  const powerMatch = powerText.match(/([\d.]+)\s*W\b/);
  if (powerMatch) {
    rec.specs['power.inputPower'] = Number(powerMatch[1]);
    rec.provenance['power.inputPower'] = HW;
    addNote(
      rec,
      powerTexts.length > 1
        ? 'power.inputPower 取官网「产品功耗」首个单元的 W 值（非铭牌额定输入功率）；母/子分列见 rawOfficial'
        : 'power.inputPower 取官网「产品功耗」的 W 值（非铭牌额定输入功率，原文见 rawOfficial）',
    );
  }
  const acdc =
    hwField(raw, '功耗.AC/DC电源') ??
    hwField(raw, '功耗.AC/DC 电源') ??
    hwField(raw, 'AC/DC电源') ??
    hwField(raw, 'AC/DC 电源');
  let voltage = acdc ? tidy(acdc) : null;
  if (!voltage && powerText) {
    const v = powerText.match(/输入电压\s*[：:]\s*([^|｜]+)/);
    const f = powerText.match(/输入电压频率\s*[：:]\s*([^|｜]+)/);
    const inline = powerText.match(/AC\/DC\s*电源\s*[：:]\s*([^|｜]+)/);
    if (v) voltage = [tidy(v[1]), tidy(f?.[1])].filter(Boolean).join(' | ');
    else if (inline) voltage = tidy(inline[1]);
  }
  if (voltage) {
    rec.specs['power.inputVoltage'] = voltage;
    rec.provenance['power.inputVoltage'] = HW;
  }
  const cpu = hwField(raw, 'CPU') ?? hwField(raw, '处理器');
  if (cpu) {
    rec.chipset.name = tidy(cpu);
    rec.provenance['chipset.name'] = HW;
  }

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '尺寸与重量', dimParts.join(' | '));
  pushOfficial(rec, '功耗', powerText);
  pushOfficial(
    rec,
    '蜂窝传输速率',
    hwField(raw, '蜂窝传输速率') ??
      [
        hwField(raw, '蜂窝传输速率.最高下行速度'),
        hwField(raw, '蜂窝传输速率.最高上行速度'),
      ]
        .filter(Boolean)
        .join(' | '),
  );
  pushOfficial(
    rec,
    '显示屏',
    [
      hwField(raw, '显示屏.屏幕尺寸') ?? hwField(raw, '屏幕.屏幕尺寸'),
      hwField(raw, '显示屏.屏幕类型') ?? hwField(raw, '屏幕.屏幕类型'),
    ]
      .filter(Boolean)
      .join(' | '),
  );
  pushOfficial(
    rec,
    '电池',
    hwField(raw, '电池') ?? hwField(raw, '电池.电池容量') ?? hwField(raw, '电池.额定容量'),
  );
  pushOfficial(rec, '安全', hwField(raw, '安全') ?? raw['安全.防火墙安全管理'] ?? raw['安全.防火墙']);
  pushOfficial(rec, '包装清单', raw['包装清单']);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.widthMm', rec.body.widthMm, HW);
  put(rec, 'body.heightMm', rec.body.heightMm, HW);
  put(rec, 'body.depthMm', rec.body.depthMm, HW);
  put(rec, 'body.weightG', rec.body.weightG, HW);
  put(rec, 'connectivity.wifi', rec.connectivity.wifi, HW);
  put(rec, 'memory.ramGb', rec.memory.ramGb, HW);
  put(rec, 'memory.storageGb', rec.memory.storageGb, HW);
  put(rec, 'chipset.name', rec.chipset.name, HW);

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
