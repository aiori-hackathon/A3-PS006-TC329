import { PrismaClient } from '@prisma/client'

// Ensure DATABASE_URL is always defined to prevent Prisma initialization failure
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  dbReadyPromise: Promise<void> | undefined;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "PolicyFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sha" TEXT NOT NULL,
    "yaml" TEXT NOT NULL,
    "parsedJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PolicyFile_sha_key" ON "PolicyFile"("sha")`,

  `CREATE TABLE IF NOT EXISTS "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "repeat" INTEGER NOT NULL,
    "fault" TEXT NOT NULL,
    "bProfile" TEXT NOT NULL,
    "expect" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "tFaultIso" DATETIME,
    "tDetectIso" DATETIME,
    "tDecisionIso" DATETIME,
    "tSwitchIso" DATETIME,
    "detectMs" REAL,
    "decideMs" REAL,
    "switchMs" REAL,
    "outcome" TEXT,
    "reasons" TEXT,
    "downtimeMs" REAL,
    "outageOpen" BOOLEAN,
    "failedRequests" INTEGER,
    "servedByNoncompliant" INTEGER,
    "auditChainOk" BOOLEAN,
    "auditOrderOk" BOOLEAN,
    "scoreTotal" REAL,
    "grade" TEXT,
    "observationJson" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "Run_scenario_idx" ON "Run"("scenario")`,
  `CREATE INDEX IF NOT EXISTS "Run_batchId_idx" ON "Run"("batchId")`,

  `CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "ts" DATETIME NOT NULL,
    "event" TEXT NOT NULL,
    "replica" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "prev" TEXT NOT NULL,
    "hash" TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "AuditEvent_runId_idx" ON "AuditEvent"("runId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AuditEvent_runId_seq_key" ON "AuditEvent"("runId", "seq")`,

  `CREATE TABLE IF NOT EXISTS "ProbeRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "tSend" DATETIME NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "latencyMs" REAL,
    "servedBy" TEXT,
    "epoch" INTEGER,
    "error" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "ProbeRecord_runId_seq_idx" ON "ProbeRecord"("runId", "seq")`,

  `CREATE TABLE IF NOT EXISTS "ScoreComponent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" REAL NOT NULL,
    "maxPoints" REAL NOT NULL,
    "note" TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "ScoreComponent_runId_idx" ON "ScoreComponent"("runId")`,
];

export async function ensureDbReady(): Promise<void> {
  if (globalForPrisma.dbReadyPromise) {
    return globalForPrisma.dbReadyPromise;
  }

  globalForPrisma.dbReadyPromise = (async () => {
    try {
      for (const stmt of DDL_STATEMENTS) {
        await db.$executeRawUnsafe(stmt);
      }
    } catch (err) {
      console.warn("[db] ensureDbReady notice:", err);
    }
  })();

  return globalForPrisma.dbReadyPromise;
}

// Eagerly trigger schema check on boot
void ensureDbReady();