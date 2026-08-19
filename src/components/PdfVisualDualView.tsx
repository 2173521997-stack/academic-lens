import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  Volume2,
  Copy,
  Languages,
  Loader2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { DocInfo, Segment } from '../lib/types'
import { loadPdfDocument, renderPageToCanvas } from '../lib/pdfRenderer'
import type { ViewLayout } from '../stores/fileStore'
import { toast } from '../stores/noticeStore'

interface PdfVisualDualViewProps {
  doc: DocInfo
  segments: Segment[]
  viewLayout: ViewLayout
  onTranslateOne: (segId: string) => void
}

export default function PdfVisualDualView(props: PdfVisualDualViewProps): React.JSX.Element {
  const { doc, segments, viewLayout, onTranslateOne } = props
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.15)
  const [activeHoverSegId, setActiveHoverSegId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const leftScrollRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingRef = useRef(false)

  // 1. 加载 PDF 文档
  useEffect(() => {
    let alive = true
    if (!doc.rawBuffer) {
      setError('未找到 PDF 原始文件流')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    loadPdfDocument(doc.rawBuffer, doc.name)
      .then((pdf) => {
        if (alive) {
          setPdfDoc(pdf)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'PDF 加载失败')
          setLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [doc.name, doc.rawBuffer])

  // 2. 双向同步滚动 (左右视口联动)
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncingRef.current || viewLayout !== 'dual') return
    const srcEl = source === 'left' ? leftScrollRef.current : rightScrollRef.current
    const dstEl = source === 'left' ? rightScrollRef.current : leftScrollRef.current
    if (!srcEl || !dstEl) return

    isSyncingRef.current = true
    dstEl.scrollTop = srcEl.scrollTop
    dstEl.scrollLeft = srcEl.scrollLeft

    // 计算当前页码
    const pageHeight = (srcEl.scrollHeight / (pdfDoc?.numPages || 1)) || 1
    const pageIdx = Math.floor(srcEl.scrollTop / pageHeight) + 1
    setCurrentPage(Math.min(pdfDoc?.numPages || 1, Math.max(1, pageIdx)))

    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }, [pdfDoc?.numPages, viewLayout])

  // 3. 按页分组 segments
  const pageSegmentsMap = useMemo(() => {
    const map = new Map<number, Segment[]>()
    for (const seg of segments) {
      const p = seg.page || 1
      const list = map.get(p) || []
      list.push(seg)
      map.set(p, list)
    }
    return map
  }, [segments])

  const numPages = pdfDoc?.numPages || 0

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-2">
        <Loader2 size={24} className="animate-spin text-accent" />
        <span className="text-[13px] font-medium">正在解析 PDF 原版排版与高保真图表…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card max-w-md p-6 text-center text-danger border-danger/30">
          <p className="font-semibold text-[14px]">PDF 原版视图加载异常</p>
          <p className="mt-1 text-[12px] text-ink-3">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden select-none bg-surface/40">
      {/* 顶部悬浮控制条：页码、缩放比例、联动指示 */}
      <div className="flex shrink-0 items-center justify-between border-b border-line/70 bg-panel/80 px-4 py-2 backdrop-blur z-20">
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="font-semibold text-ink-1">
            第 {currentPage} / {numPages} 页
          </span>
          <span className="text-ink-3">·</span>
          <span className="text-[11px] text-ink-3">共 {segments.length} 个学术段落与图表</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            className="btn btn-ghost !p-1.5 text-ink-2 hover:text-ink-1"
            onClick={() => setScale((s) => Math.max(0.75, Number((s - 0.15).toFixed(2))))}
            title="缩小"
          >
            <ZoomOut size={14} />
          </button>
          <span className="min-w-[42px] text-center font-mono text-[11px] text-ink-2">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="btn btn-ghost !p-1.5 text-ink-2 hover:text-ink-1"
            onClick={() => setScale((s) => Math.min(2.0, Number((s + 0.15).toFixed(2))))}
            title="放大"
          >
            <ZoomIn size={14} />
          </button>
          <button
            className="btn btn-ghost !px-2 !py-1 text-[11px] text-ink-2 hover:text-ink-1"
            onClick={() => setScale(1.15)}
            title="重置为适中缩放"
          >
            适中
          </button>
        </div>
      </div>

      {/* 核心双视窗对照区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewLayout === 'dual' ? (
          <div className="grid h-full grid-cols-2 divide-x divide-line/70">
            {/* 左视窗：原版 PDF 视窗 */}
            <div
              ref={leftScrollRef}
              onScroll={() => handleScroll('left')}
              className="h-full overflow-y-auto overflow-x-auto p-6 flex flex-col items-center gap-6"
            >
              <div className="sticky top-0 z-10 rounded-full bg-panel/90 px-3 py-1 text-[11px] font-semibold text-ink-2 shadow-xs border border-line backdrop-blur">
                📖 原版英文文献 (含原始插图、公式与排版)
              </div>
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNo) => (
                <PdfPageItem
                  key={`orig-${pageNo}`}
                  pageNo={pageNo}
                  pdfDoc={pdfDoc!}
                  scale={scale}
                  segments={pageSegmentsMap.get(pageNo) || []}
                  mode="original"
                  activeHoverSegId={activeHoverSegId}
                  onHoverSeg={setActiveHoverSegId}
                  onTranslateOne={onTranslateOne}
                />
              ))}
            </div>

            {/* 右视窗：原版图表背景 + 原位中文翻译覆盖 */}
            <div
              ref={rightScrollRef}
              onScroll={() => handleScroll('right')}
              className="h-full overflow-y-auto overflow-x-auto p-6 flex flex-col items-center gap-6"
            >
              <div className="sticky top-0 z-10 rounded-full bg-accent-soft/90 px-3 py-1 text-[11px] font-semibold text-accent shadow-xs border border-accent/20 backdrop-blur">
                ✨ 原版同构中文视窗 (原图表不动 · 英文原位替换)
              </div>
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNo) => (
                <PdfPageItem
                  key={`trans-${pageNo}`}
                  pageNo={pageNo}
                  pdfDoc={pdfDoc!}
                  scale={scale}
                  segments={pageSegmentsMap.get(pageNo) || []}
                  mode="translated"
                  activeHoverSegId={activeHoverSegId}
                  onHoverSeg={setActiveHoverSegId}
                  onTranslateOne={onTranslateOne}
                />
              ))}
            </div>
          </div>
        ) : viewLayout === 'single-cn' ? (
          /* 单屏：仅看原位中文译文版 */
          <div className="h-full overflow-y-auto p-6 flex flex-col items-center gap-6">
            <div className="sticky top-0 z-10 rounded-full bg-accent-soft/90 px-3 py-1 text-[11px] font-semibold text-accent shadow-xs border border-accent/20 backdrop-blur">
              ✨ 原版同构中文译文全景
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNo) => (
              <PdfPageItem
                key={`single-trans-${pageNo}`}
                pageNo={pageNo}
                pdfDoc={pdfDoc!}
                scale={scale}
                segments={pageSegmentsMap.get(pageNo) || []}
                mode="translated"
                activeHoverSegId={activeHoverSegId}
                onHoverSeg={setActiveHoverSegId}
                onTranslateOne={onTranslateOne}
              />
            ))}
          </div>
        ) : (
          /* 单屏：仅看原版 */
          <div className="h-full overflow-y-auto p-6 flex flex-col items-center gap-6">
            <div className="sticky top-0 z-10 rounded-full bg-panel/90 px-3 py-1 text-[11px] font-semibold text-ink-2 shadow-xs border border-line backdrop-blur">
              📖 原版英文全景
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNo) => (
              <PdfPageItem
                key={`single-orig-${pageNo}`}
                pageNo={pageNo}
                pdfDoc={pdfDoc!}
                scale={scale}
                segments={pageSegmentsMap.get(pageNo) || []}
                mode="original"
                activeHoverSegId={activeHoverSegId}
                onHoverSeg={setActiveHoverSegId}
                onTranslateOne={onTranslateOne}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 单页 PDF 渲染组件：底层 Canvas + 上层原位图文覆盖层 */
const PdfPageItem = memo(function PdfPageItem(props: {
  pageNo: number
  pdfDoc: PDFDocumentProxy
  scale: number
  segments: Segment[]
  mode: 'original' | 'translated'
  activeHoverSegId: string | null
  onHoverSeg: (id: string | null) => void
  onTranslateOne: (segId: string) => void
}): React.JSX.Element {
  const { pageNo, pdfDoc, scale, segments, mode, activeHoverSegId, onHoverSeg, onTranslateOne } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 600, height: 800 })

  useEffect(() => {
    let alive = true

    pdfDoc.getPage(pageNo).then(async (page) => {
      if (!alive) return
      if (canvasRef.current) {
        const size = await renderPageToCanvas(page, canvasRef.current, scale)
        if (alive) {
          setPageSize(size)
          setRendered(true)
        }
      }
    })

    return () => {
      alive = false
    }
  }, [pageNo, pdfDoc, scale])

  return (
    <div
      className="relative rounded-xl border border-line-strong bg-card shadow-card transition-all"
      style={{
        width: `${pageSize.width}px`,
        height: `${pageSize.height}px`
      }}
    >
      {/* 1. 底层高保真 Canvas (100% 呈现所有插图、图表、线条与原版结构) */}
      <canvas ref={canvasRef} className="absolute inset-0 block rounded-xl" />

      {/* 2. 原版视窗交互探针层 */}
      {mode === 'original' && rendered && (
        <div className="absolute inset-0 pointer-events-none">
          {segments.map((seg) => {
            if (!seg.rect) return null
            const isHovered = activeHoverSegId === seg.id
            return (
              <div
                key={seg.id}
                onMouseEnter={() => onHoverSeg(seg.id)}
                onMouseLeave={() => onHoverSeg(null)}
                className={`absolute pointer-events-auto rounded-xs transition-all ${
                  isHovered
                    ? 'bg-accent/20 ring-2 ring-accent shadow-sm'
                    : 'hover:bg-accent/10'
                }`}
                style={{
                  left: `${seg.rect.x}%`,
                  top: `${seg.rect.y}%`,
                  width: `${seg.rect.width}%`,
                  height: `${seg.rect.height}%`
                }}
                title={seg.text}
              />
            )
          })}
        </div>
      )}

      {/* 3. 译文视窗原位覆盖层 (原图表不动 · 仅英文文字节点原位变中文) */}
      {mode === 'translated' && rendered && (
        <div className="absolute inset-0 pointer-events-none">
          {segments.map((seg) => {
            if (!seg.rect) return null
            const isHovered = activeHoverSegId === seg.id
            const hasTrans = !!seg.translation.trim()
            const isTranslating = seg.translating
            const isH = seg.type === 'h'

            return (
              <div
                key={seg.id}
                onMouseEnter={() => onHoverSeg(seg.id)}
                onMouseLeave={() => onHoverSeg(null)}
                className={`group absolute pointer-events-auto transition-all ${
                  hasTrans
                    ? 'bg-card/96 dark:bg-[#1e1e20]/96 shadow-xs border border-accent/20 rounded-[3px] p-1'
                    : isTranslating
                    ? 'bg-accent-soft/80 border border-accent animate-pulse rounded-[3px] p-1'
                    : 'bg-white/60 dark:bg-black/40 hover:bg-white/95 border border-dashed border-ink-3/40 rounded-[3px] p-0.5'
                } ${isHovered ? 'ring-2 ring-accent z-30 shadow-pop' : 'z-10'}`}
                style={{
                  left: `${seg.rect.x}%`,
                  top: `${seg.rect.y}%`,
                  width: `${Math.max(seg.rect.width, 15)}%`,
                  minHeight: `${seg.rect.height}%`
                }}
              >
                {hasTrans ? (
                  <div className="flex flex-col justify-between h-full select-text">
                    <p
                      className={`leading-snug text-ink-1 break-words font-serif-reading ${
                        isH ? 'font-bold text-[13px] text-accent' : 'text-[11.5px] font-medium'
                      }`}
                    >
                      {seg.translation}
                    </p>

                    {/* 悬停快捷工具条 */}
                    <div className="mt-1 hidden group-hover:flex items-center justify-between border-t border-line/60 pt-0.5 text-[10px] text-ink-3">
                      <div className="flex items-center gap-1">
                        <button
                          className="btn btn-ghost !p-0.5 hover:text-ink-1"
                          onClick={() => window.bridge.speak(seg.translation)}
                          title="朗读译文"
                        >
                          <Volume2 size={10} />
                        </button>
                        <button
                          className="btn btn-ghost !p-0.5 hover:text-ink-1"
                          onClick={() => {
                            window.bridge.copyText(seg.translation)
                            toast('success', '已复制段落译文', '剪贴板')
                          }}
                          title="复制译文"
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                      <span className="text-[9px] text-accent font-mono">
                        {isH ? '标题' : '段落'}
                      </span>
                    </div>
                  </div>
                ) : isTranslating ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-accent font-medium py-1">
                    <Loader2 size={11} className="animate-spin" />
                    <span>学术互译中…</span>
                  </div>
                ) : (
                  <button
                    onClick={() => onTranslateOne(seg.id)}
                    className="flex w-full items-center justify-center gap-1 text-[10px] text-ink-3 hover:text-accent py-0.5"
                    title="点击开始翻译此段落"
                  >
                    <Languages size={10} /> 翻译此段
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
