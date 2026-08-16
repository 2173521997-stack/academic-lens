import { PanelTopClose, ArrowLeft, BookOpen, History, Settings } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWindowStore } from '../stores/windowStore'

export default function TitleBar(): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const platform = useAppStore((s) => s.platform)
  const view = useAppStore((s) => s.view)
  const go = useAppStore((s) => s.go)
  const setMode = useWindowStore((s) => s.setMode)

  const iconBtn =
    'flex h-7 items-center justify-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-2 transition hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'

  return (
    <header
      className="flex h-11 shrink-0 items-center justify-between border-b border-line"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={`flex min-w-0 items-center gap-2 ${isMac ? 'pl-[84px]' : 'pl-4'}`}>
        {view !== 'home' && (
          <button
            className="btn btn-ghost !p-1.5"
            onClick={() => go('home')}
            title="返回翻译"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <span className="truncate text-[13px] font-semibold tracking-tight">Academic Lens</span>
        {platform && (
          <span className="chip shrink-0">学术透镜 · {platform === 'darwin' ? 'macOS' : 'Windows'}</span>
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-1 pr-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          className={`${iconBtn} ${view === 'wordbook' ? '!bg-accent-soft !text-accent' : ''}`}
          onClick={() => go(view === 'wordbook' ? 'home' : 'wordbook')}
          title="生词本"
        >
          <BookOpen size={13} />
          <span className="hidden sm:inline">生词本</span>
        </button>
        <button
          className={`${iconBtn} ${view === 'history' ? '!bg-accent-soft !text-accent' : ''}`}
          onClick={() => go(view === 'history' ? 'home' : 'history')}
          title="历史记录"
        >
          <History size={13} />
          <span className="hidden sm:inline">历史</span>
        </button>
        <button
          className={`${iconBtn} ${view === 'settings' ? '!bg-accent-soft !text-accent' : ''}`}
          onClick={() => go(view === 'settings' ? 'home' : 'settings')}
          title="设置"
        >
          <Settings size={13} />
          <span className="hidden sm:inline">设置</span>
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          className={iconBtn}
          onClick={() => setMode('mini')}
          title="缩回小窗（Ctrl/Cmd+Shift+M）"
        >
          <PanelTopClose size={13} />
          <span className="hidden sm:inline">小窗</span>
        </button>
      </div>
    </header>
  )
}
