/** Zustand store: live lab state fed by the WS stream, with REST snapshot fallback. */

"use client";

import { create } from "zustand";
import type {
  AuditRecord,
  HealthTick,
  LabSnapshot,
  Mode,
  ProbeResult,
  ReplicaId,
  ReplicaView,
  ScenarioRunStatus,
} from "@/lib/lab-types";

const PROBE_RING_MAX = 400;
const AUDIT_FEED_MAX = 160;
const HEALTH_RING_MAX = 32;

interface LabState {
  ready: boolean;
  connected: boolean;
  mode: Mode;
  active: ReplicaId | null;
  epoch: number;
  runId: string;
  runLock: boolean;
  safetyViolations: number;
  replicas: ReplicaView[];
  controller: Record<string, number>;
  policy: LabSnapshot["policy"] | null;
  probeRing: ProbeResult[];
  healthRings: Record<ReplicaId, HealthTick[]>;
  auditFeed: AuditRecord[];
  scenarioStatus: ScenarioRunStatus | null;
  chainOk: boolean | null;
  lastUpdateNs: number;

  applySnapshot: (snap: LabSnapshot) => void;
  setConnected: (connected: boolean) => void;
  applyEvents: (events: { type: string; payload: unknown }[]) => void;
}

export const useLabStore = create<LabState>((set, get) => ({
  ready: false,
  connected: false,
  mode: "STARTING",
  active: null,
  epoch: 0,
  runId: "-",
  runLock: false,
  safetyViolations: 0,
  replicas: [],
  controller: {},
  policy: null,
  probeRing: [],
  healthRings: { A: [], B: [] },
  auditFeed: [],
  scenarioStatus: null,
  chainOk: null,
  lastUpdateNs: 0,

  applySnapshot: (snap) =>
    set({
      ready: true,
      mode: snap.mode,
      active: snap.active,
      epoch: snap.epoch,
      runId: snap.runId,
      runLock: snap.runLock,
      safetyViolations: snap.safetyViolations,
      replicas: snap.replicas,
      controller: snap.controller,
      policy: snap.policy,
      probeRing: snap.recentProbe,
      healthRings: {
        A: snap.recentHealth.A ?? [],
        B: snap.recentHealth.B ?? [],
      },
      auditFeed: [...snap.recentAudit].reverse(), // newest first
      scenarioStatus: snap.scenarioStatus,
      lastUpdateNs: Date.now(),
    }),

  setConnected: (connected) => set({ connected }),

  applyEvents: (events) => {
    for (const ev of events) {
      const state = get();
      switch (ev.type) {
        case "state": {
          const p = ev.payload as {
            mode: Mode;
            active: ReplicaId | null;
            epoch: number;
            runId: string;
            runLock: boolean;
          };
          set({
            mode: p.mode,
            active: p.active,
            epoch: p.epoch,
            runId: p.runId,
            runLock: p.runLock,
          });
          break;
        }
        case "audit": {
          const row = ev.payload as AuditRecord;
          // A fresh run replaces the tape (seq 1 of a different run id).
          if (row.runId !== state.runId && row.seq === 1) {
            set({ auditFeed: [row], chainOk: null, runId: row.runId });
          } else if (row.runId === state.runId) {
            const feed = [row, ...state.auditFeed];
            if (feed.length > AUDIT_FEED_MAX) feed.length = AUDIT_FEED_MAX;
            set({ auditFeed: feed });
          }
          break;
        }
        case "probe": {
          const rec = ev.payload as ProbeResult;
          const ring = [...state.probeRing, rec];
          if (ring.length > PROBE_RING_MAX) ring.splice(0, ring.length - PROBE_RING_MAX);
          set({ probeRing: ring });
          break;
        }
        case "health": {
          const tick = ev.payload as HealthTick;
          const ring = [...(state.healthRings[tick.replica] ?? []), tick];
          if (ring.length > HEALTH_RING_MAX) ring.splice(0, ring.length - HEALTH_RING_MAX);
          const replicas = state.replicas.map((r) =>
            r.id === tick.replica
              ? {
                  ...r,
                  health: tick.health,
                  lastReason: tick.reason,
                  lastLatencyMs: tick.latencyMs,
                  consecutiveFails: tick.consecutiveFails,
                }
              : r,
          );
          set({ healthRings: { ...state.healthRings, [tick.replica]: ring }, replicas });
          break;
        }
        case "fault": {
          const p = ev.payload as { replica: ReplicaId; fault: string | null; action: string };
          set((s) => ({
            replicas: s.replicas.map((r) =>
              r.id === p.replica && p.action !== "recreated"
                ? { ...r, fault: p.action === "inject" ? (p.fault as never) : null }
                : r,
            ),
          }));
          break;
        }
        case "policy": {
          const p = ev.payload as { event: string; sha: string; id: string };
          set((s) =>
            s.policy && p.event === "loaded" ? { policy: { ...s.policy, sha: p.sha, id: p.id } } : s,
          );
          break;
        }
        case "run": {
          const status = ev.payload as ScenarioRunStatus;
          set({ scenarioStatus: status, runLock: status.running });
          break;
        }
      }
    }
    set({ lastUpdateNs: Date.now() });
  },
}));
