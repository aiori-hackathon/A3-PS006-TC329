import { describe, expect, test } from "bun:test";
import { AuditLog, canonical, chainHash, GENESIS, verifyChain, type AuditRecord } from "../src/server/lab/audit";

describe("Cryptographic Audit Chain & Integrity Verifier", () => {
  test("Canonical JSON sorts keys consistently regardless of insertion order", () => {
    const a = canonical({ z: 1, a: 2, m: 3 });
    const b = canonical({ a: 2, m: 3, z: 1 });
    expect(a).toBe('{"a":2,"m":3,"z":1}');
    expect(a).toBe(b);
  });

  test("Chain generates valid hashes linked from GENESIS", () => {
    const log = new AuditLog("test-run-1");
    const r1 = log.emit("controller_started");
    expect(r1.seq).toBe(1);
    expect(r1.prev).toBe(GENESIS);
    expect(r1.hash.length).toBe(64);

    const r2 = log.emit("policy_loaded", { policy: "26d3cdd935da" });
    expect(r2.seq).toBe(2);
    expect(r2.prev).toBe(r1.hash);

    const verify = verifyChain(log.records);
    expect(verify.ok).toBe(true);
    expect(verify.problemLine).toBeNull();
    expect(verify.count).toBe(2);
  });

  test("Verifier catches altered decision field (tamper detection)", () => {
    const log = new AuditLog("test-run-2");
    log.emit("controller_started");
    log.emit("policy_evaluated", { replica: "B", decision: "PASS", policy: "26d3cdd935da" });
    log.emit("failover_done", { replica: "B", decision: "SWITCHED", policy: "26d3cdd935da" });

    // Tamper with record 2: change decision PASS to FAIL
    const tampered = [...log.records];
    tampered[1] = { ...tampered[1], decision: "FAIL" };

    const verify = verifyChain(tampered);
    expect(verify.ok).toBe(false);
    expect(verify.problemLine).toBe(2);
    expect(verify.message).toBe("hash mismatch");
  });

  test("Verifier catches deleted record (sequence gap)", () => {
    const log = new AuditLog("test-run-3");
    log.emit("controller_started");
    log.emit("policy_loaded", { policy: "26d3cdd935da" });
    log.emit("failover_done", { replica: "B", decision: "SWITCHED", policy: "26d3cdd935da" });

    // Drop record 2
    const deleted = [log.records[0], log.records[2]];
    const verify = verifyChain(deleted);
    expect(verify.ok).toBe(false);
    expect(verify.problemLine).toBe(2);
    expect(verify.message).toBe("sequence gap");
  });

  test("Verifier catches broken previous hash link", () => {
    const log = new AuditLog("test-run-4");
    log.emit("controller_started");
    log.emit("policy_loaded", { policy: "26d3cdd935da" });

    const broken = [...log.records];
    broken[1] = { ...broken[1], prev: "0".repeat(63) + "1" };

    const verify = verifyChain(broken);
    expect(verify.ok).toBe(false);
    expect(verify.problemLine).toBe(2);
    expect(verify.message).toBe("broken link");
  });

  test("Verifier normalizes Date objects from database rows", () => {
    const log = new AuditLog("test-run-5");
    const r1 = log.emit("controller_started");
    const r2 = log.emit("policy_loaded", { policy: "26d3cdd935da" });

    // Simulate Prisma returning DateTime as Date object
    const dbSimulated: AuditRecord[] = [
      { ...r1, ts: new Date(r1.ts) as unknown as string },
      { ...r2, ts: new Date(r2.ts) as unknown as string },
    ];

    const verify = verifyChain(dbSimulated);
    expect(verify.ok).toBe(true);
    expect(verify.count).toBe(2);
  });

  test("Keyed HMAC-SHA-256 audit chaining when AUDIT_HMAC_KEY is configured", () => {
    const testKey = "test-hmac-key-minimum-32-characters-long-secret";
    process.env.AUDIT_HMAC_KEY = testKey;
    try {
      const log = new AuditLog("test-run-hmac");
      const r1 = log.emit("controller_started");
      expect(r1.algo).toBe("v2-hmac-sha256");
      expect(r1.hash.length).toBe(64);

      const r2 = log.emit("policy_loaded", { policy: "26d3cdd935da" });
      expect(r2.algo).toBe("v2-hmac-sha256");
      expect(r2.prev).toBe(r1.hash);

      const verify = verifyChain(log.records, testKey);
      expect(verify.ok).toBe(true);
      expect(verify.count).toBe(2);
    } finally {
      delete process.env.AUDIT_HMAC_KEY;
    }
  });

  test("Historical v1-sha256 records remain verifiable without HMAC key", () => {
    // Generate v1 log without HMAC key
    const log = new AuditLog("test-run-v1");
    const r1 = log.emit("controller_started");
    const r2 = log.emit("policy_loaded", { policy: "26d3cdd935da" });
    expect(r1.algo).toBe("v1-sha256");

    // verifyChain without HMAC key succeeds on v1
    const verify = verifyChain(log.records);
    expect(verify.ok).toBe(true);
    expect(verify.count).toBe(2);
  });

  test("Verifier catches tampered field in HMAC-signed record", () => {
    const testKey = "test-hmac-key-minimum-32-characters-long-secret";
    process.env.AUDIT_HMAC_KEY = testKey;
    try {
      const log = new AuditLog("test-run-hmac-tamper");
      log.emit("controller_started");
      log.emit("policy_evaluated", { replica: "B", decision: "PASS", policy: "26d3cdd935da" });

      const tampered = [...log.records];
      tampered[1] = { ...tampered[1], decision: "FAIL" };

      const verify = verifyChain(tampered, testKey);
      expect(verify.ok).toBe(false);
      expect(verify.problemLine).toBe(2);
      expect(verify.message).toBe("hash mismatch");
    } finally {
      delete process.env.AUDIT_HMAC_KEY;
    }
  });
});

