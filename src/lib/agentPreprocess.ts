import { useFileStore } from '../stores/fileStore'
import type { ToolId } from './agentTools'

export interface CleanedQuery {
  /** 清洗后的原始文本 */
  cleanedText: string
  /** 关联的上下文文献信息 */
  docContext?: string
  /** 是否建议走快速通道 */
  quickAction?: { tool: ToolId; params: Record<string, string> } | null
  /** 提取出的潜在学术/英语实体 */
  detectedEntities?: {
    words?: string[]
    latex?: string
    isQuestion?: boolean
    isMultiStep?: boolean
  }
}

/** 常见口语化无意义前缀 */
const NOISE_PREFIXES = [
  /^(?:请问|请帮我|帮我|麻烦帮我|麻烦你|能不能帮我|我想让你|我想请教|请|帮一下|一下|查一查|搜一搜|看一看)+[:：\s]*/i,
  /^(?:我想知道|你能告诉我|请给我|给我|生成一个|来一个)+[:：\s]*/i
]

/** 疑问与分析连词（标志着需要智能体深度思考与问答） */
const QUESTION_PATTERNS = /(?:什么|为什么|怎么|如何|哪|区别|对比|分析一下|评析|是否|吗|？|\?|优缺点|异同|原理|机制)/i
const MULTI_STEP_PATTERNS = /(?:先.*?然后|不仅.*?而且|并且|同时|并为|并帮|并生成|并出题|并编写|步骤)/i

/**
 * 本地智能数据清洗与预处理管道
 * 职责：
 * 1. 清洗输入噪声与口语前缀，但不破坏核心学术语义；
 * 2. 检测当前上下文指代（如“这篇文献”、“当前项目”）；
 * 3. 提取公式、词汇、句式等实体元数据；
 * 4. 仅对极高置信度的极简单指令提供快速通道，把所有复杂意图决策权完整交给智能体大脑！
 */
export function preprocessUserQuery(rawText: string): CleanedQuery {
  const text = rawText.trim()
  if (!text) return { cleanedText: '' }

  const curDocName = useFileStore.getState().doc?.name || ''
  const isQuestion = QUESTION_PATTERNS.test(text)
  const isMultiStep = MULTI_STEP_PATTERNS.test(text)

  // 1. 提取公式实体
  let detectedLatex: string | undefined
  const latexMatch = text.match(/\$([^$]+)\$/) || text.match(/\\(?:frac|sum|int|mathbb|mathcal|sqrt|alpha|beta)\b[\s\S]*/)
  if (latexMatch) {
    detectedLatex = (latexMatch[1] || latexMatch[0]).trim()
  }

  // 2. 提取英语单词实体
  const pureWordMatch = text.match(/\b([A-Za-z][A-Za-z'-]{1,45})\b/g)

  // 3. 清洗前缀噪声（仅对非命令文本）
  let cleanedText = text
  if (!text.startsWith('/')) {
    for (const re of NOISE_PREFIXES) {
      cleanedText = cleanedText.replace(re, '').trim()
    }
  }

  // 4. 快速通道决策：仅限明确斜杠命令或极简确定性单动词
  const quickAction = resolveQuickAction(text, cleanedText)

  return {
    cleanedText: cleanedText || text,
    docContext: curDocName ? `当前正在研读的文献为：《${curDocName}》` : undefined,
    quickAction,
    detectedEntities: {
      words: pureWordMatch || undefined,
      latex: detectedLatex,
      isQuestion,
      isMultiStep
    }
  }
}

/**
 * 快速通道（Fast Track）：
 * 仅对极高置信度的单一命令做直达处理，避免浪费一次 LLM 往返；
 * 任何包含疑问、多步骤、学术讨论、长文本的，一律返回 null 交由智能体！
 */
function resolveQuickAction(raw: string, cleaned: string): { tool: ToolId; params: Record<string, string> } | null {
  const t = raw.trim()
  const cl = cleaned.trim()

  // 1. 凡是问句、长句或多意图，坚决交给智能体大脑
  if (t.length > 25 || QUESTION_PATTERNS.test(t) || MULTI_STEP_PATTERNS.test(t)) {
    return null
  }

  // 2. 斜杠精确命令
  if (t.startsWith('/')) {
    const cmd = t.slice(1).trim()
    if (/^(?:出题|测验|自测|quiz)/i.test(cmd)) return { tool: 'quiz_generate', params: { context: cmd.replace(/^(?:出题|测验|自测|quiz)\s*/i, '') } }
    if (/^(?:批改|判卷|grade)/i.test(cmd)) return { tool: 'quiz_grade', params: { answers: cmd.replace(/^(?:批改|判卷|grade)\s*/i, '') } }
    if (/^(?:审稿|评审|review)/i.test(cmd)) return { tool: 'paper_review', params: {} }
    if (/^(?:复现|代码|code)/i.test(cmd)) return { tool: 'code_generate', params: {} }
    if (/^(?:句型|phrasebank)/i.test(cmd)) return { tool: 'phrasebank_query', params: { query: cmd.replace(/^(?:句型|phrasebank)\s*/i, '') } }
    if (/^(?:长难句|语法|grammar)/i.test(cmd)) return { tool: 'grammar_analyze', params: { sentence: cmd.replace(/^(?:长难句|语法|grammar)\s*/i, '') } }
    if (/^(?:辨析|同义词|synonym)/i.test(cmd)) return { tool: 'synonym_nuance', params: { words: cmd.replace(/^(?:辨析|同义词|synonym)\s*/i, '') } }
    if (/^(?:雅思|托福|作文|ielts|toefl)/i.test(cmd)) return { tool: 'ielts_toefl_evaluate', params: { essay: cmd.replace(/^(?:雅思|托福|作文|ielts|toefl)\s*/i, '') } }
    if (/^(?:搜索|论文|arxiv)/i.test(cmd)) return { tool: 'academic_search', params: { query: cmd.replace(/^(?:搜索|论文|arxiv)\s*/i, '') } }
    if (/^(?:github|repo)/i.test(cmd)) return { tool: 'github_search', params: { query: cmd.replace(/^(?:github|repo)\s*/i, '') } }
    if (/^(?:hf|huggingface|模型)/i.test(cmd)) return { tool: 'huggingface_search', params: { query: cmd.replace(/^(?:hf|huggingface|模型)\s*/i, '') } }
    if (/^(?:bibtex|引用)/i.test(cmd)) return { tool: 'bibtex_lookup', params: { query: cmd.replace(/^(?:bibtex|引用)\s*/i, '') } }
    if (/^(?:总结|摘要|summary)/i.test(cmd)) return { tool: 'doc_summarize', params: {} }
    if (/^(?:研读全套包|全套|studypack)/i.test(cmd)) return { tool: 'pipeline_study_pack', params: {} }
    if (/^(?:润色|polish)/i.test(cmd)) return { tool: 'polish_run', params: { text: cmd.replace(/^(?:润色|polish)\s*/i, '') } }
    if (/^(?:周报|report)/i.test(cmd)) return { tool: 'report', params: {} }
  }

  // 3. 极简单一短语（查词、抽卡、导航、周报）
  const singleActions: { re: RegExp; fn: (m: RegExpMatchArray) => { tool: ToolId; params: Record<string, string> } | null }[] = [
    { re: /^查(?:询|单词|词)?\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i, fn: (m) => ({ tool: 'word_lookup', params: { word: m[1] } }) },
    { re: /^([a-zA-Z][a-zA-Z'-]{1,45})\s*(?:是什么意思|怎么读|怎么发音)$/i, fn: (m) => ({ tool: 'word_lookup', params: { word: m[1] } }) },
    { re: /^分级\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i, fn: (m) => ({ tool: 'grade_word', params: { word: m[1] } }) },
    { re: /^把\s*([a-zA-Z][a-zA-Z'-]{1,45})\s*(?:加入|存入|存进|记到)生词本$/i, fn: (m) => ({ tool: 'wordbook_add', params: { word: m[1] } }) },
    { re: /^(?:打开|跳转到?|进入)(生词本|闪卡|设置|周报)$/i, fn: (m) => ({ tool: 'navigate', params: { view: m[1] === '生词本' ? 'wordbook' : m[1] === '闪卡' ? 'flashcard' : m[1] === '设置' ? 'settings' : 'stats' } }) },
    { re: /^抽\s*(\d{1,2})\s*张?闪卡$/i, fn: (m) => ({ tool: 'flashcard_draw', params: { count: m[1] } }) },
    { re: /^(?:生成)?周报$/i, fn: () => ({ tool: 'report', params: {} }) },
    { re: /^研读全套包$/i, fn: () => ({ tool: 'pipeline_study_pack', params: {} }) }
  ]

  for (const item of singleActions) {
    const m = cl.match(item.re) || t.match(item.re)
    if (m) {
      const res = item.fn(m)
      if (res) return res
    }
  }

  return null
}
