# ChessArena — Security Model

| Threat | Mitigation |
|---|---|
| Credential theft | bcrypt (cost 12) password hashes; hashes never selected into API responses (explicit `select` / `publicUser` mapper). |
| Brute force | `express-rate-limit` on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`; generic "invalid credentials" errors. |
| Session theft (XSS) | Tokens only in `HttpOnly` cookies; React escapes output; no `dangerouslySetInnerHTML`; Helmet CSP on the API. |
| CSRF | Double-submit cookie (`csrf_token` cookie + `X-CSRF-Token` header) on all non-GET requests, `SameSite=Lax` cookies and a strict CORS allow-list. |
| Cross-site WebSocket hijacking | Socket.IO `allowRequest` rejects handshakes whose `Origin` is not in `CLIENT_ORIGIN`; a short-lived socket ticket (only obtainable with a valid cookie session + CSRF header) is required, then the session row is verified. |
| Privilege escalation | Registration schema has no `role` field; role changes only via `PATCH /admin/users/:id/role` (ADMIN), cannot produce/remove the last active admin; first admin only via CLI (`npm run admin:create`). |
| Revoked / suspended users | Every authenticated request reloads the user and session (`status === ACTIVE`, `session.revokedAt == null`). Suspension revokes all sessions and disconnects sockets. |
| Move forgery / cheating via API | Server validates every move with chess.js against persisted FEN; checks participant, colour, turn, `positionVersion`; ignores any client FEN/result/clock. |
| Double finalization / replay | Conditional `updateMany … where status=IN_PROGRESS` inside a transaction; unique `(matchId, ply)` on moves; unique `(matchId, playerId)` on rating history; client-supplied `expectedVersion`. |
| Injection | Prisma parameterized queries only; Zod validation on every body, query and socket payload; sort fields from allow-lists. |
| Information leakage | Production error handler returns `{ error: { code, message } }` without stack traces; pino redacts `cookie`, `authorization`, `password*`, `token*`. |
| Secrets | All secrets via environment variables validated at boot (Zod); `.env` git-ignored; frontend only receives `VITE_*` public values. |
| DoS | JSON body limit 100 kB, socket `maxHttpBufferSize` 16 kB, per-socket event rate limiting, pagination caps (≤ 100). |
| Audit | Privileged actions (role/status changes, coordinator creation, tournament transitions, cancellations, dispute resolution, pairings) write `AuditLog` rows with no secrets. |

## Cookie configuration

| Cookie | HttpOnly | Path | Lifetime |
|---|---|---|---|
| `ca_access` (JWT, HS256) | yes | `/` | 15 min |
| `ca_refresh` (opaque, SHA-256 stored) | yes | `/api/v1/auth` | 7 days, rotated on every refresh |
| `csrf_token` | no (must be readable by the SPA) | `/` | session lifetime |

`Secure` is set whenever `NODE_ENV=production`. `SameSite` is `COOKIE_SAMESITE` (default `lax`).

## Deployment model and why cookies stay first-party

Browsers increasingly block third-party cookies, so the SPA never talks to the API cross-site:

* **REST** — the SPA always calls the relative path `/api/v1/...`. In development Vite proxies it to
  the server; on Vercel a rewrite (`client/vercel.json`) proxies it to the Render service. Cookies are
  therefore first-party for the SPA's own domain and `SameSite=Lax` works.
* **Socket.IO** — Vercel rewrites do not proxy WebSockets, so the SPA connects directly to
  `VITE_SOCKET_URL` (the Render URL). It authenticates with a **socket ticket**: a 60-second JWT
  (`purpose: "socket"`, bound to the session id) obtained from `POST /api/v1/auth/socket-ticket`
  and sent in the Socket.IO `auth` payload. The server verifies the ticket, reloads the session and
  user, and checks the `Origin` header. The ticket is fetched again on every reconnect, so revoked
  sessions cannot reconnect.

If you later host frontend and backend on one registrable domain, the same code keeps working.
