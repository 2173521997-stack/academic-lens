import { useMemo, useState } from 'react'
import {
  BookOpen, Trash2, Search, Volume2, Sparkles, RefreshCw,
  Award, GraduationCap, Globe, Compass, BookMarked, Check, Download
} from 'lucide-react'
import { useWordbookStore } from '../stores/wordbookStore'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/noticeStore'
import {
  DETERMINISTIC_LEXICON,
  EXAM_CATEGORIES,
  getDeterministicLexiconEntry,
  getExamLexiconList,
  searchExamLexicon,
  type ExamCategory,
  type LexiconWord
} from '../lib/deterministicLexicon'
import { levelLabel } from '../lib/levels'
import { aiGradeWords } from '../lib/flashcard'
import EmptyState from './EmptyState'

type ViewCategory = ExamCategory

interface LexiconCardItem {
  isMy: boolean
  id?: string
  word: string
  phonetic: string
  pos: string
  levelKey: string
  levelBadge: string
  badgeColor: string
  definition: string
  examPoint?: string
  collocation?: string
  example: { en: string; zh: string }
  synonyms?: string[]
  antonyms?: string[]
  tags?: string[]
}

export default function WordbookView(): React.JSX.Element {
  const words = useWordbookStore((s) => s.words)
  const search = useWordbookStore((s) => s.search)
  const setSearch = useWordbookStore((s) => s.setSearch)
  const add = useWordbookStore((s) => s.add)
  const remove = useWordbookStore((s) => s.remove)
  const update = useWordbookStore((s) => s.update)
  const hasApi = Boolean(useSettingsStore((s) => s.settings.apiKey))

  // 词库分类标签与分页
  const [activeCategory, setActiveCategory] = useState<ViewCategory>('my')
  const [batchPage, setBatchPage] = useState<number>(1)
  const pageSize = 4

  // 快速添加生词输入框
  const [inputWord, setInputWord] = useState('')
  const [inputDef, setInputDef] = useState('')
  const [inputCtx, setInputCtx] = useState('')

  // 自动分级中
  const [gradingAll, setGradingAll] = useState(false)

  // 判断单词是否已在生词本中
  const isInWordbook = (wordStr: string): boolean => {
    return words.some((w) => w.word.toLowerCase() === wordStr.trim().toLowerCase())
  }

  // 发音
  const handleSpeak = (text: string) => {
    if (window.bridge?.speak) {
      window.bridge.speak(text)
    } else {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      window.speechSynthesis.speak(u)
    }
  }

  // 一键添加到生词本
  const handleCollect = (item: LexiconCardItem | LexiconWord) => {
    if (isInWordbook(item.word)) {
      toast('warning', `「${item.word}」已在生词本中`, '生词本')
      return
    }
    const det = getDeterministicLexiconEntry(item.word)
    add({
      word: item.word,
      definition: item.definition,
      context: item.example?.en || '',
      pos: item.pos || det?.pos,
      level: det?.levelKey || 'cet6',
      tags: det?.tags || ['考纲精选']
    })
    toast('success', `已将「${item.word}」收藏到生词本`, '收藏成功')
  }

  // 快速回车添加生词
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputWord.trim()) return
    const w = inputWord.trim()
    const det = getDeterministicLexiconEntry(w)
    add({
      word: w,
      definition: inputDef.trim() || det?.definition || '（待补充释义）',
      context: inputCtx.trim() || det?.example.en,
      pos: det?.pos,
      level: det?.levelKey,
      tags: det?.tags || ['手动添加']
    })
    setInputWord('')
    setInputDef('')
    setInputCtx('')
    toast('success', `已收录生词「${w}」`, '添加成功')
  }

  // 换一批
  const handleNextBatch = () => {
    const data = getExamLexiconList(activeCategory, batchPage, pageSize)
    if (batchPage >= data.totalPages) {
      setBatchPage(1)
    } else {
      setBatchPage((p) => p + 1)
    }
  }

  // 自动全量分级
  const gradeAll = async (): Promise<void> => {
    if (!hasApi || gradingAll || !words.length) return
    setGradingAll(true)
    try {
      const ungraded = words.filter((w) => !w.level).slice(0, 100)
      if (!ungraded.length) return
      // 确定性优先：先看确定性词库
      const unhitWords: string[] = []
      for (const w of ungraded) {
        const det = getDeterministicLexiconEntry(w.word)
        if (det) {
          update(w.id, { level: det.levelKey })
        } else {
          unhitWords.push(w.word)
        }
      }
      // 未命中的走 AI 分级
      if (unhitWords.length > 0) {
        const results = await aiGradeWords(unhitWords)
        for (const r of results) {
          if (!r.level) continue
          const id = ungraded.find((w) => w.word.toLowerCase() === r.word.toLowerCase())?.id
          if (id) update(id, { level: r.level })
        }
      }
      toast('success', '已为生词完成考纲难度分级', '智能分级')
    } catch (err) {
      toast('danger', err instanceof Error ? err.message : '分级失败', '分级错误')
    } finally {
      setGradingAll(false)
    }
  }

  // 导出 TSV
  const exportTsv = async (): Promise<void> => {
    if (!words.length) return
    const esc = (s?: string): string => (s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim()
    const lines = ['单词\t释义\t例句/语境', ...words.map((w) => [esc(w.word), esc(w.definition), esc(w.context)].join('\t'))]
    const path = await window.bridge.saveFile({
      defaultPath: `生词本-${new Date().toISOString().slice(0, 10)}.tsv`,
      data: lines.join('\n'),
      filters: [{ name: 'TSV / 文本', extensions: ['tsv', 'txt'] }]
    })
    if (path) toast('success', '已导出 Anki 格式，制表符分隔', '生词本导出')
  }

  // 获取当前视图展示的词汇卡片列表
  const currentList: LexiconCardItem[] = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      // 搜索模式
      if (activeCategory === 'my') {
        return words.filter(
          (w) =>
            w.word.toLowerCase().includes(q) ||
            (w.definition ?? '').toLowerCase().includes(q) ||
            w.tags?.some((t) => t.toLowerCase().includes(q))
        ).map((w) => {
          const det = getDeterministicLexiconEntry(w.word)
          return {
            isMy: true,
            id: w.id,
            word: w.word,
            phonetic: det?.phonetic || '',
            pos: w.pos || det?.pos || '',
            levelKey: w.level || det?.levelKey || 'unrated',
            levelBadge: det?.levelBadge || (w.level ? levelLabel(w.level) : '未分级'),
            badgeColor: det?.badgeColor || '#3b82f6',
            definition: w.definition,
            examPoint: det?.examPoint,
            collocation: det?.collocation,
            example: { en: w.context || det?.example.en || '', zh: det?.example.zh || '' },
            synonyms: det?.synonyms,
            antonyms: det?.antonyms,
            tags: w.tags
          }
        })
      }
      return searchExamLexicon(q).map((it) => ({ ...it, isMy: false }))
    }

    if (activeCategory === 'my') {
      return words.map((w) => {
        const det = getDeterministicLexiconEntry(w.word)
        return {
          isMy: true,
          id: w.id,
          word: w.word,
          phonetic: det?.phonetic || '',
          pos: w.pos || det?.pos || '',
          levelKey: w.level || det?.levelKey || 'unrated',
          levelBadge: det?.levelBadge || (w.level ? levelLabel(w.level) : '未分级'),
          badgeColor: det?.badgeColor || '#3b82f6',
          definition: w.definition,
          examPoint: det?.examPoint,
          collocation: det?.collocation,
          example: { en: w.context || det?.example.en || '', zh: det?.example.zh || '' },
          synonyms: det?.synonyms,
          antonyms: det?.antonyms,
          tags: w.tags
        }
      })
    }

    const res = getExamLexiconList(activeCategory, batchPage, pageSize)
    return res.items.map((it) => ({ ...it, isMy: false }))
  }, [activeCategory, batchPage, words, search])

  // 当前分类下的总词数与分页信息
  const categoryStats = useMemo(() => {
    const all = Object.values(DETERMINISTIC_LEXICON)
    return {
      my: words.length,
      cet6: all.filter((w) => w.levelKey === 'cet6').length,
      kaoyan: all.filter((w) => w.levelKey === 'kaoyan').length,
      ielts: all.filter((w) => w.levelKey === 'ielts').length,
      toefl: all.filter((w) => w.levelKey === 'toefl').length
    }
  }, [words])

  const examBatchInfo = useMemo(() => {
    if (activeCategory === 'my') return null
    return getExamLexiconList(activeCategory, batchPage, pageSize)
  }, [activeCategory, batchPage])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-app">
      {/* 顶部标题与快速收录栏 */}
      <div className="glass shrink-0 border-b border-line px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-panel/40">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-xs">
            <BookOpen size={18} />
          </span>
          <div>
            <h1 className="text-[15px] font-bold text-ink-1 flex items-center gap-2">
              单词本与核心词库
            </h1>
            <p className="text-[11px] text-ink-3">六级 / 考研 / 雅思 / 托福考纲必备与自建词库</p>
          </div>
        </div>

        {/* 快速添加与搜索输入框 */}
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1 sm:max-w-xl justify-end">
          <form onSubmit={handleQuickAdd} className="relative flex-1 sm:max-w-md flex items-center">
            <input
              type="text"
              className="input w-full !pr-16 text-[12px] bg-panel/60"
              placeholder="输入生词按回车自动收录..."
              value={inputWord}
              onChange={(e) => setInputWord(e.target.value)}
            />
            <button
              type="submit"
              className="absolute right-1.5 px-2.5 py-1 rounded-lg bg-accent text-white text-[11px] font-medium hover:opacity-90 transition"
            >
              + 添加
            </button>
          </form>

          <div className="relative w-40 shrink-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              placeholder="搜索词库..."
              className="input w-full !pl-8 text-[12px] bg-panel/60"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 词库分类标签栏（分级清晰可见 + 换一批） */}
      <div className="glass shrink-0 border-b border-line px-5 py-2 flex items-center justify-between overflow-x-auto bg-panel/20">
        <div className="flex items-center gap-2">
          {EXAM_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id
            const count = categoryStats[cat.id]
            return (
              <button
                key={cat.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition ${
                  isActive
                    ? 'bg-accent text-white shadow-xs'
                    : 'text-ink-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
                }`}
                onClick={() => {
                  setActiveCategory(cat.id)
                  setBatchPage(1)
                }}
              >
                {cat.id === 'my' && <BookMarked size={13} />}
                {cat.id === 'cet6' && <Award size={13} />}
                {cat.id === 'kaoyan' && <GraduationCap size={13} />}
                {cat.id === 'ielts' && <Globe size={13} />}
                {cat.id === 'toefl' && <Compass size={13} />}
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] rounded-full px-1.5 py-0.2 ${
                    isActive ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-ink-3'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* 右侧分页与换一批 / 批量工具 */}
        <div className="flex items-center gap-2 shrink-0">
          {activeCategory !== 'my' && examBatchInfo && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">
                第 {examBatchInfo.page} / {examBatchInfo.totalPages} 批
              </span>
              <button
                className="btn btn-ghost !px-2.5 !py-1 text-[11px] text-accent flex items-center gap-1 hover:bg-accent-soft"
                onClick={handleNextBatch}
              >
                <RefreshCw size={12} />
                换一批
              </button>
            </div>
          )}

          {activeCategory === 'my' && (
            <div className="flex items-center gap-1">
              <button
                className="btn btn-ghost !px-2.5 !py-1 text-[11px] text-ink-2 hover:text-ink-1"
                onClick={exportTsv}
                title="导出为 Anki TSV"
              >
                <Download size={12} /> 导出
              </button>
              <button
                className="btn btn-ghost !px-2.5 !py-1 text-[11px] text-accent hover:bg-accent-soft"
                onClick={gradeAll}
                disabled={gradingAll}
                title="用确定性算法与 AI 为生词分级"
              >
                <Sparkles size={12} className={gradingAll ? 'animate-spin' : ''} />
                {gradingAll ? '分级中…' : '智能分级'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 单词卡片列表呈现区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4 max-w-4xl mx-auto w-full">
        {!currentList.length ? (
          <EmptyState
            icon={BookOpen}
            title={search ? '未搜索到匹配词汇' : '当前词库暂无词汇'}
            hint={search ? '换个关键词试试，或直接添加到生词本' : '点击上方添加生词或选择考纲词库浏览'}
          />
        ) : (
          currentList.map((item, idx) => {
            const isSaved = isInWordbook(item.word)
            return (
              <div
                key={`${item.word}-${idx}`}
                className="card p-5 space-y-3.5 border border-line/60 hover:border-line transition-all shadow-xs bg-panel/60 backdrop-blur-sm group"
              >
                {/* 顶部：单词、音标、词性、分级徽章、发音与收藏操作 */}
                <div className="flex items-start justify-between">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[17px] font-bold text-ink-1 tracking-tight font-serif">
                      {item.word}
                    </span>
                    {item.phonetic && (
                      <span className="text-[12px] text-ink-3 font-mono">
                        {item.phonetic}
                      </span>
                    )}
                    {item.pos && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-ink-2 font-mono font-medium">
                        {item.pos}
                      </span>
                    )}
                    {/* 分级徽章（清晰可见） */}
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-white shadow-xs"
                      style={{ backgroundColor: item.badgeColor || '#3b82f6' }}
                    >
                      {item.levelBadge || '考纲精选'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="p-1.5 text-ink-3 hover:text-accent rounded-lg transition hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => handleSpeak(item.word)}
                      title="发音"
                    >
                      <Volume2 size={15} />
                    </button>

                    {item.isMy ? (
                      <button
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-ink-3 hover:text-danger rounded-lg transition hover:bg-black/5"
                        onClick={() => item.id && remove(item.id)}
                        title="移出生词本"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <button
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                          isSaved
                            ? 'bg-black/5 dark:bg-white/10 text-ink-3 cursor-default'
                            : 'bg-accent text-white hover:opacity-90 shadow-xs'
                        }`}
                        onClick={() => !isSaved && handleCollect(item)}
                      >
                        {isSaved ? (
                          <>
                            <Check size={12} />
                            已在生词本
                          </>
                        ) : (
                          <>
                            <BookMarked size={12} />
                            收藏到生词本
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* 核心释义（大号粗体） */}
                <div className="text-[14px] font-semibold text-ink-1 leading-snug">
                  {item.definition}
                </div>

                {/* 📌【考点与熟词生义】黄色高亮提示卡 */}
                {item.examPoint && (
                  <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-[12px] leading-relaxed flex items-start gap-2">
                    <span className="shrink-0 text-amber-600 dark:text-amber-400 font-bold">🎯 考点与熟词生义：</span>
                    <span>{item.examPoint}</span>
                  </div>
                )}

                {/* 🔗【高频搭配】 */}
                {item.collocation && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                      高频搭配：
                    </span>
                    <span className="text-ink-2 font-mono">{item.collocation}</span>
                  </div>
                )}

                {/* 📝【例句与翻译】 */}
                {item.example?.en && (
                  <div className="rounded-xl p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-line/40 space-y-1 text-[12px] leading-relaxed">
                    <p className="text-ink-1 font-serif">{item.example.en}</p>
                    {item.example.zh && <p className="text-ink-3 text-[11px]">{item.example.zh}</p>}
                  </div>
                )}

                {/* 🏷️【同义词】与【反义词】 */}
                {(item.synonyms?.length || item.antonyms?.length) && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] pt-1">
                    {item.synonyms && item.synonyms.length > 0 && (
                      <div className="flex items-center gap-1 text-ink-3">
                        <span className="font-semibold text-ink-2">同义词</span>
                        {item.synonyms.map((s) => (
                          <span key={s} className="chip !text-[10px] !py-0.2">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.antonyms && item.antonyms.length > 0 && (
                      <div className="flex items-center gap-1 text-ink-3">
                        <span className="font-semibold text-ink-2">反义词</span>
                        {item.antonyms.map((a) => (
                          <span key={a} className="chip !text-[10px] !py-0.2">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
