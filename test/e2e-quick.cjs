process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-quick] WATCHDOG EXIT')
  process.exit(2)
}, 90000)

app.whenReady().then(async () => {
  try {
    await new Promise((r) => setTimeout(r, 3000))
    const win = BrowserWindow.getAllWindows()[0]

    const script = `
      (async () => {
        const el = document.querySelector('textarea');
        if (!el) return 'NO TEXTAREA';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, 'Attention is all you need.');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const t0 = Date.now();
        while (Date.now() - t0 < 40000) {
          await new Promise(r => setTimeout(r, 300));
          const card = document.querySelector('.card.select-text, .mini-window .card');
          if (card && card.textContent.includes('注意')) {
            return 'OK ' + Math.round((Date.now() - t0) / 1000) + 's text=' + card.textContent.slice(0, 60);
          }
        }
        return 'TIMEOUT lastCard=' + (document.querySelector('.mini-window .card')?.textContent || '').slice(0, 100);
      })()
    `

    const out = await win.webContents.executeJavaScript(script, true)
    console.log('[e2e-quick]', out)
    app.exit(0)
  } catch (e) {
    console.log('[e2e-quick] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
