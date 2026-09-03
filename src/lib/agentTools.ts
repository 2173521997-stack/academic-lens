import { useWordbookStore } from '../stores/wordbookStore'
import { useFileStore } from '../stores/fileStore'
import { useSettingsStore, type DomainPreset, type ThemeMode } from '../stores/settingsStore'
import { useAppStore, type ViewName } from '../stores/appStore'
import { useHistoryStore } from '../stores/historyStore'
import { quickTranslate } from './quickTranslate'
import { analyzeUnknownWords } from './unknownWords'
import { buildBilingualMarkdown, buildDocxBase64 } from './exportText'
import { agentComplete } from './llm'
import { EXAM_VOCAB_DATA, appendExamWords, type ExamWordItem } from '../data/examVocab'
import type { LLMMessage } from '../bridge/types'
import { cleanTermList } from '../stores/wordbookStore'

export type ToolId =
  | 'navigate'
  | 'start_translation'
  | 'stop_translation'
  | 'quick_translate'
  | 'set_domain_preset'
  | 'wordbook_summary'
  | 'wordbook_list'
  | 'wordbook_add'
  | 'wordbook_remove'
  | 'wordbook_clear'
  | 'wordbook_query'
  | 'import_exam_words'
  | 'generate_exam_vocab'
  | 'export_wordbook'
  | 'doc_context'
  | 'doc_summarize'
  | 'doc_unknown'
  | 'doc_export'
  | 'doc_extract_terms'
  | 'history_list'
  | 'history_clear'
  | 'set_theme'
  | 'copy_to_clipboard'
  | 'speak'
  | 'open_external'

export interface ToolDef {
  id: ToolId
  name: string
  desc: string
  category: '导航' | '翻译控制' | '生词本' | '文档' | '系统'
  params: { name: string; desc: string; required?: boolean }[]
  sideEffect?: boolean
}

export interface ToolCall {
  tool: ToolDef
  params: Record<string, string>
}

export interface ToolResult {
  text: string
  sideEffectDone?: boolean
  notFound?: boolean
}

export interface ResolveResult {
  toolCall: ToolCall | null
  raw?: string
}

export const TOOLS: ToolDef[] = [
  {
    id: 'navigate',
    name: '页面跳转',
    desc: '在不同工作区（主页/文档、文本翻译、图片OCR、生词本、历史记录、设置）之间自由切换',
    category: '导航',
    params: [{ name: 'view', desc: '目标页面：home / text / image / wordbook / history / settings', required: true }]
  },
  {
    id: 'start_translation',
    name: '开始文档全文翻译',
    desc: '触发对当前已打开的文档进行批量翻译',
    category: '翻译控制',
    params: [],
    sideEffect: true
  },
  {
    id: 'stop_translation',
    name: '停止翻译',
    desc: '暂停或终止当前正在进行的文档翻译任务',
    category: '翻译控制',
    params: [],
    sideEffect: true
  },
  {
    id: 'quick_translate',
    name: '后台即时翻译',
    desc: '直接翻译用户指定的一段中英文学术文字、课件段落（严格保护公式和数据）',
    category: '翻译控制',
    params: [{ name: 'text', desc: '待翻译文本', required: true }]
  },
  {
    id: 'set_domain_preset',
    name: '切换翻译学术领域',
    desc: '设置翻译预设（general通用 / cs计算机算法 / bio生物医药 / academic学术论文 / news新闻）',
    category: '翻译控制',
    params: [{ name: 'domain', desc: '领域代码：general / cs / bio / academic / news', required: true }],
    sideEffect: true
  },
  {
    id: 'wordbook_summary',
    name: '生词本与考试词库概览',
    desc: '查看生词本总数、六级/考研/雅思/托福官方词库统计',
    category: '生词本',
    params: []
  },
  {
    id: 'wordbook_list',
    name: '生词本列表',
    desc: '列出最近加入生词本的单词及其释义与分级',
    category: '生词本',
    params: [{ name: 'limit', desc: '数量上限（默认 10，最多 30）' }]
  },
  {
    id: 'wordbook_add',
    name: '添加生词',
    desc: '把某个英文单词加入生词本（自动去重并解析音标、词性与释义）',
    category: '生词本',
    params: [{ name: 'word', desc: '英文单词', required: true }],
    sideEffect: true
  },
  {
    id: 'wordbook_remove',
    name: '删除生词',
    desc: '从生词本中移除指定单词',
    category: '生词本',
    params: [{ name: 'word', desc: '要删除的单词', required: true }],
    sideEffect: true
  },
  {
    id: 'wordbook_clear',
    name: '清空生词本',
    desc: '清空用户的全部生词本记录',
    category: '生词本',
    params: [],
    sideEffect: true
  },
  {
    id: 'wordbook_query',
    name: '检索词库',
    desc: '在用户生词本或六级/考研/雅思/托福考试词库中查询单词详情、考点与搭配',
    category: '生词本',
    params: [
      { name: 'query', desc: '待查单词或中文释义关键词', required: true },
      { name: 'scope', desc: '范围：saved(我的生词) / cet6 / kaoyan / ielts / toefl / all(默认全部)' }
    ]
  },
  {
    id: 'import_exam_words',
    name: '导入考试高频词',
    desc: '将六级/考研/雅思/托福词库中的指定单词批量导入到「我的生词本」',
    category: '生词本',
    params: [
      { name: 'category', desc: '考试类型：cet6 / kaoyan / ielts / toefl', required: true },
      { name: 'words', desc: '单词列表，用逗号分隔（为空则导入前 5 个未收录词）' }
    ],
    sideEffect: true
  },
  {
    id: 'export_wordbook',
    name: '导出生词表',
    desc: '将用户的生词本导出为 Markdown 表格或纯文本列表',
    category: '生词本',
    params: [{ name: 'format', desc: 'md / txt（默认 md）' }]
  },
  {
    id: 'doc_context',
    name: '当前文档信息',
    desc: '查看正在阅读的文档名、段落数、翻译进度及前几段内容',
    category: '文档',
    params: []
  },
  {
    id: 'doc_summarize',
    name: '文档核心摘要',
    desc: '对当前打开的文档生成核心摘要、大纲与核心关键词',
    category: '文档',
    params: []
  },
  {
    id: 'doc_unknown',
    name: '文档生词分布分析',
    desc: '分析当前文档中生词占比、陌生词分布与高频学术术语',
    category: '文档',
    params: []
  },
  {
    id: 'doc_export',
    name: '导出双语文档',
    desc: '导出双语对照文档为 Markdown 或 DOCX 文件',
    category: '文档',
    params: [{ name: 'format', desc: 'md / docx（默认 md）' }],
    sideEffect: true
  },
  {
    id: 'doc_extract_terms',
    name: '提取文档专业术语入库',
    desc: '扫描当前文档，自动提炼高频专业术语并一键批量收录至生词本',
    category: '文档',
    params: [{ name: 'limit', desc: '提取上限（默认 5 个）' }],
    sideEffect: true
  },
  {
    id: 'history_list',
    name: '查看翻译历史',
    desc: '列出最近的段落翻译或查词历史',
    category: '系统',
    params: [{ name: 'limit', desc: '数量（默认 5 条）' }]
  },
  {
    id: 'history_clear',
    name: '清空历史记录',
    desc: '清空软件内的全部翻译历史记录',
    category: '系统',
    params: [],
    sideEffect: true
  },
  {
    id: 'set_theme',
    name: '切换软件主题',
    desc: '切换 Academic Lens 的界面主题（light 浅色 / dark 深色 / system 跟随系统）',
    category: '系统',
    params: [{ name: 'theme', desc: 'light / dark / system', required: true }],
    sideEffect: true
  },
  {
    id: 'copy_to_clipboard',
    name: '写入剪贴板',
    desc: '将指定的文本直接复制到操作系统剪贴板',
    category: '系统',
    params: [{ name: 'text', desc: '待复制文本', required: true }],
    sideEffect: true
  },
  {
    id: 'speak',
    name: '语音朗读',
    desc: '调用系统 TTS 发音朗读英文单词或句子',
    category: '系统',
    params: [{ name: 'text', desc: '英文文本', required: true }]
  },
  {
    id: 'open_external',
    name: '打开外部网页',
    desc: '用默认浏览器打开学术网站或在线资源',
    category: '系统',
    params: [{ name: 'url', desc: '目标网址', required: true }]
  }
]

export function resolveUserIntent(text: string): ResolveResult {
  const t = text.trim()
  if (!t) return { toolCall: null }

  // 1. 页面跳转
  if (/打开生词本|去生词本|查看单词本|转到单词本/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'wordbook' } } }
  }
  if (/打开设置|偏好设置|去设置/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'settings' } } }
  }
  if (/打开文本翻译|文本工作台/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'text' } } }
  }
  if (/打开图片翻译|截图翻译|图片工作台/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'image' } } }
  }
  if (/打开主页|打开文档|文档工作台/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'home' } } }
  }
  if (/查看历史|历史记录/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'navigate')!, params: { view: 'history' } } }
  }

  // 2. 翻译任务控制
  if (/开始翻译|全文翻译|翻译文档|继续翻译/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'start_translation')!, params: {} } }
  }
  if (/停止翻译|暂停翻译/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'stop_translation')!, params: {} } }
  }

  // 3. 生词本快速添加
  const addMatch = t.match(/^(?:添加|收录|收藏|把|将)s*([A-Za-z][A-Za-z'-]{1,45})s*(?:加入|放到|存入|进)?(?:生词本|单词本)?$/i)
  if (addMatch) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'wordbook_add')!, params: { word: addMatch[1] } } }
  }

  // 4. 生词本导出
  if (/导出生词|导出生词本|生词本导出/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'export_wordbook')!, params: { format: 'md' } } }
  }

  // 5. 主题切换
  if (/切换(到)?深色|暗色主题|夜间模式/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'set_theme')!, params: { theme: 'dark' } } }
  }
  if (/切换(到)?浅色|白色主题|白天模式/i.test(t)) {
    return { toolCall: { tool: TOOLS.find((x) => x.id === 'set_theme')!, params: { theme: 'light' } } }
  }

  return { toolCall: null, raw: t }
}

export async function runTool(toolId: ToolId, params: Record<string, string>): Promise<ToolResult> {
  const wb = useWordbookStore.getState()
  const fs = useFileStore.getState()
  const app = useAppStore.getState()
  const settingsStore = useSettingsStore.getState()
  const historyStore = useHistoryStore.getState()

  switch (toolId) {
    case 'navigate': {
      const v = (params.view ?? 'home').toLowerCase()
      const map: Record<string, ViewName> = {
        home: 'home',
        translate: 'home',
        text: 'home',
        image: 'home',
        doc: 'home',
        wordbook: 'wordbook',
        settings: 'settings'
      }
      const target = map[v] ?? 'home'
      app.go(target)
      const labelMap: Record<ViewName, string> = {
        home: '翻译工作台',
        wordbook: '生词本与考试词库',
        settings: '设置'
      }
      return { text: `已为您切换至 **${labelMap[target]}** 页面。`, sideEffectDone: true }
    }

    case 'start_translation': {
      if (!fs.doc) return { text: '当前尚未打开文档，请先在主页打开 PDF/Word/TXT 文档。' }
      fs.translateAll()
      return { text: `已为文档 **${fs.doc.name}** 启动全文翻译。`, sideEffectDone: true }
    }

    case 'stop_translation': {
      fs.stopTranslate()
      return { text: '已暂停/停止当前文档的翻译任务。', sideEffectDone: true }
    }

    case 'quick_translate': {
      const text = (params.text ?? '').trim()
      if (!text) return { text: '请提供待翻译的文本。' }
      return new Promise<ToolResult>((resolve) => {
        quickTranslate(text, 'translate', {
          onChunk: () => {},
          onDone: (res) => resolve({ text: `【学术译文】\n${res}` }),
          onError: (err) => resolve({ text: `翻译失败：${err}` })
        })
      })
    }

    case 'set_domain_preset': {
      const d = (params.domain ?? 'general').toLowerCase() as DomainPreset
      settingsStore.update({ domain: d })
      return { text: `已将翻译学术领域切换为：**${d}**。`, sideEffectDone: true }
    }

    case 'wordbook_summary': {
      const totalSaved = wb.words.length
      const cet6Count = EXAM_VOCAB_DATA.cet6.length
      const kyCount = EXAM_VOCAB_DATA.kaoyan.length
      const ieltsCount = EXAM_VOCAB_DATA.ielts.length
      const toeflCount = EXAM_VOCAB_DATA.toefl.length

      return {
        text:
          `### 📖 单词本与考试词库总览\n\n` +
          `- **我的生词本**：已收录 ${totalSaved} 个个性化单词\n` +
          `- **六级必备核心库**：收录 ${cet6Count} 个大纲词\n` +
          `- **考研英语 5500 核心库**：收录 ${kyCount} 个高频考点词\n` +
          `- **雅思核心学术词库**：收录 ${ieltsCount} 个学术高频词\n` +
          `- **托福学科核心词库**：收录 ${toeflCount} 个学科专业词\n`
      }
    }

    case 'wordbook_list': {
      const limit = Math.min(Math.max(parseInt(params.limit || '10', 10), 1), 30)
      if (!wb.words.length) {
        return { text: '生词本当前为空。您可以在阅读时随时一键收藏，或让我帮您从考研/六级词库中导入。' }
      }
      const list = wb.words.slice(0, limit)
      const lines = list.map((w, idx) => {
        const p = w.phonetic ? ` [${w.phonetic}]` : ''
        const pos = w.pos ? ` ${w.pos}` : ''
        const def = w.definition ? `：${w.definition}` : ''
        return `${idx + 1}. **${w.word}**${p}${pos}${def}`
      })
      return {
        text: `### 📖 最近生词（前 ${list.length} 个）\n\n` + lines.join('\n')
      }
    }

    case 'wordbook_add': {
      const word = (params.word ?? '').trim()
      if (!word) return { text: '请指定要添加的英文单词。' }
      const res = await wb.addWithAutoLookup(word)
      if (res.success) {
        return { text: `已自动解析释义并成功将 **${word}** 添加到生词本。`, sideEffectDone: true }
      }
      return { text: `添加失败：${res.error ?? '未知错误'}` }
    }

    case 'wordbook_remove': {
      const word = (params.word ?? '').trim().toLowerCase()
      if (!word) return { text: '请指定要删除的单词。' }
      const target = wb.words.find((w) => w.word.toLowerCase() === word || w.id === word)
      if (!target) return { text: `在生词本中未找到单词 **${word}**。` }
      wb.remove(target.id)
      return { text: `已将 **${target.word}** 从生词本中移除。`, sideEffectDone: true }
    }

    case 'wordbook_clear': {
      const count = wb.words.length
      if (!count) return { text: '生词本当前已经是空的。' }
      for (const w of [...wb.words]) {
        wb.remove(w.id)
      }
      return { text: `已清空生词本中的全部 ${count} 个单词。`, sideEffectDone: true }
    }

    case 'wordbook_query': {
      const q = (params.query ?? '').trim().toLowerCase()
      if (!q) return { text: '请提供查询关键词。' }
      const scope = params.scope ?? 'all'

      const hits: string[] = []

      // 查生词本
      if (scope === 'all' || scope === 'saved') {
        for (const w of wb.words) {
          if (w.word.toLowerCase().includes(q) || (w.definition ?? '').toLowerCase().includes(q)) {
            hits.push(`[我的生词] **${w.word}** ${w.phonetic || ''} ${w.pos || ''}：${w.definition}`)
          }
        }
      }

      // 查四大考试词库
      const examCategories: (keyof typeof EXAM_VOCAB_DATA)[] = ['cet6', 'kaoyan', 'ielts', 'toefl']
      for (const cat of examCategories) {
        if (scope === 'all' || scope === cat) {
          for (const item of EXAM_VOCAB_DATA[cat]) {
            if (item.word.toLowerCase().includes(q) || item.def.toLowerCase().includes(q) || (item.polysemy ?? '').toLowerCase().includes(q)) {
              const poly = item.polysemy ? ` (考点: ${item.polysemy})` : ''
              hits.push(`[${item.examTagLabel}] **${item.word}** ${item.phonetic} ${item.pos}：${item.def}${poly}`)
            }
          }
        }
      }

      if (!hits.length) {
        return { text: `在选定词库中未找到与 **${q}** 相关的词条。您也可以直接让我查询并录入该词。` }
      }

      return {
        text: `### 🔍 词库检索结果（共 ${hits.length} 条）\n\n` + hits.slice(0, 10).map((s, i) => `${i + 1}. ${s}`).join('\n')
      }
    }

    case 'generate_exam_vocab': {
      const exam = (params.exam ?? 'kaoyan').toLowerCase() as 'cet6' | 'kaoyan' | 'ielts' | 'toefl'
      const count = Math.min(Math.max(parseInt(params.count || '5', 10), 1), 8)
      const topic = params.topic?.trim() || '高频核心考点词'
      const labelMap = {
        cet6: '六级核心',
        kaoyan: '考研高频',
        ielts: '雅思高频',
        toefl: '托福学科'
      }

      const prompt: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你是资深英语考试大纲与命题专家。根据用户指定的考试类别与要求，生成一批权威地道的考点词汇。\n' +
            '必须输出严格 JSON 格式：\n' +
            '{"words":[{"word":"英文单词","phonetic":"/音标/","pos":"词性","def":"核心中文释义","polysemy":"熟词生义或真题考点","collocation":"学术高频搭配","exEn":"真题学术英文例句","exZh":"例句中文翻译","synonyms":["同义词1","同义词2"],"antonyms":["反义词1"]}]}\n' +
            '严禁输出任何 Markdown 代码块包裹或前缀解释。'
        },
        {
          role: 'user',
          content: `请为【${labelMap[exam] || exam}】考试生成 ${count} 个符合【${topic}】的考纲核心词汇。词汇不要与常见基础词重复。`
        }
      ]

      try {
        const res = await agentComplete(prompt, { temperature: 0.3, maxTokens: 2048, json: true })
        const raw = await res.promise
        const m = raw.trim().match(/\{[\s\S]*\}/)
        if (!m) return { text: 'AI 词汇生成解析异常，请换个主题重试。' }
        const obj = JSON.parse(m[0]) as { words?: Array<any> }
        const generated = obj.words ?? []
        if (!generated.length) return { text: '未能解析出有效词汇。' }

        const items: ExamWordItem[] = generated.map((g, idx) => ({
          id: `gen_${exam}_${Date.now()}_${idx}`,
          word: (g.word ?? '').trim(),
          phonetic: g.phonetic || '',
          pos: g.pos || '',
          def: g.def || '',
          examTag: exam,
          examTagLabel: labelMap[exam],
          polysemy: g.polysemy || undefined,
          collocation: g.collocation || undefined,
          exEn: g.exEn || '',
          exZh: g.exZh || '',
          synonyms: cleanTermList(g.synonyms),
          antonyms: cleanTermList(g.antonyms)
        })).filter((x) => x.word.length > 0)

        appendExamWords(exam, items)

        const lines = items.map(
          (x, i) =>
            `${i + 1}. **${x.word}** ${x.phonetic} *${x.pos}*：${x.def}${x.polysemy ? ` *(考点: ${x.polysemy})*` : ''}`
        )

        return {
          text:
            `### ✨ 已为【${labelMap[exam]}】生成并入库 ${items.length} 个新词汇\n\n` +
            lines.join('\n') +
            `\n\n您现在可以在单词本的【${labelMap[exam]}】子界面中直接查看与背诵，或一键加入「我的生词」！`,
          sideEffectDone: true
        }
      } catch (err) {
        return { text: `AI 词汇生成失败：${err instanceof Error ? err.message : String(err)}` }
      }
    }

    case 'import_exam_words': {
      const cat = (params.category ?? 'kaoyan').toLowerCase() as keyof typeof EXAM_VOCAB_DATA
      const list = EXAM_VOCAB_DATA[cat] ?? EXAM_VOCAB_DATA.kaoyan
      let targetWords: typeof list = []

      if (params.words) {
        const wordArr = params.words.split(/[,，、\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
        targetWords = list.filter((item) => wordArr.includes(item.word.toLowerCase()))
      } else {
        // 取前 5 个未添加的
        targetWords = list.filter((item) => !wb.hasWord(item.word)).slice(0, 5)
      }

      if (!targetWords.length) {
        return { text: '选定的考试词汇均已在您的生词本中，无需重复导入。' }
      }

      for (const item of targetWords) {
        wb.importExamWord(item)
      }

      const names = targetWords.map((x) => x.word).join(', ')
      return {
        text: `已成功将 ${targetWords.length} 个考试高频词（${names}）导入到您的生词本！`,
        sideEffectDone: true
      }
    }

    case 'export_wordbook': {
      if (!wb.words.length) return { text: '生词本当前为空，暂无可导出的内容。' }
      const format = (params.format ?? 'md').toLowerCase()
      if (format === 'txt') {
        const txt = wb.words.map((w) => `${w.word}${w.phonetic ? ` [${w.phonetic}]` : ''} ${w.pos || ''} ${w.definition}`).join('\n')
        return { text: '```text\n' + txt + '\n```' }
      }
      const header = '| 单词 | 音标 | 词性 | 释义 | 考纲/标签 |\n| :--- | :--- | :--- | :--- | :--- |\n'
      const rows = wb.words.map((w) => `| ${w.word} | ${w.phonetic || '-'} | ${w.pos || '-'} | ${w.definition || '-'} | ${(w.tags ?? []).join(', ') || '-'} |`).join('\n')
      return { text: `### 📋 生词本导出（Markdown）\n\n${header}${rows}` }
    }

    case 'doc_context': {
      if (!fs.doc) return { text: '当前工作台未打开任何文档。' }
      const done = fs.segments.filter((s) => s.translation).length
      const preview = fs.segments.slice(0, 3).map((s, i) => `[段落 ${i + 1}] ${s.text.slice(0, 80)}...`).join('\n')
      return {
        text:
          `### 📄 当前文档状态\n\n` +
          `- **文件名**：${fs.doc.name}\n` +
          `- **总段落数**：${fs.segments.length}\n` +
          `- **翻译进度**：${done} / ${fs.segments.length} (${fs.segments.length ? Math.round((done / fs.segments.length) * 100) : 0}%)\n\n` +
          `**前文预览**：\n${preview}`
      }
    }

    case 'doc_summarize': {
      if (!fs.doc || !fs.segments.length) return { text: '当前未打开文档，无法生成摘要。' }
      const fullText = fs.segments.map((s) => s.text).join('\n').slice(0, 4000)
      const sys = '你是资深学术研究员。根据用户提供的学术论文/文档内容，生成专业大纲与核心摘要（包含背景、方法、关键发现与结论），中文输出。'
      const res = await agentComplete([{ role: 'system', content: sys }, { role: 'user', content: fullText }])
      const ans = await res.promise
      return { text: `### 📑 文档智能摘要\n\n${ans}` }
    }

    case 'doc_unknown': {
      if (!fs.segments.length) return { text: '当前未打开文档。' }
      const unk = analyzeUnknownWords(fs.segments)
      const topWords = unk.unknownWords.slice(0, 10).map((x) => `${x}`).join(', ')
      return {
        text:
          `### 🔍 文档词汇分析\n\n` +
          `- **陌生词总数**：${unk.totalUnknown} 个\n` +
          `- **生词命中率**：${unk.hitRate}%\n` +
          `- **未收录生词**：${topWords || '无显著陌生生词'}`
      }
    }

    case 'doc_export': {
      if (!fs.doc) return { text: '当前未打开文档，无法导出。' }
      const format = params.format === 'docx' ? 'docx' : 'md'
      const base = fs.doc.name.replace(/\.[^.]+$/, '')
      if (format === 'docx') {
        const b64 = await buildDocxBase64(fs.segments)
        await window.bridge.saveBuffer({ defaultPath: `${base}_bilingual.docx`, dataB64: b64, filters: [{ name: 'Word', extensions: ['docx'] }] })
        return { text: `已为您导出双语 Word 文档：**${base}_bilingual.docx**。`, sideEffectDone: true }
      }
      const md = buildBilingualMarkdown(fs.doc, fs.segments)
      await window.bridge.saveFile({ defaultPath: `${base}_bilingual.md`, data: md, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      return { text: `已为您导出双语 Markdown 文档：**${base}_bilingual.md**。`, sideEffectDone: true }
    }

    case 'doc_extract_terms': {
      if (!fs.segments.length) return { text: '当前未打开文档。' }
      const unk = analyzeUnknownWords(fs.segments)
      const candidates = unk.unknownWords.slice(0, parseInt(params.limit || '5', 10))
      if (!candidates.length) return { text: '文档中未检测到明显的未收录生词。' }
      const added: string[] = []
      for (const w of candidates) {
        const res = await wb.addWithAutoLookup(w)
        if (res.success) added.push(w)
      }
      return {
        text: `已从文档中提取并成功将以下 ${added.length} 个核心术语收录到生词本：**${added.join(', ')}**。`,
        sideEffectDone: true
      }
    }

    case 'history_list': {
      const limit = parseInt(params.limit || '5', 10)
      const items = historyStore.entries.slice(0, limit)
      if (!items.length) return { text: '暂无翻译历史记录。' }
      const lines = items.map((it, idx) => `${idx + 1}. [${it.type}] ${it.title} ${it.detail ? `(${it.detail.slice(0, 30)}...)` : ''}`)
      return { text: `### 🕒 最近历史记录\n\n` + lines.join('\n') }
    }

    case 'history_clear': {
      historyStore.clear()
      return { text: '已为您清空全部历史记录。', sideEffectDone: true }
    }

    case 'set_theme': {
      const t = (params.theme ?? 'system').toLowerCase() as ThemeMode
      settingsStore.update({ theme: t })
      return { text: `已将软件主题切换为：**${t}**。`, sideEffectDone: true }
    }

    case 'copy_to_clipboard': {
      const text = params.text ?? ''
      if (!text) return { text: '没有可复制的文本。' }
      window.bridge.copyText(text)
      return { text: '已将文本成功写入系统剪贴板。', sideEffectDone: true }
    }

    case 'speak': {
      const text = params.text ?? ''
      if (!text) return { text: '请提供待朗读的英文内容。' }
      window.bridge.speak(text)
      return { text: `正在为您发音朗读："${text.slice(0, 40)}"` }
    }

    case 'open_external': {
      const url = params.url ?? ''
      if (!url) return { text: '请提供网址。' }
      await window.bridge.openExternal(url)
      return { text: `已用默认浏览器打开：${url}` }
    }

    default:
      return { text: '未知指令。' }
  }
}
