import { useCallback, useEffect, useRef, useState } from 'react'
import { UploadCloud, FolderOpen, ImagePlus, Loader2, AlertTriangle, Wand2, X } from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { isSupported } from '../lib/types'
import { parseAnyFile, makeSegment } from '../lib/parse'
import { recognizeClipboardImage, fileToDataUrl } from '../lib/ocr'
import FileView from './FileView'

export default function HomeView(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const [imgTask, setImgTask] = useState<ImgTask | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)

  const runOcr = useCallback(async (file: Blob, name: string): Promise<void> => {
    setOcrBusy(true)
    try {
      const preview = await fileToDataUrl(file)
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

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            void runOcr(file, `截图-${ts}.png`)
          }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [runOcr])

  if (doc) return <FileView />
  if (imgTask) return <ImageTranslateView task={imgTask} busy={ocrBusy} onReset={() => setImgTask(null)} />
  return <DropZone onImageFile={runOcr} />
}

interface ImgTask {
  preview: string
  lines: string[]
  name: string
  error: string | null
}

function ImageTranslateView(props: { task: ImgTask; busy: boolean; onReset: () => void }): React.JSX.Element {
  const setDoc = useFileStore((s) => s.setDoc)
  const { task } = props

  const startTranslate = (): void => {
    const segs = task.lines.map((line) => makeSegment('p', line))
    if (!segs.length) return
    setDoc({ name: task.name, size: 0 }, segs)
    props.onReset()
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="card w-full max-w-2xl animate-float-in p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <ImagePlus size={16} className="text-accent" /> 图片翻译
            <span className="chip">{task.name}</span>
          </h2>
          <button className="btn btn-ghost !p-2" onClick={props.onReset} title="关闭">
            <X size={14} />
          </button>
        </div>

        {task.error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <AlertTriangle size={22} />
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">{task.error}</p>
            <div className="flex gap-2">
              <button className="btn" onClick={props.onReset}>关闭</button>
              <p className="self-center text-[11px] text-ink-3">重新截图后 Ctrl+V 粘贴即可</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[160px_1fr] gap-4">
              {task.preview ? (
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  <img src={task.preview} alt="截图预览" className="h-40 w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl border border-line bg-surface">
                  <Loader2 size={20} className="animate-spin text-ink-3" />
                </div>
              )}
              <div className="flex h-40 flex-col overflow-hidden rounded-xl border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
                  <span className="text-[11px] font-medium text-ink-2">识别结果（{task.lines.length} 行）</span>
                  <span className="chip">OCR</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
                  {task.lines.length ? (
                    task.lines.map((l, i) => (
                      <p key={i} className="select-text border-b border-line/50 py-1 text-[12px] leading-relaxed last:border-0">
                        {l}
                      </p>
                    ))
                  ) : (
                    <p className="text-[12px] text-ink-3">未识别到文字</p>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[11px] text-ink-3">逐行对齐 → 双语对照 + 可总结/问答</p>
              <div className="flex gap-2">
                <button className="btn" onClick={props.onReset}>放弃</button>
                <button className="btn btn-primary" disabled={!task.lines.length} onClick={startTranslate}>
                  <Wand2 size={13} /> 开始翻译
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DropZone(props: { onImageFile: (file: Blob, name: string) => Promise<void> }): React.JSX.Element {
  const setDoc = useFileStore((s) => s.setDoc)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (name: string, data: Uint8Array): Promise<void> => {
      setBusy(true)
      setMsg(null)
      try {
        const segments = await parseAnyFile(name, data)
        if (!segments.length) {
          setMsg('未能从文件中提取到文本（扫描版 PDF 请用「图片翻译」）')
          return
        }
        setDoc({ name, size: data.byteLength }, segments)
      } catch (err) {
        setMsg(err instanceof Error ? err.message : '解析失败')
      } finally {
        setBusy(false)
      }
    },
    [setDoc]
  )

  const handleFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const file = Array.from(files).find((f) => isSupported(f.name))
      if (!file) {
        setMsg('请拖入 PDF / DOCX / TXT / Markdown 文件')
        return
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      await load(file.name, buf)
    },
    [load]
  )

  const handleImages = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const file = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!file) {
        setMsg('请选择 PNG / JPG 图片')
        return
      }
      setOcrBusy(true)
      try {
        await props.onImageFile(file, file.name)
      } finally {
        setOcrBusy(false)
      }
    },
    [props]
  )

  const openDialog = useCallback(async (): Promise<void> => {
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      if (!isSupported(name)) continue
      try {
        const data = await window.bridge.readFile(p)
        await load(name, data)
        return
      } catch {
        /* 跳过读取失败的文件 */
      }
    }
    if (paths.length) setMsg('没有可用的文档文件')
  }, [load])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-[22px] font-semibold tracking-tight">把论文交给透镜</h1>
        <p className="mt-2 text-[13px] text-ink-2">
          拖入 PDF / Word / TXT，或在任意地方截图后直接 Ctrl+V 粘贴翻译
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.some((f) => f.type.startsWith('image/'))) {
            void handleImages(files)
          } else {
            void handleFiles(files)
          }
        }}
        onClick={() => inputRef.current?.click()}
        className={`card flex w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 border-2 border-dashed !border-line-strong py-14 transition ${
          drag ? '!border-accent bg-accent-soft' : ''
        }`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <UploadCloud size={26} />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-medium">拖放文件到这里</p>
          <p className="mt-1 text-[12px] text-ink-3">或点击选择 · PDF / DOCX / TXT / MD / 图片</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation()
              void openDialog()
            }}
          >
            <FolderOpen size={14} /> 打开文件…
          </button>
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation()
              imgInputRef.current?.click()
            }}
          >
            {ocrBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} 图片翻译
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md,.markdown"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={imgInputRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/bmp"
          onChange={(e) => {
            if (e.target.files?.length) void handleImages(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {(busy || ocrBusy) && (
        <div className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          {ocrBusy ? '正在 OCR 识别…' : '正在解析文档…'}
        </div>
      )}
      {msg && <p className="text-[13px] text-danger">{msg}</p>}
    </div>
  )
}
