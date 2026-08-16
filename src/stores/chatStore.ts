import { create } from 'zustand'
import type { LLMMessage } from '../bridge/types'
import { llmStream, type StreamCall } from '../lib/llm'
import { getFileContextForChat } from './fileStore'
import { useHistoryStore } from './historyStore'
import { newId } from '../lib/parse'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  refs?: string[]
  error?: string
}

const SYS_CHAT =
  '你是 Academic Lens 学术助手，帮助用户阅读英文课件与论文。回答用简体中文。' +
  '当内容来自当前文档时，请在引用处标注段落编号，格式如「（段落 3）」。' +
  '支持快捷指令：/总结 /翻译 /解释术语 /推导公式 /出题。'

const COMMANDS: Record<string, string> = {
  '/总结': '请用 3–5 句话总结当前文档的核心内容。',
  '/翻译': '请把当前选中的内容或文档正文翻译成简体中文。',
  '/解释术语': '请解释当前文档中的关键术语，结合上下文给出含义与例子。',
  '/推导公式': '请用大白话讲解当前文档中公式的符号含义与推导思路。',
  '/出题': '请基于当前文档出 3 道理解题，附参考答案。'
}

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  streamingId: string | null
  input: string
  send: (raw?: string) => void
  stop: () => void
  clear: () => void
  setInput: (v: string) => void
  addUserQuick: (refText: string) => void
}

export const useChatStore = create<ChatState>((set, get) => {
  let currentCall: StreamCall | null = null

  const resolveRefs = (raw: string): { content: string; refs: string[] } => {
    const refs: string[] = []
    const content = raw.replace(/@(\d+)/g, (_m, n) => {
      refs.push(`段落 ${n}`)
      const seg = getFileContextForChat()
      return `（引用段落 ${n}${seg ? '，正文见上下文' : ''}）`
    })
    return { content, refs }
  }

  return {
    messages: [],
    streaming: false,
    streamingId: null,
    input: '',

    send: (raw) => {
      const text = (raw ?? get().input).trim()
      if (!text || get().streaming) return

      // @N 引用在发送给 LLM 的内容中真正替换为引用说明
      const { content: finalText, refs } = resolveRefs(text)

      const fileCtx = getFileContextForChat()
      const hist = get().messages.slice(-8).map((m) => ({ role: m.role, content: m.content }) as LLMMessage)
      const userMsg: ChatMessage = { id: newId(), role: 'user', content: finalText, refs }

      let assistant: ChatMessage = { id: newId(), role: 'assistant', content: '' }
      const assistantId = assistant.id

      set({
        messages: [...get().messages, userMsg, assistant],
        streaming: true,
        streamingId: assistantId,
        input: ''
      })

      let resolved = finalText
      if (refs.length) {
        resolved = `${finalText}\n\n（引用：${refs.join('、')}）`
      }
      if (resolved.startsWith('/')) {
        const cmd = resolved.split(/\s+/)[0]
        const template = COMMANDS[cmd]
        if (template) resolved = `${template}\n${fileCtx}`
      }

      const messages: LLMMessage[] = [
        { role: 'system', content: SYS_CHAT + (fileCtx ? `\n\n${fileCtx}` : '') },
        ...hist,
        { role: 'user', content: resolved }
      ]

      const patch = (p: Partial<ChatMessage>): void =>
        set({ messages: get().messages.map((m) => (m.id === assistantId ? { ...m, ...p } : m)) })

      let acc = ''
      currentCall = llmStream(messages, {
        onChunk: (d) => {
          acc += d
          patch({ content: acc })
        },
        onDone: () => {
          patch({ content: acc })
          set({ streaming: false, streamingId: null })
          currentCall = null
          useHistoryStore.getState().add('chat', finalText.slice(0, 40), '已回复')
        },
        onError: (m) => {
          patch({ error: m })
          set({ streaming: false, streamingId: null })
          currentCall = null
        }
      })
    },

    stop: () => {
      currentCall?.cancel()
      currentCall = null
      set({ streaming: false, streamingId: null })
    },

    clear: () => set({ messages: [] }),

    setInput: (v) => set({ input: v }),

    addUserQuick: (refText) => {
      const input = get().input
      set({ input: input ? `${input} ${refText}` : refText })
    }
  }
})
