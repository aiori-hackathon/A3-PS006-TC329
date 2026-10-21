# INTERLOCK Standalone Replica Service

Physical lab replica microservice implementing the PS-006 specification:
- **FR-01**: HTTP/HTTPS endpoints for `/health`, `/data`, and `/meta`.
- **FR-02**: Certificates issued by the Lab CA with location tags and SAN URIs (`spiffe://lab/replica/in` or `eu`).
- **FR-03**: Serves HTTPS only (TLS 1.2+ or 1.1 based on profile).
- **FR-04**: Dynamically selectable profiles (`compliant`, `weak_tls`, `eu_weak_tls`, `wrong_location`, `label_mismatch`, `verbose_logging`, `untrusted_cert`).
- **FR-40 - FR-42**: In-line fault injection (`CRASH`, `LINK_LOSS`, `OVERLOAD`).

## Running Standalone

Ensure PKI certificates are generated first:
```bash
node scripts/generate-pki.mjs
```

Start Replica A (Port 8443):
```bash
REPLICA_ID=A PORT=8443 node mini-services/replica/server.mjs
```

Start Replica B (Port 8444):
```bash
REPLICA_ID=B PORT=8444 REPLICA_PROFILE=compliant node mini-services/replica/server.mjs
```

## Endpoints

- `GET /health`: Health status, profile, and uptime.
- `GET /data`: Data path payload with `X-Served-By` and `X-Replica-Location` headers.
- `GET /meta`: Replica metadata (profile, declared vs cert location, TLS version, logging claim).
- `POST /fault`: Inject fault `{ "fault": "CRASH" | "LINK_LOSS" | "OVERLOAD", "degradedMs": 2500 }`.
- `POST /clear-fault`: Clear active fault.
- `POST /profile`: Switch profile `{ "profile": "wrong_location" }`.
