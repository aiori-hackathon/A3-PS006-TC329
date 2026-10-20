# interlock-realtime

Stateless socket.io fan-out bridge for the INTERLOCK control room: the Next.js engine POSTs batched lab events here, every connected browser receives them on the `lab` channel, and the bridge keeps no state of its own.

- Run: `cd mini-services/realtime && bun run dev` — listens on port 3033 (env `REALTIME_PORT`), hot reload, own lockfile/node_modules (install with `bun install` from this directory only, never from the project root).
- Browser connection: `io("/?XTransformPort=3033", { transports: ["websocket","polling"] })` — the socket.io path MUST stay `/` so the Caddy gateway can forward to :3033.
- Publish contract: `POST http://127.0.0.1:3033/publish` with header `x-lab-token: $REALTIME_TOKEN` (default `interlock-dev-token`) and body `{ "events": [{ "type": string, "payload": unknown, "ts": string }] }`.
- Publish replies: `200 {"ok":true,"delivered":N}` (batch broadcast as one `lab` message `{ events }`), `401 {"error":"unauthorized"}` on missing/wrong token, `400 {"error":"bad_request"}` if the body is malformed or `events` is not an array.
- Ops: `GET /healthz` → `{"ok":true,"clients":N}`; any other method/path → 404; SIGTERM/SIGINT shut down gracefully; logs go to `service.log`.
