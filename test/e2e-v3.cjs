process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v3] WATCHDOG EXIT')
  process.exit(2)
}, 120000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    // 切大窗
    await js(`window.bridge.windowSetMode('full')`)
    await sleep(700)

    // 1. 三入口卡片
    const cards = await js(`Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('翻译文本')).length`)
    out.push('entry-cards=' + cards)

    // 2. 进入文本翻译
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('翻译文本') && b.textContent.includes('粘贴'))?.click()`)
    await sleep(500)
    const hasTextarea = await js(`!!document.querySelector('textarea')`)
    out.push('text-view-textarea=' + hasTextarea)

    // 3. 注入两段文本并触发分段翻译
    await js(`(function(){
      const el = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'Attention is all you need.\\n\\nThe Transformer architecture enables parallel training.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(400)
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('开始分段翻译'))?.click()`)
    out.push('segment-translate-clicked')

    // 4. 等待进入 FileView + 双语翻译完成
    const t0 = Date.now()
    let trans = 'TIMEOUT'
    while (Date.now() - t0 < 60000) {
      await sleep(500)
      trans = await js(`(function(){
        const seg = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '双语');
        const cn  = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '中文译文');
        const body = document.body.textContent;
        if (seg && cn && body.includes('注意') || body.includes('Transformer')) {
          return cn ? 'FILEVIEW-OK' : 'NO-CN-BTN';
        }
        return null;
      })()`)
      if (trans) break
    }
    out.push('fileview=' + trans)

    // 5. 切中文译文档
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '中文译文')?.click()`)
    await sleep(600)
    const cnState = await js(`(function(){
      const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const hasCopy = btns.includes('复制译文');
      const hasExport = btns.includes('导出译文');
      const paras = document.querySelectorAll('.card p, .card h2').length;
      return JSON.stringify({ hasCopy, hasExport, paras });
    })()`)
    out.push('cn-view=' + cnState)

    console.log('[e2e-v3]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v3] TEST ERROR:', e && e.message)
    console.log(e && e.stack)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
