/**
 * Downtime analyzer — port of PS-006 `probe/analyze.py`.
 * An outage runs from the first failed probe to the next successful one; resolution = probe interval.
 */

import type { ProbeResult } from "./models";

export interface Outage {
  startNs: number;
  endNs: number;
  downtimeMs: number;
  open: boolean; // true if the service never recovered during the window
  failedRequests: number;
}

export function findOutages(records: readonly ProbeResult[]): Outage[] {
  const recs = [...records].sort((a, b) => a.tSendNs - b.tSendNs);
  const outages: Outage[] = [];
  let i = 0;
  const n = recs.length;
  while (i < n) {
    if (recs[i].ok) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !recs[j].ok) j += 1;
    const start = recs[i].tSendNs;
    const end = j < n ? recs[j].tSendNs : recs[n - 1].tSendNs;
    outages.push({
      startNs: start,
      endNs: end,
      downtimeMs: (end - start) / 1e6,
      open: j >= n,
      failedRequests: j - i,
    });
    i = j;
  }
  return outages;
}

/** First outage that starts no earlier than one probe interval before the fault. */
export function primaryOutage(outages: readonly Outage[], faultNs: number, intervalMs = 50): Outage | null {
  const threshold = faultNs - intervalMs * 1e6;
  for (const o of outages) if (o.startNs >= threshold) return o;
  return null;
}

/** Nearest-rank percentile (same as the reference). */
export function percentile(values: readonly number[], p: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * ordered.length));
  return ordered[rank - 1];
}

export interface Summary {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}

export function summarize(values: readonly (number | null | undefined)[]): Summary {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) {
    return { count: 0, mean: null, p50: null, p95: null, min: null, max: null };
  }
  return {
    count: nums.length,
    mean: nums.reduce((a, b) => a + b, 0) / nums.length,
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

/** Live readout: returns the currently ongoing outage, or null if the system is currently healthy. */
export function liveOutage(records: readonly ProbeResult[]): Outage | null {
  const outages = findOutages(records);
  if (outages.length === 0) return null;
  const last = outages[outages.length - 1];
  const latestProbe = records[records.length - 1];
  if (last.open || (latestProbe && !latestProbe.ok)) {
    return last;
  }
  return null; // Outage has recovered; do not present historical outage as active
}

/** Historical readout: returns the most recent outage (open or closed). */
export function lastRecordedOutage(records: readonly ProbeResult[]): Outage | null {
  const outages = findOutages(records);
  return outages.length > 0 ? outages[outages.length - 1] : null;
}
