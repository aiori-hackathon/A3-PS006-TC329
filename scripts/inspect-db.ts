import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/server/lab/audit'
import type { AuditRecord } from '../src/server/lab/models'

const db = new PrismaClient()

async function main() {
  console.log('=== Inspecting db/custom.db ===')

  const policyFiles = await db.policyFile.findMany()
  console.log(`\nPolicyFiles count: ${policyFiles.length}`)
  for (const p of policyFiles) {
    console.log(`- ID: ${p.id}, SHA: ${p.sha}, Active: ${p.active}, Created: ${p.createdAt.toISOString()}`)
  }

  const runs = await db.run.findMany({ orderBy: { startedAt: 'asc' } })
  console.log(`\nRuns count: ${runs.length}`)
  for (const r of runs) {
    console.log(`- Run ID: ${r.id}, Scenario: ${r.scenario}, Outcome: ${r.outcome}, Score: ${r.scoreTotal}, Status: ${r.status}, Started: ${r.startedAt.toISOString()}`)
  }

  const allAuditRows = await db.auditEvent.findMany({ orderBy: { seq: 'asc' } })
  console.log(`\nAuditEvents total count: ${allAuditRows.length}`)

  // Group audit rows by runId
  const auditByRun = new Map<string, typeof allAuditRows>()
  for (const row of allAuditRows) {
    const list = auditByRun.get(row.runId) ?? []
    list.push(row)
    auditByRun.set(row.runId, list)
  }

  console.log(`\nAudit chains by Run ID (${auditByRun.size} runs with audit rows):`)
  for (const [runId, rows] of auditByRun.entries()) {
    const mapped: AuditRecord[] = rows.map((r) => ({
      seq: r.seq,
      ts: r.ts.toISOString(),
      runId: r.runId,
      event: r.event as AuditRecord['event'],
      replica: r.replica as AuditRecord['replica'],
      decision: r.decision as AuditRecord['decision'],
      reason: r.reason,
      policy: r.policy,
      prev: r.prev,
      hash: r.hash,
    }))

    const result = verifyChain(mapped)
    console.log(`- Run "${runId}": ${rows.length} rows (seq ${rows[0]?.seq}..${rows[rows.length - 1]?.seq}) -> Chain Valid: ${result.ok} (Message: ${result.message}, Problem line: ${result.problemLine})`)
  }

  const probesCount = await db.probeRecord.count()
  console.log(`\nProbeRecords total count: ${probesCount}`)

  const scoreComponentsCount = await db.scoreComponent.count()
  console.log(`ScoreComponents total count: ${scoreComponentsCount}`)
}

main()
  .catch((e) => console.error(e))
  .finally(() => db.$disconnect())
