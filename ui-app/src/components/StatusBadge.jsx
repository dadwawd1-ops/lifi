const toneMap = {
  healthy: 'bg-accent text-primary',
  offline: 'bg-red-100 text-red-800',
  busy: 'bg-amber-100 text-amber-800',
  completed: 'bg-accent text-primary',
  failed: 'bg-red-100 text-red-800',
  unknown: 'bg-stone-200 text-stone-700',
  awaiting_confirm: 'bg-amber-100 text-amber-800',
}

export default function StatusBadge({ label, tone = 'unknown' }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${toneMap[tone] ?? toneMap.unknown}`}
    >
      {label}
    </span>
  )
}
