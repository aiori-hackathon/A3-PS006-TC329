import { describe, it, expect } from 'bun:test'
import {
  generateLiveRunId,
  AuditPersistenceQueue,
} from '../src/server/lab/engine'
import {
  findOutages,
  liveOutage,
  lastRecordedOutage,
  summarize,
  percentile,
} from '../src/server/lab/analyze'
import type { ProbeResult } from '../src/server/lab/models'

describe('Engine Lifecycle & Analytics', () => {
  describe('Session ID Generation & Collision Avoidance', () => {
    it('generates unique session IDs across different timestamps', () => {
      const id1 = generateLiveRunId(0, 1000000)
      const id2 = generateLiveRunId(0, 2000000)
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^live-[a-z0-9]+-0$/)
      expect(id2).toMatch(/^live-[a-z0-9]+-0$/)
    })

    it('generates unique session IDs when incrementing counter within same timestamp', () => {
      const fixedTs = 1718000000000
      const idA = generateLiveRunId(0, fixedTs)
      const idB = generateLiveRunId(1, fixedTs)
      const idC = generateLiveRunId(2, fixedTs)

      expect(idA).not.toBe(idB)
      expect(idB).not.toBe(idC)
      expect(idA.endsWith('-0')).toBe(true)
      expect(idB.endsWith('-1')).toBe(true)
      expect(idC.endsWith('-2')).toBe(true)
    })

    it('never produces hardcoded "live-0" which collided with historical database rows', () => {
      const current = generateLiveRunId(0)
      expect(current).not.toBe('live-0')
      expect(current.startsWith('live-')).toBe(true)
    })
  })

  describe('AuditPersistenceQueue Sequential Asynchronous Execution', () => {
    it('executes queued async tasks in strict FIFO order', async () => {
      const queue = new AuditPersistenceQueue()
      const executionOrder: number[] = []

      queue.push(async () => {
        await new Promise((r) => setTimeout(r, 20))
        executionOrder.push(1)
      })

      queue.push(async () => {
        await new Promise((r) => setTimeout(r, 5))
        executionOrder.push(2)
      })

      queue.push(async () => {
        executionOrder.push(3)
      })

      await queue.flush()

      // Even though task 1 was slower than task 2, execution must be strictly sequential (1, 2, 3)
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('propagates caught errors during flush', async () => {
      const queue = new AuditPersistenceQueue()

      queue.push(async () => {
        throw new Error('Database write constraint violation')
      })

      let threw = false
      try {
        await queue.flush()
      } catch (err: any) {
        threw = true
        expect(err.message).toBe('Database write constraint violation')
      }
      expect(threw).toBe(true)
    })

    it('tracks per-run persistence failures and rejects flush(runId)', async () => {
      const queue = new AuditPersistenceQueue()

      queue.push(async () => {
        throw new Error('Disk full on SQLite DB')
      }, 'run-failing-123')

      let threw = false
      try {
        await queue.flush('run-failing-123')
      } catch (err: any) {
        threw = true
        expect(err.message).toContain('run-failing-123')
      }
      expect(threw).toBe(true)
      expect(queue.hasFailed('run-failing-123')).toBe(true)
      expect(queue.hasFailed('run-healthy-456')).toBe(false)
    })
  })


  describe('Outage Analyzer Invariants', () => {
    const makeProbe = (seq: number, tSendMs: number, ok: boolean): ProbeResult => ({
      seq,
      tSendNs: tSendMs * 1e6,
      tRecvNs: (tSendMs + 5) * 1e6,
      status: ok ? 200 : 503,
      ok,
      latencyMs: ok ? 5 : null,
      servedBy: ok ? 'A' : null,
      epoch: 1,
      error: ok ? null : 'replica_unavailable',
    })

    it('identifies resolved outage when service recovers', () => {
      const records: ProbeResult[] = [
        makeProbe(1, 100, true),
        makeProbe(2, 150, false), // outage start
        makeProbe(3, 200, false),
        makeProbe(4, 250, true),  // recovered
        makeProbe(5, 300, true),
      ]

      const outages = findOutages(records)
      expect(outages.length).toBe(1)
      expect(outages[0].open).toBe(false)
      expect(outages[0].failedRequests).toBe(2)
      expect(outages[0].downtimeMs).toBe(100) // 250 - 150

      // When recovered, liveOutage must return null (not presenting past outage as ongoing)
      expect(liveOutage(records)).toBeNull()

      // Historical readout still remembers the outage
      const last = lastRecordedOutage(records)
      expect(last).not.toBeNull()
      expect(last?.downtimeMs).toBe(100)
    })

    it('identifies open outage when service is currently failing', () => {
      const records: ProbeResult[] = [
        makeProbe(1, 100, true),
        makeProbe(2, 150, false),
        makeProbe(3, 200, false), // still failing
      ]

      const outages = findOutages(records)
      expect(outages.length).toBe(1)
      expect(outages[0].open).toBe(true)
      expect(outages[0].failedRequests).toBe(2)

      const ongoing = liveOutage(records)
      expect(ongoing).not.toBeNull()
      expect(ongoing?.open).toBe(true)
    })
  })

  describe('Summary & Percentile Statistics', () => {
    it('computes correct mean, median, p95, min and max', () => {
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const summary = summarize(latencies)

      expect(summary.count).toBe(10)
      expect(summary.mean).toBe(55)
      expect(summary.min).toBe(10)
      expect(summary.max).toBe(100)
      expect(summary.p50).toBe(50)
      expect(summary.p95).toBe(100)
    })

    it('gracefully handles empty records without division by zero', () => {
      const summary = summarize([])
      expect(summary.count).toBe(0)
      expect(summary.mean).toBeNull()
      expect(summary.p50).toBeNull()
      expect(summary.p95).toBeNull()
      expect(summary.min).toBeNull()
      expect(summary.max).toBeNull()
    })
  })
})
