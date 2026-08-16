import { memo, useMemo, useState, Fragment } from 'react'
import { ArrowLeft, Download, Languages, Square, Sparkles, BookmarkPlus, Loader2, MessageSquare, Star, RefreshCw, Copy } from 'lucide-react'
import { useFileStore, type DocMode } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useAppStore } from '../stores/appStore'
import { useChatStore } from '../stores/chatStore'
import Segmented from './Segmented'
import { buildPlainText, buildPlainTextHeader } from '../lib/exportText'
import { marked } from 'marked'
import { sanitizeHtml } from '../lib/sanitize'
import type { Segment } from '../lib/types'

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

  const [exported, setExported] = useState(false)
  const [copied, setCopied] = useState(false)

  const summary = useFileStore((s) => s.summary)
  const summaryState = useFileStore((s) => s.summaryState)
  const summarize = useFileStore((s) => s.summarize)
  const stopSummarize = useFileStore((s) => s.stopSummarize)

  const untranslated = useMemo(() => segments.filter((s) => !s.translation && !s.translating && !s.error).length, [segments])
  const doneCount = segments.filter((s) => s.translation).length

  const copyAll = (): void => {
    window.bridge.copyText(buildPlainText(segments))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const exportText = async (): Promise<void> => {
    if (!doc) return
    const md = buildPlainTextHeader(doc, segments)
    const base = doc.name.replace(/\.[^.]+$/, '')
    const path = await window.bridge.saveFile({
      defaultPath: `${base}-中文译文.md`,
      data: md,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '纯文本', extensions: ['txt'] }
      ]
    })
    if (path) {
      setExported(true)
      setTimeout(() => setExported(false), 2000)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="glass z-20 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <button className="btn btn-ghost !p-2" onClick={clearDoc} title="返回">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{doc?.name}</p>
            <p className="text-[11px] text-ink-3">
              {segments.length} 段 · {doneCount}/{segments.length} 已译
              {translating && ` · ${progress.done}/${progress.total} 进行中`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {mode === 'cn' && !translating && untranslated > 0 && (
            <button className="btn btn-primary" onClick={translateAll}>
              <Languages size={13} /> 整体翻译
            </button>
          )}
          {mode === 'cn' && translating && (
            <button className="btn" onClick={stopTranslate}>
              <Square size={12} /> 停止
            </button>
          )}
          {mode === 'summary' && summaryState === 'idle' && (
            <button className="btn btn-primary" onClick={summarize}>
              <Sparkles size={13} /> 生成摘要
            </button>
          )}
          {mode === 'summary' && summaryState === 'streaming' && (
            <button className="btn" onClick={stopSummarize}>
              <Square size={12} /> 停止
            </button>
          )}
          {mode === 'cn' && (
            <button className="btn" onClick={copyAll}>
              {copied ? <Star size={13} className="text-star" /> : <Copy size={13} />}
              {copied ? '已复制' : '复制译文'}
            </button>
          )}
          <button className="btn" onClick={() => void exportText()}>
            {exported ? <Star size={13} className="text-star" /> : <Download size={13} />}
            {exported ? '已导出' : '导出译文'}
          </button>
          <Segmented<DocMode>
            items={[
              { value: 'cn', label: '中文译文' },
              { value: 'summary', label: '总结' }
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          <Loader2 size={13} />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {mode === 'cn' && <CnSplitView />}
        {mode === 'summary' && <SummaryCard summary={summary} state={summaryState} error={error} />}
      </div>
    </div>
  )
}

/** 中文译文视图：左右双栏对照（左英文原文 / 右中文译文），段落逐行对齐，PDF 按页分组 */
function CnSplitView(): React.JSX.Element {
  const segments = useFileStore((s) => s.segments)
  const translateOne = useFileStore((s) => s.translateOne)
  const addWord = useWordbookStore((s) => s.add)
  const addUserQuick = useChatStore((s) => s.addUserQuick)

  let lastPage: number | undefined

  return (
    <div className="mx-auto max-w-6xl">
      {/* 吸顶列头 */}
      <div className="sticky top-0 z-10 grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6 border-b border-line bg-panel/95 px-3 py-1.5 backdrop-blur">
        <span className="text-[11px] font-semibold tracking-wide text-ink-3">英文原文</span>
        <span className="text-[11px] font-semibold tracking-wide text-ink-3">中文译文</span>
      </div>
      {segments.map((seg, i) => {
        const pageBreak = seg.page !== undefined && seg.page !== lastPage
        lastPage = seg.page
        return (
          <Fragment key={seg.id}>
            {pageBreak && (
              <div className="mt-5 mb-1 flex items-center gap-2 first:mt-0">
                <span className="chip !bg-accent/10 !text-accent">第 {seg.page} 页</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <SplitRow
              seg={seg}
              index={i}
              translateOne={translateOne}
              addWord={addWord}
              addUserQuick={addUserQuick}
            />
          </Fragment>
        )
      })}
    </div>
  )
}

/** 双栏对照行：左栏按内容自适应（fit-content(50%)），右栏占剩余；操作条在行底文档流，hover 淡入，不与译文重叠 */
const SplitRow = memo(function SplitRow({
  seg,
  index,
  translateOne,
  addWord,
  addUserQuick
}: {
  seg: Segment
  index: number
  translateOne: (segId: string) => void
  addWord: (w: { word: string; definition: string; context?: string }) => void
  addUserQuick: (refText: string) => void
}): React.JSX.Element {
  return (
    <div
      data-page={seg.page}
      className="group grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6 border-b border-line/60 px-3 py-2.5 transition hover:bg-surface/70"
    >
      {/* 左栏：英文原文 */}
      <div className="min-w-0 select-text text-[14px] leading-[1.7] text-ink-1">
        {seg.type === 'h' ? <span className="font-semibold">{seg.text}</span> : seg.text}
      </div>
      {/* 右栏：中文译文（深灰 14px，与原文同号，醒目但不喧宾夺主） */}
      <div className="min-w-0 text-[14px] leading-[1.7] text-ink-2">
        {seg.translating ? (
          <span className="stream-caret">{seg.translation || '翻译中…'}</span>
        ) : seg.translation ? (
          <span className="select-text">{seg.translation}</span>
        ) : seg.error ? (
          <span className="text-danger">{seg.error}</span>
        ) : (
          <span className="text-ink-3/60">未翻译</span>
        )}
      </div>

      {/* 操作区：行底文档流占位，hover 淡入，绝不与译文重叠 */}
      <div className="col-span-2 mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {seg.error && (
          <button
            className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
            onClick={() => translateOne(seg.id)}
            title="重试翻译此段"
          >
            <RefreshCw size={10} /> 重试
          </button>
        )}
        {!seg.translation && !seg.translating && !seg.error && seg.type === 'p' && (
          <button className="btn btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => translateOne(seg.id)}>
            <Languages size={10} /> 翻译此段
          </button>
        )}
        <button
          className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
          onClick={() => addUserQuick(`（@${index + 1}）`)}
          title="在 AI 助手中引用此段"
        >
          <MessageSquare size={10} /> 问 AI
        </button>
        <button
          className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
          title="加入生词本"
          onClick={() => {
            const firstWord = (seg.text.match(/[A-Za-z][A-Za-z-]{2,}/) ?? [''])[0]
            if (!firstWord) return
            addWord({ word: firstWord, definition: '', context: seg.text.slice(0, 120) })
          }}
        >
          <BookmarkPlus size={10} /> 收藏
        </button>
      </div>
    </div>
  )
})

function SummaryCard({ summary, state, error }: { summary: string; state: string; error: string | null }): React.JSX.Element {
  const html = useMemo(() => sanitizeHtml(marked.parse(summary, { async: false }) as string), [summary])
  const showAsk = useAppStore((s) => s.setAssistant)
  const addUserQuick = useChatStore((s) => s.addUserQuick)

  if (state === 'idle') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Sparkles size={22} />
        </div>
        <p className="text-[15px] font-medium">一键生成摘要卡片</p>
        <p className="text-[12px] text-ink-3">摘要 · 大纲 · 核心术语表 · 重点难点句</p>
        <button className="btn btn-primary" onClick={() => useFileStore.getState().summarize()}>
          <Sparkles size={13} /> 生成摘要
        </button>
      </div>
    )
  }

  if (state === 'streaming') {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            正在生成…
          </div>
          {summary && <div className="md-body stream-caret" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    )
  }

  if (state === 'error' || !summary) {
    return <div className="mx-auto max-w-2xl py-16 text-center text-[13px] text-danger">{error ?? '生成失败'}</div>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card animate-float-in p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Sparkles size={14} className="text-accent" /> 摘要卡片
          </span>
          <button
            className="btn btn-ghost !px-3 !py-1.5 text-[12px]"
            onClick={() => {
              showAsk(true)
              addUserQuick('')
              useChatStore.getState().setInput('/总结 结合刚才的摘要卡片，深入讲解本文难点')
            }}
          >
            <MessageSquare size={12} /> 深入追问
          </button>
        </div>
        <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
