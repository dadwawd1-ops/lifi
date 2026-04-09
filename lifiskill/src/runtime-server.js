import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 8787,
  maxBodyBytes: 1_000_000,
  trustedProxy: false,
  requestIdHeader: 'x-request-id',
}

function toFiniteInteger(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.floor(n)
}

function parseAuthToken(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const trimmed = auth.trim()
    const match = /^bearer\s+(.+)$/i.exec(trimmed)
    if (match) {
      return match[1].trim()
    }
  }
  const headerToken = req.headers['x-runtime-token']
  if (typeof headerToken === 'string') {
    return headerToken.trim()
  }
  return ''
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

function readJsonBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0

    req.on('data', chunk => {
      total += chunk.length
      if (total > maxBodyBytes) {
        reject(new Error(`Request body exceeds maxBodyBytes=${maxBodyBytes}`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        const err = new Error('Invalid JSON request body')
        err.code = 'INVALID_JSON'
        reject(err)
      }
    })

    req.on('error', reject)
  })
}

function isMethod(req, method) {
  return String(req.method ?? '').toUpperCase() === method
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

function normalizeIp(value) {
  if (typeof value !== 'string') {
    return ''
  }
  let ip = value.trim()
  if (!ip) {
    return ''
  }

  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'))
  }

  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'))
  }

  if (ip.includes('%')) {
    ip = ip.slice(0, ip.indexOf('%'))
  }

  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length)
    if (isIP(mapped) === 4) {
      return mapped
    }
  }
  return ip
}

function getClientIp(req, trustedProxy) {
  if (trustedProxy) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
      const first = forwarded.split(',')[0].trim()
      const ip = normalizeIp(first)
      if (isIP(ip) !== 0) {
        return ip
      }
    }
  }

  const remote = normalizeIp(req.socket?.remoteAddress ?? '')
  return isIP(remote) === 0 ? '' : remote
}

function parseIPv4ToBigInt(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4: ${ip}`)
  }
  let out = 0n
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Invalid IPv4: ${ip}`)
    }
    out = (out << 8n) + BigInt(n)
  }
  return out
}

function parseIPv6ToBigInt(ip) {
  const src = ip.toLowerCase()
  const hasDoubleColon = src.includes('::')
  const segments = hasDoubleColon ? src.split('::') : [src]
  if (segments.length > 2) {
    throw new Error(`Invalid IPv6: ${ip}`)
  }

  const head = segments[0] ? segments[0].split(':').filter(Boolean) : []
  const tail = segments[1] ? segments[1].split(':').filter(Boolean) : []

  function expandIpv4Tail(parts) {
    if (parts.length === 0) {
      return parts
    }
    const last = parts[parts.length - 1]
    if (!last.includes('.')) {
      return parts
    }
    if (isIP(last) !== 4) {
      throw new Error(`Invalid embedded IPv4 in IPv6: ${ip}`)
    }
    const v4 = parseIPv4ToBigInt(last)
    const high = Number((v4 >> 16n) & 0xffffn).toString(16)
    const low = Number(v4 & 0xffffn).toString(16)
    return [...parts.slice(0, -1), high, low]
  }

  const headExpanded = expandIpv4Tail(head)
  const tailExpanded = expandIpv4Tail(tail)
  const missing = 8 - (headExpanded.length + tailExpanded.length)
  if ((!hasDoubleColon && missing !== 0) || missing < 0) {
    throw new Error(`Invalid IPv6: ${ip}`)
  }

  const full = hasDoubleColon
    ? [
        ...headExpanded,
        ...Array.from({ length: missing }, () => '0'),
        ...tailExpanded,
      ]
    : headExpanded

  if (full.length !== 8) {
    throw new Error(`Invalid IPv6: ${ip}`)
  }

  let out = 0n
  for (const part of full) {
    const n = Number.parseInt(part, 16)
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
      throw new Error(`Invalid IPv6: ${ip}`)
    }
    out = (out << 16n) + BigInt(n)
  }
  return out
}

function toIpBigInt(ip) {
  const version = isIP(ip)
  if (version === 4) {
    return { version, bits: 32, value: parseIPv4ToBigInt(ip) }
  }
  if (version === 6) {
    return { version, bits: 128, value: parseIPv6ToBigInt(ip) }
  }
  throw new Error(`Invalid IP address: ${ip}`)
}

function cidrMask(bits, prefix) {
  if (prefix <= 0) {
    return 0n
  }
  if (prefix >= bits) {
    return (1n << BigInt(bits)) - 1n
  }
  return (((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix))
}

function compileAllowlist(allowlist) {
  if (!Array.isArray(allowlist)) {
    return []
  }
  const rules = []
  for (const raw of allowlist) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      continue
    }
    const item = raw.trim()
    const [ipPart, prefixPart] = item.split('/')
    const ip = normalizeIp(ipPart)
    if (isIP(ip) === 0) {
      throw new Error(`Invalid allowlist entry: ${item}`)
    }
    const parsed = toIpBigInt(ip)
    const prefix =
      prefixPart === undefined
        ? parsed.bits
        : Number.parseInt(prefixPart, 10)
    if (
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > parsed.bits
    ) {
      throw new Error(`Invalid CIDR prefix in allowlist entry: ${item}`)
    }
    const mask = cidrMask(parsed.bits, prefix)
    rules.push({
      raw: item,
      version: parsed.version,
      bits: parsed.bits,
      prefix,
      mask,
      network: parsed.value & mask,
    })
  }
  return rules
}

function isIpAllowed(ip, compiledAllowlist) {
  if (compiledAllowlist.length === 0) {
    return true
  }
  if (isIP(ip) === 0) {
    return false
  }
  const parsed = toIpBigInt(ip)
  for (const rule of compiledAllowlist) {
    if (rule.version !== parsed.version) {
      continue
    }
    const masked = parsed.value & rule.mask
    if (masked === rule.network) {
      return true
    }
  }
  return false
}

function readRequestId(req, headerName) {
  const raw = req.headers[headerName]
  if (typeof raw === 'string') {
    const id = raw.trim()
    if (id.length > 0 && id.length <= 128) {
      return id
    }
  }
  return randomUUID()
}

function createLogWriter(customWriter) {
  if (typeof customWriter === 'function') {
    return customWriter
  }
  return entry => {
    console.log(JSON.stringify(entry))
  }
}

export function createRuntimeServer(options = {}) {
  if (!options.runtime || typeof options.runtime !== 'object') {
    throw new Error('createRuntimeServer requires `runtime`')
  }
  if (typeof options.runtime.runSkill !== 'function') {
    throw new Error('runtime.runSkill is required')
  }
  if (typeof options.runtime.evaluateRollout !== 'function') {
    throw new Error('runtime.evaluateRollout is required')
  }

  const runtime = options.runtime
  const config = {
    host: options.host ?? DEFAULT_CONFIG.host,
    port: toFiniteInteger(options.port, DEFAULT_CONFIG.port),
    maxBodyBytes: toFiniteInteger(
      options.maxBodyBytes,
      DEFAULT_CONFIG.maxBodyBytes,
    ),
    trustedProxy: parseBoolean(
      options.trustedProxy,
      DEFAULT_CONFIG.trustedProxy,
    ),
    requestIdHeader:
      typeof options.requestIdHeader === 'string' &&
      options.requestIdHeader.trim().length > 0
        ? options.requestIdHeader.trim().toLowerCase()
        : DEFAULT_CONFIG.requestIdHeader,
  }
  const logWriter = createLogWriter(options.logWriter)
  const compiledAllowlist = compileAllowlist(options.ipAllowlist ?? [])
  const authToken =
    typeof options.authToken === 'string' && options.authToken.trim().length > 0
      ? options.authToken.trim()
      : null

  const startedAt = Date.now()
  const server = createServer(async (req, res) => {
    const start = Date.now()
    const requestId = readRequestId(req, config.requestIdHeader)
    const ip = getClientIp(req, config.trustedProxy)
    const method = String(req.method ?? '').toUpperCase()
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname
    const authProvided =
      typeof req.headers.authorization === 'string' ||
      typeof req.headers['x-runtime-token'] === 'string'
    let responded = false

    function respond(statusCode, payload, meta = {}) {
      if (responded) {
        return
      }
      responded = true
      const body =
        payload && typeof payload === 'object'
          ? { ...payload, requestId }
          : payload
      writeJson(res, statusCode, body, {
        'x-request-id': requestId,
      })
      logWriter({
        ts: new Date().toISOString(),
        event: 'runtime_http_access',
        requestId,
        method,
        path,
        statusCode,
        durationMs: Date.now() - start,
        ip,
        authEnabled: Boolean(authToken),
        authProvided,
        authorized: meta.authorized ?? true,
        errorCode: meta.errorCode ?? null,
        skillId: meta.skillId ?? null,
      })
    }

    try {
      if (path === '/healthz' && isMethod(req, 'GET')) {
        respond(200, {
          ok: true,
          uptimeMs: Date.now() - startedAt,
          now: new Date().toISOString(),
        })
        return
      }

      if (!isMethod(req, 'POST')) {
        respond(
          405,
          {
            ok: false,
            error: {
              code: 'METHOD_NOT_ALLOWED',
              message: `Method ${method} is not allowed for ${path}`,
            },
          },
          {
            errorCode: 'METHOD_NOT_ALLOWED',
          },
        )
        return
      }

      if (!isIpAllowed(ip, compiledAllowlist)) {
        respond(
          403,
          {
            ok: false,
            error: {
              code: 'FORBIDDEN_IP',
              message: `IP is not in allowlist: ${ip || 'unknown'}`,
            },
          },
          {
            authorized: false,
            errorCode: 'FORBIDDEN_IP',
          },
        )
        return
      }

      if (authToken) {
        const token = parseAuthToken(req)
        if (token !== authToken) {
          respond(
            401,
            {
              ok: false,
              error: {
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid runtime token',
              },
            },
            {
              authorized: false,
              errorCode: 'UNAUTHORIZED',
            },
          )
          return
        }
      }

      const body = await readJsonBody(req, config.maxBodyBytes)

      if (path === '/evaluate-rollout') {
        const result = await runtime.evaluateRollout(body?.context ?? null)
        respond(200, {
          ok: true,
          result,
        })
        return
      }

      if (path === '/run-skill') {
        const skillId = body?.skillId
        const result = await runtime.runSkill({
          skillId,
          input: body?.input,
          actorId: body?.actorId,
          featureFlags: body?.featureFlags,
          policyConfig: body?.policyConfig,
          pollingConfig: body?.pollingConfig,
          quotePolicy: body?.quotePolicy,
          approvalProvider: options.approvalProvider,
          riskChecker: options.riskChecker,
          addressScreener: options.addressScreener,
          quoteTool: options.quoteTool,
          executeTool: options.executeTool,
          statusTool: options.statusTool,
        })
        respond(
          200,
          {
            ok: true,
            result,
          },
          {
            skillId: typeof skillId === 'string' ? skillId : null,
          },
        )
        return
      }

      respond(
        404,
        {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: `Unknown endpoint: ${path}`,
          },
        },
        {
          errorCode: 'NOT_FOUND',
        },
      )
    } catch (error) {
      const statusCode =
        error?.code === 'INVALID_JSON'
          ? 400
          : error?.code === 'UNSUPPORTED_SKILL'
            ? 400
            : 500
      respond(
        statusCode,
        {
          ok: false,
          error: {
            code: error?.code ?? 'RUNTIME_SERVER_ERROR',
            message: error?.message ?? 'Unhandled runtime server error',
          },
        },
        {
          errorCode: error?.code ?? 'RUNTIME_SERVER_ERROR',
        },
      )
    }
  })

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, resolve)
    })
    const addr = server.address()
    const host = typeof addr === 'object' && addr ? addr.address : config.host
    const port = typeof addr === 'object' && addr ? addr.port : config.port
    return {
      host,
      port,
      url: `http://${host}:${port}`,
    }
  }

  async function stop() {
    await new Promise(resolve => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(resolve)
    })
  }

  return {
    start,
    stop,
    server,
    config,
  }
}
