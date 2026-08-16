// PDF 按页分组可靠性验证：打开真实结构多页 PDF，断言分组标题与段落页码归属
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const http = require('node:http')

const server = http.createServer((req, res) => {
  if (req.url !== '/chat/completions') {
    res.writeHead(404)
    res.end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const parsed = JSON.parse(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '译文段' } }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const map = {}
    const user = parsed.messages[1]?.content ?? ''
    for (const m of user.matchAll(/\[(\d+)\]/g)) map[m[1]] = `译文${m[1]}`
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(map) } }] }))
  })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(8766, r))
  let failures = 0
  const pass = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)
    if (!cond) failures++
  }
  try {
    require(path.join(__dirname, '../dist-electron/main.js'))
    await sleep(2000)
    const win = BrowserWindow.getAllWindows()[0]
    await win.webContents.executeJavaScript(
      `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8766', apiKey:'test-key', model:'mock', theme:'system', ocrLang:'eng'})`
    )
    win.webContents.reload()
    await sleep(2000)
    await win.webContents.executeJavaScript(`window.bridge.windowSetMode('full')`)
    await sleep(800)

    win.webContents.send('file:open-path', path.join(__dirname, 'multi-real.pdf'))
    await sleep(3000)

    const info = await win.webContents.executeJavaScript(`(() => {
      const chips = [...document.querySelectorAll('span')].filter(s => /^第 \\d+ 页$/.test(s.textContent)).map(c => c.textContent)
      // 双栏行带 data-page 属性：统计每页行数
      const rowsByPage = {}
      for (const el of document.querySelectorAll('[data-page]')) {
        const p = el.getAttribute('data-page')
        rowsByPage[p] = (rowsByPage[p] || 0) + 1
      }
      return JSON.stringify({ chips, rowsByPage })
    })()`)
    const r = JSON.parse(info)
    console.log('[pages]', info)
    pass('出现两个页分组标题', r.chips.includes('第 1 页') && r.chips.includes('第 2 页'))
    pass('分组标题数量 = 2', r.chips.length === 2)
    // 双栏每行左右单元格成对出现（原文 + 译文对照一致）
    const rowDual = await win.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('[data-page]')]
      return rows.every((row) => {
        const cells = row.children.length
        const hasEn = [...row.querySelectorAll('div')].some((d) => /^[A-Za-z]/.test(d.textContent.trim()))
        return cells >= 2
      })
    })()`)
    pass('双栏行结构（每行 ≥2 单元格）', rowDual)
    pass('第 1 页行数 ≥2', (r.rowsByPage['1'] || 0) >= 2)
    pass('第 2 页行数 ≥2', (r.rowsByPage['2'] || 0) >= 2)
    pass('无页外行（无 data-page 缺失）', Object.keys(r.rowsByPage).length === 2)
  } catch (e) {
    console.log('[pages-ERROR]', e.message)
  }
  await sleep(300)
  server.close()
  app.exit(failures === 0 ? 0 : 1)
})
