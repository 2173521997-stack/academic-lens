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

export interface LLMResult {
  full: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

function baseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  return u.endsWith('/chat/completions') ? u : `${u}/chat/completions`
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

  const res = await fetch(baseUrl(req.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`
    },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${res.status}): ${detail.slice(0, 300)}`)
  }

  if (!res.body) throw new Error('LLM 无响应体')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
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
        if (delta) {
          full += delta
          onChunk(delta)
        }
      } catch {
        /* 忽略无法解析的 SSE 行 */
      }
    }
  }

  return { full }
}
