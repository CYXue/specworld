// 冒烟测试的**集中路径解析**。三个 smoke 脚本（_smoke / _smoke-canvas / _smoke-globe）
// 原本各自写死 'C:/aiwork/.../specworld/_shots' 和 Chrome 的 exe 全路径，
// 换机器 / 换目录 / 换平台就静默失败（截图落错地方或 puppeteer 报找不到浏览器）。
//
// 约定（对应「移除硬编码绝对路径」）：
//   - 项目内路径一律**基于本文件所在目录动态解析**，不写死任何盘符或家目录；
//   - 需要覆盖时走环境变量（OUT_DIR / CHROME_PATH），默认值在常见平台上开箱可用；
//   - 关键路径不存在时**抛清晰错误**（打印怎么设环境变量），绝不静默继续。
const path = require('path')
const fs = require('fs')

/** 项目根目录 = 本文件所在目录（_smoke-paths.cjs 就在根下）。 */
const ROOT = __dirname

/**
 * 截图输出目录。默认 <项目根>/_shots，可用 OUT_DIR 覆盖（相对路径按 ROOT 解析）。
 * @returns {string} 绝对路径
 */
function shotsDir() {
  const raw = process.env.OUT_DIR || path.join(ROOT, '_shots')
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw)
}

/**
 * Chrome / Chromium 可执行文件。按顺序探测，全部找不到就抛错并提示怎么设 CHROME_PATH。
 * puppeteer 自带的 Chromium 通常不在默认位置，故这里显式探测系统安装路径；
 * 找不到时让 CHROME_PATH 显式指定，或改用 puppeteer 自带下载的浏览器。
 * @returns {string}
 */
function chromePath() {
  const explicit = process.env.CHROME_PATH
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(
        `CHROME_PATH 指向的浏览器不存在：${explicit}\n` +
          `请把它改成真实的 Chrome / Chromium 可执行文件路径。`,
      )
    }
    return explicit
  }

  const isWin = process.platform === 'win32'
  const candidates = isWin
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ]

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }

  throw new Error(
    '找不到 Chrome / Chromium 可执行文件。已尝试：\n' +
      candidates.map((c) => `  · ${c}`).join('\n') +
      '\n请设置环境变量 CHROME_PATH 指向真实路径，例如：\n' +
      (isWin ? '  set CHROME_PATH=D:/path/to/chrome.exe' : '  export CHROME_PATH=/path/to/chrome'),
  )
}

/**
 * 创建截图输出目录；失败（无权限等）时抛清晰错误，不静默。
 * 额外做一次**真实写入探测**：mkdir 成功不等于可写（某些盘能建目录却写不进文件），
 * 只靠 mkdir 的返回值会漏掉这类「建了但用不了」的静默失败。
 * @returns {string} 已确保存在且可写的目录绝对路径
 */
function ensureShotsDir() {
  const dir = shotsDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    throw new Error(
      `无法创建截图输出目录：${dir}\n原因：${err.message}\n` +
        `可用 OUT_DIR 环境变量指定一个可写目录。`,
    )
  }

  // 可写性探测：写一个临时文件再删掉，失败则说明「目录建得出来但写不进去」。
  const probe = path.join(dir, `.write-probe-${process.pid}`)
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
  } catch (err) {
    throw new Error(
      `截图输出目录不可写：${dir}\n原因：${err.message}\n` +
        `请用 OUT_DIR 指定一个当前用户可写的目录。`,
    )
  }

  return dir
}

/**
 * 冒烟用例里的**期望台数**：一律从真源 `data/products.json` 推导，不写死数字。
 *
 * 教训：`_smoke-canvas` / `_smoke-globe` 曾硬编码「60 台」「华为 47 台」，
 * 官网新增机型后立刻误报红灯（实际 62 / 49），而这两个脚本当时既没接 CI
 * 也没注册 npm script —— 红灯没人看，也没人知道它是假的。
 *
 * 分界线（别搞反）：
 *   · **台数**是随官网数据漂移的量 ⇒ 只能从数据推导，写死就是埋雷；
 *   · **容错提示出不出现**是行为契约 ⇒ 必须硬编码，绝不能跟着数据变，
 *     否则判据就变成了「验证实现自己」，退化成永远绿灯。
 *
 * @returns {{total:number, byBrand:Record<string,number>, matching:(re:RegExp)=>number}}
 */
function expectedCounts() {
  const file = path.join(ROOT, 'data', 'products.json')
  if (!fs.existsSync(file)) {
    throw new Error(`缺少数据真源：${file}\n请先跑 npm run data 生成。`)
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const list = Array.isArray(data) ? data : (data.products ?? [])
  if (!list.length) throw new Error(`数据真源里没有机型：${file}`)

  const byBrand = list.reduce((m, p) => {
    const k = p?.brand ?? 'unknown'
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})

  return {
    total: list.length,
    byBrand,
    /** 型号名命中正则的台数（用于「畅享 90」这类系列查询） */
    matching: (re) => list.filter((p) => re.test(p?.name ?? '')).length,
  }
}

module.exports = { ROOT, shotsDir, ensureShotsDir, chromePath, expectedCounts }
