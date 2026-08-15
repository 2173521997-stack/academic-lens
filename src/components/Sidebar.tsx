import { FileText, BookOpen, History, Settings } from 'lucide-react'
import { useAppStore, type ViewName } from '../stores/appStore'

const NAV: { key: ViewName; label: string; icon: React.ReactNode }[] = [
  { key: 'home', label: '文件', icon: <FileText size={20} /> },
  { key: 'wordbook', label: '生词本', icon: <BookOpen size={20} /> },
  { key: 'history', label: '历史', icon: <History size={20} /> },
  { key: 'settings', label: '设置', icon: <Settings size={20} /> }
]

export default function Sidebar(): React.JSX.Element {
  const view = useAppStore((s) => s.view)
  const go = useAppStore((s) => s.go)

  return (
    <nav className="glass flex w-[86px] shrink-0 flex-col items-center gap-1 border-r py-3">
      {NAV.map((item) => (
        <button
          key={item.key}
          onClick={() => go(item.key)}
          title={item.label}
          className={`group relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-xl transition ${
            view === item.key ? 'text-accent' : 'text-ink-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
          }`}
        >
          {item.icon}
          <span className="text-[9px] font-medium">{item.label}</span>
          {view === item.key && (
            <span className="absolute left-[-13px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
          )}
        </button>
      ))}
      <div className="mt-auto">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
          AL
        </div>
      </div>
    </nav>
  )
}
