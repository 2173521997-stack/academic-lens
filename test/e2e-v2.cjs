process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v2] WATCHDOG EXIT')
  process.exit(2)
}, 90000)

app.whenReady().then(async () => {
  try {
    await new Promise((r) => setTimeout(r, 3000))
    const win = BrowserWindow.getAllWindows()[0]
    const out = []

    // 1. 无选中文本时 grab 不崩溃
    const grab = await win.webContents.executeJavaScript(`window.bridge.selectionGrab().then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`, true)
    out.push('grab-no-selection=' + grab)

    // 2. 划词事件 → word 模式自动查词（词卡渲染）
    win.webContents.send('selection:text', 'attention')
    const t0 = Date.now()
    let wordResult = 'TIMEOUT'
    while (Date.now() - t0 < 45000) {
      await new Promise((r) => setTimeout(r, 400))
      wordResult = await win.webContents.executeJavaScript(
        `(function(){
          const card = document.querySelector('.mini-window .card h2');
          const err = document.querySelector('.mini-window .text-danger');
          if (err) return 'ERROR: ' + err.textContent;
          if (card) return 'OK ' + card.textContent;
          return null;
        })()`,
        true
      )
      if (wordResult && wordResult !== 'null') break
    }
    out.push('word-card=' + String(wordResult).slice(0, 80))

    // 3. OCR 无 Key → 合理报错（IPC 链路）
    const ocr = await win.webContents.executeJavaScript(
      `window.bridge.ocrRecognize('AAAA', { provider: 'baidu', apiKey: '' })
        .then(() => 'UNEXPECTED-SUCCESS')
        .catch(e => 'ERR: ' + e.message.slice(0, 80))`,
      true
    )
    out.push('ocr-no-key=' + ocr)

    console.log('[e2e-v2]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v2] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
