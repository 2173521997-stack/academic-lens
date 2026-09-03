import { useEffect, useRef, useState } from 'react'

interface SegProps<T extends string> {
  items: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

export default function Segmented<T extends string>({ items, value, onChange }: SegProps<T>): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const active = el.querySelector<HTMLButtonElement>('.seg-item.active')
    if (!active) return
    setThumb({ left: active.offsetLeft, width: active.offsetWidth })
  }, [value, items])

  return (
    <div ref={ref} className="seg">
      {thumb && <div className="seg-thumb" style={{ left: thumb.left, width: thumb.width }} />}
      {items.map((item) => (
        <button
          key={item.value}
          className={`seg-item ${value === item.value ? 'active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
