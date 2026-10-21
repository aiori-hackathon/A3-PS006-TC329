import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server } from 'socket.io'
import {
  MAX_PAYLOAD_BYTES,
  ALLOWED_EVENT_TYPES,
  verifyRealtimeToken,
  isValidEvent,
} from './validator.ts'

// Fixed port: read REALTIME_PORT but default to 3033 (never PORT).
const PORT = Number(process.env.REALTIME_PORT ?? 3033) || 3033
// Shared token required on POST /publish (header: x-lab-token).
const TOKEN = process.env.REALTIME_TOKEN ?? 'interlock-dev-token'
const IS_PROD = process.env.NODE_ENV === 'production'

// Fail startup in production if secret is missing or default
if (IS_PROD && (!process.env.REALTIME_TOKEN || process.env.REALTIME_TOKEN === 'interlock-dev-token')) {
  console.error('[security] FATAL: REALTIME_TOKEN must be explicitly set to a strong non-default secret in production.')
  process.exit(1)
}
// Parse allowed origins
const rawOrigins = process.env.ALLOWED_ORIGINS ?? '*'
if (IS_PROD && rawOrigins === '*' && process.env.ALLOW_INSECURE_DEMO_MODE !== 'true') {
  console.error('[security] FATAL: ALLOWED_ORIGINS must be explicitly configured in production (wildcard "*" is forbidden).')
  process.exit(1)
}
const allowedOrigins = rawOrigins === '*' ? '*' : rawOrigins.split(',').map((o) => o.trim())

const httpServer = createServer()

// Configure Socket.IO on standard path /socket.io
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Connection-level origin verification guard
io.use((socket, next) => {
  const origin = socket.handshake.headers.origin
  if (IS_PROD && allowedOrigins !== '*') {
    if (!origin || !allowedOrigins.includes(origin)) {
      return next(new Error('disallowed_origin'))
    }
  }
  next()
})

// Also capture listeners to support fallback root path "/" for engine.io if requested
const socketIoListeners = httpServer.listeners('request') as Array<
  (req: IncomingMessage, res: ServerResponse) => void
>
httpServer.removeAllListeners('request')

httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
  let pathname = ''
  let isEngineTraffic = false
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    pathname = url.pathname
    isEngineTraffic =
      pathname.startsWith('/socket.io') ||
      url.searchParams.has('EIO') ||
      url.searchParams.has('transport')
  } catch {
    isEngineTraffic = false
  }

  if (isEngineTraffic) {
    for (const listener of socketIoListeners) listener.call(httpServer, req, res)
    return
  }

  handleRest(req, res, pathname)
})

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

// Simple IP-based rate limiter for publishing with bounded memory
const MAX_RATE_LIMIT_ENTRIES = 5000
const publishRateMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  if (publishRateMap.size > MAX_RATE_LIMIT_ENTRIES) {
    for (const [key, val] of publishRateMap.entries()) {
      if (now > val.resetAt) publishRateMap.delete(key)
    }
  }
  const entry = publishRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    publishRateMap.set(ip, { count: 1, resetAt: now + 10000 })
    return false
  }
  entry.count += 1
  return entry.count > 1000 // 1000 requests per 10s
}

function handleRest(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  // Liveness probe for ops/internal checks
  if (req.method === 'GET' && pathname === '/healthz') {
    send(res, 200, { ok: true, clients: io.engine.clientsCount })
    return
  }

  // Server-to-server fan-out entry (engine -> bridge, never through external gateway)
  if (req.method === 'POST' && pathname === '/publish') {
    const clientIp = req.socket.remoteAddress ?? 'unknown'
    if (isRateLimited(clientIp)) {
      send(res, 429, { error: 'rate_limited', message: 'Too many publish requests' })
      return
    }

    if (!verifyRealtimeToken(req.headers['x-lab-token'], TOKEN)) {
      send(res, 401, { error: 'unauthorized', message: 'Invalid or missing authentication token' })
      return
    }

    let body = ''
    let size = 0
    let rejected = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_PAYLOAD_BYTES) {
        rejected = true
        send(res, 413, { error: 'payload_too_large', message: 'Payload exceeds maximum limit of 512KB' })
        req.destroy()
        return
      }
      body += chunk.toString()
    })

    req.on('error', () => {
      if (!rejected) send(res, 400, { error: 'bad_request', message: 'Request read error' })
    })

    req.on('end', () => {
      if (rejected) return

      let events: unknown
      try {
        const parsed = JSON.parse(body) as { events?: unknown } | null
        events = parsed?.events
      } catch {
        send(res, 400, { error: 'bad_request', message: 'Malformed JSON payload' })
        return
      }

      if (!Array.isArray(events)) {
        send(res, 400, { error: 'bad_request', message: "'events' must be an array" })
        return
      }

      // Validate each event in the batch
      for (let i = 0; i < events.length; i++) {
        if (!isValidEvent(events[i])) {
          send(res, 400, {
            error: 'bad_request',
            message: `Event at index ${i} is malformed or has an invalid event type`,
          })
          return
        }
      }

      // Broadcast the validated batch as ONE message on channel "lab"
      io.emit('lab', { events })
      send(res, 200, { ok: true, delivered: events.length })
    })
    return
  }

  send(res, 404, { error: 'not_found' })
}

io.on('connection', (socket) => {
  console.log(`[ws] connect ${socket.id} clients=${io.engine.clientsCount}`)
  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnect ${socket.id} reason=${reason} clients=${io.engine.clientsCount}`)
  })
})

const HOST = process.env.REALTIME_HOST ?? '127.0.0.1'

httpServer.listen(PORT, HOST, () => {
  console.log(`Realtime bridge listening on ${HOST}:${PORT} (socket.io path "/socket.io" and "/")`)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down server...')
  io.close(() => {
    console.log('Realtime bridge closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down server...')
  io.close(() => {
    console.log('Realtime bridge closed')
    process.exit(0)
  })
})
