import React from 'react'
import {
  Languages,
  BookOpen,
  Settings,
  PanelLeftClose
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useWordbookStore } from '../stores/wordbookStore'
import { useFileStore } from '../stores/fileStore'

export default function Sidebar(): React.JSX.Element {
  const view = useAppStore((s) => s.view)
  const go = useAppStore((s) => s.go)
  const isMac = useAppStore((s) => s.isMac)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const wordsCount = useWordbookStore((s) => s.words.length)
  const doc = useFileStore((s) => s.doc)

  if (!sidebarOpen) return <></>

  return (
    <aside
      className="sidebar-glass flex w-48 shrink-0 flex-col select-none border-r border-line transition-all duration-200"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* 顶部工具栏高度占位，与 TitleBar 平齐 */}
      <div className={`flex h-10 shrink-0 items-center justify-between px-3 ${isMac ? 'pt-1' : ''}`}>
        <span className="text-[11.5px] font-semibold text-ink-3 tracking-wider uppercase pl-1">
          Academic Lens
        </span>
        <button
          className="btn btn-ghost !p-1 text-ink-3 hover:text-ink-1"
          onClick={toggleSidebar}
          title="收起侧边栏"
        >
          <PanelLeftClose size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* 核心 3 大导航项 */}
      <div className="flex-1 space-y-1 px-2 py-2">
        <button
          className={`sidebar-item ${view === 'home' ? 'active' : ''}`}
          onClick={() => go('home')}
        >
          <Languages size={15} strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-left">翻译</span>
          {doc && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-ok shadow-xs"
              title={`当前正在研读：${doc.name}`}
            />
          )}
        </button>

        <button
          className={`sidebar-item ${view === 'wordbook' ? 'active' : ''}`}
          onClick={() => go('wordbook')}
        >
          <BookOpen size={15} strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-left">生词本</span>
          {wordsCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-medium ${
                view === 'wordbook' ? 'bg-accent text-white' : 'bg-surface-alt text-ink-2'
              }`}
            >
              {wordsCount}
            </span>
          )}
        </button>

        <button
          className={`sidebar-item ${view === 'settings' ? 'active' : ''}`}
          onClick={() => go('settings')}
        >
          <Settings size={15} strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-left">设置</span>
        </button>
      </div>
    </aside>
  )
}
