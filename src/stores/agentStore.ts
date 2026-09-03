import { create } from 'zustand'
import { llmStream, agentStream, type StreamCall } from '../lib/llm'
import { runTool } from '../lib/agentTools'
import { runReAct, resolveByRules } from '../lib/agentLoop'
import { useSettingsStore } from './settingsStore'
import { useAppStore } from './appStore'
import { useWindowStore } from './windowStore'
import { useWordbookStore } from './wordbookStore'
import { useFileStore, getFileContextForChat } from './fileStore'
import type { LLMMessage } from '../bridge/types'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  label?: string
  error?: string
  isDeepDoc?: boolean
  refs?: string[]
}

export type AgentReasoningMode = 'fast' | 'deep'

interface AgentState {
  messages: AgentMessage[]
  streaming: boolean
  streamingId: string | null
  input: string
  reasoningMode: AgentReasoningMode
  hasAgentApi: boolean
  setReasoningMode: (mode: AgentReasoningMode) => void
  send: (text?: string) => void
  stop: () => void
  clear: () => void
  setInput: (v: string) => void
  appendInput: (refText: string) => void
  /** 小窗唤起 AI 助手：切到大窗并打开面板，把当前内容作为提问转发给助手 */
  askFromMini: (text?: string) => void
}

let seq = 0
function newId(): string {
  return `msg_${Date.now()}_${++seq}`
}

let history: LLMMessage[] = []
const CONTEXT_WINDOW = 14
let call: StreamCall | null = null

const SYS_CHAT_BASE =
  '你是 Academic Lens 的高级学术伴读与智能桌面助手。回答使用简体中文，保持学术严谨、逻辑清晰、用词准确。' +
  '你具备直接操作软件各项功能（开始/停止翻译、增删生词、导出双语文档、检索六级/考研/雅思/托福词库、切换主题等）的完整系统权限。' +
  '对于学术考点、长难句拆解、雅思写作评分、理工科公式推演，给出专业权威、条理分明的解答。' +
  '引用当前文档原文时，请用【P段落序号】标注（如 【P12】），方便用户点击定位原文；当前没有文档时，不要臆造段落引用。'

/** 从输入中提取 @段落 引用（如 @12 或 @段落12） */
function extractParagraphRefs(text: string): { resolvedText: string; refs: string[] } {
  const refs: string[] = []
  const resolved = text.replace(/@(?:段落)?(\d+)/g, (_match, num) => {
    const segs = useFileStore.getState().segments
    const idx = parseInt(num, 10) - 1
    if (idx >= 0 && idx < segs.length) {
      refs.push(`段落${num}`)
      return `【引用段落 ${num}：${segs[idx].text}】`
    }
    return _match
  })
  return { resolvedText: resolved, refs }
}

export const useAgentStore = create<AgentState>((set, get) => {
  const saveSession = (msgs: AgentMessage[]): void => {
    void window.bridge.storeSet('unifiedAgentSession', msgs.slice(-50))
  }

  const patchMessage = (id: string, patch: Partial<AgentMessage>): void => {
    if (!get().messages.some((m) => m.id === id)) return
    set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
  }

  const finalizeAssistant = (msgId: string, content: string): void => {
    set({
      messages: get().messages.map((m) =>
        m.id === msgId ? { ...m, content, role: 'assistant', label: undefined } : m
      ),
      streaming: false,
      streamingId: null,
      input: ''
    })
    history.push({ role: 'assistant', content })
    call = null
    saveSession(get().messages)
  }

  const finishError = (msgId: string, label: string, err: string): void => {
    const fallback = `处理异常：${err}`
    patchMessage(msgId, { content: fallback, role: 'assistant', error: err, label })
    history.push({ role: 'assistant', content: fallback })
    set({ streaming: false, streamingId: null, input: '' })
    call = null
    saveSession(get().messages)
  }

  const send = (raw?: string): void => {
    const rawInput = (raw ?? get().input).trim()
    if (!rawInput || get().streaming) return

    const { resolvedText, refs } = extractParagraphRefs(rawInput)
    const fileDoc = useFileStore.getState().doc
    const isDeepMode = get().reasoningMode === 'deep'

    // 判断是否激活全文深度研读模式（带 ?/？ 或 快捷指令 / 引用）
    const isDeepQuery = Boolean(
      fileDoc &&
        (rawInput.includes('?') ||
          rawInput.includes('？') ||
          rawInput.startsWith('/') ||
          rawInput.includes('@'))
    )

    const userMsgId = newId()
    const assistantMsgId = newId()

    const userMsg: AgentMessage = {
      id: userMsgId,
      role: 'user',
      content: rawInput,
      refs: refs.length ? refs : undefined,
      isDeepDoc: isDeepQuery
    }

    const placeholderMsg: AgentMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      label: isDeepMode ? '🧠 深度推理中…' : isDeepQuery ? '深度解析中…' : '思考中…'
    }

    set({
      messages: [...get().messages, userMsg, placeholderMsg],
      streaming: true,
      streamingId: assistantMsgId,
      input: ''
    })
    history.push({ role: 'user', content: resolvedText })

    void (async () => {
      // 0) 明显要操作“当前文档”却未打开 → 秒回提示（不消耗 Token）
      //    仅拦截意图明确的指令，避免误伤普通问答（如“总结一下学习方法”）
      const wantsDoc =
        rawInput.startsWith('/') ||
        rawInput.includes('@段落') ||
        /(全文|该文|本文|当前文档)/.test(rawInput)
      if (wantsDoc && !fileDoc) {
        finalizeAssistant(
          assistantMsgId,
          '当前还没有打开任何文档 📄。\n\n「/总结全文」「/论文润色」「导出双语」「提取术语」「@段落 引用」这类指令需要基于具体文档才能执行。\n\n请先点击左侧「翻译」，打开一篇 PDF / Word / TXT / Markdown，再回来问我～'
        )
        return
      }

      // 1) 确定性单工具快路径（零 Token 毫秒级响应）
      const ruleHit = resolveByRules(rawInput)
      if (ruleHit.toolCall) {
        const tool = ruleHit.toolCall.tool
        const label = `系统权限：${tool.name}`
        patchMessage(assistantMsgId, { label })
        try {
          const out = await runTool(tool.id, ruleHit.toolCall.params)
          const outText = out.text || '（已完成）'
          patchMessage(assistantMsgId, { content: outText, label })

          const prompt: LLMMessage[] = [
            {
              role: 'system',
              content: `${SYS_CHAT_BASE}\n${wordbookContext()}${buildDocContext()}`
            },
            ...history.slice(-CONTEXT_WINDOW),
            {
              role: 'assistant',
              content: `已调用系统权限「${tool.name}」完成操作，执行结果：\n${outText}`
            }
          ]

          // 流式生成一句总结
          let reply = ''
          const streamFn = isDeepMode ? llmStream : agentStream
          call = streamFn(
            prompt,
            {
              onChunk: (d) => {
                reply += d
                patchMessage(assistantMsgId, { content: reply, label })
              },
              onDone: () => finalizeAssistant(assistantMsgId, reply.trim() || outText),
              onError: (m) => finishError(assistantMsgId, label, m)
            },
            { temperature: 0.3, maxTokens: 1400 }
          )
        } catch (err) {
          finishError(assistantMsgId, label, err instanceof Error ? err.message : String(err))
        }
        return
      }

      // 2) 全文深度学术研读路径：深度思考走主模型，极速模式走免费 GLM（经济优先）
      if (isDeepQuery) {
        patchMessage(assistantMsgId, {
          label: isDeepMode ? '🧠 深度思考 · 全文研读' : '学术研读 · 全文解析（免费 GLM）'
        })
        const fileCtx = getFileContextForChat()
        const deepSys = `${SYS_CHAT_BASE}\n\n[当前正在阅读文献全文上下文]\n${fileCtx}`
        const prompt: LLMMessage[] = [
          { role: 'system', content: deepSys },
          ...history.slice(-CONTEXT_WINDOW)
        ]

        let reply = ''
        const streamFn = isDeepMode ? llmStream : agentStream
        call = streamFn(
          prompt,
          {
            onChunk: (d) => {
              reply += d
              patchMessage(assistantMsgId, {
                content: reply,
                label: isDeepMode ? '🧠 深度思考 · 全文研读' : '学术研读 · 全文解析（免费 GLM）'
              })
            },
            onDone: () => finalizeAssistant(assistantMsgId, reply.trim() || '（已完成）'),
            onError: (m) => finishError(assistantMsgId, '学术研读', m)
          },
          { temperature: 0.2, maxTokens: 4096 }
        )
        return
      }

      // 3) ReAct 多步智能体循环（自主工具规划与执行）
      try {
        const { answer } = await runReAct(resolvedText, {
          deepReasoning: isDeepMode,
          onStep: (step) => {
            if (step.kind !== 'tool') return
            set((s) => ({
              messages: [
                ...s.messages,
                { id: newId(), role: 'tool', content: step.observation ?? '', label: `系统操作：${step.toolLabel}` }
              ]
            }))
          }
        })
        finalizeAssistant(assistantMsgId, answer || '（已完成）')
      } catch (err) {
        finishError(assistantMsgId, 'AI 智能体', err instanceof Error ? err.message : String(err))
      }
    })()
  }

  return {
    messages: [],
    streaming: false,
    streamingId: null,
    input: '',
    reasoningMode: 'fast',
    hasAgentApi: Boolean(
      useSettingsStore.getState().settings.agentApiKey || useSettingsStore.getState().settings.apiKey
    ),
    setReasoningMode: (m) => set({ reasoningMode: m }),
    send,
    stop: () => {
      call?.cancel()
      call = null
      set({ streaming: false, streamingId: null })
    },
    clear: () => {
      history = []
      set({ messages: [] })
      void window.bridge.storeSet('unifiedAgentSession', [])
    },
    setInput: (v) => set({ input: v }),
    appendInput: (refText) => set((s) => ({ input: s.input ? `${s.input} ${refText}` : refText })),
    askFromMini: (text) => {
      useWindowStore.getState().setMode('full')
      useAppStore.getState().setAssistant(true)
      const t = (text ?? '').trim()
      if (!t || get().streaming) return
      get().send(
        `（这是我在小窗中查询/识别的内容）请用简体中文帮我解析这段内容：它讲了什么、有哪些值得注意的学术词汇或表达，并给出阅读或学习建议：\n\n${t}`
      )
    }
  }
})

function buildDocContext(): string {
  const c = getFileContextForChat()
  return c ? `\n\n（当前文档摘要：${c.slice(0, 500)}）` : ''
}

function wordbookContext(): string {
  const words = useWordbookStore.getState().words
  if (!words.length) return ''
  return `生词本共 ${words.length} 词，前几条：${words.slice(0, 10).map((w) => w.word).join('、')}。`
}

export function refreshAgentAvailability(): void {
  useAgentStore.setState({
    hasAgentApi: Boolean(
      useSettingsStore.getState().settings.agentApiKey || useSettingsStore.getState().settings.apiKey
    )
  })
}
