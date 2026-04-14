import { useEffect, useState } from 'react'
import RuntimeConfigSection from './components/RuntimeConfigSection.jsx'
import VaultPickerSection from './components/VaultPickerSection.jsx'
import TaskEditorSection from './components/TaskEditorSection.jsx'
import ResultsSection from './components/ResultsSection.jsx'
import { getChains, getProtocols, getRuntimeHealth, runBatch, searchVaults } from './lib/api.js'
import { buildBatchPayload, createTask, getTaskIssues } from './lib/task-model.js'
import { loadStoredRuntimeConfig, saveStoredRuntimeConfig } from './lib/storage.js'

const defaultRuntime = {
  baseUrl: 'http://127.0.0.1:8787',
  token: '',
  mode: 'plan-only',
  walletAddress: '',
}

const defaultFilters = {
  chainId: '',
  protocol: '',
  sortBy: 'apy',
  vaultAddress: '',
  limit: '20',
}

export default function App() {
  const stored = loadStoredRuntimeConfig()
  const [runtime, setRuntime] = useState({
    ...defaultRuntime,
    ...(stored ?? {}),
    token: '',
  })
  const [health, setHealth] = useState({
    status: 'unknown',
    label: 'Unknown',
    message: 'Health check has not run yet.',
  })
  const [pinging, setPinging] = useState(false)
  const [chains, setChains] = useState([])
  const [protocols, setProtocols] = useState([])
  const [filters, setFilters] = useState(defaultFilters)
  const [vaults, setVaults] = useState([])
  const [selectedVault, setSelectedVault] = useState(null)
  const [searching, setSearching] = useState(false)
  const [tasks, setTasks] = useState([createTask(1)])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const taskIssuesById = Object.fromEntries(
    tasks.map(task => [task.id, getTaskIssues(task, runtime.walletAddress)]),
  )

  useEffect(() => {
    async function bootstrap() {
      const [chainsPayload, protocolsPayload] = await Promise.all([
        getChains(),
        getProtocols(),
      ])
      setChains(chainsPayload.items ?? [])
      setProtocols(protocolsPayload.items ?? [])
    }

    bootstrap().catch(error => {
      setHealth({
        status: 'offline',
        label: 'Load Error',
        message: error.message,
      })
    })
  }, [])

  useEffect(() => {
    saveStoredRuntimeConfig({
      baseUrl: runtime.baseUrl,
      mode: runtime.mode,
      walletAddress: runtime.walletAddress,
    })
  }, [runtime.baseUrl, runtime.mode, runtime.walletAddress])

  function updateRuntime(field, value) {
    setRuntime(current => ({
      ...current,
      [field]: value,
    }))
  }

  async function handlePingRuntime() {
    setPinging(true)
    setHealth({
      status: 'busy',
      label: 'Checking',
      message: 'Checking runtime health endpoint...',
    })

    try {
      const payload = await getRuntimeHealth(runtime)
      setHealth({
        status: 'healthy',
        label: 'Healthy',
        message: `Runtime responded at ${payload.now}. Uptime ${Math.round((payload.uptimeMs ?? 0) / 1000)}s.`,
      })
    } catch (error) {
      setHealth({
        status: 'offline',
        label: 'Offline',
        message: error.message,
      })
    } finally {
      setPinging(false)
    }
  }

  function updateFilters(field, value) {
    setFilters(current => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleSearchVaults() {
    setSearching(true)
    try {
      const payload = await searchVaults(filters)
      setVaults(payload.items ?? [])
      setSelectedVault(null)
    } catch (error) {
      setHealth({
        status: 'offline',
        label: 'Search Error',
        message: error.message,
      })
    } finally {
      setSearching(false)
    }
  }

  function addTask() {
    setTasks(current => [...current, createTask(current.length + 1)])
  }

  function removeTask(taskId) {
    setTasks(current => (current.length <= 1 ? current : current.filter(task => task.id !== taskId)))
  }

  function duplicateTask(taskId) {
    setTasks(current => {
      const found = current.find(task => task.id === taskId)
      if (!found) {
        return current
      }
      return [...current, { ...found, id: `task-${current.length + 1}` }]
    })
  }

  function updateTask(taskId, field, value) {
    setTasks(current =>
      current.map(task => (task.id === taskId ? { ...task, [field]: value } : task)),
    )
  }

  async function handleRunBatch() {
    if (!selectedVault) {
      return
    }

    setRunning(true)
    try {
      const hasIssues = tasks.some(task => (taskIssuesById[task.id] ?? []).length > 0)
      if (hasIssues) {
        setHealth({
          status: 'offline',
          label: 'Validation Error',
          message: 'Fix the highlighted task fields before running the batch.',
        })
        return
      }

      const payload = buildBatchPayload({
        runtime,
        destinationVault: selectedVault,
        tasks,
      })
      const nextResult = await runBatch(payload)
      setResult(nextResult)
    } catch (error) {
      setResult({
        summary: {
          total: 0,
          completed: 0,
          failed: 0,
          nonTerminal: 0,
          elapsedMs: 0,
        },
        items: [],
        error: error.message,
      })
      setHealth({
        status: 'offline',
        label: 'Run Error',
        message: error.message,
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-screen text-primary">
      <header className="border-b border-black/5">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-6 py-10 lg:px-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted">
                Cross-Chain Yield Consolidation
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Sweep fragmented assets into one vault with a real runtime-backed UI
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
                Discover a destination vault through the local BFF, infer bridge routes automatically,
                and submit coordinated batch tasks without hand-writing JSON.
              </p>
            </div>

            <div className="rounded-full border border-outline bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-muted">
              React + Vite + Local BFF
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-8 px-6 py-8 lg:px-10 lg:py-10">
        <RuntimeConfigSection
          runtime={runtime}
          onChange={updateRuntime}
          onPing={handlePingRuntime}
          pinging={pinging}
          health={health}
        />

        <VaultPickerSection
          chains={chains}
          protocols={protocols}
          filters={filters}
          onChange={updateFilters}
          onSearch={handleSearchVaults}
          searching={searching}
          vaults={vaults}
          selectedVault={selectedVault}
          onSelectVault={setSelectedVault}
        />

        <TaskEditorSection
          tasks={tasks}
          chains={chains}
          destinationVault={selectedVault}
          taskIssuesById={taskIssuesById}
          onAdd={addTask}
          onRemove={removeTask}
          onDuplicate={duplicateTask}
          onChange={updateTask}
          onRun={handleRunBatch}
          running={running}
        />

        <ResultsSection result={result} />
      </main>
    </div>
  )
}
