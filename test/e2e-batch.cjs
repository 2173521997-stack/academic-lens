// 端到端：真实 App 主进程 + mock LLM 服务，验证批处理翻译与缓存命中
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const http = require('node:http')

let completeCount = 0
let streamCount = 0
const prompts = []

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
    const authKey = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const sys = parsed.messages?.[0]?.content ?? ''
    prompts.push(sys)
    if (parsed.stream) {
      streamCount++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`)
      let chunks
      if (sys.includes('中英词典')) {
        chunks = [
          'word|attention\nphonetic|/ə',
          'ˈtɛnʃən/\npos|n.\ndef|专注；注意力\n',
          'ex1|Attention is the key to learning. | 注意力是学习的关键。'
        ]
      } else if (sys.includes('中英翻译')) {
        chunks = ['Attention mechanism', ' is the foundation of modern deep learning.']
      } else {
        chunks = ['你好', '世界']
      }
      const step = (i) => {
        if (i >= chunks.length) {
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        send({ choices: [{ delta: { content: chunks[i] } }] })
        setTimeout(() => step(i + 1), 20)
      }
      step(0)
    } else {
      completeCount++
      // 模拟不支持 JSON 模式的提供商：Authorization 以 fail- 开头 → 400
      const failJson = authKey.startsWith('fail-')
      if (failJson) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'response_format not supported' } }))
        return
      }
      const map = {}
      const user = parsed.messages[1]?.content ?? ''
      for (const m of user.matchAll(/\[(\d+)\]/g)) map[m[1]] = `译文${m[1]}`
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(map) } }] }))
    }
  })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(8765, r))
  try {
    require(path.join(__dirname, '../dist-electron/main.js'))
    await sleep(2000)
    const wins = BrowserWindow.getAllWindows()
    if (!wins.length) {
      console.log('[flow] NO WINDOW（单实例锁被占用？）')
    } else {
      const win = wins[0]
      await win.webContents.executeJavaScript(
        `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8765', apiKey:'test-key', model:'mock', theme:'system', selectionShortcut:'CommandOrControl+Shift+D', ocrLang:'eng'})`
      )
      await win.webContents.executeJavaScript(`window.bridge.storeSet('transCache', {})`)
      win.webContents.reload()
      await sleep(2000)

      const sample = path.join(__dirname, 'sample.pdf')
      const out = []
      const pass = (name, cond) => {
        out.push(`${name}=${cond ? 'PASS' : 'FAIL'}`)
        console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)
      }

      const clickByText = (t) =>
        win.webContents.executeJavaScript(`(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(t)}))
          if (!b) return 'no-btn:' + ${JSON.stringify(t)}
          b.click(); return 'clicked'
        })()`)

      const state = () =>
        win.webContents.executeJavaScript(`(() => {
          const t = document.body.innerText
          const m = t.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*已译/)
          if (m) return 'done:' + m[1] + '/' + m[2]
          if (t.includes('翻译中')) return 'translating'
          if (t.includes('未翻译')) return 'idle'
          return 'unknown'
        })()`)

      const waitDone = async (label) => {
        let s = ''
        for (let i = 0; i < 40; i++) {
          await sleep(250)
          s = await state()
          if (s.startsWith('done')) break
        }
        out.push(`${label}=${s}`)
        return s
      }

      // 打开 PDF
      win.webContents.send('file:open-path', sample)
      await sleep(2000)
      out.push('open=' + (await state()))

      // 首次整体翻译 → 走批处理（JSON 非流式）
      await clickByText('整体翻译')
      const s1 = await waitDone('translate1')
      pass('batch 非流式（complete=1, stream=0）', completeCount === 1 && streamCount === 0)
      pass('首次翻译完成', s1.startsWith('done'))

      // 检查页面出现译文
      const hasZh = await win.webContents.executeJavaScript(
        `document.body.innerText.includes('译文1')`
      )
      pass('译文渲染', hasZh)

      // 返回 → 重开同一文件 → 再次整体翻译 → 应命中缓存（completeCount 不增长）
      await clickByText('返回')
      await sleep(500)
      win.webContents.send('file:open-path', sample)
      await sleep(1500)
      await clickByText('整体翻译')
      const s2 = await waitDone('translate2-cached')
      pass('第二次翻译完成', s2.startsWith('done'))
      pass('缓存命中（无新请求）', completeCount === 1)
      const zhStill = await win.webContents.executeJavaScript(
        `document.body.innerText.includes('译文1')`
      )
      pass('缓存译文渲染', zhStill)

      out.push(`mock:complete=${completeCount} stream=${streamCount}`)
      console.log('[flow]', out.join(' | '))

      // ============ 场景 2：服务端不支持 JSON 模式 → 批量失败回退流式 ============
      streamCount = 0
      completeCount = 0
      await win.webContents.executeJavaScript(
        `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8765', apiKey:'fail-key', model:'mock', theme:'system', selectionShortcut:'CommandOrControl+Shift+D', ocrLang:'eng'})`
      )
      await win.webContents.executeJavaScript(`window.bridge.storeSet('transCache', {})`)
      win.webContents.reload()
      await sleep(2000)
      win.webContents.send('file:open-path', sample)
      await sleep(1500)
      await clickByText('整体翻译')
      const s3 = await waitDone('translate3-fallback')
      pass('回退后翻译完成', s3.startsWith('done'))
      pass('批量失败后走流式（stream>0）', streamCount > 0)
      const zhFallback = await win.webContents.executeJavaScript(
        `document.body.innerText.includes('你好世界') || document.body.innerText.includes('你好')`
      )
      pass('流式译文渲染', zhFallback)

      // ============ 场景 3：中文输入 → 自动中译英（词→词卡 / 句→直译） ============
      prompts.length = 0
      streamCount = 0
      await win.webContents.executeJavaScript(
        `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8765', apiKey:'test-key', model:'mock', theme:'system', selectionShortcut:'CommandOrControl+Shift+D', ocrLang:'eng'})`
      )
      // 清空搜索历史，避免跨会话残留干扰断言
      await win.webContents.executeJavaScript(`window.bridge.storeSet('quickRecent', [])`)
      win.webContents.reload()
      await sleep(2000)
      // 切到小窗（QuickTranslate 才有 textarea）
      await win.webContents.executeJavaScript(`window.bridge.windowSetMode('mini')`)
      await sleep(800)

      const setInput = (v) =>
        win.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector('textarea')
          if (!ta) return 'no-textarea'
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          setter.call(ta, ${JSON.stringify(v)})
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          return 'ok'
        })()`)
      const waitFor = async (needle, label) => {
        let hit = false
        for (let i = 0; i < 40; i++) {
          await sleep(250)
          hit = await win.webContents.executeJavaScript(
            `document.body.innerText.includes(${JSON.stringify(needle)})`
          )
          if (hit) break
        }
        pass(label, hit)
        return hit
      }

      // 中文词语 → 词卡（自动检测，无需切模式）；等词卡组件本身（h2=英文词）而非历史文本
      await setInput('注意力')
      const chip = await win.webContents.executeJavaScript(`document.body.innerText.includes('中译英')`)
      pass('中文输入显示中译英指示', chip)
      const waitForCard = async () => {
        let hit = false
        for (let i = 0; i < 40; i++) {
          await sleep(250)
          hit = await win.webContents.executeJavaScript(
            `!![...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'attention')`
          )
          if (hit) break
        }
        return hit
      }
      pass('中文词 → 英文词卡渲染', await waitForCard())
      const cn2enWordPrompt = prompts.some((p) => p.includes('中英词典'))
      pass('词卡走中英词典提示词', cn2enWordPrompt)

      // 收藏按钮：词卡场景下生词本收藏可用（英文词条）
      const bookmarkBtn = await win.webContents.executeJavaScript(
        `!![...document.querySelectorAll('button')].find(b => b.title && b.title.includes('收藏到生词本'))`
      )
      pass('词卡收藏按钮可用', bookmarkBtn)

      // 中文句子 → 直译
      await setInput('注意力机制是现代深度学习的基础')
      await waitFor('Attention mechanism', '中文句 → 英文直译渲染')
      const cn2enSentPrompt = prompts.some((p) => p.includes('中英翻译'))
      pass('直译走中英翻译提示词', cn2enSentPrompt)

      // ============ 场景 5：一键翻译（selection:text 自动填入并翻译，无需手动粘贴/回车） ============
      streamCount = 0
      await win.webContents.executeJavaScript(
        `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8765', apiKey:'test-key', model:'mock', theme:'system', ocrLang:'eng'})`
      )
      win.webContents.reload()
      await sleep(2000)
      await win.webContents.executeJavaScript(`window.bridge.windowSetMode('mini')`)
      await sleep(800)
      // 模拟主进程收到选中文本后广播 selection:text
      win.webContents.send('selection:text', 'machine learning is powerful')
      const autoTranslated = await (async () => {
        for (let i = 0; i < 40; i++) {
          await sleep(250)
          const ok = await win.webContents.executeJavaScript(`document.body.innerText.includes('你好世界')`)
          if (ok) return true
        }
        return false
      })()
      pass('一键翻译自动填入并翻译', autoTranslated)
      const inputFilled = await win.webContents.executeJavaScript(
        `document.querySelector('textarea').value.includes('machine learning')`
      )
      pass('输入栏已自动填入选中文本', inputFilled)

      // ============ 场景 4：多页 PDF → 按页分组 + 整体翻译 + 逐段对照 ============
      prompts.length = 0
      completeCount = 0
      streamCount = 0
      await win.webContents.executeJavaScript(
        `window.bridge.storeSet('settings', {provider:'custom', baseUrl:'http://127.0.0.1:8765', apiKey:'test-key', model:'mock', theme:'system', ocrLang:'eng'})`
      )
      await win.webContents.executeJavaScript(`window.bridge.storeSet('transCache', {})`)
      win.webContents.reload()
      await sleep(2000)
      await win.webContents.executeJavaScript(`window.bridge.windowSetMode('full')`)
      await sleep(800)
      const multi = path.join(__dirname, 'multi.pdf')
      win.webContents.send('file:open-path', multi)
      await sleep(2500)
      const pageChips = await win.webContents.executeJavaScript(`(() => {
        const chips = [...document.querySelectorAll('span')].filter(s => /^第 \\d+ 页$/.test(s.textContent))
        return chips.map(c => c.textContent).join(',')
      })()`)
      pass('按页分组（出现第 1/2 页标题）', pageChips.includes('第 1 页') && pageChips.includes('第 2 页'))
      await clickByText('整体翻译')
      const s4 = await waitDone('translate4-pages')
      pass('多页整体翻译完成', s4.startsWith('done') && s4.endsWith('/4'))
      // 双栏对照：每行左英文原文、右中文译文，段落对齐
      const dual = await win.webContents.executeJavaScript(`(() => {
        const rows = [...document.querySelectorAll('[data-page]')]
        if (!rows.length) return false
        return rows.every((row) => {
          const divs = [...row.querySelectorAll(':scope > div')]
          if (divs.length < 2) return false
          const en = divs[0].textContent.trim()
          const zh = divs[1].textContent.trim()
          return /^[A-Za-z]/.test(en) && (zh.startsWith('译文') || zh === '未翻译')
        })
      })()`)
      pass('双栏对照：左英右中段落对齐', dual)
      const grayStyle = await win.webContents.executeJavaScript(
        `!![...document.querySelectorAll('[data-page]')].every(row => row.querySelectorAll(':scope > div')[1].className.includes('text-ink-2'))`
      )
      pass('译文为深灰醒目样式', grayStyle)
    }
  } catch (e) {
    console.log('[flow-ERROR]', e.message)
  }
  await sleep(300)
  app.exit(0)
})
