import Panel from './Panel.jsx'
import StatusBadge from './StatusBadge.jsx'

export default function RuntimeConfigSection({
  runtime,
  onChange,
  onPing,
  pinging,
  health,
}) {
  const tone = health.status === 'healthy'
    ? 'healthy'
    : health.status === 'busy'
      ? 'busy'
      : health.status === 'offline'
        ? 'offline'
        : 'unknown'

  return (
    <Panel
      title="Runtime Config"
      eyebrow="Live Runtime Console"
      aside={<StatusBadge label={health.label} tone={tone} />}
    >
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              Runtime Base URL
            </span>
            <input
              className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
              value={runtime.baseUrl}
              onChange={event => onChange('baseUrl', event.target.value)}
              placeholder="http://127.0.0.1:8787"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              Runtime Token
            </span>
            <input
              className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
              type="password"
              value={runtime.token}
              onChange={event => onChange('token', event.target.value)}
              placeholder="Optional bearer token"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Mode
              </span>
              <select
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={runtime.mode}
                onChange={event => onChange('mode', event.target.value)}
              >
                <option value="plan-only">plan-only</option>
                <option value="execute">execute</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Global Wallet
              </span>
              <input
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={runtime.walletAddress}
                onChange={event => onChange('walletAddress', event.target.value)}
                placeholder="0x..."
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-[24px] border border-outline bg-surface-low p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              Runtime Health
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">{health.message}</p>
          </div>

          <button
            type="button"
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onPing}
            disabled={pinging}
          >
            {pinging ? 'Checking...' : 'Ping Runtime'}
          </button>
        </div>
      </div>
    </Panel>
  )
}
