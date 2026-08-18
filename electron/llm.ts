export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

import { type LLMRequest } from '../src/bridge/types'

// 重新导出渲染侧请求类型，仅新增本进程需要的字段
export type { LLMRequest } from '../src/bridge/types'

export interface LLMResult {
  full: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

function baseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  return u.endsWith('/chat/completions') ? u : `${u}/chat/completions`
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class LLMHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 瞬时错误（网络抖动 / 429 / 5xx）重试；abort 与流式中途失败不重试 */
async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const MAX_ATTEMPTS = 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (signal.aborted) throw err
      lastErr = err
      const status = (err as { status?: number }).status
      const retriable = status === undefined || status === 429 || status >= 500
      if (!retriable || attempt === MAX_ATTEMPTS) throw err
      await sleep(400 * attempt)
    }
  }
  throw lastErr
}

/** fetch + 状态检查包装：网络错误在 fetch reject 中抛出，HTTP 错误带 status 抛出（供重试判断） */
async function fetchChecked(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new LLMHttpError(res.status, `LLM 请求失败 (${res.status}): ${detail.slice(0, 300)}`)
  }
  return res
}

export async function streamLLM(
  req: LLMRequest,
  onChunk: (delta: string) => void,
  signal: AbortSignal
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    temperature: req.temperature ?? 0.4
  }
  if (req.maxTokens) body.max_tokens = req.maxTokens
  if (req.contextLength) body.context_length = req.contextLength

  const res = await withRetry(
    () =>
      fetchChecked(baseUrl(req.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      }),
    signal
  )

  if (!res.body) throw new Error('LLM 无响应体')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buf = ''
  let usage: LLMResult['usage']

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
        if (delta) {
          full += delta
          onChunk(delta)
        }
        // 部分服务端在流末尾附 usage（include_usage）
        if (json.usage) {
          usage = {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens
          }
        }
      } catch {
        /* 忽略无法解析的 SSE 行 */
      }
    }
  }

  return { full, usage }
}

/** 非流式请求（批量翻译 / JSON 模式），带重试与 usage */
export async function llmComplete(
  req: LLMRequest,
  signal: AbortSignal
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: false,
    temperature: req.temperature ?? 0.4
  }
  if (req.maxTokens) body.max_tokens = req.maxTokens
  if (req.json) body.response_format = { type: 'json_object' }
  if (req.contextLength) body.context_length = req.contextLength

  const res = await withRetry(
    () =>
      fetchChecked(baseUrl(req.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      }),
    signal
  )

  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    full: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens
        }
      : undefined
  }
}
