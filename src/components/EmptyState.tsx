import React from 'react'
import type { LucideIcon } from 'lucide-react'

export default function EmptyState(props: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: {
    label: string
    onClick: () => void
    icon?: LucideIcon
  }
}): React.JSX.Element {
  const Icon = props.icon
  const ActionIcon = props.action?.icon

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center select-none">
      <div className="mb-2.5 text-ink-3/70">
        <Icon size={32} strokeWidth={1.5} />
      </div>
      <p className="text-[13px] font-semibold text-ink-1">{props.title}</p>
      {props.hint && (
        <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-ink-3">
          {props.hint}
        </p>
      )}
      {props.action && (
        <button
          className="btn btn-primary mt-3 !px-3 !py-1 text-[11.5px]"
          onClick={props.action.onClick}
        >
          {ActionIcon && <ActionIcon size={12} strokeWidth={1.5} />}
          <span>{props.action.label}</span>
        </button>
      )}
    </div>
  )
}

