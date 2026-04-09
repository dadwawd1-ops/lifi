function isDefined(value) {
  return value !== undefined && value !== null && value !== ''
}

function toQueryString(params) {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (!isDefined(value)) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isDefined(item)) {
          search.append(key, String(item))
        }
      }
      continue
    }

    search.set(key, String(value))
  }

  return search.toString()
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function encodePathPart(value) {
  return encodeURIComponent(String(value))
}

function extractItems(payload, preferredKeys = []) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const keys = [
    ...preferredKeys,
    'data',
    'items',
    'vaults',
    'positions',
    'results',
  ]

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key]
    }
  }

  return []
}

function extractNextCursor(payload) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const cursor = payload.nextCursor
  if (typeof cursor === 'string' && cursor.length > 0) {
    return cursor
  }

  return null
}

export class LiFiEarnApiError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'LiFiEarnApiError'
    this.status = details.status
    this.code = details.code
    this.payload = details.payload
  }
}

export class EarnClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? 'https://earn.li.fi'
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
      )
    }
  }

  createHeaders() {
    return {
      Accept: 'application/json',
    }
  }

  async get(path, params = {}) {
    const queryString = toQueryString(params)
    const url = queryString ? `${this.baseUrl}${path}?${queryString}` : `${this.baseUrl}${path}`

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.createHeaders(),
    })

    const text = await response.text()
    const payload = text ? safeJsonParse(text) : null

    if (!response.ok) {
      throw new LiFiEarnApiError(
        `LI.FI Earn request failed with status ${response.status}`,
        {
          status: response.status,
          code: payload?.code,
          payload,
        },
      )
    }

    return payload
  }

  async getVaults(params = {}) {
    return this.get('/v1/earn/vaults', params)
  }

  async getVault(network, address) {
    if (!isDefined(network) || !isDefined(address)) {
      throw new Error('getVault requires both network and address')
    }

    return this.get(
      `/v1/earn/vaults/${encodePathPart(network)}/${encodePathPart(address)}`,
    )
  }

  async getChains(params = {}) {
    return this.get('/v1/earn/chains', params)
  }

  async getProtocols(params = {}) {
    return this.get('/v1/earn/protocols', params)
  }

  async getPortfolioPositions(userAddress, params = {}) {
    if (!isDefined(userAddress)) {
      throw new Error('getPortfolioPositions requires userAddress')
    }

    return this.get(
      `/v1/earn/portfolio/${encodePathPart(userAddress)}/positions`,
      params,
    )
  }

  async getAllVaults(params = {}, options = {}) {
    return this.getAllPages('/v1/earn/vaults', params, {
      ...options,
      preferredKeys: ['data', 'vaults'],
    })
  }

  async getAllPortfolioPositions(userAddress, params = {}, options = {}) {
    if (!isDefined(userAddress)) {
      throw new Error('getAllPortfolioPositions requires userAddress')
    }

    return this.getAllPages(
      `/v1/earn/portfolio/${encodePathPart(userAddress)}/positions`,
      params,
      {
        ...options,
        preferredKeys: ['positions', 'data'],
      },
    )
  }

  async getAllPages(path, params = {}, options = {}) {
    const maxPages = Number.isInteger(options.maxPages) && options.maxPages > 0
      ? options.maxPages
      : 20
    const preferredKeys = Array.isArray(options.preferredKeys)
      ? options.preferredKeys
      : []

    const baseParams = { ...params }
    let cursor = isDefined(baseParams.cursor) ? String(baseParams.cursor) : null
    delete baseParams.cursor

    const items = []
    const pages = []
    let nextCursor = null
    let hasMore = false

    for (let page = 0; page < maxPages; page += 1) {
      const requestParams = { ...baseParams }
      if (isDefined(cursor)) {
        requestParams.cursor = cursor
      }

      const payload = await this.get(path, requestParams)
      pages.push(payload)
      items.push(...extractItems(payload, preferredKeys))

      const pageNextCursor = extractNextCursor(payload)
      if (!isDefined(pageNextCursor)) {
        hasMore = false
        nextCursor = null
        break
      }

      hasMore = true
      nextCursor = pageNextCursor
      cursor = pageNextCursor
    }

    return {
      items,
      pages,
      nextCursor,
      hasMore,
      pageCount: pages.length,
    }
  }
}
