import Panel from './Panel.jsx'
import StatusBadge from './StatusBadge.jsx'

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'N/A'
  }
  const number = Number(value)
  if (Math.abs(number) >= 1_000_000_000) {
    return `${(number / 1_000_000_000).toFixed(2)}B${suffix}`
  }
  if (Math.abs(number) >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(2)}M${suffix}`
  }
  if (Math.abs(number) >= 1_000) {
    return `${(number / 1_000).toFixed(2)}K${suffix}`
  }
  return `${number.toFixed(2)}${suffix}`
}

export default function VaultPickerSection({
  chains,
  protocols,
  filters,
  onChange,
  onSearch,
  searching,
  vaults,
  selectedVault,
  onSelectVault,
}) {
  return (
    <Panel
      title="Destination Vault Picker"
      eyebrow="LI.FI Earn Search"
      aside={
        selectedVault ? <StatusBadge label={`Selected: ${selectedVault.name}`} tone="completed" /> : null
      }
    >
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Target Chain
              </span>
              <select
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={filters.chainId}
                onChange={event => onChange('chainId', event.target.value)}
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
                Protocol
              </span>
              <select
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={filters.protocol}
                onChange={event => onChange('protocol', event.target.value)}
              >
                <option value="">All protocols</option>
                {protocols.map(protocol => (
                  <option key={protocol.id} value={protocol.name}>
                    {protocol.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Sort By
              </span>
              <select
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={filters.sortBy}
                onChange={event => onChange('sortBy', event.target.value)}
              >
                <option value="apy">apy</option>
                <option value="tvl">tvl</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Exact Vault
              </span>
              <input
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={filters.vaultAddress}
                onChange={event => onChange('vaultAddress', event.target.value)}
                placeholder="0x..."
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
                Result Limit
              </span>
              <input
                className="rounded-2xl border border-outline bg-surface px-4 py-3 text-sm text-primary outline-none transition focus:border-primary"
                value={filters.limit}
                onChange={event => onChange('limit', event.target.value)}
                placeholder="20"
              />
            </label>
          </div>

          <button
            type="button"
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSearch}
            disabled={searching || !filters.chainId}
          >
            {searching ? 'Searching...' : 'Search Vaults'}
          </button>
        </div>

        <div className="space-y-3">
          {vaults.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-outline bg-surface-low p-6 text-sm text-muted">
              Search vaults to load normalized destination options.
            </div>
          ) : (
            vaults.map(vault => {
              const isSelected = selectedVault?.address === vault.address
              return (
                <button
                  key={`${vault.address}-${vault.chainId}`}
                  type="button"
                  className={`w-full rounded-[24px] border p-5 text-left transition ${
                    isSelected
                      ? 'border-primary bg-primary text-white'
                      : 'border-outline bg-white hover:border-primary'
                  }`}
                  onClick={() => onSelectVault(vault)}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-lg font-semibold">{vault.name}</p>
                      <p className={`mt-1 text-sm ${isSelected ? 'text-white/80' : 'text-muted'}`}>
                        {vault.protocol} on chain {vault.chainId}
                      </p>
                    </div>
                    <StatusBadge
                      label={vault.isTransactional ? 'Transactional' : 'Read-only'}
                      tone={vault.isTransactional ? 'completed' : 'unknown'}
                    />
                  </div>

                  <div className={`mt-4 grid gap-3 text-xs md:grid-cols-4 ${isSelected ? 'text-white/90' : 'text-muted'}`}>
                    <div>
                      <p className="font-bold uppercase tracking-[0.18em]">APY</p>
                      <p className="mt-2 text-sm font-semibold">{formatMetric(vault.apy, '%')}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-[0.18em]">TVL</p>
                      <p className="mt-2 text-sm font-semibold">${formatMetric(vault.tvl)}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-[0.18em]">Deposit Token</p>
                      <p className="mt-2 break-all text-sm font-semibold">
                        {vault.depositToken?.symbol ?? vault.depositToken?.address ?? 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-[0.18em]">Redeemable</p>
                      <p className="mt-2 text-sm font-semibold">{vault.raw?.isRedeemable ? 'Yes' : 'Unknown'}</p>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </Panel>
  )
}
