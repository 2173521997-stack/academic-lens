import React, { useMemo, useState } from 'react'
import {
  BookOpen,
  Plus,
  Trash2,
  Search,
  Volume2,
  Loader2,
  ExternalLink,
  BookmarkPlus,
  BookmarkCheck,
  GraduationCap,
  Landmark,
  Plane,
  Globe,
  BookMarked,
  RotateCw,
  Sparkles,
  AlertCircle,
  CheckCheck,
  Undo2,
  X
} from 'lucide-react'
import { useWordbookStore, cleanTermList } from '../stores/wordbookStore'
import { useAppStore } from '../stores/appStore'
import { EXAM_CATEGORIES, EXAM_VOCAB_DATA, type ExamCategory } from '../data/examVocab'
import { runTool } from '../lib/agentTools'
import EmptyState from './EmptyState'

const BATCH_SIZE = 6

export default function WordbookView(): React.JSX.Element {
  const words = useWordbookStore((s) => s.words)
  const discardedWords = useWordbookStore((s) => s.discardedWords)
  const discardWord = useWordbookStore((s) => s.discardWord)
  const restoreWord = useWordbookStore((s) => s.restoreWord)
  const isDiscarded = useWordbookStore((s) => s.isDiscarded)
  const search = useWordbookStore((s) => s.search)
  const setSearch = useWordbookStore((s) => s.setSearch)
  const remove = useWordbookStore((s) => s.remove)
  const addWithAutoLookup = useWordbookStore((s) => s.addWithAutoLookup)
  const importExamWord = useWordbookStore((s) => s.importExamWord)
  const hasWord = useWordbookStore((s) => s.hasWord)
  const isLookingUp = useWordbookStore((s) => s.isLookingUp)
  const openQuickLookup = useAppStore((s) => s.openQuickLookup)

  const [inputWord, setInputWord] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [category, setCategory] = useState<ExamCategory>('all_saved')
  const [isExpanding, setIsExpanding] = useState(false)
  const [showDiscardedModal, setShowDiscardedModal] = useState(false)
  const [batchIndices, setBatchIndices] = useState<Record<string, number>>({
    cet6: 0,
    kaoyan: 0,
    ielts: 0,
    toefl: 0
  })

  const handleAdd = async (): Promise<void> => {
    const raw = inputWord.trim()
    if (!raw) return
    setErrorMsg(null)
    const res = await addWithAutoLookup(raw)
    if (res.success) {
      setInputWord('')
    } else if (res.error) {
      setErrorMsg(res.error)
    }
  }

  // 换一批
  const nextBatch = (cat: string, totalItems: number): void => {
    const totalBatches = Math.max(1, Math.ceil(totalItems / BATCH_SIZE))
    setBatchIndices((prev) => ({
      ...prev,
      [cat]: ((prev[cat] ?? 0) + 1) % totalBatches
    }))
  }

  // AI 动态扩充新考点词
  const handleAiExpand = async (): Promise<void> => {
    if (category === 'all_saved' || isExpanding) return
    setIsExpanding(true)
    setErrorMsg(null)
    try {
      await runTool('generate_exam_vocab', { exam: category, count: '5' })
      setBatchIndices((prev) => ({ ...prev, [category]: 0 }))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 扩充词库失败')
    } finally {
      setIsExpanding(false)
    }
  }

  // 筛选“我的生词”（严格去重并过滤已丢弃）
  const filteredSavedWords = useMemo(() => {
    const q = search.trim().toLowerCase()
    const seen = new Set<string>()
    const unique = words.filter((w) => {
      const k = w.word.trim().toLowerCase()
      if (!k || seen.has(k) || isDiscarded(k)) return false
      seen.add(k)
      return true
    })

    if (!q) return unique
    return unique.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        (w.definition ?? '').toLowerCase().includes(q) ||
        (w.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        (w.synonyms ?? []).some((s) => s.toLowerCase().includes(q))
    )
  }, [words, search, isDiscarded])

  // 当前考试分类的所有单词（自动过滤用户已学会并丢弃的单词）
  const currentExamAllWords = useMemo(() => {
    if (category === 'all_saved') return []
    const all = EXAM_VOCAB_DATA[category] ?? []
    return all.filter((item) => !isDiscarded(item.word))
  }, [category, isExpanding, isDiscarded])

  // 考试词库显示列表（搜索时显示全部匹配，非搜索时按 BATCH_SIZE 显示当前批次）
  const displayExamWords = useMemo(() => {
    if (category === 'all_saved') return []
    const q = search.trim().toLowerCase()
    if (q) {
      return currentExamAllWords.filter(
        (item) =>
          item.word.toLowerCase().includes(q) ||
          item.def.toLowerCase().includes(q) ||
          (item.polysemy ?? '').toLowerCase().includes(q) ||
          (item.collocation ?? '').toLowerCase().includes(q)
      )
    }
    const currentIdx = batchIndices[category] ?? 0
    const start = currentIdx * BATCH_SIZE
    return currentExamAllWords.slice(start, start + BATCH_SIZE)
  }, [category, search, currentExamAllWords, batchIndices])

  const totalBatches = Math.max(1, Math.ceil(currentExamAllWords.length / BATCH_SIZE))
  const currentBatchNum = (batchIndices[category] ?? 0) + 1

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-surface/30 relative">
      {/* 顶部工具栏与快速录入栏 */}
      <div className="glass flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-2.5 select-none min-w-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <BookOpen size={16} strokeWidth={1.5} />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-[15px] font-semibold text-ink-1 leading-tight">生词本</h1>
            <p className="text-[11px] text-ink-3">考纲核心词库与自主收录</p>
          </div>
        </div>

        {/* 搜索与添加输入框 */}
        <div className="flex flex-1 max-w-xl items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <input
              className="input !py-1.5 !pr-16 text-[12.5px] w-full"
              placeholder="输入生词按回车收录…"
              value={inputWord}
              onChange={(e) => {
                setInputWord(e.target.value)
                setErrorMsg(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleAdd()
                }
              }}
            />
            <button
              className="btn btn-primary absolute right-1 top-1/2 -translate-y-1/2 !px-2.5 !py-0.8 text-[11px] shrink-0"
              disabled={!inputWord.trim() || isLookingUp}
              onClick={() => void handleAdd()}
            >
              {isLookingUp ? (
                <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
              ) : (
                <Plus size={12} strokeWidth={1.5} />
              )}
              <span className="hidden md:inline">{isLookingUp ? '解析中…' : '添加'}</span>
            </button>
          </div>

          <div className="relative shrink-0">
            <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input !w-36 md:!w-44 !py-1.5 !pl-7 text-[12px]"
              placeholder="搜索词库…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 词库分类导航栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-2 select-none bg-surface/50 min-w-0 gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {EXAM_CATEGORIES.map((cat) => {
            const active = category === cat.id
            const count =
              cat.id === 'all_saved'
                ? filteredSavedWords.length
                : (EXAM_VOCAB_DATA[cat.id as keyof typeof EXAM_VOCAB_DATA] ?? []).filter(
                    (x) => !isDiscarded(x.word)
                  ).length

            return (
              <button
                key={cat.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition shrink-0 cursor-pointer ${
                  active
                    ? 'bg-accent text-white shadow-xs'
                    : 'text-ink-2 hover:bg-surface hover:text-ink-1'
                }`}
                onClick={() => setCategory(cat.id)}
              >
                {cat.id === 'all_saved' && <BookMarked size={13} strokeWidth={1.5} className="shrink-0" />}
                {cat.id === 'cet6' && <GraduationCap size={13} strokeWidth={1.5} className="shrink-0" />}
                {cat.id === 'kaoyan' && <Landmark size={13} strokeWidth={1.5} className="shrink-0" />}
                {cat.id === 'ielts' && <Plane size={13} strokeWidth={1.5} className="shrink-0" />}
                {cat.id === 'toefl' && <Globe size={13} strokeWidth={1.5} className="shrink-0" />}
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full shrink-0 ${
                    active ? 'bg-white/20 text-white' : 'bg-surface/80 text-ink-3'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* 考试词库“换一批”与“AI 扩充”功能按键 */}
        {category !== 'all_saved' && (
          <div className="flex items-center gap-2 shrink-0">
            {!search && (
              <span className="text-[11px] text-ink-3 hidden sm:inline">
                第 {currentBatchNum} / {totalBatches} 批
              </span>
            )}
            <button
              className="btn btn-ghost !px-2.5 !py-1 text-[11.5px] text-accent border border-accent/20 hover:bg-accent-soft hover:border-accent/40 transition shrink-0 cursor-pointer"
              onClick={() => nextBatch(category, currentExamAllWords.length)}
              title="切换下一批"
            >
              <RotateCw size={12} strokeWidth={1.5} className="shrink-0" />
              <span>换一批</span>
            </button>
            <button
              className="btn btn-primary !px-2.5 !py-1 text-[11.5px] shrink-0 cursor-pointer"
              disabled={isExpanding}
              onClick={() => void handleAiExpand()}
              title="基于考纲扩充词库"
            >
              {isExpanding ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin shrink-0" /> : <Sparkles size={12} strokeWidth={1.5} className="shrink-0" />}
              <span>{isExpanding ? '生成中…' : 'AI 扩充…'}</span>
            </button>
          </div>
        )}

        {category === 'all_saved' && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-ink-3 shrink-0 hidden sm:inline">
              共收录 {filteredSavedWords.length} 词
            </div>
            {discardedWords.length > 0 && (
              <button
                className="btn btn-ghost !px-2 !py-0.8 text-[11px] text-ok border border-ok/20 hover:bg-ok/10 shrink-0 cursor-pointer"
                onClick={() => setShowDiscardedModal(true)}
                title="查看已掌握词汇"
              >
                <CheckCheck size={12} strokeWidth={1.5} /> 已掌握 {discardedWords.length} 词
              </button>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div className="mx-5 mt-2.5 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-[12px] text-danger shrink-0">
          <AlertCircle size={14} strokeWidth={1.5} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 主展示区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {category === 'all_saved' ? (
          /* ================= 1. 我的生词本列表 ================= */
          <div className="mx-auto max-w-4xl space-y-3">
            {filteredSavedWords.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={words.length ? '没有找到匹配的单词' : '生词本暂无内容'}
                hint={
                  words.length
                    ? '换个关键词重新搜索'
                    : '在上方输入框添加单词，或从六级/考研/雅思/托福词库一键收录'
                }
              />
            ) : (
              filteredSavedWords.map((w) => {
                const syns = cleanTermList(w.synonyms)
                const ants = cleanTermList(w.antonyms)

                return (
                  <div
                    key={w.id}
                    className="card card-hover group relative flex flex-col gap-2 p-4 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-baseline gap-2.5 flex-wrap min-w-0">
                        <button
                          className="text-[17px] font-semibold text-ink-1 hover:text-accent transition text-left cursor-pointer"
                          onClick={() => openQuickLookup(w.word)}
                          title="在软件内小窗中查看完整词卡"
                        >
                          {w.word}
                        </button>
                        {w.phonetic && (
                          <span className="text-[12px] text-ink-3 font-normal">{w.phonetic}</span>
                        )}
                        {w.pos && <span className="chip text-[10px] shrink-0">{w.pos}</span>}
                        {w.tags &&
                          w.tags.map((t) => (
                            <span key={t} className="chip text-[10px] text-ink-2 shrink-0">
                              #{t}
                            </span>
                          ))}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          className="btn btn-ghost !p-1.5 text-ink-3 hover:text-accent shrink-0 cursor-pointer"
                          onClick={() => window.bridge.speak(w.word)}
                          title="发音"
                        >
                          <Volume2 size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          className="btn btn-ghost !p-1.5 text-ink-3 hover:text-accent shrink-0 cursor-pointer"
                          onClick={() => openQuickLookup(w.word)}
                          title="查看词卡"
                        >
                          <ExternalLink size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          className="btn btn-ghost !px-2 !py-1 text-[11px] text-ink-3 hover:text-ok hover:bg-ok/10 shrink-0 cursor-pointer"
                          onClick={() => discardWord(w.word)}
                          title="标记为已掌握"
                        >
                          <CheckCheck size={13} strokeWidth={1.5} className="text-ok" />
                          <span className="hidden sm:inline">已掌握</span>
                        </button>
                        <button
                          className="btn btn-ghost !p-1.5 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:!text-danger shrink-0 cursor-pointer"
                          onClick={() => remove(w.id)}
                          title="删除"
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>

                    {w.definition && (
                      <p className="text-[13px] leading-relaxed text-ink-1 font-medium select-text break-words">
                        {w.definition}
                      </p>
                    )}

                    {/* 同义词与反义词（可点击的动态按键） */}
                    {(syns.length > 0 || ants.length > 0) && (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-[11px]">
                        {syns.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-ink-3 uppercase text-[10px]">同义词</span>
                            {syns.map((syn, idx) => (
                              <button
                                key={`${syn}-${idx}`}
                                onClick={() => openQuickLookup(syn)}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent hover:bg-accent/5 active:scale-95 transition cursor-pointer select-none"
                                title={`查阅 "${syn}"`}
                              >
                                {syn}
                              </button>
                            ))}
                          </div>
                        )}

                        {ants.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-ink-3 uppercase text-[10px]">反义词</span>
                            {ants.map((ant, idx) => (
                              <button
                                key={`${ant}-${idx}`}
                                onClick={() => openQuickLookup(ant)}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent hover:bg-accent/5 active:scale-95 transition cursor-pointer select-none"
                                title={`查阅 "${ant}"`}
                              >
                                {ant}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {w.context && (
                      <div className="rounded-lg bg-surface/60 p-2.5 text-[12px] text-ink-2 select-text break-words">
                        <p className="leading-relaxed">{w.context}</p>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        ) : (
          /* ================= 2. 考试核心必备词库列表 ================= */
          <div className="mx-auto max-w-4xl space-y-3">
            {displayExamWords.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="暂无未掌握的考试词汇"
                hint="该分类下的词汇可能已全部掌握，点击右上角「AI 扩充…」可生成更多考纲新词"
              />
            ) : (
              displayExamWords.map((item) => {
                const isSaved = hasWord(item.word)
                const syns = cleanTermList(item.synonyms)
                const ants = cleanTermList(item.antonyms)

                return (
                  <div
                    key={item.id}
                    className="card card-hover flex flex-col gap-2.5 p-4.5 border-line hover:border-accent/30 transition-all rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2.5 flex-wrap">
                          <button
                            className="text-[17px] font-bold text-ink-1 hover:text-accent transition text-left cursor-pointer"
                            onClick={() => openQuickLookup(item.word)}
                            title="查看详情"
                          >
                            {item.word}
                          </button>
                          <span className="text-[12.5px] text-ink-3">{item.phonetic}</span>
                          <span className="chip !text-[10px] shrink-0">{item.pos}</span>
                          <span className="chip bg-accent-soft text-accent text-[10px] font-semibold shrink-0">
                            {item.examTagLabel}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          className="btn btn-ghost !p-1.5 text-ink-3 hover:text-accent shrink-0 cursor-pointer"
                          onClick={() => window.bridge.speak(item.word)}
                          title="发音"
                        >
                          <Volume2 size={14} strokeWidth={1.5} />
                        </button>
                        {isSaved ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-ok/10 text-ok border border-ok/20 shrink-0">
                            <BookmarkCheck size={13} strokeWidth={1.5} /> 已收藏
                          </span>
                        ) : (
                          <button
                            className="btn btn-primary !px-2.5 !py-1 text-[11px] shrink-0 cursor-pointer"
                            onClick={() => importExamWord(item)}
                            title="收藏生词"
                          >
                            <BookmarkPlus size={12} strokeWidth={1.5} /> 收藏
                          </button>
                        )}
                        <button
                          className="btn btn-ghost !px-2 !py-1 text-[11px] text-ink-3 hover:text-ok hover:bg-ok/10 shrink-0 cursor-pointer"
                          onClick={() => discardWord(item.word)}
                          title="标记为已掌握"
                        >
                          <CheckCheck size={13} strokeWidth={1.5} className="text-ok" />
                          <span className="hidden sm:inline">已掌握</span>
                        </button>
                      </div>
                    </div>

                    {/* 中文核心释义 */}
                    <p className="text-[13px] leading-relaxed text-ink-1 font-semibold select-text break-words">
                      {item.def}
                    </p>

                    {/* 熟词生义 / 考点警示 */}
                    {item.polysemy && (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-[12px] text-amber-900 dark:text-amber-200 break-words">
                        <span className="font-semibold mr-1">考点：</span>
                        <span>{item.polysemy}</span>
                      </div>
                    )}

                    {/* 高频学术搭配 */}
                    {item.collocation && (
                      <div className="flex items-center gap-1.5 text-[12px] text-ink-2 flex-wrap">
                        <span className="font-semibold text-accent text-[10.5px] uppercase shrink-0">高频搭配:</span>
                        <span className="font-mono bg-surface px-2 py-0.5 rounded-md border border-line select-text break-words">
                          {item.collocation}
                        </span>
                      </div>
                    )}

                    {/* 学术真题例句 */}
                    <div className="rounded-lg bg-surface/70 p-3 text-[12px] select-text border border-line/50 break-words">
                      <p className="leading-relaxed text-ink-1 font-medium">{item.exEn}</p>
                      <p className="mt-1 text-[11.5px] text-ink-3 leading-relaxed">{item.exZh}</p>
                    </div>

                    {/* 同义词与反义词 */}
                    {(syns.length > 0 || ants.length > 0) && (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-0.5 text-[11px]">
                        {syns.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-ink-3 uppercase text-[10px]">同义词</span>
                            {syns.map((s, i) => (
                              <button
                                key={i}
                                onClick={() => openQuickLookup(s)}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent hover:bg-accent/5 active:scale-95 transition cursor-pointer select-none"
                                title={`查阅 "${s}"`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                        {ants.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-ink-3 uppercase text-[10px]">反义词</span>
                            {ants.map((a, i) => (
                              <button
                                key={i}
                                onClick={() => openQuickLookup(a)}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface text-ink-2 border border-line hover:border-accent hover:text-accent hover:bg-accent/5 active:scale-95 transition cursor-pointer select-none"
                                title={`查阅 "${a}"`}
                              >
                                {a}
                              </button>
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
        )}
      </div>

      {/* 已掌握词汇恢复模态框 */}
      {showDiscardedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="card max-w-lg w-full max-h-[80vh] flex flex-col p-5 border border-line shadow-pop animate-pop-in bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <CheckCheck size={16} strokeWidth={1.5} className="text-ok" />
                <h3 className="text-[14.5px] font-semibold text-ink-1">
                  已掌握词汇 ({discardedWords.length})
                </h3>
              </div>
              <button
                className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
                onClick={() => setShowDiscardedModal(false)}
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>

            <p className="text-[11.5px] text-ink-3 py-2">
              以下是被标记为「已掌握」的单词：如需重新加入背诵，可随时恢复：
            </p>

            <div className="min-h-0 flex-1 overflow-y-auto py-2 space-y-1.5">
              {discardedWords.length === 0 ? (
                <p className="text-[12px] text-ink-3 text-center py-6">暂无已掌握词汇</p>
              ) : (
                discardedWords.map((dw) => (
                  <div
                    key={dw}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface/70 border border-line hover:border-accent/30 transition"
                  >
                    <button
                      className="text-[13px] font-medium text-ink-1 hover:text-accent cursor-pointer"
                      onClick={() => openQuickLookup(dw)}
                    >
                      {dw}
                    </button>
                    <button
                      className="btn btn-ghost !px-2 !py-0.8 text-[11px] text-accent border border-accent/20 hover:bg-accent-soft cursor-pointer"
                      onClick={() => restoreWord(dw)}
                      title="恢复到词库"
                    >
                      <Undo2 size={11} strokeWidth={1.5} /> 恢复
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-line flex justify-end">
              <button
                className="btn btn-primary !px-4 !py-1.5 text-[12px]"
                onClick={() => setShowDiscardedModal(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
