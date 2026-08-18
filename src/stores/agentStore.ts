import { create } from 'zustand'
import type { LLMMessage } from '../bridge/types'
import { agentStream, agentComplete, type StreamCall } from '../lib/llm'
import {
  TOOLS, AGENT_SYS, wordbookContext, buildAgentContext,
  setAsyncReplySink, setAsyncLookup, agentContextBlock
} from '../lib/agentTools'
import { runReAct, resolveByRules, runTool } from '../lib/agentLoop'
import { useSettingsStore } from './settingsStore'
import { useProfileStore } from './profileStore'
import { useWordbookStore } from './wordbookStore'
import { getFileContextForChat } from './fileStore'
import { newId } from '../lib/parse'

/** 会话持久化的最大保留条数（多轮上下文：最近 N 条作为历史注入） */
const SESSION_MAX = 60
const CONTEXT_WINDOW = 24

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** 工具执行标签，如「工具：学情周报」 */
  label?: string
  /** 异步工具执行的来源词（如查词） */
  topic?: string
  /** 文档段落引用（@N），如「段落 3」 */
  refs?: string[]
  error?: string
}

interface AgentState {
  messages: AgentMessage[]
  streaming: boolean
  input: string
  hasAgentApi: boolean
  send: (raw?: string) => void
  stop: () => void
  clear: () => void
  setInput: (v: string) => void
  /** 在输入框末尾追加一段文字（快速选词 / 快捷命令） */
  appendInput: (text: string) => void
}

let history: LLMMessage[] = []

/* ================= 文档问答能力（原浮动面板设计迁入此处） ================= */
const DOC_COMMANDS: Record<string, string> = {
  '/总结': '请用 3–5 句话总结当前文档的核心内容。',
  '/翻译': '请把当前文档正文翻译成简体中文。',
  '/解释术语': '请解释当前文档中的关键术语，结合上下文给出含义与例子。',
  '/推导公式': '请用大白话讲解当前文档中公式的符号含义与推导思路。',
  '/出题': '请基于当前文档出 3 道理解题，附参考答案。'
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 提取 user 输入中的 @N 段落引用说明 */
function extractRefs(raw: string): string[] {
  const refs: string[] = []
  raw.replace(/@(\d+)/g, (_m, n) => {
    refs.push(`段落 ${n}`)
    return ''
  })
  return refs
}

/** 预处理用户输入：文档命令 / @段落引用标注 / 生词本提及注入 */
function resolveDocInput(text: string): string {
  let resolved = text.replace(/@(\d+)/g, '（引用段落 $1，需要时请结合当前文档上下文）')
  const fileCtx = getFileContextForChat()
  if (resolved.startsWith('/')) {
    const cmd = resolved.split(/\s+/)[0]
    if (cmd === '/生词本' || cmd === '/复习') {
      resolved = buildWordbookPrompt()
    } else {
      const template = DOC_COMMANDS[cmd]
      if (template) resolved = `${template}\n${fileCtx}`
    }
  } else {
    // 打通收藏夹：提问中提及生词本里的词时，附带释义
    const mentioned = useWordbookStore
      .getState()
      .words.filter((w) => new RegExp(`\\b${escapeRegExp(w.word)}\\b`, 'i').test(text))
    if (mentioned.length) {
      resolved +=
        '\n\n（生词本相关词条，供参考：' +
        mentioned.map((w) => `${w.word}：${w.definition || '—'}`).join('；') +
        '）'
    }
  }
  return resolved
}

/** 生词本复习指令 */
function buildWordbookPrompt(): string {
  const words = useWordbookStore.getState().words.slice(0, 80)
  if (!words.length) return '我的生词本是空的，请给我一些高效背单词的方法建议。'
  const list = words
    .map((w) => `${w.word}${w.pos ? `（${w.pos}）` : ''}${w.definition ? `：${w.definition}` : ''}`)
    .join('\n')
  return (
    `请帮我复习生词本中的单词：\n${list}\n\n` +
    '请按词根/主题把它们分组，为每个词给出简明释义与一个例句，最后出 3 道自测题（附参考答案）。'
  )
}

export const DOC_QUICK_CMDS = ['/总结', '/翻译', '/解释术语', '/推导公式', '/出题', '/生词本']

export const saveSession = (messages: AgentMessage[]): void => {
  void window.bridge.storeSet('agentSession', messages.slice(-SESSION_MAX))
}

const pushMessages = (messages: AgentMessage[]): void => {
  setMessages(messages)
  saveSession(messages)
}

// zustand 内部 set（module 级持久化）—— 由于 store 定义中使用闭包，这里用导出 setter
let setStore!: (p: Partial<AgentState>) => void

function setMessages(messages: AgentMessage[]): void {
  setStore({ messages })
}

export const useAgentStore = create<AgentState>((set, get) => {
  setStore = set
  let call: StreamCall | null = null

  /* ---- 会话持久化恢复 ---- */
  let hydrated = false
  const hydrate = async (): Promise<void> => {
    if (hydrated) return
    hydrated = true
    try {
      const saved = await window.bridge.storeGet<AgentMessage[]>('agentSession')
      if (Array.isArray(saved)) {
        set({ messages: saved })
        // 由消息重建 LLM 历史
        history = saved
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          .filter((m, i, arr) => {
            // 合并相邻同角色，避免连续 system/空
            if (i && arr[i - 1].role === m.role) return false
            return true
          })
      }
    } catch {
      /* 非致命：无会话则从空开始 */
    }
  }
  void hydrate()

  /* ---- 异步工具结果回填 ----
   * 学习类工具（AI 查词 / 分级 / 整理）是异步 LLM 调用。
   * agentTools 通过注入的 sink 把结果推回这里，作为一条「工具」消息展示并写入历史。 */
  setAsyncReplySink((topic, reply) => {
    const toolMsg: AgentMessage = { id: newId(), role: 'tool', content: reply, label: `工具：${topic}` }
    const next = [...get().messages, toolMsg]
    pushMessages(next)
    history.push({ role: 'assistant', content: reply })
    set({ streaming: false, input: '' })
  })

  /* ---- 纯 AI 查词（双轨回退 / lookupSource=llm）---- */
  setAsyncLookup((word) => {
    void (async () => {
      const toolMsg: AgentMessage = { id: newId(), role: 'tool', content: '正在用 AI 查「' + word + '」…', label: '工具：查词（AI）' }
      pushMessages([...get().messages, toolMsg])
      set({ streaming: true })
      const res = await lookupWordViaAI(word)
      patchMessage(toolMsg.id, { content: res, label: `工具：查词（AI）「${word}」` })
      history.push({ role: 'assistant', content: res })
      set({ streaming: false, input: '' })
      saveSession(get().messages)
    })()
  })

  const send = (raw?: string): void => {
    const text = (raw ?? get().input).trim()
    if (!text || get().streaming) return
    if (!get().hasAgentApi) {
      pushMessages([
        ...get().messages,
        { id: newId(), role: 'user', content: text },
        { id: newId(), role: 'assistant', content: '需先在「设置 → 智能体」配置 API Key 才能使用智能助手。', error: '未配置' }
      ])
      set({ input: '' })
      return
    }

    // 预处理：文档命令 / @段落引用 / 生词本提及（沿用原浮动面板的设计）
    const resolvedText = resolveDocInput(text)

    const userMsg: AgentMessage = { id: newId(), role: 'user', content: resolvedText, refs: extractRefs(text) }
    const toolMsg: AgentMessage = { id: newId(), role: 'tool', content: '', label: '理解中…' }
    pushMessages([...get().messages, userMsg, toolMsg])
    set({ streaming: true, input: '' })
    history.push({ role: 'user', content: resolvedText })

    void (async () => {
      // 1) 确定性单工具快路径：命中即执行（await 结果），再组织一句话
      const ruleHit = resolveByRules(resolvedText)
      if (ruleHit) {
        const tool = TOOLS.find((t) => t.id === ruleHit.tool)
        const label = `工具：${tool?.name ?? ruleHit.tool}`
        patchMessage(toolMsg.id, { label })
        try {
          const out = await runTool(ruleHit.tool, ruleHit.params)
          const text = out.text || '（已完成）'
          patchMessage(toolMsg.id, { content: text, label })
          // 调用 GLM 用自然语言组织一句话结果
          const prompt = buildPrompt(text, label)
          streamFinalAssistant(prompt, toolMsg.id, label, text)
        } catch (err) {
          finishError(toolMsg.id, label, err instanceof Error ? err.message : String(err))
        }
        return
      }

      // 2) ReAct 循环：多步工具编排，工具结果回流后再决策
      try {
        const { answer } = await runReAct(resolvedText, {
          onStep: (step) => {
            if (step.kind !== 'tool') return
            pushMessages([
              ...get().messages,
              { id: newId(), role: 'tool', content: step.observation ?? '', label: `工具：${step.toolLabel}` }
            ])
          }
        })
        // 把占位映射为最终 assistant 回复（已由 ReAct 生成，无需再调 LLM）
        finalizeAssistant(toolMsg.id, answer || '（已完成）')
      } catch (err) {
        finishError(toolMsg.id, '智能体', err instanceof Error ? err.message : String(err))
      }
    })()
  }

  /** 快路径：用 GLM 流式把"工具结果"组织成自然一句话 */
  const streamFinalAssistant = (prompt: LLMMessage[], msgId: string, label: string, fallback: string): void => {
    let reply = ''
    call = agentStream(prompt, {
      onChunk: (d) => {
        reply += d
        patchMessage(msgId, { content: reply, role: 'assistant', label })
      },
      onDone: () => {
        const content = reply.trim() || fallback
        history.push({ role: 'assistant', content })
        patchMessage(msgId, { content, role: 'assistant', label })
        set({ streaming: false })
        call = null
        saveSession(get().messages)
      },
      onError: (m) => {
        history.push({ role: 'assistant', content: fallback })
        patchMessage(msgId, { content: fallback, role: 'assistant', error: m, label })
        set({ streaming: false })
        call = null
        saveSession(get().messages)
      }
    }, { temperature: 0.3, maxTokens: 1400 })
  }

  /** ReAct：直接把已生成的回答写入气泡并落历史 */
  const finalizeAssistant = (msgId: string, content: string): void => {
    pushMessages(get().messages.map((m) => (m.id === msgId ? { ...m, content, role: 'assistant', label: undefined } : m)))
    history.push({ role: 'assistant', content })
    set({ streaming: false, input: '' })
    call = null
    saveSession(get().messages)
  }

  /** 异常收尾 */
  const finishError = (msgId: string, label: string, err: string): void => {
    const fallback = `处理失败：${err}`
    patchMessage(msgId, { content: fallback, role: 'assistant', error: err, label })
    history.push({ role: 'assistant', content: fallback })
    set({ streaming: false, input: '' })
    call = null
    saveSession(get().messages)
  }

  function patchMessage(id: string, patch: Partial<AgentMessage>): void {
    if (!get().messages.some((m) => m.id === id)) return
    set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
  }

  return {
    messages: [],
    streaming: false,
    input: '',
    hasAgentApi: Boolean(useSettingsStore.getState().settings.agentApiKey),
    send,
    stop: () => {
      call?.cancel()
      call = null
      set({ streaming: false })
    },
    clear: () => {
      history = []
      set({ messages: [] })
      void window.bridge.storeSet('agentSession', [])
    },
    setInput: (v) => set({ input: v }),
    appendInput: (refText) => set((s) => ({ input: s.input ? `${s.input} ${refText}` : refText }))
  }
})

/** 组装系统提示 + 多轮上下文 + 个性化档案 */
function buildPrompt(toolOut: string, toolLabel: string): LLMMessage[] {
  const p = useProfileStore.getState().profile
  const profile = [p.goal && `目标：${p.goal}`, p.level && `水平：${p.level}`, p.style && `偏好：${p.style}`, p.focus && `想加强：${p.focus}`]
    .filter(Boolean)
    .join('；')
  const ctx = `${wordbookContext()}${buildAgentContext()}${profile ? `\n\n（学习者档案：${profile}）` : ''}`
  return [
    { role: 'system', content: AGENT_SYS + ctx },
    ...history.slice(-CONTEXT_WINDOW),
    {
      role: 'assistant',
      content: toolOut
        ? `我已通过「${toolLabel || '内置工具'}」完成操作，执行结果：${toolOut}`
        : '这个请求没有匹配到可执行工具，请结合上下文直接回答用户。'
    }
  ]
}

/** 用 GLM 纯 AI 查词（无 uapis 时） */
async function lookupWordViaAI(word: string): Promise<string> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content:
        '你是词典助手。为一个英文单词输出简洁词卡，格式严格如下（一行一块，冒号英文）：\n' +
        `word：${word}\n` +
        `音标：/.../\n` +
        `词性：n./v./adj.\n` +
        `释义：一两个中文义项\n` +
        `例句：1 句简单英文例句（含译）\n` +
        `简单评估它属于日常词还是学术词。不要额外解释。`
    },
    { role: 'user', content: word }
  ]
  try {
    const call = agentComplete(messages, { temperature: 0.2, maxTokens: 900 })
    return await call.promise
  } catch (e) {
    return `AI 查词失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 外部（如设置保存后）同步 agent 可用状态 */
export function refreshAgentAvailability(): void {
  useAgentStore.setState({ hasAgentApi: Boolean(useSettingsStore.getState().settings.agentApiKey) })
}

export function toolCatalogueInfo(): string {
  return TOOLS.map((t) => `${t.name}${t.sideEffect ? '（可执行）' : ''}`).join('、')
}

export { agentContextBlock }