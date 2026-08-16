import { useSettingsStore } from '../stores/settingsStore'
import type { LLMMessage, StreamHandlers } from '../bridge/types'

let seq = 0

export interface StreamCall {
  cancel: () => void
}

/** 将高频 onChunk 合并为固定间隔批量回调，降低 IPC 与 React 重渲染次数 */
export function batchedChunks(handlers: StreamHandlers, delay = 80): StreamHandlers {
  let buf = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (!buf) return
    const d = buf
    buf = ''
    handlers.onChunk(d)
  }
  return {
    onChunk: (d) => {
      buf += d
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, delay)
      }
    },
    onDone: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      flush()
      handlers.onDone()
    },
    onError: (m) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      flush()
      handlers.onError(m)
    }
  }
}

export function llmStream(
  messages: LLMMessage[],
  handlers: StreamHandlers,
  opts?: { temperature?: number; maxTokens?: number }
): StreamCall {
  const id = `req_${Date.now()}_${++seq}`
  const { settings } = useSettingsStore.getState()
  window.bridge.llmStream(
    id,
    { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, messages, temperature: opts?.temperature, maxTokens: opts?.maxTokens },
    batchedChunks(handlers)
  )
  return {
    cancel: () => window.bridge.llmCancel(id)
  }
}

export function llmChat(
  messages: LLMMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    let full = ''
    const call = llmStream(
      messages,
      {
        onChunk: (d) => (full += d),
        onDone: () => resolve(full),
        onError: (m) => reject(new Error(m))
      },
      opts
    )
    const t = setTimeout(() => {
      call.cancel()
      reject(new Error('请求超时（180s）'))
    }, 180000)
    const origCancel = call.cancel
    call.cancel = () => {
      clearTimeout(t)
      origCancel()
    }
  })
}

export interface JSONCall {
  promise: Promise<string>
  cancel: () => void
}

/** 非流式请求（批量翻译 JSON 模式）：返回 promise + cancel，可被停止翻译取消 */
export function llmJSON(
  messages: LLMMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): JSONCall {
  const id = `req_${Date.now()}_${++seq}`
  const { settings } = useSettingsStore.getState()
  let settled = false

  const promise = new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => {
      window.bridge.llmCancel(id)
      if (!settled) {
        settled = true
        reject(new Error('请求超时（180s）'))
      }
    }, 180000)
    window.bridge.llmComplete(
      id,
      { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, messages, temperature: opts?.temperature, maxTokens: opts?.maxTokens, json: true },
      {
        onDone: (content) => {
          if (!settled) {
            settled = true
            clearTimeout(t)
            resolve(content)
          }
        },
        onError: (m) => {
          if (!settled) {
            settled = true
            clearTimeout(t)
            reject(new Error(m))
          }
        }
      }
    )
  })

  return {
    promise,
    cancel: () => window.bridge.llmCancel(id)
  }
}
