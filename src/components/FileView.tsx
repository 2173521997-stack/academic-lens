import { memo, useMemo, useState, Fragment } from 'react'
import { ArrowLeft, Download, Languages, Square, Sparkles, BookmarkPlus, Loader2, MessageSquare, Star, RefreshCw, Copy, Highlighter, Image, Layers, BookOpen } from 'lucide-react'
import { useFileStore, type DocMode } from '../stores/fileStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useAppStore } from '../stores/appStore'
import { useAgentStore } from '../stores/agentStore'
import { useSettingsStore, DOMAIN_LABELS, type DomainPreset } from '../stores/settingsStore'
import { toast } from '../stores/noticeStore'
import Segmented from './Segmented'
import { buildPlainText, buildPlainTextHeader, buildBilingualMarkdown, buildDocxBase64 } from '../lib/exportText'
import { analyzeUnknownWords, type SegmentUnknown } from '../lib/unknownWords'
import { parseInlineMarkdown, splitSentences } from '../lib/inline'
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
  const docDomain = useFileStore((s) => s.docDomain)
  const setDocDomain = useFileStore((s) => s.setDocDomain)
  const translating = segments.some((s) => s.translating)

  const [exported, setExported] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportFormat, setExportFormat] = useState<'plain' | 'bilingual' | 'docx'>('plain')

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
    const base = doc.name.replace(/\.[^.]+$/, '')
    try {
      if (exportFormat === 'docx') {
        const b64 = await buildDocxBase64(segments)
        const path = await window.bridge.saveBuffer({
          defaultPath: `${base}-双语对照.docx`,
          dataB64: b64,
          filters: [{ name: 'Word 文档', extensions: ['docx'] }]
        })
        if (path) flashExported()
        return
      }
      const md =
        exportFormat === 'bilingual' ? buildBilingualMarkdown(doc, segments) : buildPlainTextHeader(doc, segments)
      const path = await window.bridge.saveFile({
        defaultPath: `${base}-${exportFormat === 'bilingual' ? '双语对照' : '中文译文'}.md`,
        data: md,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '纯文本', extensions: ['txt'] }
        ]
      })
      if (path) flashExported()
    } catch {
      /* 导出失败静默（用户可重试） */
    }
  }

  const flashExported = (): void => {
    setExported(true)
    setTimeout(() => setExported(false), 2000)
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
          <select
            className="input !w-auto !px-2 !py-1.5 text-[11px]"
            value={docDomain ?? ''}
            title="本文档特化翻译领域；选「跟随设置」时用全局领域预设"
            onChange={(e) => setDocDomain(e.target.value === '' ? null : (e.target.value as DomainPreset))}
          >
            <option value="">特化：跟随设置</option>
            {(Object.keys(DOMAIN_LABELS) as DomainPreset[]).map((k) => (
              <option key={k} value={k}>
                {DOMAIN_LABELS[k]}
              </option>
            ))}
          </select>
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
          <div className="flex items-center gap-1">
            <select
              className="input !h-7 !w-auto !px-2 text-[11px]"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'plain' | 'bilingual' | 'docx')}
              title="导出格式"
            >
              <option value="plain">译文 MD</option>
              <option value="bilingual">双语对照 MD</option>
              <option value="docx">双语对照 DOCX</option>
            </select>
            <button className="btn" onClick={() => void exportText()}>
              {exported ? <Star size={13} className="text-star" /> : <Download size={13} />}
              {exported ? '已导出' : '导出'}
            </button>
          </div>
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

/** 中文译文视图：左右双栏对照（左英文原文 / 右中文译文），段落逐行对齐，PDF 按页分组，可高亮生词 */
function CnSplitView(): React.JSX.Element {
  const segments = useFileStore((s) => s.segments)
  const translateOne = useFileStore((s) => s.translateOne)
  const addWord = useWordbookStore((s) => s.add)
  const addUserQuick = useAgentStore((s) => s.appendInput)
  const wordbookCount = useWordbookStore((s) => s.words.length)

  const [diffOn, setDiffOn] = useState(false)
  const [sentenceOn, setSentenceOn] = useState(false)
  const readerFont = useSettingsStore((s) => s.settings.readerFont)
  const toggleReaderFont = (): void => {
    useSettingsStore.getState().update({ readerFont: readerFont === 'serif' ? 'sans' : 'serif' })
  }

  const diff = useMemo(() => (diffOn ? analyzeUnknownWords(segments) : null), [diffOn, segments, wordbookCount])

  /** 本篇生词一键入生词本（带首次出现语境句），返回新增数 */
  const addAllUnknown = (): number => {
    if (!diff) return 0
    const st = useFileStore.getState()
    const items = diff.unknownWords.map((w) => {
      let context = ''
      for (const s of st.segments) {
        const idx = s.text.toLowerCase().indexOf(w)
        if (idx >= 0) {
          context = s.text.slice(Math.max(0, idx - 48), idx + 96).replace(/\s+/g, ' ').trim()
          break
        }
      }
      return { word: w, definition: '', context }
    })
    return useWordbookStore.getState().addMany(items)
  }

  const batchAdd = (): void => {
    if (!diff) return
    const n = addAllUnknown()
    toast('success', n > 0 ? `已将 ${n} 个生词加入生词本` : '没有新的生词可加入（都已收藏）', '本篇生词')
  }

  const goFlashcard = (): void => {
    useAppStore.getState().go('flashcard')
  }

  let lastPage: number | undefined

  return (
    <div className={`mx-auto max-w-6xl ${readerFont === 'serif' ? 'reader-serif' : ''}`}>
      {/* 生词高亮开关 + 命中率条 */}
      <div className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-1.5">
          <button
            className={`btn !px-2.5 !py-1 text-[11px] ${diffOn ? '!border-accent !bg-accent/10 !text-accent' : ''}`}
            onClick={() => setDiffOn((v) => !v)}
            title="对照生词本，高亮原文中未收藏的单词"
          >
            <Highlighter size={11} /> {diffOn ? '隐藏生词' : '标出生词'}
          </button>
          <button
            className={`btn !px-2.5 !py-1 text-[11px] ${sentenceOn ? '!border-accent !bg-accent/10 !text-accent' : ''}`}
            onClick={() => setSentenceOn((v) => !v)}
            title="段落内按句子拆分为双语对照行"
          >
            <Languages size={11} /> {sentenceOn ? '逐段' : '逐句'}
          </button>
          <button
            className={`btn !px-2.5 !py-1 text-[11px] ${readerFont === 'serif' ? '!border-accent !bg-accent/10 !text-accent' : ''}`}
            onClick={toggleReaderFont}
            title="切换衬线 / 无衬线字体"
          >
            {readerFont === 'serif' ? <BookOpen size={11} /> : <BookOpen size={11} />} {readerFont === 'serif' ? '衬线' : '无衬线'}
          </button>
          {diff && (
            <>
              <span className="flex items-center gap-1 text-[11px] text-ink-2">
                <span className="chip !text-[10px]">生词 {diff.totalUnknown}</span>
                <span className="text-ink-3">已认识命中率 {diff.hitRate}% · 对标生词本 {wordbookCount} 词</span>
              </span>
              {diff.totalUnknown > 0 && (
                <span className="flex items-center gap-1">
                  <button className="btn !px-2.5 !py-1 text-[11px]" onClick={batchAdd} title="把本篇全部未收藏生词（含语境句）加入生词本">
                    <BookmarkPlus size={11} /> 本篇生词入本
                  </button>
                  <button className="btn !px-2.5 !py-1 text-[11px]" onClick={goFlashcard} title="去闪卡复习">
                    <Layers size={11} /> 去闪卡背
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 吸顶列头 */}
      <div className="sticky top-[34px] z-10 grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6 border-b border-line bg-panel/95 px-3 py-1.5 backdrop-blur">
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

/** 双栏对照行：按块模型渲染；段落块可在逐句模式拆成句子行 */
const SplitRow = memo(function SplitRow({
  seg,
  index,
  translateOne,
  addWord,
  addUserQuick,
  diff,
  diffOn,
  sentenceOn
}: {
  seg: Segment
  index: number
  translateOne: (segId: string) => void
  addWord: (w: { word: string; definition: string; context?: string }) => void
  addUserQuick: (refText: string) => void
  diff: SegmentUnknown | null
  diffOn: boolean
  sentenceOn: boolean
}): React.JSX.Element {
  const block = seg.block
  const kind = block.kind

  const showTranslateAction = !seg.translation && !seg.translating && !seg.error

  return (
    <div
      data-page={seg.page}
      className="group border-b border-line/60 px-3 py-2.5 transition hover:bg-surface/70"
      data-kind={kind}
    >
      {kind === 'paragraph' && sentenceOn ? (
        <SentenceRows seg={seg} diff={diff} diffOn={diffOn} />
      ) : (
        <div className="grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6">
          {/* 左栏：原文（按块类型渲染） */}
          <BlockSource
            block={block}
            diff={diff}
            diffOn={diffOn}
            sortClass=""
          />
          {/* 右栏：译文（同样按块对齐渲染） */}
          <TranslationBody seg={seg} block={block} />
        </div>
      )}

      {/* 操作区：行底文档流占位，hover 淡入，绝不与译文重叠 */}
      <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {seg.error && (
          <button
            className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
            onClick={() => translateOne(seg.id)}
            title="重试翻译此段"
          >
            <RefreshCw size={10} /> 重试
          </button>
        )}
        {showTranslateAction && seg.type === 'p' && (
          <button className="btn btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => translateOne(seg.id)}>
            <Languages size={10} /> 翻译此段
          </button>
        )}
        {showTranslateAction && seg.type === 'table' && (
          <button className="btn btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => translateOne(seg.id)}>
            <Languages size={10} /> 翻译此表
          </button>
        )}
        <button
          className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
          onClick={() => {
            addUserQuick(`（@${index + 1}）`)
            useAppStore.getState().go('agent')
          }}
          title="在 AI 助手中引用此段"
        >
          <MessageSquare size={10} /> 问 AI
        </button>
        {kind !== 'image' && kind !== 'math' && kind !== 'code' && (
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
        )}
      </div>
    </div>
  )
})

/** 渲染一行 Inline */
function renderRuns(runs: Inline[]): React.ReactNode {
  return runs.map((r, i) => (
    <span
      key={i}
      className={
        (r.bold ? 'font-semibold ' : '') +
        (r.code ? 'rounded bg-surface px-1 font-mono text-[13px] ' : '') +
        (r.italic ? 'italic ' : '')
      }
    >
      {r.link ? (
        <span
          className="cursor-pointer text-accent underline decoration-accent/40"
          onClick={() => void window.bridge.openExternal(r.link!)}
        >
          {r.text}
        </span>
      ) : (
        r.text
      )}
    </span>
  ))
}

/** 左栏原文：按块的 kind 渲染真实结构 */
function BlockSource({
  block,
  diff,
  diffOn,
  sortClass
}: {
  block: Block
  diff: SegmentUnknown | null
  diffOn: boolean
  sortClass: string
}): React.JSX.Element {
  const plain = blockToPlain(block)
  const applyDiff = (text: string): React.ReactNode =>
    diff && diffOn ? highlightSource(text, diff) : text

  if (block.kind === 'heading')
    return (
      <div className={`min-w-0 select-text text-[15px] font-semibold leading-[1.6] text-ink-1 ${sortClass}`}>
        {applyDiff(plain)}
      </div>
    )

  if (block.kind === 'list') {
    return (
      <div className="min-w-0 select-text text-[14px] leading-[1.7] text-ink-1">
        <ul className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
          {block.items.map((it, i) => (
            <li key={i}>{renderRuns(it.runs)}</li>
          ))}
        </ul>
      </div>
    )
  }

  if (block.kind === 'table') {
    const maxCols = Math.max(block.header.length, ...block.rows.map((r) => r.length))
    return (
      <div className="min-w-0 overflow-x-auto rounded-lg border border-line/70">
        <table className="w-full border-collapse text-[13px] leading-relaxed">
          <thead>
            <tr className="bg-surface/80">
              {Array.from({ length: maxCols }).map((_, c) => (
                <th key={c} className="border-b border-line/70 px-2 py-1 text-left font-semibold text-ink-2">
                  {block.header[c] ? renderRuns(block.header[c]) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="odd:bg-surface/40">
                {Array.from({ length: maxCols }).map((_, c) => (
                  <td key={c} className="border-b border-line/60 px-2 py-1 text-ink-1">
                    {row[c] ? renderRuns(row[c]) : ''}
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
      <pre className="min-w-0 select-text overflow-x-auto rounded-lg bg-[#1d1d1f]/5 p-3 font-mono text-[13px] leading-relaxed text-ink-1">
        <code>{block.text}</code>
      </pre>
    )
  }

  if (block.kind === 'blockquote') {
    return (
      <blockquote className="min-w-0 select-text border-l-4 border-accent/30 pl-3 text-[14px] leading-[1.7] text-ink-1">
        {block.runs.length ? renderRuns(block.runs) : applyDiff(plain)}
      </blockquote>
    )
  }

  if (block.kind === 'image') {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-line bg-surface/40 px-3 py-2 text-[13px] text-ink-2">
        <Image size={14} className="text-ink-3" /> <span className="truncate">{block.name}</span>
        <span className="chip !text-[10px]">图片 · 不翻译</span>
      </div>
    )
  }

  if (block.kind === 'math') {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-line bg-surface/40 px-3 py-2 font-mono text-[13px] text-ink-1">
        <span>{block.latex}</span>
        <span className="chip !text-[10px]">公式</span>
      </div>
    )
  }

  // paragraph
  return <div className="min-w-0 select-text text-[14px] leading-[1.7] text-ink-1">{renderRuns(block.runs)}</div>
}

/** 右栏译文：若为表格块且译文含 | 分隔，则还原为表格；否则按行内标记渲染 */
function TranslationBody({ seg, block }: { seg: Segment; block: Block }): React.JSX.Element {
  const container = 'min-w-0 text-[14px] leading-[1.7]'

  if (seg.translating) {
    return (
      <div className={`${container} text-ink-1`}>
        <span className="stream-caret">{seg.translation ? renderMarkup(seg.translation) : '翻译中…'}</span>
      </div>
    )
  }
  if (seg.error) return <div className={`${container} text-danger`}>{seg.error}</div>
  if (!seg.translation) return <div className={`${container} text-ink-3/60`}>未翻译</div>

  // 表格：译文应保持 | 分隔结构 → 还原为表格行
  if ((block.kind === 'table' || block.kind === 'paragraph') && seg.translation.includes(' | ')) {
    const rows = seg.translation
      .trim()
      .split('\n')
      .filter((l) => l.includes(' | '))
      .map((l) => l.split(/\s*\|\s*/).map((c) => c.trim()))
      .filter((r) => r.length > 0)
    if (rows.length) {
      return (
        <div className="min-w-0 overflow-x-auto rounded-lg border border-line/70">
          <table className="w-full border-collapse text-[13px] leading-relaxed">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="odd:bg-surface/40">
                  {row.map((c, ci) => (
                    <td key={ci} className="border-b border-line/60 px-2 py-1 text-ink-1">
                      {renderMarkup(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }

  return <div className={`${container} text-ink-1`}>{renderMarkup(seg.translation)}</div>
}

/** 逐句模式：段落按句子拆成多行双语行（尽力按序号对齐） */
function SentenceRows({
  seg,
  diff,
  diffOn
}: {
  seg: Segment
  diff: SegmentUnknown | null
  diffOn: boolean
}): React.JSX.Element {
  const srcSentences = splitSentences(seg.text)
  const dstSentences = seg.translation ? splitSentences(seg.translation) : []
  const count = Math.max(srcSentences.length, dstSentences.length)

  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-6">
          <div className="min-w-0 select-text text-[14px] leading-[1.7] text-ink-1">
            <span className="mr-1 text-[11px] text-ink-3">({i + 1})</span>
            {diff && diffOn ? (
              highlightSource(srcSentences[i] ?? '', diff)
            ) : (
              renderMarkup(srcSentences[i] ?? '')
            )}
          </div>
          <div className="min-w-0 text-[14px] leading-[1.7] text-ink-1">
            {seg.translating ? (
              <span className="stream-caret">{dstSentences[i] ?? ''}</span>
            ) : (
              renderMarkup(dstSentences[i] ?? '')
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 渲染译文行内标记（** * `） */
function renderMarkup(text: string): React.ReactNode {
  const runs = parseInlineMarkdown(text)
  return runs.map((r, i) => (
    <span
      key={i}
      className={
        (r.bold ? 'font-semibold ' : '') +
        (r.code ? 'rounded bg-surface px-1 font-mono text-[13px] ' : '') +
        (r.italic ? 'italic ' : '')
      }
    >
      {r.text}
    </span>
  ))
}

/** 块 → 平铺文本（供生词高亮回退） */
function blockToPlain(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'blockquote':
      return block.runs.map((r) => r.text).join('')
    case 'list':
      return block.items.map((it, i) => (block.ordered ? `${i + 1}.` : '•') + ' ' + it.runs.map((r) => r.text).join('')).join(' ')
    case 'table':
    case 'code':
    case 'image':
    case 'math':
      return ''
  }
}

function highlightSource(text: string, diff: SegmentUnknown): React.ReactNode {
  if (!diff.ranges?.length) return text
  const nodes: React.ReactNode[] = []
  let last = 0
  for (const r of diff.ranges) {
    if (r.start > last) nodes.push(text.slice(last, r.start))
    nodes.push(
      <mark key={r.start} className="bg-yellow-200/70 text-ink-1 rounded px-0.5">
        {text.slice(r.start, r.end)}
      </mark>
    )
    last = r.end
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function SummaryCard({ summary, state, error }: { summary: string; state: string; error: string | null }): React.JSX.Element {

  const html = useMemo(() => sanitizeHtml(marked.parse(summary, { async: false }) as string), [summary])

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
              useAgentStore.getState().setInput('/总结 结合刚才的摘要卡片，深入讲解本文难点')
              useAppStore.getState().go('agent')
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
