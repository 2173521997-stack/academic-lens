import type { Bridge, LLMRequest } from './types'

const KEY = 'al_browser'

function read<T>(k: string): T | undefined {
  try {
    const raw = localStorage.getItem(`${KEY}_${k}`)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function write(k: string, v: unknown): void {
  try {
    localStorage.setItem(`${KEY}_${k}`, JSON.stringify(v))
  } catch {
    /* 存储不可用时忽略 */
  }
}

const abortControllers = new Map<string, AbortController>()

function sseStream(req: LLMRequest, handlers: {
  onChunk: (d: string) => void
  onDone: () => void
  onError: (m: string) => void
}, id: string): void {
  void (async () => {
    const ctrl = new AbortController()
    abortControllers.set(id, ctrl)
    try {
      const res = await fetch(`${req.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          temperature: req.temperature ?? 0.4,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
        }),
        signal: ctrl.signal
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        handlers.onError(`LLM 请求失败 (${res.status}): ${detail.slice(0, 200)}`)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const data = t.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content ?? ''
            if (delta) handlers.onChunk(delta)
          } catch {
            /* 忽略 */
          }
        }
      }
      handlers.onDone()
    } catch (err) {
      if (!ctrl.signal.aborted) {
        handlers.onError(err instanceof Error ? err.message : String(err))
      } else {
        handlers.onDone()
      }
    } finally {
      abortControllers.delete(id)
    }
  })()
}

export function createBrowserBridge(): Bridge {
  return {
    appInfo: async () => ({
      platform: 'web',
      isMac: false,
      isWin: false,
      version: '0.1.0-web'
    }),
    storeGet: async <T = unknown>(key: string) => read<T>(key),
    storeSet: async (key: string, value: unknown) => {
      write(key, value)
      return true
    },
    readFile: async () => {
      throw new Error('浏览器模式不支持直接读取文件，请使用 Electron 应用')
    },
    saveFile: async () => null,
    openFiles: async () => [],
    windowGetState: async () => ({ mode: 'full' as const, alwaysOnTop: false }),
    windowSetMode: () => undefined,
    windowSetAlwaysOnTop: () => undefined,
    windowHide: () => undefined,
    onModeChanged: () => undefined,
    onSelectionText: () => undefined,
    onSelectionEmpty: () => undefined,
    selectionGrab: async () => {
      const text = window.getSelection()?.toString().trim() ?? ''
      return { text, restored: true }
    },
    shortcutSetSelection: async () => true,
    ocrRecognize: async () => {
      throw new Error('浏览器模式不支持云端 OCR，请使用桌面版')
    },
    speak: (text) => {
      try {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'en-US'
        u.rate = 1
        window.speechSynthesis.speak(u)
      } catch {
        /* 无语音支持 */
      }
    },
    llmStream: (id, req, handlers) => sseStream(req, handlers, id),
    llmCancel: (id) => {
      abortControllers.get(id)?.abort()
      abortControllers.delete(id)
    },
    minimize: () => undefined,
    toggleMaximize: () => undefined,
    close: () => undefined,
    isMaximized: async () => false,
    onMaximized: () => undefined,
    openExternal: async (url) => {
      window.open(url, '_blank')
      return true
    }
  }
}
