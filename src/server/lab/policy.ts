/**
 * Policy engine — pure, deterministic port of PS-006 `controller/app/policy.py`.
 * Rules R1–R6 evaluated in fixed order; ALL failures reported; R1/R2 short-circuit.
 * No clock, randomness, I/O or environment access inside evaluate().
 */

import { createHash } from "crypto";
import YAML from "yaml";
import type { Decision, Observation, ReasonCode } from "./models";

export const TLS_VERSIONS: Record<string, [number, number]> = {
  "1.0": [1, 0],
  "1.1": [1, 1],
  "1.2": [1, 2],
  "1.3": [1, 3],
};
const ENFORCEMENTS = ["negotiated", "no_legacy_support"] as const;

export class PolicyError extends Error {}

export interface Policy {
  policyId: string;
  allowedLocations: readonly string[];
  requireCertLabelMatch: boolean;
  tlsMinVersion: string;
  tlsEnforcement: "negotiated" | "no_legacy_support";
  requireMinimalLogging: boolean;
  sha: string; // first 12 hex of SHA-256 of the YAML text
}

export const DEFAULT_POLICY_YAML = `version: 1
policy_id: lab-policy-001
allowed_locations: [IN]
location:
  require_cert_label_match: true
tls:
  min_version: "1.2"
  enforcement: negotiated
  require_trusted_cert: true
logging:
  mode: minimal
  require_replica_minimal_logging: true
`;

function onlyKeys(mapping: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(mapping).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new PolicyError(`unknown key(s) in ${where}: ${JSON.stringify([...extra].sort())}`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function section(raw: Record<string, unknown>, name: string, allowed: readonly string[]): Record<string, unknown> {
  const s = raw[name] ?? {};
  if (!isPlainObject(s)) throw new PolicyError(`'${name}' must be a mapping`);
  onlyKeys(s, allowed, name);
  return s;
}

function flag(s: Record<string, unknown>, key: string, def: boolean, where: string): boolean {
  const v = s[key] ?? def;
  if (typeof v !== "boolean") throw new PolicyError(`${where}.${key} must be true or false`);
  return v;
}

export function parsePolicy(text: string): Policy {
  const sha = createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 12);
  let raw: unknown;
  try {
    raw = YAML.parse(text, { strict: true });
  } catch (err) {
    throw new PolicyError(`invalid YAML: ${(err as Error).message}`);
  }
  if (!isPlainObject(raw)) throw new PolicyError("policy must be a mapping");
  onlyKeys(raw, ["version", "policy_id", "allowed_locations", "location", "tls", "logging"], "policy");
  if (raw.version !== 1) throw new PolicyError("version must be 1");
  const policyId = raw.policy_id;
  if (typeof policyId !== "string" || policyId.length === 0) {
    throw new PolicyError("policy_id must be a non-empty string");
  }
  const locations = raw.allowed_locations;
  if (
    !Array.isArray(locations) ||
    locations.length === 0 ||
    !locations.every((x) => typeof x === "string" && x.length > 0)
  ) {
    throw new PolicyError("allowed_locations must be a non-empty list of strings");
  }

  const location = section(raw, "location", ["require_cert_label_match"]);
  const tls = section(raw, "tls", ["min_version", "enforcement", "require_trusted_cert"]);
  const logging = section(raw, "logging", ["mode", "require_replica_minimal_logging"]);

  const minVersion = String(tls.min_version ?? "1.2");
  if (!(minVersion in TLS_VERSIONS)) {
    throw new PolicyError(`tls.min_version must be one of ${Object.keys(TLS_VERSIONS).join(", ")}`);
  }
  const enforcement = (tls.enforcement ?? "negotiated") as string;
  if (!ENFORCEMENTS.includes(enforcement as (typeof ENFORCEMENTS)[number])) {
    throw new PolicyError(`tls.enforcement must be one of ${[...ENFORCEMENTS].join(", ")}`);
  }
  if (tls.require_trusted_cert !== undefined && tls.require_trusted_cert !== true) {
    throw new PolicyError("tls.require_trusted_cert must be true in the MVP");
  }
  if (logging.mode !== undefined && logging.mode !== "minimal") {
    throw new PolicyError("logging.mode must be 'minimal'");
  }

  return {
    policyId,
    allowedLocations: locations as readonly string[],
    requireCertLabelMatch: flag(location, "require_cert_label_match", true, "location"),
    tlsMinVersion: minVersion,
    tlsEnforcement: enforcement as Policy["tlsEnforcement"],
    requireMinimalLogging: flag(logging, "require_replica_minimal_logging", true, "logging"),
    sha,
  };
}

/** Pure and deterministic: same (policy, obs) always gives the same Decision. */
export function evaluate(policy: Policy, obs: Observation): Decision {
  const result = (reasons: ReasonCode[]): Decision => ({
    replicaId: obs.replicaId,
    passed: reasons.length === 0,
    reasons,
    policyId: policy.policyId,
    policySha: policy.sha,
  });

  if (!obs.reachable) return result(["R1_UNREACHABLE"]);
  if (!obs.certTrusted) return result(["R2_CERT_UNTRUSTED"]); // evidence from an untrusted peer is not evidence

  const reasons: ReasonCode[] = [];
  if (!policy.allowedLocations.includes(obs.declaredLocation ?? "")) {
    reasons.push("R3_LOCATION_NOT_ALLOWED");
  }
  if (policy.requireCertLabelMatch && (obs.certLocation === null || obs.declaredLocation !== obs.certLocation)) {
    reasons.push("R4_LABEL_CERT_MISMATCH");
  }

  const have = obs.tlsVersion ? TLS_VERSIONS[obs.tlsVersion] : undefined;
  const need = TLS_VERSIONS[policy.tlsMinVersion];
  if (have === undefined || have < need) {
    reasons.push("R5_TLS_BELOW_MIN");
  } else if (policy.tlsEnforcement === "no_legacy_support" && obs.legacyAccepted && obs.legacyAccepted.length > 0) {
    reasons.push("R5_TLS_BELOW_MIN");
  }

  if (policy.requireMinimalLogging && obs.declaredLogging !== "minimal") {
    reasons.push("R6_LOGGING_NOT_MINIMAL");
  }
  return result(reasons);
}
