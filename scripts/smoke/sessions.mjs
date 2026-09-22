// Smoke test: deleting / editing finished workouts, tombstones, deletion sync (real server + Postgres).
// Standalone: BASE=http://localhost:3101 DATABASE_URL=... [API_PREFIX=/api/v1] node scripts/smoke/sessions.mjs
// Needs a fresh server (in-memory rate limiters) — see run-all.mjs.
import { apiPath, BASE, closeDb, sql } from "./lib.mjs";
import { randomUUID } from "node:crypto";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 1500));
  }
};
const req = async (method, path, { token, body, headers: extraHeaders } = {}) => {
  const headers = { ...(extraHeaders ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + apiPath(path), { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers, text };
};

const stamp = Date.now();
const register = async (first, last) => {
  const r = await req("POST", "/auth/register", {
    body: { email: `${first.toLowerCase()}.p3.${stamp}@smoke.test`, password: "Sup3rTajne!haslo", firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 || r.status === 200, r);
  return { token: r.json.token, id: r.json.user.id };
};

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const plus = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const ex = (name, sets) => ({
  exerciseName: name,
  exerciseMuscles: ["chest"],
  exerciseCategory: "compound",
  sets: sets.map(([w, r], i) => ({ position: i, plannedWeight: w, plannedReps: r, actualWeight: w, actualReps: r, completed: true })),
});
const sessionBody = (label, { clientId = randomUUID(), startedAt = hoursAgo(2), status = "completed", share = false, exercises = [ex("Martwy ciąg", [["100", "5"]])], note = null } = {}) => ({
  clientId,
  planName: label,
  status,
  note,
  startedAt,
  finishedAt: status === "active" ? null : plus(startedAt, 57),
  sharedToProfile: share,
  exercises,
});
const create = async (user, label, opts) => {
  const body = sessionBody(label, opts);
  const r = await req("POST", "/training-sessions", { token: user.token, body });
  check(`create ${label}`, r.status === 201, r);
  return { id: r.json?.id, body, json: r.json };
};

const syncStart = new Date(Date.now() - 5 * 60_000).toISOString();
const a = await register("Anna", "Kasowa");
const b = await register("Bartek", "Edytowy");

let r = await req("POST", `/users/${b.id}/follow`, { token: a.token });
check("A follows B", r.status === 200, r);

// ---- setup ----
const S1 = await create(b, "B Push", { startedAt: hoursAgo(3), share: true });
const ACT = await create(b, "B active", { status: "active", startedAt: hoursAgo(0.2) });
r = await req("POST", `/posts/${S1.id}/kudos`, { token: a.token });
check("A kudos S1", r.status === 200 && r.json.kudosCount === 1, r);
r = await req("POST", `/posts/${S1.id}/comments`, { token: a.token, body: { body: "Mocne!" } });
check("A comments S1", r.status === 201, r);

// ---- edit completed session ----
r = await req("GET", `/api/v1/training-history/${S1.id}`, { token: b.token });
check("history detail before edit", r.status === 200, r);
const etagBefore = r.headers.get("etag");
const updatedAtBefore = S1.json.updatedAt;
r = await req("GET", `/api/v1/training-history/${S1.id}`, { token: b.token, headers: { "If-None-Match": etagBefore } });
check("history detail 304 with same etag", r.status === 304, r.status);

await new Promise((res) => setTimeout(res, 20));
const editedStart = hoursAgo(4);
const editBody = {
  ...S1.body,
  planName: "B Push (edytowany)",
  note: "Poprawione serie",
  startedAt: editedStart,
  finishedAt: plus(editedStart, 75),
  sharedToProfile: true,
  exercises: [ex("Wyciskanie na ławce", [["80", "8"], ["85", "6"]]), ex("Wiosłowanie", [["60", "10"]])],
};
r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: editBody });
check("PUT completed session 200 while another active exists", r.status === 200, r);
check("edit keeps id, applies fields", r.json?.id === S1.id && r.json.clientId === S1.body.clientId && r.json.planName === "B Push (edytowany)" && r.json.note === "Poprawione serie" && r.json.status === "completed" && r.json.sharedToProfile === true && Date.parse(r.json.startedAt) === Date.parse(editedStart) && Date.parse(r.json.finishedAt) === Date.parse(plus(editedStart, 75)), r.json);
check("edit replaces exercises/sets", r.json?.exercises?.length === 2 && r.json.exercises[0].exerciseName === "Wyciskanie na ławce" && r.json.exercises[0].sets.length === 2 && r.json.exercises[1].sets.length === 1, r.json?.exercises);
check("edit bumps updatedAt", r.json && Date.parse(r.json.updatedAt) > Date.parse(updatedAtBefore), [updatedAtBefore, r.json?.updatedAt]);
r = await req("GET", `/api/v1/training-history/${S1.id}`, { token: b.token, headers: { "If-None-Match": etagBefore } });
check("history detail etag changed after edit", r.status === 200 && r.headers.get("etag") !== etagBefore && r.json.durationSec === 4500 && r.json.note === "Poprawione serie", { status: r.status, etag: r.headers.get("etag"), etagBefore });
r = await req("GET", `/posts/${S1.id}`, { token: a.token });
check("edit keeps kudos and comments", r.status === 200 && r.json.kudosCount === 1 && r.json.commentCount === 1 && r.json.hasKudoed === true && r.json.title === "B Push (edytowany)", r.json);
r = await req("GET", "/training-sessions/active", { token: b.token });
check("active session untouched", r.status === 200 && r.json?.id === ACT.id, r.json?.id);

r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: { ...editBody, finishedAt: plus(editedStart, -1) } });
check("PUT finishedAt < startedAt 400", r.status === 400 && r.json.error === "invalid_date_range", r);
r = await req("POST", "/training-sessions", { token: b.token, body: { ...sessionBody("bad range"), finishedAt: hoursAgo(5) } });
check("POST finishedAt < startedAt 400", r.status === 400 && r.json.error === "invalid_date_range", r);
r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: { ...editBody, finishedAt: editedStart } });
check("PUT finishedAt == startedAt 200", r.status === 200 && r.json.finishedAt === r.json.startedAt, r);
r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: { ...editBody, sharedToProfile: false } });
check("PUT preserves sharedToProfile=false as sent", r.status === 200 && r.json.sharedToProfile === false, r);
r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: editBody });
check("PUT restores edit", r.status === 200 && r.json.sharedToProfile === true, r);

// ---- DELETE by id ----
r = await req("DELETE", `/training-sessions/${S1.id}`);
check("DELETE 401 without auth", r.status === 401, r);
r = await req("DELETE", `/training-sessions/${S1.id}`, { token: a.token });
check("DELETE someone else's session 404", r.status === 404 && r.json.error === "not_found_or_not_yours", r);
r = await req("DELETE", `/training-sessions/${randomUUID()}`, { token: b.token });
check("DELETE unknown session 404", r.status === 404 && r.json.error === "not_found_or_not_yours", r);
r = await req("DELETE", `/training-sessions/not-a-uuid`, { token: b.token });
check("DELETE invalid uuid 400", r.status === 400 && r.json.error === "invalid_uuid", r);

r = await req("DELETE", `/training-sessions/${S1.id}`, { token: b.token });
check("DELETE completed session 204", r.status === 204 && r.text === "", r);
check("cascade: kudos/comments/exercises gone", await sql(`SELECT (SELECT count(*) FROM session_kudos WHERE session_id='${S1.id}') || ',' || (SELECT count(*) FROM session_comments WHERE session_id='${S1.id}') || ',' || (SELECT count(*) FROM training_session_exercises WHERE session_id='${S1.id}')`) === "0,0,0");
check("tombstone row", await sql(`SELECT client_id || ',' || user_id FROM training_session_tombstones WHERE session_id='${S1.id}'`) === `${S1.body.clientId},${b.id}`);
r = await req("DELETE", `/training-sessions/${S1.id}`, { token: b.token });
check("DELETE again 204 (idempotent)", r.status === 204, r);
r = await req("DELETE", `/training-sessions/${S1.id}`, { token: a.token });
check("DELETE of other user's tombstoned id still 404", r.status === 404 && r.json.error === "not_found_or_not_yours", r);

r = await req("GET", `/api/v1/training-history/${S1.id}`, { token: b.token });
check("training-history detail 404 after delete", r.status === 404, r);
r = await req("GET", `/api/v1/training-history?limit=50`, { token: b.token });
check("training-history list omits deleted", r.status === 200 && !r.json.items.some((x) => x.id === S1.id), r.json);
r = await req("GET", `/posts/${S1.id}`, { token: a.token });
check("post 404 after delete", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("GET", "/feed?limit=50", { token: a.token });
check("feed omits deleted", r.status === 200 && !r.json.items.some((p) => p.id === S1.id), r.json);
r = await req("GET", `/users/${b.id}/posts?limit=20`, { token: a.token });
check("users/:id/posts omits deleted", r.status === 200 && Array.isArray(r.json.items) && !r.json.items.some((x) => x.id === S1.id), r.json);
r = await req("GET", `/users/${b.id}/posts?limit=20`, { token: b.token });
check("own users/:id/posts omits deleted", r.status === 200 && Array.isArray(r.json.items) && !r.json.items.some((x) => x.id === S1.id), r.json);
r = await req("GET", `/posts/${S1.id}/comments`, { token: a.token });
check("comments on deleted post 404", r.status === 404, r);

// ---- resurrection guard ----
r = await req("PUT", `/training-sessions/${S1.id}`, { token: b.token, body: editBody });
check("PUT deleted session 410", r.status === 410 && r.json.error === "session_deleted", r);
r = await req("POST", "/training-sessions", { token: b.token, body: editBody });
check("POST (fallback upsert) deleted clientId 410", r.status === 410 && r.json.error === "session_deleted", r);
r = await req("PATCH", `/training-sessions/${S1.id}/shared-to-profile`, { token: b.token, body: { sharedToProfile: false } });
check("PATCH deleted session 410", r.status === 410 && r.json.error === "session_deleted", r);
check("nothing resurrected", await sql(`SELECT count(*) FROM training_sessions WHERE user_id='${b.id}' AND client_id='${S1.body.clientId}'`) === "0");
r = await req("POST", "/training-sessions", { token: a.token, body: { ...editBody, sharedToProfile: false } });
check("tombstones are per user: A may use the same clientId", r.status === 201, r);
const A_SAME = r.json?.id;
r = await req("PATCH", `/training-sessions/${S1.id}/shared-to-profile`, { token: a.token, body: { sharedToProfile: true } });
check("PATCH other user's deleted id → 404 (not 410)", r.status === 404 && r.json.error === "not_found_or_not_yours", r);

// ---- DELETE by client id ----
const S2 = await create(b, "B by clientId", { startedAt: hoursAgo(5) });
r = await req("DELETE", `/training-sessions/by-client-id/${S2.body.clientId}`, { token: b.token });
check("DELETE by-client-id existing 204", r.status === 204, r);
check("by-client-id tombstone carries real id", await sql(`SELECT session_id FROM training_session_tombstones WHERE user_id='${b.id}' AND client_id='${S2.body.clientId}'`) === S2.id);
const s2DeletedAt = await sql(`SELECT deleted_at FROM training_session_tombstones WHERE session_id='${S2.id}'`);
r = await req("DELETE", `/training-sessions/by-client-id/${S2.body.clientId}`, { token: b.token });
check("DELETE by-client-id again 204", r.status === 204, r);
r = await req("DELETE", `/training-sessions/${S2.id}`, { token: b.token });
check("DELETE by id after by-client-id 204", r.status === 204, r);
check("tombstone keeps earliest deleted_at, single row", await sql(`SELECT count(*) || ',' || max(deleted_at) FROM training_session_tombstones WHERE user_id='${b.id}' AND client_id='${S2.body.clientId}'`) === `1,${s2DeletedAt}`);
r = await req("PUT", `/training-sessions/${S2.id}`, { token: b.token, body: S2.body });
check("PUT after by-client-id delete 410", r.status === 410 && r.json.error === "session_deleted", r);
r = await req("POST", "/training-sessions", { token: b.token, body: S2.body });
check("POST after by-client-id delete 410", r.status === 410, r);

const C3 = randomUUID();
r = await req("DELETE", `/training-sessions/by-client-id/${C3}`, { token: b.token });
check("DELETE by-client-id never-synced 204", r.status === 204, r);
r = await req("POST", "/training-sessions", { token: b.token, body: sessionBody("queued create", { clientId: C3 }) });
check("queued create after by-client-id delete 410", r.status === 410 && r.json.error === "session_deleted", r);
r = await req("DELETE", `/training-sessions/by-client-id/not-a-uuid`, { token: b.token });
check("DELETE by-client-id invalid uuid 400", r.status === 400 && r.json.error === "invalid_uuid", r);
r = await req("DELETE", `/training-sessions/by-client-id`, { token: b.token });
check("DELETE /training-sessions/by-client-id (no id) → :id route invalid_uuid", r.status === 400 && r.json.error === "invalid_uuid", r);

r = await req("DELETE", `/training-sessions/by-client-id/${editBody.clientId}`, { token: b.token });
check("B by-client-id on A's clientId (B already tombstoned) 204", r.status === 204, r);
r = await req("GET", `/api/v1/training-history/${A_SAME}`, { token: a.token });
check("A's session with same clientId untouched", r.status === 200, r);

// ---- other statuses ----
r = await req("DELETE", `/training-sessions/${ACT.id}`, { token: b.token });
check("DELETE active session 204", r.status === 204, r);
r = await req("GET", "/training-sessions/active", { token: b.token });
check("no active session after delete", r.status === 200 && r.json === null, r);
const ACT2 = await create(b, "B active 2", { status: "active", startedAt: hoursAgo(0.1) });
check("new active session allowed", !!ACT2.id);
const CAN = await create(b, "B cancelled", { status: "cancelled", startedAt: hoursAgo(6) });
r = await req("DELETE", `/training-sessions/${CAN.id}`, { token: b.token });
check("DELETE cancelled session 204", r.status === 204, r);

// ---- deleted[] sync ----
const KEEP1 = await create(b, "B keep 1", { startedAt: hoursAgo(7) });
const KEEP2 = await create(b, "B keep 2", { startedAt: hoursAgo(8) });
r = await req("GET", `/training-sessions/history?updatedSince=${encodeURIComponent(syncStart)}`, { token: b.token });
const del = r.json?.deleted ?? [];
const byId = new Map(del.map((d) => [d.id, d]));
check("history: items/nextCursor/hasMore unchanged shape", r.status === 200 && Array.isArray(r.json.items) && "nextCursor" in r.json && typeof r.json.hasMore === "boolean", r.json);
check("history items exclude deleted", r.json && !r.json.items.some((x) => [S1.id, S2.id, CAN.id].includes(x.id)) && r.json.items.some((x) => x.id === KEEP1.id), r.json?.items?.map((x) => x.id));
check("deleted[] has S1 with clientId", byId.get(S1.id)?.clientId === S1.body.clientId && !Number.isNaN(Date.parse(byId.get(S1.id)?.deletedAt)), del);
check("deleted[] has S2, ACT, CAN", byId.has(S2.id) && byId.get(ACT.id)?.clientId === ACT.body.clientId && byId.has(CAN.id), del);
const c3Entry = del.find((d) => d.clientId === C3);
check("deleted[] has never-synced clientId with a random id", c3Entry && c3Entry.id !== C3 && /^[0-9a-f-]{36}$/.test(c3Entry.id), c3Entry);
check("deleted[] count exact (S1, S2, C3, ACT, CAN)", del.length === 5, del);
check("deleted[] entry shape", del.every((d) => Object.keys(d).sort().join() === "clientId,deletedAt,id"), del[0]);
// deleted_at has µs precision, the JSON only ms → step 1 ms past it (re-delivery at the same ms is harmless).
const s1DeletedAt = new Date(Date.parse(byId.get(S1.id)?.deletedAt) + 1).toISOString();
r = await req("GET", `/training-sessions/history?updatedSince=${encodeURIComponent(s1DeletedAt)}`, { token: b.token });
check("deleted[] strictly after updatedSince", r.status === 200 && !r.json.deleted.some((d) => d.id === S1.id) && r.json.deleted.some((d) => d.id === CAN.id), r.json?.deleted);
r = await req("GET", `/training-sessions/history?updatedSince=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`, { token: b.token });
check("deleted[] empty for future updatedSince", r.status === 200 && r.json.deleted.length === 0 && r.json.items.length === 0, r.json);
r = await req("GET", `/training-sessions/history`, { token: b.token });
check("deleted[] empty without updatedSince", r.status === 200 && Array.isArray(r.json.deleted) && r.json.deleted.length === 0 && r.json.items.length >= 2, r.json);
r = await req("GET", `/training-sessions/history?limit=1&updatedSince=${encodeURIComponent(syncStart)}`, { token: b.token });
check("page 1 (limit=1) has deleted[] and more", r.status === 200 && r.json.hasMore === true && r.json.deleted.length === 5, r.json);
r = await req("GET", `/training-sessions/history?limit=1&updatedSince=${encodeURIComponent(syncStart)}&cursor=${r.json.nextCursor}`, { token: b.token });
check("page 2 deleted[] empty", r.status === 200 && r.json.items.length === 1 && r.json.deleted.length === 0, r.json);
r = await req("GET", `/training-sessions/history?updatedSince=${encodeURIComponent(syncStart)}`, { token: a.token });
check("deleted[] is per user", r.status === 200 && r.json.deleted.length === 0, r.json?.deleted);

// ---- race: concurrent create vs delete-by-client-id ----
const raceIds = Array.from({ length: 15 }, () => randomUUID());
const results = await Promise.all(raceIds.map(async (cid, i) => {
  const body = sessionBody(`race ${i}`, { clientId: cid, startedAt: hoursAgo(10 + i) });
  const [p, d] = await Promise.all([
    req("POST", "/training-sessions", { token: b.token, body }),
    req("DELETE", `/training-sessions/by-client-id/${cid}`, { token: b.token }),
  ]);
  return [p.status, d.status];
}));
check("race: POST is 201 or 410, DELETE is 204", results.every(([p, d]) => (p === 201 || p === 410) && d === 204), results);
const list = raceIds.map((id) => `'${id}'`).join(",");
check("race: no session survives a delete", await sql(`SELECT count(*) FROM training_sessions WHERE user_id='${b.id}' AND client_id IN (${list})`) === "0");
check("race: every clientId tombstoned once", await sql(`SELECT count(*) FROM training_session_tombstones WHERE user_id='${b.id}' AND client_id IN (${list})`) === "15");
console.log("race outcomes (POST status):", results.map(([p]) => p).join(" "));

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
