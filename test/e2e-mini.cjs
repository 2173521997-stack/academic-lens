process.env.ELECTRON_SMOKE = ''
const watchdog = setTimeout(() => {
  console.log('[e2e-mini] WATCHDOG EXIT')
  process.exit(2)
}, 45000)

try {
  require('../dist-electron/main.js')
} catch (e) {
  console.log('[e2e-mini] main.js require failed:', e.message)
  process.exit(3)
}

const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  try {
    await new Promise((r) => setTimeout(r, 3000))
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      console.log('[e2e-mini] NO WINDOW')
      app.exit(1)
      return
    }
  const out = []
  out.push('initial bounds=' + JSON.stringify(win.getBounds()))

  const st = await win.webContents.executeJavaScript(`window.bridge.windowGetState()`, true)
  out.push('state=' + JSON.stringify(st))

  await win.webContents.executeJavaScript(`window.bridge.windowSetMode('full')`, true)
  await new Promise((r) => setTimeout(r, 800))
  out.push('after-full bounds=' + JSON.stringify(win.getBounds()))
  out.push('after-full alwaysOnTop=' + win.isAlwaysOnTop())

  await win.webContents.executeJavaScript(`window.bridge.windowSetAlwaysOnTop(true)`, true)
  await win.webContents.executeJavaScript(`window.bridge.windowSetMode('mini')`, true)
  await new Promise((r) => setTimeout(r, 800))
  out.push('after-mini bounds=' + JSON.stringify(win.getBounds()))
  out.push('after-mini alwaysOnTop=' + win.isAlwaysOnTop())

  out.push('ui mode = ' + await win.webContents.executeJavaScript(
    `document.querySelector('.mini-window') ? 'mini-layout' : 'full-layout'`, true
  ))

  await win.webContents.executeJavaScript(`window.bridge.speak('Attention is all you need.')`, true)
  await new Promise((r) => setTimeout(r, 2000))
  out.push('speak: no crash')

  console.log('[e2e-mini]')
  console.log(out.join('\n'))
  app.exit(0)
  } catch (e) {
    console.log('[e2e-mini] TEST ERROR:', e && e.message)
    console.log(e && e.stack)
    app.exit(1)
  }
})
