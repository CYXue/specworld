// 设备球的真机验证。存在的意义同 _smoke-canvas.cjs：构建成功不等于球面能用。
//
// 本文件要盯死三件事：
//   1. **循环** —— 转一圈必须回到原位。这是用户要的核心效果，
//      差一点都不算循环（转久了会发现设备对不上）。
//   2. **背面可见** —— 线框球口径：60 台始终在画面上，背面只是变暗。
//      若背面 opacity 被压到 0 或元素被剔除，就退化成实心球，信息密度腰斩。
//   3. **没有边界** —— 任意角度都要有内容，不能转到某处出现空白半球。
const puppeteer = require('puppeteer-core')
const { ensureShotsDir, chromePath, expectedCounts } = require('./_smoke-paths.cjs')

// 期望台数从数据真源推导，不写死 —— 官网每上一台新机，硬编码数字就会误报红灯。
const EXPECT = expectedCounts()

const BASE = process.env.SMOKE_GLOBE_BASE || 'http://localhost:4173/#/globe'
const OUT = ensureShotsDir()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function assert(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`)
}

;(async () => {
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

  const hud = () =>
    page.evaluate(() => document.querySelector('.globe-hud')?.textContent?.replace(/\s+/g, ' ').trim() ?? null)

  /** 读所有设备节点的屏幕位置 + 深度排序后的顺序 + 不透明度 */
  const snap = () =>
    page.evaluate(() => {
      const host = document.querySelector('.globe-host')
      if (!host) return null
      const hb = host.getBoundingClientRect()
      const cells = [...host.querySelectorAll('.globe-cell')]
      return {
        hb: { w: hb.width, h: hb.height },
        n: cells.length,
        items: cells.map((el) => {
          const b = el.getBoundingClientRect()
          return {
            // 用中心点，不受 scale 影响
            cx: Math.round(b.left + b.width / 2 - hb.left),
            cy: Math.round(b.top + b.height / 2 - hb.top),
            op: Number(getComputedStyle(el).opacity),
            href: el.getAttribute('href'),
          }
        }),
      }
    })

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.globe-host', { timeout: 10000 })
  await page.waitForSelector('.globe-cell', { timeout: 10000 })
  await sleep(900)

  // ── 0. 容器有真实高度（平面版踩过：高度塌 0 时画面照渲染但交互全死）──
  const box = await (await page.$('.globe-host')).boundingBox()
  assert('画布高度非零', box.height > 100, `${Math.round(box.width)}×${Math.round(box.height)}`)

  // ── 1. 60 台全部渲染（球面版不裁剪，这是与平面版的关键区别）──
  const s0 = await snap()
  console.log('  初始:', await hud())
  assert(`${EXPECT.total} 台全部渲染（球面不裁剪）`, s0.n === EXPECT.total, `${s0.n} 个`)
  await page.screenshot({ path: `${OUT}/globe-1-initial.png` })

  // ── 2. 背面可见：必须同时存在「清晰」和「变暗」两类 ──
  {
    const ops = s0.items.map((i) => i.op)
    const bright = ops.filter((o) => o > 0.75).length
    const dim = ops.filter((o) => o < 0.45).length
    assert(
      '背面半透明可见（不是实心球）',
      bright > 5 && dim > 5,
      `清晰 ${bright} 台 · 变暗 ${dim} 台 · opacity ${Math.min(...ops).toFixed(2)}~${Math.max(...ops).toFixed(2)}`,
    )
    assert('没有设备被完全隐藏', Math.min(...ops) > 0.05, `最低 opacity ${Math.min(...ops)}`)
  }

  // ── 3. 设备分布在球范围内（不成堆、不飞出）──
  {
    const xs = s0.items.map((i) => i.cx)
    const ys = s0.items.map((i) => i.cy)
    const spreadX = Math.max(...xs) - Math.min(...xs)
    const spreadY = Math.max(...ys) - Math.min(...ys)
    assert(
      '设备铺成球形（横向跨度合理）',
      spreadX > s0.hb.w * 0.35 && spreadX < s0.hb.w * 1.2,
      `跨度 ${spreadX}px / 容器 ${Math.round(s0.hb.w)}px`,
    )
    assert('纵向也有跨度（不是压扁成一条）', spreadY > s0.hb.h * 0.35, `跨度 ${spreadY}px`)
  }

  // ── 4. 自转：不拖它也在转 ──
  {
    const a = await hud()
    await sleep(1600)
    const b = await hud()
    assert('自动自转（一直在循环）', a !== b, `${a} → ${b}`)
  }

  // 暂停自转，后面的断言才不会被自转干扰
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('暂停自转'))
    btn?.click()
  })
  await sleep(400)

  // ── 5. 拖拽转球 ──
  {
    const hb = await (await page.$('.globe-host')).boundingBox()
    const before = await snap()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(hb.x + hb.width / 2 - i * 18, hb.y + hb.height / 2)
      await sleep(16)
    }
    await page.mouse.up()
    await sleep(1500) // 等惯性停下
    const after = await snap()
    const moved = after.items.filter((it, i) => it.cx !== before.items[i].cx).length
    assert('拖拽改变了球面朝向', moved > 40, `${moved}/${EXPECT.total} 台位置变化`)
    assert(`拖拽后仍然是 ${EXPECT.total} 台`, after.n === EXPECT.total, `${after.n} 个`)
    await page.screenshot({ path: `${OUT}/globe-2-dragged.png` })
  }

  // ── 5b. 起手落在某台设备上、拖出去再拖回来，不该被当成点击跳详情页 ──
  // 这个守卫必须存在：RouterLink 是 <a>，pointerdown/up 落在同一元素上就会派发 click，
  // 用户「转个球」的手感会被打断成「怎么跳走了」。
  {
    const t = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.globe-cell')]
      // 必须选正面的设备：背面那批 pointer-events 是 none，点上去打不到它
      const el = cells.find((c) => Number(getComputedStyle(c).opacity) > 0.9) ?? cells[0]
      const b = el.getBoundingClientRect()
      return {
        x: Math.round(b.left + b.width / 2),
        y: Math.round(b.top + b.height / 2),
      }
    })
    const before = await page.evaluate(() => location.hash)
    await page.mouse.move(t.x, t.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(t.x + i * 22, t.y)
      await sleep(14)
    }
    // 原路拖回：松手时指针又落在这台设备上，浏览器照样派发 click
    for (let i = 10; i >= 0; i--) {
      await page.mouse.move(t.x + i * 22, t.y)
      await sleep(14)
    }
    await page.mouse.up()
    await sleep(1400)
    const after = await page.evaluate(() => location.hash)
    assert('拖出去再拖回来不误跳详情页', before === after, `${before} → ${after}`)
  }

  // ── 6. 循环：转一圈回到原位（核心验收点）──
  {
    // 复位到已知角度，记录，再用键盘精确转 360°，比对每台设备的位置
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('复位视角'))
      btn?.click()
    })
    await sleep(900)
    const start = await snap()
    const startHud = await hud()
    // 方向键一次 12°，30 次 = 360°
    await page.evaluate(() => document.querySelector('.globe-host')?.focus())
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('ArrowRight')
      await sleep(24)
    }
    await sleep(1200)
    const end = await snap()
    const endHud = await hud()
    // HUD 的经度应回到起点附近（30 × 12 = 360）
    const lonOf = (s) => Number(s?.match(/经度\s*(-?\d+)°/)?.[1] ?? NaN)
    const dLon = Math.abs(lonOf(startHud) - lonOf(endHud))
    assert('转 360° 后经度回到起点', dLon <= 1 || dLon >= 359, `${startHud} → ${endHud}`)
    // 逐台比对位置（同样 index 的设备应回到同样的屏幕位置）
    let worst = 0
    for (let i = 0; i < Math.min(start.n, end.n); i++) {
      worst = Math.max(worst, Math.abs(start.items[i].cx - end.items[i].cx))
    }
    assert('转一圈后每台设备回到原位', worst <= 2, `最大偏差 ${worst}px`)
    await page.screenshot({ path: `${OUT}/globe-3-full-turn.png` })
  }

  // ── 7. 任意角度都有内容（没有空白半球 = 没有边界）──
  {
    for (const [label, keys] of [
      ['半圈', 15],
      ['四分之一圈', 8],
    ]) {
      await page.evaluate(() => document.querySelector('.globe-host')?.focus())
      for (let i = 0; i < keys; i++) {
        await page.keyboard.press('ArrowRight')
        await sleep(20)
      }
      await sleep(600)
      const s = await snap()
      const ops = s.items.map((i) => i.op)
      const visible = ops.filter((o) => o > 0.3).length
      assert(`转到${label}仍有大量设备可见`, visible > 25, `${visible}/${EXPECT.total} 台清晰可见`)
    }
  }

  // ── 8. 缩放改视距，不越界 ──
  {
    const hb = await (await page.$('.globe-host')).boundingBox()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    for (let i = 0; i < 10; i++) await page.mouse.wheel({ deltaY: -240 })
    await sleep(500)
    const zoomIn = await hud()
    for (let i = 0; i < 24; i++) await page.mouse.wheel({ deltaY: 240 })
    await sleep(500)
    const zoomOut = await hud()
    const distOf = (s) => Number(s?.match(/视距\s*([\d.]+)/)?.[1] ?? NaN)
    assert(
      '缩放改变视距且被夹在上下限内',
      distOf(zoomIn) >= 1.55 && distOf(zoomOut) <= 6.01 && distOf(zoomIn) < distOf(zoomOut),
      `${distOf(zoomIn)} → ${distOf(zoomOut)}`,
    )
    const sz = await snap()
    assert(`极限缩放后仍是 ${EXPECT.total} 台、坐标有限`, sz.n === EXPECT.total && sz.items.every((i) => Number.isFinite(i.cx)), `${sz.n} 个`)
    await page.screenshot({ path: `${OUT}/globe-4-zoomed.png` })
  }

  // ── 9. 筛选 ──
  {
    await page.goto(`${BASE}?brand=apple`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.globe-cell')
    await sleep(900)
    const s = await snap()
    assert('筛选苹果后只剩 13 台', s.n === 13, `${s.n} 个`)
    await page.screenshot({ path: `${OUT}/globe-5-apple.png` })
  }

  // ── 10. 无障碍等价列表 ──
  {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.globe-cell')
    await sleep(700)
    const a11y = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label*="设备列表"]')
      return { found: !!nav, links: nav?.querySelectorAll('a').length ?? 0 }
    })
    assert('存在球面的文本等价列表', a11y.found && a11y.links > 0, `${a11y.links} 条链接`)
  }

  // ── 11. 窄屏 + 真实触摸手势 ──
  {
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.globe-cell')
    await sleep(800)
    const mb = await (await page.$('.globe-host')).boundingBox()
    assert('窄屏画布仍有高度', mb.height > 100, `${Math.round(mb.width)}×${Math.round(mb.height)}`)
    const ms = await snap()
    assert(`窄屏仍是 ${EXPECT.total} 台`, ms.n === EXPECT.total, `${ms.n} 个`)

    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('暂停自转'))?.click()
    })
    await sleep(300)

    const ta = await page.evaluate(() => {
      const el = document.querySelector('.globe-host')
      window.__g = { move: 0, cancel: 0 }
      el.addEventListener('pointermove', () => window.__g.move++)
      el.addEventListener('pointercancel', () => window.__g.cancel++)
      return getComputedStyle(el).touchAction
    })
    // touch-action 不是 none 时，Chrome 会在第一次 move 后就发 pointercancel
    // （实测 move=1 cancel=1），手机上表现为「手指一划，球抖一下就停」。
    assert('球区域接管了触摸手势（touch-action: none）', ta === 'none', ta)

    const cdp = await page.createCDPSession()
    const cx = Math.round(mb.x + mb.width / 2)
    const cy = Math.round(mb.y + Math.min(mb.height, 844 - mb.y) / 2)
    const hudBefore = await hud()
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, id: 1 }],
    })
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx - i * 16, y: cy, id: 1 }],
      })
      await sleep(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(1200)
    const g = await page.evaluate(() => window.__g)
    assert(
      '触摸拖拽收满 move 且未被 pointercancel 打断',
      g.move >= 10 && g.cancel === 0,
      `move=${g.move} cancel=${g.cancel}`,
    )
    assert('触摸能转球', (await hud()) !== hudBefore, `${hudBefore} → ${await hud()}`)

    // 双指捏合改视距 —— 手机没有滚轮，否则移动端根本无法缩放
    const distOf = (s) => Number(s?.match(/视距\s*([\d.]+)/)?.[1] ?? NaN)
    const d0 = distOf(await hud())
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 50, y: cy, id: 1 },
        { x: cx + 50, y: cy, id: 2 },
      ],
    })
    for (let i = 1; i <= 10; i++) {
      const gap = 100 + i * 22
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - gap / 2, y: cy, id: 1 },
          { x: cx + gap / 2, y: cy, id: 2 },
        ],
      })
      await sleep(18)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(400)
    const d1 = distOf(await hud())
    assert('双指张开能拉近（移动端唯一的缩放手段）', d1 < d0 - 0.05, `视距 ${d0} → ${d1}`)
    await page.screenshot({ path: `${OUT}/globe-6-mobile.png` })
  }

  // ── 12. 单纯点击仍能进详情（确认上面的守卫没把真点击也吃掉）──
  {
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.globe-cell')
    await sleep(700)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('暂停自转'))?.click()
    })
    await sleep(1000)
    const t = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.globe-cell')]
      const el = cells.find((c) => Number(getComputedStyle(c).opacity) > 0.9) ?? cells[0]
      const b = el.getBoundingClientRect()
      return {
        x: Math.round(b.left + b.width / 2),
        y: Math.round(b.top + b.height / 2),
        href: el.getAttribute('href'),
      }
    })
    await page.mouse.click(t.x, t.y)
    await sleep(700)
    const hash = await page.evaluate(() => location.hash)
    assert('单纯点击仍能进详情页', hash === t.href, `${hash}（期望 ${t.href}）`)
  }

  console.log('\n' + '─'.repeat(60))
  const bad = results.filter((r) => !r.ok)
  console.log(`球面验证：${results.length} 项，${results.length - bad.length} 通过，${bad.length} 失败`)
  if (bad.length) for (const r of bad) console.log(`  ❌ ${r.name} ${r.detail}`)
  console.log('运行时错误：', errors.length === 0 ? '无' : '\n' + errors.join('\n'))

  await browser.close()
  process.exit(bad.length || errors.length ? 1 : 0)
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
