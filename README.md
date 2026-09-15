# gym-backend

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
