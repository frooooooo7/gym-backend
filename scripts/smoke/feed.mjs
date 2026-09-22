// Smoke test: feed, posts, kudos, comments, suggested users (real server + Postgres).
// Standalone: BASE=http://localhost:3101 [API_PREFIX=/api/v1] node scripts/smoke/feed.mjs
// Needs a fresh server (in-memory rate limiters) — see run-all.mjs.
import { apiPath, BASE } from "./lib.mjs";
import { randomUUID } from "node:crypto";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 1500));
  }
};
const req = async (method, path, { token, body } = {}) => {
  const headers = {};
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
  return { status: res.status, json };
};

const stamp = Date.now();
const register = async (first, last) => {
  const r = await req("POST", "/auth/register", {
    body: { email: `${first.toLowerCase()}.p2.${stamp}@smoke.test`, password: "Sup3rTajne!haslo", firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 || r.status === 200, r);
  return { token: r.json.token, id: r.json.user.id };
};

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const ex = (name, muscles, position, sets, exerciseId = null) => ({
  exerciseId,
  exerciseName: name,
  exerciseMuscles: muscles,
  exerciseCategory: "compound",
  position,
  sets: sets.map(([w, r, completed], i) => ({
    position: i,
    plannedWeight: w,
    plannedReps: r ?? "",
    actualWeight: w,
    actualReps: r,
    completed,
  })),
});
const simpleExercises = [ex("Martwy ciąg", ["back", "legs"], 0, [["100", "5", true]])];

const createSession = async (user, label, { startedAt, status = "completed", share = false, exercises = simpleExercises, note = null }) => {
  const r = await req("POST", "/training-sessions", {
    token: user.token,
    body: {
      clientId: randomUUID(),
      planName: label,
      status,
      note,
      startedAt,
      finishedAt: new Date(Date.parse(startedAt) + 57 * 60_000).toISOString(),
      exercises,
    },
  });
  check(`create session ${label}`, r.status === 201 && r.json.sharedToProfile === false, r);
  if (share) {
    const p = await req("PATCH", `/training-sessions/${r.json.id}/shared-to-profile`, { token: user.token, body: { sharedToProfile: true } });
    check(`share ${label}`, p.status === 200 && p.json.sharedToProfile === true, p);
  }
  return r.json.id;
};

const a = await register("Anna", "Feedowa");
const b = await register("Bartek", "Feedowy");
const c = await register("Celina", "Obca");
const d = await register("Dawid", "Nowy");

let r = await req("POST", `/users/${b.id}/follow`, { token: a.token });
check("A follows B", r.status === 200 && r.json.isFollowing === true, r);

// ---- sessions ----
const s1Exercises = [
  ex("Wyciskanie sztangi na ławce", ["chest", "triceps"], 0, [["80", "8", true], ["82,5", "8", true], ["82.5", "6", true], ["120", "5", false]], "a1000000-0000-0000-0000-000000000001"),
  ex("Podciąganie na drążku", ["back", "biceps"], 1, [["", "10", true]]),
  ex("Przysiad ze sztangą", ["legs", "glutes"], 2, [["100", "5", false]]),
  ex("Wyciskanie hantli nad głowę", ["shoulders", "triceps"], 3, [["40", "10", true]]),
  ex("Uginanie ramion z hantlami", ["biceps"], 4, [["15", "12", true]]),
];
const tie = hoursAgo(3);
const S1 = await createSession(b, "B Push", { startedAt: hoursAgo(1), share: true, exercises: s1Exercises, note: "Nowy rekord" });
const A1 = await createSession(a, "A shared", { startedAt: hoursAgo(2), share: true });
const S2 = await createSession(b, "B tie 1", { startedAt: tie, share: true });
const S4 = await createSession(b, "B tie 2", { startedAt: tie, share: true });
const A2 = await createSession(a, "A private", { startedAt: hoursAgo(1.5) });
const S3 = await createSession(b, "B private", { startedAt: hoursAgo(0.5) });
const C1 = await createSession(c, "C shared", { startedAt: hoursAgo(0.25), share: true });
const B5 = await createSession(b, "B cancelled", { startedAt: hoursAgo(4), status: "cancelled" });
await req("PATCH", `/training-sessions/${B5}/shared-to-profile`, { token: b.token, body: { sharedToProfile: true } });

// ---- feed ----
r = await req("GET", "/feed");
check("feed 401 without auth", r.status === 401, r);

const tieOrder = [S2, S4].sort().reverse();
const expectedFeedA = [S1, A1, ...tieOrder];
r = await req("GET", "/feed?limit=50", { token: a.token });
check("A feed: own + followed shared, ordered", r.status === 200 && JSON.stringify(r.json.items.map((p) => p.id)) === JSON.stringify(expectedFeedA) && r.json.hasMore === false && r.json.nextCursor === null, r.json?.items?.map((p) => [p.id, p.title, p.startedAt]));
const feedIds = new Set(r.json.items.map((p) => p.id));
check("A feed excludes non-shared / foreign / cancelled", ![S3, A2, C1, B5].some((id) => feedIds.has(id)));
const p1 = r.json.items.find((p) => p.id === S1);
check("post author", p1 && p1.author.id === b.id && p1.author.firstName === "Bartek" && p1.author.lastName === "Feedowy" && typeof p1.author.handle === "string" && p1.author.avatarUrl === null, p1?.author);
check("post basics", p1 && p1.title === "B Push" && p1.note === "Nowy rekord" && p1.durationSec === 3420 && p1.finishedAt !== null && p1.isOwn === false && p1.hasKudoed === false && p1.kudosCount === 0 && p1.commentCount === 0 && Array.isArray(p1.recentKudos) && p1.recentKudos.length === 0, p1);
check("post aggregates", p1 && p1.exercisesCount === 5 && p1.completedSetsCount === 6 && p1.totalVolumeKg === 2375, p1 && [p1.exercisesCount, p1.completedSetsCount, p1.totalVolumeKg]);
check("post muscles by first appearance", p1 && JSON.stringify(p1.muscles) === JSON.stringify(["chest", "triceps", "back", "biceps", "legs", "glutes", "shoulders"]), p1?.muscles);
check("post topExercises", p1 && JSON.stringify(p1.topExercises) === JSON.stringify([
  { name: "Wyciskanie sztangi na ławce", completedSets: 3, bestSet: { weightKg: 82.5, reps: 8 } },
  { name: "Podciąganie na drążku", completedSets: 1, bestSet: null },
  { name: "Wyciskanie hantli nad głowę", completedSets: 1, bestSet: { weightKg: 40, reps: 10 } },
]), p1?.topExercises);
check("own post isOwn", r.json.items.find((p) => p.id === A1)?.isOwn === true);

for (const limit of [1, 2, 3]) {
  const seen = [];
  let cursor = null;
  let pages = 0;
  let lastPage;
  do {
    const page = await req("GET", `/feed?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, { token: a.token });
    if (page.status !== 200) { check(`feed page limit=${limit}`, false, page); break; }
    seen.push(...page.json.items.map((p) => p.id));
    cursor = page.json.nextCursor;
    lastPage = page.json;
    pages++;
  } while (cursor && pages < 10);
  check(`feed pagination limit=${limit}`, JSON.stringify(seen) === JSON.stringify(expectedFeedA) && lastPage?.hasMore === false && lastPage?.nextCursor === null, seen);
}
r = await req("GET", "/feed?limit=2", { token: a.token });
check("feed page 1 hasMore", r.status === 200 && r.json.hasMore === true && typeof r.json.nextCursor === "string", r.json);

r = await req("GET", "/feed?cursor=nonsense", { token: a.token });
check("feed invalid cursor", r.status === 400 && r.json.error === "invalid_cursor", r);
r = await req("GET", "/feed?limit=0", { token: a.token });
check("feed limit 0", r.status === 400 && r.json.error === "invalid_limit", r);
r = await req("GET", "/feed?limit=51", { token: a.token });
check("feed limit 51", r.status === 400 && r.json.error === "invalid_limit", r);

r = await req("GET", "/feed", { token: b.token });
check("B feed (follows nobody): own shared only", r.status === 200 && JSON.stringify(r.json.items.map((p) => p.id)) === JSON.stringify([S1, ...tieOrder]), r.json?.items?.map((p) => p.id));

// ---- post detail ----
r = await req("GET", `/posts/${S1}`, { token: a.token });
check("post detail 200", r.status === 200 && r.json.id === S1 && r.json.totalVolumeKg === 2375 && r.json.topExercises.length === 3 && r.json.exercises.length === 5, r);
const bench = r.json?.exercises?.[0];
check("post detail exercise shape", bench && bench.exerciseId === "a1000000-0000-0000-0000-000000000001" && bench.exerciseName === "Wyciskanie sztangi na ławce" && JSON.stringify(bench.exerciseMuscles) === '["chest","triceps"]' && bench.exerciseCategory === "compound" && bench.imageUrl === null && bench.sets.length === 4, bench);
check("post detail set shape (comma decimal)", bench && bench.sets[1].setIndex === 1 && bench.sets[1].actual.weightKg === 82.5 && bench.sets[1].actual.reps === 8 && bench.sets[1].planned.weightKg === 82.5 && bench.sets[1].completed === true && bench.sets[3].completed === false, bench?.sets);
check("post detail exercise order", r.json?.exercises?.map((e) => e.exerciseName)[4] === "Uginanie ramion z hantlami");
r = await req("GET", `/posts/${S1}`, { token: c.token });
check("shared post visible to non-follower", r.status === 200 && r.json.isOwn === false, r);
r = await req("GET", `/posts/${C1}`, { token: a.token });
check("C shared post visible to A", r.status === 200, r);
r = await req("GET", `/posts/${A2}`, { token: a.token });
check("own private post visible", r.status === 200 && r.json.isOwn === true, r);
r = await req("GET", `/posts/${S3}`, { token: a.token });
check("foreign private post 404", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("GET", `/posts/${B5}`, { token: b.token });
check("cancelled session 404 even for owner", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("GET", `/posts/${randomUUID()}`, { token: a.token });
check("unknown post 404", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("GET", `/posts/not-a-uuid`, { token: a.token });
check("post invalid uuid", r.status === 400 && r.json.error === "invalid_uuid", r);

// ---- kudos ----
r = await req("POST", `/posts/${S1}/kudos`, { token: a.token });
check("A kudos S1", r.status === 200 && r.json.hasKudoed === true && r.json.kudosCount === 1, r);
r = await req("POST", `/posts/${S1}/kudos`, { token: a.token });
check("kudos idempotent", r.status === 200 && r.json.kudosCount === 1, r);
r = await req("POST", `/posts/${S1}/kudos`, { token: c.token });
check("C kudos S1", r.status === 200 && r.json.kudosCount === 2, r);
r = await req("POST", `/posts/${S1}/kudos`, { token: b.token });
check("own post kudos 400", r.status === 400 && r.json.error === "cannot_kudo_own_post", r);
r = await req("POST", `/posts/${S3}/kudos`, { token: a.token });
check("kudos invisible post 404", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("DELETE", `/posts/${S3}/kudos`, { token: a.token });
check("unkudos invisible post 404", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("POST", `/posts/xyz/kudos`, { token: a.token });
check("kudos invalid uuid", r.status === 400 && r.json.error === "invalid_uuid", r);

r = await req("GET", "/feed", { token: a.token });
const p1k = r.json?.items?.find((p) => p.id === S1);
check("feed reflects kudos", p1k && p1k.kudosCount === 2 && p1k.hasKudoed === true && JSON.stringify(p1k.recentKudos.map((u) => u.id)) === JSON.stringify([c.id, a.id]) && p1k.recentKudos[0].firstName === "Celina" && !("isFollowing" in p1k.recentKudos[0]), p1k);

r = await req("POST", `/users/${c.id}/follow`, { token: b.token });
check("B follows C", r.status === 200, r);
r = await req("GET", `/posts/${S1}/kudos`, { token: b.token });
check("kudos list as B (most recent first, isFollowing)", r.status === 200 && r.json.length === 2 && r.json[0].id === c.id && r.json[0].isFollowing === true && r.json[1].id === a.id && r.json[1].isFollowing === false && Object.keys(r.json[0]).sort().join() === "avatarUrl,firstName,handle,id,isFollowing,lastName", r);
r = await req("GET", `/posts/${S1}/kudos?limit=1&offset=1`, { token: b.token });
check("kudos list limit/offset", r.status === 200 && r.json.length === 1 && r.json[0].id === a.id, r);
r = await req("GET", `/posts/${S1}/kudos?limit=101`, { token: b.token });
check("kudos list limit 101", r.status === 400 && r.json.error === "invalid_limit", r);
r = await req("GET", `/posts/${S1}/kudos?offset=-1`, { token: b.token });
check("kudos list offset -1", r.status === 400 && r.json.error === "invalid_offset", r);
r = await req("GET", `/posts/${S3}/kudos`, { token: a.token });
check("kudos list invisible 404", r.status === 404 && r.json.error === "post_not_found", r);

r = await req("DELETE", `/posts/${S1}/kudos`, { token: a.token });
check("A unkudos", r.status === 200 && r.json.hasKudoed === false && r.json.kudosCount === 1, r);
r = await req("DELETE", `/posts/${S1}/kudos`, { token: a.token });
check("unkudos idempotent", r.status === 200 && r.json.hasKudoed === false && r.json.kudosCount === 1, r);

// ---- comments ----
r = await req("POST", `/posts/${S1}/comments`, { token: a.token, body: { body: "  Świetny trening!  " } });
check("A comment 201 trimmed", r.status === 201 && r.json.body === "Świetny trening!" && r.json.isOwn === true && r.json.canDelete === true && r.json.author.id === a.id && typeof r.json.createdAt === "string" && typeof r.json.id === "string", r);
const cmA1 = r.json?.id;
r = await req("POST", `/posts/${S1}/comments`, { token: c.token, body: { body: "Brawo" } });
check("C comment 201 (author may delete own)", r.status === 201 && r.json.isOwn === true && r.json.canDelete === true, r);
const cmC1 = r.json?.id;
r = await req("POST", `/posts/${S1}/comments`, { token: b.token, body: { body: "Dzięki!" } });
check("owner comment 201", r.status === 201 && r.json.canDelete === true, r);
const cmB1 = r.json?.id;
r = await req("POST", `/posts/${S1}/comments`, { token: a.token, body: { body: "Kolejny" } });
const cmA2 = r.json?.id;
r = await req("POST", `/posts/${S1}/comments`, { token: c.token, body: { body: "Ostatni" } });
const cmC2 = r.json?.id;
r = await req("POST", `/posts/${S1}/comments`, { token: d.token, body: { body: "💪".repeat(500) } });
check("500 code-point comment accepted", r.status === 201 && Array.from(r.json.body).length === 500, r.status);
const cmD1 = r.json?.id;

for (const [label, body] of [["whitespace", { body: "   " }], ["empty", { body: "" }], ["501 chars", { body: "a".repeat(501) }], ["501 emoji", { body: "💪".repeat(501) }], ["missing", {}], ["number", { body: 5 }]]) {
  r = await req("POST", `/posts/${S1}/comments`, { token: d.token, body });
  check(`comment invalid body (${label})`, r.status === 400 && r.json.error === "invalid_comment_body", r);
}
r = await req("POST", `/posts/${S3}/comments`, { token: a.token, body: { body: "hej" } });
check("comment invisible post 404", r.status === 404 && r.json.error === "post_not_found", r);

const allComments = [cmA1, cmC1, cmB1, cmA2, cmC2, cmD1];
r = await req("GET", `/posts/${S1}/comments`, { token: a.token });
check("comments list oldest first", r.status === 200 && JSON.stringify(r.json.items.map((x) => x.id)) === JSON.stringify(allComments) && r.json.hasMore === false && r.json.nextCursor === null, r.json?.items?.map((x) => x.id));
check("comments canDelete as non-owner", r.json?.items?.map((x) => `${x.isOwn}/${x.canDelete}`).join() === "true/true,false/false,false/false,true/true,false/false,false/false", r.json?.items?.map((x) => [x.isOwn, x.canDelete]));
r = await req("GET", `/posts/${S1}/comments`, { token: b.token });
check("comments canDelete as post owner", r.status === 200 && r.json.items.every((x) => x.canDelete === true) && r.json.items.map((x) => x.isOwn).join() === "false,false,true,false,false,false", r.json?.items);
{
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await req("GET", `/posts/${S1}/comments?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: c.token });
    if (page.status !== 200) { check("comments page", false, page); break; }
    seen.push(...page.json.items.map((x) => x.id));
    cursor = page.json.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  check("comments pagination limit=2", JSON.stringify(seen) === JSON.stringify(allComments) && pages === 3, { seen, pages });
}
r = await req("GET", `/posts/${S1}/comments?cursor=abc`, { token: a.token });
check("comments invalid cursor", r.status === 400 && r.json.error === "invalid_cursor", r);
const feedPage = await req("GET", "/feed?limit=1", { token: a.token });
r = await req("GET", `/posts/${S1}/comments?cursor=${feedPage.json.nextCursor}`, { token: a.token });
check("feed cursor rejected for comments", r.status === 400 && r.json.error === "invalid_cursor", r);
r = await req("GET", `/posts/${S1}/comments?limit=101`, { token: a.token });
check("comments limit 101", r.status === 400 && r.json.error === "invalid_limit", r);
r = await req("GET", `/posts/${S3}/comments`, { token: a.token });
check("comments invisible 404", r.status === 404 && r.json.error === "post_not_found", r);

// delete
r = await req("DELETE", `/posts/${S1}/comments/${cmA1}`, { token: c.token });
check("delete someone else's comment 403", r.status === 403 && r.json.error === "forbidden", r);
r = await req("DELETE", `/posts/${S1}/comments/${cmC1}`, { token: b.token });
check("post owner deletes comment 204", r.status === 204, r);
r = await req("DELETE", `/posts/${S1}/comments/${cmA1}`, { token: a.token });
check("author deletes comment 204", r.status === 204, r);
r = await req("DELETE", `/posts/${S1}/comments/${cmA1}`, { token: a.token });
check("delete again 404", r.status === 404 && r.json.error === "comment_not_found", r);
r = await req("DELETE", `/posts/${A1}/comments/${cmA2}`, { token: a.token });
check("comment on another post 404", r.status === 404 && r.json.error === "comment_not_found", r);
r = await req("DELETE", `/posts/${S3}/comments/${cmA2}`, { token: a.token });
check("delete on invisible post 404", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("DELETE", `/posts/${S1}/comments/nope`, { token: a.token });
check("delete invalid comment uuid", r.status === 400 && r.json.error === "invalid_uuid", r);

r = await req("GET", "/feed", { token: a.token });
const p1c = r.json?.items?.find((p) => p.id === S1);
check("feed reflects comments", p1c && p1c.commentCount === 4 && p1c.kudosCount === 1 && p1c.hasKudoed === false, p1c);

// ---- profile timeline (user posts) ----
r = await req("GET", `/users/${b.id}/posts?limit=5`, { token: c.token });
const actC = r.json?.items?.find?.((x) => x.id === S1);
check("users/:id/posts real counts (C kudoed)", r.status === 200 && actC && actC.kudosCount === 1 && actC.commentCount === 4 && actC.hasKudoed === true && actC.isOwn === false && Array.isArray(actC.topExercises), r.json);
r = await req("GET", `/users/${b.id}/posts?limit=5`, { token: a.token });
check("users/:id/posts hasKudoed false for A", r.status === 200 && r.json.items.find((x) => x.id === S1)?.hasKudoed === false, r.json);
r = await req("GET", `/users/${b.id}/posts?limit=5`, { token: b.token });
const actB = r.json?.items?.find?.((x) => x.id === S1);
check("own users/:id/posts real counts", r.status === 200 && actB && actB.kudosCount === 1 && actB.commentCount === 4 && actB.hasKudoed === false && actB.isOwn === true, r.json);
check("own users/:id/posts volume", Math.round(actB?.totalVolumeKg ?? 0) === 2375, actB);

// ---- suggested users ----
r = await req("GET", "/users/suggested?limit=30", { token: a.token });
const sugIds = r.json?.map?.((u) => u.id) ?? [];
check("suggested excludes self and followed", r.status === 200 && !sugIds.includes(a.id) && !sugIds.includes(b.id), r.json);
check("suggested isFollowing false + shape", r.status === 200 && r.json.every((u) => u.isFollowing === false && "handle" in u && "avatarUrl" in u), r.json);
check("suggested: active user before inactive", sugIds.includes(c.id) && sugIds.includes(d.id) && sugIds.indexOf(c.id) < sugIds.indexOf(d.id), sugIds);
r = await req("GET", "/users/suggested", { token: a.token });
check("suggested default limit 10", r.status === 200 && r.json.length <= 10, r.json?.length);
r = await req("GET", "/users/suggested?limit=31", { token: a.token });
check("suggested limit 31", r.status === 400 && r.json.error === "invalid_limit", r);

// ---- unshare ----
r = await req("PATCH", `/training-sessions/${S2}/shared-to-profile`, { token: b.token, body: { sharedToProfile: false } });
check("B unshares S2", r.status === 200 && r.json.sharedToProfile === false, r);
r = await req("GET", "/feed", { token: a.token });
check("unshared post leaves feed", r.status === 200 && !r.json.items.some((p) => p.id === S2) && r.json.items.some((p) => p.id === S4), r.json?.items?.map((p) => p.id));
r = await req("GET", `/posts/${S2}`, { token: a.token });
check("unshared post 404 for others", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("GET", `/posts/${S2}`, { token: b.token });
check("unshared post visible to owner", r.status === 200 && r.json.isOwn === true, r);

// ---- comment rate limit (30/min per user) ----
const e = await register("Ewa", "Limitowa");
let okCount = 0;
for (let i = 0; i < 30; i++) {
  const x = await req("POST", `/posts/${C1}/comments`, { token: e.token, body: { body: `spam ${i}` } });
  if (x.status === 201) okCount++;
}
check("30 comments allowed", okCount === 30, okCount);
r = await req("POST", `/posts/${C1}/comments`, { token: e.token, body: { body: "31" } });
check("31st comment 429", r.status === 429 && r.json.error === "too_many_requests", r);
r = await req("POST", `/posts/${C1}/comments`, { token: d.token, body: { body: "inny user" } });
check("other user not limited", r.status === 201, r);
r = await req("GET", `/posts/${C1}/comments?limit=100`, { token: c.token });
check("C1 comments count 31", r.status === 200 && r.json.items.length === 31 && r.json.hasMore === false, r.json?.items?.length);

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
