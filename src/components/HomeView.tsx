import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  Image as ImageIcon,
  Upload,
  FolderOpen,
  ImageUp,
  Loader2,
  AlertTriangle,
  Send,
  Eraser,
  Sparkles
} from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { isSupported } from '../lib/types'
import { parseAnyFile, makeSegment, splitParagraphs } from '../lib/parse'
import { recognizeClipboardImage, fileToDataUrl } from '../lib/ocr'
import FileView from './FileView'
import Segmented from './Segmented'

type InputTab = 'file' | 'text' | 'image'

interface ImgTask {
  preview: string
  lines: string[]
  name: string
  error: string | null
}

export default function HomeView(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const setDoc = useFileStore((s) => s.setDoc)

  const [tab, setTab] = useState<InputTab>('file')
  const [drag, setDrag] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 文本模式状态
  const [textInput, setTextInput] = useState('')
  const textFileRef = useRef<HTMLInputElement>(null)

  // 图片模式状态
  const [imgTask, setImgTask] = useState<ImgTask | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)

  // 1. 处理文件打开
  const openDocFiles = useCallback(async (files?: FileList | File[]): Promise<void> => {
    let fileList: File[] = []
    if (files && files.length) {
      fileList = Array.from(files)
    } else {
      const paths = await window.bridge.openFiles()
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() ?? p
        if (!isSupported(name)) continue
        setOpening(true)
        setError(null)
        try {
          const data = await window.bridge.readFile(p)
          const segs = await parseAnyFile(name, data)
          setDoc({ name, size: data.byteLength }, segs)
          return
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setOpening(false)
        }
      }
      return
    }

    const f = fileList.find((x) => isSupported(x.name))
    if (!f) return
    setOpening(true)
    setError(null)
    try {
      const buf = await f.arrayBuffer()
      const segs = await parseAnyFile(f.name, new Uint8Array(buf))
      setDoc({ name: f.name, size: f.size }, segs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }, [setDoc])

  // 2. 处理图片 OCR
  const runOcr = useCallback(async (file: Blob, name: string): Promise<void> => {
    setOcrBusy(true)
    setError(null)
    try {
      const preview = await fileToDataUrl(file, 480)
      const { lines } = await recognizeClipboardImage(file)
      setImgTask({ preview, lines, name, error: null })
    } catch (err) {
      setImgTask({
        preview: '',
        lines: [],
        name,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setOcrBusy(false)
    }
  }, [])

  // 3. 从文本进入双栏翻译
  const handleStartTextTranslate = useCallback((): void => {
    const raw = textInput.trim()
    if (!raw) return
    const paras = splitParagraphs(raw)
    if (!paras.length) return
    const segs = paras.map((p) => makeSegment('p', p))
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
    setDoc({ name: `文本片段-${ts}.txt`, size: raw.length }, segs)
    useFileStore.getState().translateAll()
  }, [textInput, setDoc])

  // 4. 从图片 OCR 结果进入双栏翻译
  const handleStartImageTranslate = useCallback((): void => {
    if (!imgTask || !imgTask.lines.length) return
    const segs = imgTask.lines.map((line) => makeSegment('p', line))
    if (!segs.length) return
    setDoc({ name: imgTask.name, size: 0 }, segs)
    setImgTask(null)
    useFileStore.getState().translateAll()
  }, [imgTask, setDoc])

  // 全局剪贴板粘贴图片与文字
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (doc) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            setTab('image')
            void runOcr(file, `截图-${ts}.png`)
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [doc, runOcr])

  // 若已有文档，直接呈现双栏工作台
  if (doc) return <FileView />

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 sm:p-8 overflow-y-auto bg-surface select-none">
      <div className="w-full max-w-xl space-y-4">
        {/* 顶部三模态切换卡片 */}
        <div className="card flex flex-col gap-4 border border-line p-6 shadow-xs bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink-1 tracking-tight">翻译工作台</h2>
              <span className="text-[11.5px] text-ink-3">选择输入方式并开始双栏精读</span>
            </div>

            <Segmented<InputTab>
              items={[
                { value: 'file', label: '文件' },
                { value: 'text', label: '文本' },
                { value: 'image', label: '图片' }
              ]}
              value={tab}
              onChange={(t) => {
                setTab(t)
                setError(null)
              }}
            />
          </div>

          {/* ================= 模式 1：文件上传 ================= */}
          {tab === 'file' && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                if (e.dataTransfer.files.length) void openDocFiles(e.dataTransfer.files)
              }}
              onClick={() => void openDocFiles()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3.5 rounded-2xl border-2 border-dashed p-8 transition ${
                drag
                  ? 'border-accent bg-accent-soft'
                  : 'border-line hover:border-accent/40 hover:bg-surface/80'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                {opening ? (
                  <Loader2 size={24} className="animate-spin text-accent" />
                ) : (
                  <FileText size={24} strokeWidth={1.5} />
                )}
              </div>
              <div className="text-center">
                <p className="text-[14px] font-medium text-ink-1">
                  {opening ? '正在解析文档结构…' : '拖放文档到此处，或点击浏览'}
                </p>
                <p className="mt-1 text-[11.5px] text-ink-3">
                  支持 PDF、Word (.docx)、EPUB、Markdown、TXT、HTML、MOBI 等
                </p>
              </div>
              <button
                className="btn btn-primary mt-1"
                onClick={(e) => {
                  e.stopPropagation()
                  void openDocFiles()
                }}
              >
                <FolderOpen size={13} strokeWidth={1.5} /> 选择本地文件…
              </button>
            </div>
          )}

          {/* ================= 模式 2：纯文本粘贴 ================= */}
          {tab === 'text' && (
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  className="input min-h-[160px] max-h-[36vh] resize-y !text-[13px] leading-relaxed p-3.5 select-text"
                  placeholder="在此粘贴或输入英文段落，或按 Ctrl/Cmd+V 粘贴截图提取文字…"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between border-t border-line/60 pt-2.5">
                <div className="flex items-center gap-1.5">
                  <button
                    className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
                    onClick={() => textFileRef.current?.click()}
                    title="上传 .txt 或 .md 文件"
                  >
                    <Upload size={13} strokeWidth={1.5} />
                  </button>
                  <input
                    ref={textFileRef}
                    type="file"
                    hidden
                    accept=".txt,.md,.markdown"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void f.text().then((t) => setTextInput(t))
                      e.target.value = ''
                    }}
                  />
                  {textInput && (
                    <button
                      className="btn btn-ghost !p-1.5 text-ink-3 hover:text-ink-1"
                      onClick={() => setTextInput('')}
                      title="清空文本"
                    >
                      <Eraser size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  disabled={!textInput.trim()}
                  onClick={handleStartTextTranslate}
                >
                  <Send size={13} strokeWidth={1.5} />
                  <span>进入双栏翻译</span>
                </button>
              </div>
            </div>
          )}

          {/* ================= 模式 3：图片 OCR ================= */}
          {tab === 'image' && (
            <div className="space-y-3">
              {!imgTask ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDrag(true)
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDrag(false)
                    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
                    if (f) void runOcr(f, f.name)
                  }}
                  onClick={() => imgInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 transition ${
                    drag
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:border-accent/40 hover:bg-surface/80'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                    {ocrBusy ? (
                      <Loader2 size={24} className="animate-spin text-accent" />
                    ) : (
                      <ImageIcon size={24} strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-[14px] font-medium text-ink-1">
                      {ocrBusy ? '正在识别与提取图片文字…' : '粘贴截图或选择图片'}
                    </p>
                    <p className="mt-1 text-[11.5px] text-ink-3">
                      按 Ctrl/Cmd+V 粘贴截图，支持 PNG、JPG、WebP 格式
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        imgInputRef.current?.click()
                      }}
                    >
                      <ImageUp size={13} strokeWidth={1.5} /> 选择图片…
                    </button>
                  </div>
                  <input
                    ref={imgInputRef}
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void runOcr(f, f.name)
                      e.target.value = ''
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-[140px_1fr] gap-3 rounded-xl border border-line bg-surface/50 p-3">
                    <div className="overflow-hidden rounded-lg border border-line bg-card max-h-32 flex items-center justify-center">
                      <img src={imgTask.preview} alt="预览" className="h-full w-full object-contain" />
                    </div>
                    <div className="max-h-32 overflow-y-auto font-mono text-[12px] leading-relaxed text-ink-2 select-text">
                      {imgTask.lines.join('\n') || '未检测到文字'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-line/60 pt-2">
                    <button
                      className="btn btn-ghost !px-2.5 !py-1 text-[11.5px] text-ink-3 hover:text-ink-1"
                      onClick={() => setImgTask(null)}
                    >
                      重新选择
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={!imgTask.lines.length}
                      onClick={handleStartImageTranslate}
                    >
                      <Sparkles size={13} strokeWidth={1.5} />
                      <span>进入双栏翻译 ({imgTask.lines.length} 行)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 p-3 text-[12px] text-danger border border-danger/30">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center justify-center gap-4 text-[11px] text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">⌘K</kbd> 快速查词
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">⌘⇧M</kbd> 桌面小窗
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">⌘⇧A</kbd> AI 助手
          </span>
        </div>
      </div>
    </div>
  )
}
