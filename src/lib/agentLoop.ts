import { agentComplete } from './llm'
import type { LLMMessage } from '../bridge/types'
import { dictLookup } from './dictLookup'
import { formatUapisCard } from './wordCard'
import { cleanWord, suggestSpelling } from './wordClean'
import { bestOfflineSpelling } from './suggest'
import { aiGradeWords } from './flashcard'
import { aiOrganize } from './organize'
import { useSettingsStore } from '../stores/settingsStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { executeTool, TOOLS, type ToolId, type ToolOutput } from './agentTools'
import { useNoticeStore } from '../stores/noticeStore'
import { useHistoryStore } from '../stores/historyStore'

/* =====================================================================
 * ReAct 智能体循环 + 工具 Harness
 *
 * 设计：
 *   - 全流程「思考 → 调用工具 → 读取结果 → 再思考」的多步循环，而非单工具一次性。
 *   - 轻量工具直接同步执行取文本；重型工具（查词/分级/整理/导出）异步 await 真实结果。
 *   - 每步经 GLM-4-flash 做决策，输出严格 JSON：
 *        { "tool": "<id>", "params": {...} }          → 执行工具，结果回填观察
 *        { "done": true, "answer": "最终回答" }        → 结束
 *   - 有 maxSteps 上限，避免失控；通过 onStep 回调把每一步喂给 UI/harness。
 * ===================================================================== */

export const REACT_MAX_STEPS = 6

export interface AgentStep {
  /** 该步决策：调用了哪个工具 / 是否收尾 */
  kind: 'tool' | 'done'
  /** 工具 id（kind=tool，供续做建议映射） */
  toolId?: ToolId
  /** 工具名（kind=tool） */
  toolLabel?: string
  /** 是否副作用工具 */
  sideEffect?: boolean
  /** 工具执行结果文本 */
  observation?: string
}

export interface AgentLoopOptions {
  /** 每执行一步工具后的回调（供 UI 展示） */
  onStep?: (step: AgentStep) => void
  maxSteps?: number
  /** 工具执行前钩子：返回 false 表示该工具被挂起（需用户二次确认），循环立即结束并返回 blocked */
  onTool?: (toolId: ToolId, params: Record<string, string>) => boolean
  /** 高模型产出的初步计划，注入首轮决策上下文（决策规划分层） */
  plan?: string
}

export interface ReActResult {
  answer: string
  steps: AgentStep[]
  /** 因需用户确认而被挂起的工具（此时 answer 为空） */
  blocked?: { toolId: ToolId; params: Record<string, string> }
}

/** 轻量同步工具：直接复用 executeTool 的同步返回；重型工具为 async 专属实现 */
// （LIGHT_TOOLS 已并入 runTool 的 default 分支统一处理，保留注释说明意图）

/** 当前查词方式 + 词典可用性，供工具/LLM 决策参考 */
function lookupModeHint(): string {
  const s = useSettingsStore.getState().settings
  if (s.lookupSource === 'dict' && s.dictApiKey) return '词典优先（uapis 真实词典）'
  if (s.lookupSource === 'dict') return '词典优先（但未配置 uapis Key，实际会回退 AI）'
  return '仅 AI'
}

/** 生词本上下文：让 LLM 知道已有词，避免对同一词重复入库/重复统计 */
function wordbookContextText(): string {
  const words = useWordbookStore.getState().words
  if (!words.length) return '生词本是空的。'
  return `生词本共 ${words.length} 词：${words.slice(0, 40).map((w) => w.word).join('、')}${words.length > 40 ? '…' : ''}。`
}

/** 执行单个工具并返回结果文本（awaitable）。light 同步；heavy 异步真实结果。 */
export async function runTool(id: ToolId, params: Record<string, string>): Promise<ToolOutput> {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) return { text: `未知工具：${id}` }

  // 重型：真实异步执行，返回结果文本
  switch (id) {
    case 'word_lookup':
      return { text: await heavyWordLookup(params.word ?? '') }
    case 'grade_word':
      return { text: await heavyGrade(params.word ?? '') }
    case 'organize_words': {
      const r = await heavyOrganize(params.mode)
      return { text: r.text, digest: r.digest }
    }
    case 'wordbook_add':
      return { text: await heavyWordbookAdd(params) }
    case 'doc_export':
      return { text: await heavyDocExport() }
    case 'history_search': {
      const r = await heavyHistorySearch(params.keyword ?? params.text ?? '')
      return { text: r.text, digest: r.digest }
    }
    default: {
      // 轻量：走既有同步 executor
      const out = executeTool(id, params)
      const text = out.text || (out.asyncStarted ? '（已完成）' : '')
      // 大结果工具：为决策回填生成结构化摘要，避免长文本截断导致 LLM 误判
      return { text, digest: out.digest ?? (text ? makeDigest(id, text) : undefined) }
    }
  }
}

/** 为「结果可能很长」的工具生成供决策用的紧凑摘要；短结果返回 undefined 走截断兜底 */
function makeDigest(id: ToolId, text: string): string | undefined {
  if (id === 'wordbook_list' || id === 'wordbook_summary') {
    const lines = text.split('\n').filter((l) => l.trim())
    if (lines.length > 8) return `共 ${lines.length} 行概览，前 6 行：\n${lines.slice(0, 6).join('\n')}\n…（共 ${lines.length} 行）`
  }
  if (id === 'report' && text.length > 500) return text.slice(0, 500) + '\n…（周报正文较长，回复用户时保留要点即可）'
  return undefined
}

/* ---------------- 重型工具实现（可 await） ---------------- */

/** 查词：dict 优先（若可用），否则 AI 词卡 */
async function heavyWordLookup(word: string): Promise<string> {
  const cleaned = await cleanWord(word)
  if (!cleaned) return `没有识别到要查询的英文单词，请再提供一下。`
  const w = cleaned.word
  // 若 GLM 判定原文是拼写错误，先给用户提示
  const hint = cleaned.suggestion && cleaned.suggestion !== w
    ? `（你可能想查「${cleaned.suggestion}」，已按规范词处理）\n`
    : ''
  const st = useSettingsStore.getState().settings
  if (st.lookupSource === 'dict' && st.dictApiKey) {
    try {
      const res = await dictLookup(w, st.dictApiKey)
      if (res && !res.notFound) return hint + '〔来源：uapis 词典〕\n' + formatUapisCard(res)
      if (res?.notFound) {
        // 后置纠错：词典 miss → 问一次小模型拿拼写建议（仅失败路径成本）
        const sp = await suggestSpelling(w)
        const spHint = sp && sp !== w ? `（你是不是想查「${sp}」？）` : ''
        return `〔来源：uapis 词典，未收录〕\n「${w}」未收录于词典（可能拼写有误）${spHint}${hint}` +
          `。可先用 AI 查词看看，或点击建议词改用正确拼写。`
      }
      // 服务失败 → 回退 AI
    } catch {
      /* 回退 AI */
    }
  }
  if (st.lookupSource === 'dict') {
    // 期望词典，但未配置 Key：明示后回退 AI（避免"标着词典却给的 AI"）
    useNoticeStore.getState().push({
      level: 'ai',
      title: '查词提示',
      message: '查词方式为「词典优先」，但你尚未配置 uapis 词典 Key，本次已改用 AI 查词。',
      duration: 5000
    })
  }
  return hint + '〔来源：AI 词卡〕\n' + (await lookupWordViaAI(w))
}

/** 纯 AI 词卡（与 store 内 lookupWordViaAI 同构，供循环内复用） */
async function lookupWordViaAI(word: string): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content:
        '你是词典助手。为一个英文单词输出简洁词卡，格式严格如下（一行一块，冒号英文）：\n' +
        `word：${word}\n` +
        '音标：/.../\n' +
        '词性：n./v./adj.\n' +
        '释义：一两个中文义项\n' +
        '例句：1 句简单英文例句（含译）\n' +
        '简单评估它属于日常词还是学术词。不要额外解释。'
    },
    { role: 'user' as const, content: word }
  ]
  try {
    const call = agentComplete(messages, { temperature: 0.2, maxTokens: 900 })
    return await call.promise
  } catch (e) {
    return `AI 查词失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 批量分级（输出后置校验：全空或未识别则自愈重试一次） */
async function heavyGrade(wordsRaw: string): Promise<string> {
  const words = wordsRaw.split(/[\s,，;；、]+/).filter((w) => /^[A-Za-z][A-Za-z'-]{1,45}$/.test(w)).slice(0, 12)
  if (!words.length) return '请提供要分级的英文单词。'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await aiGradeWords(words)
      const valid = res.filter((r) => r.word && r.raw)
      if (valid.length) return valid.map((r) => `${r.word} → ${r.raw || '未识别'}`).join('\n')
      // 全空 / 未识别 → 再试一次
    } catch (e) {
      if (attempt === 1) return `分级失败：${e instanceof Error ? e.message : String(e)}`
    }
  }
  return '未能识别这些单词（已重试一次）。'
}

/** 整理生词（输出后置校验 + 结构化摘要回填） */
async function heavyOrganize(modeRaw?: string): Promise<{ text: string; digest?: string }> {
  const mode = (modeRaw ?? 'synonym') as Parameters<typeof aiOrganize>[1]
  const words = useWordbookStore.getState().words
  if (!words.length) return { text: '生词本是空的，先收藏一些单词再整理。' }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await aiOrganize(words, mode)
      if (res.error) {
        if (attempt === 1) return { text: `整理失败：${res.error}` }
        continue
      }
      if (res.clusters.length) {
        const text = res.clusters.map((c) => `· ${c.name}（${c.words.length} 词）：${c.words.map((w) => w.word).join('、')}`).slice(0, 12).join('\n')
        const digest =
          res.clusters.length > 4
            ? `整理出 ${res.clusters.length} 组（前 4）：\n` +
              res.clusters.slice(0, 4).map((c) => `· ${c.name}（${c.words.length} 词）`).join('\n') +
              '\n…'
            : undefined
        return { text, digest }
      }
      // 空分组 → 再试一次
    } catch (e) {
      if (attempt === 1) return { text: `整理失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  return { text: '未能生成分组（已重试一次）。' }
}

/** 导出译文 */
async function heavyDocExport(): Promise<string> {
  // 该工具被 guard 在 agentTools 内做文件保存；此处借用其轻量包装
  const out = executeTool('doc_export', {})
  if (out.asyncStarted) return '已触发导出，结果稍后回填。'
  return out.text
}

/** 历史检索：按关键词查找历史摘要与文档译文 */
async function heavyHistorySearch(keyword: string): Promise<{ text: string; digest?: string }> {
  const kw = keyword.trim()
  if (!kw) return { text: '请在历史检索中提供关键词（如文档名「独立宣言」）。' }
  try {
    const text = await useHistoryStore.getState().searchRecords(kw)
    return { text, digest: text.length > 400 ? text.slice(0, 400) : undefined }
  } catch (e) {
    return { text: `历史检索失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * 添加生词（ReAct 版本，带前置校验）：
 *   - 先做统一清洗（cleanWord：大小写 / 音标噪声 / 歧义归一化）。
 *   - 再离线判错：若清洗后的词不在词库，且邻近词库给出高置信的「明显更可能的拼写」，
 *     则拦截并提示（避免把错拼直接存进生词本），而不是静默入库。
 *   - 仅当没有高置信离线建议（可能为专有名词 / 冷僻但合法的词）时才允许入库，避免误伤。
 * 全程走离线层（bestOfflineSpelling），不额外消耗 LLM。
 */
async function heavyWordbookAdd(params: Record<string, string>): Promise<string> {
  const rawWord = (params.word ?? '').trim()
  if (!rawWord) return '需要提供要添加的单词。'
  const cleaned = await cleanWord(rawWord)
  const word = cleaned?.word || rawWord.toLowerCase()
  if (!word) return `没有识别到要保存的英文单词：${rawWord}`

  const wb = useWordbookStore.getState()
  if (wb.words.some((w) => w.word.toLowerCase() === word)) {
    return `「${word}」已在生词本中（生词本按不区分大小写去重）。`
  }

  // 前置校验：明显错拼（离线编辑距离高置信命中且 ≠ 原词）→ 拦截提示，不直接入库
  const offline = await bestOfflineSpelling(word)
  if (offline && offline.toLowerCase() !== word.toLowerCase()) {
    return `「${rawWord}」可能是拼写错误，你是否想保存「${offline}」？为避免把错拼存入生词本，本次未添加。如需确认硬存，请用「添加生词 ${word}」并明确该词。`
  }

  wb.add({
    word,
    definition: (params.definition ?? '').trim(),
    context: params.context?.trim(),
    pos: params.pos?.trim()
  })
  return `已将「${word}」加入生词本。`
}

/* ---------------- 工具描述（供 ReAct 决策） ---------------- */

function buildToolDescs(): string {
  const extraParams: Record<string, string> = {
    word_lookup: 'word：要查询的英文单词（必填）；save：可选，为 true 时查询后加入生词本',
    grade_word: 'word：要分级的单词（可多个，空格/逗号分隔）',
    organize_words: 'mode：synonym | academic | affix | theme（可选，默认 synonym）',
    wordbook_add: 'word：单词（必填）；definition：释义（可选）；context：语境（可选）；pos：词性（可选）。注意：会做统一清洗，明显拼写错误会被拦截并给建议，不会硬存错拼',
    wordbook_list: 'limit：返回词数（可选，默认 10）',
    navigate: 'view：home | wordbook | flashcard | quotes | stats | history | settings',
    set_lookup_source: 'source：dict（词典优先）或 llm（仅 AI）',
    set_goal: 'goal：学习目标内容',
    speak: 'text：要朗读的文本',
    open_external: 'url：http/https 链接',
    flashcard_draw: 'count：抽卡数（1-20）',
    history_search: 'keyword：要检索的历史关键词（文档名等），如「独立宣言」'
  }
  return TOOLS.map((t) => {
    const params = extraParams[t.id] ?? '（无需参数）'
    return `${t.id}：${t.name}。${t.desc}${t.sideEffect ? '（会改变数据/界面）' : ''}。参数：${params}`
  }).join('\n')
}

/** ReAct 系统提示 */
const REACT_SYS = (): string =>
  '你是 Academic Lens 的智能体，用简体中文为用户完成英文阅读、背单词相关操作。' +
  '你可以按需连续调用多个工具（工具结果会回显给你），先想清楚再决定下一步，需要时一个工具的结果可作为下一步的输入。\n' +
  `当前上下文：\n${wordbookContextText()}\n查词方式：${lookupModeHint()}\n` +
  `可用工具：\n${buildToolDescs()}\n` +
  '工作方式（严格 JSON，一次输出一条）：\n' +
  '1) 需要执行工具时，输出：{"tool":"<工具id>","params":{...}}，必要参数必须填全。\n' +
  '2) 当目标已达成、或请求无需工具（如询问、翻译长句属重型任务不路由工具）时，输出：{"done":true,"answer":"最终回答"}，answer 用简体中文、1-3 句、直接回应用户。\n' +
  '禁止编造未执行的操作。翻译长文/长句不属于工具职责，应直接给 final answer。\n' +
  '只输出上述 JSON，不要输出任何其他解释文字。'

interface ReActDecision {
  tool?: string
  params?: Record<string, string>
  done?: boolean
  answer?: string
}

function extractJsonObj(raw: string): ReActDecision | null {
  const m = raw.trim().match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as ReActDecision
  } catch {
    return null
  }
}

/** 是否应结束循环的判定（改由 LLM 的 done 决定；本函数仅供防御） */
function isFinalAnswer(decision: ReActDecision): boolean {
  return Boolean(decision.done) || !decision.tool
}

/**
 * ReAct 主循环。
 * @returns 最终回答文本
 */
export async function runReAct(
  userText: string,
  opts: AgentLoopOptions = {}
): Promise<ReActResult> {
  const maxSteps = opts.maxSteps ?? REACT_MAX_STEPS
  const steps: AgentStep[] = []
  // 初始用户输入作为第一轮 user 消息（可携带高模型产出的初步计划）
  const seed: LLMMessage[] = [
    { role: 'system', content: REACT_SYS() },
    {
      role: 'user',
      content: opts.plan
        ? `请参考以下高模型给出的初步计划执行，可依据工具实际返回灵活调整：\n${opts.plan}\n\n用户请求：${userText}`
        : userText
    }
  ]
  let messages: LLMMessage[] = seed

  let answer = ''
  let parseFails = 0
  for (let i = 0; i < maxSteps; i++) {
    const decRaw = await agentComplete(messages, { temperature: 0, maxTokens: 1024, json: true })
    const decision = extractJsonObj(await decRaw.promise)
    if (!decision) {
      // 自愈：JSON 解析失败时把错误回填给 LLM 重新决策，最多重试 1 次，避免白白耗尽步数
      parseFails++
      if (parseFails >= 2) {
        answer = '智能体解析失败，请换个说法再试。'
        break
      }
      messages = [
        ...messages,
        { role: 'user', content: '错误：你上一次的输出不是合法 JSON。请只输出 {"tool":"<工具id>","params":{...}} 或 {"done":true,"answer":"..."}，不要输出任何其他文字。' }
      ]
      continue
    }

    // 收尾
    if (isFinalAnswer(decision)) {
      answer = (decision.answer ?? '').trim() || '（已完成）'
      steps.push({ kind: 'done' })
      break
    }

    // 执行工具
    const toolId = decision.tool as ToolId
    const tool = TOOLS.find((t) => t.id === toolId)
    if (!tool) {
      // 非法工具 id：回显错误并让 LLM 重新决策（不用尽步数）
      messages = [...messages, { role: 'user', content: `错误：工具「${toolId}」不存在，请改用上述可用工具或直接给出最终回答。` }]
      continue
    }
    const params = decision.params ?? {}
    // 二次确认挂起：破坏性工具先不执行，把决策交回调用方请求用户确认
    if (opts.onTool?.(toolId, params) === false) {
      return { answer: '', steps, blocked: { toolId, params } }
    }
    const result = await runTool(toolId, params)
    const step: AgentStep = { kind: 'tool', toolId, toolLabel: tool.name, sideEffect: tool.sideEffect, observation: result.text }
    steps.push(step)
    opts.onStep?.(step)
    // 回填观察：优先用结构化摘要（digest），避免大结果被截断导致决策失真
    const digest = result.digest ?? result.text
    const observation = `${tool.name} 执行结果：\n${digest.slice(0, 800)}`
    messages = [...messages, { role: 'user', content: `工具「${tool.name}」执行完毕，结果如下：\n${observation}\n请根据该结果决定下一步：继续调用工具，或给出最终回答。` }]
  }

  if (!answer) answer = '达到了最大步骤数，已停止。'
  return { answer, steps }
}

/* ---------------- 确定性规则（快速单工具路径） ---------------- */

/**
 * 只做规则解析（不做 LLM 兜底），返回是否命中单个工具。
 * 供 send 走"快速命令"路径，减少一次 LLM 往返。
 * 覆盖导航 / 生词本（概览·到期·列表·添加）/ 查词 / 分级 / 整理 / 抽卡 /
 * 周报 / 文档 / 查词方式 / 个性化目标 / 朗读。
 */
export function resolveByRules(text: string): { tool: ToolId; params: Record<string, string> } | null {
  const trimmed = text.trim()
  const rules: { re: RegExp; fn: (m: RegExpMatchArray, text: string) => { tool: ToolId; params: Record<string, string> } | null }[] = [
    // —— 导航 ——
    { re: /(跳转|打开|去|进入|看).*(生词本)/i, fn: () => ({ tool: 'navigate', params: { view: 'wordbook' } }) },
    { re: /(跳转|打开|去|进入).*(闪卡|抽词)/i, fn: () => ({ tool: 'navigate', params: { view: 'flashcard' } }) },
    { re: /(跳转|打开|去|进入|看).*(统计|数据|周报)/i, fn: () => ({ tool: 'navigate', params: { view: 'stats' } }) },
    { re: /(跳转|打开|去|进入).*(设置)/i, fn: () => ({ tool: 'navigate', params: { view: 'settings' } }) },
    // —— 生词本 ——
    { re: /多少词|有几个词|生词.*概览|掌握情况|复习情况|盘点/i, fn: () => ({ tool: 'wordbook_summary', params: {} }) },
    { re: /到期|该复习|要复习/i, fn: () => ({ tool: 'wordbook_due', params: {} }) },
    { re: /生词本.*(列表|看看|都有|前\s*\d+)/i, fn: (_m, t) => {
      const n = t.match(/前\s*(\d+)/)
      const params: Record<string, string> = n ? { limit: n[1] } : {}
      return { tool: 'wordbook_list', params }
    } },
    { re: /把\s*([a-z][a-z'-]{1,45})\s*(?:保存|存入|记入|加入|记到).*生词|(?:加入|收藏|存进|记下)\s*([a-z][a-z'-]{1,45})/i, fn: (m) => ({ tool: 'wordbook_add', params: { word: m[1] || m[2] } }) },
    // —— 查词（学习） ——
    { re: /\b([a-z][a-z'-]{1,45})\b\s*(?:什么意思|怎么读|如何发音|啥意思|什么含义)/i, fn: (m) => ({ tool: 'word_lookup', params: { word: m[1] } }) },
    { re: /查(?:询|一下|一查)?(?:单词|词)?\s*[:：]?\s*([a-z][a-z'-]{1,45})$/i, fn: (m) => ({ tool: 'word_lookup', params: { word: m[1] } }) },
    { re: /(?:查|查一下)\s*([a-z][a-z'-]{1,45})\s*(?:的)?(?:意思|含义|翻译)/i, fn: (m) => ({ tool: 'word_lookup', params: { word: m[1] } }) },
    // —— 分级 / 整理 ——
    { re: /(?:给|把).*([a-z][a-z'-]{1,45}).*(分级|难度)/i, fn: (m) => ({ tool: 'grade_word', params: { word: m[1] } }) },
    { re: /分级\s*[:：]?\s*([a-z][a-z'-]{1,45})/i, fn: (m) => ({ tool: 'grade_word', params: { word: m[1] } }) },
    { re: /整理.*生词|生词.*(近反|专业|词根|主题)/i, fn: (_m, t) => ({ tool: 'organize_words', params: { mode: /近反/.test(t) ? 'synonym' : /专业/.test(t) ? 'academic' : /词根/.test(t) ? 'affix' : 'theme' } }) },
    // —— 闪卡 ——
    { re: /抽\s*(\d+)?\s*张?闪卡|抽词|出\s*(\d+)?\s*张?卡片/i, fn: (m) => ({ tool: 'flashcard_draw', params: { count: m[1] || '10' } }) },
    // —— 查词方式 ——
    { re: /(词典优先|用词典|uapis)/i, fn: () => ({ tool: 'set_lookup_source', params: { source: 'dict' } }) },
    { re: /(只用|仅用|全部用).*ai.*查词|切换.*ai/i, fn: () => ({ tool: 'set_lookup_source', params: { source: 'llm' } }) },
    // —— 个性化 ——
    { re: /(我的.*(?:档案|目标)|查看.*目标|我的目标是什么)/i, fn: () => ({ tool: 'get_profile', params: {} }) },
    { re: /(?:记下|设定|设为|更新)?(?:我的)?(?:学习目标|目标)\s*[:：]?\s*(.+)/i, fn: (m) => { const g = m[1].replace(/^(是|为|要|想|记成)\s*/, '').trim(); return { tool: 'set_goal', params: { goal: g || m[1].trim() } } } },
    // —— 文档 / 周报 ——
    { re: /(生成|来|写).*周报|周报/i, fn: () => ({ tool: 'report', params: {} }) },
    { re: /(摘要|总结).*(文档|这篇)|总结一下/i, fn: () => ({ tool: 'doc_summarize', params: {} }) },
    { re: /(命中率|生词.*占比|陌生词)/i, fn: () => ({ tool: 'doc_unknown', params: {} }) },
    { re: /当前.*文档|这个文档|看.*文档上下文/i, fn: () => ({ tool: 'doc_context', params: {} }) },
    // —— 朗读 ——
    { re: /(朗读|发音|读一下|念一下).*([a-z][a-z'-]{1,45})/i, fn: (m) => ({ tool: 'speak', params: { text: m[2] } }) },
    // —— 历史检索：找之前某文档的摘要 / 译文 ——
    { re: /(之前|以前|历史).*?(摘要|译文|翻译)|(找|查找|帮我回忆|还原).*?(摘要|译文|翻译)/i, fn: (_m, t) => {
      // 去掉功能词，剩下的主要是文档名关键词
      const kw = t
        .replace(/(前面|之前|以前|历史|记录|我|的|这篇|那篇|这个|那个|只要|看过|找|一下|帮我|请|讲|告诉|给|查|什么|内容|译文|摘要|翻译|回忆)(?:给我|一下|了)?/g, '')
        .replace(/[《》"“”\s]/g, '')
        .trim()
      return { tool: 'history_search', params: { keyword: kw.slice(0, 20) } }
    } }
  ]
  for (const r of rules) {
    const m = trimmed.match(r.re)
    if (m) {
      const r2 = r.fn(m, trimmed)
      if (r2) return r2
    }
  }
  return null
}