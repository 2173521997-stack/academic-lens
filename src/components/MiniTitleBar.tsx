import { Pin, PinOff, Maximize2 } from 'lucide-react'
import { useWindowStore } from '../stores/windowStore'
import { useAppStore } from '../stores/appStore'

export default function MiniTitleBar(): React.JSX.Element {
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop)
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop)
  const setMode = useWindowStore((s) => s.setMode)
  const isMac = useAppStore((s) => s.isMac)

  const iconBtn =
    'flex h-6 w-6 items-center justify-center rounded-md text-ink-2 transition hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'

  return (
    <header
      className="flex h-9 shrink-0 items-center justify-between border-b border-line/60 px-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={`flex min-w-0 items-center gap-1.5 ${isMac ? 'pl-[72px]' : 'pl-1'}`}>
        <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.2 text-[9.5px] font-medium text-accent">
          小窗
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-1 pr-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          className={`${iconBtn} ${alwaysOnTop ? '!text-accent bg-accent-soft' : ''}`}
          onClick={toggleAlwaysOnTop}
          title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
        >
          {alwaysOnTop ? <Pin size={12} strokeWidth={1.5} fill="currentColor" /> : <PinOff size={12} strokeWidth={1.5} />}
        </button>
        <button
          className={iconBtn}
          onClick={() => setMode('full')}
          title="展开窗口"
        >
          <Maximize2 size={12} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  )
}

