import { useRef } from 'react'
import { ClipboardPaste, ImageUp, Camera } from 'lucide-react'

export default function ImageZoneView(props: { onImageFile: (file: Blob, name: string) => Promise<void> }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h1 className="text-[20px] font-semibold tracking-tight">图片翻译</h1>
          <p className="mt-1.5 text-[13px] text-ink-2">截图后图片在剪贴板里，直接粘贴到这里即可识别翻译</p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
            if (f) void props.onImageFile(f, f.name)
          }}
          onClick={() => inputRef.current?.click()}
          className="card flex cursor-pointer flex-col items-center gap-4 border-2 border-dashed !border-line-strong py-16 transition hover:!border-accent hover:bg-accent-soft"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <ClipboardPaste size={26} />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-medium">在此 Ctrl/Cmd + V 粘贴截图</p>
            <p className="mt-1 text-[12px] text-ink-3">或点击选择图片 / 拖放图片到这里</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation()
              inputRef.current?.click()
            }}
          >
            <ImageUp size={14} /> 选择图片…
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,image/bmp"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void props.onImageFile(f, f.name)
              e.target.value = ''
            }}
          />
        </div>

        <div className="mt-5 flex items-start justify-center gap-6 rounded-2xl border border-line bg-panel px-5 py-4">
          <Step icon={<Camera size={16} />} title="① 截图" desc="任意截图工具（Win+Shift+S / Cmd+Shift+4）截图到剪贴板" />
          <Step icon={<ClipboardPaste size={16} />} title="② 粘贴" desc="回到本页面按 Ctrl/Cmd+V" />
          <Step icon={<ImageUp size={16} />} title="③ 翻译" desc="自动 OCR 识别 → 双语对照 / 中文译文" />
        </div>
      </div>
    </div>
  )
}

function Step(props: { icon: React.ReactNode; title: string; desc: string }): React.JSX.Element {
  return (
    <div className="flex max-w-[170px] flex-col items-center gap-1 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{props.icon}</span>
      <p className="text-[12px] font-semibold">{props.title}</p>
      <p className="text-[10px] leading-relaxed text-ink-3">{props.desc}</p>
    </div>
  )
}
