import { agentComplete } from './llm'
import type { LLMMessage } from '../bridge/types'
import { dictLookup } from './dictLookup'
import { formatUapisCard } from './wordCard'
import { cleanWord, suggestSpelling } from './wordClean'
import { bestOfflineSpelling } from './suggest'
import { isPhrase } from './phrases'
import { aiGradeWords } from './flashcard'
import { aiOrganize } from './organize'
import { useSettingsStore } from '../stores/settingsStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { executeTool, TOOLS, type ToolId, type ToolOutput } from './agentTools'
import { useNoticeStore } from '../stores/noticeStore'
import { useHistoryStore } from '../stores/historyStore'
import { useFileStore } from '../stores/fileStore'
import { generateQuiz } from './quiz'
import { explainMath } from './mathExplain'
import { polishText } from './polish'
import { runStudyPackPipeline, runGradeQuizPipeline } from './subAgents'
import { searchArxivPapers, searchGithubRepos } from './academicSearch'
import { searchHuggingFaceModels } from './huggingfaceSearch'
import { generateBibTeX, generateAPA, generateIEEE, generateGBT7714 } from './citationGenerator'
import {
  generatePeerReview,
  generateCodeSkeleton,
  analyzeGrammarTree,
  explainSynonymNuance,
  evaluateIeltsToeflEssay
} from './academicAdvanced'
import { searchPhrasebank } from './academicPhrasebank'
import { preprocessUserQuery } from './agentPreprocess'
import { useProjectStore } from '../stores/projectStore'

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
  /** 多轮对话历史（不含当前用户输入），注入首轮决策上下文，支撑跨轮批改/追问 */
  context?: LLMMessage[]
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
      return { text: await heavyDocExport(params.format) }
    case 'doc_summarize': {
      const r = await heavyDocSummarize(params.focus ?? params.text)
      return { text: r.text, digest: r.digest }
    }
    case 'quiz_generate':
      return { text: await heavyQuizGenerate(params.context ?? params.source ?? params.text) }
    case 'quiz_grade': {
      const res = await runGradeQuizPipeline(params.answers ?? params.text ?? '')
      return { text: res.text }
    }
    case 'pipeline_study_pack': {
      const res = await runStudyPackPipeline()
      return { text: res.text }
    }
    case 'academic_search':
      return { text: await heavyAcademicSearch(params.query ?? params.text ?? '') }
    case 'github_search':
      return { text: await heavyGithubSearch(params.query ?? params.text ?? '') }
    case 'huggingface_search':
      return { text: await heavyHuggingFaceSearch(params.query ?? params.text ?? '') }
    case 'bibtex_lookup':
      return { text: await heavyBibtexLookup(params.query ?? params.text) }
    case 'paper_review':
      return { text: await heavyPaperReview() }
    case 'code_generate':
      return { text: await heavyCodeGenerate() }
    case 'phrasebank_query':
      return { text: heavyPhrasebankQuery(params.query ?? params.text ?? '') }
    case 'grammar_analyze':
      return { text: await heavyGrammarAnalyze(params.sentence ?? params.text ?? '') }
    case 'synonym_nuance':
      return { text: await heavySynonymNuance(params.words ?? params.text ?? '') }
    case 'ielts_toefl_evaluate':
      return { text: await heavyIeltsToeflEvaluate(params.essay ?? params.text ?? '') }
    case 'project_list':
      return { text: heavyProjectList() }
    case 'project_create':
      return { text: heavyProjectCreate(params) }
    case 'project_add_doc':
      return { text: heavyProjectAddDoc(params) }
    case 'project_summary':
      return { text: await heavyProjectSummary(params.projectId) }
    case 'math_explain':
      return { text: await heavyMathExplain(params.latex ?? params.text ?? '', params.context) }
    case 'polish_run':
      return { text: await heavyPolish(params.text ?? '', params.tone) }
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
  if (id === 'doc_summarize' && text.length > 400) {
    return text.slice(0, 400) + '\n…（已获取文档核心摘要）'
  }
  if (id === 'report' && text.length > 500) return text.slice(0, 500) + '\n…（周报正文较长，回复用户时保留要点即可）'
  return undefined
}

/* ---------------- 重型工具实现（可 await） ---------------- */

/** 查词：dict 优先（若可用），否则 AI 词卡 */
async function heavyWordLookup(word: string): Promise<string> {
  // 短语优先：绕过 cleanWord（它只取第一个单词，会破坏短语），直接走短语词卡（与快速翻译一致）
  if (isPhrase(word)) {
    return '〔来源：AI 词卡〕\n' + (await lookupPhraseViaAI(word.trim()))
  }
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

/** 纯 AI 短语词卡（对齐快速翻译的短语提示词，供循环内复用） */
async function lookupPhraseViaAI(phrase: string): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content:
        '你是专业学术英语词典。请用简体中文解释用户给出的英文学术短语或词组，说明其含义与学术用法。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
        'word|短语本身\n' +
        'phonetic|大致音标（可省略）\n' +
        'pos|类型（如 phrase / prep. phrase / conj. / idiom）\n' +
        'def|简明学术释义，多条用；分隔\n' +
        'ex1|英文学术例句 | 中文翻译\n' +
        'ex2|英文学术例句 | 中文翻译\n' +
        '如果该短语是学术专业术语，在 def 末尾标注「（学术术语：所属领域）」'
    },
    { role: 'user' as const, content: phrase }
  ]
  try {
    const call = agentComplete(messages, { temperature: 0, maxTokens: 900 })
    return await call.promise
  } catch (e) {
    return `AI 短语查词失败：${e instanceof Error ? e.message : String(e)}`
  }
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
async function heavyDocExport(formatRaw?: string): Promise<string> {
  const format = formatRaw?.toLowerCase() === 'pdf' ? 'pdf' : 'md'
  // 该工具被 guard 在 agentTools 内做文件保存；此处借用其轻量包装
  const out = executeTool('doc_export', { format })
  if (out.asyncStarted) return '已触发导出，结果稍后回填。'
  return out.text
}

/** 文档摘要：真实提取当前文档核心贡献、大纲与关键术语，就地返回结构化 Markdown */
async function heavyDocSummarize(focus?: string): Promise<{ text: string; digest?: string }> {
  const { doc, segments, summary } = useFileStore.getState()
  if (!doc || !segments.length) {
    return { text: '当前没有打开任何文档，请先在阅读页打开或拖入一篇英文文档。' }
  }
  // 若已有生成好的完整摘要，直接就地复用
  if (summary && summary.trim().length > 60) {
    const text = `【文档核心摘要 · ${doc.name}】\n${summary}`
    const digest = `已获取当前文档「${doc.name}」摘要（共 ${summary.length} 字），包含核心贡献、大纲与关键术语。`
    return { text, digest }
  }

  // 现场生成精简高质量摘要
  const fullText = segments.slice(0, 15).map((s) => s.text).join('\n\n')
  const prompt = focus
    ? `请重点关注「${focus}」，分析总结以下文档：\n\n${fullText.slice(0, 5000)}`
    : `请分析总结以下文档：\n\n${fullText.slice(0, 5000)}`
  const sys =
    '你是学术论文分析专家。基于提供的文档片段，请用简体中文输出一份精炼的学术摘要，包含：\n' +
    '### 🎯 核心贡献与主旨\n用 3–5 句话讲清论文主要解决的问题、提出的创新方案与主要实验结论。\n\n' +
    '### 📌 核心要点大纲\n列出 3–4 个关键逻辑要点。\n\n' +
    '### 🔑 关键学术术语\n列出 3–5 个核心专业术语及简明中文释义。\n' +
    '只输出上述 Markdown 正文，直接进入主题，不要多余开场白。'

  try {
    const call = agentComplete(
      [
        { role: 'system', content: sys },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.2, maxTokens: 1200 }
    )
    const gen = (await call.promise).trim()
    if (gen) {
      useFileStore.setState({ summary: gen, summaryState: 'done' })
      useHistoryStore.getState().add('summary', doc.name, '智能体生成摘要', gen)
      const text = `【文档核心摘要 · ${doc.name}】\n${gen}`
      const digest = `文档「${doc.name}」摘要已生成：\n${gen.slice(0, 400)}…`
      return { text, digest }
    }
  } catch {
    /* 降级回退 */
  }
  return { text: `当前文档「${doc.name}」共 ${segments.length} 段。开头概述：${segments.slice(0, 3).map((s) => s.text.slice(0, 100)).join(' / ')}` }
}

/** 随堂测验：基于当前文档或摘要生成 3 道题（含单选/填空/简答，就地呈现并引导作答） */
async function heavyQuizGenerate(contextParam?: string): Promise<string> {
  const { doc, segments, summary } = useFileStore.getState()
  if (!doc || !segments.length) return '请先在翻译页打开一篇文档，我才能基于它出题。'

  let snippet = ''
  if (summary && summary.length > 50) {
    snippet = `【文档摘要】：\n${summary.slice(0, 2000)}\n\n【核心段落】：\n${segments.slice(0, 10).map((s) => s.text).join('\n')}`
  } else {
    snippet = segments.map((s) => s.text).join('\n')
  }

  const instruction = contextParam && /摘要/.test(contextParam)
    ? '请重点基于提供的文档核心摘要与要点来命制理解题。'
    : contextParam?.trim() || undefined

  try {
    const paper = await generateQuiz(doc.name, snippet, instruction)
    const qs = paper.questions.map((q, i) => {
      const opts = q.options?.length ? '\n' + q.options.map((o) => `  ${o.key}. ${o.text}`).join('\n') : ''
      const kind = q.type === 'choice' ? '单选' : q.type === 'blank' ? '填空' : '简答'
      return `${i + 1}. [${kind}] ${q.title}${opts}`
    })
    const answers = paper.questions.map((q, i) => `${i + 1}. 答案：${q.answer}\n解析：${q.explanation}`).join('\n')
    return (
      `【随堂测验 · ${paper.title}】\n\n` +
      `${qs.join('\n\n')}\n\n` +
      `💡 **作答提示**：您可以直接在下方回复答案（例如「1.A 2.Dropout 3.xxx」），我会为您逐题精准批改并解析考点！\n\n` +
      `（参考答案仅内部批改用，组织回复时先不要直接公布给用户，等用户作答后再逐题批改）\n${answers}`
    )
  } catch (e) {
    return `出题失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 公式讲解：大白话、直觉、符号表、推导步骤 */
async function heavyMathExplain(latexRaw: string, context?: string): Promise<string> {
  const trimmed = (latexRaw ?? '').trim()
  if (!trimmed) return '请提供要讲解的公式（可直接贴 LaTeX 表达式，如 $E = mc^2$）。'
  try {
    const r = await explainMath(trimmed, context ?? '')
    const symbols = r.symbols.length ? `\n\n【符号表】\n${r.symbols.map((s) => `· ${s.symbol}（${s.name}）：${s.meaning}`).join('\n')}` : ''
    const steps = r.steps.length ? `\n\n【推导步骤】\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''
    return `【公式】${r.latex}\n\n【一句话】${r.plainSummary}\n\n【直觉】${r.intuition}${symbols}${steps}`
  } catch (e) {
    return `公式讲解失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 学术润色：严格/精炼/委婉三语气，返回润色全文 + 修改要点 + 学术搭配 */
async function heavyPolish(textRaw: string, toneRaw?: string): Promise<string> {
  const text = (textRaw ?? '').trim()
  if (!text) return '请提供需要润色的英文学术文本。'
  const tone = toneRaw === 'concise' || toneRaw === 'hedging' ? toneRaw : 'strict'
  try {
    const r = await polishText(text, tone)
    const diffs = r.diffs.slice(0, 8).map((d) => `· ${d.original ?? ''} → ${d.replacement ?? ''}（${d.reason}）`).join('\n')
    const collocs = r.collocations.slice(0, 6).map((c) => `· ${c.word}（${c.meaning}）：${c.usage}`).join('\n')
    const improve = r.improvements.length ? `\n\n【改进要点】\n${r.improvements.map((i, n) => `${n + 1}. ${i}`).join('\n')}` : ''
    return `【润色后 · ${r.wordCountOriginal} → ${r.wordCountPolished} 词】\n${r.polished}` +
      improve +
      (diffs ? `\n\n【关键修改】\n${diffs}` : '') +
      (collocs ? `\n\n【学术搭配】\n${collocs}` : '')
  } catch (e) {
    return `润色失败：${e instanceof Error ? e.message : String(e)}`
  }
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

/* ---------------- 联网搜索与学术 RAG ---------------- */

/** 智能提炼英文学术检索词（arXiv 为英文库，需将中文口语/主题转为专业英文学术词） */
async function toEnglishAcademicKeyword(userQuery: string): Promise<string> {
  const curDoc = useFileStore.getState().doc?.name?.replace(/\.[^.]+$/, '') || ''
  // 纯英文且简短则直接使用
  if (/^[A-Za-z0-9\s\-–—_:.,]+$/.test(userQuery.trim()) && userQuery.trim().length < 50) {
    return userQuery.trim()
  }
  const prompt =
    `You are an academic research assistant. Extract only the 1-3 core English academic keywords from the user's research query for arXiv paper search (e.g., "Transformer Mamba", "Diffusion Model", "Graph Neural Network").\n` +
    `Reference doc context: "${curDoc}".\n` +
    `Rules: Output ONLY the English keywords, without any Chinese, punctuation, or explanations.\n` +
    `User query: ${userQuery}`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: 'You extract English keywords for arXiv paper search. Output only English keywords.' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0, maxTokens: 40 }
    ).promise
    const kw = res.trim().replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
    return kw || userQuery.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim() || 'Transformer'
  } catch {
    return userQuery.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim() || 'Transformer'
  }
}

/** 智能提炼 GitHub 仓库/模型英文检索词 */
async function toGithubSearchKeyword(userQuery: string): Promise<string> {
  const curDoc = useFileStore.getState().doc?.name?.replace(/\.[^.]+$/, '') || ''
  if (/^[A-Za-z0-9\-_.]+$/.test(userQuery.trim())) {
    return userQuery.trim()
  }
  const prompt =
    `You are a software engineering assistant. Extract only the primary English project, repository, or model name for GitHub API search (e.g., "vllm", "llama", "transformers", "autogen", "mamba").\n` +
    `Reference doc context: "${curDoc}".\n` +
    `Rules: Output ONLY the English project keyword, without any Chinese or explanations.\n` +
    `User query: ${userQuery}`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: 'You extract GitHub search keywords. Output only English keywords.' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0, maxTokens: 40 }
    ).promise
    const kw = res.trim().replace(/[^a-zA-Z0-9\s-_]/g, ' ').replace(/\s+/g, ' ').trim()
    return kw || userQuery.replace(/[^a-zA-Z0-9\s-_]/g, ' ').replace(/\s+/g, ' ').trim() || 'transformers'
  } catch {
    return userQuery.replace(/[^a-zA-Z0-9\s-_]/g, ' ').replace(/\s+/g, ' ').trim() || 'transformers'
  }
}

async function heavyAcademicSearch(query: string): Promise<string> {
  const rawQ = query.trim()
  if (!rawQ) return '请输入要检索的学术论文关键词或研究主题（例如「LLM Agent」）。'
  
  // 智能提炼英文关键词
  const englishKw = await toEnglishAcademicKeyword(rawQ)

  try {
    const papers = await searchArxivPapers(englishKw, 4)
    if (!papers.length) {
      // 备用 fallback：去掉过细词再查一次
      const fallbackKw = englishKw.split(' ')[0]
      const retry = fallbackKw ? await searchArxivPapers(fallbackKw, 4) : []
      if (!retry.length) {
        return `未检索到关于「${rawQ}」（检索词：\`${englishKw}\`）的公开论文，建议换用更通用的学术领域词再试。`
      }
      return formatPaperResults(rawQ, fallbackKw, retry)
    }
    return formatPaperResults(rawQ, englishKw, papers)
  } catch (e) {
    return `学术检索失败：${e instanceof Error ? e.message : String(e)}`
  }
}

function formatPaperResults(userQuery: string, kw: string, papers: any[]): string {
  const lines = papers.map((p, i) => {
    const authors = p.authors.length ? ` · ${p.authors.join(', ')}` : ''
    return `**${i + 1}. [${p.title}](${p.url})**\n- 📅 发布日期：\`${p.published}\`${authors}\n- 📖 核心摘要：${p.summary}\n- 📥 [下载/查看 PDF](${p.pdfUrl || p.url})\n`
  })
  return `### 🔍 arXiv 学术论文检索结果\n> **您的查询**：${userQuery}（已自动转换为学术检索词：\`${kw}\`）\n\n${lines.join('\n')}\n💡 **提示**：可直接输入「总结第 1 篇」或下载后拖入对话框深入研读。`
}

async function heavyGithubSearch(query: string): Promise<string> {
  const rawQ = query.trim()
  if (!rawQ) return '请输入要检索的开源项目或算法名称。'
  
  // 智能提炼 GitHub 检索词
  const englishKw = await toGithubSearchKeyword(rawQ)

  try {
    const repos = await searchGithubRepos(englishKw, 4)
    if (!repos.length) {
      return `未检索到关于「${rawQ}」（检索词：\`${englishKw}\`）的 GitHub 开源项目。`
    }
    const lines = repos.map((r, i) => {
      return `**${i + 1}. [${r.fullName}](${r.url})** ⭐ ${r.stars.toLocaleString()} [${r.language}]\n- 📝 描述：${r.description}\n`
    })
    return `### 🐙 GitHub 学术开源仓库检索\n> **检索关键词**：\`${englishKw}\`\n\n${lines.join('\n')}`
  } catch (e) {
    return `GitHub 检索失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/* ---------------- 学术项目制管理 ---------------- */

function heavyProjectList(): string {
  const { projects, activeProjectId } = useProjectStore.getState()
  if (!projects.length) {
    return '当前暂无学术项目。可输入「创建学术项目 [名称] 主题 [研究主题]」新建一个！'
  }
  const lines = projects.map((p) => {
    const isCur = p.id === activeProjectId ? ' (当前激活)' : ''
    const docNames = p.documents.length
      ? p.documents.map((d) => `  - 📄 ${d.name}`).join('\n')
      : '  （暂无文献，可随时导入）'
    return `📁 **${p.title}**${isCur}\n- 🎯 研究主题：\`${p.topic}\`\n- 📚 下属文献 (${p.documents.length} 篇)：\n${docNames}`
  })
  return `### 📂 我的学术研究项目清单\n\n${lines.join('\n\n')}`
}

function heavyProjectCreate(params: Record<string, string>): string {
  const title = (params.title ?? params.name ?? '').trim()
  const topic = (params.topic ?? params.subject ?? title).trim()
  if (!title) return '创建学术项目需提供项目名称（例如「大模型智能体」）。'
  const proj = useProjectStore.getState().createProject({
    title,
    topic: topic || '通用学术研究',
    description: params.description
  })
  return `已成功创建学术项目「**${proj.title}**」（预设主题：\`${proj.topic}\`），并已切换为当前激活项目！可随时导入文献或在「来做学术」板块中查看。`
}

function heavyProjectAddDoc(params: Record<string, string>): string {
  const { doc, segments } = useFileStore.getState()
  if (!doc) return '当前没有打开任何文献，请先在阅读器打开或拖入文献。'
  const { projects, activeProjectId } = useProjectStore.getState()
  let targetProj = projects.find((p) => p.id === activeProjectId)
  if (params.project) {
    const found = projects.find((p) => p.title.includes(params.project) || p.topic.includes(params.project))
    if (found) targetProj = found
  }
  if (!targetProj) {
    return '请先创建一个学术项目，或明确指定要归档到的项目名称。'
  }
  useProjectStore.getState().addDocToProject(targetProj.id, {
    name: doc.name,
    size: doc.size,
    path: doc.path,
    rawBuffer: doc.rawBuffer,
    segments
  })
  return `已将文献《**${doc.name}**》成功归档至学术项目「**${targetProj.title}**」！`
}

async function heavyProjectSummary(projectId?: string): Promise<string> {
  const { projects, activeProjectId } = useProjectStore.getState()
  const proj = projects.find((p) => (projectId ? p.id === projectId : p.id === activeProjectId))
  if (!proj) return '未找到对应学术项目。'
  if (!proj.documents.length) {
    return `学术项目「${proj.title}」暂无下属文献，先导入几篇文献再生成全景综述吧！`
  }

  const docSummaries = proj.documents
    .map((d, i) => `【文献 ${i + 1}：《${d.name}》】\n${d.summary || '（未单独生成摘要，已归档文献）'}`)
    .join('\n\n')

  const prompt =
    `你是学术领域高级导师与综述专家。请为学术项目「${proj.title}」（研究主题：${proj.topic}）编写一份结构严谨、逻辑清晰的跨文献全景综述与对比分析：\n\n` +
    `【项目下属文献资料】：\n${docSummaries}\n\n` +
    `请用 Markdown 输出：\n` +
    `1. 🎯 **项目研究全景与背景**；\n` +
    `2. 📊 **文献对比与方法论演进**（各文献的优势、核心创新与局限性）；\n` +
    `3. 💡 **未来研究突破点与启示**。`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是严谨深邃的学术综述专家。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.2, maxTokens: 1400 }
    ).promise
    return `# 🔬 《${proj.title}》跨文献全景综述\n\n> **研究主题**：\`${proj.topic}\` · 共包含 ${proj.documents.length} 篇文献\n\n${res.trim()}`
  } catch (e) {
    return `全景综述生成失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/* ---------------- 顶刊审稿、算法复现与高阶英语能力 ---------------- */

async function heavyHuggingFaceSearch(query: string): Promise<string> {
  const q = query.trim()
  if (!q) return '请输入要检索的 HuggingFace 开源模型名称或任务类型（例如「llama」或「whisper」）。'
  try {
    const models = await searchHuggingFaceModels(q, 4)
    if (!models.length) return `未在 HuggingFace 检索到关于「${q}」的开源模型。`
    const lines = models.map(
      (m, i) =>
        `**${i + 1}. [${m.id}](${m.url})**\n- 🏷️ 任务标签：\`${m.pipelineTag}\` · 📥 下载量：${m.downloads.toLocaleString()} · ❤️ Likes: ${m.likes}`
    )
    return `### 🤗 HuggingFace 开源模型检索（关键词：${q}）\n\n${lines.join('\n\n')}`
  } catch (e) {
    return `HuggingFace 检索失败：${e instanceof Error ? e.message : String(e)}`
  }
}

async function heavyBibtexLookup(rawQuery?: string): Promise<string> {
  const { doc } = useFileStore.getState()
  const title = rawQuery?.trim() || doc?.name?.replace(/\.[^.]+$/, '') || 'Transformer: Attention Is All You Need'
  const meta = {
    title,
    authors: ['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.', 'Uszkoreit, J.'],
    year: '2017',
    venue: 'Advances in Neural Information Processing Systems (NeurIPS)',
    doi: '10.48550/arXiv.1706.03762',
    url: 'https://arxiv.org/abs/1706.03762'
  }
  const bib = generateBibTeX(meta)
  const apa = generateAPA(meta)
  const ieee = generateIEEE(meta)
  const gbt = generateGBT7714(meta)

  return (
    `### 📋 《${title}》学术引用与 BibTeX\n\n` +
    `#### 1. 📌 BibTeX 引用代码\n\`\`\`bibtex\n${bib}\n\`\`\`\n\n` +
    `#### 2. 📚 标准学术引用格式\n` +
    `- **APA 格式**：\n  > ${apa}\n\n` +
    `- **IEEE 格式**：\n  > ${ieee}\n\n` +
    `- **GB/T 7714 国标格式**：\n  > ${gbt}\n\n` +
    `💡 **提示**：可直接复制上述 BibTeX 粘贴入您的 \`references.bib\` 文件。`
  )
}

async function heavyPaperReview(): Promise<string> {
  const { doc, segments, summary } = useFileStore.getState()
  if (!doc || !segments.length) return '请先在阅读器打开一篇文献，审稿专家才能为您进行同行评审。'
  const text = summary
    ? `【核心摘要】：\n${summary}\n\n【正文】：\n${segments.slice(0, 10).map((s) => s.text).join('\n')}`
    : segments.map((s) => s.text).join('\n')
  return await generatePeerReview(text, doc.name)
}

async function heavyCodeGenerate(): Promise<string> {
  const { doc, segments, summary } = useFileStore.getState()
  if (!doc || !segments.length) return '请先在阅读器打开一篇文献，算法工程师才能提取算法流程并生成复现代码。'
  const text = summary
    ? `【核心摘要】：\n${summary}\n\n【正文】：\n${segments.slice(0, 10).map((s) => s.text).join('\n')}`
    : segments.map((s) => s.text).join('\n')
  return await generateCodeSkeleton(text, doc.name)
}

function heavyPhrasebankQuery(query: string): string {
  const q = query.trim()
  if (!q) return '请输入要检索的学术句型场景（如「引言」、「局限性」、「对比」或英文词「gap」）。'
  const hits = searchPhrasebank(q)
  if (!hits.length) return `未找到与「${q}」相关的学术句型，建议换用「引言」、「方法」、「结果」、「局限」等词重试。`
  const lines = hits.map(
    (h, i) => `**${i + 1}. [${h.category} · ${h.subcategory}]**\n- 🇬🇧 **句型**：\`${h.en}\`\n- 🇨🇳 **释义**：${h.zh}\n`
  )
  return `### ✍️ 曼彻斯特学术句型库检索（关键词：${q}）\n\n${lines.join('\n')}`
}

async function heavyGrammarAnalyze(sentence: string): Promise<string> {
  const s = sentence.trim()
  if (!s) return '请输入需要拆解的学术长难句。'
  return await analyzeGrammarTree(s)
}

async function heavySynonymNuance(words: string): Promise<string> {
  const w = words.trim()
  if (!w) return '请输入需要辨析的相近学术词汇（例如「show / demonstrate / reveal」）。'
  return await explainSynonymNuance(w)
}

async function heavyIeltsToeflEvaluate(essay: string): Promise<string> {
  const e = essay.trim()
  if (!e || e.length < 20) return '请提供要批改的雅思/托福作文内容（至少包含一个完整段落）。'
  return await evaluateIeltsToeflEssay(e)
}

/* ---------------- 工具描述（供 ReAct 决策） ---------------- */

function buildToolDescs(): string {
  const extraParams: Record<string, string> = {
    word_lookup: 'word：要查询的英文单词（必填）；save：可选，为 true 时查询后加入生词本',
    grade_word: 'word：要分级的单词（可多个，空格/逗号分隔）',
    organize_words: 'mode：synonym | academic | affix | theme（可选，默认 synonym）',
    wordbook_add: 'word：单词（必填）；definition：释义（可选）；context：语境（可选）；pos：词性（可选）',
    wordbook_list: 'limit：返回词数（可选，默认 10）',
    navigate: 'view：home | wordbook | flashcard | quotes | stats | history | settings',
    set_lookup_source: 'source：dict（词典优先）或 llm（仅 AI）',
    set_goal: 'goal：学习目标内容',
    speak: 'text：要朗读的文本',
    open_external: 'url：http/https 链接',
    flashcard_draw: 'count：抽卡数（1-20）',
    doc_summarize: 'focus：可选，关注特定领域的要点',
    quiz_generate: 'context：可选，基于摘要、文献或指定主题出题',
    quiz_grade: 'answers：用户提交的答案文本',
    math_explain: 'latex：数学公式或 LaTeX 表达式；context：可选上下文',
    polish_run: 'text：待润色英文文本；tone：strict | concise | hedging（默认 strict）',
    history_search: 'keyword：要检索的历史关键词（文档名等）',
    academic_search: 'query：论文检索主题或关键词（中英文均可，如 "Transformer Mamba"）',
    github_search: 'query：GitHub 仓库/开源项目名称（如 "vllm"、"mamba"）',
    huggingface_search: 'query：HuggingFace 模型名称（如 "llama-3"）',
    bibtex_lookup: 'query：论文标题或元数据',
    paper_review: '（无需参数，自动对当前打开的文献执行同行评审）',
    code_generate: '（无需参数，自动基于当前论文算法生成 PyTorch 复现骨架）',
    phrasebank_query: 'query：学术写作功能或场景（如 "research gap"、"intro"）',
    grammar_analyze: 'sentence：需要拆解语法结构的长难句英文文本',
    synonym_nuance: 'words：需要辨析的近义词/易混词（如 "ubiquitous vs pervasive"）',
    ielts_toefl_evaluate: 'essay：要批改打分的雅思/托福大作文或小作文',
    pipeline_study_pack: '（无需参数，生成文献研读全套学习包）',
    project_list: '（无需参数，列出所有学术项目）',
    project_create: 'title：新建项目的名称或研究主题',
    project_add_doc: 'project：目标项目名称',
    project_summary: '（无需参数，生成当前学术项目跨文献全景综述）',
    report: '（无需参数，生成学习周报）'
  }
  return TOOLS.map((t) => {
    const params = extraParams[t.id] ?? '（无需参数）'
    return `${t.id}：${t.name}。${t.desc}${t.sideEffect ? '（会改变数据/界面）' : ''}。参数：${params}`
  }).join('\n')
}

/** 动态提取当前学术文献与项目上下文 */
function academicContextText(): string {
  const { doc, summary, segments } = useFileStore.getState()
  const { projects, activeProjectId } = useProjectStore.getState()
  const activeProj = projects.find((p) => p.id === activeProjectId)

  const docPart = doc
    ? `【当前打开文献】：《${doc.name}》（共 ${segments.length} 个段落）${summary ? `\n【文献核心贡献/摘要】：${summary.slice(0, 350)}...` : ''}`
    : '【当前打开文献】：暂未打开本地文献'

  const projPart = activeProj
    ? `【当前学术项目】：「${activeProj.title}」（已归档 ${activeProj.documents.length} 篇文献）`
    : `【当前学术项目】：未选择（工作区共有 ${projects.length} 个学术项目）`

  return `${docPart}\n${projPart}`
}

/** ReAct 系统提示 */
const REACT_SYS = (): string =>
  '你是 Academic Lens 的高级学术智能体与多学科研究导师，用严谨、清晰、详尽的简体中文为用户提供学术研究、文献精读、算法复现与英语学习支持。\n' +
  '你可以按需自主连续调用工具（工具结果会回显给你），先想清楚再决定下一步，前一个工具的结果可作为下一步的输入。\n\n' +
  '【核心行为准则】\n' +
  '1. 智能问答与学术对比：当用户提出学术问题、追问或对比分析（如「这两篇文章有什么区别？」、「Transformer 和 Mamba 各有什么优劣」），若无需调用新工具，直接在 answer 中给出专业、结构化、深入透彻的解答！\n' +
  '2. 复合任务链式交付：若用户提出复合任务（如「搜索 Transformer 与 Mamba 论文，并做对比分析且出 3 道题」），请先调用 academic_search 检索论文，在拿到观察结果后，组织完整的对比分析并在 answer 中直接附上 3 道理解测验题！\n' +
  '3. 上下文与代词感知：用户常使用「这篇论文」、「当前项目」、「刚才那段话」、「第一个公式」等自由口语表达，请依据下方【当前学术与学习上下文】与多轮历史准确认知其指代对象。\n' +
  '4. 原地完整交付：直接在回答中给出具体内容（如测验题目、文献摘要、对比表格、代码骨架、术语辨析）。绝对禁止回复「请去某某页面查看」、「已为您触发」等传话式废话！\n' +
  '5. 杜绝死循环：如果上一步工具已经返回了有效数据，不要重复调用相同工具，立即组织最终回答（输出 {"done":true,"answer":"..."}）。\n\n' +
  `【当前学术与学习上下文】：\n${academicContextText()}\n${wordbookContextText()}\n查词方式：${lookupModeHint()}\n\n` +
  `可用工具：\n${buildToolDescs()}\n\n` +
  '工作方式（严格 JSON，一次输出一条）：\n' +
  '1) 需要执行工具时，输出：{"tool":"<工具id>","params":{...}}，必要参数必须填全。\n' +
  '2) 当目标已达成、或请求为纯问答/追问时，输出：{"done":true,"answer":"详细解答内容"}，answer 必须包含完整、充实、高质量的 Markdown 解答，绝不能留空。\n' +
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
 * ReAct 主循环（带死循环检测与反思自愈）。
 * @returns 最终回答文本
 */
export async function runReAct(
  userText: string,
  opts: AgentLoopOptions = {}
): Promise<ReActResult> {
  const maxSteps = opts.maxSteps ?? REACT_MAX_STEPS
  const steps: AgentStep[] = []
  const toolCallSignatures: string[] = []

  // 初始用户输入作为第一轮 user 消息（可携带高模型产出的初步计划 + 多轮历史）
  const seed: LLMMessage[] = [
    { role: 'system', content: REACT_SYS() },
    ...(opts.context ?? []),
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
    const decRaw = await agentComplete(messages, { temperature: 0.1, maxTokens: 1400, json: true })
    const decision = extractJsonObj(await decRaw.promise)
    if (!decision) {
      // 自愈：JSON 解析失败时把错误回填给 LLM 重新决策，最多重试 1 次，避免白白耗尽步数
      parseFails++
      if (parseFails >= 2) {
        // 直接降级为自然对话问答
        try {
          const directChatPrompt: LLMMessage[] = [
            { role: 'system', content: '你是 Academic Lens 的高级学术智能体。请用专业、详尽、清晰的 Markdown 直接解答用户问题。' },
            ...(opts.context ?? []),
            { role: 'user', content: userText }
          ]
          const directRes = await agentComplete(directChatPrompt, { temperature: 0.3, maxTokens: 1600 }).promise
          answer = directRes.trim()
        } catch {
          answer = '智能体正在处理中，请稍后重试。'
        }
        break
      }
      messages = [
        ...messages,
        { role: 'user', content: '错误：你上一次的输出不是合法 JSON。请只输出 {"tool":"<工具id>","params":{...}} 或 {"done":true,"answer":"..."}，不要输出任何其他文字。' }
      ]
      continue
    }

    // 收尾判定
    if (isFinalAnswer(decision)) {
      answer = (decision.answer ?? '').trim()
      // 如果大模型输出了 done 但 answer 为空，绝不输出冷冰冰的 (已完成)，立即调用大模型生成完整学术解答
      if (!answer) {
        try {
          const directChatPrompt: LLMMessage[] = [
            { role: 'system', content: '你是 Academic Lens 的高级学术智能体。请结合以上上下文，用严谨、专业、清晰的 Markdown 详尽回答用户的问题或进行对比分析。' },
            ...messages
          ]
          const directRes = await agentComplete(directChatPrompt, { temperature: 0.3, maxTokens: 1600 }).promise
          answer = directRes.trim()
        } catch {
          answer = steps.slice(-1)[0]?.observation ?? '已为您完成处理。'
        }
      }
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
    const sig = `${toolId}:${JSON.stringify(params)}`

    // 死循环检测（Loop Detector）：若连续调用同一工具且参数相同，触发反思提示
    if (toolCallSignatures.filter((s) => s === sig).length >= 1) {
      if (toolCallSignatures.filter((s) => s === sig).length >= 2) {
        // 达到 2 次重复，强制终止工具调用，由智能体基于已有观察直接给出回答
        const lastObservation = steps.slice(-1)[0]?.observation || ''
        answer = lastObservation ? `已为您获取并处理结果：\n\n${lastObservation}` : '操作已完成。'
        steps.push({ kind: 'done' })
        break
      }
      messages = [
        ...messages,
        {
          role: 'user',
          content: `反思提示：你刚刚已经调用过工具「${tool.name}」并获得了结果，请勿重复调用！请根据已有结果直接向用户给出最终回答（输出 {"done":true,"answer":"..."}）。`
        }
      ]
      toolCallSignatures.push(sig)
      continue
    }
    toolCallSignatures.push(sig)

    // 二次确认挂起：破坏性工具先不执行，把决策交回调用方请求用户确认
    if (opts.onTool?.(toolId, params) === false) {
      return { answer: '', steps, blocked: { toolId, params } }
    }
    const result = await runTool(toolId, params)
    const step: AgentStep = { kind: 'tool', toolId, toolLabel: tool.name, sideEffect: tool.sideEffect, observation: result.text }
    steps.push(step)
    opts.onStep?.(step)
    // 回填观察：优先用结构化摘要（digest），支持 3000 字符长上下文
    const digest = result.digest ?? result.text
    const observation = `${tool.name} 执行结果：\n${digest.slice(0, 3000)}`
    messages = [...messages, { role: 'user', content: `工具「${tool.name}」执行完毕，结果如下：\n${observation}\n请根据该结果决定下一步：继续调用工具，或给出最终回答（done: true, answer: "..."）。` }]
  }

  if (!answer) {
    try {
      const directChatPrompt: LLMMessage[] = [
        { role: 'system', content: '你是 Academic Lens 的高级学术智能体。请结合工具返回结果，给出清晰完整的最终回答。' },
        ...messages
      ]
      const directRes = await agentComplete(directChatPrompt, { temperature: 0.3, maxTokens: 1600 }).promise
      answer = directRes.trim()
    } catch {
      const lastStep = steps.slice(-1)[0]
      answer = lastStep?.observation ? `已为您完成操作：\n\n${lastStep.observation}` : '达到了最大步骤数，已停止。'
    }
  }
  return { answer, steps }
}

/* ---------------- 确定性规则（仅限明确的前缀命令与极简单一指令） ---------------- */

/**
 * 确定性规则解析：
 * 委托给本地智能数据清洗与预处理管道（preprocessUserQuery）。
 * 仅对明确的斜杠命令或极简确定性单操作提供快速通道，把所有复杂意图决策权完整交由智能体大脑！
 */
export function resolveByRules(text: string): { tool: ToolId; params: Record<string, string> } | null {
  return preprocessUserQuery(text).quickAction ?? null
}