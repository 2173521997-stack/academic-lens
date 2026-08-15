import { contextBridge, ipcRenderer } from 'electron'

export interface StreamHandlers {
  onChunk: (delta: string) => void
  onDone: () => void
  onError: (message: string) => void
}

const streamMap = new Map<string, StreamHandlers>()

function llmStream(id: string, req: unknown, handlers: StreamHandlers): void {
  streamMap.set(id, handlers)
  ipcRenderer.send('llm:stream', id, req)
}

function llmCancel(id: string): void {
  ipcRenderer.send('llm:cancel', id)
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

const bridge = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  storeGet: <T = unknown>(key: string) => ipcRenderer.invoke('store:get', key) as Promise<T | undefined>,
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<Uint8Array>,
  saveFile: (opts: { defaultPath?: string; data: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:save', opts) as Promise<string | null>,
  openFiles: () => ipcRenderer.invoke('dialog:openFiles') as Promise<string[]>,
  windowGetState: () => ipcRenderer.invoke('window:getState') as Promise<{ mode: 'mini' | 'full'; alwaysOnTop: boolean }>,
  windowSetMode: (mode: 'mini' | 'full') => ipcRenderer.send('window:setMode', mode),
  windowSetAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:setAlwaysOnTop', flag),
  windowHide: () => ipcRenderer.send('window:hide'),
  onModeChanged: (cb: (mode: 'mini' | 'full') => void) => {
    ipcRenderer.on('win:mode', (_e, m: 'mini' | 'full') => cb(m))
  },
  onSelectionText: (cb: (text: string) => void) => {
    ipcRenderer.on('selection:text', (_e, t: string) => cb(t))
  },
  onSelectionEmpty: (cb: () => void) => {
    ipcRenderer.on('selection:empty', () => cb())
  },
  selectionGrab: () => ipcRenderer.invoke('selection:grab') as Promise<{ text: string; restored: boolean }>,
  shortcutSetSelection: (accel: string) =>
    ipcRenderer.invoke('shortcut:setSelection', accel) as Promise<boolean>,
  ocrRecognize: (base64: string, settings: unknown) =>
    ipcRenderer.invoke('ocr:recognize', base64, settings) as Promise<{ text: string; lines: string[] }>,
  speak: (text: string, rate?: number) => ipcRenderer.send('speech:speak', { text, rate }),
  llmStream,
  llmCancel,
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized') as Promise<boolean>,
  onMaximized: (cb: (max: boolean) => void) => {
    ipcRenderer.on('win:maximized', (_e, v: boolean) => cb(v))
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
