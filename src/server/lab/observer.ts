/**
 * Observer — gathers facts about a candidate through the tolerant context,
 * bounded by the decision timeout. Never decides (see policy.evaluate).
 * Strict-TLS policies additionally probe which legacy versions the replica accepts.
 */

import type { Observation, ReplicaId } from "./models";
import { ReplicaSim, sleep } from "./replicas";

export async function observe(
  replica: ReplicaSim,
  cfg: { decisionTimeoutMs: number; checkLegacy: boolean; minVersion: string },
): Promise<Observation> {
  const timeout = (async (): Promise<Observation> => {
    await sleep(cfg.decisionTimeoutMs);
    return {
      replicaId: replica.id as ReplicaId,
      reachable: false,
      certTrusted: false,
      tlsVersion: null,
      declaredLocation: null,
      certLocation: null,
      declaredLogging: null,
      legacyAccepted: null,
    };
  })();

  const obs = await Promise.race([replica.tolerantView(), timeout]);
  if (!obs.reachable || !obs.certTrusted) return obs;

  if (cfg.checkLegacy) {
    // The observer does the strict-mode probe off the same view (deterministic range check).
    return { ...obs, legacyAccepted: replica.acceptsLegacyBelow(cfg.minVersion) };
  }
  return obs;
}
