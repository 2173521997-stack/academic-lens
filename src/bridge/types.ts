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
  /** 输入上下文长度上限（OpenAI 兼容端点透传 context_length），用于扩大多轮可见窗口 */
  contextLength?: number
  json?: boolean
}

export interface StreamHandlers {
  onChunk: (delta: string) => void
  onDone: () => void
  onError: (message: string) => void
}

export interface CompleteHandlers {
  onDone: (content: string, usage?: { promptTokens?: number; completionTokens?: number }) => void
  onError: (message: string) => void
}

export interface Bridge {
  appInfo: () => Promise<AppInfo>
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>
  storeSet: (key: string, value: unknown) => Promise<boolean>
  readFile: (filePath: string) => Promise<Uint8Array>
  saveFile: (opts: { defaultPath?: string; data: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
  saveBuffer: (opts: { defaultPath?: string; dataB64: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
  openFiles: () => Promise<string[]>
  windowGetState: () => Promise<{ mode: 'mini' | 'full'; alwaysOnTop: boolean }>
  windowSetMode: (mode: 'mini' | 'full') => void
  windowSetAlwaysOnTop: (flag: boolean) => void
  windowHide: () => void
  onModeChanged: (cb: (mode: 'mini' | 'full') => void) => () => void
  onFullscreen: (cb: (full: boolean) => void) => () => void
  onOpenFilePath: (cb: (filePath: string) => void) => () => void
  onOpenSettings: (cb: () => void) => () => void
  onFocusInput: (cb: () => void) => () => void
  onSelectionText: (cb: (text: string) => void) => () => void
  onSelectionEmpty: (cb: (message?: string) => void) => () => void
  accessibilityGet: () => Promise<{ trusted: boolean }>
  accessibilityOpenSettings: () => Promise<boolean>
  shortcutGetStatus: () => Promise<{ toggle: boolean; mode: boolean; selection: boolean }>
  shortcutRetry: () => Promise<{ toggle: boolean; mode: boolean; selection: boolean }>
  onShortcutStatus: (cb: (s: { toggle: boolean; mode: boolean; selection: boolean }) => void) => () => void
  speak: (text: string, rate?: number) => void
  llmStream: (id: string, req: LLMRequest, handlers: StreamHandlers) => void
  llmCancel: (id: string) => void
  llmComplete: (id: string, req: LLMRequest, handlers: CompleteHandlers) => void
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximized: (cb: (max: boolean) => void) => () => void
  openExternal: (url: string) => Promise<unknown>
  copyText: (text: string) => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}
