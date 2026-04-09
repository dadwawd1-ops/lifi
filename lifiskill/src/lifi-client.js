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

export class LiFiApiError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'LiFiApiError'
    this.status = details.status
    this.code = details.code
    this.payload = details.payload
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export class LiFiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? 'https://li.quest/v1'
    this.apiKey = options.apiKey
    this.integrator = options.integrator
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
      )
    }
  }

  createHeaders() {
    const headers = {
      Accept: 'application/json',
    }

    if (this.apiKey) {
      headers['x-lifi-api-key'] = this.apiKey
    }

    return headers
  }

  async get(path, params = {}) {
    const allParams = { ...params }
    if (this.integrator && !allParams.integrator) {
      allParams.integrator = this.integrator
    }

    const queryString = toQueryString(allParams)
    const url = queryString
      ? `${this.baseUrl}${path}?${queryString}`
      : `${this.baseUrl}${path}`

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.createHeaders(),
    })

    const text = await response.text()
    const payload = text ? safeJsonParse(text) : null

    if (!response.ok) {
      throw new LiFiApiError(
        `LI.FI request failed with status ${response.status}`,
        {
          status: response.status,
          code: payload?.code,
          payload,
        },
      )
    }

    return payload
  }

  async post(path, body = {}) {
    const params = {}
    if (this.integrator) {
      params.integrator = this.integrator
    }
    const queryString = toQueryString(params)
    const url = queryString
      ? `${this.baseUrl}${path}?${queryString}`
      : `${this.baseUrl}${path}`

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...this.createHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const text = await response.text()
    const payload = text ? safeJsonParse(text) : null

    if (!response.ok) {
      throw new LiFiApiError(
        `LI.FI request failed with status ${response.status}`,
        {
          status: response.status,
          code: payload?.code,
          payload,
        },
      )
    }
    return payload
  }

  async getQuote(params) {
    const required = [
      'fromChain',
      'toChain',
      'fromToken',
      'toToken',
      'fromAmount',
      'fromAddress',
    ]
    for (const field of required) {
      if (!isDefined(params?.[field])) {
        throw new Error(`Missing required LI.FI quote parameter: ${field}`)
      }
    }
    return this.get('/quote', params)
  }

  async getStatus(params) {
    if (!isDefined(params?.txHash)) {
      throw new Error('Missing required LI.FI status parameter: txHash')
    }
    return this.get('/status', params)
  }

  async executeRoute(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Missing execute payload')
    }
    return this.post('/advanced/stepTransaction', params)
  }
}
