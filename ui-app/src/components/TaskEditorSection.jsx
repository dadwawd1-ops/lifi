import Panel from './Panel.jsx'
import StatusBadge from './StatusBadge.jsx'
import { inferSkill, skillLabel } from '../lib/task-model.js'

export default function TaskEditorSection({
  tasks,
  chains,
  destinationVault,
  taskIssuesById,
  onAdd,
  onRemove,
  onDuplicate,
  onChange,
  onRun,
  running,
}) {
  const disabled =
    !destinationVault ||
    running ||
    tasks.some(task => (taskIssuesById[task.id] ?? []).length > 0)

  return (
    <Panel
      title="Task Card Editor"
      eyebrow="Batch Tasks"
      aside={
        destinationVault ? (
          <span className="text-sm text-muted">All tasks locked to toChain {destinationVault.chainId}</span>
        ) : (
          <span className="text-sm text-muted">Select a destination vault before running</span>
        )
      }
    >
      <div className="space-y-4">
        {tasks.map((task, index) => {
          const skill = inferSkill(task, destinationVault)
          const issues = taskIssuesById[task.id] ?? []
          return (
            <article key={task.id} className="rounded-[24px] border border-outline bg-surface-low p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    Task {index + 1}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-primary">
                    {task.sourceToken || 'Source token pending'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge label={skillLabel(skill)} tone={skill === 'bridge-assets' ? 'completed' : 'busy'} />
                  <button
                    type="button"
                    className="rounded-full border border-outline px-3 py-2 text-xs font-semibold text-primary"
                    onClick={() => onDuplicate(task.id)}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-outline px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50"
                    onClick={() => onRemove(task.id)}
                    disabled={tasks.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="grid gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    Source Chain
                  </span>
                  <select
                    className="rounded-2xl border border-outline bg-white px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                    value={task.fromChain}
                    onChange={event => onChange(task.id, 'fromChain', event.target.value)}
                  >
                    <option value="">Select chain</option>
                    {chains.map(chain => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    Source Token
                  </span>
                  <input
                    className="rounded-2xl border border-outline bg-white px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                    value={task.sourceToken}
                    onChange={event => onChange(task.id, 'sourceToken', event.target.value)}
                    placeholder="USDC or 0x..."
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    Amount
                  </span>
                  <input
                    className="rounded-2xl border border-outline bg-white px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                    value={task.amount}
                    onChange={event => onChange(task.id, 'amount', event.target.value)}
                    placeholder="1250000"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    From Address Override
                  </span>
                  <input
                    className="rounded-2xl border border-outline bg-white px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                    value={task.fromAddress}
                    onChange={event => onChange(task.id, 'fromAddress', event.target.value)}
                    placeholder="Optional 0x..."
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                    Slippage
                  </span>
                  <input
                    className="rounded-2xl border border-outline bg-white px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                    value={task.slippage}
                    onChange={event => onChange(task.id, 'slippage', event.target.value)}
                    placeholder="0.003"
                  />
                </label>
              </div>

              {issues.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {issues.join(' ')}
                </div>
              ) : null}
            </article>
          )
        })}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-2xl border border-primary px-5 py-3 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white"
            onClick={onAdd}
          >
            Add Card
          </button>
          <button
            type="button"
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onRun}
            disabled={disabled}
          >
            {running ? 'Running Batch...' : 'Run Batch'}
          </button>
        </div>
      </div>
    </Panel>
  )
}
