# 11 — Environment and DevOps

---

## Runtime environment

| Item | Value |
|---|---|
| App | Next.js 16, App Router, port 3000 (`bun run dev`, background, single instance) |
| DB | SQLite via Prisma, file `db/custom.db`, `DATABASE_URL` in `.env` |
| Realtime | Bun mini-service, `mini-services/realtime`, port **3033**, socket.io path `/` |
| Gateway | Caddy on :81 → forwards `?XTransformPort=<port>` to `localhost:<port>`, default to :3000 |
| Package manager | bun (both projects) |
| Node runtime | Bun (dev), Node-capable (build) — engine code uses standard timers/async only |

## Environment variables (`.env`)

| Var | Default | Used by |
|---|---|---|
| `DATABASE_URL` | `file:../db/custom.db` | Prisma |
| `REALTIME_PORT` | `3033` | bridge |
| `REALTIME_TOKEN` | `interlock-dev-token` | engine → bridge `/publish` (header `x-lab-token`) |

Nothing else is required; no external services, no keys. (The lab CA / cert files of the container-based reference repo are not needed by the simulation.)

## Commands

```bash
# app (port 3000, must be backgrounded, never duplicated)
bun run dev

# database after schema edits
bun run db:push

# realtime bridge (own project, hot reload)
cd mini-services/realtime && bun run dev   # listens on 3033

# quality gate
bun run lint
```

## Networking rules (gateway constraints — mandatory)

1. Browser → app: relative paths only (`/api/...`), never absolute hosts or ports.
2. Browser → bridge: `io("/?XTransformPort=3033")` — the socket.io path stays `/` exactly as Caddy expects.
3. Server → server (engine → bridge): direct `fetch("http://127.0.0.1:3033/publish")` — internal, never through the gateway, fire-and-forget with timeout.
4. The bridge never calls back into the app; it is a pure fan-out.

## Process discipline

- The dev server runs **once**, in the background; `dev.log` is the shared log and is tailed after every change.
- The bridge is an independent project: its own `package.json`, entry `index.ts`, fixed port 3033, hot-reload via `bun --hot`.
- `globalThis` singletons (engine, Prisma) survive HMR; timers are disposed on re-creation to prevent duplicates.
- All agents append to `worklog.md` under a `---` section with their Task ID.

## Observability of the app itself

- Console errors and API 4xx/5xx surface in `dev.log`; the UI never hides failures (toasts carry the server message).
- The engine is deterministic given identical scheduling; any nondeterminism suspect is checked with the determinism-replay evidence stored per run (`observationJson`).

## Deployment sketch (beyond the sandbox)

- `bun run build` → standalone output (already configured in scripts) behind the same Caddy pattern; bridge deployed as a second service with its port; SQLite file on a mounted volume. The lab scope does not include HA of the console itself.
