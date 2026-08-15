process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const watchdog = setTimeout(() => {
  console.log('[e2e-v9] WATCHDOG EXIT')
  process.exit(2)
}, 90000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    // 准备测试 PDF（用 node 而非 process.execPath，后者是 electron 会挂起）
    try {
      execFileSync('node', ['test/gen-pdf.mjs'], { cwd: process.cwd(), env: { ...process.env, OUT: 'test/sample.pdf' }, timeout: 15000 })
    } catch {
      /* 已存在则忽略 */
    }
    const pdfPath = require('node:path').join(process.cwd(), 'test', 'sample.pdf')

    // 用例 A：模拟 macOS open-file（Dock 拖入）→ 渲染层自动解析并进入 FileView
    win.webContents.send('file:open-path', pdfPath)
    let opened = 'TIMEOUT'
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) {
      await sleep(500)
      opened = await js(`(function(){
        const h = document.querySelector('.card h1, .glass p.truncate, header p.truncate');
        const body = document.body.textContent;
        if (body.includes('sample.pdf') && body.includes('双语')) return 'OPENED';
        return null;
      })()`)
      if (opened) break
    }
    out.push(`A: Dock 拖入打开=${opened} ${opened === 'OPENED' ? 'PASS' : 'FAIL'}`)

    // 用例 B：模拟 Cmd+,（偏好设置菜单）→ 切到设置视图
    win.webContents.send('open:settings')
    await sleep(800)
    const settingsView = await js(`(function(){
      const h = Array.from(document.querySelectorAll('h1')).find(x => x.textContent.trim() === '设置');
      return h ? 'SETTINGS-VIEW' : 'NO';
    })()`)
    out.push(`B: Cmd+, 打开设置=${settingsView} ${settingsView === 'SETTINGS-VIEW' ? 'PASS' : 'FAIL'}`)

    // 用例 C：全屏事件 → 实色背景 class
    win.webContents.send('win:fullscreen', true)
    await sleep(400)
    const fsOn = await js(`document.querySelector('.is-fullscreen') ? 'YES' : 'NO'`)
    win.webContents.send('win:fullscreen', false)
    await sleep(400)
    const fsOff = await js(`document.querySelector('.is-fullscreen') ? 'YES' : 'NO'`)
    out.push(`C: 全屏 class 切换=${fsOn}→${fsOff} ${fsOn === 'YES' && fsOff === 'NO' ? 'PASS' : 'FAIL'}`)

    console.log('[e2e-v9]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v9] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
