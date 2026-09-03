import { memo, useEffect, useMemo, useState, Fragment } from 'react'
import {
  ArrowLeft,
  Download,
  Languages,
  Square,
  Sparkles,
  BookmarkPlus,
  Loader2,
  MessageSquare,
  RefreshCw,
  Copy,
  Highlighter,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  FileText,
  X,
  FileSpreadsheet
} from 'lucide-react'
import { useFileStore, type DocMode } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useAppStore } from '../stores/appStore'
import { useAgentStore } from '../stores/agentStore'
import Segmented from './Segmented'
import { buildPlainText, buildPlainTextHeader, buildBilingualMarkdown, buildDocxBase64 } from '../lib/exportText'
import { analyzeUnknownWords, type SegmentUnknown } from '../lib/unknownWords'
import { splitSentences } from '../lib/inline'
import { renderLatexInText } from '../lib/renderLatex'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import type { Segment, Block, Inline } from '../lib/types'

export default function FileView(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const segments = useFileStore((s) => s.segments)
  const mode = useFileStore((s) => s.mode)
  const setMode = useFileStore((s) => s.setMode)
  const clearDoc = useFileStore((s) => s.clearDoc)
  const progress = useFileStore((s) => s.progress)
  const error = useFileStore((s) => s.error)
  const translateAll = useFileStore((s) => s.translateAll)
  const stopTranslate = useFileStore((s) => s.stopTranslate)
  const translating = segments.some((s) => s.translating)

  // 状态与弹窗
  const [toast, setToast] = useState<string | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [bookmarkTarget, setBookmarkTarget] = useState<{ word: string; def: string; context: string } | null>(null)

  // 全文摘要状态
  const summary = useFileStore((s) => s.summary)
  const summaryState = useFileStore((s) => s.summaryState)
  const summarize = useFileStore((s) => s.summarize)

  // 页面分页与导航状态
  const [pageFilter, setPageFilter] = useState<'all' | number>('all')
  const [currentPage, setCurrentPage] = useState(1)

  // AI 回答中的段落引用跳转：切回双语对照、复位分页，再滚动定位并高亮目标段
  const locateRequest = useFileStore((s) => s.locateRequest)
  const clearLocate = useFileStore((s) => s.clearLocate)

  useEffect(() => {
    if (!locateRequest) return
    setMode('cn')
    setPageFilter('all')
    setCurrentPage(1)
    const para = locateRequest.para
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-para="${para}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const node = el as HTMLElement
        node.style.boxShadow = '0 0 0 2px var(--color-accent, #7aa2ff)'
        setTimeout(() => {
          node.style.boxShadow = ''
        }, 1800)
      }
      clearLocate()
    })
    return () => cancelAnimationFrame(raf)
  }, [locateRequest, setMode, setPageFilter, setCurrentPage, clearLocate])

  const pages = useMemo(() => {
    const pSet = new Set<number>()
    segments.forEach((s) => {
      if (s.page !== undefined) pSet.add(s.page)
    })
    return Array.from(pSet).sort((a, b) => a - b)
  }, [segments])

  const totalPages = pages.length || 1

  const untranslated = useMemo(() => segments.filter((s) => !s.translation && !s.translating && !s.error).length, [segments])
  const doneCount = segments.filter((s) => s.translation).length

  const showToast = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const copyAll = (): void => {
    window.bridge.copyText(buildPlainText(segments))
    showToast('已复制全文译文到剪贴板')
    setMoreMenuOpen(false)
  }

  const exportDocument = async (format: 'plain' | 'bilingual' | 'docx'): Promise<void> => {
    if (!doc) return
    setMoreMenuOpen(false)
    const base = doc.name.replace(/\.[^.]+$/, '')
    try {
      if (format === 'docx') {
        const b64 = await buildDocxBase64(segments)
        const path = await window.bridge.saveBuffer({
          defaultPath: `${base}-双语对照.docx`,
          dataB64: b64,
          filters: [{ name: 'Word 文档', extensions: ['docx'] }]
        })
        if (path) showToast('Word 双语文档导出成功')
        return
      }
      const md =
        format === 'bilingual' ? buildBilingualMarkdown(doc, segments) : buildPlainTextHeader(doc, segments)
      const path = await window.bridge.saveFile({
        defaultPath: `${base}-${format === 'bilingual' ? '双语对照' : '中文译文'}.md`,
        data: md,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '纯文本', extensions: ['txt'] }
        ]
      })
      if (path) showToast('Markdown 文档导出成功')
    } catch (err) {
      showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface select-none relative">
      {/* Toast 统一浮层提示 (P3-10) */}
      {toast && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 animate-float-in rounded-xl bg-ink-1/90 px-4 py-2 text-[12px] font-medium text-white shadow-pop backdrop-blur">
          {toast}
        </div>
      )}

      {/* ================= 统一 macOS 原生精简工具栏 (P2-6) ================= */}
      <header className="glass z-20 flex shrink-0 flex-col border-b border-line px-4 py-2 gap-2">
        {/* 第一行：文档标题与主操作 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 cursor-pointer" onClick={clearDoc} title="返回主页">
              <ArrowLeft size={15} strokeWidth={1.5} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[13.5px] font-semibold text-ink-1 tracking-tight">{doc?.name}</h1>
              <p className="text-[11px] text-ink-3">
                {segments.length} 段落 · {doneCount}/{segments.length} 已完成
                {translating && ` · ${progress.done}/${progress.total} 正在翻译`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {translating ? (
              <button className="btn shrink-0 cursor-pointer" onClick={stopTranslate}>
                <Square size={12} strokeWidth={1.5} /> 停止
              </button>
            ) : untranslated > 0 ? (
              <button className="btn btn-primary shrink-0 cursor-pointer" onClick={translateAll}>
                <Languages size={13} strokeWidth={1.5} /> 翻译全文
              </button>
            ) : null}

            {mode === 'summary' && summaryState === 'idle' && (
              <button className="btn btn-primary shrink-0 cursor-pointer" onClick={summarize}>
                <Sparkles size={13} strokeWidth={1.5} /> 生成摘要
              </button>
            )}

            {/* ⋯ 更多与导出下拉菜单 (P2-6) */}
            <div className="relative">
              <button
                className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1 cursor-pointer"
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                title="导出与更多操作"
              >
                <MoreHorizontal size={15} strokeWidth={1.5} />
              </button>

              {moreMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-line bg-surface/95 p-1 backdrop-blur shadow-pop z-30 space-y-0.5 animate-float-in text-[11.5px]">
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-1 hover:bg-surface-alt cursor-pointer"
                    onClick={copyAll}
                  >
                    <Copy size={13} /> 复制全文译文
                  </button>
                  <div className="h-px bg-line/60 my-0.5" />
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-1 hover:bg-surface-alt cursor-pointer"
                    onClick={() => void exportDocument('bilingual')}
                  >
                    <FileText size={13} /> 导出双语 Markdown
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-1 hover:bg-surface-alt cursor-pointer"
                    onClick={() => void exportDocument('docx')}
                  >
                    <FileSpreadsheet size={13} /> 导出双语 Word (.docx)
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-1 hover:bg-surface-alt cursor-pointer"
                    onClick={() => void exportDocument('plain')}
                  >
                    <Download size={13} /> 导出纯译文 (.md)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 第二行：模式选择（前置） + 长文分页控制 (P2-4, P2-6) */}
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-line/40">
          <div className="shrink-0">
            <Segmented<DocMode>
              items={[
                { value: 'cn', label: '双语对照' },
                { value: 'summary', label: '全文摘要' }
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>

          {/* PDF / 长文分页跳转 (P2-4) */}
          {pages.length > 1 && mode === 'cn' && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <button
                className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 disabled:opacity-30 cursor-pointer"
                disabled={currentPage <= 1}
                onClick={() => {
                  const next = Math.max(1, currentPage - 1)
                  setCurrentPage(next)
                  setPageFilter(next)
                }}
                title="上一页"
              >
                <ChevronLeft size={14} />
              </button>

              <select
                className="input !h-6 !py-0 !px-1.5 !text-[11px] font-medium"
                value={pageFilter === 'all' ? 'all' : currentPage}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'all') {
                    setPageFilter('all')
                  } else {
                    const p = parseInt(v, 10)
                    setCurrentPage(p)
                    setPageFilter(p)
                  }
                }}
              >
                <option value="all">全部 ({pages.length} 页)</option>
                {pages.map((p) => (
                  <option key={p} value={p}>第 {p} 页</option>
                ))}
              </select>

              <button
                className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 disabled:opacity-30 cursor-pointer"
                disabled={currentPage >= totalPages}
                onClick={() => {
                  const next = Math.min(totalPages, currentPage + 1)
                  setCurrentPage(next)
                  setPageFilter(next)
                }}
                title="下一页"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
          {error}
        </div>
      )}

      {/* 主阅读内容区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" onClick={() => setMoreMenuOpen(false)}>
        {mode === 'cn' && (
          <CnSplitView
            pageFilter={pageFilter}
            onOpenBookmark={(word, def, context) => setBookmarkTarget({ word, def, context })}
            onShowToast={showToast}
          />
        )}
        {mode === 'summary' && <SummaryCard summary={summary} state={summaryState} error={error} />}
      </div>

      {/* 最小生词收藏弹窗 (P1-1) */}
      {bookmarkTarget && (
        <AddWordModal
          target={bookmarkTarget}
          onClose={() => setBookmarkTarget(null)}
          onSuccess={(word) => {
            setBookmarkTarget(null)
            showToast(`已将 "${word}" 收藏到生词本`)
          }}
        />
      )}
    </div>
  )
}

/** 最小生词收藏卡片 Modal (P1-1) */
function AddWordModal({
  target,
  onClose,
  onSuccess
}: {
  target: { word: string; def: string; context: string }
  onClose: () => void
  onSuccess: (word: string) => void
}): React.JSX.Element {
  const [word, setWord] = useState(target.word)
  const [def, setDef] = useState(target.def)
  const addWord = useWordbookStore((s) => s.add)

  const handleSave = (): void => {
    const w = word.trim()
    if (!w) return
    addWord({
      word: w,
      definition: def.trim(),
      context: target.context.slice(0, 160),
      tags: ['文档生词']
    })
    onSuccess(w)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-float-in">
      <div className="card w-full max-w-sm border border-line bg-surface p-4 shadow-pop space-y-3">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <span className="text-[13px] font-semibold text-ink-1 flex items-center gap-1.5">
            <BookmarkPlus size={14} className="text-accent" /> 收藏生词
          </span>
          <button className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 cursor-pointer" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        <div className="space-y-2.5 text-[12px]">
          <div>
            <label className="block text-ink-2 font-medium mb-1">生词 / 词组</label>
            <input
              type="text"
              className="input w-full !text-[13px] font-semibold"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="输入单词"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-ink-2 font-medium mb-1">中文释义</label>
            <input
              type="text"
              className="input w-full !text-[12px]"
              value={def}
              onChange={(e) => setDef(e.target.value)}
              placeholder="释义（可留空自动查询）"
            />
          </div>

          {target.context && (
            <div>
              <label className="block text-ink-3 font-medium mb-0.5">当前语境段落</label>
              <p className="rounded-lg bg-card/60 p-2 font-mono text-[11px] leading-relaxed text-ink-2 border border-line/40 select-text">
                {target.context}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-line/60">
          <button className="btn btn-ghost !px-3 !py-1 text-[11.5px] cursor-pointer" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary !px-3 !py-1 text-[11.5px] cursor-pointer" onClick={handleSave} disabled={!word.trim()}>
            确认加入生词本
          </button>
        </div>
      </div>
    </div>
  )
}

/** 中文译文视图：合并单层吸顶头 + 独立段落卡片 (P2-5) */
function CnSplitView({
  pageFilter,
  onOpenBookmark,
  onShowToast
}: {
  pageFilter: 'all' | number
  onOpenBookmark: (word: string, def: string, context: string) => void
  onShowToast: (msg: string) => void
}): React.JSX.Element {
  const segments = useFileStore((s) => s.segments)
  const translateOne = useFileStore((s) => s.translateOne)
  const wordbookCount = useWordbookStore((s) => s.words.length)

  const [diffOn, setDiffOn] = useState(false)
  const [sentenceOn, setSentenceOn] = useState(false)

  const diff = useMemo(() => (diffOn ? analyzeUnknownWords(segments) : null), [diffOn, segments, wordbookCount])

  // 过滤段落
  const filteredSegs = useMemo(() => {
    if (pageFilter === 'all') return segments
    return segments.filter((s) => s.page === pageFilter)
  }, [segments, pageFilter])

  let lastPage: number | undefined

  return (
    <div className="mx-auto max-w-6xl">
      {/* 单层合并吸顶栏 (P2-5) */}
      <div className="sticky top-0 z-10 grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6 border-b border-line bg-panel/95 backdrop-blur-md px-3 py-1.5 rounded-t-xl">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold text-ink-3 uppercase tracking-wider">英文原文</span>
          <button
            className={`btn !px-2 !py-0.5 text-[10.5px] ${diffOn ? '!border-accent !bg-accent-soft !text-accent' : 'text-ink-3'}`}
            onClick={() => setDiffOn((v) => !v)}
            title="高亮未掌握生词"
          >
            <Highlighter size={10} strokeWidth={1.5} /> {diffOn ? '隐藏生词' : '标出生词'}
          </button>
          <button
            className={`btn !px-2 !py-0.5 text-[10.5px] ${sentenceOn ? '!border-accent !bg-accent-soft !text-accent' : 'text-ink-3'}`}
            onClick={() => setSentenceOn((v) => !v)}
            title="逐句精读"
          >
            <Languages size={10} strokeWidth={1.5} /> {sentenceOn ? '按段' : '按句'}
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-ink-3 uppercase tracking-wider">中文译文</span>
          {diff && (
            <span className="text-[10px] text-ink-3">
              生词 {diff.totalUnknown} 词 · 认识率 {diff.hitRate}%
            </span>
          )}
        </div>
      </div>

      {filteredSegs.map((seg, i) => {
        const pageBreak = seg.page !== undefined && seg.page !== lastPage
        lastPage = seg.page
        return (
          <Fragment key={seg.id}>
            {pageBreak && pageFilter === 'all' && (
              <div className="mt-5 mb-1 flex items-center gap-2 first:mt-0">
                <span className="chip !bg-accent-soft !text-accent font-medium">第 {seg.page} 页</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <SplitRow
              seg={seg}
              index={i}
              translateOne={translateOne}
              onOpenBookmark={onOpenBookmark}
              onShowToast={onShowToast}
              diff={diff?.segments[i] ?? null}
              diffOn={diffOn}
              sentenceOn={sentenceOn}
            />
          </Fragment>
        )
      })}
    </div>
  )
}

/** 双栏对照行：右下角极简操作小胶囊 (P2-7, P1-1, P1-3) */
const SplitRow = memo(function SplitRow({
  seg,
  index,
  translateOne,
  onOpenBookmark,
  onShowToast,
  diff,
  diffOn,
  sentenceOn
}: {
  seg: Segment
  index: number
  translateOne: (segId: string) => void
  onOpenBookmark: (word: string, def: string, context: string) => void
  onShowToast: (msg: string) => void
  diff: SegmentUnknown | null
  diffOn: boolean
  sentenceOn: boolean
}): React.JSX.Element {
  const block = seg.block
  const kind = block.kind
  const [menuOpen, setMenuOpen] = useState(false)

  const showTranslate = !seg.translation && !seg.translating && !seg.error

  const handleAskAI = (): void => {
    const firstSentence = (seg.text.split(/[.!?。！？]/)[0] ?? '').trim().slice(0, 36)
    const promptRef = `@段落${index + 1} (引用第${index + 1}段: "${firstSentence}...") `
    useAgentStore.getState().appendInput(promptRef)
    useAppStore.getState().setAssistant(true)
    onShowToast(`已在 AI 助手中引用第 ${index + 1} 段`)
  }

  const handleBookmark = (): void => {
    const firstWord = (seg.text.match(/[A-Za-z][A-Za-z-]{2,}/) ?? [''])[0]
    onOpenBookmark(firstWord, '', seg.text)
  }

  return (
    <div
      data-page={seg.page}
      data-para={index + 1}
      className="group relative rounded-xl border-b border-line/40 px-3 py-3 transition hover:bg-card/70"
      data-kind={kind}
    >
      {kind === 'paragraph' && sentenceOn ? (
        <SentenceRows seg={seg} />
      ) : (
        <div className="grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6">
          {/* 左栏：原文 */}
          <BlockSource block={block} diff={diff} diffOn={diffOn} />
          {/* 右栏：译文 */}
          <TranslationBody seg={seg} />
        </div>
      )}

      {/* 右下角极简小胶囊菜单 (P2-7) */}
      <div className="absolute right-2 bottom-2 z-10">
        {!menuOpen ? (
          <button
            className="btn btn-ghost !p-1 rounded-full text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-surface-alt transition cursor-pointer shadow-xs border border-line/50 bg-surface/90 backdrop-blur"
            onClick={() => setMenuOpen(true)}
            title="段落操作"
          >
            <MoreHorizontal size={13} />
          </button>
        ) : (
          <div className="flex items-center gap-1 rounded-full bg-surface/95 border border-line px-2 py-0.5 shadow-pop backdrop-blur animate-float-in text-[11px]">
            {seg.error && (
              <button
                className="btn btn-ghost !p-1 text-danger cursor-pointer"
                onClick={() => {
                  translateOne(seg.id)
                  setMenuOpen(false)
                }}
                title="重新翻译"
              >
                <RefreshCw size={11} />
              </button>
            )}

            {showTranslate && (
              <button
                className="btn btn-ghost !p-1 text-accent cursor-pointer"
                onClick={() => {
                  translateOne(seg.id)
                  setMenuOpen(false)
                }}
                title="翻译本段"
              >
                <Languages size={11} /> 翻译
              </button>
            )}

            {seg.translation && (
              <button
                className="btn btn-ghost !p-1 text-ink-2 hover:text-ink-1 cursor-pointer"
                onClick={() => {
                  window.bridge.copyText(seg.translation)
                  onShowToast('已复制段落译文')
                  setMenuOpen(false)
                }}
                title="复制译文"
              >
                <Copy size={11} />
              </button>
            )}

            <button
              className="btn btn-ghost !p-1 text-ink-2 hover:text-accent cursor-pointer"
              onClick={() => {
                handleBookmark()
                setMenuOpen(false)
              }}
              title="收藏生词"
            >
              <BookmarkPlus size={11} />
            </button>

            <button
              className="btn btn-ghost !p-1 text-ink-2 hover:text-accent cursor-pointer"
              onClick={() => {
                handleAskAI()
                setMenuOpen(false)
              }}
              title="向 AI 提问此段"
            >
              <MessageSquare size={11} /> 问AI
            </button>

            <button
              className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1 cursor-pointer ml-0.5"
              onClick={() => setMenuOpen(false)}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

/** 渲染一行 Inline */
function renderRuns(
  runs: Inline[],
  diffOn?: boolean,
  unknownSet?: Set<string>,
  onLookup?: (word: string) => void
): React.ReactNode {
  return runs.map((r, i) => {
    let contentNode: React.ReactNode = r.text

    if (diffOn && unknownSet && unknownSet.size > 0 && !r.code) {
      const parts = r.text.split(/([A-Za-z][A-Za-z'-]*)/)
      contentNode = parts.map((part, pIdx) => {
        if (unknownSet.has(part.toLowerCase())) {
          return (
            <span
              key={pIdx}
              onClick={(e) => {
                e.stopPropagation()
                onLookup?.(part)
              }}
              className="rounded px-0.5 bg-amber-500/20 text-amber-900 dark:text-amber-200 border-b border-amber-500/60 cursor-pointer font-medium hover:bg-amber-500/30 transition"
              title="点击查词"
            >
              {part}
            </span>
          )
        }
        return part
      })
    }

    return (
      <span
        key={i}
        className={
          (r.bold ? 'font-semibold ' : '') +
          (r.code ? 'rounded bg-surface px-1 font-mono text-[12px] ' : '') +
          (r.italic ? 'italic ' : '')
        }
      >
        {r.link ? (
          <span
            className="cursor-pointer text-accent underline decoration-accent/40"
            onClick={() => void window.bridge.openExternal(r.link!)}
          >
            {contentNode}
          </span>
        ) : (
          contentNode
        )}
      </span>
    )
  })
}

/** 左栏原文：按块的 kind 渲染真实结构 */
function BlockSource({
  block,
  diff,
  diffOn
}: {
  block: Block
  diff: SegmentUnknown | null
  diffOn: boolean
}): React.JSX.Element {
  const openQuickLookup = useAppStore((s) => s.openQuickLookup)

  const unknownSet = useMemo(() => {
    if (!diff || !diffOn) return new Set<string>()
    return new Set(diff.words.filter((w) => !w.known).map((w) => w.word.toLowerCase()))
  }, [diff, diffOn])

  if (block.kind === 'heading') {
    const H = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    const sizeMap: Record<number, string> = {
      1: 'text-[17px] font-bold',
      2: 'text-[15px] font-bold',
      3: 'text-[14px] font-semibold',
      4: 'text-[13px] font-semibold',
      5: 'text-[12.5px] font-semibold',
      6: 'text-[12px] font-medium'
    }
    return (
      <H className={`${sizeMap[block.level] ?? 'text-[13px] font-semibold'} text-ink-1 leading-snug select-text`}>
        {renderRuns(block.runs, diffOn, unknownSet, openQuickLookup)}
      </H>
    )
  }

  if (block.kind === 'paragraph') {
    return (
      <p className="select-text text-[13px] leading-relaxed text-ink-1 font-sans break-words">
        {renderRuns(block.runs, diffOn, unknownSet, openQuickLookup)}
      </p>
    )
  }

  if (block.kind === 'list') {
    return (
      <ul className="select-text text-[13px] leading-relaxed text-ink-1 space-y-1 ml-4 list-disc">
        {block.items.map((item, idx) => (
          <li key={idx}>
            {renderRuns(item.runs, diffOn, unknownSet, openQuickLookup)}
          </li>
        ))}
      </ul>
    )
  }

  if (block.kind === 'blockquote') {
    return (
      <blockquote className="border-l-2 border-accent/40 pl-3 italic text-[12.5px] text-ink-2 select-text">
        {renderRuns(block.runs, diffOn, unknownSet, openQuickLookup)}
      </blockquote>
    )
  }

  if (block.kind === 'table') {
    return (
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="min-w-full text-left text-[12px]">
          {block.header.length > 0 && (
            <thead className="bg-surface-alt font-medium text-ink-2">
              <tr>
                {block.header.map((cell, cIdx) => (
                  <th key={cIdx} className="border-b border-line p-2">
                    {renderRuns(cell, diffOn, unknownSet, openQuickLookup)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-line/40">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="p-2">
                    {renderRuns(cell, diffOn, unknownSet, openQuickLookup)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg bg-surface/80 p-2.5 font-mono text-[11.5px] leading-normal text-ink-1 border border-line">
        <code>{block.text}</code>
      </pre>
    )
  }

  if (block.kind === 'math') {
    return (
      <div
        className="my-1 rounded-lg bg-surface/50 p-2 text-center text-ink-1 overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: renderLatexInText(`$$${block.latex}$$`) }}
      />
    )
  }

  if (block.kind === 'image') {
    return (
      <div className="rounded-lg bg-surface-alt/40 p-2 text-center text-[11px] text-ink-3">
        [图片：{block.name}]
      </div>
    )
  }

  return <div className="text-[12px] text-ink-3">未知区块</div>
}

/** 右栏译文呈现：保留公式与 LaTeX 转换 */
function TranslationBody({ seg }: { seg: Segment }): React.JSX.Element {
  if (seg.translating && !seg.translation) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-accent py-1">
        <Loader2 size={12} className="animate-spin" />
        <span>正在翻译…</span>
      </div>
    )
  }

  if (seg.error) {
    return (
      <div className="text-[12px] text-danger">
        翻译失败：{seg.error}
      </div>
    )
  }

  if (!seg.translation) {
    return <div className="text-[12px] text-ink-3 italic select-none">未翻译</div>
  }

  // 渲染译文中的 LaTeX 公式与排版
  const html = sanitizeHtml(marked.parse(renderLatexInText(seg.translation)) as string)

  return (
    <div
      className="select-text text-[13px] leading-relaxed text-ink-1 prose prose-sm dark:prose-invert max-w-none break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** 逐句对齐行 */
function SentenceRows({
  seg
}: {
  seg: Segment
}): React.JSX.Element {
  const enSentences = useMemo(() => splitSentences(seg.text), [seg.text])
  const zhSentences = useMemo(() => (seg.translation ? splitSentences(seg.translation) : []), [seg.translation])

  return (
    <div className="space-y-2">
      {enSentences.map((en, idx) => (
        <div key={idx} className="grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6 py-1 border-b border-line/20 last:border-0">
          <p className="select-text text-[12.5px] leading-relaxed text-ink-1 font-sans">{en}</p>
          <p className="select-text text-[12.5px] leading-relaxed text-ink-2 font-sans">
            {zhSentences[idx] || (seg.translating ? '…' : '—')}
          </p>
        </div>
      ))}
    </div>
  )
}

/** 全文摘要卡片 */
function SummaryCard({
  summary,
  state,
  error
}: {
  summary: string
  state: 'idle' | 'streaming' | 'done' | 'error'
  error: string | null
}): React.JSX.Element {
  if (state === 'streaming' && !summary) {
    return (
      <div className="card p-6 text-center space-y-2 border border-line bg-card max-w-3xl mx-auto">
        <Loader2 size={24} className="animate-spin text-accent mx-auto" />
        <p className="text-[13px] font-medium text-ink-1">正在研读并提取全文核心摘要…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-4 text-[12.5px] text-danger border border-danger/30 bg-danger/10 max-w-3xl mx-auto">
        摘要生成失败：{error}
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="card p-10 text-center space-y-2 border border-line bg-card max-w-3xl mx-auto">
        <Sparkles size={28} className="text-accent mx-auto" />
        <h3 className="text-[14px] font-semibold text-ink-1">点击上方"生成摘要"提取全文核心要点</h3>
        <p className="text-[12px] text-ink-3">自动提取文献的研究背景、核心方法、实验结论与关键术语</p>
      </div>
    )
  }

  const html = sanitizeHtml(marked.parse(renderLatexInText(summary)) as string)

  return (
    <div className="card p-6 border border-line bg-card shadow-xs max-w-3xl mx-auto space-y-3 animate-float-in">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <span className="text-[14px] font-semibold text-accent flex items-center gap-1.5">
          <Sparkles size={15} /> 全文深度学术摘要
        </span>
        <button
          className="btn btn-ghost !px-2.5 !py-1 text-[11.5px] text-ink-3 hover:text-ink-1 cursor-pointer"
          onClick={() => window.bridge.copyText(summary)}
        >
          <Copy size={13} /> 复制摘要
        </button>
      </div>
      <div
        className="markdown-body select-text prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed text-ink-1 break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
