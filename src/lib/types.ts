/**
 * 手机参数站的数据契约。
 *
 * 这份类型是 `docs/DATA-CONTRACT.md` 的代码镜像，两边必须同时改。
 * 管线（scripts/）写入的对象与前端读取的对象都以此为准。
 *
 * 三条铁律：
 *   1. 拿不到的字段写 null，绝不写 0、'-'、平均值或估算值；
 *   2. 每个数值型规格字段都要能回答「什么口径」（典型值/峰值/实测）；
 *   3. 成绩只以「分榜」形式存在，任何把两个 league 合成一个数的做法都是错的。
 */

export type BrandId = 'apple' | 'huawei';

export type SourceId =
  | 'apple-official' // 苹果官网·规格页（最细，35 个章节）
  | 'apple-compare' // 苹果官网·对比页矩阵（较粗，22 组 103 行；用于规格页已下线的机型）
  | 'huawei-official'
  | 'geekbench-browser'
  | 'dxomark'
  | 'manual'
  | 'derived';

/**
 * 这台机器的数据来自哪一层官网页面。
 * 苹果侧必须区分：规格页给 35 个章节，对比页矩阵只有 22 组，
 * **同一台机器用不同粒度拿到的字段数不一样**，界面要如实标注，否则用户会以为「官网没有」。
 */
export type Granularity = 'specs-page' | 'compare-matrix';

/** 数值口径。缺了它，这个数就不可比 */
export type Caliber =
  | 'typical' // 典型值（电池）
  | 'rated' // 额定值
  | 'peak' // 峰值（亮度/充电功率）
  | 'sustained' // 持续
  | 'vendor-claimed' // 厂商自报
  | 'measured'; // 第三方实测

export interface BenchScore {
  /** 分榜 id，如 geekbench6-multi。跨 league 永不合并 */
  league: string;
  score: number;
  unit: 'score' | 'points' | 'hours' | 'watt' | 'nits' | 'pct';
  source: string;
  sourceUrl: string | null;
  measuredAt: string | null;
  attribution: 'third-party' | 'vendor-self-reported';
  /** 测试条件：系统版本、室温、亮度设定等 */
  caliber: string | null;
}

export interface Sku {
  storageGb: number;
  ramGb: number | null;
  /** 官方指导价（人民币）。未公布/已停售写 null */
  priceCny: number | null;
  /** 「首发价」「现价」「促销价」必须区分，否则价格不可比 */
  priceNote: string | null;
  /** 这个价格采集于哪一天 —— 缺了它价格不可比 */
  listedAt: string;
}

export interface Camera {
  role: 'main' | 'ultrawide' | 'tele' | 'periscope' | 'macro' | 'depth';
  mp: number | null;
  aperture: string | null;
  ois: boolean | null;
  sensorNote: string | null;
}

export interface ProductRecord {
  id: string;
  slug: string;
  brand: BrandId;
  /** 产品线：iPhone / Mate / Pura / nova / Mate X */
  line: string;
  name: string;
  nameZh: string | null;

  releaseDate: string | null;
  releaseDatePrecision: 'day' | 'month' | 'year' | null;
  status: 'upcoming' | 'on-sale' | 'discontinued';
  retiredAt: string | null;

  body: {
    heightMm: number | null;
    widthMm: number | null;
    thicknessMm: number | null;
    weightG: number | null;
    ipRating: string | null;
    material: string | null;
    colors: string[];
    /** 折叠屏专用。非折叠机为 null */
    folded: { thicknessMm: number | null; heightMm: number | null } | null;
  };

  display: {
    sizeIn: number | null;
    type: string | null;
    resolutionPx: { w: number; h: number } | null;
    ppi: number | null;
    refreshHz: string | null;
    /** 典型亮度与峰值亮度永远分列，不合成一个「最高亮度」 */
    brightnessTypicalNits: number | null;
    brightnessPeakNits: number | null;
    protection: string | null;
  };

  chipset: {
    name: string | null;
    processNm: number | null;
    cpuCores: number | null;
    gpu: string | null;
    npu: string | null;
  };

  memory: {
    ramGb: number[];
    storageGb: number[];
  };

  battery: {
    capacityMah: number | null;
    capacityCaliber: Extract<Caliber, 'typical' | 'rated'> | null;
    wiredChargeW: number | null;
    wirelessChargeW: number | null;
    /** 厂商自报续航（小时），与第三方实测分列 */
    vendorClaimedVideoHours: number | null;
    measuredHours: number | null;
  };

  camera: {
    rear: Camera[];
    front: { mp: number | null; aperture: string | null } | null;
    videoMax: string | null;
  };

  connectivity: {
    fiveG: boolean | null;
    wifi: string | null;
    bluetooth: string | null;
    nfc: boolean | null;
    satellite: string | null;
    usb: string | null;
    sim: string | null;
    esim: boolean | null;
  };

  os: {
    launch: string | null;
    upgradableTo: string | null;
  };

  skus: Sku[];
  scores: BenchScore[];

  /** 数据粒度：规格页还是对比页矩阵。苹果侧两条通道并存，必须标出来 */
  granularity: Granularity;

  /** 键 = 字段路径（如 'battery.capacityMah'），值 = 来源 */
  provenance: Record<string, SourceId>;
  /** 首次进入快照 / 最后确认存在的时间 */
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VendorRecord {
  id: BrandId;
  name: string;
  nameZh: string;
  accentColor: string;
  /** 品牌馆的像素主题 */
  motif: string;
  country: string;
}

export interface Snapshot {
  generatedAt: string;
  /** 各来源本轮抓取情况，供排查用；前端不读 */
  sources: Record<string, { fetchedAt: string | null; note: string; ok: boolean }>;
  vendors: VendorRecord[];
  products: ProductRecord[];
}

/* ------------------------------------------------------------------ */
/* 派生层：由契约字段算出，不落盘                                            */
/* ------------------------------------------------------------------ */

/** 分位池的键：同一池内的数字才允许互相比较 */
export type PoolKey = `${string}::${string}`;

export interface ProductDerived {
  /** 出现在榜单/首页头衔里的档位，全部是「当前在售池」内的分位 */
  perfPercentile: number | null;
  pricePercentile: number | null;
  lightnessPercentile: number | null;
  screenPercentile: number | null;
  batteryPercentile: number | null;
  chargePercentile: number | null;
  valueScore: number | null;
  /** 降级标记：用了替代指标算出来的档位必须在界面上可见 */
  degraded: string[];
}
