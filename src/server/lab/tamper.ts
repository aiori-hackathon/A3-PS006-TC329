/**
 * Tamper demo store — holds the ORIGINAL persisted audit row while the demo
 * has rewritten it, so the restore endpoint can write the truth back.
 * In-memory by design: tampering is a stage demo of tamper *evidence*,
 * not a feature of the controller. One tampered row at a time.
 */

import type { AuditEvent } from "@prisma/client";

let tampered: { original: AuditEvent } | null = null;

export function setTampered(original: AuditEvent): void {
  tampered = { original };
}

export function getTampered(): AuditEvent | null {
  return tampered?.original ?? null;
}

export function clearTampered(): void {
  tampered = null;
}
