import { useCallback, useEffect, useRef, useState } from 'react'
import {
  UploadCloud,
  FolderOpen,
  ImagePlus,
  Loader2,
  AlertTriangle,
  Wand2,
  X,
  FileText,
  Type,
  Image,
  ClipboardType,
  Languages,
  Feather,
  Sparkles
} from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { useAppStore } from '../stores/appStore'
import { usePolishStore } from '../stores/polishStore'
import { isSupported } from '../lib/types'
import { parseAnyFile, makeSegment, splitParagraphs } from '../lib/parse'
import { recognizeClipboardImage, fileToDataUrl } from '../lib/ocr'
import { toast } from '../stores/noticeStore'
import FileView from './FileView'
import TextTranslateView from './TextTranslateView'
import ImageZoneView from './ImageZoneView'

type HomeTab = 'doc' | 'text' | 'image'

export default function HomeView(): React.JSX.Element {
  const doc = useFileStore((s) => s.doc)
  const setDoc = useFileStore((s) => s.setDoc)
  const [tab, setTab] = useState<HomeTab>('doc')
  const tabRef = useRef<HomeTab>('doc')
  const [imgTask, setImgTask] = useState<ImgTask | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [clipboardText, setClipboardText] = useState<string | null>(null)

  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  // 检查剪贴板文本
  const checkClipboard = useCallback(async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.readText) return
      const text = await navigator.clipboard.readText()
      const t = text.trim()
      if (t && t.length >= 6 && t.length <= 4000 && !t.startsWith('http://') && !t.startsWith('https://')) {
        setClipboardText(t)
      }
    } catch {
      // 忽略剪贴板权限或读取异常
    }
  }, [])

  useEffect(() => {
    void checkClipboard()
    const onFocus = (): void => {
      void checkClipboard()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkClipboard])

  const runOcr = useCallback(async (file: Blob, name: string): Promise<void> => {
    setOcrBusy(true)
    try {
      const preview = await fileToDataUrl(file, 480)
      const { lines } = await recognizeClipboardImage(file)
      setImgTask({ preview, lines, name, error: null })
      if (lines.length) toast('success', `已识别 ${lines.length} 行，可一键翻译`, '图片 OCR')
      else toast('warning', '未识别到文字，请换一张更清晰的图', '图片 OCR')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImgTask({
        preview: '',
        lines: [],
        name,
        error: msg
      })
      toast('danger', msg, '图片 OCR 失败')
    } finally {
      setOcrBusy(false)
    }
  }, [])

  const openDocDialog = useCallback(async (): Promise<void> => {
    const paths = await window.bridge.openFiles()
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p
      if (!isSupported(name)) continue
      try {
        const data = await window.bridge.readFile(p)
        const segs = await parseAnyFile(name, data)
        setDoc({ name, size: data.byteLength, rawBuffer: data }, segs)
        return
      } catch {
        /* 跳过读取失败的文件 */
      }
    }
  }, [setDoc])

  // 剪贴板一键导入翻译
  const handleTranslateClipboard = useCallback(
    (content: string): void => {
      const paras = splitParagraphs(content)
      if (!paras.length) return
      const segs = paras.map((p) => makeSegment('p', p))
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
      setDoc({ name: `剪贴板文本-${ts}.txt`, size: content.length }, segs)
      useFileStore.getState().translateAll()
      toast('success', `已导入 ${segs.length} 个段落并开启翻译`, '文本翻译')
    },
    [setDoc]
  )

  // 剪贴板一键导入润色
  const handlePolishClipboard = useCallback((content: string): void => {
    usePolishStore.getState().setInput(content)
    useAppStore.getState().go('polish')
  }, [])

  // 全局 Ctrl+V 粘贴监听（支持直接粘贴图片进行 OCR 或粘贴长文本）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (tabRef.current !== 'doc' && tabRef.current !== 'image') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            void runOcr(file, `截图-${ts}.png`)
            setTab('image')
          }
          return
        }
      }

      // 如果粘贴纯文本
      const pastedText = e.clipboardData?.getData('text/plain')?.trim()
      if (pastedText && pastedText.length > 20) {
        setClipboardText(pastedText)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [runOcr])

  if (doc) return <FileView />
  if (tab === 'text') return <TextTranslateView />
  if (tab === 'image') {
    return imgTask ? (
      <ImageTranslateView task={imgTask} busy={ocrBusy} onReset={() => setImgTask(null)} onBack={() => setTab('doc')} />
    ) : (
      <ImageZoneView onImageFile={runOcr} />
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10 select-none">
      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        {/* 极简学术标题 */}
        <div className="text-center space-y-1.5 animate-in fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-[11px] font-semibold text-accent shadow-xs">
            <Sparkles size={12} />
            <span>智能学术双语对照阅读器</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-1 sm:text-[30px]">
            Academic Lens
          </h1>
          <p className="text-[13px] text-ink-3 max-w-lg mx-auto leading-relaxed">
            支持 PDF 论文、Word、Markdown 逐段对齐翻译 · 术语一致性注入 · LaTeX 公式智能透析
          </p>
        </div>

        {/* 剪贴板快速互译/润色检测栏 */}
        {clipboardText && (
          <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-card/95 p-3 shadow-md animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <ClipboardType size={16} />
              </div>
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-accent">
                  <span>检测到剪贴板内容</span>
                  <span className="text-[10px] font-normal text-ink-3">({clipboardText.length} 字)</span>
                </span>
                <span className="block truncate text-[12px] text-ink-2 max-w-md">"{clipboardText}"</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="btn !bg-accent !text-white !px-3 !py-1 text-[11.5px] font-semibold shadow-xs hover:opacity-90 transition"
                onClick={() => handleTranslateClipboard(clipboardText)}
                title="导入大窗双语对照翻译"
              >
                <Languages size={12} /> 导入翻译
              </button>
              <button
                className="btn btn-ghost !border-line !px-2.5 !py-1 text-[11.5px] font-medium"
                onClick={() => handlePolishClipboard(clipboardText)}
                title="导入学术润色工作台"
              >
                <Feather size={12} /> 润色
              </button>
              <button
                className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1"
                onClick={() => setClipboardText(null)}
                title="忽略"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* 宽敞大气的文档拖放区 */}
        <DropZone
          onOpenDoc={openDocDialog}
          onImageFile={runOcr}
          onGoText={() => setTab('text')}
          onGoImage={() => setTab('image')}
        />

        {/* 底部快捷操作指引 */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="font-semibold text-accent">Ctrl+V</kbd> 任意位置直接粘贴截图/文本
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-semibold text-accent">Alt+X</kbd> 全局划词即翻
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-semibold text-accent">Alt+T</kbd> 快速调出小窗
          </span>
        </div>
      </div>
    </div>
  )
}

interface ImgTask {
  preview: string
  lines: string[]
  name: string
  error: string | null
}

function ImageTranslateView(props: { task: ImgTask; busy: boolean; onReset: () => void; onBack: () => void }): React.JSX.Element {
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
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={props.onBack}>
              返回
            </button>
            <button className="btn btn-ghost !p-2" onClick={props.onReset} title="关闭">
              <X size={14} />
            </button>
          </div>
        </div>

        {task.error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <AlertTriangle size={22} />
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">{task.error}</p>
            <div className="flex gap-2">
              <button className="btn" onClick={props.onReset}>关闭</button>
              <button className="btn" onClick={props.onBack}>返回图片翻译</button>
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
              <p className="text-[11px] text-ink-3">逐行对齐 → 中文译文对照</p>
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

function DropZone(props: {
  onOpenDoc: () => Promise<void>
  onImageFile: (file: Blob, name: string) => Promise<void>
  onGoText: () => void
  onGoImage: () => void
}): React.JSX.Element {
  const setDoc = useFileStore((s) => s.setDoc)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
        setDoc({ name, size: data.byteLength, rawBuffer: data }, segments)
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

  return (
    <div className="w-full flex flex-col items-center gap-3">
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
        className={`group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-10 text-center transition-all ${
          drag
            ? '!border-accent bg-accent-soft/70 scale-[1.01] shadow-pop'
            : 'border-line-strong bg-card/60 hover:border-accent/60 hover:bg-surface/70 hover:shadow-card'
        }`}
      >
        {/* 上传图标 */}
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/10 text-accent transition group-hover:scale-110 group-hover:bg-accent group-hover:text-white shadow-xs">
          <UploadCloud size={30} />
        </div>

        {/* 提示文案 */}
        <div className="space-y-1">
          <p className="text-[16px] font-semibold text-ink-1 tracking-tight">
            拖放学术文献到此处，或点击浏览文件
          </p>
          <p className="text-[12px] text-ink-3">
            自动解析文档标题、章节目录、学术图表、公式与列表结构
          </p>
        </div>

        {/* 支持格式徽章栏 */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
          <span className="chip !bg-surface-elevated !text-[11px] font-medium text-ink-2">
            <FileText size={11} className="text-accent" /> PDF 论文
          </span>
          <span className="chip !bg-surface-elevated !text-[11px] font-medium text-ink-2">
            <FileText size={11} className="text-blue-500" /> Word (.docx)
          </span>
          <span className="chip !bg-surface-elevated !text-[11px] font-medium text-ink-2">
            <FileText size={11} className="text-emerald-500" /> Markdown
          </span>
          <span className="chip !bg-surface-elevated !text-[11px] font-medium text-ink-2">
            <Type size={11} className="text-amber-500" /> TXT
          </span>
          <span className="chip !bg-surface-elevated !text-[11px] font-medium text-ink-2">
            <Image size={11} className="text-purple-500" /> 截图 OCR
          </span>
        </div>

        {/* 快捷操作主按钮组 */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            className="btn btn-primary !px-5 !py-2 text-[13px] font-semibold shadow-sm"
            onClick={(e) => {
              e.stopPropagation()
              void props.onOpenDoc()
            }}
          >
            <FolderOpen size={14} /> 打开学术文献…
          </button>
          <button
            className="btn !bg-surface-elevated hover:!bg-surface !px-3.5 !py-2 text-[12px] font-medium text-ink-2"
            onClick={(e) => {
              e.stopPropagation()
              props.onGoText()
            }}
          >
            <Type size={13} /> 粘贴文本翻译
          </button>
          <button
            className="btn !bg-surface-elevated hover:!bg-surface !px-3.5 !py-2 text-[12px] font-medium text-ink-2"
            onClick={(e) => {
              e.stopPropagation()
              props.onGoImage()
            }}
          >
            {ocrBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} 截图/图片翻译
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
      </div>

      {(busy || ocrBusy) && (
        <div className="flex items-center gap-3 text-[13px] text-ink-2 animate-in fade-in">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          {ocrBusy ? '正在 OCR 识别截图…' : '正在解析文档结构与段落…'}
        </div>
      )}

      {msg && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger animate-in fade-in">
          {msg}
        </div>
      )}
    </div>
  )
}
