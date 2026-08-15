process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v4] WATCHDOG EXIT')
  process.exit(2)
}, 120000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    await js(`window.bridge.windowSetMode('full')`)
    await sleep(700)
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('翻译文本') && b.textContent.includes('粘贴'))?.click()`)
    await sleep(500)

    // 切整体模式
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '整体翻译')?.click()`)
    await sleep(300)

    // 注入文本
    await js(`(function(){
      const el = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'Deep learning requires large datasets.\\n\\nGradient descent optimizes the loss function.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(400)
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('开始整体翻译'))?.click()`)

    // 等待流式完成后进入中文译文视图
    const t0 = Date.now()
    let res = 'TIMEOUT'
    while (Date.now() - t0 < 60000) {
      await sleep(500)
      res = await js(`(function(){
        const cn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '中文译文');
        const streamBox = document.querySelector('.stream-caret');
        if (streamBox) return 'STREAMING:' + streamBox.textContent.slice(0, 20);
        if (cn && cn.classList.contains('active')) {
          const paras = Array.from(document.querySelectorAll('.card p')).map(p => p.textContent.trim());
          return 'CN:' + paras.length + '|' + paras.join(' ~ ').slice(0, 120);
        }
        return null;
      })()`)
      if (res && !res.startsWith('STREAMING')) break
    }
    out.push('whole=' + res)

    console.log('[e2e-v4]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v4] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
