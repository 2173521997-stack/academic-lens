import { create } from 'zustand'
import type { LLMMessage } from '../bridge/types'
import { agentStream, agentComplete, llmChat, type StreamCall } from '../lib/llm'
import {
  TOOLS, CONFIRM_TOOLS, AGENT_SYS, wordbookContext, buildAgentContext,
  setAsyncReplySink, setAsyncLookup, agentContextBlock, type ToolId
} from '../lib/agentTools'
import { runReAct, resolveByRules, runTool } from '../lib/agentLoop'
import { preprocessUserQuery } from '../lib/agentPreprocess'
import { detectBestSubAgent, type SubAgentId } from '../lib/subAgents'
import { decidePendingInput } from '../lib/confirm'
import { useSettingsStore } from './settingsStore'
import { useProfileStore } from './profileStore'
import { useWordbookStore } from './wordbookStore'
import { useFileStore, getFileContextForChat } from './fileStore'
import { parseAnyFile, newId } from '../lib/parse'

/** 会话持久化的最大保留条数（多轮上下文：最近 N 条作为历史注入） */
const SESSION_MAX = 60
const CONTEXT_WINDOW = 24

export interface AgentSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentMessage[]
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** 深度思考推理过程内容（<think> 标签内提取） */
  thinking?: string
  /** 思考耗时秒数 */
  thinkTimeSeconds?: number
  /** 是否正在深度思考中 */
  isThinking?: boolean
  /** 工具执行标签，如「工具：学情周报」 */
  label?: string
  /** 响应专家子智能体标识 */
  subAgentId?: SubAgentId
  subAgentName?: string
  subAgentBadge?: string
  subAgentColor?: string
  /** 异步工具执行的来源词（如查词） */
  topic?: string
  /** 文档段落引用（@N），如「段落 3」 */
  refs?: string[]
  /** 一键续做建议（工具结果后的快捷入口） */
  followUps?: string[]
  error?: string
}

/** 挂起的二次确认（破坏性工具执行前等待用户拍板） */
export interface PendingConfirm {
  toolId: ToolId
  params: Record<string, string>
  /** 关联的确认气泡消息 id（供 UI 高亮按钮） */
  msgId: string
}

interface AgentState {
  sessions: AgentSession[]
  activeSessionId: string
  sidebarOpen: boolean
  messages: AgentMessage[]
  streaming: boolean
  input: string
  hasAgentApi: boolean
  pendingConfirm: PendingConfirm | null
  /** 智能体双模态：'fast' 极速秒级直出 vs 'deep' 深度思考推理 */
  agentMode: 'fast' | 'deep'

  setAgentMode: (mode: 'fast' | 'deep') => void
  toggleSidebar: () => void
  createSession: () => string
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  send: (raw?: string) => void
  stop: () => void
  clear: () => void
  setInput: (v: string) => void
  /** 在输入框末尾追加一段文字（快速选词 / 快捷命令） */
  appendInput: (text: string) => void
  /** 对挂起的破坏性操作给出答复：确认执行 / 取消 */
  answerConfirm: (affirm: boolean, userText?: string) => void
  /** 用户在智能体中直接上传文档：就地解析并呈现意图交互 */
  handleUploadDocument: (fileData: ArrayBuffer | Uint8Array, fileName: string, filePath?: string) => Promise<void>
}

let history: LLMMessage[] = []

/** 工具结果后的一键续做建议（按工具 id） */
export const FOLLOW_UPS: Partial<Record<ToolId, string[]>> = {
  word_lookup: ['把这词存进生词本', '为它造一个例句', '给它出 3 道题'],
  grade_word: ['抽 10 张闪卡复习', '看看生词本概览'],
  organize_words: ['抽 10 张闪卡复习', '出 3 道自测题'],
  flashcard_draw: ['把答错的词重抽一遍', '生成本组练习'],
  doc_summarize: ['基于这篇文档出 3 道测验题', '分析文档生词与难度', '将该文献归档到学术项目'],
  history_search: ['把找到的译文导出保存'],
  wordbook_add: ['看看生词本概览', '给这词出 3 道题'],
  report: ['导出生词命中列表', '看看生词本概览'],
  quiz_generate: ['批改我的答案', '再换一批测验题', '去来做学术工作台精读'],
  quiz_grade: ['把错题中的生词存入生词本', '再换一批测验题', '回到文献阅读'],
  pipeline_study_pack: ['直接回复答案让我批改', '把核心术语一键加入生词本', '将该文献归档到学术项目'],
  academic_search: ['搜索该论文的 GitHub 开源实现', '总结搜索结果中的第 1 篇', '为该主题新建学术项目'],
  github_search: ['搜索相关的学术论文', '在浏览器中打开仓库链接'],
  huggingface_search: ['搜索该模型的学术论文', '搜索 GitHub 开源实现'],
  bibtex_lookup: ['复制 BibTeX 引用代码', '去来做学术工作台查看'],
  paper_review: ['提取算法流程并生成复现代码', '针对审稿意见提出修改建议'],
  code_generate: ['进行顶刊同行评审', '解释核心模块的前向传播流程'],
  phrasebank_query: ['查找相关的引言句型', '查找结果讨论句型'],
  grammar_analyze: ['提取句型公式并造句', '润色该句子'],
  synonym_nuance: ['为辨析词汇各造一个例句', '存入生词本'],
  ielts_toefl_evaluate: ['按照考官建议重新修改', '总结文中的好词好句'],
  project_list: ['新建一个学术项目', '生成当前项目的跨文献全景综述'],
  project_create: ['将当前文献归档到该项目', '为该项目搜索 arXiv 论文'],
  project_add_doc: ['生成该项目的跨文献全景综述', '去来做学术工作台精读'],
  project_summary: ['基于综述命制 3 道测验题', '去来做学术工作台查看'],
  math_explain: ['讲一讲其中每个符号的含义', '再通俗地解释一遍', '编写 PyTorch 代码实现'],
  polish_run: ['用精炼语气再润一遍', '去来做学术工作台继续编辑'],
  knowledge_query: ['举一个现实中的应用案例', '推荐相关的经典论文或专著', '出 2 道题考考我对这个概念的理解'],
  creative_brainstorm: ['针对第 1 个切入点细化实验方案', '搜索该方向的相关 arXiv 论文', '为该课题新建学术项目'],
  daily_planner: ['开始第一个番茄钟专注', '抽 10 张闪卡开始热身', '打开当前文献开始研读'],
  scholar_humor_quote: ['再讲一个科学家的趣事', '给一句关于坚持科研的名言', '开始今天的文献研读'],
  literary_translate: ['对该段落进行文学修辞与文本细读', '换成更典雅的古文/诗体再译一遍', '考据文中的文学典故'],
  literary_rhetoric_analyze: ['针对核心隐喻提供文学精翻', '分析该篇目的时代互文背景', '出 2 道文学赏析自测题'],
  humanities_critique: ['梳理该哲学流派的思想演进谱系', '提出 3 个反对该观点的批判性视角', '搜索相关的人文社科经典文献'],
  classic_allusion_lookup: ['给出该典故在学术写作中的经典例句', '推荐包含该典故的文学名著', '讲讲相关的神话故事背景']
}

/** 需要注入生词本详情的工具（特化注水） */
const WORD_DETAIL_TOOLS: ReadonlySet<string> = new Set([
  'wordbook_summary', 'wordbook_due', 'wordbook_list', 'wordbook_add', 'organize_words'
])

/* ---------------- 决策规划分层：复杂请求先由高模型产出初步计划 ---------------- */
const PLAN_COMPLEX_RE = /(先|再|然后|接着|顺便|同时|并且|并|而且|分别|依次|都)/i
const PLAN_TOOL_KW = ['查', '分级', '整理', '生词本', '闪卡', '复习', '摘要', '翻译', '周报', '导出', '朗读', '跳转', '检索', '核查']

/** 启发式：请求含多个工具意图且带动作连接词，才值得花一次高模型规划 */
function looksComplex(text: string): boolean {
  const hits = PLAN_TOOL_KW.filter((k) => text.includes(k)).length
  return hits >= 2 && PLAN_COMPLEX_RE.test(text)
}

/** 用主 API（高模型）产出初步计划；主 API 未配置或失败时返回 null（不影响原流程） */
async function maybePlanRequest(text: string): Promise<string | null> {
  if (!looksComplex(text)) return null
  const { settings } = useSettingsStore.getState()
  if (!settings.apiKey) return null
  try {
    const plan = await llmChat(
      [
        {
          role: 'system',
          content:
            '你是任务规划器。把用户的请求拆成 2-4 步执行计划，每步一行，格式「步骤N: 动作」，' +
            '动作里使用可用工具名（查词/分级/整理/存生词本/抽闪卡/复习/摘要/翻译/周报/导出/历史检索/跳转/朗读/核查）。只输出计划，不要执行。'
        },
        { role: 'user', content: text }
      ],
      { temperature: 0.2, maxTokens: 300 }
    )
    const trimmed = plan.trim()
    return trimmed.startsWith('步骤') ? trimmed : null
  } catch {
    return null
  }
}

/** 为待确认工具生成人性化的确认问题 */
function confirmQuestion(toolId: ToolId, params: Record<string, string>): string {
  const tool = TOOLS.find((t) => t.id === toolId)
  const name = tool?.name ?? toolId
  let detail = `执行「${name}」`
  if (toolId === 'wordbook_add') detail = `把「${(params.word ?? '').trim()}」加入生词本`
  else if (toolId === 'set_lookup_source') detail = `把查词方式切换为「${(params.source ?? 'dict') === 'llm' ? '仅 AI' : '词典优先（uapis）'}」`
  else if (toolId === 'set_goal') detail = `记录学习目标：${(params.goal ?? '').trim()}`
  else if (toolId === 'doc_export') detail = '把当前文档的译文导出保存为文件'
  else if (toolId === 'open_external') detail = `在浏览器中打开 ${(params.url ?? '').trim()}`
  return `要${detail}吗？这会改动数据或设置，确认后执行。\n回复「确认」执行，或「取消」跳过。`
}

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

function rebuildHistory(messages: AgentMessage[]): LLMMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    .filter((m, i, arr) => {
      if (i && arr[i - 1].role === m.role) return false
      return true
    })
}

export const saveSessions = (sessions: AgentSession[], activeId: string): void => {
  void window.bridge.storeSet('agentSessions', sessions)
  void window.bridge.storeSet('agentActiveSessionId', activeId)
}

// zustand 内部 set（module 级持久化）—— 由于 store 定义中使用闭包，这里用导出 setter
let setStore!: (p: Partial<AgentState>) => void

function setMessages(messages: AgentMessage[]): void {
  setStore({ messages })
}

export const useAgentStore = create<AgentState>((set, get) => {
  setStore = set
  let call: StreamCall | null = null

  const initialSessionId = newId()
  const initialSession: AgentSession = {
    id: initialSessionId,
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  }

  /* ---- 会话持久化恢复 ---- */
  let hydrated = false
  const hydrate = async (): Promise<void> => {
    if (hydrated) return
    hydrated = true
    try {
      const savedSessions = await window.bridge.storeGet<AgentSession[]>('agentSessions')
      const savedActiveId = await window.bridge.storeGet<string>('agentActiveSessionId')
      if (Array.isArray(savedSessions) && savedSessions.length > 0) {
        const activeId = savedSessions.some((s) => s.id === savedActiveId) ? savedActiveId! : savedSessions[0].id
        const currentSession = savedSessions.find((s) => s.id === activeId) || savedSessions[0]
        set({
          sessions: savedSessions,
          activeSessionId: activeId,
          messages: currentSession.messages
        })
        history = rebuildHistory(currentSession.messages)
      } else {
        // 兼容迁移旧的单会话存储
        const oldSaved = await window.bridge.storeGet<AgentMessage[]>('agentSession')
        if (Array.isArray(oldSaved) && oldSaved.length > 0) {
          const migratedSession: AgentSession = {
            id: initialSessionId,
            title: oldSaved[0]?.content?.slice(0, 16) || '历史对话',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: oldSaved
          }
          set({
            sessions: [migratedSession],
            activeSessionId: initialSessionId,
            messages: oldSaved
          })
          history = rebuildHistory(oldSaved)
          saveSessions([migratedSession], initialSessionId)
        }
      }
    } catch {
      /* 非致命：无会话则从空开始 */
    }
  }
  void hydrate()

  const pushMessages = (messages: AgentMessage[]): void => {
    setMessages(messages)
    const activeId = get().activeSessionId
    const currentSessions = get().sessions
    
    // 自动为新对话提取标题（前 16 个字符）
    const firstUserMsg = messages.find((m) => m.role === 'user')
    const autoTitle = firstUserMsg ? firstUserMsg.content.trim().slice(0, 18) : '新对话'

    const nextSessions = currentSessions.map((s) => {
      if (s.id === activeId) {
        return {
          ...s,
          title: s.title === '新对话' && autoTitle !== '新对话' ? autoTitle : s.title,
          updatedAt: Date.now(),
          messages: messages.slice(-SESSION_MAX)
        }
      }
      return s
    })

    set({ sessions: nextSessions })
    saveSessions(nextSessions, activeId)
  }

  const saveSession = (_messages?: AgentMessage[]): void => {
    const activeId = get().activeSessionId
    const messages = _messages ?? get().messages
    const currentSessions = get().sessions
    const nextSessions = currentSessions.map((s) => {
      if (s.id === activeId) {
        return { ...s, messages: messages.slice(-SESSION_MAX), updatedAt: Date.now() }
      }
      return s
    })
    set({ sessions: nextSessions })
    saveSessions(nextSessions, activeId)
  }

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

    // 二次确认：上一步挂起了破坏性操作，等待用户「确认 / 取消」
    if (get().pendingConfirm) {
      const action = decidePendingInput(true, text)
      if (action === 'execute' || action === 'cancel') {
        get().answerConfirm(action === 'execute', text)
        return
      }
      // 无关输入：当作新请求，丢弃挂起项
      set({ pendingConfirm: null })
    }

    // 1. 输入预清洗（去口语、识别实体）
    const preprocessed = preprocessUserQuery(text)
    let resolvedText = resolveDocInput(preprocessed.cleanedText)
    if (get().agentMode === 'deep') {
      resolvedText += '\n\n【深度思考模式开启】：请务必先使用 <think>...</think> 标签详细写出你的思考推理过程（包含用户意图深剖、学术严谨性推导、潜在反例及决策理由），在 </think> 之后再输出正式详尽的解答。'
    }

    const userMsg: AgentMessage = { id: newId(), role: 'user', content: text, refs: extractRefs(text) }
    const toolMsg: AgentMessage = {
      id: newId(),
      role: 'tool',
      content: '',
      label: get().agentMode === 'deep' ? '🧠 深度思考中…' : '思考中…',
      isThinking: get().agentMode === 'deep'
    }
    pushMessages([...get().messages, userMsg, toolMsg])
    set({ streaming: true, input: '' })
    history.push({ role: 'user', content: resolvedText })

    void (async () => {
      // 2. 快速通道决策：仅限确定性斜杠命令或极简单一指令
      const ruleHit = preprocessed.quickAction ?? resolveByRules(resolvedText)
      if (ruleHit) {
        // 破坏性工具：先挂起、请求用户确认，不直接执行
        if (CONFIRM_TOOLS.has(ruleHit.tool)) {
          set({ pendingConfirm: { toolId: ruleHit.tool, params: ruleHit.params, msgId: toolMsg.id } })
          const question = confirmQuestion(ruleHit.tool, ruleHit.params)
          history.push({ role: 'assistant', content: question })
          patchMessage(toolMsg.id, { content: question, role: 'assistant', label: '需要确认' })
          set({ streaming: false, input: '' })
          saveSession(get().messages)
          return
        }
        void runToolFlow(toolMsg.id, ruleHit.tool, ruleHit.params)
        return
      }

      // 2) ReAct 循环：多步工具编排，工具结果回流后再决策
      try {
        // 决策规划分层：复杂请求先用高模型产出初步计划，再进入小模型循环执行
        const plan = await maybePlanRequest(resolvedText)
        const { answer, blocked } = await runReAct(resolvedText, {
          onStep: (step) => {
            if (step.kind !== 'tool') return
            pushMessages([
              ...get().messages,
              {
                id: newId(),
                role: 'tool',
                content: step.observation ?? '',
                label: `工具：${step.toolLabel}`,
                followUps: step.toolId ? FOLLOW_UPS[step.toolId] : undefined
              }
            ])
          },
          // 破坏性工具：循环内同样挂起，交给用户二次确认
          onTool: (toolId) => !CONFIRM_TOOLS.has(toolId),
          plan: plan ?? undefined,
          // 注入多轮历史，支撑跨轮批改（如随堂测验逐题作答）与追问连贯性
          context: history.slice(-CONTEXT_WINDOW)
        })
        if (blocked) {
          set({ pendingConfirm: { toolId: blocked.toolId, params: blocked.params, msgId: toolMsg.id } })
          const question = confirmQuestion(blocked.toolId, blocked.params)
          history.push({ role: 'assistant', content: question })
          patchMessage(toolMsg.id, { content: question, role: 'assistant', label: '需要确认' })
          set({ streaming: false, input: '' })
          saveSession(get().messages)
          return
        }
        // 把占位映射为最终 assistant 回复（已由 ReAct 生成，无需再调 LLM）
        finalizeAssistant(toolMsg.id, answer || '（已完成）')
      } catch (err) {
        finishError(toolMsg.id, '智能体', err instanceof Error ? err.message : String(err))
      }
    })()
  }

  /** 对挂起的破坏性操作给出答复（确认按钮 / 文字「确认 / 取消」共用） */
  const answerConfirm = (affirm: boolean, userText?: string): void => {
    const pc = get().pendingConfirm
    if (!pc) return
    set({ pendingConfirm: null })
    const userMsg: AgentMessage = { id: newId(), role: 'user', content: userText ?? (affirm ? '（确认）' : '（取消）') }
    const toolMsg2: AgentMessage = { id: newId(), role: 'tool', content: '', label: '执行中…' }
    pushMessages([...get().messages, userMsg, toolMsg2])
    set({ streaming: true, input: '' })
    history.push({ role: 'user', content: userMsg.content })
    if (affirm) {
      runToolFlow(toolMsg2.id, pc.toolId, pc.params)
    } else {
      const cancelText = '已取消该操作。'
      history.push({ role: 'assistant', content: cancelText })
      patchMessage(toolMsg2.id, { content: cancelText, role: 'assistant', label: '已取消' })
      set({ streaming: false, input: '' })
      saveSession(get().messages)
    }
  }

  /** 执行单个工具并把结果组织成一句话（快路径 / 确认后执行共用） */
  const runToolFlow = (msgId: string, toolId: ToolId, params: Record<string, string>): void => {
    const tool = TOOLS.find((t) => t.id === toolId)
    const label = `工具：${tool?.name ?? toolId}`
    patchMessage(msgId, { label })
    void (async () => {
      try {
        const out = await runTool(toolId, params)
        const text = out.text || '（已完成）'
        patchMessage(msgId, { content: text, label, followUps: FOLLOW_UPS[toolId] })
        
        // 顶尖智能体设计（In-situ Delivery）：对于内容型工具，直接完整交付真实结果，避免小模型二次概括导致信息丢失
        const RICH_TOOLS: ReadonlySet<ToolId> = new Set([
          'quiz_generate',
          'quiz_grade',
          'pipeline_study_pack',
          'academic_search',
          'github_search',
          'huggingface_search',
          'bibtex_lookup',
          'paper_review',
          'code_generate',
          'phrasebank_query',
          'grammar_analyze',
          'synonym_nuance',
          'ielts_toefl_evaluate',
          'project_list',
          'project_create',
          'project_add_doc',
          'project_summary',
          'doc_summarize',
          'math_explain',
          'polish_run',
          'history_search',
          'report',
          'word_lookup',
          'knowledge_query',
          'creative_brainstorm',
          'daily_planner',
          'scholar_humor_quote',
          'literary_translate',
          'literary_rhetoric_analyze',
          'humanities_critique',
          'classic_allusion_lookup'
        ])
        if (RICH_TOOLS.has(toolId)) {
          finalizeAssistant(msgId, text)
          return
        }

        // 轻量控制型工具（如加词/改设置/导航等）调用 GLM 用自然语言组织一句话结果
        const prompt = buildPrompt(text, label, toolId)
        streamFinalAssistant(prompt, msgId, label, text)
      } catch (err) {
        finishError(msgId, label, err instanceof Error ? err.message : String(err))
      }
    })()
  }

  /** 文档拖入/上传：智能体就地解析并呈现意图交互，零跳转闭环 */
  const handleUploadDocument = async (fileData: ArrayBuffer | Uint8Array, fileName: string, filePath?: string): Promise<void> => {
    try {
      const raw = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData)
      const segs = await parseAnyFile(fileName, raw)
      if (!segs.length) {
        throw new Error('未能从文档中解析出文字段落')
      }
      useFileStore.getState().setDoc({ name: fileName, size: raw.byteLength, path: filePath, rawBuffer: raw }, segs)

      const userMsgId = newId()
      const assistantMsgId = newId()
      const preview = segs.slice(0, 2).map((s) => s.text.slice(0, 100)).join(' ')

      const guideText =
        `### 📄 文献《${fileName}》解析成功\n\n` +
        `- **文档规模**：共 ${segs.length} 个段落\n` +
        `- **内容预览**：*${preview}…*\n\n` +
        `---\n` +
        `### 💡 请问您希望如何处理这篇文献？\n` +
        `您可直接在下方回复您的需求，或点击以下方案：\n` +
        `1. 📖 **[总结这篇文献]**：3–5 句提炼核心贡献与结构大纲\n` +
        `2. 📚 **[提取核心生词并分级]**：标注 CEFR 难度与学术重点词\n` +
        `3. 🎓 **[基于该文献出 3 道题]**：随堂自测检验理解\n` +
        `4. 🔬 **[生成学术研读全套包]**：多智能体团队一键生成研读全资料\n` +
        `5. 📁 **[将文献归档到学术项目]**：加入项目制工作台进行系统化研读`

      const followUps = [
        '生成这篇文献的学术研读全套包',
        '总结这篇文献',
        '基于该文献出 3 道题',
        '将该文献归档到学术项目'
      ]

      pushMessages([
        ...get().messages,
        { id: userMsgId, role: 'user', content: `📄 上传并载入了文献《${fileName}》` },
        {
          id: assistantMsgId,
          role: 'assistant',
          content: guideText,
          followUps,
          subAgentName: '文献研读专家',
          subAgentBadge: '研读',
          subAgentColor: '#3b82f6'
        }
      ])
      history.push({ role: 'assistant', content: guideText })
      saveSession(get().messages)
    } catch (err) {
      const errText = `文献上传解析失败：${err instanceof Error ? err.message : String(err)}`
      pushMessages([
        ...get().messages,
        { id: newId(), role: 'user', content: `上传文献《${fileName}》` },
        { id: newId(), role: 'assistant', content: errText, error: '解析失败' }
      ])
    }
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

  /** ReAct / 原地交付：直接把已生成的回答写入气泡并落历史 */
  const finalizeAssistant = (msgId: string, content: string): void => {
    const subAgent = detectBestSubAgent(content)
    pushMessages(get().messages.map((m) => (m.id === msgId ? {
      ...m,
      content,
      role: 'assistant',
      label: undefined,
      subAgentId: subAgent.id,
      subAgentName: subAgent.name,
      subAgentBadge: subAgent.avatarBadge,
      subAgentColor: subAgent.color
    } : m)))
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
    sessions: [initialSession],
    activeSessionId: initialSessionId,
    sidebarOpen: true,
    messages: [],
    streaming: false,
    input: '',
    hasAgentApi: Boolean(useSettingsStore.getState().settings.agentApiKey),
    pendingConfirm: null,
    agentMode: 'fast',

    setAgentMode: (mode: 'fast' | 'deep') => set({ agentMode: mode }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

    createSession: () => {
      call?.cancel()
      call = null
      const newSid = newId()
      const newSess: AgentSession = {
        id: newSid,
        title: '新对话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      }
      const nextSessions = [newSess, ...get().sessions]
      history = []
      set({
        sessions: nextSessions,
        activeSessionId: newSid,
        messages: [],
        streaming: false,
        pendingConfirm: null,
        input: ''
      })
      saveSessions(nextSessions, newSid)
      return newSid
    },

    switchSession: (id: string) => {
      if (id === get().activeSessionId) return
      call?.cancel()
      call = null
      const target = get().sessions.find((s) => s.id === id)
      if (!target) return
      history = rebuildHistory(target.messages)
      set({
        activeSessionId: id,
        messages: target.messages,
        streaming: false,
        pendingConfirm: null,
        input: ''
      })
      void window.bridge.storeSet('agentActiveSessionId', id)
    },

    deleteSession: (id: string) => {
      const currentSessions = get().sessions
      const nextSessions = currentSessions.filter((s) => s.id !== id)
      if (nextSessions.length === 0) {
        const newSid = newId()
        const blankSess: AgentSession = {
          id: newSid,
          title: '新对话',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: []
        }
        history = []
        set({
          sessions: [blankSess],
          activeSessionId: newSid,
          messages: [],
          streaming: false,
          pendingConfirm: null
        })
        saveSessions([blankSess], newSid)
        return
      }

      if (id === get().activeSessionId) {
        const nextActive = nextSessions[0]
        history = rebuildHistory(nextActive.messages)
        set({
          sessions: nextSessions,
          activeSessionId: nextActive.id,
          messages: nextActive.messages,
          streaming: false,
          pendingConfirm: null
        })
        saveSessions(nextSessions, nextActive.id)
      } else {
        set({ sessions: nextSessions })
        saveSessions(nextSessions, get().activeSessionId)
      }
    },

    renameSession: (id: string, title: string) => {
      const trimmed = title.trim() || '未命名对话'
      const nextSessions = get().sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
      set({ sessions: nextSessions })
      saveSessions(nextSessions, get().activeSessionId)
    },

    send,
    stop: () => {
      call?.cancel()
      call = null
      set({ streaming: false })
    },
    clear: () => {
      history = []
      const activeId = get().activeSessionId
      const nextSessions = get().sessions.map((s) => (s.id === activeId ? { ...s, messages: [], updatedAt: Date.now() } : s))
      set({ messages: [], pendingConfirm: null, sessions: nextSessions })
      saveSessions(nextSessions, activeId)
    },
    setInput: (v) => set({ input: v }),
    appendInput: (refText) => set((s) => ({ input: s.input ? `${s.input} ${refText}` : refText })),
    answerConfirm,
    handleUploadDocument
  }
})

/** 组装系统提示 + 多轮上下文 + 个性化档案（可按命中工具做上下文特化注水） */
function buildPrompt(toolOut: string, toolLabel: string, toolId?: string): LLMMessage[] {
  const p = useProfileStore.getState().profile
  const profile = [p.goal && `目标：${p.goal}`, p.level && `水平：${p.level}`, p.style && `偏好：${p.style}`, p.focus && `想加强：${p.focus}`]
    .filter(Boolean)
    .join('；')
  let ctx = `${wordbookContext()}${buildAgentContext()}${profile ? `\n\n（学习者档案：${profile}）` : ''}`
  // 特化注水：命中生词本相关工具时，额外附上近期词条明细，让组织话术更贴合真实数据
  if (toolId && WORD_DETAIL_TOOLS.has(toolId)) {
    const words = useWordbookStore.getState().words.slice(0, 20)
    if (words.length) {
      ctx +=
        '\n\n（生词本近期词条：' +
        words.map((w) => `${w.word}${w.level ? `(${w.level})` : ''}${w.definition ? `：${w.definition}` : ''}`).join('；') +
        '）'
    }
  }
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