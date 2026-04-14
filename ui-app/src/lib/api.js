async function parseJson(response) {
  const payload = await response.json()
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message ?? `Request failed with status ${response.status}`)
  }
  return payload
}

export async function getRuntimeHealth(runtime) {
  const params = new URLSearchParams()
  if (runtime?.baseUrl) {
    params.set('baseUrl', runtime.baseUrl)
  }
  const query = params.toString()
  const headers = {}
  if (runtime?.token) {
    headers.Authorization = `Bearer ${runtime.token}`
  }
  const response = await fetch(`/api/runtime/health${query ? `?${query}` : ''}`, {
    headers,
  })
  return parseJson(response)
}

export async function getChains() {
  const response = await fetch('/api/earn/chains')
  return parseJson(response)
}

export async function getProtocols() {
  const response = await fetch('/api/earn/protocols')
  return parseJson(response)
}

export async function searchVaults(filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    params.set(key, String(value))
  }
  const response = await fetch(`/api/earn/vaults?${params.toString()}`)
  return parseJson(response)
}

export async function runBatch(payload) {
  const response = await fetch('/api/runtime/run-batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseJson(response)
}
