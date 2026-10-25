# 全品类字段蓝图（Universal Field Blueprint）

> 来源：借鉴 **准绳 / Baseline（鸿蒙原生参数对比 App，`C:\aiwork\B`）** 的 `全品类参数子模板.csv` 与 `baseline-db-format-spec.md`。
> 用途：specworld 要覆盖「全品类」，这份蓝图是**字段设计的母本**——新增品类时先查这里有没有现成槽位，
> 不要凭空拍脑袋。它与 `data/schemas/phone.json`（已落地的手机字段表）是「母本 → 实例」关系。
>
> 约定：**✅** = 已在 `data/schemas/phone.json` 落地；**📱** = 手机通常有、手机 schema 暂未收录（待补）；其余为其他品类槽位。
>
> **范围定义（全品类 = 所有可量化产品）**：第一阶覆盖所有**用电 / 与电相关**的电子产品；第二阶扩展到**非电但可量化**的实物（如行李箱：尺寸 / 重量 / 材质，小米有此品类）。两者共用同一套字段表 + 四态机制，非电品类把电子专属分组标 `not_applicable` 即可。非电品类落地示例见文末「附录 A」。

---

## 0. 设计原则（从准绳继承的铁律）

1. **参数与品类解耦**：字段按品类 schema 声明，新增品类 = `categories.json` 加一行 + `schemas/<id>.json` 加字段表，**管线/闸门/前端零代码分支**。
2. **四态 `valueStatus`**（借鉴准绳 `value_status`）：
   - `available`（有值）/ `unknown`（官方未公布，显示「—」）/ `none`（该机型确实没有，显示「无」）/ `not_applicable`（本品类不适用，跨品类时**整行隐藏**）。
   - 产品侧只显式存 `none` / `not_applicable` 例外（键名 `valueStatus`，与生命周期 `status` 分开），其余靠 specs 是否存在推导。
3. **显式分组**：每个 schema 带 `groups`（单值/多实例 + `guide`），前端分面与详情分组直接吃，不再从 `path` 前缀隐式猜。
4. **单位不互换算**：色域 sRGB / DCI-P3 分字段；电池 Wh 与 mAh 分字段；存储 TB×1024→GB 但**展示仍分列**。
5. **忠实限定词**：官网写「约 1.12kg」就保留「约」，不写成 `1.12kg`；「最长约 15 小时」不写成 `15 小时`。
6. **来源优先级**：① 官网规格页 ② 说明书/包装 ③ 京东天猫详情页 ④ 第三方评测 ⑤ 用户贡献。只录一个值（不写范围），录官方不录实测。

---

## 1. 全品类 16 分组总览

| # | 分组（中文） | 分组（英文） | 类型 | 主要覆盖品类 |
|---|------|------|------|------|
| 1 | 基本信息 | Basic Info | 单值 | 全品类通用 |
| 2 | 外观与物理规格 | Appearance & Physical | 单值 | 全品类 |
| 3 | 屏幕显示 | Display | 单值 | 手机/平板/电视/显示器/笔记本 |
| 4 | 处理器与性能 | Processor & Performance | 单值 | 手机/笔记本/平板/电视 |
| 5 | 内存 | Memory | 单值 | 手机/笔记本/平板 |
| 6 | 存储 | Storage | 单值 | 手机/笔记本/平板/电视 |
| 7 | 显卡 | Graphics | 单值 | 笔记本/显示器（电视含 SoC） |
| 8 | 摄像头 | Camera | **多实例** | 手机/平板/笔记本 |
| 9 | 音频 | Audio | 单值 | 手机/电视/笔记本 |
| 10 | 网络与通信 | Network & Connectivity | 单值 | 手机/平板/笔记本 |
| 11 | 接口 | Ports & Interfaces | **多实例** | 笔记本/手机/电视/显示器 |
| 12 | 电池与电源 | Battery & Power | 单值 | 手机/笔记本/平板 |
| 13 | 传感器 | Sensors | **多实例** | 手机/平板/笔记本 |
| 14 | 软件与系统 | Software & System | 单值 | 全品类 |
| 15 | 功能特性 | Features | 单值 | 全品类 |
| 16 | 能耗与容量 | Energy & Capacity | 单值 | 冰箱/洗衣机/空调/显示器 |

> **通用分组 vs 电子专属分组**：① 基本信息 / ② 外观与物理规格 是**全品类通用**（行李箱也吃尺寸/重量/材质）；③–⑬（屏幕/处理器/内存/存储/显卡/摄像头/音频/网络/接口/电池/传感器）是**电子专属**，非电品类（行李箱）整组标 `not_applicable` → 跨品类对比时整行隐藏；⑭ 软件 / ⑮ 功能 / ⑯ 能耗 视品类部分复用或标不适用。这种「结构性不适用 ≠ 缺数据」的区分，正是四态设计的意义。

> **多实例分组**（准绳 `group_type='多实例'`）：一个产品在该组下可有多个值（摄像头：前置+后置；接口：多个 USB/HDMI；传感器：列表）。
> specworld 当前用 `array:object` / `array:string` 表达（如 `camera.rear` 是对象数组，`body.colors` 是字符串数组）。

---

## 2. 分组 × 参数槽明细

### 1. 基本信息（Basic Info · 单值）
> 注：**品牌 / 型号名称 / 型号代码 / 产品名称 / 上市时间 / 状态 都是顶层身份字段**，不进 `specs` 分组容器（身份不参与参数比较）。
> 其中**品牌名**由 `vendors` 注册表按 `brand` slug 派生（单一真源 scripts/brands.mjs，不重复存）；
> **型号名称** = `name`（已有）；**型号代码** = `modelCode`（新增，监管/硬件型号如 `MRT-AL10`/`A3292`）。
> 例：HUAWEI nova 14 Ultra → `name`='nova 14 Ultra'（型号名称）、`modelCode`='MRT-AL10'（型号代码）、`line`='nova'（产品线）。三者对所有品类通用，行李箱也吃。

| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 上市时间 | 单值 | 全 | `releaseDate`（顶层身份字段） | 忠实保留年份/季度 |
| 产品名称（型号名称） | 单值 | 全 | `name`（顶层，即型号名称） | 官方全称，如 `nova 14 Ultra` / `iPhone 16 Pro` |
| 型号代码 | 单值 | 全 | `modelCode`（顶层身份字段，已新增，可选） | 监管/硬件型号，如 `MRT-AL10` / `A3292`；官方来源填充，不编造 |
| 产品定位 | 单值 | 全 | `positioning` | 轻薄/游戏/商务等（手机暂未收录 📱） |
| 价格 | 单值 | 全 | `skus[].priceCny`（已落地 SKU） | 比对第一轴，建议新增字段 |
| 品牌 | 单值 | 全 | `brand`（顶层 slug）+ 品牌名由 `vendors` 注册表派生 | 显示名单一真源，不重复存 |
| 状态 | 单值 | 全 | `status`（顶层生命周期，🟢在售/🟡停产/🔴历史） | 与四态 `valueStatus` 不同字段 |
| 颜色 | 单值 | 全 | `body.colors` ✅ | 多色用、分隔 |

### 2. 外观与物理规格（Appearance & Physical · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 厚度 | 单值 | 全 | `body.thicknessMm` ✅ | |
| 尺寸 | 单值 | 全 | `body.heightMm`/`body.widthMm` ✅ | 长×宽×高 |
| 材质 | 单值 | 全 | `body.material` ✅ | 金属/塑料/玻璃 |
| 重量 | 单值 | 全 | `body.weightG` ✅ | 保留约/典型值 |

### 3. 屏幕显示（Display · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| HDR | 单值 | 电视/手机 | `display.hdr` 📱 | |
| 亮度 | 单值 | 全 | `display.brightnessTypicalNits`/`brightnessPeakNits` ✅ | nit，保留典型值 |
| 分辨率 | 单值 | 全 | `display.resolutionPx` ✅ | |
| 刷新率 | 单值 | 全 | `display.refreshHz` ✅ | 字符串保留区间语义 |
| 响应时间 | 单值 | 显示器/电视 | `display.responseTimeMs` | 电竞相关 |
| 对比度 | 单值 | 电视/显示器 | `display.contrast` | |
| 屏占比 | 单值 | 全 | `display.screenToBody` | |
| 屏幕尺寸 | 单值 | 全 | `display.sizeIn` ✅ | |
| 屏幕类型 | 单值 | 全 | `display.type` ✅ | LCD/OLED/Mini-LED |
| 色域 | 单值 | 全 | `display.colorGamut` 📱 | sRGB/P3 分字段不互换算 |
| 触控 | 单值 | 全 | `display.touch` 📱 | 支持/不支持 |
| 调光方式 | 单值 | 全 | `display.dimmin` 📱 | PWM/DC，护眼相关 |
| 像素密度 | 单值 | 全 | `display.ppi` ✅ | |

### 4. 处理器与性能（Processor & Performance · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 三级缓存 | 单值 | 笔记本 | `chipset.l3CacheMb` 📱 | |
| 主频 | 单值 | 全 | `chipset.baseFreqGhz` 📱 | |
| 制程工艺 | 单值 | 全 | `chipset.processNm` ✅ | |
| 处理器型号 | 单值 | 全 | `chipset.name` ✅ | |
| 处理器架构 | 单值 | 全 | `chipset.arch` 📱 | x86/ARM，跨品类比对轴 |
| 最高频率 | 单值 | 全 | `chipset.maxFreqGhz` 📱 | |
| 核心线程 | 单值 | 笔记本 | `chipset.cpuCores` ✅ | 华为多未公开→unknown |
| 跑分 | 单值 | 全 | `scores[]`（已落地榜单） | 可选，注明来源 |

### 5. 内存（Memory · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 内存容量 | 单值 | 全 | `memory.ramGb` ✅ | 档位数组 |
| 内存类型 | 单值 | 笔记本 | `memory.ramType` 📱 | LPDDR5 等 |
| 内存频率 | 单值 | 笔记本 | `memory.ramFreqMhz` 📱 | |
| 最大支持内存 | 单值 | 笔记本 | `memory.maxRamGb` 📱 | 准绳填充率仅 27.3%，可标 not_applicable |

### 6. 存储（Storage · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 存储扩展 | 单值 | 全 | `memory.expandable` 📱 | 支持/不支持 |
| 硬盘容量 | 单值 | 笔记本 | `memory.storageGb` ✅ | |
| 硬盘接口 | 单值 | 笔记本 | `memory.storageIface` 📱 | |
| 硬盘类型 | 单值 | 笔记本 | `memory.storageType` 📱 | NVMe SSD 等 |
| 读写速度 | 单值 | 笔记本 | `memory.rwSpeed` 📱 | |

### 7. 显卡（Graphics · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 显卡型号 | 单值 | 笔记本 | `chipset.gpu` ✅（手机归 chipset） | |
| 显卡类型 | 单值 | 笔记本 | `chipset.gpuType` 📱 | 集成/独显 |
| 显存位宽 | 单值 | 笔记本 | `chipset.gpuBusBit` 📱 | |
| 显存容量 | 单值 | 笔记本 | `chipset.gpuVramGb` 📱 | |
| 显存类型 | 单值 | 笔记本 | `chipset.gpuVramType` 📱 | GDDR6 等 |

### 8. 摄像头（Camera · **多实例**）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 主摄像头数量 | 数量 | 摄像机 | `camera.rear.length` ✅（由数组推导） | |
| 光学变焦倍数 | 单值 | 手机 | `camera.rear[].opticalZoom` 📱 | |
| 前置主摄像素 | 单值 | 手机 | `camera.front.mp` ✅ | |
| 前置摄像头数量 | 数量 | 手机/笔记本 | `camera.front` 存在即 1 ✅ | 摄像机不填 |
| 后置主摄传感器尺寸 | 单值 | 手机 | `camera.rear[].sensorSize` 📱 | 关键比对轴 |
| 后置主摄像素 | 单值 | 手机 | `camera.rear[].mp` 📱 | |
| 后置主摄光圈 | 单值 | 手机 | `camera.rear[].aperture` 📱 | |
| 后置摄像头数量 | 数量 | 手机 | `camera.rear.length` ✅ | 摄像机/笔记本不填 |
| 完整摄像头配置 | 配置文本 | 手机 | `camera.rear[]` ✅（对象数组枚举每颗） | |
| 视频录制能力 | 单值 | 全 | `camera.videoMax` ✅ | 4K/8K、帧率 |

### 9. 音频（Audio · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 扬声器配置 | 配置文本 | 全 | `audio.speakers` ✅ | 双扬声器/四单元；**官网原文不换算数量**（2026-10-13 落地） |
| 音效 | 单值 | 电视 | `audio.effects` 📱 | |
| 音频接口 | 单值 | 笔记本 | `audio.jack` 📱 | 3.5mm 等 |
| 麦克风 | 单值 | 全 | `audio.mic` 📱 | 数量或阵列 |

> **手机扩展组（超出 16 组母本）**：振动马达按 A.2 行李箱扩组先例新增 `haptic` 组——
> `haptic.motor` ✅（2026-10-13，string 官网原文不 enum，厂商写法不一）；马达尺寸/振动量级 mm³ 待有可靠来源再加。
> **比较纪律（用户 2026-10-13 定）**：对比视图只标差异、不判好坏——轻/重、大/小各有偏好；
> schema `dir`（high/low）只供榜单排序方向，永不进入对比视图做优劣暗示。

### 10. 网络与通信（Network & Connectivity · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| NFC | 单值 | 手机 | `connectivity.nfc` ✅ | |
| WiFi | 单值 | 全 | `connectivity.wifi` ✅ | |
| 卫星通信 | 单值 | 旗舰手机 | `connectivity.satellite` ✅ | |
| 定位 | 单值 | 手机/笔记本 | `connectivity.gnss` 📱 | GPS/北斗 |
| 红外 | 单值 | 手机 | `connectivity.ir` 📱 | |
| 网口 | 单值 | 笔记本 | `connectivity.ethernet` 📱 | 无则填 none |
| 蓝牙 | 单值 | 全 | `connectivity.bluetooth` ✅ | |
| 蜂窝网络 | 单值 | 手机 | `connectivity.fiveG`/`4g` ✅ | 无则 none |
| SIM | 单值 | 手机 | `connectivity.sim`/`esim` ✅ | |

### 11. 接口（Ports & Interfaces · **多实例**）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| HDMI 接口数量 | 数量 | 笔记本/电视 | `connectivity.hdmiCount` 📱 | 关键口扁平 |
| USB-A 数量 | 数量 | 笔记本 | `connectivity.usbACount` 📱 | |
| USB-C 数量 | 数量 | 笔记本/手机 | `connectivity.usbCCount` ✅（手机 `connectivity.usb`） | |
| 接口配置 | 配置文本 | 全 | `connectivity.ports` 📱 | 枚举：USB-A×2/USB-C×1 |
| 雷电接口数量 | 数量 | 笔记本 | `connectivity.thunderboltCount` 📱 | |

### 12. 电池与电源（Battery & Power · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 充电功率 | 单值 | 手机 | `battery.wiredChargeW` ✅ | |
| 反向充电 | 单值 | 手机 | `battery.reverseCharge` 📱 | |
| 快充 | 单值 | 手机 | `battery.wiredChargeW` ✅（合并） | |
| 无线充电 | 单值 | 手机 | `battery.wirelessChargeW` ✅ | |
| 电池容量 | 单值 | 全 | `battery.capacityMah` ✅ | Wh 或 mAh 不互换算 |
| 电源适配器 | 单值 | 笔记本 | `battery.adapter` 📱 | |
| 续航时间 | 单值 | 全 | `battery.vendorClaimedVideoHours`/`measuredHours` ✅ | 保留约/最长 |

### 13. 传感器（Sensors · **多实例**）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 传感器列表 | 配置文本 | 全 | `sensors.list` 📱 | 枚举：指纹/面部/重力 |
| 指纹识别 | 单值 | 手机 | `sensors.fingerprint` 📱 | 支持/不支持 |
| 面部识别 | 单值 | 手机 | `sensors.face` 📱 | |

### 14. 软件与系统（Software & System · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| AI 能力 | 单值 | 全 | `os.ai` 📱 | |
| 互联生态 | 单值 | 全 | `os.ecosystem` 📱 | |
| 操作系统 | 单值 | 全 | `os.launch`/`os.upgradableTo` ✅ | Windows/HarmonyOS/iOS |
| 预装软件 | 单值 | 笔记本 | `os.bloatware` 📱 | |

### 15. 功能特性（Features · 单值）
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 手写笔支持 | 单值 | 平板/手机 | `features.stylus` 📱 | |
| 散热设计 | 单值 | 笔记本 | `features.cooling` 📱 | |
| 特殊功能 | 单值 | 全 | `features.special` 📱 | |
| 键盘 | 单值 | 笔记本 | `features.keyboard` 📱 | 无则 none |
| 防水防尘 | 单值 | 全 | `body.ipRating` ✅ | IP 等级，无则 none |
| 手写笔/触控笔 | 单值 | 平板 | `features.stylus` 📱 | |

### 16. 能耗与容量（Energy & Capacity · 单值）— 家电/显示器专用
| 参数槽 | 取值形态 | 适用品类 | 对应 schema path 建议 | 说明 |
|------|------|------|------|------|
| 制冷制热能力 | 单值 | 空调 | `energy.coolingHeating` | |
| 噪音 | 单值 | 空调/冰箱 | `energy.noiseDb` | dB |
| 容量 | 单值 | 冰箱/空调 | `energy.capacity` | 冰箱容积/空调匹数 |
| 循环风量 | 单值 | 空调 | `energy.airflow` | m³/h |
| 能效等级 | 单值 | 家电/显示器 | `energy.efficiencyGrade` | |
| 额定功率 | 单值 | 家电 | `energy.ratedPower` | |

---

## 3. 已落地 vs 待补（手机 schema 缺口速查）

手机 `data/schemas/phone.json` 当前 **42 字段 / 8 分组**已覆盖：基本信息（颜色）、外观、屏幕、处理器、内存、存储、电池、摄像头、网络、系统。
标 📱 的槽位（约 40 个）是**手机也应收录但暂未建**的字段，新增时直接补进 `phone.json` 的 `fields` 与对应 `group` 即可，无需改任何代码。

---

## 4. 新增一个品类的步骤（零代码分支）

1. `data/categories.json` 的 `categories` 数组加一项：`{ "id": "laptop", "label": "笔记本", "schema": "laptop", "builtin": true }`。
2. 复制 `data/schemas/phone.json` 为 `data/schemas/laptop.json`，按本蓝图的「笔记本」适用列挑字段，写 `groups` + `fields`（每个字段带 `group` 归属）。
3. 在 `data/categories.json` 调整顺序（前端 `CATEGORY_ORDER` 会自动对账）。
4. normalize 层为笔记本数据源产出 `category:'laptop'` + `specs` 拍平结果（可沿用 `flattenSpecs`）。
5. 跑 `npm run selftest`：schema 结构校验 + 分组全覆盖 + 四态 gate 会自动覆盖新品类。
6. 前端：新品类页面直接消费 `specs` + `loadSchema(category)` + `groupsOf()`，复用现有对比/排序/分面逻辑。

> 注意：笔记本等品类必然出现大量 `unknown`（官网未公布）与个别 `not_applicable`（如台式显卡之于手机），
> 这正是四态设计的意义——跨品类对比时「不适用」的整行隐藏，不污染可比字段。

---

## 附录 A：非电品类如何落地（以行李箱 luggage 为例）

**结论先行**：现有架构对品类是否「用电」零假设——它只是 `categories.json` 一行注册 + `schemas/<id>.json` 一份字段表 + 四态 `none`/`not_applicable`。
所以行李箱这类**非电但可量化**的品类，与新增一个电子品类（如笔记本）走**完全相同的零代码路径**，只是字段不同。

### A.1 哪些蓝图分组能直接复用

| 蓝图分组 | 行李箱是否适用 | 说明 |
|---|---|---|
| 1 基本信息 | ✅ 全复用 | 品牌（小米）/ 型号 / 上市时间 / 价格 / 颜色 / 状态 |
| 2 外观与物理规格 | ✅ 全复用 | 尺寸（长×宽×高 mm）、重量（g/kg）、材质（PC / 铝镁合金） |
| 14 软件与系统 | 🔶 部分 | 通常不适用 → `not_applicable`（无操作系统） |
| 15 功能特性 | 🔶 部分 | 仅留防水 / 质保等少数，其余 `not_applicable` |
| 3–⑬（屏幕 / 处理器 / 内存 / 存储 / 显卡 / 摄像头 / 音频 / 网络 / 接口 / 电池 / 传感器） | ❌ 整组 `not_applicable` | 行李箱无电池无屏幕无芯片 → 跨品类对比时**整行隐藏**，不污染可比字段 |

> 这正是四态设计的价值：电子专属的 11 个分组对行李箱不是「缺数据」，而是「结构性不适用」，用 `not_applicable` 显式标记后，跨品类对比面板自动隐藏它们，只比「尺寸 / 重量 / 材质 / 容量 / 轮子 / 锁」这些真正可比的轴。

### A.2 行李箱专属新增分组（超出原 16 组）

原 16 组偏电子，行李箱需要补充几个实物分组（新增品类的常规操作——蓝图是母本不是封顶）：

| # | 分组 | 类型 | 行李箱参数槽示例 |
|---|---|---|---|
| 17 | 容量与尺寸规格 | 单值 | 容积（L）、尺寸档位（20/24/28 寸）、展开尺寸（mm）、折叠尺寸（mm） |
| 18 | 轮组与拉杆 | 多实例 | 轮子数量（单 / 双轮）、万向轮（有 / 无）、拉杆节数、拉杆材质（铝合金） |
| 19 | 锁具 | 单值 | TSA 海关锁（有 / 无）、锁类型 |
| 20 | 内部结构 | 单值 | 内衬材质、隔层数、干湿分离（有 / 无） |

### A.3 小米行李箱真实字段示例（示意 schema 片段）

```jsonc
{
  "groups": [
    { "id": "basic",    "name": "基本信息",   "type": "single" },
    { "id": "physical", "name": "外观与物理", "type": "single" },
    { "id": "capacity", "name": "容量与尺寸", "type": "single" },
    { "id": "wheels",   "name": "轮组与拉杆", "type": "multi"  },
    { "id": "lock",     "name": "锁具",       "type": "single" }
  ],
  "fields": [
    { "path": "body.weightG",    "group": "physical", "type": "number", "unit": "g", "range": [800, 6000] },
    { "path": "body.material",   "group": "physical", "type": "enum",   "options": ["PC", "ABS", "铝镁合金"] },
    { "path": "luggage.volumeL", "group": "capacity", "type": "number", "unit": "L", "range": [14, 120] },
    { "path": "luggage.sizeIn",  "group": "capacity", "type": "enum",   "options": ["20", "24", "28"] },
    { "path": "wheels.count",    "group": "wheels",   "type": "number", "range": [2, 8] },
    { "path": "wheels.spinner",  "group": "wheels",   "type": "boolean" },
    { "path": "lock.tsa",        "group": "lock",     "type": "boolean" }
  ]
}
```

> 这份 `schemas/luggage.json` 目前**未建**（属于「后续加上」阶段），此处仅作架构已就绪的示范。
> 一旦要建，照第 4 节的零代码步骤走：`categories.json` 加一行 + 复制上述字段表 + `npm run selftest` 自动覆盖闸门。

### A.4 范围延展原则

- 全品类不是「电子品类全集」，而是「**任何可量化的产品**」——只要一个东西能用数字 / 枚举描述（尺寸、重量、容量、材质、转速、功率…），就能进 specworld。
- 每扩一个非电品类，先做 A.1 的「复用 vs `not_applicable`」判断，再按需新增 A.2 式分组，蓝图随之滚动扩展。
- 品牌维度天然跨电 / 非电：小米既出手机也出行李箱，在 specworld 里只是 `brand:'xiaomi'` 下挂不同 `category` 的产品，无需特殊处理。
- 现有四态闸门、质量报告、overrides 编辑原型**对行李箱零差别**：它们只认 `category` + `schema` + `specs` + `valueStatus`，不关心是否用电。
