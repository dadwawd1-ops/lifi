import Panel from './Panel.jsx'
import StatusBadge from './StatusBadge.jsx'

function pickState(item) {
  return (
    item?.runtimeResponse?.state ??
    item?.runtimeResponse?.result?.state ??
    item?.error?.state ??
    'unknown'
  )
}

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

export default function ResultsSection({ result }) {
  const summary = result?.summary ?? {
    total: 0,
    completed: 0,
    failed: 0,
    nonTerminal: 0,
    elapsedMs: 0,
  }
  const items = result?.items ?? []

  return (
    <Panel
      title="Batch Result Journal"
      eyebrow="Execution Trace"
      aside={<span className="text-sm text-muted">{summary.total} task(s) in journal</span>}
    >
      <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-[24px] border border-outline bg-surface-low p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Total</p>
            <p className="mt-3 text-3xl font-semibold text-primary">{summary.total}</p>
          </div>
          <div className="rounded-[24px] border border-outline bg-surface-low p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Completed</p>
            <p className="mt-3 text-3xl font-semibold text-primary">{summary.completed}</p>
          </div>
          <div className="rounded-[24px] border border-outline bg-surface-low p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Failed</p>
            <p className="mt-3 text-3xl font-semibold text-tertiary">{summary.failed}</p>
          </div>
          <div className="rounded-[24px] border border-outline bg-surface-low p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Non-terminal</p>
            <p className="mt-3 text-3xl font-semibold text-primary">{summary.nonTerminal}</p>
            <p className="mt-2 text-xs text-muted">Elapsed {summary.elapsedMs}ms</p>
          </div>
        </div>

        <div className="space-y-4">
          {items.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-outline bg-surface-low p-6 text-sm text-muted">
              Run a batch to render task journals and raw runtime responses here.
            </div>
          ) : (
            items.map((item, index) => {
              const state = pickState(item)
              const logs = item.runtimeResponse?.logs?.slice(0, 4) ?? []
              return (
                <article key={`${item.task?.id ?? index}-${index}`} className="rounded-[24px] border border-outline bg-surface-low p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                        Task {index + 1}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-primary">
                        {item.task?.sourceToken} from chain {item.task?.fromChain}
                      </p>
                      <p className="mt-1 text-sm text-muted">{item.inferredSkill}</p>
                    </div>
                    <StatusBadge label={state} tone={state} />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">txHash</p>
                      <p className="mt-3 break-all font-mono text-xs text-primary">
                        {item.runtimeResponse?.txHash ?? 'None'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">depositTxHash</p>
                      <p className="mt-3 break-all font-mono text-xs text-primary">
                        {item.runtimeResponse?.depositTxHash ?? 'None'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Logs</p>
                      <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-primary">
                        {logs.length > 0 ? logs.join('\n') : item.error?.message ?? 'No logs'}
                      </pre>
                    </div>
                  </div>

                  <details className="mt-4 rounded-2xl bg-[#0f1915] p-4 text-[#d5efe0]">
                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.18em]">
                      Raw response
                    </summary>
                    <pre className="mt-4 overflow-auto text-xs leading-5">
                      {formatJson({
                        translatedRequest: item.translatedRequest,
                        runtimeResponse: item.runtimeResponse,
                        error: item.error,
                      })}
                    </pre>
                  </details>
                </article>
              )
            })
          )}
        </div>
      </div>
    </Panel>
  )
}
