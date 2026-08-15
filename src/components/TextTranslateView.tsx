import { useCallback, useRef, useState } from 'react'
import { Upload, Loader2, Eraser, Send } from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { makeSegment, splitParagraphs } from '../lib/parse'
import { llmStream } from '../lib/llm'
import { recognizeClipboardImage } from '../lib/ocr'
import Segmented from './Segmented'

type Mode = 'segment' | 'whole'

const SYS_WHOLE =
  '你是专业学术翻译。将用户提供的英文内容翻译为简体中文，保持学术语气、术语准确。' +
  '必须保留原文的段落结构：段落之间用空行分隔，不要合并或拆分段落，不要输出任何解释。'

export default function TextTranslateView(): React.JSX.Element {
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
              .map((b) => b.trim())
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
      if (t) setText((old) => (old ? `${old}\n\n${t}` : t))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcrBusy(false)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="text-[17px] font-semibold">文本翻译</h1>
        <div className="flex items-center gap-2">
          <Segmented<Mode>
            items={[
              { value: 'segment', label: '分段翻译' },
              { value: 'whole', label: '整体翻译' }
            ]}
            value={mode}
            onChange={setMode}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> 上传 .txt/.md
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
          <button className="btn" onClick={() => { setText(''); setStreamOut(''); setError(null) }}>
            <Eraser size={13} /> 清空
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-2">英文原文</span>
              {ocrBusy && (
                <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  <Loader2 size={12} className="animate-spin" /> OCR 提取中…
                </span>
              )}
            </div>
            <textarea
              className="input min-h-[220px] resize-none !text-[14px] leading-relaxed"
              placeholder={
                mode === 'segment'
                  ? '粘贴或输入英文，可上传 .txt/.md，也可直接在此 Ctrl+V 粘贴截图自动提取文字…'
                  : '整体翻译：粘贴全文，一次流式输出，段落结构保持…'
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
            {mode === 'whole' && streaming && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-[12px] font-medium text-ink-2">中文译文（流式）</p>
                <div className="select-text whitespace-pre-wrap rounded-xl bg-surface p-3 text-[13px] leading-relaxed text-ink-1 stream-caret">
                  {streamOut || '…'}
                </div>
              </div>
            )}
            {error && (
              <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-ink-3">
              {mode === 'segment'
                ? '分段翻译：按段落逐段流式翻译，段落严格对齐，完成后进入对照视图'
                : '整体翻译：一次流式输出全文译文，完成后进入中文译文档位'}
            </p>
            <button
              className="btn btn-primary"
              disabled={!text.trim() || streaming}
              onClick={translate}
            >
              {streaming ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {mode === 'segment' ? '开始分段翻译' : '开始整体翻译'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
