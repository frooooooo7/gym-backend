# gym-backend

## Training sessions timeline API (MVP)

Contract source: `src/modules/training-sessions/training-sessions.openapi.yaml`

### Auth

- Required: `Authorization: Bearer <jwt>`

### Endpoints

#### GET `/api/v1/training-sessions`

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
GET /api/v1/training-sessions?limit=20&status=completed&q=bench
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

#### GET `/api/v1/training-sessions/{sessionId}`

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
