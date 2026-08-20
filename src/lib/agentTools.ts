import { agentComplete } from './llm'
import { useAppStore } from '../stores/appStore'
import { useFileStore, getFileContextForChat } from '../stores/fileStore'
import { useWordbookStore, type WordEntry } from '../stores/wordbookStore'
import { useReviewLogStore } from '../stores/reviewLogStore'
import { useReportStore } from '../stores/reportStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useProfileStore, profileContext } from '../stores/profileStore'
import { useNoticeStore } from '../stores/noticeStore'
import { useHistoryStore } from '../stores/historyStore'
import { masteryLevel, isDue } from './srs'
import { aiGradeWords } from './flashcard'
import { aiOrganize } from './organize'
import { dictLookup } from './dictLookup'
import { formatUapisCard } from './wordCard'
import { analyzeUnknownWords } from './unknownWords'
import { buildPlainTextHeader } from './exportText'
import { buildBilingualPdfHtml } from './exportPdf'
import { levelLabel } from './levels'

/* =====================================================================
 * 内置智能体 Harness（扩展版）
 * 设计：
 *   - 工具分 6 类：学习 / 项目 / 审查核实 / 个性化 / 设置 / 端侧操作
 *   - 工具白名单（具名、有边界、默认只读，sideEffect 标副作用）
 *   - 决策边界：参数有上限；导航/触发类操作有明确副作用标记
 *   - 确定性意图映射优先，模糊交 GLM-4-flash 解析
 * ===================================================================== */

export type ToolCategory =
  | '学习'
  | '项目'
  | '审查核实'
  | '个性化'
  | '设置'
  | '端侧操作'

export type ToolId =
  // 学习类
  | 'word_lookup'
  | 'grade_word'
  | 'organize_words'
  | 'flashcard_draw'
  // 项目工具类
  | 'doc_context'
  | 'doc_summarize'
  | 'doc_unknown'
  | 'doc_export'
  // 审查核实类
  | 'report'
  | 'fact_check'
  | 'history_search'
  // 个性化类
  | 'set_goal'
  | 'get_profile'
  // 设置类
  | 'navigate'
  | 'set_lookup_source'
  | 'wordbook_add'
  | 'wordbook_summary'
  | 'wordbook_due'
  | 'wordbook_list'
  // 端侧操作类
  | 'speak'
  | 'open_external'
  // 学习增强（远程新增能力）
  | 'quiz_generate'
  | 'quiz_grade'
  | 'pipeline_study_pack'
  | 'math_explain'
  | 'polish_run'
  // 联网搜索与学术 RAG
  | 'academic_search'
  | 'github_search'
  | 'huggingface_search'
  | 'bibtex_lookup'
  // 学术项目制管理
  | 'project_list'
  | 'project_create'
  | 'project_add_doc'
  | 'project_summary'
  // 顶刊审稿与算法复现
  | 'paper_review'
  | 'code_generate'
  // 英语高阶能力（句型库、长难句、同义词、雅思托福）
  | 'phrasebank_query'
  | 'grammar_analyze'
  | 'synonym_nuance'
  | 'ielts_toefl_evaluate'

export interface AgentTool {
  id: ToolId
  category: ToolCategory
  name: string
  desc: string
  sideEffect: boolean
  /** 参数约束上限（决策边界） */
  maxParam?: number
}

export const TOOLS: AgentTool[] = [
  // 学习类
  { id: 'word_lookup', category: '学习', name: '查词', desc: '用词典或 AI 查询一个英文单词的释义、音标、例句与发音', sideEffect: false, maxParam: 60 },
  { id: 'grade_word', category: '学习', name: '单词分级', desc: '为一个或几个单词标注难度档位（CEFR / 四六级 / 雅思 / 托福 / 专四专八）', sideEffect: false, maxParam: 240 },
  { id: 'organize_words', category: '学习', name: '整理生词', desc: '对生词本做智能整理（近反义 / 专业日常 / 词根词缀 / 主题）', sideEffect: false, maxParam: 30 },
  { id: 'flashcard_draw', category: '学习', name: '抽闪卡', desc: '从生词本抽取一组闪卡用于复习', sideEffect: true, maxParam: 10 },
  { id: 'quiz_generate', category: '学习', name: '随堂测验', desc: '基于当前文档或摘要生成 3 道随堂自测题并就地展示，支持逐题作答批改', sideEffect: false, maxParam: 400 },
  { id: 'quiz_grade', category: '学习', name: '答卷批改', desc: '智能批改学生的随堂自测答卷，给出得分、详细解析与薄弱术语建议', sideEffect: false, maxParam: 1000 },
  { id: 'pipeline_study_pack', category: '学习', name: '研读全套包', desc: '多智能体协作：文献研读专家提取摘要 + 词汇专家分级术语 + 导师命制测验题', sideEffect: false, maxParam: 200 },
  { id: 'academic_search', category: '学习', name: '学术搜索', desc: '联网搜索 arXiv 论文、学术期刊与研究进展，返回论文标题、作者、摘要与 PDF 链接', sideEffect: false, maxParam: 120 },
  { id: 'github_search', category: '学习', name: 'GitHub搜索', desc: '搜索学术论文对应的开源代码实现、GitHub 仓库与 Star 数', sideEffect: false, maxParam: 120 },
  { id: 'huggingface_search', category: '学习', name: 'HuggingFace搜索', desc: '检索 HuggingFace 开源大模型、预训练权重与模型卡片', sideEffect: false, maxParam: 120 },
  { id: 'bibtex_lookup', category: '学习', name: 'BibTeX与引用', desc: '生成论文的标准 BibTeX、APA、IEEE、GB/T 7714 引用格式', sideEffect: false, maxParam: 200 },
  { id: 'paper_review', category: '学习', name: '审稿人评审', desc: '以 Senior Area Chair 视角进行创新性、严谨度、局限性批判评审与打分', sideEffect: false, maxParam: 300 },
  { id: 'code_generate', category: '学习', name: '算法代码骨架', desc: '提取论文核心算法流程，生成 PyTorch/Python 模块化实现代码骨架与复现指南', sideEffect: false, maxParam: 300 },
  { id: 'phrasebank_query', category: '学习', name: '学术句型库', desc: '检索曼彻斯特学术写作句型库（引言、方法、结果、讨论、局限性）', sideEffect: false, maxParam: 120 },
  { id: 'grammar_analyze', category: '学习', name: '长难句语法拆解', desc: '深度解剖学术长难句主谓宾骨架、修饰从句嵌套与地道顺畅翻译', sideEffect: false, maxParam: 600 },
  { id: 'synonym_nuance', category: '学习', name: '同义词学术辨析', desc: '辨析相近学术词汇的语感微细差异、顶刊高频搭配与误用警示', sideEffect: false, maxParam: 120 },
  { id: 'ielts_toefl_evaluate', category: '学习', name: '雅思托福批改', desc: '按 TR/CC/LR/GRA 官方四维度批改英文学术作文并给出考官范文', sideEffect: false, maxParam: 2500 },
  { id: 'math_explain', category: '学习', name: '公式讲解', desc: '拆解论文中的数学公式：大白话、直觉、符号表、推导步骤', sideEffect: false, maxParam: 240 },
  { id: 'polish_run', category: '学习', name: '学术润色', desc: '润色一段英文学术文本（严格/精炼/委婉三种语气），返回润色后全文与修改要点', sideEffect: false, maxParam: 2000 },
  // 项目工具类
  { id: 'project_list', category: '项目', name: '学术项目列表', desc: '列出当前所有学术项目、预设主题及各自下属文献列表', sideEffect: false },
  { id: 'project_create', category: '项目', name: '新建学术项目', desc: '按指定名称与研究预设主题新建学术项目', sideEffect: true, maxParam: 300 },
  { id: 'project_add_doc', category: '项目', name: '文献归档入项目', desc: '将当前阅读或指定文献加入特定学术项目', sideEffect: true, maxParam: 300 },
  { id: 'project_summary', category: '项目', name: '项目全景综述', desc: '跨文献学术综述：综合当前项目下所有文献生成研究全景与关联对比', sideEffect: false, maxParam: 300 },
  { id: 'doc_context', category: '项目', name: '文档上下文', desc: '返回当前是否打开文档及内容概况（分段数、开头若干段）', sideEffect: false },
  { id: 'doc_summarize', category: '项目', name: '文档摘要', desc: '生成并返回当前文档的核心摘要、大纲结构与关键术语', sideEffect: false, maxParam: 200 },
  { id: 'doc_unknown', category: '项目', name: '文档生词命中', desc: '统计当前文档的生词命中率，指出陌生词', sideEffect: false },
  { id: 'doc_export', category: '项目', name: '导出译文', desc: '把当前文档的译文导出保存为文件', sideEffect: true },
  // 审查核实类
  { id: 'report', category: '审查核实', name: '学情周报', desc: '生成基于近期学习数据的学情周报', sideEffect: true },
  { id: 'fact_check', category: '审查核实', name: '可信度核查', desc: '核查一段陈述或翻译的可信度，标注不确定之处与建议核实来源', sideEffect: false, maxParam: 800 },
  { id: 'history_search', category: '审查核实', name: '历史检索', desc: '按关键词检索历史中的文档摘要与文档译文，返回匹配内容供参考', sideEffect: false, maxParam: 80 },
  // 个性化类
  { id: 'set_goal', category: '个性化', name: '设置学习目标', desc: '记录学习目标 / 水平 / 偏好，后续对话会参考', sideEffect: true, maxParam: 120 },
  { id: 'get_profile', category: '个性化', name: '查看档案', desc: '返回当前保存的学习目标与偏好档案', sideEffect: false },
  // 设置类
  { id: 'navigate', category: '设置', name: '跳转页面', desc: '跳转到主界面的一个功能页', sideEffect: true },
  { id: 'set_lookup_source', category: '设置', name: '切换查词方式', desc: '切换查词双轨：dict（词典优先）或 llm（仅 AI）', sideEffect: true, maxParam: 10 },
  { id: 'wordbook_add', category: '设置', name: '添加生词', desc: '向生词本添加一个单词（附释义与语境）', sideEffect: true, maxParam: 400 },
  { id: 'wordbook_summary', category: '设置', name: '生词本概览', desc: '生词本统计：总词数、掌握度分布、今日到期、近7天复习与正确率', sideEffect: false },
  { id: 'wordbook_due', category: '设置', name: '到期词查询', desc: '返回今日到期需复习的单词列表', sideEffect: false, maxParam: 100 },
  { id: 'wordbook_list', category: '设置', name: '生词本列表', desc: '返回生词本内若干单词及其释义，便于核对与避免重复添加', sideEffect: false, maxParam: 300 },
  // 端侧操作类
  { id: 'speak', category: '端侧操作', name: '朗读', desc: '朗读一段文本（用于单词发音）', sideEffect: false, maxParam: 200 },
  { id: 'open_external', category: '端侧操作', name: '打开链接', desc: '在浏览器中打开一个合法链接（http/https）', sideEffect: true, maxParam: 300 }
]

/** 允许访问的页面视图白名单 */
const NAV_VIEWS = ['home', 'wordbook', 'flashcard', 'quotes', 'stats', 'history', 'settings', 'polish'] as const

/**
 * 破坏性工具：执行前需用户二次确认（Human-in-the-Loop）。
 * 只覆盖真正"改动数据 / 改设置 / 写文件 / 打开外部"的操作；
 * 只读 / 轻量跳转 / 触发生成类不加确认，避免打断流畅体验。
 */
export const CONFIRM_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'wordbook_add',
  'set_lookup_source',
  'set_goal',
  'doc_export',
  'open_external'
])

export interface ToolCall {
  tool: AgentTool
  params: Record<string, string>
}

export interface ResolveResult {
  toolCall: ToolCall | null
  raw?: string
}

/* ---------------- 决策边界检查 ---------------- */

function withinBounds(tool: AgentTool, params: Record<string, string>): boolean {
  if (tool.maxParam === undefined) return true
  const anyParam = Object.values(params).join(' ').trim()
  return anyParam.length <= tool.maxParam
}

/* ---------------- 工具执行 ---------------- */

export interface ToolOutput {
  text: string
  /** 供智能体决策用的结构化摘要（给用户看的完整文本在 text）；缺省时观察端退化为截断 text */
  digest?: string
  data?: unknown
  /** 是否异步发起并在稍后通过 sink 回填（此时返回文本为空） */
  asyncStarted?: boolean
}

const httpRe = /^https?:\/\/([\w-]+\.)+[\w-]+([\/?#]\S*)?$/i

export function executeTool(id: ToolId, params: Record<string, string>): ToolOutput {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) return { text: `未知工具：${id}` }
  if (!withinBounds(tool, params)) {
    return { text: `操作被拒绝：参数超出决策边界上限（${tool.maxParam}）` }
  }

  switch (id) {
    /* ---------- 学习类 ---------- */
    case 'word_lookup': {
      const word = (params.word ?? '').trim()
      if (!/^[A-Za-z][A-Za-z'-]{1,45}$/.test(word)) {
        return { text: `「${word}」不是合法的单个英文单词，无法查询。` }
      }
      // 双轨：dict 模式有 dict key 优先真实词典，否则明确提示后回退 AI
      const st = useSettingsStore.getState().settings
      const dictMode = st.lookupSource === 'dict'
      if (dictMode && !st.dictApiKey) {
        // 用户期望用词典，但未配置 Key：明示原因再走 AI，避免"说是词典却是 AI"的误导
        useNoticeStore.getState().push({
          level: 'ai',
          title: '查词提示',
          message: '查词方式为「词典优先」，但你尚未配置 uapis 词典 Key，本次已改用 AI 查词。',
          duration: 5000
        })
      }
      if (dictMode && st.dictApiKey) {
        void dictLookup(word, st.dictApiKey).then((res) => {
          if (!res) {
            useAgentStorePush(word) // 服务失败，回退 AI
            return
          }
          if (res.notFound) {
            pushToolReply(word, `「${word}」未收录于词典（可能拼写有误），建议只用 AI 重新查一次。`)
            return
          }
          pushToolReply(word, formatUapisCard(res))
        })
        return { text: '', asyncStarted: true }
      }
      // AI 兜底：交给对话层处理（返回占位，由外部调起一次 LLM 查词）
      useAgentStorePush(word)
      return { text: '', asyncStarted: true }
    }

    case 'grade_word': {
      const raw = (params.word ?? '').trim()
      const words = raw.split(/[\s,，;；、]+/).filter((w) => /^[A-Za-z][A-Za-z'-]{1,45}$/.test(w)).slice(0, 12)
      if (!words.length) return { text: '请提供要分级的英文单词。' }
      void aiGradeWords(words).then((res) => {
        const lines = res.length
          ? res.map((r) => `${r.word} → ${levelLabel(r.level)}`).join('\n')
          : '未能识别这些单词。'
        pushToolReply(words.join('、'), lines)
      })
      return { text: '', asyncStarted: true }
    }

    case 'organize_words': {
      const mode = (params.mode ?? 'synonym') as 'synonym' | 'academic' | 'affix' | 'theme'
      const words = useWordbookStore.getState().words
      if (!words.length) return { text: '生词本是空的，先收藏一些单词再整理。' }
      void aiOrganize(words, mode).then((res) => {
        if (res.error) {
          pushToolReply(mode, `整理失败：${res.error}`)
          return
        }
        const summary = res.clusters.length
          ? res.clusters.map((c) => `· ${c.name}（${c.words.length} 词）：${c.words.map((w) => w.word).join('、')}`).slice(0, 12).join('\n')
          : '未能生成分组。'
        pushToolReply(mode, `已按「${mode}」整理生词本，共 ${res.clusters.length} 组：\n${summary}`)
      })
      return { text: '', asyncStarted: true }
    }

    case 'flashcard_draw': {
      const count = Math.max(1, Math.min(20, Number(params.count) || 10))
      useAppStore.getState().go('flashcard')
      return { text: `已为你抽 ${count} 张闪卡，请到「闪卡」页查看。` }
    }

    case 'quiz_grade': {
      const ans = (params.answers ?? params.text ?? '').trim()
      return { text: `收到答卷：${ans}，正在由学术导师为您批改…`, asyncStarted: true }
    }

    case 'pipeline_study_pack': {
      return { text: '正在调动文献研读专家、词汇专家与自测导师为您生成研读全套包…', asyncStarted: true }
    }

    /* ---------- 项目工具类 ---------- */
    case 'doc_context': {
      const { segments, doc } = useFileStore.getState()
      if (!doc || !segments.length) return { text: '当前没有打开任何文档。' }
      const preview = segments.slice(0, 3).map((s) => s.text.slice(0, 80)).join(' / ')
      return { text: `当前文档「${doc.name}」，共 ${segments.length} 段。开头：${preview}…` }
    }

    case 'doc_summarize': {
      const { segments, summary } = useFileStore.getState()
      if (!segments.length) return { text: '当前没有打开任何文档，无法生成摘要。请先在阅读页打开或拖入文档。' }
      if (summary && summary.trim().length > 30) {
        return { text: `【当前文档摘要】\n${summary}` }
      }
      useFileStore.getState().summarize()
      return { text: '已基于当前文档内容开始分析并生成摘要。' }
    }

    case 'doc_unknown': {
      const { segments } = useFileStore.getState()
      if (!segments.length) return { text: '当前没有打开文档。' }
      const r = analyzeUnknownWords(segments)
      if (!r.unknownWords.length) return { text: `文档生词命中率 ${r.hitRate}%：所有词你都认识或已收藏，很棒！` }
      const top = r.unknownWords.slice(0, 15).join('、')
      return { text: `文档生词命中率 ${r.hitRate}%，陌生词 ${r.totalUnknown} 个。示例：${top}${r.unknownWords.length > 15 ? '…' : ''}` }
    }

    case 'doc_export': {
      const { segments, doc } = useFileStore.getState()
      if (!doc || !segments.length) return { text: '当前没有文档可导出。' }
      const format = params.format?.toLowerCase() === 'pdf' ? 'pdf' : 'md'
      if (format === 'pdf') {
        // 双语对照 PDF：生成 A4 打印页并触发系统打印/另存 PDF
        const html = buildBilingualPdfHtml(doc, segments)
        void window.bridge.saveFile({ defaultPath: doc.name.replace(/\.[^.]+$/, '') + '-双语对照.pdf', data: html }).then((p) => {
          pushToolReply('export', p ? `已导出双语 PDF 到 ${p}` : '已取消导出')
        })
        return { text: '', asyncStarted: true }
      }
      const text = buildPlainTextHeader(doc, segments)
      void window.bridge.saveFile({ defaultPath: doc.name.replace(/\.[^.]+$/, '') + '-译文.md', data: text }).then((p) => {
      pushToolReply('export', p ? `已导出到 ${p}` : '已取消导出')
    })
    return { text: '', asyncStarted: true }
    }

    /* ---------- 审查核实类 ---------- */
    case 'report': {
      useReportStore.getState().generate()
      return { text: '已触发学情周报生成，请到「学习统计」页查看周报。' }
    }

    case 'fact_check': {
      const text = (params.text ?? '').trim()
      if (!text) return { text: '请提供要核查的内容。' }
      // 交给对话层做一次带核验要求的回复（via embed, 见 agentStore）
      return { text: '已收到核查请求，将尽量区分事实与推断，并对不确定处给出建议核实来源。' }
    }

    case 'history_search': {
      const keyword = (params.keyword ?? params.text ?? '').trim()
      if (!keyword) return { text: '请在历史检索中提供关键词（如文档名）。' }
      void useHistoryStore.getState().searchRecords(keyword).then((res) => pushToolReply(keyword, res))
      return { text: '', asyncStarted: true }
    }

    /* ---------- 个性化类 ---------- */
    case 'set_goal': {
      const goal = (params.goal ?? params.text ?? '').trim()
      const st = useProfileStore.getState()
      const next = st.profile.goal ? `${st.profile.goal}；${goal}` : goal
      useProfileStore.getState().updateProfile({ goal: next })
      return { text: `已记录学习目标：${next}。后续我会据此调整建议。` }
    }

    case 'get_profile': {
      return { text: profileOr('暂无档案，可让我「设置学习目标」') }
    }

    /* ---------- 设置类 ---------- */
    case 'navigate': {
      const v = params.view?.toLowerCase() ?? ''
      if (!(NAV_VIEWS as readonly string[]).includes(v)) {
        return { text: `无法跳转到未知页面：${v || '（空）'}。可选：${NAV_VIEWS.join('、')}` }
      }
      useAppStore.getState().go(v as (typeof NAV_VIEWS)[number])
      return { text: `已跳转到「${v}」页` }
    }

    case 'set_lookup_source': {
      const v = params.source ?? params.value ?? 'dict'
      const next = v === 'llm' ? 'llm' : 'dict'
      const dictKey = useSettingsStore.getState().settings.dictApiKey
      useSettingsStore.getState().update({ lookupSource: next })
      if (next === 'llm') {
        return { text: '已把查词方式切换为「仅 AI」。' }
      }
      // dict：是否真的能走词典，取决于是否配置了 Key
      return {
        text: dictKey
          ? '已把查词方式切换为「词典优先（uapis）」，后续英文单词将用真实词典查询。'
          : '已把查词方式切换为「词典优先（uapis）」，但你尚未配置 uapis 词典 Key，本次仍需回退 AI 查词。'
      }
    }

    case 'wordbook_add': {
      const word = params.word?.trim()
      if (!word) return { text: '需要提供要添加的单词。' }
      const st = useWordbookStore.getState()
      if (st.words.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
        return { text: `「${word}」已在生词本中。` }
      }
      st.add({ word, definition: params.definition?.trim() ?? '', context: params.context?.trim(), pos: params.pos?.trim() })
      return { text: `已将「${word}」加入生词本。` }
    }

    case 'wordbook_summary': {
      const wb = useWordbookStore.getState().words
      const records = useReviewLogStore.getState().records
      const now = Date.now()
      const week = records.filter((r) => r.at >= now - 7 * 86400000)
      const correct = week.filter((r) => r.correct).length
      const due = wb.filter((w) => isDue(w.srs)).length
      const counts = { new: 0, learning: 0, young: 0, mature: 0 }
      for (const w of wb) counts[masteryLevel(w.srs)]++
      return {
        text:
          `生词本概览：共 ${wb.length} 词；` +
          `新词 ${counts.new}、学习中 ${counts.learning}、较熟 ${counts.young}、已掌握 ${counts.mature}；` +
          `今日到期 ${due} 词；近 7 天复习 ${week.length} 次（正确率 ${week.length ? Math.round((correct / week.length) * 100) : 0}%）。`
      }
    }

    case 'wordbook_due': {
      const wb = useWordbookStore.getState().words
      const due = wb
        .filter((w) => isDue(w.srs))
        .slice(0, tool.maxParam ?? 20)
        .map((w) => w.word)
      return { text: due.length ? `今日到期 ${due.length} 词：${due.join('、')}` : '当前没有到期单词，可以休息或学新词。' }
    }

    case 'wordbook_list': {
      const wb = useWordbookStore.getState().words
      if (!wb.length) return { text: '生词本是空的。' }
      const limit = Math.max(1, Math.min(50, Number((params as Record<string, string>).limit) || 10))
      const lines = wb.slice(0, limit).map((w) => `${w.word}${w.pos ? `（${w.pos}）` : ''}${w.definition ? `：${w.definition}` : ''}`)
      return { text: `生词本共 ${wb.length} 词，前 ${lines.length}：\n` + lines.join('\n') }
    }

    /* ---------- 端侧操作类 ---------- */
    case 'speak': {
      const text = params.text?.trim()
      if (!text) return { text: '需要提供要朗读的文本。' }
      window.bridge.speak(text)
      return { text: `正在朗读：「${text.slice(0, 30)}${text.length > 30 ? '…' : ''}」` }
    }

    case 'open_external': {
      const url = (params.url ?? '').trim()
      if (!httpRe.test(url)) return { text: `无法打开非 http(s) 链接：${url || '（空）'}` }
      void window.bridge.openExternal(url)
      return { text: `已在浏览器打开 ${url}` }
    }

    default:
      return { text: `暂不支持的工具：${id}` }
  }
}

/** 个性化档案文案 */
function profileOr(empty: string): string {
  const p = useProfileStore.getState().profile
  const parts: string[] = []
  if (p.goal) parts.push(`目标：${p.goal}`)
  if (p.level) parts.push(`水平：${p.level}`)
  if (p.style) parts.push(`偏好：${p.style}`)
  if (p.focus) parts.push(`想加强：${p.focus}`)
  return parts.length ? parts.join('；') : empty
}

/* ---------------- 确定性意图映射 ---------------- */

type Rule = { re: RegExp; rule: (m: RegExpMatchArray, text: string) => ToolCall[] }

const RULE_MAP: Rule[] = [
  // 导航
  { re: /(跳转|打开|去|进入).*(生词本)/i, rule: () => [call('navigate', { view: 'wordbook' })] },
  { re: /(跳转|打开|去|进入).*(闪卡|抽词)/i, rule: () => [call('navigate', { view: 'flashcard' })] },
  { re: /(跳转|打开|去|进入).*(美言|名言)/i, rule: () => [call('navigate', { view: 'quotes' })] },
  { re: /(跳转|打开|去|进入|看).*(统计|数据|周报)/i, rule: () => [call('navigate', { view: 'stats' })] },
  { re: /(跳转|打开|去|进入).*(设置)/i, rule: () => [call('navigate', { view: 'settings' })] },
  // 生词本
  { re: /多少词|有几个词|生词.*概览|掌握情况|复习情况|盘点/i, rule: () => [call('wordbook_summary')] },
  { re: /到期|该复习|要复习/i, rule: () => [call('wordbook_due')] },
  { re: /加入生词本|收藏.*词|记一下.*词(?!本)/i, rule: (_m, text) => [call('wordbook_add', { word: firstEnglishWord(text) })] },
  // 查词（学习）
  { re: /\b([a-z][a-z'-]{1,45})\b 什么意思|什么意思.*\b([a-z][a-z']{1,45})\b|\b([a-z][a-z'-]{1,45})\b 怎么翻译/i, rule: (m) => [call('word_lookup', { word: m[1] || m[2] || m[3] })] },
  { re: /查词?[:：]?\s*([a-z][a-z'-]{1,45})$/i, rule: (m) => [call('word_lookup', { word: m[1] })] },
  // 分级
  { re: /(分级|难度).*(cet|四级|六级|专四|专八|雅思|托福|cefr)/i, rule: () => [call('grade_word')] },
  { re: /整理.*生词|生词.*整理/i, rule: (_m, t) => [call('organize_words', { mode: themeOf(t) || 'synonym' })] },
  // 顶刊审稿人评审与算法复现
  { re: /(?:审稿|评审|同行评审|peer review|批判性评估|创新性评估|局限性分析)/i, rule: () => [call('paper_review')] },
  { re: /(?:复现|代码骨架|算法实现|pytorch代码|python实现)/i, rule: () => [call('code_generate')] },
  // HuggingFace 检索与 BibTeX 引用
  { re: /(?:huggingface|hf|模型权重|开源权重)/i, rule: (_m, t) => [call('huggingface_search', { query: t.replace(/^(请|帮我|在|用|搜|查|找|搜索|检索|huggingface|hf|模型|权重|一下|关于|相关的|内容)+/i, '').trim() })] },
  { re: /(?:bibtex|引用格式|apa|gbt7714|ieee引用|生成引用)/i, rule: () => [call('bibtex_lookup')] },
  // 英语高阶：学术句型库、长难句、同义词、雅思托福
  { re: /(?:句型|学术句型|phrasebank|写作模板|引言句型|方法句型)/i, rule: (_m, t) => [call('phrasebank_query', { query: t.replace(/^(请|帮我|查|找|搜索|句型|phrasebank|学术句型|一下)+/i, '').trim() })] },
  { re: /(?:长难句|语法拆解|解剖句子|主谓宾|从句分析)/i, rule: (_m, t) => [call('grammar_analyze', { sentence: t.replace(/^(请|帮我|拆解|分析|解剖|长难句|语法|句子)+[:：\s]*/i, '').trim() })] },
  { re: /(?:同义词|词汇辨析|辨析|区别|语感差异|collocation)/i, rule: (_m, t) => [call('synonym_nuance', { words: t.replace(/^(请|帮我|辨析|分析|区别|同义词)+[:：\s]*/i, '').trim() })] },
  { re: /(?:雅思|托福|作文批改|大作文|小作文|task\s*1|task\s*2|写作打分)/i, rule: (_m, t) => [call('ielts_toefl_evaluate', { essay: t })] },
  // 联网 GitHub 仓库与开源实现检索（优先于论文规则，避免“搜索论文的 GitHub 开源实现”被论文拦截）
  { re: /(?:github|开源代码|开源实现|代码仓库|repo)/i, rule: (_m, t) => [call('github_search', { query: t.replace(/^(请|帮我|在|用|搜|查|找|搜索|检索|github|代码|仓库|开源|实现|一下|关于|相关的|内容)+/i, '').trim() })] },
  // 联网学术搜索与 arXiv 论文检索
  { re: /(?:搜索|查找|检索|找).*?(?:论文|文献|arxiv|最新研究|顶刊)/i, rule: (_m, t) => [call('academic_search', { query: t.replace(/^(请|帮我|在|用|搜|查|找|搜索|检索|论文|文献|arxiv|一下|关于|相关的|内容)+/i, '').trim() })] },
  // 学术项目制管理
  { re: /(?:有哪些|看|查看|列出|显示).*?(?:学术项目|项目列表|研究项目)/i, rule: () => [call('project_list')] },
  { re: /(?:新建|创建|建立|开个).*?(?:学术项目|项目)/i, rule: (_m, t) => [call('project_create', { title: t.replace(/^(请|帮我|新建|创建|建立|学术项目|项目|名称|为|叫|主题)+/i, '').trim() })] },
  { re: /(?:归档|加入|存入|放到).*?(?:项目)/i, rule: (_m, t) => [call('project_add_doc', { project: t })] },
  { re: /(?:项目|全景|跨文献).*?(?:综述|对比|总结|汇总)/i, rule: () => [call('project_summary')] },
  // 多智能体协作流水线：研读全套包
  { re: /(?:研读|学习|阅读).*(?:全套包|全套|大礼包|套餐)|(?:一键|生成|来个|做个).*(?:研读|精读|全面分析|学习包)/i, rule: () => [call('pipeline_study_pack')] },
  // 出题与测验批改（导师专精）—— 优先于文档总结
  { re: /(?:批改|判卷|打分|交卷|我的答案|答卷)|(?:第\s*[1-3一二三]\s*[题\.]|[1-3]\s*[\.\:：、]\s*[A-Da-d])/i, rule: (_m, t) => [call('quiz_grade', { answers: t })] },
  { re: /(?:基于|根据|针对)?.*?(?:考考我|随堂测验|自测题|出\s*\d*\s*道.*题|出题|测验|自测|理解题|练习题)/i, rule: (_m, t) => [call('quiz_generate', { context: t })] },
  // 文档
  { re: /当前.*文档|这个文档|看.*文档上下文/i, rule: () => [call('doc_context')] },
  { re: /^(?!.*(出题|测验|做题|考考我|考题|练习|批改|全套|搜索|github|项目|理解题)).*(总结.*文档|文档.*总结|摘要.*文档|文档.*摘要|概括.*文档|总结这篇|总结一下)/i, rule: () => [call('doc_summarize')] },
  { re: /(命中率|生词.*占比|陌生词)/i, rule: () => [call('doc_unknown')] },
  { re: /导出.*(译文|翻译|文档)/i, rule: () => [call('doc_export')] },
  // 周报 / 核查
  { re: /(生成|来|写).*周报|周报/i, rule: () => [call('report')] },
  { re: /核查|可信度|靠谱吗|对吗|核实/i, rule: () => [call('fact_check')] },
  // 个性化
  { re: /(?:我的目标|学习目标).*(?:是|要|想|记|设为)[:：]?\s*(.*)/i, rule: (m) => [call('set_goal', { goal: m[1] ?? '' })] },
  { re: /(我的.*(?:档案|目标)|查看.*目标|我的目标是什么)/i, rule: () => [call('get_profile')] },
  // 查词方式
  { re: /(词典优先|用词典|uapis)/i, rule: () => [call('set_lookup_source', { source: 'dict' })] },
  { re: /(只用|仅用|全部用).*ai.*查词|切换.*ai/i, rule: () => [call('set_lookup_source', { source: 'llm' })] },
  // 端侧
  { re: /(朗读|发音|读一下|念一下).*([a-z]+)/i, rule: (m) => [call('speak', { text: m[2] })] },
  { re: /打开.*(链接|网址|网站)/i, rule: () => [call('open_external')] }
]

function themeOf(t: string): string | undefined {
  if (/专业|学术|日常/.test(t)) return 'academic'
  if (/词根|词缀|构词/.test(t)) return 'affix'
  if (/主题|场景/.test(t)) return 'theme'
  return undefined
}

function call(tool: ToolId, params: Record<string, string> = {}): ToolCall {
  return { tool: TOOLS.find((t) => t.id === tool)!, params }
}

/** 从文本中提取第一个英文字母单词（≥2 字母） */
function firstEnglishWord(text: string): string {
  const m = text.match(/[A-Za-z][A-Za-z'-]{1,}/)
  return m ? m[0] : ''
}

/**
 * 确定性意图解析：规则 → GLM JSON 兜底。
 */
export async function resolveIntent(text: string): Promise<ResolveResult> {
  const trimmed = text.trim()
  for (const rule of RULE_MAP) {
    const m = trimmed.match(rule.re)
    if (m) {
      const calls = rule.rule(m, trimmed)
      if (calls.length) {
        const tc = calls[0]
        if (withinBounds(tc.tool, tc.params)) return { toolCall: tc }
      }
    }
  }
  return resolveViaLLM(trimmed)
}

interface IntentJSON {
  tool?: string
  params?: Record<string, string>
  reply?: string
}

async function resolveViaLLM(text: string): Promise<ResolveResult> {
  const toolList = TOOLS.map((t) => `${t.id}（${t.category}/${t.name}）：${t.desc}`).join('\n')
  const sys =
    '你是 Academic Lens 的意图路由器。把用户的一句话判断是否可交给内置工具执行。\n' +
    `可用工具：\n${toolList}\n` +
    '规则要点：\n' +
    '1. 动作优先：用户要求出题、测验、做题、练习时（无论是否包含“基于摘要”、“根据文档”等状语），必须选择 quiz_generate；\n' +
    '2. 用户要求总结、概括、提炼文档时，选择 doc_summarize；\n' +
    '3. 查单个英文单词用 word_lookup；翻译长句属于重型任务不路由工具，返回 {"tool":null}；\n' +
    '4. 若请求超出工具范围，返回 {"tool":null}。\n' +
    '必须严格输出 JSON：{"tool":"<工具id|null>","params":{"<参数名>":"<值>"}}，不要输出其他内容。'
  const call = agentComplete(
    [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ],
    { temperature: 0, maxTokens: 512, json: true }
  )
  try {
    const raw = await call.promise
    const m = raw.trim().match(/\{[\s\S]*\}/)
    if (!m) return { toolCall: null }
    const obj = JSON.parse(m[0]) as IntentJSON
    if (!obj.tool) return { toolCall: null, raw }
    const tool = TOOLS.find((t) => t.id === obj.tool)
    if (!tool) return { toolCall: null, raw }
    const params = obj.params ?? {}
    if (!withinBounds(tool, params)) return { toolCall: null, raw }
    return { toolCall: { tool, params } }
  } catch {
    return { toolCall: null }
  }
}

/* ---------------- 异步工具结果回填（避免循环依赖 store） ---------------- */

/**
 * 当工具是异步 LLM（查词 AI 兜底）时，直接把原文推进对话交给 GLM 组织回复。
 * 该函数在 agentStore 中注入，见 setAsyncReplySink。
 */
let asyncReplySink: ((topic: string, reply: string) => void) | null = null
export function setAsyncReplySink(fn: ((topic: string, reply: string) => void) | null): void {
  asyncReplySink = fn
}

function pushToolReply(topic: string, reply: string): void {
  asyncReplySink?.(topic, reply)
  useNoticeStore.getState().push({ level: 'ai', title: '工具结果', message: reply.slice(0, 200), duration: 5000 })
}

/** 需要异步 LLM 回填的查词：由 agentStore 注入实现 */
let asyncLookup: ((word: string) => void) | null = null
export function setAsyncLookup(fn: ((word: string) => void) | null): void {
  asyncLookup = fn
}
function useAgentStorePush(word: string): void {
  asyncLookup?.(word)
}

/* ---------------- 智能体系统提示与上下文 ---------------- */

export const AGENT_SYS =
  '你是 Academic Lens 的全能学术与英语学习超级智能体（Omni-Controller）。' +
  '你具备学术与英语学习双核大语言模型能力，熟练掌握学术论文检索（arXiv）、GitHub 论文开源实现检索、项目制学术文献管理、文档全生命周期掌控、生词本与闪卡记忆系统。\n\n' +
  '【核心行为准则】\n' +
  '1. 全能掌控与零跳转闭环（In-situ & Zero-leaving）：\n' +
  '   - 用户无需打开或跳转「来做学术」和「来学英语」板块，即可在当前对话中完成所有功能；\n' +
  '   - 所有分析结果、论文检索列表、文档摘要、自测题目、答卷批改、公式推导、项目综述直接在当前对话气泡中完整交付，严禁说「请去某页面查看」！\n' +
  '2. 交互式引导与项目归档：\n' +
  '   - 用户上传或提及文献时，主动提供核心摘要、术语分级、出题自测或研读全套包等选项；\n' +
  '   - 原地完成处理后，才贴心询问用户是否需要将文献归档至「来做学术」的某个项目中；\n' +
  '3. 联网搜索与学术 RAG：\n' +
  '   - 支持通过 academic_search 检索 arXiv 最新学术论文；\n' +
  '   - 支持通过 github_search 检索论文的官方/开源代码实现；\n' +
  '4. 学术项目制研读：\n' +
  '   - 理解用户学术项目的主题（Topic），支持跨文献全景综述（project_summary）、项目文献管理与对比研读；\n' +
  '5. 诚实严谨，富有学术洞见：区分学术事实与推断，术语与公式讲解深入浅出。'

export function buildAgentContext(): string {
  const c = getFileContextForChat()
  return c ? `\n\n（当前工作区信息：${c.slice(0, 400)}）` : ''
}

export function wordbookContext(): string {
  const words: WordEntry[] = useWordbookStore.getState().words
  if (!words.length) return ''
  return `生词本共 ${words.length} 词，示例：${words.slice(0, 10).map((w) => w.word).join('、')}。`
}

/** 组装完整上下文：文档 + 生词本 + 个性化档案 */
export function agentContextBlock(): string {
  return `${wordbookContext()}${buildAgentContext()}${profileContext()}`
}

export function toolCatalogueInfo(): string {
  return TOOLS.map((t) => `${t.name}${t.sideEffect ? '·' : ''}`).join('、')
}