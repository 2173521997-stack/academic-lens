import { History, Trash2 } from 'lucide-react'
import { useHistoryStore, type HistoryType } from '../stores/historyStore'
import EmptyState from './EmptyState'

const TYPE_META: Record<HistoryType, { label: string; cls: string }> = {
  file: { label: '文件', cls: 'bg-accent/10 text-accent' },
  translate: { label: '翻译', cls: 'bg-accent/10 text-accent' },
  summary: { label: '摘要', cls: 'bg-star/20 text-[#8a6d00] dark:text-star' },
  chat: { label: '对话', cls: 'bg-ok/15 text-[#1d7a3c] dark:text-ok' },
  word: { label: '生词', cls: 'bg-star/20 text-[#8a6d00] dark:text-star' }
}

export default function HistoryView(): React.JSX.Element {
  const entries = useHistoryStore((s) => s.entries)
  const clear = useHistoryStore((s) => s.clear)

  return (
    <div className="flex h-full flex-col">
      <div className="glass flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="text-[17px] font-semibold">历史记录</h1>
        {entries.length > 0 && (
          <button className="btn" onClick={clear}>
            <Trash2 size={13} /> 清空
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-1">
          {!entries.length && <EmptyState icon={History} title="暂无记录" hint="翻译、对话、文件操作都会记录在这里" />}
          {entries.map((e) => {
            const meta = TYPE_META[e.type]
            return (
              <div key={e.id} className="card card-hover flex items-center gap-3 p-3.5">
                <span className={`chip ${meta.cls}`}>{meta.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{e.title}</p>
                  {e.detail && <p className="truncate text-[11px] text-ink-3">{e.detail}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-ink-3">
                  {new Date(e.time).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
