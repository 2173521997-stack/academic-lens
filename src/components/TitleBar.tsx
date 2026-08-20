import { PanelTopClose, Settings, Bot, GraduationCap, Microscope } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWindowStore } from '../stores/windowStore'

export default function TitleBar(): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const platform = useAppStore((s) => s.platform)
  const view = useAppStore((s) => s.view)
  const go = useAppStore((s) => s.go)
  const setMode = useWindowStore((s) => s.setMode)

  const navTab = (targetView: 'research' | 'english' | 'agent', label: string, icon: React.JSX.Element) => {
    const active = view === targetView
    return (
      <button
        className={`flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium transition ${
          active
            ? 'bg-accent text-white shadow-xs'
            : 'text-ink-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink-1'
        }`}
        onClick={() => go(targetView)}
        title={label}
      >
        {icon}
        <span>{label}</span>
      </button>
    )
  }

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3 bg-panel/50 backdrop-blur-xl"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：Logo 与平台标识 */}
      <div className={`flex min-w-0 items-center gap-2.5 ${isMac ? 'pl-[76px]' : 'pl-2'}`}>
        <button
          onClick={() => go('research')}
          className="flex items-center gap-2 text-left text-[14px] font-bold tracking-tight text-ink-1 hover:opacity-85 transition"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Academic Lens 学术透镜"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-white shadow-xs">
            <Microscope size={14} />
          </span>
          <span>Academic Lens</span>
        </button>
        {platform && (
          <span className="chip shrink-0 hidden sm:inline-flex text-[10px]">
            {platform === 'darwin' ? 'macOS' : 'Windows'}
          </span>
        )}
      </div>

      {/* 中间：3 大顶级核心板块切换 */}
      <div
        className="flex items-center gap-1 p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] border border-line/50"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {navTab('research', '来做学术', <Microscope size={14} />)}
        {navTab('english', '来学英语', <GraduationCap size={14} />)}
        {navTab('agent', '智能体', <Bot size={14} />)}
      </div>

      {/* 右侧：设置与辅助功能 */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          className={`flex h-8 w-8 items-center justify-center rounded-xl text-ink-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition ${
            view === 'settings' ? 'bg-accent-soft text-accent' : ''
          }`}
          onClick={() => go('settings')}
          title="系统设置"
        >
          <Settings size={14} />
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

        <button
          className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-medium text-ink-3 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink-1 transition"
          onClick={() => setMode('mini')}
          title="缩回划词/选词小窗（Ctrl/Cmd+Shift+M）"
        >
          <PanelTopClose size={13} />
          <span className="hidden md:inline">小窗模式</span>
        </button>
      </div>
    </header>
  )
}
