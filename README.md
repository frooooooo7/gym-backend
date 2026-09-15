# gym-backend

REST API for **GYM** — a strength-training diary with a social layer (follows, activity feed,
kudos, comments). It serves the Flutter client (mobile + web) and is designed for offline-first
sync: client-generated ids (`clientId`) for idempotent upserts, ETags on history, and tombstones
for deleted workouts.

## Stack

- Node.js 22 (ESM), TypeScript, Express 4
- PostgreSQL 16 via raw `pg` (no ORM); migrations run automatically at startup
  (`src/db/migrate.ts`, advisory-locked, so several instances can start at once)
- Zod 4 for validation, JWT (`jsonwebtoken`) + bcrypt (in a worker thread) for auth
- Multer for image uploads (stored on local disk under `uploads/`)
- Vitest + Supertest (unit / route tests), end-to-end smoke scripts against real Postgres
- Docker (multi-stage image, non-root) + docker compose; GitHub Actions CI

Code layout follows a layered module structure (`src/modules/<domain>/` with
`routes → controller → service → repository`, Zod `schemas`); see `.antigravityrules`.

## Quick start

### Everything in Docker

```bash
docker compose up -d --build        # postgres:16-alpine + API on http://localhost:3000
curl http://localhost:3000/ready    # {"status":"ready","database":"ok"}
```

Uploaded files live in the `uploads_data` volume and database files in `postgres_data`, so both
survive `docker compose up --build`. **Don't** run `docker compose down -v` unless you want to
delete them.

### Local development (API on the host, Postgres in Docker)

```bash
cp .env.example .env
docker compose up -d postgres
npm ci
npm run dev                         # tsx watch, http://localhost:3000
```

### Migrating an existing dev volume from the PostGIS image

`docker-compose.yml` used to run `postgis/postgis:16-3.4-alpine`; it now uses
`postgres:16-alpine`. The API never used PostGIS: its migrations only need `pgcrypto` and
`pg_trgm`, which the official image ships. Both images run PostgreSQL 16 with the same
`PGDATA`, so the existing `postgres_data` volume works as is.

However, the PostGIS image's **init script** created `postgis`, `postgis_topology`,
`postgis_tiger_geocoder` and `fuzzystrmatch` in the `gym` database, plus a `template_postgis`
database. With the plain image they're dead weight: calling a PostGIS function fails with
`could not access file "$libdir/postgis-3"`. The API is unaffected (verified: the server starts
and all migrations apply). To clean up (tested on a copy of a PostGIS-initialised volume, works
on either image):

```bash
docker compose up -d postgres       # after pulling this change (postgres:16-alpine)
docker compose exec postgres psql -U gym -d gym \
  -c "DROP EXTENSION IF EXISTS postgis_tiger_geocoder, postgis_topology, postgis, fuzzystrmatch CASCADE;" \
  -c "DROP SCHEMA IF EXISTS tiger, tiger_data, topology CASCADE;"
docker compose exec postgres psql -U gym -d postgres \
  -c "UPDATE pg_database SET datistemplate = false WHERE datname = 'template_postgis';" \
  -c "DROP DATABASE IF EXISTS template_postgis;"
```

Make a backup first if the data matters (`docker compose exec postgres pg_dump -U gym gym > gym.sql`).

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables strict validation, JSON logs, the CORS whitelist, HSTS and `trust proxy` (1 hop). |
| `PORT` | `3000` | HTTP port. |
| `DATABASE_URL` | — | **Required in production**: the process exits with a clear message without it. In development it may be empty; the API starts and `/ready` returns 503. |
| `JWT_SECRET` | dev fallback | **Required in production**. Use ≥ 32 random chars (`openssl rand -base64 48`); shorter values log a warning. Changing it invalidates every token. |
| `CORS_ORIGIN` | — | Production only: comma-separated browser origins. Empty in production logs a **warning** (not an error), because native mobile apps don't need CORS; browsers (Flutter web) are then blocked. Development allows every origin. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent`. Tests are silent by default. |
| `PG_POOL_MAX` | `10` | Max connections in the pg pool. |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `API_PORT` | `gym`, `5432`, `3000` | docker compose only. |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API with reload (`tsx watch src/index.ts`). |
| `npm test` | Vitest unit + route tests (DB mocked). `npm run test:watch` for watch mode. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` / `npm start` | Compile to `dist/` / run `node dist/index.js`. |
| `npm run migrate` | Apply pending migrations without starting the API (they also run on every start). |
| `npm run smoke` | End-to-end smoke tests against a real database, see below. |

### Smoke tests

`scripts/smoke/{social,feed,sessions,account}.mjs` exercise the real API and database (follows +
avatars, feed/kudos/comments, workout delete/edit + tombstones, account security + deletion).
`scripts/smoke/run-all.mjs` starts a **fresh server per script** on a free port (rate limiters are
in-memory), waits for `/ready`, runs the script, stops the server, and runs everything once with
legacy paths and once with `/api/v1`:

```bash
# once: docker compose exec postgres createdb -U gym gym_smoke
DATABASE_URL=postgresql://gym:gym@localhost:5432/gym_smoke npm run smoke
```

The runner refuses databases whose name doesn't contain `smoke`, `test` or `ci`
(override: `SMOKE_ALLOW_ANY_DB=1`). Options: `SMOKE_PREFIXES=legacy,v1`, `SMOKE_ONLY=feed,account`,
`SMOKE_SERVER=dist` (use the compiled build instead of `tsx`). A single script can run
standalone against any server:
`BASE=http://localhost:3000 API_PREFIX=/api/v1 DATABASE_URL=... node scripts/smoke/feed.mjs`.

### CI

`.github/workflows/ci.yml` runs on every push and pull request:
- `test`: `npm ci`, typecheck, unit tests, build (Node 22)
- `smoke`: Postgres 16 service, build, `npm run smoke`
- `docker`: validates the compose file and builds the image (no push)

## API overview

Base path: **`/api/v1`**. Every endpoint below is also served at the same path **without** the
prefix (legacy, used by the current Flutter client). Unprefixed responses carry
`Deprecation: true` and `Link: </api/v1/...>; rel="successor-version"`. Otherwise they behave the
same, including shared rate-limit counters.

Auth column: 🔒 = `Authorization: Bearer <jwt>` required.

| Method | Path (`/api/v1` +) | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | | Liveness `{status:"ok"}` (no DB). Also unprefixed `/health`. |
| GET | `/ready` | | Readiness: `SELECT 1` → 200 `{status:"ready"}` or 503. Also unprefixed `/ready`. |
| POST | `/auth/register` | | Create account → `201 { token, user }`. 10/h per IP. |
| POST | `/auth/login` | | `{ token, user }`. 10 failed attempts / 15 min per IP. |
| GET | `/auth/me` | 🔒 | Current user. |
| POST | `/auth/change-password` | 🔒 | New token, revokes other tokens. |
| POST | `/auth/logout-all` | 🔒 | New token, revokes other tokens. |
| DELETE | `/auth/me` | 🔒 | Delete account, body `{ password }` → 204. |
| POST | `/auth/delete-account` | 🔒 | Same as `DELETE /auth/me`, for proxies that drop DELETE bodies. Shares its limiter. |
| GET | `/exercises` | 🔒 | List/search (`q`, `muscle`, `filter`, `limit`, `offset`). 300/min per IP on `/exercises*`. |
| POST | `/exercises` | 🔒 | Create custom exercise (upsert by `clientId`). |
| PUT | `/exercises/:id` | 🔒 | Update own exercise. |
| DELETE | `/exercises/:id` | 🔒 | Delete own exercise. |
| POST | `/exercises/:id/favourite` | 🔒 | Toggle favourite. |
| POST | `/exercises/:id/image` | 🔒 | Multipart field `image` (≤ 5 MB) → `imageUrl`. |
| GET | `/training-plans` | 🔒 | List plans. |
| POST | `/training-plans` | 🔒 | Create (upsert by `clientId`). |
| PUT | `/training-plans/:id` | 🔒 | Replace plan. |
| DELETE | `/training-plans/:id` | 🔒 | Delete plan. |
| POST | `/training-sessions` | 🔒 | Create/upsert session by `clientId` (`410 session_deleted` if tombstoned). |
| PUT | `/training-sessions/:id` | 🔒 | Full edit (also completed sessions). |
| GET | `/training-sessions/active` | 🔒 | Active session or `null`. |
| GET | `/training-sessions/history` | 🔒 | Sync page incl. `deleted` tombstones (`updatedSince`, `cursor`). |
| DELETE | `/training-sessions/by-client-id/:clientId` | 🔒 | Idempotent delete by client id → 204. |
| DELETE | `/training-sessions/:id` | 🔒 | Idempotent delete → 204. |
| PATCH | `/training-sessions/:id/shared-to-profile` | 🔒 | Toggle `sharedToProfile`. |
| GET | `/training-history` | 🔒 | Timeline list (ETag / 304). |
| GET | `/training-history/:sessionId` | 🔒 | Timeline detail (ETag / 304). |
| GET | `/training-sessions` | 🔒 | **v1 only**: alias of `GET /training-history`. |
| GET | `/training-sessions/:sessionId` | 🔒 | **v1 only**: alias of `GET /training-history/:sessionId`. |
| GET | `/profile/me` | 🔒 | Own profile with stats. |
| PATCH | `/profile/me` | 🔒 | `firstName`, `lastName`, `bio`. |
| POST | `/profile/me/avatar` | 🔒 | Multipart field `avatar` (≤ 5 MB) → `avatarUrl`. |
| DELETE | `/profile/me/avatar` | 🔒 | Remove avatar. |
| GET | `/profile/following` | 🔒 | Who I follow (`limit`, `offset`). |
| GET | `/profile/followers` | 🔒 | My followers (`limit`, `offset`). |
| GET | `/profile/activities` | 🔒 | My recent completed sessions. |
| GET | `/users/search` | 🔒 | Search users (`q`, `limit`). |
| GET | `/users/suggested` | 🔒 | Users to follow (empty-feed state). |
| GET | `/users/:userId/profile` | 🔒 | Public profile + `isFollowing` / `isFollowedBy`. |
| GET | `/users/:userId/activities` | 🔒 | User's shared sessions. |
| GET | `/users/:userId/following` | 🔒 | Who the user follows. |
| GET | `/users/:userId/followers` | 🔒 | The user's followers. |
| POST | `/users/:userId/follow` | 🔒 | Follow (idempotent). 60/min per user. |
| DELETE | `/users/:userId/follow` | 🔒 | Unfollow (idempotent). |
| GET | `/feed` | 🔒 | Activity feed (`limit`, `cursor`). |
| GET | `/posts/:sessionId` | 🔒 | Post detail with exercises. |
| GET | `/posts/:sessionId/kudos` | 🔒 | Kudos givers. |
| POST | `/posts/:sessionId/kudos` | 🔒 | Give kudo (idempotent). 120/min per user. |
| DELETE | `/posts/:sessionId/kudos` | 🔒 | Remove kudo (idempotent). |
| GET | `/posts/:sessionId/comments` | 🔒 | Comments, oldest first (`limit`, `cursor`). |
| POST | `/posts/:sessionId/comments` | 🔒 | Add comment. 30/min per user. |
| DELETE | `/posts/:sessionId/comments/:commentId` | 🔒 | Delete own comment / comment on own post. |

Static files (no prefix, no auth, long-lived cache): `GET /uploads/exercise-images/<file>`,
`GET /uploads/avatars/<file>`. Upload URLs returned by the API are relative (`/uploads/...`).

### Legacy vs `/api/v1` differences

Every legacy path works under `/api/v1` unchanged. The only differences:

| Path | Legacy (unprefixed) | `/api/v1` |
| --- | --- | --- |
| `GET /training-sessions` | 404 | alias of `GET /training-history` (as before versioning) |
| `GET /training-sessions/:sessionId` | 404 | alias of `GET /training-history/:sessionId` (as before) |
| `GET /training-sessions/active`, `/history` | active session / sync history | **same as legacy**. Before versioning these v1 paths hit the detail alias and returned `400 invalid_session_id`. |
| `/training-history*` | 404 | timeline endpoints (as before) |
| `/health`, `/ready` | yes, no `Deprecation` header | also available |
| `Deprecation` / `Link` headers | set | not set |

In `/api/v1` the training-sessions write router is matched before the history aliases, so the
paths it defines win and only other `GET /training-sessions[/:id]` requests reach the aliases.

## Errors

Errors are JSON with a machine-readable code:

```json
{ "error": "not_found_or_not_yours", "message": "not_found_or_not_yours" }
```

- `error` is the stable code clients should branch on. `message` is informational. Some
  validation errors (Zod) contain only `error`.
- Common: `400` validation codes (`invalid_uuid`, `invalid_limit`, `missing_fields`, ...),
  `400 invalid_json` (malformed JSON body), `413 payload_too_large` (JSON body > 1 MB),
  `401 unauthorized | invalid_token | token_revoked`, `404 not_found` (unknown route),
  `410 session_deleted`, `429 too_many_requests`, `503 database_unavailable`,
  `500 internal_error`.
- Unexpected errors never expose stack traces or driver messages. They are logged server-side
  with the request id.
- Every response carries `X-Request-Id` (a valid incoming `X-Request-Id` of 8–128 chars
  `[A-Za-z0-9._:-]` is propagated, otherwise a UUID is generated). It is exposed to browsers via
  CORS. Quote it when reporting a problem.

## Auth & token revocation

- `Authorization: Bearer <jwt>`. Tokens are valid for 30 days and carry `sub` (user id), `email`
  and `tv` (the user's `token_version`).
- `401 unauthorized`: missing/malformed header. `401 invalid_token`: bad signature or expired.
- `401 token_revoked`: the token's `tv` is stale (after `change-password` / `logout-all`) or the
  account was deleted. Clients must sign out locally and not retry. Those two endpoints return a
  fresh token for the calling device.
- The version check fails closed: if the DB is down, authenticated endpoints return
  `503 database_unavailable`.
- Details: [Account & security](#account--security).

## Logging

One line per request when the response finishes (health probes excluded): method, path
**without query string**, status, duration, user id (if authenticated), request id.

```text
# development (compact text)
21:37:02.114 INFO  GET /api/v1/feed 200 14.52ms user=0f8c3c1e-... rid=6a1d9c0e-...
# production (JSON lines)
{"time":"2026-09-15T19:37:02.114Z","level":"info","msg":"request","requestId":"6a1d9c0e-...","method":"GET","path":"/api/v1/feed","status":200,"durationMs":14.52,"userId":"0f8c3c1e-..."}
{"time":"2026-09-15T19:37:05.001Z","level":"error","msg":"unhandled_error","requestId":"...","method":"GET","path":"/api/v1/training-history","error":{"name":"Error","message":"...","stack":"..."}}
```

5xx request lines are logged at `error` level. Set `LOG_LEVEL=warn` to keep only warnings and errors.

## Deployment notes

- **Uploads** are stored on the local filesystem (`/app/uploads` in the image). Mount a
  persistent volume there (compose: `uploads_data`). The image creates `exercise-images/` and
  `avatars/` owned by `node`, so a fresh named volume gets the right ownership. With several
  instances, all of them need the same shared volume (or move to object storage, see Future).
- **Secrets / config**: set `NODE_ENV=production`, a long random `JWT_SECRET` (rotating it signs
  everyone out), `DATABASE_URL`, and `CORS_ORIGIN` if a browser client is used.
- **Reverse proxy**: in production `trust proxy` is `1`, so exactly one proxy hop is trusted for
  `req.ip`, which the per-IP rate limiters use. Adjust if your topology differs. Terminate TLS at
  the proxy (HSTS is sent in production).
- **Probes**: liveness `GET /health`, readiness `GET /ready` (checks the DB). The image has a
  Docker `HEALTHCHECK` on `/health`.
- **Multiple instances**: migrations are safe (advisory lock). Rate limiters are **in-memory per
  instance**, so effective limits multiply by the number of instances. The `token_version` cache
  has a **30 s TTL**: revocation is immediate on the instance that handled the request and takes
  up to 30 s on the others.
- **Tombstones** (`training_session_tombstones`) are kept indefinitely so offline clients can never
  resurrect deleted workouts. They're small, but the table only grows.
- **Graceful shutdown**: SIGTERM/SIGINT stop accepting connections, drain, close the pool (10 s
  hard limit).

## Future

- S3-compatible object storage for uploads (stateless API instances, CDN).
- Error tracking (Sentry) wired to the error handler and request ids.
- Tombstone cleanup job (e.g. drop tombstones older than the longest supported offline window).
- Shared store (Redis/Postgres) for rate limiters and the token-version cache when scaling out.

---


## Training history timeline API (MVP)

Contract source: `src/modules/training-history/training-history.openapi.yaml`

### Auth

- Required: `Authorization: Bearer <jwt>`

### Endpoints

#### GET `/api/v1/training-history`

Query params:

- `cursor?: string`
- `limit?: number` (default `20`, max `50`)
- `status?: completed|cancelled|active`
- `planId?: uuid`
- `q?: string` (search in plan name or exercise name)
- `from?: ISO datetime`
- `to?: ISO datetime`

Example request:

```http
GET /api/v1/training-history?limit=20&status=completed&q=bench
If-None-Match: W/"d9ff..."
```

Example response:

```json
{
  "items": [
    {
      "id": "f1000000-0000-4000-8000-000000000001",
      "startedAt": "2026-05-14T18:05:00.000Z",
      "endedAt": "2026-05-14T19:02:00.000Z",
      "durationSec": 3420,
      "status": "completed",
      "plan": { "id": "f2000000-0000-4000-8000-000000000001", "name": "Push/Pull/Legs" },
      "exercisesCount": 6,
      "completedSetsCount": 18,
      "hasNote": true,
      "progressHighlight": { "type": "weight_increase", "label": "+5 kg bench" },
      "updatedAt": "2026-05-14T19:05:00.000Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

Headers:

- `ETag` on 200 responses
- `304 Not Modified` when `If-None-Match` matches

#### GET `/api/v1/training-history/{sessionId}`

Example response:

```json
{
  "id": "f1000000-0000-4000-8000-000000000001",
  "startedAt": "2026-05-14T18:05:00.000Z",
  "endedAt": "2026-05-14T19:02:00.000Z",
  "durationSec": 3420,
  "status": "completed",
  "plan": { "id": "f2000000-0000-4000-8000-000000000001", "name": "Push/Pull/Legs" },
  "note": "Felt great",
  "updatedAt": "2026-05-14T19:05:00.000Z",
  "exercises": [
    {
      "exerciseId": "a1000000-0000-0000-0000-000000000001",
      "exerciseName": "Bench Press",
      "sets": [
        {
          "setIndex": 1,
          "planned": { "weightKg": 80, "reps": 8, "rir": 2, "tempo": "3010" },
          "actual": { "weightKg": 82.5, "reps": 8, "rir": 1, "tempo": "3010" },
          "completed": true
        }
      ]
    }
  ]
}
```

### Errors

Error shape:

```json
{
  "error": "invalid_limit",
  "message": "invalid_limit"
}
```

Common codes for timeline endpoints:

- `invalid_limit`
- `invalid_cursor`
- `invalid_plan_id`
- `invalid_date_range`
- `invalid_session_id`
- `not_found_or_not_yours`
- `database_unavailable`
- `unauthorized`
- `invalid_token`

### Frontend integration notes

- List order is deterministic: `startedAt DESC`, tie-break `id DESC`.
- For pagination, call next page with `cursor = nextCursor`.
- Append new `items` while `hasMore=true`.
- For offline-first, store last successful payload + `ETag`. On reconnect, send `If-None-Match`; `304` means keep cached list/detail.
- `hasNote`, `progressHighlight`, `durationSec`, `completedSetsCount`, and `exercisesCount` map directly to timeline card UI.

## Deleting / editing finished workouts (sync-safe)

Module: `src/modules/training-sessions/`. All endpoints require `Authorization: Bearer <jwt>`
and act only on the caller's own sessions.

| Method & path | Response |
| --- | --- |
| `DELETE /training-sessions/:id` | `204`. Any status. Idempotent: `204` again if this user already deleted it. `404 not_found_or_not_yours` when it never was the caller's. `400 invalid_uuid`. |
| `DELETE /training-sessions/by-client-id/:clientId` | `204` always (idempotent). Deletes the session with that client id if the server has it, and always records the deletion — use it for sessions whose server id is unknown (e.g. create still queued). `400 invalid_uuid`. |
| `PUT /training-sessions/:id` | Full edit, also for `completed` sessions: id, kudos and comments are kept; exercises/sets are replaced; `updatedAt` changes (so training-history ETags change). |

A delete removes the session with its exercises, sets, kudos and comments (training-history,
feed and profile activities stop showing it) and leaves a **tombstone** `(id, clientId, deletedAt)`.

**`410 session_deleted`** — returned (nothing is written) by `POST /training-sessions` when its
`clientId` was deleted, and by `PUT /training-sessions/:id` / `PATCH /training-sessions/:id/shared-to-profile`
when the id (or the PUT body `clientId`) was deleted. Clients must treat `410` as final: drop the
local session and its queued operations, and **don't** fall back from `PUT` to `POST`.

**Deletion sync** — `GET /training-sessions/history` returns an extra field:

```json
{ "items": [], "nextCursor": null, "hasMore": false,
  "deleted": [{ "id": "uuid", "clientId": "uuid|null", "deletedAt": "2026-09-15T10:00:00.000Z" }] }
```

- `deleted` lists tombstones with `deletedAt > updatedSince`, all of them on the first page
  (request without `cursor`); later pages and requests without `updatedSince` get `[]`.
- Match local sessions by `clientId` first, then `id`. For a session deleted by client id before it
  reached the server, `id` is a random uuid that never belonged to a session.
- `PUT` / `POST` validate `finishedAt >= startedAt` (equal is fine) → `400 invalid_date_range`.

## Social feed API (posts, kudos, comments)

Module: `src/modules/feed/`. All endpoints require `Authorization: Bearer <jwt>`.
Errors use the usual shape `{ "error": "<code>", "message": "..." }`.

**Post** = a training session with `status = "completed"`. A post is visible to a
viewer when `sharedToProfile = true` **or** it is the viewer's own session. Anything
else (missing, cancelled/active, someone else's non-shared session) → `404 post_not_found`.

### Shapes

`Author` / user mini:

```json
{ "id": "uuid", "firstName": "Anna", "lastName": "Nowak", "handle": "anna.nowak_d4e5f6", "avatarUrl": null }
```

`FeedPost`:

```json
{
  "id": "f1000000-0000-4000-8000-000000000001",
  "author": { "id": "…", "firstName": "Anna", "lastName": "Nowak", "handle": "anna.nowak_d4e5f6", "avatarUrl": null },
  "title": "Push/Pull/Legs",
  "note": "Nowy rekord",
  "startedAt": "2026-05-26T18:32:00.000Z",
  "finishedAt": "2026-05-26T19:29:00.000Z",
  "durationSec": 3420,
  "exercisesCount": 6,
  "completedSetsCount": 18,
  "totalVolumeKg": 5230.5,
  "muscles": ["chest", "triceps"],
  "topExercises": [
    { "name": "Wyciskanie sztangi na ławce", "completedSets": 4, "bestSet": { "weightKg": 82.5, "reps": 8 } },
    { "name": "Podciąganie na drążku", "completedSets": 3, "bestSet": null }
  ],
  "kudosCount": 3,
  "commentCount": 1,
  "hasKudoed": false,
  "isOwn": false,
  "recentKudos": [{ "id": "…", "firstName": "Celina", "lastName": "Z.", "handle": "celina.z", "avatarUrl": null }]
}
```

- `muscles` — distinct muscles of all exercises, in order of first appearance (exercise position).
- `topExercises` — first 3 exercises (by position) with ≥1 completed set. `bestSet` = completed
  set with the highest parsable actual weight (tie → more reps); `null` when no weight parses;
  `reps` may be `null`. Weights accept `82.5` and `82,5`; reps must be an integer.
- `recentKudos` — up to 3 most recent kudo givers.

`Comment`:

```json
{
  "id": "uuid",
  "author": { "id": "…", "firstName": "Jan", "lastName": "Kowalski", "handle": "jan.k", "avatarUrl": null },
  "body": "Świetny trening!",
  "createdAt": "2026-05-26T20:00:00.123Z",
  "isOwn": true,
  "canDelete": true
}
```

`canDelete` = viewer wrote the comment **or** owns the post.

User list item (same as `/profile/followers`):
`{ "id", "firstName", "lastName", "handle", "avatarUrl", "isFollowing" }`.

### Endpoints

| Method & path | Query / body | Response |
| --- | --- | --- |
| `GET /feed` | `limit` 1..50 (20), `cursor` | `200 { items: FeedPost[], nextCursor: string\|null, hasMore: bool }` |
| `GET /posts/:sessionId` | — | `200 FeedPost + exercises[]` |
| `POST /posts/:sessionId/kudos` | — | `200 { "hasKudoed": true, "kudosCount": 4 }` (idempotent) |
| `DELETE /posts/:sessionId/kudos` | — | `200 { "hasKudoed": false, "kudosCount": 3 }` (idempotent) |
| `GET /posts/:sessionId/kudos` | `limit` 1..100 (50), `offset` ≥0 (0) | `200 UserListItem[]`, most recent first |
| `GET /posts/:sessionId/comments` | `limit` 1..100 (30), `cursor` | `200 { items: Comment[], nextCursor, hasMore }`, oldest first |
| `POST /posts/:sessionId/comments` | `{ "body": "…" }` | `201 Comment` |
| `DELETE /posts/:sessionId/comments/:commentId` | — | `204` |
| `GET /users/suggested` | `limit` 1..30 (10) | `200 UserListItem[]` (`isFollowing` always `false`) |

- **Feed** — completed **and shared** sessions of the viewer and everyone they follow (own
  non-shared sessions are not in the feed). Order `startedAt DESC, id DESC`. Pass `nextCursor`
  back as `cursor` while `hasMore = true`; cursors are opaque (base64url) and not interchangeable
  between the feed and comments.
- **Post detail** `exercises[]` mirrors the training-history detail:

  ```json
  {
    "exerciseId": "a1000000-0000-0000-0000-000000000001",
    "exerciseName": "Wyciskanie sztangi na ławce",
    "exerciseMuscles": ["chest", "triceps"],
    "exerciseCategory": "compound",
    "imageUrl": null,
    "sets": [
      {
        "setIndex": 1,
        "planned": { "weightKg": 80, "reps": 8, "rir": 2, "tempo": "3010" },
        "actual": { "weightKg": 82.5, "reps": 8, "rir": null, "tempo": null },
        "completed": true,
        "completedAt": "2026-05-26T18:40:00.000Z"
      }
    ]
  }
  ```

- **Comments** — body is trimmed and must be 1..500 characters (code points). Creating comments
  is rate limited to 30 per user per minute.
- **Suggested users** — users the viewer doesn't follow (excluding self), ranked by completed
  shared sessions in the last 30 days, then newest accounts. Meant for the empty-feed state.
- `GET /profile/activities` and `GET /users/:userId/activities` items carry real `kudosCount`,
  `commentCount` and `hasKudoed` (for the viewer).

### Error codes

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_uuid` | malformed `sessionId` / `commentId` |
| 400 | `invalid_limit` / `invalid_offset` | out-of-range or non-integer query values |
| 400 | `invalid_cursor` | cursor not produced by the same endpoint |
| 400 | `cannot_kudo_own_post` | `POST /posts/:id/kudos` on your own post |
| 400 | `invalid_comment_body` | missing, non-string, empty after trim, > 500 chars |
| 401 | `unauthorized` / `invalid_token` | missing / invalid JWT |
| 403 | `forbidden` | deleting a comment you neither wrote nor whose post you own |
| 404 | `post_not_found` | post missing, not completed, or not visible to the viewer |
| 404 | `comment_not_found` | comment missing or not on that post |
| 429 | `too_many_requests` | comment rate limit exceeded |
| 503 | `database_unavailable` | no database configured |

## Account & security

All endpoints below require `Authorization: Bearer <jwt>`.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /auth/change-password` | `{ "currentPassword": string, "newPassword": string }` | `200 { token, user }` (same shape as login) | `401 invalid_credentials` (wrong current password), `400 password_too_short` / `400 password_too_weak` (same rules as registration), `400 missing_fields`, `400 password_unchanged`, `429 too_many_requests` (10 failed attempts / user / 15 min) |
| `POST /auth/logout-all` | — | `200 { token, user }` | — |
| `DELETE /auth/me` | `{ "password": string }` | `204` (empty) | `401 invalid_credentials`, `400 missing_fields`, `429 too_many_requests` (5 attempts / user / 15 min) |

`POST|DELETE /posts/:sessionId/kudos` are limited to 120 requests per user per minute (`429 too_many_requests`).

### Token revocation (`token_revoked`)

- Every JWT carries a `tv` claim: the user's `users.token_version` at issue time (tokens issued before this existed have no `tv`, which counts as `0`).
- `change-password` and `logout-all` increment `token_version` and return a **new token** for the calling device. Every other token for that user, including the one used to make the call, then gets `401 { "error": "token_revoked" }` on any authenticated endpoint. The client should swap in the returned token right away. On `token_revoked`, sign the user out locally (don't retry).
- A token for a deleted account also gets `401 token_revoked`.
- Other auth errors are unchanged: `401 unauthorized` (missing header), `401 invalid_token` (bad signature / expired). If the version can't be checked because the database is down, the API returns `503 database_unavailable`.
- The version is cached in memory per API instance for up to 30 s. Revocation is immediate on the instance that handled the request. With several instances, the others pick it up within that TTL.

### Account deletion scope

`DELETE /auth/me` removes, in one transaction: the user, their training plans, their custom exercises, their training sessions (with sets, kudos and comments on them), their tombstones, favourites, follows (both directions), and the kudos and comments they left on other people's posts. Afterwards, the avatar file and the image files of the deleted custom exercises are removed from disk (best effort).

Exception: another user's plan can only use system exercises or its owner's own custom exercises, so it can't normally reference someone else's. If one does anyway (legacy data), that custom exercise is kept with `created_by = NULL`, and so is its image. Other users' session history keeps its exercise snapshots (name, muscles, category); `exercise_id` becomes `NULL`.
