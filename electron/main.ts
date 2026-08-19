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
  Notification,
  Tray,
  nativeImage,
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
import { startClipboardWatch, stopClipboardWatch, markOwnClipboardWrite } from './clipboardWatch'
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
let tray: Tray | null = null
const abortControllers = new Map<string, AbortController>()
let boundsTimer: NodeJS.Timeout | null = null
let isQuitting = false
let pendingOpenFile: string | null = null
const shortcutStatus: Record<'toggle' | 'mode' | 'selection', boolean> = {
  toggle: false,
  mode: false,
  selection: false
}
/** 一键翻译当前生效的触发键（Windows 多键并行，取首个成功注册者展示） */
let selectionAccel = isWin ? 'Ctrl+Shift+X' : 'CommandOrControl+X'
/** 一键翻译全部已注册的触发键 */
const registeredAccels: string[] = []

function sendToWindow(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/** 复制即译：外部应用复制文字 → 唤起小窗自动翻译（自家窗口聚焦时不打扰） */
function handleExternalCopy(text: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isFocused()) return
  if (getState().mode === 'full') applyMode('mini')
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('selection:text', text)
}

/** 按设置开关启动/停止剪贴板监听 */
function applyCopyWatch(): void {
  const cfg = store.get<{ copyWatch?: boolean }>('settings', {})
  if (cfg.copyWatch) startClipboardWatch(handleExternalCopy)
  else stopClipboardWatch()
}

/** 每日复习提醒：到点且今天尚未提醒过时弹系统通知（点击唤起窗口） */
let lastReminderDay = ''
function checkDailyReminder(): void {
  if (!Notification.isSupported()) return
  const cfg = store.get<{ dailyReminder?: boolean; dailyReminderTime?: string }>('settings', {})
  if (!cfg.dailyReminder) return
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const target = cfg.dailyReminderTime ?? '20:00'
  const dayKey = now.toDateString()
  if (dayKey === lastReminderDay || `${hh}:${mm}` !== target) return
  lastReminderDay = dayKey

  // 计算今日到期（含新词）：与 src/lib/srs.ts isDue 保持一致
  const wb = store.get<{ srs?: { due?: number; reps?: number } }[]>('wordbook', [])
  const nowTs = Date.now()
  const due = Array.isArray(wb)
    ? wb.filter((w) => !w.srs || !w.srs.reps || !w.srs.due || w.srs.due <= nowTs).length
    : 0
  if (due <= 0) return

  const n = new Notification({
    title: '该复习单词啦',
    body: due > 1 ? `今天有 ${due} 个单词到期，去闪卡背一背吧` : '有 1 个单词到期，去闪卡复习吧'
  })
  n.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (getState().mode === 'mini') applyMode('full')
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  n.show()
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

  if (!isMac) {
    // Windows：移除默认菜单栏，避免 Alt 组合键被菜单栏吞掉（取词热键失效的根因）
    // 编辑快捷键（Ctrl+C/V/X/A）用 before-input-event 兜底，右键菜单用 context-menu 补充
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown' || !input.control || input.meta || input.alt) return
      const k = input.key.toLowerCase()
      const wc = mainWindow?.webContents
      if (!wc) return
      if (k === 'c') {
        wc.copy()
        _e.preventDefault()
      } else if (k === 'v') {
        wc.paste()
        _e.preventDefault()
      } else if (k === 'x') {
        wc.cut()
        _e.preventDefault()
      } else if (k === 'a') {
        wc.selectAll()
        _e.preventDefault()
      }
    })
    mainWindow.webContents.on('context-menu', (_e, params) => {
      const wc = mainWindow?.webContents
      if (!wc) return
      const tpl: MenuItemConstructorOptions[] = []
      if (params.isEditable) {
        tpl.push({ role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { type: 'separator' }, { role: 'selectAll', label: '全选' })
      } else if (params.selectionText.trim().length > 0) {
        tpl.push({ role: 'copy', label: '复制' })
      } else {
        return
      }
      Menu.buildFromTemplate(tpl).popup({ window: mainWindow ?? undefined })
    })
  }

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

/** 调试日志：写入系统临时目录 al-debug.log（排障用，发布可保留无副作用） */
function debugLog(msg: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('temp'), 'al-debug.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 忽略 */
  }
}

/** 唤起小窗（托盘/热键共用）：切 mini → 显示 → 聚焦 */
function showMiniWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (getState().mode === 'full') applyMode('mini')
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 系统托盘：随时可唤回小窗（热键被系统/输入法吞掉时的终极兜底） */
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHGSURBVFhH7ZYhTwNBEIVXViKRyMrKykokEllZWUFCd5vQOmQFEgGuhuQQJFVI0p/QoJpgKpG4GfLuUsjO3N7dHreOl3zi2tmd2Z2Z3TXmX23leGDmPPoB30m14J5xPDaO1sbSl3HM5VBmHE3Mgk/kFO2FCR0dtLMKLH2aGU3zwFsLq7C0VZNHQTtzzWdy6nphkKO9nrAF2A3USWNh5V05P4IgLPelKy3k7M/bHoL29cWJwlEDO2ROK+nyV3mrRVZ7LGjhKz6Vrgvl7VYyqHPoVrou5GijjVNAO+n62PMVJ5ymv2Ie3TMP7vR/taiOcDRURhVMX9jT6k3bVGL5wg8AP0ijAFh5mc4ftW0QdJuniAKcPEvXhZav2jaI5aUfgKVLZRQAeS/T+EnbBrE88wMo7nRtGGDz7jvffjD3brRdECzYEw4HaVQDUoFtR0FGOc+hoR8AlOwOkNBBui6EwlDGCbD0IF0XQhoiD6OWVLwfcVvpAR1CmXTpKy/GRDcidlcdwWVChaZIhWq9KsG4yyDUyddEOJzwlpOTxZBve8zKpYqaWKuJG0FZs5w3EVoH/VtXoPmO0TruGR4rFCmuU+T1CL6TOk2kb0G/WOqP3ayeAAAAAElFTkSuQmCC'

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Academic Lens · 学术透镜')
  const rebuildMenu = (): void => {
    const copyWatch = store.get<{ copyWatch?: boolean }>('settings', {}).copyWatch === true
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开小窗翻译', click: showMiniWindow },
        { type: 'separator' },
        {
          label: '复制即译（任意应用 Ctrl+C 即翻译）',
          type: 'checkbox',
          checked: copyWatch,
          click: (item) => {
            const cfg = store.get<Record<string, unknown>>('settings', {})
            store.set('settings', { ...cfg, copyWatch: item.checked })
            applyCopyWatch()
            rebuildMenu()
          }
        },
        { type: 'separator' },
        { label: '设置…', click: () => { showMiniWindow(); sendToWindow('open:settings') } },
        { label: '退出', click: () => app.quit() }
      ])
    )
  }
  rebuildMenu()
  tray.on('click', showMiniWindow)
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
    if (key === 'settings') applyCopyWatch()
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
    ...shortcutStatus,
    selectionAccel,
    registeredAccels: [...registeredAccels]
  }))

  // 当前生效的一键翻译触发键
  ipcMain.handle('shortcut:accel', () => selectionAccel)

  // 一键翻译自检：模拟热键流程，返回剪贴板取词结果
  ipcMain.handle('selection:test', async () => {
    const r = await grabSelection({ onOwnWrite: markOwnClipboardWrite })
    return { text: r.text || null, error: r.error ?? null, accel: registeredAccels.join(' · ') || selectionAccel }
  })

  // 快捷键被其他 App 占用后手动重试注册
  ipcMain.handle('shortcut:retry', () => {
    globalShortcut.unregisterAll()
    registerShortcuts()
    sendToWindow('shortcut:status', { ...shortcutStatus, selectionAccel, registeredAccels: [...registeredAccels] })
    return { ...shortcutStatus, selectionAccel, registeredAccels: [...registeredAccels] }
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
    if (typeof text === 'string' && text) {
      clipboard.writeText(text)
      markOwnClipboardWrite()
    }
  })

  // 渲染层调试日志
  ipcMain.on('debug:log', (_e, msg: string) => {
    debugLog(`[renderer] ${msg}`)
  })
}

/**
 * 一键翻译触发键注册。
 * Windows：Ctrl+Shift+X（避开 Alt 系——Alt+X 常被截图/输入法类软件占用，
 * 也避免与系统的 Ctrl+X 剪切冲突）；macOS：⌘X。
 */
function registerSelectionShortcut(): boolean {
  const candidates = isWin ? ['Ctrl+Shift+X'] : ['CommandOrControl+X']
  registeredAccels.length = 0
  let anyOk = false
  for (const acc of candidates) {
    const ok = globalShortcut.register(acc, () => {
      if (!mainWindow) return
      debugLog(`HOTKEY fired: ${acc}, visible=${mainWindow.isVisible()}, focused=${mainWindow.isFocused()}, mode=${getState().mode}`)
      void (async () => {
        // 不判断焦点（Windows 上 isFocused() 与实际前台窗口可能不一致）：
        // 无条件取词——前台是外部应用则成功；是自家窗口且无选中则自然提示
        const r = await grabSelection({ onOwnWrite: markOwnClipboardWrite })
        debugLog(`grab result: textLen=${r.text?.length ?? 0}, error=${r.error ?? 'none'}`)
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (getState().mode === 'full') applyMode('mini')
        mainWindow.show()
        mainWindow.focus()
        if (r.text) mainWindow.webContents.send('selection:text', r.text)
        else mainWindow.webContents.send('selection:empty', r.error)
      })()
    })
    if (ok) {
      anyOk = true
      registeredAccels.push(acc)
    }
  }
  selectionAccel = registeredAccels[0] ?? (isWin ? 'Ctrl+Shift+X' : 'CommandOrControl+X')
  return anyOk
}

function registerShortcuts(): void {
  // 唤起小窗：永远显示+聚焦输入框（不再"可见即隐藏"，避免误按后窗口消失的困惑；隐藏走 Esc/托盘）
  const okT = globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!mainWindow) return
    showMiniWindow()
    mainWindow.webContents.send('mini:focus-input')
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

  // 一键翻译：macOS ⌘X / Windows Ctrl+Shift+X = 复制选中 → 唤起小窗 → 自动填入并翻译
  // Windows 用 Ctrl+Shift+X：不劫持系统的「剪切 Ctrl+X」，也不占用 Alt 系（避免与截图软件冲突）
  // 注意顺序：必须先取词再唤起——若先 show/focus 小窗，模拟 Ctrl+C 会复制小窗自己而非前台 App
  // 若自家小窗可见且聚焦，先隐藏让前台回到之前的应用，再取词
  const okX = registerSelectionShortcut()
  shortcutStatus.selection = okX
  if (!okX) console.error(`[shortcut] ${selectionAccel} 及其备选键全部注册失败（可能被占用）`)
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
  if (!isMac) {
    // Windows：移除默认菜单栏，避免 Alt 组合键被菜单栏抢占（取词热键失效根因）
    Menu.setApplicationMenu(null)
  }
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
  createTray()
  setInterval(checkDailyReminder, 30000)
  applyCopyWatch()

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
