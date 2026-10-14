/**
 * 通道 B/C：苹果规格页与对比页矩阵 → ProductRecord。
 * 苹果内部辅助（APPLE_SHARED_MARK / splitApplePage / apRows / apBlob / apFirst /
 * apFind / apKeyBody / FirstRaw）在此文件内定义，供两个 map 复用。
 */
import {
  emptyRecord,
  put,
  putObject,
  tidy,
  realValue,
  addNote,
  pushOfficial,
  parseAppleAppearance,
  derivePpi,
  pickFirstRes,
  refreshText,
  normalizeType,
  parseAperture,
  parseLens,
  parseVideoMax,
  parseMm,
  parseWeight,
  parseInch,
  parseStorageList,
  wattOf,
  firstNum,
  AP,
  AC,
  stripInvisible,
} from '../shared.mjs';
const APPLE_SHARED_MARK = /两种机型均具备|机型均具备/;

/**
 * 把规格页 raw 拆成「机型专属条目」与「公共段」。
 *
 * 18 Pro 页的结构是：某个变体专属的条目写在基键里（`显示屏.显示屏`），
 * 两个变体共有的条目写在 `两种机型均具备` 键里（`显示屏.两种机型均具备`）。
 * 「同页多机型」的拆分由上游适配器按列完成（18 Pro / 18 Pro Max 各成一个 RawProduct，
 * specsUrl 相同），这里只把公共段标记出来供两个变体共享 —— **切不开就不切**。
 * 真正调用 sliceByVariants 的自证在 main() 里，用于证明「公共段确实按机型名分得开」。
 */
function splitApplePage(rawProduct) {
  const merged = {};
  for (const [k, v] of Object.entries(rawProduct.raw)) {
    merged[k.startsWith('_shared:') ? k : APPLE_SHARED_MARK.test(k) ? `_shared:${k}` : k] = v;
  }
  return merged;
}

/**
 * 苹果 raw 键名 → 值。键形如 `组.行`（组名与行名相同，另有 `(2)` `(3)` 序号后缀）；
 * `_shared:组.行` 是「两种机型均具备」的公共段，组名取 `组`。
 *
 * 注意：**同一个组里可能出现多个「无序号」键**（18 Pro 页的 `显示屏.显示屏` 与
 * `显示屏.两种机型均具备`）。因此分组结果一律要
 *   ① 用 `apRows` 拼成整组文本，或
 *   ② 用 `apFind` 按正则挑出真正想要的那一行；
 * 绝不能拿「第一条」当组值 —— 那会把「超视网膜 XDR 显示屏」当成整组显示屏规格。
 */
const apKeyBody = (k) => (k.startsWith('_shared:') ? k.slice('_shared:'.length) : k);

/** 按 `组名.行名` 取分组；返回 `{ key, sub, value, order }[]`，order 为 `(N)` 序号（无序号为 0） */
function apRows(raw, group) {
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    const [sec, sub = ''] = apKeyBody(k).split('.');
    if (sec !== group) continue;
    const t = realValue(v);
    if (!t) continue;
    out.push({ key: k, sub, value: t, order: Number((sub.match(/\((\d+)\)$/) ?? [])[1] ?? 0) });
  }
  return out;
}

/** 整组文本（按页面行序拼接）；用于 ppi / 刷新率 / 亮度这类「跨行才能读全」的解析 */
const apBlob = (raw, group, sep = ' ') =>
  apRows(raw, group)
    .map((x) => x.value)
    .join(sep);

/** 第一行 */
const apFirst = (raw, group) => apRows(raw, group)[0]?.value;

/** 按正则取第一行匹配值 */
const apFind = (raw, group, re) => apRows(raw, group).find((x) => re.test(x.value))?.value;

/* ---------- B: 苹果规格页 ---------- */

function mapAppleSpecs(rawProduct) {
  const raw = splitApplePage(rawProduct);
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'apple',
    line: 'iPhone',
    name,
    nameZh: null,
    granularity: 'specs-page',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  // 原文靠「高度/宽度/厚度/重量：」标签分隔，按标签切段比按位置取更稳。
  // 注意 `高度：` 也出现在页面尾部的一句总结里（`iPhone 18 Pro，高度 150.0 毫米`），
  // 因此标签必须带冒号，且只取标签后的一小段。
  const dimText = apBlob(raw, '尺寸与重量');
  const segOf = (label) => {
    const i = dimText.indexOf(label);
    return i < 0 ? '' : dimText.slice(i + label.length, i + label.length + 60);
  };
  const labeled = (cn) => segOf(`${cn}：`) || segOf(`${cn}:`);
  rec.body.heightMm = parseMm(labeled('高度'));
  rec.body.widthMm = parseMm(labeled('宽度'));
  rec.body.thicknessMm = parseMm(labeled('厚度'));
  const weightSeg = labeled('重量');
  const weight = parseWeight(weightSeg);
  rec.body.weightG = weight.value;
  if (weight.note) addNote(rec, `重量原文「${tidy(weightSeg)}」：${weight.note}`);
  if (!rec.body.weightG) addNote(rec, `尺寸与重量原文未能解析出重量：${tidy(dimText)}`);
  // 少数页面缺「重量：」标签（如 iPhone Duo），退回「全页只出现一次的克数」
  if (rec.body.weightG === null) {
    const w = parseWeight(dimText);
    rec.body.weightG = w.value;
  }
  if (/展开/.test(dimText)) {
    addNote(
      rec,
      `尺寸与重量原文标注「展开」态（${tidy(dimText)}）；未给出折叠态，body.folded 记 null 而不是猜`,
    );
  }

  const ipText = apBlob(raw, '防溅、抗水、防尘');
  const ip = ipText.match(/IP\s?\d{2}/i);
  rec.body.ipRating = ip ? ip[0].replace(/\s/g, '').toUpperCase() : null;

  // 外观组第一行是配色（顿号分隔），且必须**整行都像配色**，否则会误吞描述段落
  const look = apRows(raw, '外观').map((x) => x.value);
  const appearance = parseAppleAppearance(look);
  rec.body.colors = appearance.colors;
  rec.body.material = appearance.material;

  /* ---- 屏幕 ------------------------------------------------------------ */
  const dispRows = apRows(raw, '显示屏').map((x) => x.value);
  const dispJoin = dispRows.join(' | ');
  // 尺寸：优先「N 英寸 (对角线)」那一行；其次是「N 英寸 … 显示屏」的行。
  // 不能拿第一条 —— 第一条常是「超视网膜 XDR 显示屏」，根本不含尺寸。
  const sizeLine =
    dispRows.find((t) => /英寸/.test(t) && /对角线/.test(t)) ??
    dispRows.find((t) => /英寸/.test(t) && /显示屏|OLED|全面屏/.test(t) && !/可视区域/.test(t)) ??
    dispRows.find((t) => /英寸/.test(t));
  rec.display.sizeIn = sizeLine ? parseInch(sizeLine) : null;
  const typeMatch = dispJoin.match(
    /(超视网膜 XDR 显示屏|超视网膜显示屏|LTPO[^，,|｜]*|OLED 可折叠全面屏|OLED 全面屏|OLED)/,
  );
  rec.display.type = typeMatch ? normalizeType(typeMatch[1]) : null;
  rec.display.resolutionPx = pickFirstRes(dispRows);
  // ppi 与分辨率同处一行（`2622 x 1206 像素分辨率，460 ppi`），整组里正则直接抓
  const declaredPpi = (() => {
    const m =
      dispJoin
        .replace(/,/g, '')
        .match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*像素分辨率[，,]?\s*(\d+(?:\.\d+)?)\s*ppi/i) ??
      dispJoin.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*ppi/i);
    return m ? Number(m[m.length - 1]) : null;
  })();
  rec.display.ppi = declaredPpi ?? derivePpi(rec.display.sizeIn, rec.display.resolutionPx);
  if (declaredPpi === null && rec.display.ppi !== null) {
    addNote(
      rec,
      '官网该页未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸按 √(w²+h²)/对角英寸 推得，来源记 derived',
    );
  }
  // 刷新率：只从含 Hz 的那一行读，避免把「6.27 英寸」当成刷新率下限
  rec.display.refreshHz = refreshText(apFind(raw, '显示屏', /Hz/i) ?? '');
  if (/最小亮度/.test(dispJoin)) {
    addNote(
      rec,
      '屏幕原文含「最小亮度为 1 尼特」，属最低亮度口径，未记入 brightnessTypicalNits/brightnessPeakNits',
    );
  }

  /**
   * 亮度分列。苹果原文：
   *   `1000 尼特最大亮度 (典型)；1600 尼特峰值亮度 (HDR)；3000 尼特峰值亮度 (户外)`
   * 峰值口径（HDR/户外）取最大，典型口径取「最大亮度 (典型)」；两者分列、绝不合成一个「最高亮度」。
   */
  const brightLines = dispRows.filter((t) => /尼特/.test(t));
  const peakVals = [];
  const typVals = [];
  for (const line of brightLines) {
    for (const m of line.matchAll(
      /(\d[\d,]*)\s*尼特\s*(?:峰值亮度|最大亮度)?\s*(?:\(([^)]*)\)|（([^）]*)）)?/g,
    )) {
      const val = Number(m[1].replace(/,/g, ''));
      const qual = m[2] ?? m[3] ?? '';
      if (/峰值|HDR|户外/.test(qual) || /峰值/.test(m[0])) peakVals.push(val);
      else if (/典型/.test(qual) || /典型/.test(m[0])) typVals.push(val);
    }
  }
  rec.display.brightnessPeakNits = peakVals.length ? Math.max(...peakVals) : null;
  rec.display.brightnessTypicalNits = typVals.length ? Math.max(...typVals) : null;
  if (
    rec.display.brightnessPeakNits !== null &&
    rec.display.brightnessTypicalNits !== null &&
    rec.display.brightnessPeakNits < rec.display.brightnessTypicalNits
  ) {
    addNote(
      rec,
      `峰值亮度(${rec.display.brightnessPeakNits}) < 典型亮度(${rec.display.brightnessTypicalNits})，两者口径解析可能串位，已双双置 null`,
    );
    rec.display.brightnessPeakNits = null;
    rec.display.brightnessTypicalNits = null;
  }
  rec.display.protection =
    appearance.protection ?? apFind(raw, '显示屏', /超瓷晶|纳米纹理|昆仑/) ?? null;

  /* ---- 芯片 ------------------------------------------------------------ */
  const chipRows = apRows(raw, '芯片').map((x) => x.value);
  rec.chipset.name = chipRows.find((t) => /芯片$/.test(t)) ?? null;
  const cpuLine = chipRows.find((t) => /中央处理器/.test(t));
  rec.chipset.cpuCores = cpuLine ? firstNum(cpuLine) : null;
  rec.chipset.gpu = chipRows.find((t) => /图形处理器/.test(t)) ?? null;
  rec.chipset.npu = chipRows.find((t) => /神经网络引擎/.test(t)) ?? null;

  /* ---- 存储（容量）----------------------------------------------------- */
  const capacityRows = apRows(raw, '容量').map((x) => x.value);
  rec.memory.storageGb = parseStorageList(
    capacityRows.filter((t) => !/不适用/.test(t)).join(' | '),
  );
  if (rec.memory.storageGb.length === 1) {
    addNote(
      rec,
      `容量原文「${tidy(capacityRows[0] ?? '')}」只列出该机型在售的首档；memory.storageGb 仅收官网明示档位`,
    );
  }

  /* ---- 电池与充电 ------------------------------------------------------ */
  const battRows = apRows(raw, '电源和电池').map((x) => x.value);
  const battJoin = battRows.join(' | ');
  // 视频播放时长（厂商自报）。Duo/Air 有多条「内屏/外屏/搭配 MagSafe 电池」，
  // 取与「视频播放」同行的那条基准值，其余记 note。
  const videoLine = battRows.find((t) => /视频播放/.test(t));
  if (videoLine) {
    rec.battery.vendorClaimedVideoHours = firstNum(
      (videoLine.match(/最长可达\s*(\d+(?:\.\d+)?)\s*小时/) ?? [])[1] ?? '',
    );
    if (battRows.filter((t) => /最长可达/.test(t)).length > 1) {
      addNote(
        rec,
        `厂商自报续航原文含多个口径（${tidy(battJoin)}）；battery.vendorClaimedVideoHours 取「视频播放」第一条`,
      );
    }
  }
  // 快速充电：原文只给「N 分钟充至 50%，需 ≥X 瓦适配器」。X 是适配器要求，不是手机峰值功率，
  // 两者不是一回事，所以 battery.wiredChargeW 保持 null —— 这是官网口径的真缺口。
  const fastLine = battRows.find((t) => /可快速充电|充至 50%/.test(t));
  if (fastLine) {
    const adapterW = wattOf(fastLine);
    addNote(
      rec,
      `官网只给出「${tidy(fastLine)}」——其中 ${adapterW ?? '—'} 瓦是**电源适配器要求**，不是手机有线充电峰值功率，` +
        '故 battery.wiredChargeW 记 null（苹果从不公布该值）',
    );
  } else if (rec.battery.wiredChargeW === null) {
    addNote(
      rec,
      '规格页电源章节未给出任何有线充电功率（连适配器要求都没有）→ battery.wiredChargeW 记 null',
    );
  }
  // 无线充电：来自 MagSafe 组，原文写「功率最高可达 15 瓦」→ 官方明确的瓦数，可收
  const magsafe =
    apBlob(raw, 'MagSafe 和无线充电', ' | ') || apFind(raw, '电源和电池', /无线充电/) || '';
  rec.battery.wirelessChargeW = wattOf(magsafe);
  if (rec.battery.wirelessChargeW !== null) {
    addNote(rec, `battery.wirelessChargeW 取自「${tidy(magsafe).slice(0, 60)}」中的明确瓦数`);
  }
  // 苹果从不公布电池容量(mAh) → 保持 null + capacityCaliber null

  /* ---- 影像 ------------------------------------------------------------ */
  const camRows = apRows(raw, '摄像头').map((x) => x.value);
  /**
   * 镜头清单行的判定。18 Pro 页把所有镜头塞在同一个 `摄像头.摄像头` 里（含大量叙述句），
   * 16 页则把镜头单独放在 `摄像头(2)`。判据：
   *   ① 用 `|` 分列，且**至少两段以「…万像素…」开头**（叙述段几乎不会这么起头）；
   *   ② 每段都长得像镜头（以像素数开头，或含「摄像头/镜头」），否则整行不是清单。
   */
  const lensSegs = (t) =>
    /[|｜]/.test(t)
      ? t
          .split(/\s*[|｜]\s*/)
          .map(tidy)
          .filter(Boolean)
      : [];
  /**
   * 像镜头的一段：以「N 万像素 / N 亿像素」开头，并且**冒号前**的镜头名是个镜头称呼。
   * 注意三处坑：
   *   · 不能用 parseLens 内部砍过冒号的结果来判断 —— `4800 万像素融合式主摄：26 毫米焦距…`
   *     砍掉冒号后只剩「4800 万像素融合式主摄」，会丢掉判据；
   *   · 关键词要同时收「主摄/超广角/长焦/潜望/微距/摄像头/镜头」——苹果写「融合式主摄」，
   *     不写「摄像头」，只测「摄像头|镜头」会漏掉所有苹果镜头行；
   *   · 数字与「万像素」之间可能是全角空格 U+3000（`5000　万像素摄像头`），`\s` 认它。
   */
  const lensName = (s) => String(s).split(/[:：]/)[0];
  /**
   * 像镜头的一段，必须同时满足：
   *   ① 去掉「同时支持」这类前缀后，以「N 万像素 / N 亿像素」开头；
   *   ② **冒号前**的镜头称呼里含主摄/超广角/长焦/潜望/微距/摄像头/镜头 —— 判据只看冒号前，
   *      这样 `4800 万像素微距摄影`（冒号前没有镜头称呼，是「微距摄影」功能项）不会混进来，
   *      而 `1200 万像素 2 倍长焦功能：52 毫米焦距…` 会。
   *   ③ 不是系统名（`…摄像头系统` / `…双摄系统`）—— 系统名只是把像素数当修饰语。
   * 判据取自官网真实写法，逐条核对过 13 台苹果机型。
   */
  const looksLikeLens = (s) => {
    const body = String(s).replace(/^(同时支持|还支持|支持)\s*/, '');
    if (!/^[\d.]+\s*[亿万]像素/.test(body)) return false;
    const name = lensName(body);
    if (/(摄像头系统|双摄系统|三摄系统|镜头系统|摄影|摄像)$/.test(name)) return false;
    return /(摄像头|镜头|主摄|超广角|长焦|潜望|微距|广角)/.test(name);
  };
  /**
   * 镜头清单行的判定。难点在于苹果把「镜头 + 一整串拍摄功能」塞在同一行：
   *   `先进的双摄系统 | 4800 万像素融合式主摄：… | 1200 万像素超广角：… | 最高可达 10 倍数码变焦 | 相机控制 | …`
   * 一行 25 段里常只有 2–4 段是镜头，所以「镜头占多数」这类比例判据必然失败。
   * 判据改为**存在性**：一行里至少有 2 段像镜头 —— 介绍段落最多命中 1 段。
   * （单摄机型 iPhone Air / 17e 的第二段写成「同时支持 1200 万像素…长焦功能：…」，同样命中。）
   */
  const realLensSegs = (t) => lensSegs(t).filter(looksLikeLens);
  const lensRow = camRows.find((t) => realLensSegs(t).length >= 2) ?? '';
  const rear = realLensSegs(lensRow).map((s) => parseLens(s));
  rec.camera.rear = rear;
  /**
   * 光圈：有的页面把光圈写在镜头清单行内（`4800 万像素融合式超广角：13 毫米焦距，ƒ/2.2 光圈…`），
   * 有的单独成行（`ƒ/1.48、ƒ/1.8、ƒ/2.8、ƒ/4.0 或 ƒ/1.78`）。两处都试，缺哪个补哪个。
   * 注意官网的斜杠有三种写法：`ƒ/1.6`、`ƒ／1.6`(全角)、`ƒ1.6`，正则必须都能吃。
   */
  if (lensRow) {
    const segs = realLensSegs(lensRow);
    rear.forEach((cam, i) => {
      if (cam.aperture) return;
      const ap = segs[i] ? parseAperture(segs[i]) : null;
      if (ap) cam.aperture = ap;
    });
  }
  if (rear.some((c) => !c.aperture)) {
    const apLine = camRows.find((t) => t !== lensRow && /光圈/.test(t) && /[ƒf][\s/／]*\d/.test(t));
    const ap = apLine ? parseAperture(apLine) : null;
    if (ap) for (const cam of rear) if (!cam.aperture) cam.aperture = ap;
  }
  // 防抖单独成行（`… (融合式主摄) | … (融合式长焦)`），按括号里的镜头名逐条翻 ois。
  // 整行镜头清单本身不算「防抖行」——那会把所有镜头都翻成 true。
  const oisLine =
    camRows.find((t) => /防抖/.test(t) && t !== lensRow && /[|｜]/.test(t) && t.length < 200) ??
    camRows.filter((t) => /防抖/.test(t) && t !== lensRow && t.length < 200)[0] ??
    '';
  if (oisLine && rear.length) {
    const roleKeys = {
      main: /主摄/,
      ultrawide: /超广角/,
      tele: /长焦/,
      periscope: /潜望/,
      macro: /微距/,
    };
    for (const cam of rear) {
      if (cam.ois === false) continue;
      cam.ois = roleKeys[cam.role] ? roleKeys[cam.role].test(oisLine) : true;
    }
    rear[0].sensorNote = [rear[0].sensorNote, `防抖原文：${tidy(oisLine)}`]
      .filter(Boolean)
      .join('；');
  }

  const frontRows = apRows(raw, '前置摄像头').map((x) => x.value);
  const frontMp = frontRows.find((t) => /万像素/.test(t));
  const frontAperture = frontRows.find((t) => /光圈/.test(t));
  rec.camera.front =
    frontMp || frontAperture
      ? {
          mp: frontMp ? (parseLens(frontMp).mp ?? null) : null,
          aperture: frontAperture ? parseAperture(frontAperture) : null,
        }
      : null;
  rec.camera.videoMax = parseVideoMax(apBlob(raw, '视频拍摄', ' | '));

  /* ---- 连接与系统 ------------------------------------------------------ */
  const cellRows = apRows(raw, '蜂窝网络和无线连接').map((x) => x.value);
  const cell = cellRows.join(' | ');
  const nfcLine = cellRows.find((t) => /NFC/.test(t));
  rec.connectivity.fiveG = /5G|NR/.test(cell) ? true : null;
  rec.connectivity.wifi =
    (cell.match(/(?:802\.11\w+|Wi-?Fi)[^|｜，,；;]*/) ?? [])[0]?.trim() ?? null;
  rec.connectivity.bluetooth = (cell.match(/蓝牙\s*[\d.]+/) ?? [])[0] ?? null;
  // 「不支持 NFC」包含「NFC」子串，必须先排除否定写法再判肯定（与华为侧同一条纪律）
  rec.connectivity.nfc = nfcLine ? (!/不支持/.test(nfcLine) && /NFC/.test(nfcLine)) : null;
  rec.connectivity.satellite = null; // 苹果规格页无卫星通信章节 → null，不凭「SOS 紧急联络」推断
  rec.connectivity.usb = apBlob(raw, '充电和外设扩展', ' | ') || null;
  rec.connectivity.sim = tidy(apBlob(raw, 'SIM 卡', ' | ')) || null;
  rec.connectivity.esim = rec.connectivity.sim ? /eSIM/i.test(rec.connectivity.sim) : null;

  const osText = apBlob(raw, '操作系统');
  const osVer = osText.match(/iOS\s*[\d.]+/i);
  rec.os.launch = osVer ? osVer[0] : null; // 只写「iOS」没有版本号 → null，不把品牌名当版本号
  rec.os.upgradableTo = null; // 官网规格页不给「可升级到」→ null

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(rec, '尺寸与重量', dimText);
  pushOfficial(rec, '显示屏', dispJoin);
  pushOfficial(rec, '芯片', chipRows.join(' | '));
  pushOfficial(rec, '容量', capacityRows.join(' | '));
  pushOfficial(rec, '电源和电池', battJoin);
  pushOfficial(rec, '摄像头', camRows.slice(0, 2).join(' | '));
  pushOfficial(rec, '前置摄像头', frontRows.slice(0, 2).join(' | '));
  pushOfficial(rec, '防溅、抗水、防尘', ipText);
  pushOfficial(rec, '蜂窝网络和无线连接', cell);
  pushOfficial(rec, 'MagSafe 和无线充电', magsafe);

  /* ---- provenance ------------------------------------------------------ */
  const ap = AP;
  put(rec, 'body.heightMm', rec.body.heightMm, ap);
  put(rec, 'body.widthMm', rec.body.widthMm, ap);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, ap);
  put(rec, 'body.weightG', rec.body.weightG, ap);
  put(rec, 'body.ipRating', rec.body.ipRating, ap);
  put(rec, 'body.material', rec.body.material, ap);
  put(rec, 'body.colors', rec.body.colors, ap);
  put(rec, 'display.sizeIn', rec.display.sizeIn, ap);
  put(rec, 'display.type', rec.display.type, ap);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, ap, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, declaredPpi !== null ? ap : 'derived');
  put(rec, 'display.refreshHz', rec.display.refreshHz, ap);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, ap);
  put(rec, 'display.brightnessPeakNits', rec.display.brightnessPeakNits, ap);
  put(rec, 'display.protection', rec.display.protection, ap);
  put(rec, 'chipset.name', rec.chipset.name, ap);
  put(rec, 'chipset.cpuCores', rec.chipset.cpuCores, ap);
  put(rec, 'chipset.gpu', rec.chipset.gpu, ap);
  put(rec, 'chipset.npu', rec.chipset.npu, ap);
  put(rec, 'memory.storageGb', rec.memory.storageGb, ap);
  put(rec, 'battery.vendorClaimedVideoHours', rec.battery.vendorClaimedVideoHours, ap);
  put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, ap);
  put(rec, 'camera.rear', rec.camera.rear, ap);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, ap);
  put(rec, 'camera.videoMax', rec.camera.videoMax, ap);
  for (const k of ['fiveG', 'wifi', 'bluetooth', 'nfc', 'satellite', 'usb', 'sim', 'esim']) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], ap);
  }
  put(rec, 'os.launch', rec.os.launch, ap);
  addNote(
    rec,
    '苹果官网从不公布电池容量(mAh)、RAM 与有线充电峰值功率 → 对应字段为 null，属官网真没有',
  );
  return rec;
}

/* ---------- C: 苹果对比页矩阵（粒度更粗，只补空缺） ---------- */

function mapAppleCompare(rawProduct) {
  const raw = rawProduct.raw;
  const name = stripInvisible(rawProduct.name);
  const rec = emptyRecord({
    id: rawProduct.id,
    brand: 'apple',
    line: 'iPhone',
    name,
    nameZh: null,
    granularity: 'compare-matrix',
    firstSeenAt: rawProduct.extractedAt,
    lastSeenAt: rawProduct.extractedAt,
  });
  const matrix = FirstRaw(raw);

  /* ---- 尺寸与重量 ------------------------------------------------------ */
  const seg = {
    height: '尺寸与重量.高度',
    width: '尺寸与重量.宽度',
    thickness: '尺寸与重量.厚度',
    weight: '尺寸与重量.重量',
  };
  rec.body.heightMm = parseMm(realValue(matrix[seg.height]) ?? '');
  rec.body.widthMm = parseMm(realValue(matrix[seg.width]) ?? '');
  rec.body.thicknessMm = parseMm(realValue(matrix[seg.thickness]) ?? '');
  const weight = parseWeight(realValue(matrix[seg.weight]) ?? '');
  rec.body.weightG = weight.value;
  if (weight.note) addNote(rec, `重量原文「${tidy(matrix[seg.weight])}」：${weight.note}`);

  const ipText = apBlob(raw, '防溅、抗水、防尘');
  const ip = ipText.match(/IP\s?\d{2}/i);
  rec.body.ipRating = ip ? ip[0].replace(/\s/g, '').toUpperCase() : null;
  const colorLine = apFirst(raw, '外观.颜色导航');
  if (colorLine)
    rec.body.colors = colorLine
      .split(/\s*[|｜]\s*/)
      .map(tidy)
      .filter(Boolean);
  rec.body.material = apFirst(raw, '速览.设计：材料') ?? null;

  /* ---- 屏幕 ------------------------------------------------------------ */
  const dispRows = apRows(raw, '显示屏').map((x) => x.value);
  const dispJoin = dispRows.join(' | ');
  const sizeLine =
    dispRows.find((t) => /英寸/.test(t) && /对角线/.test(t)) ??
    dispRows.find((t) => /英寸/.test(t) && /OLED|全面屏/.test(t)) ??
    dispRows.find((t) => /英寸/.test(t));
  rec.display.sizeIn = sizeLine
    ? parseInch(sizeLine)
    : parseInch(apFirst(raw, '速览.显示屏：屏幕尺寸') ?? '');
  // 矩阵的 `显示屏` 首行是「超视网膜 XDR 显示屏」（不带面板技术），
  // 面板技术写在第二行「6.3 英寸 (对角线) OLED 全面屏」里 → 优先取带面板技术的那一行。
  const typeLine = dispRows.find((t) => /OLED|LTPO|LCD/.test(t)) ?? dispJoin;
  const typeMatch = typeLine.match(
    /(超视网膜 XDR 显示屏|超视网膜显示屏|LTPO[^，,|｜()]*|OLED 可折叠全面屏|OLED 全面屏|OLED)/,
  );
  rec.display.type = typeMatch ? normalizeType(typeMatch[1]) : null;
  rec.display.resolutionPx = pickFirstRes(dispRows);
  const declaredPpi = (() => {
    const m =
      dispJoin
        .replace(/,/g, '')
        .match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*像素分辨率[，,]?\s*(\d+(?:\.\d+)?)\s*ppi/i) ??
      dispJoin.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*ppi/i);
    return m ? Number(m[m.length - 1]) : null;
  })();
  rec.display.ppi = declaredPpi ?? derivePpi(rec.display.sizeIn, rec.display.resolutionPx);
  if (declaredPpi === null && rec.display.ppi !== null) {
    addNote(rec, '矩阵未直接给出 ppi；display.ppi 由官网的分辨率与屏幕尺寸推得，来源记 derived');
  }
  rec.display.refreshHz = refreshText(apFind(raw, '显示屏', /Hz/i) ?? '');
  const peakVals = [];
  const typVals = [];
  for (const line of dispRows.filter((t) => /尼特/.test(t))) {
    for (const m of line.matchAll(
      /(\d[\d,]*)\s*尼特\s*(?:峰值亮度|最大亮度)?\s*(?:\(([^)]*)\)|（([^）]*)）)?/g,
    )) {
      const val = Number(m[1].replace(/,/g, ''));
      const qual = m[2] ?? m[3] ?? '';
      if (/峰值|HDR|户外/.test(qual) || /峰值/.test(m[0])) peakVals.push(val);
      else if (/典型/.test(qual) || /典型/.test(m[0])) typVals.push(val);
    }
  }
  rec.display.brightnessPeakNits = peakVals.length ? Math.max(...peakVals) : null;
  rec.display.brightnessTypicalNits = typVals.length ? Math.max(...typVals) : null;
  if (
    rec.display.brightnessPeakNits !== null &&
    rec.display.brightnessTypicalNits !== null &&
    rec.display.brightnessPeakNits < rec.display.brightnessTypicalNits
  ) {
    addNote(rec, '峰值亮度 < 典型亮度，口径解析可能串位，两者已置 null');
    rec.display.brightnessPeakNits = null;
    rec.display.brightnessTypicalNits = null;
  }
  rec.display.protection = apFind(raw, '速览', /超瓷晶/) ?? null;

  /* ---- 芯片 ------------------------------------------------------------ */
  const chipRows = apRows(raw, '芯片').map((x) => x.value);
  rec.chipset.name = chipRows.find((t) => /芯片$/.test(t)) ?? null;
  const cpuLine = chipRows.find((t) => /中央处理器/.test(t));
  rec.chipset.cpuCores = cpuLine ? firstNum(cpuLine) : null;
  rec.chipset.gpu = chipRows.find((t) => /图形处理器/.test(t)) ?? null;
  rec.chipset.npu = chipRows.find((t) => /神经网络引擎/.test(t)) ?? null;

  /* ---- 容量 ------------------------------------------------------------ */
  rec.memory.storageGb = parseStorageList(
    apRows(raw, '容量')
      .map((x) => x.value)
      .filter((t) => !/不适用/.test(t))
      .join(' | '),
  );

  /* ---- 电池与续航 ------------------------------------------------------ */
  const videoLine = apFind(raw, '电源和电池', /视频播放/) ?? apFind(raw, '速览', /视频播放/);
  if (videoLine) {
    rec.battery.vendorClaimedVideoHours = firstNum(
      (videoLine.match(/最长可达\s*(\d+(?:\.\d+)?)\s*小时/) ?? [])[1] ?? '',
    );
  }
  const fastLine = apFind(raw, '电源和电池', /可快速充电|充至 50%/);
  if (fastLine) {
    addNote(
      rec,
      `矩阵只给出「${tidy(fastLine)}」——其中瓦数是**电源适配器要求**，不是手机有线充电峰值功率，` +
        '故 battery.wiredChargeW 记 null',
    );
  }
  const wirelessLine =
    apFind(raw, '电源和电池', /无线充电/) ?? apFirst(raw, '速览.MagSafe: Wireless Charging');
  rec.battery.wirelessChargeW = wattOf(wirelessLine ?? '');

  /* ---- 影像 ------------------------------------------------------------ */
  const camRows = apRows(raw, '摄像头').map((x) => x.value);
  // 矩阵的镜头行形如 `4800 万像素融合式主摄 | 4800 万像素融合式超广角 | 4800 万像素融合式长焦`：
  // 每一段都必须以像素数开头，否则不是镜头清单（`摄像头(3)` 那类防抖行会被排除）。
  const lensRow =
    camRows.find((t) => {
      if (!/[|｜]/.test(t)) return false;
      const segs = t
        .split(/\s*[|｜]\s*/)
        .map(tidy)
        .filter(Boolean);
      return segs.length >= 2 && segs.every((s) => /^[\d.]+\s*[亿万]/.test(s));
    }) ?? '';
  rec.camera.rear = lensRow
    ? lensRow
        .split(/\s*[|｜]\s*/)
        .map(tidy)
        .filter((t) => /万像素|亿像素/.test(t))
        .map((t) => parseLens(t))
    : [];
  const oisLine = camRows.find(
    (t) => /防抖/.test(t) && t !== lensRow && /[（(]/.test(t) && t.length < 200,
  );
  if (oisLine && rec.camera.rear.length) {
    const roleKeys = {
      main: /主摄/,
      ultrawide: /超广角/,
      tele: /长焦/,
      periscope: /潜望/,
      macro: /微距/,
    };
    for (const cam of rec.camera.rear) {
      if (cam.ois === false) continue;
      cam.ois = roleKeys[cam.role] ? roleKeys[cam.role].test(oisLine) : true;
    }
    rec.camera.rear[0].sensorNote = [rec.camera.rear[0].sensorNote, `防抖原文：${tidy(oisLine)}`]
      .filter(Boolean)
      .join('；');
  }
  const frontMp = apFind(raw, '前置摄像头', /万像素/);
  rec.camera.front = frontMp ? { mp: parseLens(frontMp).mp ?? null, aperture: null } : null;
  rec.camera.videoMax = parseVideoMax(apBlob(raw, '视频拍摄', ' | '));

  /* ---- 连接与系统 ------------------------------------------------------ */
  const cell = apBlob(raw, '蜂窝网络和无线连接', ' | ');
  rec.connectivity.fiveG = /5G|NR/.test(cell) ? true : null;
  rec.connectivity.wifi =
    (cell.match(/(?:802\.11\w+|Wi-?Fi)[^|｜，,；;]*/) ?? [])[0]?.trim() ?? null;
  rec.connectivity.bluetooth = (cell.match(/蓝牙\s*[\d.]+/) ?? [])[0] ?? null;
  rec.connectivity.nfc = /NFC/.test(cell) ? true : null;
  rec.connectivity.satellite = null;
  rec.connectivity.usb = apBlob(raw, '连接端口', ' | ') || apFirst(raw, '速览.连接') || null;
  rec.connectivity.sim = tidy(apBlob(raw, 'SIM 卡', ' | ')) || null;
  rec.connectivity.esim = rec.connectivity.sim ? /eSIM/i.test(rec.connectivity.sim) : null;
  rec.os.launch = null; // 矩阵无操作系统行
  rec.os.upgradableTo = null;

  // 矩阵的价格行是 JS 注入模板（{IPHONExxx}）或「于授权经销商处有售」→ 不收价格
  rec.skus = [];
  addNote(rec, '该机型官网已无独立规格页，数据来自对比页矩阵（粒度更粗，字段更少）');
  addNote(
    rec,
    '苹果官网从不公布电池容量(mAh)、RAM 与有线充电峰值功率 → 对应字段为 null，属官网真没有',
  );

  /* ---- 官网原文节选 ---------------------------------------------------- */
  pushOfficial(
    rec,
    '尺寸与重量',
    ['尺寸与重量.高度', '尺寸与重量.宽度', '尺寸与重量.厚度', '尺寸与重量.重量']
      .map((k) => realValue(raw[k]))
      .filter(Boolean)
      .join(' | '),
  );
  pushOfficial(rec, '显示屏', dispJoin);
  pushOfficial(rec, '芯片', apBlob(raw, '芯片', ' | '));
  pushOfficial(rec, '容量', apBlob(raw, '容量', ' | '));
  pushOfficial(rec, '电源和电池', apBlob(raw, '电源和电池', ' | '));
  pushOfficial(rec, '摄像头', apBlob(raw, '摄像头', ' | ').slice(0, 400));
  pushOfficial(rec, '前置摄像头', apBlob(raw, '前置摄像头', ' | ').slice(0, 300));
  pushOfficial(rec, '防溅、抗水、防尘', ipText);
  pushOfficial(rec, '蜂窝网络和无线连接', cell);

  /* ---- provenance ------------------------------------------------------ */
  put(rec, 'body.heightMm', rec.body.heightMm, AC);
  put(rec, 'body.widthMm', rec.body.widthMm, AC);
  put(rec, 'body.thicknessMm', rec.body.thicknessMm, AC);
  put(rec, 'body.weightG', rec.body.weightG, AC);
  put(rec, 'body.ipRating', rec.body.ipRating, AC);
  put(rec, 'body.material', rec.body.material, AC);
  put(rec, 'body.colors', rec.body.colors, AC);
  put(rec, 'display.sizeIn', rec.display.sizeIn, AC);
  put(rec, 'display.type', rec.display.type, AC);
  putObject(rec, 'display.resolutionPx', rec.display.resolutionPx, AC, ['w', 'h']);
  put(rec, 'display.ppi', rec.display.ppi, declaredPpi !== null ? AC : 'derived');
  put(rec, 'display.refreshHz', rec.display.refreshHz, AC);
  put(rec, 'display.brightnessTypicalNits', rec.display.brightnessTypicalNits, AC);
  put(rec, 'display.brightnessPeakNits', rec.display.brightnessPeakNits, AC);
  put(rec, 'display.protection', rec.display.protection, AC);
  put(rec, 'chipset.name', rec.chipset.name, AC);
  put(rec, 'chipset.cpuCores', rec.chipset.cpuCores, AC);
  put(rec, 'chipset.gpu', rec.chipset.gpu, AC);
  put(rec, 'chipset.npu', rec.chipset.npu, AC);
  put(rec, 'memory.storageGb', rec.memory.storageGb, AC);
  put(rec, 'battery.vendorClaimedVideoHours', rec.battery.vendorClaimedVideoHours, AC);
  put(rec, 'battery.wirelessChargeW', rec.battery.wirelessChargeW, AC);
  put(rec, 'camera.rear', rec.camera.rear, AC);
  put(rec, 'camera.front.mp', rec.camera.front?.mp ?? null, AC);
  put(rec, 'camera.videoMax', rec.camera.videoMax, AC);
  for (const k of ['fiveG', 'wifi', 'bluetooth', 'nfc', 'satellite', 'usb', 'sim', 'esim']) {
    put(rec, `connectivity.${k}`, rec.connectivity[k], AC);
  }

  return rec;
}
/** 对比页矩阵里，`尺寸与重量.*` 这类平铺键直接读；组内序号键按序拼 */
function FirstRaw(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = realValue(v);
    if (t !== undefined && !(k in out)) out[k] = t;
  }
  return out;
}

export { mapAppleSpecs, mapAppleCompare, APPLE_SHARED_MARK };
