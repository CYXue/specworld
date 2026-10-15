// 环面回绕画布（#/canvas）真机交互验证。存在的意义：构建成功 ≠ 画布能用。
//
// 真实历史教训（两套画布都踩过）——
//   1. 高度塌成 0 时画面照样渲染（画布有 fallback 视口），但指针事件全落空：
//      拖不动、缩不了，只剩点击/键盘能用。这类故障只有真去拖、去滚才抓得到。
//   2. setPointerCapture 在 pointerdown 里就调用 → 兼容性 mouseup 被重定向到容器，
//      click 的 target 从瓦片变成容器，症状是「能拖能缩但点不进去」，零报错。
//   3. touch-action 漏写 → 触摸拖拽被浏览器判成滚动，手机上球/画布一抖就停。
// 所以这份脚本不许省：拖、滚、点、窄屏、筛选都要真机跑一遍。
//
// 度量上的坑（这次环面特有的）——
//   - 环面是**恒定 DOM**：scroll 不增删瓦片节点，只搬 transform + 换 img.src。
//     所以「拖拽后 .board-mover 数量不变」才是真验证；数「渲染格数」在旧 grid 模型
//     有意义，这里必须改成「节点数恒定 + 内容随回绕换图」。
//   - 回绕后展示的图集合**会变**（你滚到了环面另一处），所以不能用「图集合守恒」当断言，
//     那会误判成失败；正确断言是「节点数恒定 + 至少一台换了图（证明无限滚动生效）」。
const puppeteer = require('puppeteer-core')
const { ensureShotsDir, chromePath, expectedCounts } = require('./_smoke-paths.cjs')

// 期望台数从数据真源推导，不写死 —— 官网每上一台新机，硬编码数字就会误报红灯。
const EXPECT = expectedCounts()

const BASE = process.env.SMOKE_CANVAS_BASE || 'http://localhost:4173/#/canvas'
const OUT = ensureShotsDir()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function assert(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`)
}

;(async () => {
  const fs = require('fs')
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })

  const hudCount = () =>
    page.evaluate(() => {
      const t = document.querySelector('.board-hud')?.textContent ?? ''
      const m = t.match(/(\d+)\s*台/)
      return m ? Number(m[1]) : -1
    })
  const moverCount = () => page.evaluate(() => document.querySelectorAll('.board-mover').length)
  const moverIds = () => page.evaluate(() => [...document.querySelectorAll('.board-mover')].map((e) => e.dataset.id))
  const moverTransforms = () =>
    page.evaluate(() => [...document.querySelectorAll('.board-mover')].map((e) => e.style.transform))
  const visibleMovers = () =>
    page.evaluate(() => {
      const host = document.querySelector('.board-host')
      if (!host) return { count: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 }
      const hb = host.getBoundingClientRect()
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0, center = false
      for (const el of document.querySelectorAll('.board-mover')) {
        const b = el.getBoundingClientRect()
        if (b.width <= 0 || b.height <= 0) continue
        if (b.right <= hb.left || b.left >= hb.right || b.bottom <= hb.top || b.top >= hb.bottom) continue
        count++
        minX = Math.min(minX, b.left); maxX = Math.max(maxX, b.right)
        minY = Math.min(minY, b.top); maxY = Math.max(maxY, b.bottom)
        if (b.left < hb.left + hb.width / 2 && b.right > hb.left + hb.width / 2 &&
            b.top < hb.top + hb.height / 2 && b.bottom > hb.top + hb.height / 2) center = true
      }
      return { count, minX, maxX, minY, maxY, center }
    })

  // 等 rAF 惯性彻底停稳：连续两次读到同一个 transform 才算停
  const settle = async (ms = 60, tries = 40) => {
    let prev = null
    for (let i = 0; i < tries; i++) {
      await sleep(ms)
      const cur = (await moverTransforms())[0]
      if (cur === prev) return
      prev = cur
    }
  }

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.board-host.is-ready', { timeout: 10000 })
  await page.waitForSelector('.board-mover', { timeout: 10000 })
  await sleep(900)

  // ── 0. 画布必须有真实高度（高度塌 0 的回归）──
  const box = await (await page.$('.board-host')).boundingBox()
  assert('画布高度非零', box.height > 100, `height=${Math.round(box.height)}px`)

  // ── 1. 初始渲染 ──
  const initCount = await moverCount()
  const initHud = await hudCount()
  const vis = await visibleMovers()
  console.log('  初始 HUD:', initHud, '台 | 渲染瓦片数:', initCount, '| 视口内可见:', vis.count)
  assert('初始渲染了瓦片', initCount > 0, `${initCount} 个`)
  assert(`HUD 显示全部 ${EXPECT.total} 台`, initHud === EXPECT.total, `${initHud} 台`)
  // 铺满判据：瓦片中心分布在视口**四个象限**（证明全屏都有瓦片，不露大面积空白）。
  // 注意不能用「视口正中点被瓦片覆盖」——瓦片之间本就有 ~1/3 格宽的间隙（参考站设计），
  // 正中点很容易正好落在缝里，那会得到假阴性（本脚本第一版就误报过）。
  const quads = await page.evaluate(() => {
    const hb = document.querySelector('.board-host').getBoundingClientRect()
    const q = { tl: 0, tr: 0, bl: 0, br: 0 }
    for (const el of document.querySelectorAll('.board-mover')) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0 || b.right <= hb.left || b.left >= hb.right || b.bottom <= hb.top || b.top >= hb.bottom) continue
      const x = b.left + b.width / 2, y = b.top + b.height / 2
      if (x < hb.left + hb.width / 2 && y < hb.top + hb.height / 2) q.tl++
      else if (x >= hb.left + hb.width / 2 && y < hb.top + hb.height / 2) q.tr++
      else if (x < hb.left + hb.width / 2) q.bl++
      else q.br++
    }
    return q
  })
  assert('瓦片铺满视口四个象限（不露大面积空白）',
    quads.tl > 0 && quads.tr > 0 && quads.bl > 0 && quads.br > 0, JSON.stringify(quads))
  // 环面连续：所有瓦片的包围盒要**越过视口四边**（说明还有内容在视口外，
  // 可以一直拖出去，不存在边界）。这才是「无限」的判据。
  const ext = await page.evaluate(() => {
    const hb = document.querySelector('.board-host').getBoundingClientRect()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const el of document.querySelectorAll('.board-mover')) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0) continue
      minX = Math.min(minX, b.left); maxX = Math.max(maxX, b.right)
      minY = Math.min(minY, b.top); maxY = Math.max(maxY, b.bottom)
    }
    return { minX, maxX, minY, maxY, hl: hb.left, hr: hb.right, ht: hb.top, hb2: hb.bottom }
  })
  assert('环面向视口外连续延伸（无边界，可无限拖）',
    ext.minX <= ext.hl + 1 && ext.maxX >= ext.hr - 1 && ext.minY <= ext.ht + 1 && ext.maxY >= ext.hb2 - 1,
    `瓦片 x[${Math.round(ext.minX)},${Math.round(ext.maxX)}] y[${Math.round(ext.minY)},${Math.round(ext.maxY)}] · 视口 x[${Math.round(ext.hl)},${Math.round(ext.hr)}] y[${Math.round(ext.ht)},${Math.round(ext.hb2)}]`)
  await page.screenshot({ path: `${OUT}/canvas-1-initial.png` })

  // ── 2. 环面恒定 DOM + 回绕换图 ──
  // 一次**单向大拖拽**：既验「节点数恒定」（环面不增删），又验「内容发生置换」
  // （滚动确实在换图）。注意不能用「先左拖再右拖」来测换图——两次相反位移会互相抵消，
  // 净位移≈0 → 一台都没换，是假阴性（本脚本第一版就栽在这）。
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const beforeDrag = await moverCount()
  const tf0 = await moverTransforms()
  const idsBefore = await moverIds()
  await page.mouse.move(cx, cy, { steps: 2 })
  await page.mouse.down({ button: 'left' })
  for (let i = 1; i <= 34; i++) {
    await page.mouse.move(cx - i * 26, cy - i * 19)
    await sleep(16)
  }
  await page.mouse.up({ button: 'left' })
  await settle()
  const afterDrag = await moverTransforms()
  const afterCount = await moverCount()
  const idsAfter = await moverIds()
  assert('环面恒定 DOM：拖拽后瓦片数不变', beforeDrag === afterCount,
    `${beforeDrag} → ${afterCount}`)
  assert('拖拽改变了瓦片位置', JSON.stringify(tf0) !== JSON.stringify(afterDrag))
  let changed = 0
  for (let i = 0; i < idsBefore.length; i++) if (idsBefore[i] !== idsAfter[i]) changed++
  assert('回绕后瓦片内容发生置换（无限滚动生效）', changed > 0,
    `${changed}/${idsBefore.length} 台换了图`)
  await page.screenshot({ path: `${OUT}/canvas-2-after-drag.png` })

  // ── 3. 滚轮纵向平移 ──
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(700)
  const wf0 = await moverTransforms()
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaY: 240 })
    await sleep(60)
  }
  await settle()
  const wf1 = await moverTransforms()
  assert('滚轮触发纵向平移', JSON.stringify(wf0) !== JSON.stringify(wf1))
  await page.screenshot({ path: `${OUT}/canvas-3-wheel.png` })

  // ── 4. 点瓦片进详情浮层 → 进产品页 ──
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(700)
  const target = await page.evaluate(() => {
    const host = document.querySelector('.board-host').getBoundingClientRect()
    const els = [...document.querySelectorAll('.board-mover')]
    // ⚠️ 判据必须同时落在「host 内」和「视口内」：913 台之后 host 比视口高得多，
    // 只按 host 边界选会挑到屏幕下方的瓦片（elementFromPoint 命中 null，点击落空）。
    const el = els.find((e) => {
      const b = e.getBoundingClientRect()
      const cx = b.left + b.width / 2
      const cy = b.top + b.height / 2
      return b.width > 60 && b.height > 60 &&
        b.left > host.left + 40 && b.right < host.right - 40 &&
        b.top > host.top + 40 && b.bottom < host.bottom - 40 &&
        cy > 40 && cy < window.innerHeight - 40 && cx > 40 && cx < window.innerWidth - 40 &&
        e.contains(document.elementFromPoint(cx, cy))
    }) ?? els[0]
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), id: el.dataset.id }
  })
  assert('取到了一个可点的瓦片', Boolean(target.id), target.id)
  await page.mouse.click(target.x, target.y)
  await page.waitForSelector('.viewbox.viewbox_show', { timeout: 5000 })
  await sleep(500)
  const vb = await page.evaluate(() => ({
    name: document.querySelector('.viewbox_name')?.textContent?.trim(),
    hasBtn: !!document.querySelector('.viewbox_btn'),
  }))
  assert('点击瓦片弹出详情浮层', vb.hasBtn, vb.name)
  await page.screenshot({ path: `${OUT}/canvas-4-viewbox.png` })
  // 点图进全屏查看器
  await page.evaluate(() => document.querySelector('.viewbox_imagebox_image')?.click())
  await sleep(500)
  const ivOpen = await page.evaluate(() => !!document.querySelector('.imageview.imageview_show'))
  assert('详情浮层点图进全屏查看器', ivOpen)
  await page.evaluate(() => document.querySelector('.imageview_return_btn')?.click())
  await sleep(400)
  // 详情浮层「查看完整参数 →」跳产品页
  await page.evaluate(() => document.querySelector('.viewbox_btn')?.click())
  await sleep(900)
  const hash = await page.evaluate(() => location.hash)
  assert('详情浮层进产品页', hash === `#/product/${target.id}`, `${hash}（期望 #/product/${target.id}）`)

  // ── 5. 筛选写进 URL 并改写画布内容 ──
  await page.goto(BASE + '?brand=huawei', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(800)
  const huawei = await hudCount()
  const hv = await visibleMovers()
  assert(
    `筛选华为后 HUD 显示 ${EXPECT.byBrand.huawei} 台`,
    huawei === EXPECT.byBrand.huawei,
    `${huawei} 台`,
  )
  assert('筛选后瓦片仍在（未清空 DOM）', hv.count > 0, `可见 ${hv.count}`)
  const hvIds = await moverIds()
  assert('筛选后瓦片都是华为机型', hvIds.length > 0 && hvIds.every((id) => id?.startsWith('h')),
    hvIds.slice(0, 3).join(',') + '…')
  await page.screenshot({ path: `${OUT}/canvas-5-filter-huawei.png` })

  // ── 6. 空结果不白屏 ──
  await page.goto(BASE + '?brand=不存在的品牌', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host', { timeout: 10000 })
  await sleep(700)
  const empty = await page.evaluate(() => ({
    alive: !!document.querySelector('.board-host'),
    emptyEl: !!document.querySelector('.board-empty'),
    hud: document.querySelector('.board-hud')?.textContent?.replace(/\s+/g, ' ').trim(),
  }))
  assert('空筛选不白屏', empty.alive)
  assert('空筛选给出说明而非空白', empty.emptyEl, empty.hud)
  await page.screenshot({ path: `${OUT}/canvas-6-empty.png` })

  // ── 7. 分享链接可还原（品牌 + 产品线）──
  await page.goto(BASE + '?brand=huawei&line=Mate', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(800)
  const restored = await hudCount()
  assert('URL 还原筛选结果（华为 Mate = 19 台）', restored === 19, `${restored} 台`)
  await page.screenshot({ path: `${OUT}/canvas-7-url-restore.png` })

  // ── 8. 无障碍等价列表 ──
  await page.goto(BASE + '?brand=apple', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(700)
  const a11y = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label*="设备列表"]')
    return { found: !!nav, links: nav?.querySelectorAll('a').length ?? 0 }
  })
  assert('存在画布的文本等价列表', a11y.found && a11y.links > 0, `${a11y.links} 条链接`)

  // ── 9. 窄屏（手机）不塌 ──
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(900)
  const mobile = await (await page.$('.board-host')).boundingBox()
  const mHud = await hudCount()
  const mVis = await visibleMovers()
  assert('窄屏画布仍有高度', mobile.height > 100, `${Math.round(mobile.width)}×${Math.round(mobile.height)}`)
  assert(`窄屏 HUD 仍显示全部 ${EXPECT.total} 台`, mHud === EXPECT.total, `${mHud} 台`)
  assert('窄屏同样铺满瓦片', mVis.count >= 2, `可见 ${mVis.count}`)
  await page.screenshot({ path: `${OUT}/canvas-8-mobile.png` })

  // ── 10. 导出 PNG（当前筛选集合成一张图）──
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-host.is-ready')
  await sleep(700)
  // 拦截 createObjectURL 记录 blob 类型，并吞掉 a.click 以免真下载
  await page.evaluate(() => {
    window.__blobType = null
    const orig = URL.createObjectURL
    URL.createObjectURL = function (b) { window.__blobType = b && b.type; return orig.call(URL, b) }
    HTMLAnchorElement.prototype.click = function () {}
  })
  const expBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出'))
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null
  })
  assert('画布有「导出 PNG」按钮且可用', expBtn && !expBtn.disabled, expBtn ? expBtn.text : '未找到')
  if (expBtn && !expBtn.disabled) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出'))
      b.click()
    })
    
    // 452 台后导出画布渲染 + toBlob 超过固定 1.8s（2026-10-15 实测）：
    // 改轮询等待生成完成，超时 10s（大画布异步导出的稳定等待策略）。
    let blobType = null
    for (let i = 0; i < 50 && blobType !== 'image/png'; i++) {
      await sleep(200)
      blobType = await page.evaluate(() => window.__blobType)
    }
    assert('点击导出生成 image/png', blobType === 'image/png', String(blobType))
  }
  await page.screenshot({ path: `${OUT}/canvas-9-export.png` })

  // ── 汇总 ──
  console.log('\n' + '─'.repeat(60))
  const bad = results.filter((r) => !r.ok)
  console.log(`交互验证：${results.length} 项，${results.length - bad.length} 通过，${bad.length} 失败`)
  if (bad.length) for (const r of bad) console.log(`  ❌ ${r.name} ${r.detail}`)
  console.log('运行时错误：', errors.length === 0 ? '无' : '\n' + errors.join('\n'))

  await browser.close()
  process.exit(bad.length || errors.length ? 1 : 0)
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
