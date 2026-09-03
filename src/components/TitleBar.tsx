import React from 'react'
import {
  PanelLeftOpen,
  PanelTopClose,
  Sparkles,
  ChevronRight
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWindowStore } from '../stores/windowStore'
import { useFileStore } from '../stores/fileStore'

const VIEW_TITLES: Record<string, string> = {
  home: '翻译',
  wordbook: '生词本',
  settings: '设置'
}

export default function TitleBar(): React.JSX.Element {
  const isMac = useAppStore((s) => s.isMac)
  const view = useAppStore((s) => s.view)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const assistantOpen = useAppStore((s) => s.assistantOpen)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const setMode = useWindowStore((s) => s.setMode)
  const doc = useFileStore((s) => s.doc)

  const iconBtn =
    'flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-ink-2 transition hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'

  return (
    <header
      className="glass flex h-10 shrink-0 items-center justify-between border-b border-line px-3 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：侧边栏展开按钮与统一面包屑 */}
      <div
        className={`flex min-w-0 items-center gap-2 ${
          isMac && !sidebarOpen ? 'pl-[72px]' : 'pl-1'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {!sidebarOpen && (
          <button
            className="btn btn-ghost !p-1 text-ink-2 hover:text-ink-1"
            onClick={toggleSidebar}
            title="展开侧边栏"
          >
            <PanelLeftOpen size={14} strokeWidth={1.5} />
          </button>
        )}

        <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <span className="font-medium text-ink-1">{VIEW_TITLES[view] || '工作台'}</span>
          {doc && view === 'home' && (
            <>
              <ChevronRight size={12} strokeWidth={1.5} className="text-ink-3" />
              <span className="chip max-w-[220px] truncate text-[11px] font-medium">
                {doc.name}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 右侧工具栏：AI 助手、小窗 */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          className={`${iconBtn} ${
            assistantOpen ? '!bg-accent-soft !text-accent font-semibold' : ''
          }`}
          onClick={toggleAssistant}
          title="展开/收起 AI 助手 (⌘⇧A)"
        >
          <Sparkles size={14} strokeWidth={1.5} />
          <span className="hidden sm:inline">AI 助手</span>
        </button>

        <span className="mx-0.5 h-3.5 w-px bg-line" />

        <button
          className={iconBtn}
          onClick={() => setMode('mini')}
          title="切换至小窗 (⌘⇧M)"
        >
          <PanelTopClose size={14} strokeWidth={1.5} />
          <span className="hidden sm:inline">小窗</span>
        </button>
      </div>
    </header>
  )
}
