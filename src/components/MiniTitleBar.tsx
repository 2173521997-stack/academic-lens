import { Pin, PinOff, Maximize2, Minus, X } from 'lucide-react'
import { useWindowStore } from '../stores/windowStore'

export default function MiniTitleBar(): React.JSX.Element {
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop)
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop)
  const setMode = useWindowStore((s) => s.setMode)

  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel px-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-1.5 pl-1.5">
        <span className="text-[12px] font-semibold tracking-tight">Academic Lens</span>
        <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
          小窗
        </span>
      </div>
      <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          className={`flex h-6.5 w-6.5 items-center justify-center rounded-md transition ${
            alwaysOnTop ? 'text-accent' : 'text-ink-2 hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'
          }`}
          onClick={toggleAlwaysOnTop}
          title={alwaysOnTop ? '取消置顶' : '置顶（上课/阅读时防遮挡）'}
        >
          {alwaysOnTop ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
        </button>
        <button
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-2 transition hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
          onClick={() => setMode('full')}
          title="展开完整窗口"
        >
          <Maximize2 size={13} />
        </button>
        <button
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-2 transition hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
          onClick={() => window.bridge.windowHide()}
          title="隐藏（Ctrl/Cmd+Shift+T 唤起）"
        >
          <Minus size={13} />
        </button>
        <button
          className="ml-0.5 flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-2 transition hover:bg-[#FF3B30] hover:text-white"
          onClick={() => window.bridge.close()}
          title="退出"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
