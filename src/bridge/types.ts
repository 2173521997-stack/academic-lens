export interface AppInfo {
  platform: string
  isMac: boolean
  isWin: boolean
  version: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
}

export interface StreamHandlers {
  onChunk: (delta: string) => void
  onDone: () => void
  onError: (message: string) => void
}

export interface OcrSettings {
  provider: 'baidu' | 'openai'
  apiKey: string
  secretKey?: string
  baseUrl?: string
  model?: string
}

export interface OcrResult {
  text: string
  lines: string[]
}

export interface Bridge {
  appInfo: () => Promise<AppInfo>
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>
  storeSet: (key: string, value: unknown) => Promise<boolean>
  readFile: (filePath: string) => Promise<Uint8Array>
  saveFile: (opts: { defaultPath?: string; data: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
  openFiles: () => Promise<string[]>
  windowGetState: () => Promise<{ mode: 'mini' | 'full'; alwaysOnTop: boolean }>
  windowSetMode: (mode: 'mini' | 'full') => void
  windowSetAlwaysOnTop: (flag: boolean) => void
  windowHide: () => void
  onModeChanged: (cb: (mode: 'mini' | 'full') => void) => void
  onSelectionText: (cb: (text: string) => void) => void
  selectionGrab: () => Promise<{ text: string; restored: boolean }>
  ocrRecognize: (base64: string, settings: OcrSettings) => Promise<OcrResult>
  speak: (text: string, rate?: number) => void
  llmStream: (id: string, req: LLMRequest, handlers: StreamHandlers) => void
  llmCancel: (id: string) => void
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximized: (cb: (max: boolean) => void) => void
  openExternal: (url: string) => Promise<unknown>
}

declare global {
  interface Window {
    bridge: Bridge
  }
}
