const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const abortControllers = new Map()

ipcMain.handle('store:get', () => undefined)
ipcMain.handle('store:set', () => true)
ipcMain.handle('app:info', () => ({ platform: process.platform, isMac: false, isWin: true, version: 'test' }))
ipcMain.handle('win:isMaximized', () => false)

ipcMain.on('llm:stream', (e, id, req) => {
  const ctrl = new AbortController()
  abortControllers.set(id, ctrl)
  void (async () => {
    try {
      const mod = await import('../electron/llm.ts')
      await mod.streamLLM(
        { ...req, apiKey: req.apiKey || process.env.DEEPSEEK_API_KEY },
        (delta) => e.sender.send('llm:chunk', { id, delta }),
        ctrl.signal
      )
      e.sender.send('llm:done', { id })
    } catch (err) {
      if (!ctrl.signal.aborted) e.sender.send('llm:error', { id, message: String(err && err.message || err) })
      else e.sender.send('llm:done', { id })
    } finally {
      abortControllers.delete(id)
    }
  })()
})
ipcMain.on('llm:cancel', (_e, id) => abortControllers.get(id)?.abort())

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist-electron/preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  await win.loadURL('data:text/html,<html><body>x</body></html>')
  await new Promise((r) => setTimeout(r, 500))

  const key = process.env.DEEPSEEK_API_KEY
  const script = `
    (async () => {
      const results = [];
      const t0 = performance.now();
      let chunks = 0, full = '';
      const ok = await Promise.race([
        new Promise((resolve) => {
          window.bridge.llmStream(
            'e2e_test',
            {
              baseUrl: 'https://api.deepseek.com',
              apiKey: ${JSON.stringify(key || '')},
              model: 'deepseek-chat',
              messages: [
                { role: 'system', content: '你是学术翻译。' },
                { role: 'user', content: 'Translate to Chinese: "Attention is all you need."' }
              ],
              maxTokens: 100
            },
            {
              onChunk: (d) => { chunks++; full += d; },
              onDone: () => resolve(true),
              onError: (m) => { results.push('stream error: ' + m); resolve(false); }
            }
          );
        }),
        new Promise((r) => setTimeout(() => r('timeout'), 60000))
      ]);
      if (ok === 'timeout') results.push('TIMEOUT waiting for stream');
      const ms = Math.round(performance.now() - t0);
      if (ok) {
        results.push('OK ' + ms + 'ms, ' + chunks + ' chunks, ' + full.length + ' chars');
        results.push('output=' + full);
      }
      return results.join('\\n');
    })()
  `

  const out = await win.webContents.executeJavaScript(script, true)
  console.log('[e2e-llm]')
  console.log(out)
  app.exit(0)
})
