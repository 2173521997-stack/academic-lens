import type { LucideIcon } from 'lucide-react'

export default function EmptyState(props: {
  icon: LucideIcon
  title: string
  hint?: string
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon size={26} />
      </div>
      <p className="text-[14px] font-medium text-ink-1">{props.title}</p>
      {props.hint && <p className="text-[12px] text-ink-3">{props.hint}</p>}
    </div>
  )
}
