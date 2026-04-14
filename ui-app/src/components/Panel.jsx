export default function Panel({ title, eyebrow, children, aside, className = '' }) {
  return (
    <section
      className={`rounded-[28px] border border-outline/70 bg-white/80 p-6 shadow-panel backdrop-blur sm:p-8 ${className}`}
    >
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-primary">{title}</h2>
        </div>
        {aside ? <div className="text-sm text-muted">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}
