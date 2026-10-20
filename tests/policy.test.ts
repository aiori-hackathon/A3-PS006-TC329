import { describe, expect, test } from "bun:test";
import { evaluate, parsePolicy, DEFAULT_POLICY_YAML, PolicyError } from "../src/server/lab/policy";
import type { Observation } from "../src/server/lab/models";
import { SCENARIOS } from "../src/server/lab/runner";
import { PROFILES } from "../src/server/lab/replicas";

describe("Policy Engine — R1 through R6 Deterministic Evaluation", () => {
  const policy = parsePolicy(DEFAULT_POLICY_YAML);

  test("R1: Candidate unreachable short-circuits immediately with R1_UNREACHABLE", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: false,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R1_UNREACHABLE"]);
  });

  test("R2: Untrusted certificate short-circuits with R2_CERT_UNTRUSTED", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: false,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R2_CERT_UNTRUSTED"]);
  });

  test("R3: Disallowed location triggers R3_LOCATION_NOT_ALLOWED", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "EU",
      certLocation: "EU",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R3_LOCATION_NOT_ALLOWED"]);
  });

  test("R4: Declared location and cert label mismatch triggers R4_LABEL_CERT_MISMATCH", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "EU",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R4_LABEL_CERT_MISMATCH"]);
  });

  test("R5: Negotiated TLS below minimum version triggers R5_TLS_BELOW_MIN", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.1",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R5_TLS_BELOW_MIN"]);
  });

  test("R5: Strict enforcement (no_legacy_support) fires if legacy versions are accepted", () => {
    const strictPolicy = parsePolicy(`version: 1
policy_id: strict-tls
allowed_locations: [IN]
location:
  require_cert_label_match: true
tls:
  min_version: "1.2"
  enforcement: no_legacy_support
  require_trusted_cert: true
logging:
  mode: minimal
  require_replica_minimal_logging: true
`);
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "minimal",
      legacyAccepted: ["1.0", "1.1"],
    };
    const decision = evaluate(strictPolicy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R5_TLS_BELOW_MIN"]);
  });

  test("R6: Non-minimal logging triggers R6_LOGGING_NOT_MINIMAL", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "verbose",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R6_LOGGING_NOT_MINIMAL"]);
  });

  test("Multiple violations preserve exact ordered reason codes (e.g. S3: R3 + R5)", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.1", // R5
      declaredLocation: "EU", // R3
      certLocation: "EU",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(false);
    expect(decision.reasons).toEqual(["R3_LOCATION_NOT_ALLOWED", "R5_TLS_BELOW_MIN"]);
  });

  test("Compliant replica passes all rules", () => {
    const obs: Observation = {
      replicaId: "B",
      reachable: true,
      certTrusted: true,
      tlsVersion: "1.3",
      declaredLocation: "IN",
      certLocation: "IN",
      declaredLogging: "minimal",
      legacyAccepted: null,
    };
    const decision = evaluate(policy, obs);
    expect(decision.passed).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  test("Policy parser rejects invalid YAML and unsupported versions", () => {
    expect(() => parsePolicy("not: valid: yaml: [")).toThrow(PolicyError);
    expect(() => parsePolicy("version: 2\npolicy_id: test\nallowed_locations: [IN]")).toThrow(PolicyError);
    expect(() => parsePolicy("version: 1\nunknown_key: true\npolicy_id: test\nallowed_locations: [IN]")).toThrow(PolicyError);
  });

  test("All 9 scenarios (S1-S9) produce exact expected gate decisions and reasons according to PRD matrix", () => {
    for (const [key, spec] of Object.entries(SCENARIOS)) {
      const profile = PROFILES[spec.bProfile];
      expect(profile).toBeDefined();
      const obs: Observation = {
        replicaId: "B",
        reachable: true,
        certTrusted: profile.cert !== "untrusted",
        tlsVersion: profile.tlsMax,
        declaredLocation: profile.location,
        certLocation: profile.cert === "in" ? "IN" : profile.cert === "eu" ? "EU" : "UNTRUSTED",
        declaredLogging: profile.logging,
        legacyAccepted: null,
      };
      const decision = evaluate(policy, obs);
      const shouldPass = spec.expect === "FAILOVER";
      expect(decision.passed).toBe(shouldPass);
      expect(decision.reasons).toEqual([...spec.reasons]);
    }
  });
});
