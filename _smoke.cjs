// 冒烟测试：加载 SPA，检查控制台错误，验证数据加载 + 路由，截图。
// 搜索页要验三件事：空态、命中、无结果，以及 query 写进 URL 后刷新能还原。
const puppeteer = require('puppeteer-core')
const { ensureShotsDir, chromePath } = require('./_smoke-paths.cjs')

const OUT = ensureShotsDir()
const BASE = process.env.SMOKE_BASE || 'http://localhost:4173/'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
  page.on('requestfailed', (r) => errors.push('[reqfail] ' + r.url() + ' :: ' + (r.failure()?.errorText || '')))
  page.on('response', (r) => { if (r.status() >= 400) errors.push('[http' + r.status() + '] ' + r.url()) })

  const probe = () => page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    h2: Array.from(document.querySelectorAll('h2')).map((x) => x.textContent.trim()),
    productLinks: document.querySelectorAll('a[href*="#/product/"]').length,
    imgsOk: Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0).length,
    imgsTotal: document.images.length,
    fontLoaded: document.fonts ? document.fonts.check('12px "Fusion Pixel"') : null,
    hash: location.hash,
  }))

  async function shot(hash, file, waitMs = 1200) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, waitMs))
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: false })
    return probe()
  }

  const home = await shot('#/', 'home.png')
  const product = await shot('#/product/apple-iphone-16', 'product.png')
  const compare = await shot('#/compare', 'compare.png', 800)
  const rankings = await shot('#/rankings', 'rankings.png', 800)

  // 搜索三态
  const searchEmpty = await shot('#/search', 'search-empty.png', 800)
  // 直接带 query 进页面（等价于「分享链接」）
  const searchMate = await shot('#/search?q=mate', 'search-mate.png', 800)
  const searchChip = await shot('#/search?q=%E8%8B%AF%E9%9C%93', 'search-chip.png', 800)
  const searchNone = await shot('#/search?q=zzzznotexist', 'search-none.png', 600)

  // 交互：在搜索框输入后回车，验证 query 进了 URL 且结果数变化
  await page.goto(BASE + '#/search', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 600))
  await page.type('#site-search', 'pura')
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 900))
  const afterType = await probe()
  await page.screenshot({ path: `${OUT}/search-typed.png` })

  // 品牌过滤
  await page.goto(BASE + '#/search?brand=huawei', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 800))
  const brandOnly = await probe()
  await page.screenshot({ path: `${OUT}/search-brand.png` })

  console.log('HOME    ', JSON.stringify(home))
  console.log('PRODUCT ', JSON.stringify(product))
  console.log('COMPARE ', JSON.stringify(compare))
  console.log('RANKINGS', JSON.stringify(rankings))
  console.log('SRCH-EMPTY', JSON.stringify(searchEmpty))
  console.log('SRCH-MATE ', JSON.stringify(searchMate))
  console.log('SRCH-CHIP ', JSON.stringify(searchChip))
  console.log('SRCH-NONE ', JSON.stringify(searchNone))
  console.log('SRCH-TYPED', JSON.stringify(afterType))
  console.log('SRCH-BRAND', JSON.stringify(brandOnly))
  console.log('ERRORS  ', errors.length ? '\n  ' + errors.join('\n  ') : 'none')

  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
