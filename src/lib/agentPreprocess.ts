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

/** 复合多步骤连接词（标志着需要 ReAct 多步调度与链式交付） */
const MULTI_STEP_PATTERNS = [
  /(?:先|首先).*?(?:然后|再|接着|最后)/i,
  /(?:不仅|不仅要|既要).*?(?:还要|而且|也要)/i,
  /(?:并且|而且|同时|并结合|并给出|并生成|并编写|并出题|并帮我|并为我)/i,
  /(?:搜索|查找|检索).*?(?:并|然后|接着).*?(?:复现|总结|出题|分析|写代码|评审|对比)/i
]

/** 纯学术问答/追问特征（标志着应由大模型直接结合上下文深度回答，不走工具硬匹配） */
const DIRECT_QA_PATTERNS = [
  /(?:这两篇|这几篇|两篇|文章|论文|文献).*?(?:区别|异同|不同|优劣|优缺点|对比|差距)/i,
  /(?:为什么|为何|怎么理解|如何理解|原理是|机制是|本质是|背后的原因)/i,
  /^(?:为什么|怎么|如何|能否|可以解释|什么是|解释一下|讲讲|聊聊)/i,
  /(?:优缺点|计算复杂度|瓶颈|局限性在哪里|好在哪里|核心思想是什么)/i
]

/**
 * 本地智能数据清洗与预处理管道
 * 职责：
 * 1. 清洗输入噪声与口语前缀，保留核心学术语义；
 * 2. 提取公式、词汇、句式等实体元数据；
 * 3. 智能判断意图：
 *    - 复合多步骤任务 ➔ 放行给 ReAct 多步规划；
 *    - 纯学术问答/探讨 ➔ 放行给大模型直接解答；
 *    - 明确单一学术/英语功能指令 ➔ 智能提取参数并快速秒级直达工具！
 */
export function preprocessUserQuery(rawText: string): CleanedQuery {
  const text = rawText.trim()
  if (!text) return { cleanedText: '' }

  const curDocName = useFileStore.getState().doc?.name || ''
  const isMultiStep = MULTI_STEP_PATTERNS.some((p) => p.test(text))
  const isDirectQA = DIRECT_QA_PATTERNS.some((p) => p.test(text))

  // 1. 提取公式实体
  let detectedLatex: string | undefined
  const latexMatch = text.match(/\$([^$]+)\$/) || text.match(/\\(?:frac|sum|int|mathbb|mathcal|sqrt|alpha|beta|gamma|sigma|lambda|nabla)\b[\s\S]*/)
  if (latexMatch) {
    detectedLatex = (latexMatch[1] || latexMatch[0]).trim()
  }

  // 2. 提取英语单词实体
  const pureWordMatch = text.match(/\b([A-Za-z][A-Za-z'-]{1,45})\b/g)

  // 3. 清洗前缀噪声（仅对非斜杠命令文本）
  let cleanedText = text
  if (!text.startsWith('/')) {
    for (const re of NOISE_PREFIXES) {
      cleanedText = cleanedText.replace(re, '').trim()
    }
  }

  // 4. 快速通道决策
  const quickAction = resolveQuickAction(text, cleanedText, isMultiStep, isDirectQA, detectedLatex)

  return {
    cleanedText: cleanedText || text,
    docContext: curDocName ? `当前正在研读的文献为：《${curDocName}》` : undefined,
    quickAction,
    detectedEntities: {
      words: pureWordMatch || undefined,
      latex: detectedLatex,
      isQuestion: isDirectQA,
      isMultiStep
    }
  }
}

/**
 * 智能快速通道（Smart Fast-Track）：
 * - 复合任务与纯问答坚决放行给大模型；
 * - 明确的单功能指令（无论是自然语言还是斜杠命令）精准提取参数直达工具！
 */
function resolveQuickAction(
  raw: string,
  cleaned: string,
  isMultiStep: boolean,
  isDirectQA: boolean,
  detectedLatex?: string
): { tool: ToolId; params: Record<string, string> } | null {
  // 1. 复合多任务或纯问答探讨，必须交由智能体大脑处理
  if (isMultiStep || isDirectQA) {
    return null
  }

  const t = raw.trim()
  const cl = cleaned.trim()

  // 2. 斜杠精确命令（支持携带后续参数）
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
    if (/^(?:百科|科普|通识|wiki|knowledge)/i.test(cmd)) return { tool: 'knowledge_query', params: { topic: cmd.replace(/^(?:百科|科普|通识|wiki|knowledge)\s*/i, '') } }
    if (/^(?:灵感|头脑风暴|brainstorm|idea)/i.test(cmd)) return { tool: 'creative_brainstorm', params: { theme: cmd.replace(/^(?:灵感|头脑风暴|brainstorm|idea)\s*/i, '') } }
    if (/^(?:日程|规划|计划|planner|schedule)/i.test(cmd)) return { tool: 'daily_planner', params: { time: cmd.replace(/^(?:日程|规划|计划|planner|schedule)\s*/i, '') } }
    if (/^(?:解压|笑话|学术梗|轶事|humor|quote)/i.test(cmd)) return { tool: 'scholar_humor_quote', params: { type: cmd.replace(/^(?:解压|笑话|学术梗|轶事|humor|quote)\s*/i, '') } }
    if (/^(?:文学|文学翻译|散文翻译|诗歌翻译|literary)/i.test(cmd)) return { tool: 'literary_translate', params: { text: cmd.replace(/^(?:文学|文学翻译|散文翻译|诗歌翻译|literary)\s*/i, '') } }
    if (/^(?:修辞|细读|文学赏析|closereading|rhetoric)/i.test(cmd)) return { tool: 'literary_rhetoric_analyze', params: { text: cmd.replace(/^(?:修辞|细读|文学赏析|closereading|rhetoric)\s*/i, '') } }
    if (/^(?:哲学|思辨|人文批判|书评|critique)/i.test(cmd)) return { tool: 'humanities_critique', params: { text: cmd.replace(/^(?:哲学|思辨|人文批判|书评|critique)\s*/i, '') } }
    if (/^(?:典故|名句|溯源|考据|allusion)/i.test(cmd)) return { tool: 'classic_allusion_lookup', params: { query: cmd.replace(/^(?:典故|名句|溯源|考据|allusion)\s*/i, '') } }
  }

  // 3. 自然语言学术与英语指令（高置信度智能提取）
  // 润色英文
  if (/^(?:润色|精修|改写|polish|学术润色)\s*[:：]?\s*([\s\S]+)/i.test(cl)) {
    const text = cl.replace(/^(?:润色|精修|改写|polish|学术润色)\s*[:：]?\s*/i, '').trim()
    if (text.length > 5) return { tool: 'polish_run', params: { text } }
  }

  // 长难句语法拆解
  if (/(?:长难句|语法拆解|拆解句子|解剖句子|主谓宾分析)\s*[:：]?\s*([\s\S]+)/i.test(cl)) {
    const sentence = cl.replace(/^.*?(?:长难句|语法拆解|拆解句子|解剖句子|主谓宾分析)\s*[:：]?\s*/i, '').trim()
    if (sentence.length > 5) return { tool: 'grammar_analyze', params: { sentence } }
  }

  // 英文近义词辨析（明确针对词汇）
  if (/(?:同义词辨析|近义词辨析|词汇辨析|辨析单词|区分单词)\s*[:：]?\s*(.+)/i.test(cl)) {
    const words = cl.replace(/^.*?(?:同义词辨析|近义词辨析|词汇辨析|辨析单词|区分单词)\s*[:：]?\s*/i, '').trim()
    if (words) return { tool: 'synonym_nuance', params: { words } }
  }

  // 雅思/托福作文批改
  if (/(?:雅思作文|托福作文|作文批改|作文打分|批改作文)\s*[:：]?\s*([\s\S]+)/i.test(cl)) {
    const essay = cl.replace(/^.*?(?:雅思作文|托福作文|作文批改|作文打分|批改作文)\s*[:：]?\s*/i, '').trim()
    if (essay.length > 20) return { tool: 'ielts_toefl_evaluate', params: { essay } }
  }

  // 曼彻斯特学术句型检索
  if (/(?:学术句型|曼彻斯特句型|句型库|phrasebank)\s*[:：]?\s*(.*)/i.test(cl)) {
    const query = cl.replace(/^.*?(?:学术句型|曼彻斯特句型|句型库|phrasebank)\s*[:：]?\s*/i, '').trim()
    return { tool: 'phrasebank_query', params: { query } }
  }

  // 公式解析与推导
  if (detectedLatex || /(?:讲解公式|推导公式|解释公式|分析公式)\s*[:：]?\s*(.+)/i.test(cl)) {
    const latex = detectedLatex || cl.replace(/^.*?(?:讲解公式|推导公式|解释公式|分析公式)\s*[:：]?\s*/i, '').trim()
    if (latex) return { tool: 'math_explain', params: { latex } }
  }

  // 顶刊同行评审
  if (/^(?:审稿|同行评审|peer\s*review|批判性评审|给这篇论文审稿|写一份审稿意见)$/i.test(cl)) {
    return { tool: 'paper_review', params: {} }
  }

  // 算法复现与 PyTorch 代码骨架
  if (/^(?:复现|代码骨架|算法复现|生成复现代码|pytorch代码|python实现|算法实现)$/i.test(cl)) {
    return { tool: 'code_generate', params: {} }
  }

  // 出题与随堂测验
  if (/(?:考考我|随堂测验|自测题|出\s*\d*\s*道.*题|出题|随堂练习)/i.test(cl)) {
    return { tool: 'quiz_generate', params: { context: cl } }
  }

  // 答卷批改
  if (/^(?:批改|判卷|打分|交卷|我的答案)|(?:第\s*[1-3一二三]\s*[题\.]|[1-3]\s*[\.\:：、]\s*[A-Da-d])/i.test(cl)) {
    return { tool: 'quiz_grade', params: { answers: cl } }
  }

  // 学术论文搜索 (单个搜索动作)
  if (/^(?:搜索|检索|查找|找).*?(?:论文|文献|arxiv|最新研究)\s*[:：]?\s*(.+)/i.test(cl)) {
    const query = cl.replace(/^(?:搜索|检索|查找|找).*?(?:论文|文献|arxiv|最新研究)\s*[:：]?\s*/i, '').trim()
    if (query) return { tool: 'academic_search', params: { query } }
  }

  // GitHub 开源仓库搜索
  if (/^(?:搜索|检索|查找|找).*?(?:github|开源代码|开源实现|仓库|repo)\s*[:：]?\s*(.+)/i.test(cl)) {
    const query = cl.replace(/^(?:搜索|检索|查找|找).*?(?:github|开源代码|开源实现|仓库|repo)\s*[:：]?\s*/i, '').trim()
    if (query) return { tool: 'github_search', params: { query } }
  }

  // HuggingFace 模型搜索
  if (/^(?:搜索|检索|查找|找).*?(?:huggingface|hf|开源模型|模型权重)\s*[:：]?\s*(.+)/i.test(cl)) {
    const query = cl.replace(/^(?:搜索|检索|查找|找).*?(?:huggingface|hf|开源模型|模型权重)\s*[:：]?\s*/i, '').trim()
    if (query) return { tool: 'huggingface_search', params: { query } }
  }

  // 学术项目制管理
  if (/(?:有哪些|看|查看|列出|显示).*?(?:学术项目|项目列表|研究项目)/i.test(cl)) return { tool: 'project_list', params: {} }
  if (/(?:新建|创建|建立|开个).*?(?:学术项目|项目)\s*[:：]?\s*(.*)/i.test(cl)) {
    const title = cl.replace(/^.*?(?:新建|创建|建立|开个).*?(?:学术项目|项目)\s*[:：]?\s*/i, '').trim()
    return { tool: 'project_create', params: { title } }
  }
  if (/(?:项目|全景|跨文献).*?(?:综述|对比总结|全景综述)/i.test(cl)) return { tool: 'project_summary', params: {} }
  if (/(?:生成|导出).*?(?:bibtex|apa|ieee|gbt7714|引用格式|论文引用)/i.test(cl)) return { tool: 'bibtex_lookup', params: { query: cl } }
  if (/^(?:总结文档|文档总结|核心摘要|研读全套包|全套学习包)$/i.test(cl)) return { tool: 'pipeline_study_pack', params: {} }
  if (/^(?:生成周报|学情周报|我的周报|周报)$/i.test(cl)) return { tool: 'report', params: {} }

  // 管家博学与日常对话类
  if (/^(?:通识百科|科普|百科|万物百科|什么是|解释一下概念)\s*[:：]?\s*(.+)/i.test(cl)) {
    const topic = cl.replace(/^(?:通识百科|科普|百科|万物百科|什么是|解释一下概念)\s*[:：]?\s*/i, '').trim()
    if (topic) return { tool: 'knowledge_query', params: { topic } }
  }
  if (/(?:头脑风暴|灵感激发|科研灵感|提供研究切入点|创新思路|激发灵感)\s*[:：]?\s*(.*)/i.test(cl)) {
    const theme = cl.replace(/^.*?(?:头脑风暴|灵感激发|科研灵感|提供研究切入点|创新思路|激发灵感)\s*[:：]?\s*/i, '').trim()
    return { tool: 'creative_brainstorm', params: { theme } }
  }
  if (/(?:日程规划|今日规划|学术时间表|学习计划|专注计划|帮我规划一下时间)\s*[:：]?\s*(.*)/i.test(cl)) {
    const time = cl.replace(/^.*?(?:日程规划|今日规划|学术时间表|学习计划|专注计划|帮我规划一下时间)\s*[:：]?\s*/i, '').trim()
    return { tool: 'daily_planner', params: { time } }
  }
  if (/(?:讲个笑话|学术梗|科学家趣事|学者轶事|科研太累了|放松一下|解压|治愈寄语|好累啊)/i.test(cl)) {
    return { tool: 'scholar_humor_quote', params: { type: cl } }
  }

  // 人文社科与文学翻译类
  if (/(?:文学翻译|文学精翻|信达雅翻译|翻译成散文|诗歌翻译|小说翻译)\s*[:：?？]?\s*(.*)/i.test(cl)) {
    const text = cl.replace(/^.*?(?:文学翻译|文学精翻|信达雅翻译|翻译成散文|诗歌翻译|小说翻译)\s*[:：?？]?\s*/i, '').trim()
    return { tool: 'literary_translate', params: { text } }
  }
  if (/(?:文本细读|修辞分析|文学赏析|隐喻分析|象征手法|修辞艺术)\s*[:：?？]?\s*(.*)/i.test(cl)) {
    const text = cl.replace(/^.*?(?:文本细读|修辞分析|文学赏析|隐喻分析|象征手法|修辞艺术)\s*[:：?？]?\s*/i, '').trim()
    return { tool: 'literary_rhetoric_analyze', params: { text } }
  }
  if (/(?:哲学思辨|人文批判|思想谱系|批判性书评|哲学辨析)\s*[:：?？]?\s*(.*)/i.test(cl)) {
    const text = cl.replace(/^.*?(?:哲学思辨|人文批判|思想谱系|批判性书评|哲学辨析)\s*[:：?？]?\s*/i, '').trim()
    return { tool: 'humanities_critique', params: { text } }
  }
  if (/(?:典故溯源|考据典故|考据一下典故|名句出处|神话隐喻|追溯典故|考据)\s*[:：?？]?\s*(.*)/i.test(cl)) {
    const query = cl.replace(/^.*?(?:典故溯源|考据典故|考据一下典故|名句出处|神话隐喻|追溯典故|考据)\s*[:：?？]?\s*/i, '').trim()
    if (query) return { tool: 'classic_allusion_lookup', params: { query } }
  }

  // 4. 英语学习基础动作（单词查询、分级、闪卡、生词本、导航）
  if (/^查(?:询|单词|词)?\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i.test(cl)) {
    const m = cl.match(/^查(?:询|单词|词)?\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i)
    if (m) return { tool: 'word_lookup', params: { word: m[1] } }
  }
  if (/^([a-zA-Z][a-zA-Z'-]{1,45})\s*(?:是什么意思|怎么读|怎么发音|的含义|的意思)$/i.test(cl)) {
    const m = cl.match(/^([a-zA-Z][a-zA-Z'-]{1,45})/i)
    if (m) return { tool: 'word_lookup', params: { word: m[1] } }
  }
  if (/^分级\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i.test(cl)) {
    const m = cl.match(/^分级\s*[:：]?\s*([a-zA-Z][a-zA-Z'-]{1,45})$/i)
    if (m) return { tool: 'grade_word', params: { word: m[1] } }
  }
  if (/^把\s*([a-zA-Z][a-zA-Z'-]{1,45})\s*(?:加入|存入|存进|记到)生词本$/i.test(cl)) {
    const m = cl.match(/^把\s*([a-zA-Z][a-zA-Z'-]{1,45})/i)
    if (m) return { tool: 'wordbook_add', params: { word: m[1] } }
  }
  if (/^(?:打开|跳转到?|进入)(生词本|闪卡|设置|周报)$/i.test(cl)) {
    const m = cl.match(/^(?:打开|跳转到?|进入)(生词本|闪卡|设置|周报)$/i)
    if (m) return { tool: 'navigate', params: { view: m[1] === '生词本' ? 'wordbook' : m[1] === '闪卡' ? 'flashcard' : m[1] === '设置' ? 'settings' : 'stats' } }
  }
  if (/^抽\s*(\d{1,2})\s*张?闪卡$/i.test(cl)) {
    const m = cl.match(/^抽\s*(\d{1,2})/i)
    if (m) return { tool: 'flashcard_draw', params: { count: m[1] } }
  }
  if (/^(?:生词本概览|掌握情况|复习情况|生词盘点)$/i.test(cl)) return { tool: 'wordbook_summary', params: {} }

  return null
}

