import { Pin, PinOff, Maximize2 } from 'lucide-react'
import { useWindowStore } from '../stores/windowStore'

export default function MiniTitleBar(): React.JSX.Element {
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop)
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop)
  const setMode = useWindowStore((s) => s.setMode)

  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-full text-ink-2 transition hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'

  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-1.5 pl-[76px]">
        <span className="truncate text-[12px] font-semibold tracking-tight">Academic Lens</span>
        <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
          小窗
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-0.5 pr-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          className={`${iconBtn} ${alwaysOnTop ? '!text-accent' : ''}`}
          onClick={toggleAlwaysOnTop}
          title={alwaysOnTop ? '取消置顶' : '置顶（上课/阅读时防遮挡）'}
        >
          {alwaysOnTop ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
        </button>
        <button
          className={iconBtn}
          onClick={() => setMode('full')}
          title="展开完整窗口"
        >
          <Maximize2 size={13} />
        </button>
      </div>
    </header>
  )
}
