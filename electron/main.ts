import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  Menu,
  clipboard,
  systemPreferences,
  type WebContents,
  type Rectangle,
  type MenuItemConstructorOptions
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { streamLLM, llmComplete, type LLMRequest } from './llm'
import { store } from './store'
import { grabSelection } from './selection'
import { fileURLToPath } from 'node:url'

// vite-plugin-electron 在 "type": "module" 下输出 ESM，__dirname 不存在，需自行构造
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isSmoke = process.env.ELECTRON_SMOKE === '1'

// 单实例锁：避免多开导致全局快捷键互相抢占
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

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
let isQuitting = false
let pendingOpenFile: string | null = null
let quickGrabBusy = false
const shortcutStatus: Record<'toggle' | 'mode' | 'selection', boolean> = {
  toggle: false,
  mode: false,
  selection: false
}

function sendToWindow(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

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
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    ...(isMac
      ? { vibrancy: 'sidebar' as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.setAlwaysOnTop(st.alwaysOnTop && isMini, 'floating')
  mainWindow.setSkipTaskbar(isMini)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))
  // macOS/Windows 全屏：透明窗口在全屏时有边缘瑕疵，通知渲染层切换实色背景
  mainWindow.on('enter-full-screen', () => sendToWindow('win:fullscreen', true))
  mainWindow.on('leave-full-screen', () => sendToWindow('win:fullscreen', false))
  // macOS：点击红点关闭 = 隐藏（保留全部状态），Cmd+Q 才真正退出
  mainWindow.on('close', (e) => {
    if (isMac && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
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

  // 挂起的 Dock 打开文件：必须等页面加载完成后发送，否则渲染进程尚未监听会丢失
  if (pendingOpenFile) {
    const p = pendingOpenFile
    pendingOpenFile = null
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:open-path', p)
      }
    })
  }

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

  // 保存二进制文件（如 DOCX 导出）：data 为 base64
  ipcMain.handle('file:saveBuffer', async (e, opts: { defaultPath?: string; dataB64: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const picked = await dialog.showSaveDialog(win as BrowserWindow, {
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [{ name: '文档', extensions: ['docx'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    await fs.promises.writeFile(picked.filePath, Buffer.from(opts.dataB64, 'base64'))
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

  // 查询快捷键注册状态，供设置页实时展示
  ipcMain.handle('shortcut:getStatus', () => ({
    ...shortcutStatus
  }))

  // 快捷键被其他 App 占用后手动重试注册
  ipcMain.handle('shortcut:retry', () => {
    globalShortcut.unregisterAll()
    registerShortcuts()
    sendToWindow('shortcut:status', { ...shortcutStatus })
    return { ...shortcutStatus }
  })

  // macOS 辅助功能（自动复制取词）授权状态
  ipcMain.handle('system:accessibility', () => ({
    trusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true
  }))
  ipcMain.handle('system:openAccessibility', () => {
    if (!isMac) return false
    return shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
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

  // 非流式请求（批量翻译 JSON 模式）
  ipcMain.on('llm:complete', (e, id: string, req: LLMRequest) => {
    const wc: WebContents = e.sender
    const ctrl = new AbortController()
    abortControllers.set(id, ctrl)

    const apiKey = req.apiKey || process.env.DEEPSEEK_API_KEY || ''
    if (!apiKey) {
      wc.send('llm:complete-error', { id, message: '未配置 API Key，请在设置中填写' })
      abortControllers.delete(id)
      return
    }

    void (async () => {
      try {
        const res = await llmComplete({ ...req, apiKey }, ctrl.signal)
        wc.send('llm:complete-done', { id, content: res.full, usage: res.usage })
      } catch (err) {
        if (!ctrl.signal.aborted) {
          wc.send('llm:complete-error', {
            id,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      } finally {
        abortControllers.delete(id)
      }
    })()
  })

  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.close())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

  // 复制到系统剪贴板：渲染进程的 navigator.clipboard 在后台/无焦点时不可靠
  ipcMain.on('clipboard:write', (_e, text: string) => {
    if (typeof text === 'string' && text) clipboard.writeText(text)
  })
}

/**
 * 直接读取渲染进程当前的 DOM 选区（软件内划词快路径）：
 * 覆盖普通文本选区与 textarea/input 内选区，零剪贴板、零模拟按键，毫秒级返回。
 */
function readInAppSelection(wc: WebContents): Promise<string> {
  const js = `(() => {
    try {
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.value === 'string') {
        const s = el.selectionStart
        const e = el.selectionEnd
        if (s != null && e != null && e > s) return el.value.slice(s, e).trim()
        return ''
      }
      const sel = window.getSelection()
      return sel && sel.rangeCount ? (sel.toString() || '').trim() : ''
    } catch {
      return ''
    }
  })()`
  return wc
    .executeJavaScript(js, true)
    .then((v) => (typeof v === 'string' ? v.trim() : ''))
    .catch(() => '')
}

/**
 * 一键翻译（Cmd/Ctrl+X）统一入口：
 * - 软件自身聚焦且有 DOM 选区 → 直接读选区，瞬时唤起翻译（不再依赖剪贴板轮询，更灵敏）；
 * - 否则为跨应用划词 → 先 showInactive 弹出小窗（不抢焦点，保证模拟 Cmd+C 落在前台 App），
 *   后台取词完成后聚焦并填入，兼顾速度与 macOS 辅助功能取词的正确性。
 */
async function handleSelectionShortcut(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || quickGrabBusy) return
  quickGrabBusy = true
  try {
    const target = mainWindow
    const focusedInApp = target.isFocused() && target.isVisible() && !target.webContents.isLoading()
    if (focusedInApp) {
      const inApp = await readInAppSelection(target.webContents)
      if (!inApp) return // 软件内无选区（可能正在输入）→ 静默忽略，不弹空窗
      if (getState().mode === 'full') applyMode('mini')
      target.show()
      target.focus()
      target.webContents.send('selection:text', inApp)
      return
    }

    if (getState().mode === 'full') applyMode('mini')
    if (!target.isVisible()) target.showInactive()

    const r = await grabSelection()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const win = mainWindow
    win.show()
    win.focus()
    if (r.text) win.webContents.send('selection:text', r.text)
    else win.webContents.send('selection:empty', r.error)
  } finally {
    quickGrabBusy = false
  }
}

function registerShortcuts(): void {
  // 唤起 / 隐藏小窗：唤起时同步聚焦输入框并切到单词界面，复制内容后 Cmd/Ctrl+V 粘贴即查词
  const okT = globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible() || getState().mode === 'full') {
      if (getState().mode === 'full') applyMode('mini')
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('mini:focus-input')
      return
    }
    mainWindow.hide()
  })
  shortcutStatus.toggle = okT
  if (!okT) console.error('[shortcut] CmdOrCtrl+Shift+T 注册失败（可能被占用）')

  // 任意时刻切换 小窗 / 大窗
  const okM = globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (!mainWindow) return
    applyMode(getState().mode === 'mini' ? 'full' : 'mini')
    mainWindow.show()
    mainWindow.focus()
  })
  shortcutStatus.mode = okM
  if (!okM) console.error('[shortcut] CmdOrCtrl+Shift+M 注册失败（可能被占用）')

  // 一键翻译：Cmd+X = 复制选中 → 唤起小窗 → 自动填入并翻译
  // 软件内选区走 DOM 直读快路径；跨应用取词需 macOS「辅助功能」授权（模拟 Cmd+C 取词）
  const okX = globalShortcut.register('CommandOrControl+X', () => {
    void handleSelectionShortcut()
  })
  shortcutStatus.selection = okX
  if (!okX) console.error('[shortcut] CmdOrCtrl+X 注册失败（可能被占用）')
}

function buildMacMenu(): void {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Academic Lens',
      submenu: [
        { role: 'about', label: '关于 Academic Lens' },
        { type: 'separator' },
        { label: '偏好设置…', accelerator: 'Cmd+,', click: () => sendToWindow('open:settings') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Academic Lens' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Academic Lens' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        ...(isDev
          ? ([
              { role: 'reload' as const, label: '重新加载' },
              { role: 'toggleDevTools' as const, label: '开发者工具' },
              { type: 'separator' as const }
            ])
          : []),
        { role: 'togglefullscreen', label: '进入/退出全屏' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' },
        { type: 'separator' },
        {
          label: '切换小窗 / 大窗',
          accelerator: 'Cmd+Shift+M',
          click: () => {
            if (!mainWindow) return
            applyMode(getState().mode === 'mini' ? 'full' : 'mini')
            mainWindow.show()
            mainWindow.focus()
          }
        },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  registerIpc()
  registerShortcuts()
  sendToWindow('shortcut:status', { ...shortcutStatus })
  if (isMac) {
    buildMacMenu()
    app.setAboutPanelOptions({
      applicationName: 'Academic Lens',
      applicationVersion: app.getVersion(),
      version: '学术透镜 · 英文阅读翻译伴侣',
      copyright: 'Copyright © 2026 Academic Lens'
    })
  }
  createWindow()

  app.on('activate', () => {
    // macOS：Dock 点击时若有窗口则显示，否则重建
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

// macOS：文件拖入 Dock 图标 / Finder 打开方式 → 直接打开翻译（须在 ready 前注册）
app.on('open-file', (e, filePath) => {
  e.preventDefault()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file:open-path', filePath)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    pendingOpenFile = filePath
  }
})

app.on('before-quit', () => {
  isQuitting = true
  store.flush()
})

// 再次启动时聚焦已有窗口（mac 上 Dock 点击）
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
