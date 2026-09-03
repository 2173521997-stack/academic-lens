const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  await win.loadURL('data:text/html,<html><body>ok</body></html>')
  const out = await win.webContents.executeJavaScript(
    `JSON.stringify({
      version: navigator.userAgent.match(/Chrome\\/(\\d+)/)?.[1],
      hasToHex: typeof Uint8Array.prototype.toHex,
      hasFromHex: typeof Uint8Array.prototype.fromHex
    })`,
    true
  )
  console.log('[check]', out)
  setTimeout(() => app.exit(0), 100)
})
