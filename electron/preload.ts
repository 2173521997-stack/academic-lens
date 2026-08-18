import { contextBridge, ipcRenderer } from 'electron'

export interface StreamHandlers {
  onChunk: (delta: string) => void
  onDone: () => void
  onError: (message: string) => void
}

export interface CompleteHandlers {
  onDone: (content: string, usage?: { promptTokens?: number; completionTokens?: number }) => void
  onError: (message: string) => void
}

const streamMap = new Map<string, StreamHandlers>()
const completeMap = new Map<string, CompleteHandlers>()

function llmStream(id: string, req: unknown, handlers: StreamHandlers): void {
  streamMap.set(id, handlers)
  ipcRenderer.send('llm:stream', id, req)
}

function llmCancel(id: string): void {
  ipcRenderer.send('llm:cancel', id)
}

function llmComplete(id: string, req: unknown, handlers: CompleteHandlers): void {
  completeMap.set(id, handlers)
  ipcRenderer.send('llm:complete', id, req)
}

ipcRenderer.on('llm:chunk', (_e, payload: { id: string; delta: string }) => {
  streamMap.get(payload.id)?.onChunk(payload.delta)
})
ipcRenderer.on('llm:done', (_e, payload: { id: string }) => {
  streamMap.get(payload.id)?.onDone()
  streamMap.delete(payload.id)
})
ipcRenderer.on('llm:error', (_e, payload: { id: string; message: string }) => {
  streamMap.get(payload.id)?.onError(payload.message)
  streamMap.delete(payload.id)
})
ipcRenderer.on('llm:complete-done', (_e, payload: { id: string; content: string; usage?: { promptTokens?: number; completionTokens?: number } }) => {
  completeMap.get(payload.id)?.onDone(payload.content, payload.usage)
  completeMap.delete(payload.id)
})
ipcRenderer.on('llm:complete-error', (_e, payload: { id: string; message: string }) => {
  completeMap.get(payload.id)?.onError(payload.message)
  completeMap.delete(payload.id)
})

/** 订阅事件：返回退订函数，供 useEffect cleanup 使用，防止监听器泄漏 */
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, ...args: T): void => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  storeGet: <T = unknown>(key: string) => ipcRenderer.invoke('store:get', key) as Promise<T | undefined>,
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<Uint8Array>,
  saveFile: (opts: { defaultPath?: string; data: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:save', opts) as Promise<string | null>,
  saveBuffer: (opts: { defaultPath?: string; dataB64: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:saveBuffer', opts) as Promise<string | null>,
  openFiles: () => ipcRenderer.invoke('dialog:openFiles') as Promise<string[]>,
  windowGetState: () => ipcRenderer.invoke('window:getState') as Promise<{ mode: 'mini' | 'full'; alwaysOnTop: boolean }>,
  windowSetMode: (mode: 'mini' | 'full') => ipcRenderer.send('window:setMode', mode),
  windowSetAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:setAlwaysOnTop', flag),
  windowHide: () => ipcRenderer.send('window:hide'),
  onModeChanged: (cb: (mode: 'mini' | 'full') => void) => subscribe('win:mode', cb),
  onFullscreen: (cb: (full: boolean) => void) => subscribe('win:fullscreen', cb),
  onOpenFilePath: (cb: (filePath: string) => void) => subscribe('file:open-path', cb),
  onOpenSettings: (cb: () => void) => subscribe('open:settings', cb),
  onFocusInput: (cb: () => void) => subscribe('mini:focus-input', cb),
  onSelectionText: (cb: (text: string) => void) => subscribe('selection:text', cb),
  onSelectionEmpty: (cb: (message?: string) => void) => subscribe('selection:empty', cb),
  accessibilityGet: () => ipcRenderer.invoke('system:accessibility') as Promise<{ trusted: boolean }>,
  accessibilityOpenSettings: () => ipcRenderer.invoke('system:openAccessibility') as Promise<boolean>,
  shortcutGetStatus: () =>
    ipcRenderer.invoke('shortcut:getStatus') as Promise<{
      toggle: boolean
      mode: boolean
      selection: boolean
      selectionAccel?: string
    }>,
  shortcutAccel: () => ipcRenderer.invoke('shortcut:accel') as Promise<string>,
  selectionTest: () =>
    ipcRenderer.invoke('selection:test') as Promise<{ text: string | null; error: string | null; accel: string }>,
  shortcutRetry: () =>
    ipcRenderer.invoke('shortcut:retry') as Promise<{
      toggle: boolean
      mode: boolean
      selection: boolean
      selectionAccel?: string
    }>,
  onShortcutStatus: (cb: (s: { toggle: boolean; mode: boolean; selection: boolean; selectionAccel?: string }) => void) =>
    subscribe('shortcut:status', cb),
  speak: (text: string, rate?: number) => ipcRenderer.send('speech:speak', { text, rate }),
  llmStream,
  llmCancel,
  llmComplete,
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized') as Promise<boolean>,
  onMaximized: (cb: (max: boolean) => void) => subscribe('win:maximized', cb),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  copyText: (text: string) => ipcRenderer.send('clipboard:write', text)
}

contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
