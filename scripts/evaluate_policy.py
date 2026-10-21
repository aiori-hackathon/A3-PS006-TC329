#!/usr/bin/env python3
"""
Independent Policy Evaluator (PS-006 NFR-09 & FR-21)
Algo-Ancesstors (A3-PS006-TC329) - AIORI Hackathon 3

Evaluates candidate replica observations against the PS-006 policy rules R1-R6
in Python, proving deterministic equivalence with the TypeScript implementation.
"""

import sys
import json
import yaml
import hashlib
import argparse

REASON_CODES = [
    "R1_UNREACHABLE",
    "R2_CERT_UNTRUSTED",
    "R3_LOCATION_NOT_ALLOWED",
    "R4_LABEL_CERT_MISMATCH",
    "R5_TLS_BELOW_MIN",
    "R6_LOGGING_NOT_MINIMAL",
]

def version_tuple(ver_str: str) -> tuple:
    if not ver_str:
        return (0, 0)
    parts = ver_str.split(".")
    return tuple(int(p) for p in parts)

def evaluate_policy(policy: dict, obs: dict) -> dict:
    """
    Pure deterministic policy evaluation.
    Matches evaluate() in src/server/lab/policy.ts.
    """
    policy_raw = json.dumps(policy, sort_keys=True)
    policy_sha = hashlib.sha256(policy_raw.encode("utf-8")).hexdigest()[:12]

    # R1: Reachability short-circuits
    if not obs.get("reachable", False):
        return {
            "replicaId": obs.get("replicaId"),
            "passed": False,
            "reasons": ["R1_UNREACHABLE"],
            "policySha": policy_sha
        }

    # R2: Certificate Lab-CA trust short-circuits
    if not obs.get("certTrusted", False):
        return {
            "replicaId": obs.get("replicaId"),
            "passed": False,
            "reasons": ["R2_CERT_UNTRUSTED"],
            "policySha": policy_sha
        }

    reasons = []

    # R3: Geolocation residency
    allowed_locs = policy.get("allowedLocations", ["IN"])
    decl_loc = obs.get("declaredLocation")
    cert_loc = obs.get("certLocation")

    if decl_loc not in allowed_locs or cert_loc not in allowed_locs:
        reasons.append("R3_LOCATION_NOT_ALLOWED")

    # R4: Metadata vs SAN URI location match
    if decl_loc != cert_loc:
        reasons.append("R4_LABEL_CERT_MISMATCH")

    # R5: Cryptographic baseline (minimum TLS 1.2)
    min_tls = policy.get("tlsMinVersion", "1.2")
    obs_tls = obs.get("tlsVersion")
    if version_tuple(obs_tls) < version_tuple(min_tls):
        reasons.append("R5_TLS_BELOW_MIN")
    elif policy.get("tlsEnforcement") == "no_legacy_support":
        legacy = obs.get("legacyAccepted") or []
        if len(legacy) > 0:
            reasons.append("R5_TLS_BELOW_MIN")

    # R6: Logging posture
    allow_verbose = policy.get("allowVerboseLogging", False)
    if obs.get("declaredLogging") == "verbose" and not allow_verbose:
        reasons.append("R6_LOGGING_NOT_MINIMAL")

    return {
        "replicaId": obs.get("replicaId"),
        "passed": len(reasons) == 0,
        "reasons": reasons,
        "policySha": policy_sha
    }

def main():
    parser = argparse.ArgumentParser(description="Evaluate PS-006 candidate observation against policy")
    parser.add_argument("--policy", "-p", help="Path to policy YAML file")
    parser.add_argument("--obs", "-o", help="JSON string or path to JSON observation")
    args = parser.parse_args()

    policy = {
        "policyId": "strict-in-v1",
        "allowedLocations": ["IN"],
        "tlsMinVersion": "1.2",
        "allowVerboseLogging": False,
        "tlsEnforcement": "standard"
    }

    if args.policy:
        with open(args.policy, "r", encoding="utf-8") as f:
            policy = yaml.safe_load(f)

    if args.obs:
        if args.obs.startswith("{"):
            obs = json.loads(args.obs)
        else:
            with open(args.obs, "r", encoding="utf-8") as f:
                obs = json.load(f)
    else:
        # Default test observation: B compliant
        obs = {
            "replicaId": "B",
            "reachable": True,
            "certTrusted": True,
            "tlsVersion": "1.3",
            "declaredLocation": "IN",
            "certLocation": "IN",
            "declaredLogging": "minimal",
            "legacyAccepted": None
        }

    res = evaluate_policy(policy, obs)
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
