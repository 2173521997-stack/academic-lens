import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X, PanelTopClose } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWindowStore } from '../stores/windowStore'

export default function TitleBar(): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const platform = useAppStore((s) => s.platform)
  const setMode = useWindowStore((s) => s.setMode)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.bridge.isMaximized().then(setMaximized)
    window.bridge.onMaximized(setMaximized)
  }, [])

  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'

  return (
    <header
      className="glass relative z-30 flex h-11 shrink-0 items-center justify-between border-b"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={`flex items-center gap-2 ${isMac ? 'pl-20' : 'pl-4'}`}>
        <span className="text-[13px] font-semibold tracking-tight">Academic Lens</span>
        {platform && (
          <span className="chip">学术透镜 · {platform === 'darwin' ? 'macOS' : 'Windows'}</span>
        )}
      </div>
      <div className="flex items-center gap-1 pr-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          className={iconBtn}
          onClick={() => setMode('mini')}
          title="缩回小窗（Ctrl/Cmd+Shift+M）"
        >
          <PanelTopClose size={14} />
        </button>
        {!isMac && (
          <>
            <button className={iconBtn} onClick={() => window.bridge.minimize()} title="最小化">
              <Minus size={14} />
            </button>
            <button className={iconBtn} onClick={() => window.bridge.toggleMaximize()} title={maximized ? '还原' : '最大化'}>
              {maximized ? <Copy size={13} className="rotate-180" /> : <Square size={12} />}
            </button>
            <button
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition hover:bg-[#FF3B30] hover:text-white"
              onClick={() => window.bridge.close()}
              title="关闭"
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
