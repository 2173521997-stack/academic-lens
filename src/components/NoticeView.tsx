import { useEffect, useRef } from 'react'
import { Info, CheckCircle2, AlertTriangle, XCircle, Sparkles, X } from 'lucide-react'
import { useNoticeStore, type NoticeLevel } from '../stores/noticeStore'

const LEVEL_META: Record<NoticeLevel, { icon: typeof Info; text: string; border: string; bg: string; iconBg: string }> = {
  info: {
    icon: Info,
    text: 'text-info',
    border: 'border-info/30',
    bg: 'bg-info/10',
    iconBg: 'bg-info/15 text-info'
  },
  success: {
    icon: CheckCircle2,
    text: 'text-ok',
    border: 'border-ok/30',
    bg: 'bg-ok/10',
    iconBg: 'bg-ok/15 text-ok'
  },
  warning: {
    icon: AlertTriangle,
    text: 'text-warning',
    border: 'border-warning/30',
    bg: 'bg-warning/10',
    iconBg: 'bg-warning/15 text-warning'
  },
  danger: {
    icon: XCircle,
    text: 'text-danger',
    border: 'border-danger/30',
    bg: 'bg-danger/10',
    iconBg: 'bg-danger/15 text-danger'
  },
  ai: {
    icon: Sparkles,
    text: 'text-accent',
    border: 'border-accent/30',
    bg: 'bg-accent/10',
    iconBg: 'bg-accent/15 text-accent'
  }
}

/** 全局统一通知容器：挂载一次，任何模块通过 useNoticeStore / toast() 触发展示 */
export default function NoticeView(): React.JSX.Element {
  const notices = useNoticeStore((s) => s.notices)
  const dismiss = useNoticeStore((s) => s.dismiss)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 新通知到达时自动滚动到可见区域
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [notices.length])

  if (!notices.length) return <></>

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-1/2 top-3 z-[60] flex w-[min(92vw,440px)] -translate-x-1/2 flex-col gap-2"
    >
      {notices.map((n) => {
        const meta = LEVEL_META[n.level]
        const Icon = meta.icon
        return (
          <div
            key={n.id}
            className={`notice-enter pointer-events-auto card flex items-start gap-3 !rounded-xl border ${meta.border} p-3`}
            role={n.level === 'danger' ? 'alert' : 'status'}
          >
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${meta.iconBg}`}>
              <Icon size={13} />
            </span>
            <div className="min-w-0 flex-1">
              {n.title && <p className={`text-[12px] font-semibold ${meta.text}`}>{n.title}</p>}
              <p className="select-text whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{n.message}</p>
            </div>
            <button
              className="btn btn-ghost !p-1 shrink-0 text-ink-3 transition hover:text-ink-1"
              onClick={() => dismiss(n.id)}
              title="关闭"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}