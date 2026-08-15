process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow, clipboard } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v5] WATCHDOG EXIT')
  process.exit(2)
}, 90000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    // 用例 A：模拟前台应用复制成功 —— grab 执行期间剪贴板被"外部"改写
    //（对应真实场景：SendKeys 生效，前台应用把选中文本复制进剪贴板）
    clipboard.writeText('__orig__')
    setTimeout(() => clipboard.writeText('external selected text'), 500)
    const t0 = Date.now()
    const a = JSON.parse(await js(`window.bridge.selectionGrab().then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`))
    const msA = Date.now() - t0
    out.push(`A: 变化检测 ${msA}ms → text=${JSON.stringify(a.text)} ${a.text === 'external selected text' ? 'PASS' : 'FAIL'}`)
    await sleep(2500)
    out.push(`A: 剪贴板还原 ${clipboard.readText() === '__orig__' ? 'PASS' : 'FAIL'}`)

    // 用例 B：剪贴板无变化（真实场景=无选中/注入失败）→ 应返回空，不误取旧内容
    clipboard.writeText('__no_change__')
    const t1 = Date.now()
    const b = JSON.parse(await js(`window.bridge.selectionGrab().then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`))
    out.push(`B: 无变化场景 ${Date.now() - t1}ms → text=${JSON.stringify(b.text)} ${b.text === '' ? 'PASS' : 'FAIL'}`)

    // 用例 C：快捷键注册链路（设置新快捷键返回成功）
    const c = await js(`window.bridge.shortcutSetSelection('CommandOrControl+Shift+U').then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`)
    out.push(`C: 快捷键重注册=${c} ${c === 'true' ? 'PASS' : 'FAIL'}`)
    // 恢复原快捷键
    await js(`window.bridge.shortcutSetSelection('CommandOrControl+Shift+D').then(r => JSON.stringify(r))`)

    console.log('[e2e-v5]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v5] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
