# Implementation phases and acceptance criteria

Status legend: ✅ done and verified · 🟡 partially done · ⬜ not started.
The status column is updated at the end of each phase with evidence (commands + results).

| # | Phase | Acceptance criteria | Status |
|---|---|---|---|
| 1 | Planning & architecture | `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, ER diagram, state machine, permission matrix, API outline exist and match the code. | see `docs/PROGRESS.md` |
| 2 | Project setup | `npm install` succeeds; `npm run typecheck`, `npm run lint`, `npm run build` pass; Prisma migration applies to a local DB; `GET /health` and `GET /ready` answer; client dev server renders. | |
| 3 | Auth & roles | Register/login/logout/refresh/me/forgot/reset work; cookies are HttpOnly; CSRF enforced; RBAC middleware; `admin:create` CLI is idempotent; Supertest auth + authorization tests pass. | |
| 4 | Core chess engine | Engine unit tests (castling, en passant, promotion, mate, stalemate, insufficient material, 3-fold/50-move claims, 5-fold/75-move automatic) pass; matches persist moves with unique ply; board UI renders authoritative state. | |
| 5 | Real-time multiplayer | Two Socket.IO clients play a game in an integration test; stale/duplicate/out-of-turn moves rejected; third user rejected; reconnection restores state; clocks/timeouts server-side; result stored once. | |
| 6 | Dashboards & management | Admin/coordinator/player dashboards with DB-derived numbers; user management (search, filter, paginate, status, role) with last-admin protection; audit log; notifications. | |
| 7 | Tournaments & ratings | Lifecycle transitions enforced; registration rules; round-robin and single-elimination pairings; standings with tie-breaks; Elo with history; leaderboard; replay. | |
| 8 | Testing & security | Full Vitest + Supertest suite green; Playwright E2E (checkmate game + resignation game) green; `npm audit` reviewed. | |
| 9 | Deployment | Render + Vercel + managed Postgres configured from `render.yaml` / `vercel.json`; migrations deployed; admin bootstrapped; smoke test on public URLs. Requires the account owner's credentials. | |
| 10 | Handover | README, API docs, test report, limitations, roadmap. | |
