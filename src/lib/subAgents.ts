import type { ToolId } from './agentTools'
import { agentComplete } from './llm'
import { useFileStore } from '../stores/fileStore'
import { aiGradeWords } from './flashcard'
import { generateQuiz } from './quiz'

/* =====================================================================
 * 学术多智能体与 Sub-Agent 体系（Multi-Agent Architecture）
 *
 * 理论基础：
 *   - Anthropic: Building Effective Agents (Orchestrator-Workers 架构)
 *   - AutoGen / MetaGPT 多专家分工与隔离沙箱
 *   - Tool Pipelining: 打通工具间数据流，实现研读->词汇->自测->批改闭环
 * ===================================================================== */

export type SubAgentId =
  | 'research_reader'     // 文献研读专家
  | 'peer_reviewer'       // 顶刊审稿顾问
  | 'code_engineer'       // 算法复现工程师
  | 'lexicon_master'       // 词汇与记忆大师
  | 'grammar_analyst'     // 语法与长难句精析师
  | 'writing_coach'       // 学术写作教练
  | 'academic_tutor'      // 学术自测导师
  | 'academic_navigator'  // 联网学术检索官

export interface SubAgentMeta {
  id: SubAgentId
  name: string
  title: string
  avatarBadge: string
  desc: string
  tools: ToolId[]
  color: string
}

export const SUB_AGENTS: Record<SubAgentId, SubAgentMeta> = {
  research_reader: {
    id: 'research_reader',
    name: '文献研读专家',
    title: 'Research Reader',
    avatarBadge: '研读',
    desc: '深度剖析论文核心贡献、逻辑大纲、创新点与关键术语',
    tools: ['doc_context', 'doc_summarize', 'doc_unknown', 'doc_export', 'history_search', 'project_summary'],
    color: '#3b82f6'
  },
  peer_reviewer: {
    id: 'peer_reviewer',
    name: '顶刊审稿顾问',
    title: 'Peer Reviewer',
    avatarBadge: '审稿',
    desc: '以 Senior Area Chair 视角进行创新性、严谨度、局限性批判评审与打分',
    tools: ['paper_review', 'fact_check'],
    color: '#e11d48'
  },
  code_engineer: {
    id: 'code_engineer',
    name: '算法复现工程师',
    title: 'Code Engineer',
    avatarBadge: '复现',
    desc: '提取论文核心算法流程，生成 PyTorch/Python 模块化实现代码骨架',
    tools: ['code_generate', 'github_search', 'huggingface_search'],
    color: '#0284c7'
  },
  lexicon_master: {
    id: 'lexicon_master',
    name: '词汇与记忆大师',
    title: 'Lexicon Master',
    avatarBadge: '词汇',
    desc: '真实学术词典查词、CEFR 难度分级、构词法分析与 SRS 记忆排程',
    tools: ['word_lookup', 'grade_word', 'organize_words', 'wordbook_add', 'wordbook_due', 'wordbook_summary', 'wordbook_list', 'flashcard_draw', 'synonym_nuance'],
    color: '#10b981'
  },
  grammar_analyst: {
    id: 'grammar_analyst',
    name: '语法精析师',
    title: 'Grammar Analyst',
    avatarBadge: '语法',
    desc: '深度解剖学术长难句主谓宾骨架、修饰从句嵌套与地道顺畅翻译',
    tools: ['grammar_analyze', 'math_explain'],
    color: '#d97706'
  },
  writing_coach: {
    id: 'writing_coach',
    name: '学术写作教练',
    title: 'Writing Coach',
    avatarBadge: '写作',
    desc: '曼彻斯特学术句型库检索、IEEE/Nature 顶刊润色与雅思托福考官打分',
    tools: ['polish_run', 'phrasebank_query', 'ielts_toefl_evaluate', 'bibtex_lookup'],
    color: '#8b5cf6'
  },
  academic_tutor: {
    id: 'academic_tutor',
    name: '学术自测导师',
    title: 'Academic Tutor',
    avatarBadge: '导师',
    desc: '根据文献命制针对性理解题，逐题精准批改并解析考点',
    tools: ['quiz_generate', 'quiz_grade'],
    color: '#f59e0b'
  },
  academic_navigator: {
    id: 'academic_navigator',
    name: '学术检索官',
    title: 'Academic Navigator',
    avatarBadge: '检索',
    desc: '联网检索 arXiv 顶会论文、GitHub 论文开源实现与 HuggingFace 模型',
    tools: ['academic_search', 'github_search', 'huggingface_search', 'bibtex_lookup'],
    color: '#06b6d4'
  }
}

/** 智能意图分发：依据用户请求识别最适合的专精 Sub-Agent */
export function detectBestSubAgent(text: string): SubAgentMeta {
  const t = text.trim()
  if (/(审稿|评审|同行评审|peer review|局限性|创新性评估|打分|录取建议|批判)/i.test(t)) {
    return SUB_AGENTS.peer_reviewer
  }
  if (/(代码|复现|pytorch|实现|骨架|python|github|huggingface|模型权重)/i.test(t)) {
    return SUB_AGENTS.code_engineer
  }
  if (/(长难句|语法|从句|句子结构|主谓宾|拆解|解剖)/i.test(t)) {
    return SUB_AGENTS.grammar_analyst
  }
  if (/(句型|phrasebank|雅思|托福|大作文|小作文|润色|改写|精修|bibtex|引用)/i.test(t)) {
    return SUB_AGENTS.writing_coach
  }
  if (/(出题|测验|自测|做题|考考我|考题|批改|答卷|理解题|练习题|第[1-3一二三]\s*[题\.]|[1-3]\s*[\.\:：]\s*[A-D])/i.test(t)) {
    return SUB_AGENTS.academic_tutor
  }
  if (/(搜索|查找|检索|arxiv|论文|找论文|huggingface)/i.test(t)) {
    return SUB_AGENTS.academic_navigator
  }
  if (/(查词|什么意思|单词|生词|难度|分级|闪卡|复习|同义词|辨析)/i.test(t)) {
    return SUB_AGENTS.lexicon_master
  }
  return SUB_AGENTS.research_reader
}

/* =====================================================================
 * 跨智能体数据流水线（Multi-Agent Collaboration Pipelines）
 * ===================================================================== */

export interface StudyPackResult {
  summary: string
  gradedWords: { word: string; level: string; def?: string }[]
  quizMarkdown: string
  text: string
}

/**
 * 流水线 1：【学术研读全套包 (Pipeline: Study Pack)】
 * 协作流：文献研读专家提取摘要 -> 词汇专家标注学术术语 -> 导师命制测试题
 */
export async function runStudyPackPipeline(): Promise<StudyPackResult> {
  const { doc, segments } = useFileStore.getState()
  if (!doc || !segments.length) {
    const msg = '当前没有打开任何文献，无法生成研读全套包。请先在阅读器打开或拖入文献。'
    return { summary: '', gradedWords: [], quizMarkdown: '', text: msg }
  }

  // 1. 文献研读专家生成核心摘要
  const docText = segments.slice(0, 15).map((s) => s.text).join('\n')
  const summaryPrompt =
    `你是文献研读专家。请为文献《${doc.name}》生成一份精炼的学术摘要（含核心贡献、创新点、大纲架构）：\n\n${docText.slice(0, 2500)}`
  const summary = await agentComplete(
    [{ role: 'system', content: '你是文献研读专家。' }, { role: 'user', content: summaryPrompt }],
    { temperature: 0.2, maxTokens: 900 }
  ).promise

  // 2. 词汇专家提取生词并标注 CEFR 等级
  const rawWords = Array.from(new Set(docText.match(/[a-zA-Z]{5,}/g) || [])).slice(0, 6)
  const graded = rawWords.length ? await aiGradeWords(rawWords) : []

  // 3. 自测导师命制 3 道理解题
  const paper = await generateQuiz(doc.name, docText.slice(0, 1500), '请命制3道重点考察文献创新点与关键术语的理解题。')
  const quizMarkdown = paper.questions
    .map((q, i) => {
      const opts = q.options?.length ? '\n' + q.options.map((o) => `  ${o.key}. ${o.text}`).join('\n') : ''
      const kind = q.type === 'choice' ? '单选' : q.type === 'blank' ? '填空' : '简答'
      return `${i + 1}. [${kind}] ${q.title}${opts}`
    })
    .join('\n\n')

  // 4. 汇总为就地交付的大礼包
  const wordsFormatted = graded.length
    ? graded.map((w) => `  - **${w.word}** \`[${w.level || 'C1'}]\`${w.raw ? `：${w.raw}` : ''}`).join('\n')
    : '  - （未提取到冷僻词）'

  const fullText =
    `# 🎓 《${doc.name}》学术研读全套包\n\n` +
    `---\n\n` +
    `### 📖 一、核心贡献与论文大纲（文献研读专家）\n${summary.trim()}\n\n` +
    `---\n\n` +
    `### 📚 二、核心学术专业术语表（词汇记忆专家）\n${wordsFormatted}\n\n` +
    `---\n\n` +
    `### 🎯 三、随堂理解测验（学术自测导师）\n${quizMarkdown.trim()}\n\n` +
    `> 💡 **提示**：您可以直接在下方回复您的答案（例如 \`1. A  2. Dropout  3. 降低过拟合\`），自测导师将为您就地批改并解析！`

  return {
    summary,
    gradedWords: graded.map((g) => ({ word: g.word, level: g.level || 'C1', def: g.raw })),
    quizMarkdown,
    text: fullText
  }
}

/**
 * 流水线 2：【答卷精准批改与错词入库 (Pipeline: Quiz Grade & Wordbook Sink)】
 */
export async function runGradeQuizPipeline(userAnswers: string): Promise<{ text: string }> {
  const prompt =
    `你是严格且耐心的学术导师。学生提交了关于文献的随堂测验答卷：\n\n` +
    `【学生答卷】：\n${userAnswers}\n\n` +
    `请用清晰结构为学生批改：\n` +
    `1. 给出总分与每题对错判断（✅ / ❌）；\n` +
    `2. 针对错题给出详细解析与正确理解方式；\n` +
    `3. 总结学生在哪些学术概念或术语上理解薄弱，并给出针对性复习建议。`

  const res = await agentComplete(
    [{ role: 'system', content: '你是专业耐心的学术自测导师。' }, { role: 'user', content: prompt }],
    { temperature: 0.1, maxTokens: 1000 }
  ).promise

  return {
    text: `### 📝 随堂自测批改报告\n\n${res.trim()}\n\n💡 **后续建议**：您可以点击下方按钮将薄弱术语一键加入生词本，或要求重新出题。`
  }
}
