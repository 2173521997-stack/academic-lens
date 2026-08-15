import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  type WebContents,
  type Rectangle
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { streamLLM, type LLMRequest } from './llm'
import { store } from './store'
import { grabSelection } from './selection'
import { recognizeWithRetry, type OcrSettings } from './ocr'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isSmoke = process.env.ELECTRON_SMOKE === '1'

const MINI_SIZE = { width: 420, height: 560 }
const FULL_SIZE = { width: 1280, height: 800 }

interface WindowState {
  mode: 'mini' | 'full'
  alwaysOnTop: boolean
  miniBounds?: Rectangle
  fullBounds?: Rectangle
}

const defaultState: WindowState = { mode: 'mini', alwaysOnTop: false }

function getState(): WindowState {
  const saved = store.get<Partial<WindowState>>('windowState', {})
  return { ...defaultState, ...saved }
}

let mainWindow: BrowserWindow | null = null
const abortControllers = new Map<string, AbortController>()
let boundsTimer: NodeJS.Timeout | null = null

function collectBounds(): void {
  if (!mainWindow) return
  const st = getState()
  const b = mainWindow.getBounds()
  if (st.mode === 'mini') st.miniBounds = b
  else st.fullBounds = b
  store.set('windowState', st)
}

function applyMode(mode: 'mini' | 'full'): void {
  if (!mainWindow) return
  const st = getState()
  if (st.mode === mode) return
  st.mode = mode
  store.set('windowState', st)

  const target =
    mode === 'mini'
      ? st.miniBounds ?? MINI_SIZE
      : st.fullBounds ?? FULL_SIZE

  mainWindow.setBounds(target)
  mainWindow.setAlwaysOnTop(st.alwaysOnTop && mode === 'mini', 'floating')
  mainWindow.setSkipTaskbar(mode === 'mini')
  mainWindow.setResizable(true)
  if (isMac) mainWindow.setWindowButtonVisibility(mode === 'full')

  collectBounds()
  mainWindow.webContents.send('win:mode', mode)
}

function createWindow(): void {
  const st = getState()
  const isMini = st.mode === 'mini'
  const bounds = isMini ? st.miniBounds ?? MINI_SIZE : st.fullBounds ?? FULL_SIZE

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 420,
    show: false,
    title: 'Academic Lens',
    titleBarStyle: 'hidden',
    transparent: true,
    ...(isMac
      ? { vibrancy: 'sidebar' as const, trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.setAlwaysOnTop(st.alwaysOnTop && isMini, 'floating')
  mainWindow.setSkipTaskbar(isMini)
  if (isMac) mainWindow.setWindowButtonVisibility(!isMini)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))
  mainWindow.on('move', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(collectBounds, 500)
  })
  mainWindow.on('resize', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(collectBounds, 500)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[smoke] window loaded OK')
      setTimeout(() => {
        console.log('[smoke] quitting')
        app.quit()
      }, 2500)
    })
  }
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    isMac,
    isWin,
    version: app.getVersion()
  }))

  ipcMain.handle('store:get', (_e, key: string) => store.get(key, undefined))
  ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
    store.set(key, value)
    return true
  })

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const buf = await fs.promises.readFile(filePath)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  })

  ipcMain.handle('file:save', async (e, opts: { defaultPath?: string; data: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const picked = await dialog.showSaveDialog(win as BrowserWindow, {
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (picked.canceled || !picked.filePath) return null
    await fs.promises.writeFile(picked.filePath, opts.data, 'utf-8')
    return picked.filePath
  })

  ipcMain.handle('dialog:openFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const picked = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文档与图片', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return picked.canceled ? [] : picked.filePaths
  })

  ipcMain.handle('window:getState', () => {
    const st = getState()
    return { mode: st.mode, alwaysOnTop: st.alwaysOnTop }
  })

  ipcMain.on('window:setMode', (_e, mode: 'mini' | 'full') => applyMode(mode))

  ipcMain.on('window:setAlwaysOnTop', (_e, flag: boolean) => {
    const st = getState()
    st.alwaysOnTop = flag
    store.set('windowState', st)
    mainWindow?.setAlwaysOnTop(flag && st.mode === 'mini', 'floating')
  })

  ipcMain.on('window:hide', () => {
    if (mainWindow && getState().mode === 'mini') mainWindow.hide()
  })

  ipcMain.on('speech:speak', (_e, payload: { text: string; rate?: number }) => {
    const text = payload.text.trim()
    if (!text) return
    const rate = payload.rate ?? 1
    const done = (err: Error | null): void => {
      if (err) console.error('speak failed:', err.message)
    }
    if (isMac) {
      const wordsPerMinute = Math.round(175 * rate)
      execFile('say', ['-r', String(wordsPerMinute), text], done)
    } else if (isWin) {
      const synthRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))
      const ps =
        `Add-Type -AssemblyName System.Speech;` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;` +
        `$s.Rate = ${synthRate};` +
        `$s.Speak(${JSON.stringify(text)});`
      const encoded = Buffer.from(ps, 'utf16le').toString('base64')
      execFile('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], done)
    }
  })

  ipcMain.handle('selection:grab', async () => {
    const result = await grabSelection()
    return result
  })

  ipcMain.handle('ocr:recognize', async (_e, base64: string, settings: OcrSettings) => {
    return recognizeWithRetry(base64, settings)
  })

  ipcMain.on('llm:stream', (e, id: string, req: LLMRequest) => {
    const wc: WebContents = e.sender
    const ctrl = new AbortController()
    abortControllers.set(id, ctrl)

    const apiKey = req.apiKey || process.env.DEEPSEEK_API_KEY || ''
    if (!apiKey) {
      wc.send('llm:error', { id, message: '未配置 API Key，请在设置中填写' })
      abortControllers.delete(id)
      return
    }

    void (async () => {
      try {
        await streamLLM(
          { ...req, apiKey },
          (delta) => wc.send('llm:chunk', { id, delta }),
          ctrl.signal
        )
        wc.send('llm:done', { id })
      } catch (err) {
        if (!ctrl.signal.aborted) {
          wc.send('llm:error', {
            id,
            message: err instanceof Error ? err.message : String(err)
          })
        } else {
          wc.send('llm:done', { id })
        }
      } finally {
        abortControllers.delete(id)
      }
    })()
  })

  ipcMain.on('llm:cancel', (_e, id: string) => {
    abortControllers.get(id)?.abort()
    abortControllers.delete(id)
  })

  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.close())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
}

function registerShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    if (getState().mode === 'mini') {
      mainWindow.hide()
    } else {
      mainWindow.focus()
    }
  })

  // 任意时刻切换 小窗 / 大窗
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (!mainWindow) return
    applyMode(getState().mode === 'mini' ? 'full' : 'mini')
    mainWindow.show()
    mainWindow.focus()
  })

  // 全局划词：不抢焦点取前台选中文本 → 唤起小窗翻译
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (!mainWindow) return
    const win = mainWindow
    void grabSelection().then((result) => {
      const text = result.text
      if (!text) return
      if (getState().mode === 'full') applyMode('mini')
      win.show()
      win.focus()
      win.webContents.send('selection:text', text)
    })
  })
}

app.whenReady().then(() => {
  registerIpc()
  registerShortcuts()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
