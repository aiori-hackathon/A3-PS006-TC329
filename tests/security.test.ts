import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  verifyAdminAuth,
  assertAuthorized,
  UnauthorizedError,
  ForbiddenError,
  getAdminKey,
  createSessionToken,
  verifySessionToken,
  createSessionCookie,
  clearSessionCookie,
  DEFAULT_DEV_KEY,
} from '../src/server/lab/auth'
import {
  verifyRealtimeToken,
  isValidEvent,
  MAX_PAYLOAD_BYTES,
  ALLOWED_EVENT_TYPES,
} from '../mini-services/realtime/validator'

describe('Security & Gateway Hardening', () => {
  const adminKey = getAdminKey() ?? DEFAULT_DEV_KEY

  describe('Server-side Admin Authorization (assertAuthorized & verifyAdminAuth)', () => {
    it('rejects unauthenticated request with 401 UnauthorizedError', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
      })
      expect(verifyAdminAuth(req)).toBe(false)
      expect(() => assertAuthorized(req)).toThrow()
    })

    it('rejects request with wrong x-admin-key header', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: { 'x-admin-key': 'attacker-wrong-secret-token' },
      })
      expect(verifyAdminAuth(req)).toBe(false)
      expect(() => assertAuthorized(req)).toThrow()
    })

    it('rejects request with wrong Bearer token', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: { authorization: 'Bearer invalid-bearer-token' },
      })
      expect(verifyAdminAuth(req)).toBe(false)
      expect(() => assertAuthorized(req)).toThrow()
    })

    it('rejects request with wrong cookie', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: 'other=123; interlock_session=invalid-session-key; foo=bar',
        },
      })
      expect(verifyAdminAuth(req)).toBe(false)
      expect(() => assertAuthorized(req)).toThrow()
    })

    it('accepts request with valid x-admin-key header', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: { 'x-admin-key': adminKey },
      })
      expect(verifyAdminAuth(req)).toBe(true)
      expect(() => assertAuthorized(req)).not.toThrow()
    })

    it('accepts request with valid Bearer authorization header', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminKey}` },
      })
      expect(verifyAdminAuth(req)).toBe(true)
      expect(() => assertAuthorized(req)).not.toThrow()
    })

    it('accepts request with valid interlock_session cookie matching adminKey', () => {
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `theme=dark; interlock_session=${encodeURIComponent(adminKey)}; guest=0`,
        },
      })
      expect(verifyAdminAuth(req)).toBe(true)
      expect(() => assertAuthorized(req)).not.toThrow()
    })

    it('safely handles length mismatch without timing leaks or exceptions', () => {
      const shortReq = new Request('http://localhost:3000/api/lab/fault', {
        headers: { 'x-admin-key': 'a' },
      })
      const longReq = new Request('http://localhost:3000/api/lab/fault', {
        headers: { 'x-admin-key': 'a'.repeat(512) },
      })
      expect(verifyAdminAuth(shortReq)).toBe(false)
      expect(verifyAdminAuth(longReq)).toBe(false)
    })
  })

  describe('Signed Cryptographic Session Management & CSRF', () => {
    it('creates a signed session token that verifies successfully', () => {
      const token = createSessionToken()
      expect(typeof token).toBe('string')
      const session = verifySessionToken(token)
      expect(session).not.toBeNull()
      expect(session?.user).toBe('operator')
      expect(session?.expiresAt).toBeGreaterThan(Date.now())
    })

    it('rejects tampered session token signature', () => {
      const token = createSessionToken()
      const parts = token.split('.')
      // Alter signature
      parts[3] = parts[3].slice(0, -4) + 'ffff'
      const tampered = parts.join('.')
      expect(verifySessionToken(tampered)).toBeNull()
    })

    it('rejects expired session token', () => {
      const token = createSessionToken()
      const parts = token.split('.')
      // Set expiresAt to the past (1000ms ago)
      parts[2] = String(Date.now() - 1000)
      const expired = parts.join('.')
      expect(verifySessionToken(expired)).toBeNull()
    })

    it('accepts valid signed session cookie on mutation with matching origin', () => {
      const token = createSessionToken()
      const req = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `interlock_session=${token}`,
        },
      })
      expect(verifyAdminAuth(req)).toBe(true)
      expect(() => assertAuthorized(req)).not.toThrow()
    })

    it('rejects cookie authentication when origin mismatches (CSRF protection)', () => {
      const token = createSessionToken()
      const csrfReq = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://evil-attacker.com',
          cookie: `interlock_session=${token}`,
        },
      })
      expect(verifyAdminAuth(csrfReq)).toBe(false)
      expect(() => assertAuthorized(csrfReq)).toThrow()
    })

    it('safely handles malformed percent-encoded cookie without throwing uncaught server errors', () => {
      const malformedReq = new Request('http://localhost:3000/api/lab/fault', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: 'interlock_session=%E0%A4%A', // Malformed UTF-8 percent encoding
        },
      })
      expect(verifyAdminAuth(malformedReq)).toBe(false)
      expect(() => assertAuthorized(malformedReq)).toThrow()
    })

    it('generates secure HttpOnly SameSite=Strict cookie headers', () => {
      const token = createSessionToken()
      const cookieHeader = createSessionCookie(token)
      expect(cookieHeader).toContain('HttpOnly')
      expect(cookieHeader).toContain('SameSite=Strict')
      expect(cookieHeader).toContain('Path=/')

      const logoutHeader = clearSessionCookie()
      expect(logoutHeader).toContain('Max-Age=0')
    })
  })

  describe('Realtime Bridge Authentication & Event Validation', () => {
    const testSecret = 'test-cluster-token-xyz'

    it('validates secret token correctly and rejects forged tokens', () => {
      expect(verifyRealtimeToken(testSecret, testSecret)).toBe(true)
      expect(verifyRealtimeToken('wrong-token', testSecret)).toBe(false)
      expect(verifyRealtimeToken(undefined, testSecret)).toBe(false)
      expect(verifyRealtimeToken('', testSecret)).toBe(false)
    })

    it('enforces payload size cap (512 KB)', () => {
      expect(MAX_PAYLOAD_BYTES).toBe(512 * 1024)
    })

    it('validates event schema against allowed event types', () => {
      const validEvent = {
        type: 'state',
        payload: { activeId: 'primary' },
        ts: new Date().toISOString(),
      }
      expect(isValidEvent(validEvent)).toBe(true)

      for (const allowed of ALLOWED_EVENT_TYPES) {
        expect(
          isValidEvent({
            type: allowed,
            payload: {},
            ts: new Date().toISOString(),
          })
        ).toBe(true)
      }

      // Rejects unknown event types
      expect(
        isValidEvent({
          type: 'eval_code_injection',
          payload: {},
          ts: new Date().toISOString(),
        })
      ).toBe(false)

      // Rejects missing timestamp or payload
      expect(isValidEvent({ type: 'state', payload: {} })).toBe(false)
      expect(isValidEvent({ type: 'state', ts: new Date().toISOString() })).toBe(false)
      expect(isValidEvent(null)).toBe(false)
      expect(isValidEvent([])).toBe(false)
    })
  })

  describe('Caddyfile Zero-Trust Gateway Configuration', () => {
    const caddyfile = readFileSync(join(process.cwd(), 'Caddyfile'), 'utf-8')

    it('verifies that dynamic upstream query parameter injection is eliminated', () => {
      expect(caddyfile).not.toContain('XTransformPort')
      expect(caddyfile).not.toContain('query.XTransformPort')
      expect(caddyfile).not.toContain('localhost:{query')
    })

    it('verifies strict fixed reverse proxy upstreams', () => {
      // Must direct /socket.io/* to port 3033
      expect(caddyfile).toContain('/socket.io/*')
      expect(caddyfile).toContain('localhost:3033')

      // Must direct general web traffic to localhost:3000
      expect(caddyfile).toContain('localhost:3000')
    })

    it('verifies private internal endpoints (/publish) are not proxied', () => {
      // /publish must never be mapped as a public route in Caddyfile
      expect(caddyfile).not.toContain('handle /publish')
      expect(caddyfile).not.toContain('handle_path /publish')
    })

    it('binds local demonstration profile to loopback to prevent unencrypted network exposure', () => {
      expect(caddyfile).toContain('127.0.0.1:81')
    })
  })
})
