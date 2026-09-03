import React, { useRef, useState } from 'react'
import {
  ClipboardPaste,
  ImageUp,
  Image as ImageIcon,
  Loader2
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export default function ImageZoneView(props: {
  onImageFile: (file: Blob, name: string) => Promise<void>
}): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleFiles = async (files: FileList | File[]): Promise<void> => {
    const f = Array.from(files).find((x) => x.type.startsWith('image/'))
    if (!f) return
    setBusy(true)
    try {
      await props.onImageFile(f, f.name)
    } finally {
      setBusy(false)
    }
  }

  const handlePasteClipboard = async (): Promise<void> => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(5, 19)
            setBusy(true)
            try {
              await props.onImageFile(blob, `截图-${ts}.png`)
            } finally {
              setBusy(false)
            }
            return
          }
        }
      }
    } catch {
      /* 浏览器剪贴板权限或无图片时静默 */
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center p-6 sm:p-8 overflow-y-auto bg-surface">
      <div className="w-full max-w-lg space-y-4 text-center">
        {/* 极简 Hero 卡片 */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          className={`card flex cursor-pointer flex-col items-center justify-center gap-3 border p-8 sm:p-10 transition ${
            drag
              ? '!border-accent bg-accent-soft shadow-pop'
              : 'border-line hover:border-accent/40 hover:bg-card/90'
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <ImageIcon size={24} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold text-ink-1 tracking-tight">拖放图片至此处</h2>
            <p className="mt-1 text-[12px] text-ink-3">
              支持 PNG、JPG、WebP 格式截图与图片
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation()
                inputRef.current?.click()
              }}
            >
              <ImageUp size={13} strokeWidth={1.5} /> 选择图片…
            </button>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation()
                void handlePasteClipboard()
              }}
            >
              <ClipboardPaste size={13} strokeWidth={1.5} /> 从剪贴板粘贴
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,image/bmp"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-4 text-[11px] text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">{isMac ? '⌘V' : 'Ctrl+V'}</kbd> 粘贴截图
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-alt px-1.5 py-0.5 font-medium">{isMac ? '⌘K' : 'Ctrl+K'}</kbd> 快速查词
          </span>
        </div>
      </div>

      {busy && (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />
          <span>正在识别图片…</span>
        </div>
      )}
    </div>
  )
}

