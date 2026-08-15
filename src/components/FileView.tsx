import { useMemo, useState } from 'react'
import { ArrowLeft, Download, Play, Square, Sparkles, BookmarkPlus, Loader2, MessageSquare, Star } from 'lucide-react'
import { useFileStore, type DocMode } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useAppStore } from '../stores/appStore'
import { useChatStore } from '../stores/chatStore'
import Segmented from './Segmented'
import { buildExportMd } from '../lib/exportMd'
import { marked } from 'marked'
import CnView from './CnView'

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

  const summary = useFileStore((s) => s.summary)
  const summaryState = useFileStore((s) => s.summaryState)
  const summarize = useFileStore((s) => s.summarize)
  const stopSummarize = useFileStore((s) => s.stopSummarize)

  const untranslated = useMemo(() => segments.filter((s) => !s.translation && !s.translating && !s.error).length, [segments])
  const doneCount = segments.filter((s) => s.translation).length

  const exportMd = async (): Promise<void> => {
    if (!doc) return
    const md = buildExportMd(doc, segments, summary)
    const base = doc.name.replace(/\.[^.]+$/, '')
    const path = await window.bridge.saveFile({ defaultPath: `${base}-双语对照.md`, data: md })
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
          {mode !== 'cn' && (
            <>
              {mode === 'translate' && !translating && untranslated > 0 && (
                <button className="btn btn-primary" onClick={translateAll}>
                  <Play size={13} /> 翻译全部
                </button>
              )}
              {mode === 'translate' && translating && (
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
              <button className="btn" onClick={() => void exportMd()}>
                {exported ? <Star size={13} className="text-star" /> : <Download size={13} />}
                {exported ? '已导出' : '导出 MD'}
              </button>
            </>
          )}
          <Segmented<DocMode>
            items={[
              { value: 'translate', label: '双语' },
              { value: 'cn', label: '中文译文' },
              { value: 'summary', label: '总结' },
              { value: 'qa', label: '问答' }
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
        {mode === 'translate' && <BilingualView />}
        {mode === 'cn' && <CnView segments={segments} />}
        {mode === 'summary' && <SummaryCard summary={summary} state={summaryState} error={error} />}
        {mode === 'qa' && <QAView />}
      </div>
    </div>
  )
}

function BilingualView(): React.JSX.Element {
  const segments = useFileStore((s) => s.segments)
  const translateOne = useFileStore((s) => s.translateOne)
  const addWord = useWordbookStore((s) => s.add)
  const addUserQuick = useChatStore((s) => s.addUserQuick)

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      {segments.map((seg, i) => (
        <div key={seg.id} className="card card-hover group animate-float-in p-4" style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}>
          {seg.type === 'h' ? (
            <h2 className="text-[17px] font-semibold">{seg.text}</h2>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-ink-1 select-text">{seg.text}</p>
              <div className="mt-2 border-t border-line pt-2">
                {seg.translating ? (
                  <p className="stream-caret text-[14px] leading-relaxed text-ink-2">{seg.translation || '翻译中…'}</p>
                ) : seg.translation ? (
                  <p className="select-text text-[14px] leading-relaxed text-ink-2">{seg.translation}</p>
                ) : seg.error ? (
                  <p className="text-[12px] text-danger">{seg.error}</p>
                ) : (
                  <p className="text-[12px] text-ink-3">未翻译</p>
                )}
              </div>
            </>
          )}
          <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            {!seg.translation && !seg.translating && seg.type === 'p' && (
              <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => translateOne(seg.id)}>
                <Play size={10} /> 翻译此段
              </button>
            )}
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => addUserQuick(`（@${i + 1}）`)}
              title="在 AI 助手中引用此段"
            >
              <MessageSquare size={10} /> 问 AI
            </button>
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
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
      ))}
    </div>
  )
}

function SummaryCard({ summary, state, error }: { summary: string; state: string; error: string | null }): React.JSX.Element {
  const html = useMemo(() => marked.parse(summary, { async: false }) as string, [summary])
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

function QAView(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  if (!messages.length) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-24 text-center">
        <p className="text-[15px] font-medium">基于当前文档提问</p>
        <p className="text-[12px] text-ink-3">支持 @段落编号 引用 · /总结 /翻译 /解释术语 /出题</p>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {messages.map((m) => (
        <div key={m.id} className={`card animate-msg-in p-4 ${m.role === 'user' ? '!bg-accent-soft' : ''}`}>
          {m.role === 'user' ? (
            <p className="text-[14px] font-medium select-text">{m.content}</p>
          ) : m.error ? (
            <p className="text-[13px] text-danger">{m.error}</p>
          ) : (
            <div className="md-body stream-caret" dangerouslySetInnerHTML={{ __html: marked.parse(m.content, { async: false }) as string }} />
          )}
        </div>
      ))}
    </div>
  )
}
