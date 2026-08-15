import { useSettingsStore } from '../stores/settingsStore'
import type { LLMMessage, StreamHandlers } from '../bridge/types'

let seq = 0

export interface StreamCall {
  cancel: () => void
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
    handlers
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
