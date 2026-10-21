#!/usr/bin/env python3
"""
Independent Audit Log Verifier (PS-006 NFR-09 & FR-32)
Algo-Ancesstors (A3-PS006-TC329) - AIORI Hackathon 3

This script verifies the cryptographic integrity of INTERLOCK audit chains
independently of the TypeScript runtime. It can read:
  1. A JSONL or JSON file containing audit records
  2. Directly from the SQLite database (prisma/dev.db)

Verification checks:
  - Sequence continuity (seq starts at 1, increments by 1 with no gaps)
  - Hash chain integrity: SHA256(prev + canonical_json(record_body)) == hash
  - Genesis block verification (first record has 64 zeros as prev)
  - HMAC-SHA256 support when an HMAC key is supplied
"""

import sys
import os
import json
import hashlib
import hmac
import sqlite3
import argparse

GENESIS = "0" * 64

def canonical_json(record: dict) -> str:
    """Format canonical JSON with exact allow-listed fields matching audit.ts."""
    body = {
        "decision": record.get("decision", "-"),
        "event": record.get("event"),
        "policy": record.get("policy", "-"),
        "reason": record.get("reason", "-"),
        "replica": record.get("replica", "-"),
        "run_id": record.get("runId") if "runId" in record else record.get("run_id"),
        "seq": record.get("seq"),
        "ts": record.get("ts"),
    }
    return json.dumps(body, separators=(',', ':'), sort_keys=True)

def compute_hash(prev_hash: str, canonical_body: str, hmac_key: str = None) -> str:
    payload = (prev_hash + canonical_body).encode("utf-8")
    if hmac_key:
        return hmac.new(hmac_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hashlib.sha256(payload).hexdigest()

def verify_records(records: list, hmac_key: str = None) -> dict:
    if not records:
        return {"ok": True, "count": 0, "message": "Empty log (valid)"}

    prev = GENESIS
    for i, r in enumerate(records):
        line_num = i + 1
        seq = r.get("seq")
        
        # Check sequence
        if seq != line_num:
            return {
                "ok": False,
                "problemLine": line_num,
                "problemSeq": seq,
                "message": f"Sequence gap: expected {line_num}, got {seq}"
            }

        # Check prev link
        record_prev = r.get("prev")
        if record_prev != prev:
            return {
                "ok": False,
                "problemLine": line_num,
                "problemSeq": seq,
                "message": f"Broken previous link: expected {prev[:12]}..., got {record_prev[:12] if record_prev else 'None'}..."
            }

        # Check hash
        c_body = canonical_json(r)
        expected_hash = compute_hash(prev, c_body, hmac_key)
        actual_hash = r.get("hash")

        if actual_hash != expected_hash:
            return {
                "ok": False,
                "problemLine": line_num,
                "problemSeq": seq,
                "message": f"Hash mismatch at seq {seq}: computed {expected_hash}, recorded {actual_hash}"
            }

        prev = actual_hash

    return {
        "ok": True,
        "count": len(records),
        "lastHash": prev,
        "message": f"All {len(records)} audit records cryptographically verified."
    }

def verify_from_sqlite(db_path: str, run_id: str = None, hmac_key: str = None):
    if not os.path.exists(db_path):
        print(f"[ERROR] Database file not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if run_id:
        cur.execute("SELECT * FROM AuditEvent WHERE runId = ? ORDER BY seq ASC", (run_id,))
    else:
        # Get latest runId
        cur.execute("SELECT runId FROM Run ORDER BY startedAt DESC LIMIT 1")
        row = cur.fetchone()
        if not row:
            print("[INFO] No runs found in database.")
            sys.exit(0)
        latest_run = row["runId"]
        print(f"[INFO] Verifying latest run: {latest_run}")
        cur.execute("SELECT * FROM AuditEvent WHERE runId = ? ORDER BY seq ASC", (latest_run,))

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    result = verify_records(rows, hmac_key)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["ok"] else 1)

def verify_from_file(file_path: str, hmac_key: str = None):
    if not os.path.exists(file_path):
        print(f"[ERROR] File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    records = []
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content.startswith("["):
            records = json.loads(content)
        else:
            for line in content.splitlines():
                line = line.strip()
                if line:
                    records.append(json.loads(line))

    result = verify_records(records, hmac_key)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["ok"] else 1)

def main():
    parser = argparse.ArgumentParser(description="INTERLOCK Independent Audit Log Verifier")
    parser.add_argument("--file", "-f", help="Path to JSON or JSONL file containing audit records")
    parser.add_argument("--db", "-d", help="Path to SQLite database (default: prisma/dev.db)", default="prisma/dev.db")
    parser.add_argument("--run", "-r", help="Run ID to verify when checking SQLite")
    parser.add_argument("--key", "-k", help="HMAC secret key (if HMAC-SHA256 was used)")

    args = parser.parse_args()

    hmac_key = args.key or os.environ.get("AUDIT_HMAC_KEY")

    if args.file:
        verify_from_file(args.file, hmac_key)
    else:
        verify_from_sqlite(args.db, args.run, hmac_key)

if __name__ == "__main__":
    main()
