import React, { useCallback, useRef, useState } from 'react'
import {
  Upload,
  Loader2,
  Eraser,
  Send,
  Type,
  Sparkles
} from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { useAppStore } from '../stores/appStore'
import { makeSegment, splitParagraphs } from '../lib/parse'
import { llmStream } from '../lib/llm'
import { recognizeClipboardImage } from '../lib/ocr'
import Segmented from './Segmented'

type Mode = 'segment' | 'whole'

const SYS_WHOLE =
  '你是专业学术翻译。将用户提供的英文内容翻译为简体中文，保持学术语气、术语准确。' +
  '必须保留原文的段落结构：段落之间用空行分隔，不要合并或拆分段落，不要输出任何解释。'

export default function TextTranslateView(): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('segment')
  const [streaming, setStreaming] = useState(false)
  const [streamOut, setStreamOut] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamOutRef = useRef('')

  const setDoc = useFileStore((s) => s.setDoc)
  const setFileMode = useFileStore((s) => s.setMode)

  const runSegment = useCallback(
    (content: string): void => {
      const paras = splitParagraphs(content)
      if (!paras.length) return
      const segs = paras.map((p) => makeSegment('p', p))
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
      setDoc({ name: `文本-${ts}.txt`, size: content.length }, segs)
      useFileStore.getState().translateAll()
    },
    [setDoc]
  )

  const runWhole = useCallback(
    (content: string): void => {
      const paras = splitParagraphs(content)
      if (!paras.length) return
      setStreaming(true)
      setError(null)
      setStreamOut('')
      llmStream(
        [
          { role: 'system', content: SYS_WHOLE },
          { role: 'user', content }
        ],
        {
          onChunk: (d) => {
            streamOutRef.current += d
            setStreamOut(streamOutRef.current)
          },
          onDone: () => {
            setStreaming(false)
            const blocks = streamOutRef.current
              .split(/\n\s*\n+/)
              .map((b: string) => b.trim())
              .filter(Boolean)
            const segs = paras.map((p, i) => {
              const seg = makeSegment('p', p)
              seg.translation = blocks[i] ?? ''
              return seg
            })
            if (blocks.length > paras.length) {
              const extra = blocks.slice(paras.length - 1).join('\n\n')
              segs[segs.length - 1].translation = extra
            }
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            setDoc({ name: `文本-${ts}.txt`, size: content.length }, segs)
            setFileMode('cn')
          },
          onError: (m) => {
            setStreaming(false)
            setError(m)
          }
        }
      )
    },
    [setDoc, setFileMode]
  )

  const translate = (): void => {
    const t = text.trim()
    if (!t || streaming) return
    if (mode === 'segment') runSegment(t)
    else runWhole(t)
  }

  const onPasteImage = useCallback(async (file: Blob): Promise<void> => {
    setOcrBusy(true)
    setError(null)
    try {
      const { lines } = await recognizeClipboardImage(file)
      const t = lines.join('\n')
      if (t) setText((old: string) => (old ? `${old}\n\n${t}` : t))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcrBusy(false)
    }
  }, [])

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 sm:p-8 overflow-y-auto bg-surface">
      <div className="w-full max-w-xl space-y-4 text-center">
        {/* 统一卡片 */}
        <div className="card flex flex-col gap-3.5 border border-line p-5 sm:p-6 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Type size={16} strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-ink-1 tracking-tight">文本翻译</h2>
                <p className="text-[11.5px] text-ink-3">分段对照或全文连续翻译</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <div className="shrink-0">
                <Segmented<Mode>
                  items={[
                    { value: 'segment', label: '分段翻译' },
                    { value: 'whole', label: '全文翻译' }
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              </div>
              <button
                className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1 shrink-0"
                onClick={() => fileRef.current?.click()}
                title="导入文稿…"
              >
                <Upload size={13} strokeWidth={1.5} />
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".txt,.md,.markdown"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void f.text().then((t) => setText(t))
                  e.target.value = ''
                }}
              />
              {text && (
                <button
                  className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
                  onClick={() => {
                    setText('')
                    setStreamOut('')
                    setError(null)
                  }}
                  title="清空"
                >
                  <Eraser size={13} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <textarea
              className="input min-h-[160px] max-h-[38vh] resize-y !text-[13px] leading-relaxed p-3"
              placeholder={
                mode === 'segment'
                  ? '输入或粘贴英文内容，或按 ⌘V / Ctrl+V 粘贴截图提取文字…'
                  : '全文翻译模式：连续流式输出全文译文…'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                for (const it of Array.from(e.clipboardData?.items ?? [])) {
                  if (it.type.startsWith('image/')) {
                    const f = it.getAsFile()
                    if (f) {
                      e.preventDefault()
                      void onPasteImage(f)
                    }
                    break
                  }
                }
              }}
            />
            {ocrBusy && (
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-md bg-surface/95 px-2 py-0.5 text-[10.5px] text-ink-2 border border-line">
                <Loader2 size={11} strokeWidth={1.5} className="animate-spin text-accent" /> 识别中…
              </div>
            )}
          </div>

          {mode === 'whole' && streaming && (
            <div className="rounded-xl border border-line bg-surface/70 p-3">
              <div className="mb-1 text-[11px] font-semibold text-accent flex items-center gap-1">
                <Sparkles size={12} strokeWidth={1.5} /> 全文译文
              </div>
              <div className="select-text whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1 stream-caret">
                {streamOut || '…'}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-[12px] text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line pt-2.5">
            <span className="text-[11px] text-ink-3">
              {mode === 'segment'
                ? '逐段流式翻译与对齐，完成后进入双语对照'
                : '单次流式输出全文译文'}
            </span>
            <button
              className="btn btn-primary"
              disabled={!text.trim() || streaming}
              onClick={translate}
            >
              {streaming ? (
                <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
              ) : (
                <Send size={13} strokeWidth={1.5} />
              )}
              <span>开始翻译</span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 text-[11px] text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">{isMac ? '⌘V' : 'Ctrl+V'}</kbd> 粘贴文字或截图
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">{isMac ? '⌘K' : 'Ctrl+K'}</kbd> 快速查词
          </span>
        </div>
      </div>
    </div>
  )
}

