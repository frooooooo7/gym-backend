// Smoke test: plan visibility, plans on a profile, copying a plan and a post (real server + Postgres).
// Standalone: BASE=http://localhost:3101 [API_PREFIX=/api/v1] node scripts/smoke/plans.mjs
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
    body: { email: `${first.toLowerCase()}.pl.${stamp}@smoke.test`, password: "Sup3rTajne!haslo", firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 || r.status === 200, r);
  return { token: r.json.token, id: r.json.user.id };
};

const SQUAT = "a1000000-0000-0000-0000-000000000003";
const BENCH = "a1000000-0000-0000-0000-000000000001";
const a = await register("Anna", "Plany");
const b = await register("Bartek", "Kopiuje");

// Anna's own exercise — Bartek cannot see it, so copies skip it.
let r = await req("POST", "/exercises", {
  token: a.token,
  body: { name: `Wiosłowanie Anny ${stamp}`, muscles: ["back"], category: "compound", description: "" },
});
check("A creates own exercise", r.status === 201, r);
const annaExercise = r.json.id;

const planBody = (extra = {}) => ({
  clientId: randomUUID(),
  name: "Pull B",
  note: "4 tygodnie",
  selectedDays: [2, 5],
  defaultRestSeconds: 150,
  colorKey: "teal",
  exercises: [
    { exerciseId: SQUAT, restSeconds: 180, sets: [{ weight: "100", reps: "5" }, { weight: "100", reps: "5" }] },
    { exerciseId: BENCH, supersetGroup: "A", sets: [{ weight: "60", reps: "10" }] },
    { exerciseId: annaExercise, supersetGroup: "A", sets: [{ weight: "40", reps: "12" }] },
  ],
  ...extra,
});

r = await req("POST", "/training-plans", { token: a.token, body: planBody() });
check("plan is private by default", r.status === 201 && r.json.isPublic === false && r.json.copyCount === 0 && r.json.copiedFrom === null, r);
const privatePlan = r.json;

r = await req("GET", `/users/${a.id}/plans`, { token: b.token });
check("private plan not on profile", r.status === 200 && r.json.length === 0, r);
r = await req("POST", `/training-plans/${privatePlan.id}/copy`, { token: b.token, body: {} });
check("private plan cannot be copied", r.status === 404 && r.json.error === "plan_not_found", r);

r = await req("POST", "/training-plans", { token: a.token, body: planBody({ isPublic: true, name: "Push A" }) });
check("public plan created", r.status === 201 && r.json.isPublic === true, r);
const publicPlan = r.json;

// An older client (no isPublic) keeps the visibility.
const { isPublic: _ignored, clientId: _c, ...olderBody } = planBody({ name: "Push A" });
r = await req("PUT", `/training-plans/${publicPlan.id}`, { token: a.token, body: olderBody });
check("update without isPublic keeps it public", r.status === 200 && r.json.isPublic === true, r);
const updatedAt = r.json.updatedAt;

r = await req("GET", `/users/${a.id}/plans`, { token: b.token });
check("public plan on profile without weights",
  r.status === 200 && r.json.length === 1 && r.json[0].id === publicPlan.id &&
  r.json[0].exercises.every((e) => e.sets.every((s) => s.weight === null)), r);
r = await req("GET", `/users/${a.id}/plans`, { token: a.token });
check("author sees own plans with weights", r.status === 200 && r.json.length === 2 && r.json.some((p) => p.exercises[0].sets[0].weight === "100"), r);
r = await req("GET", `/users/${randomUUID()}/plans`, { token: b.token });
check("unknown user 404", r.status === 404 && r.json.error === "user_not_found", r);

const copyClient = randomUUID();
r = await req("POST", `/training-plans/${publicPlan.id}/copy`, { token: b.token, body: { clientId: copyClient } });
check("copy created", r.status === 201, r);
const copy = r.json;
check("copy is private, credited and without weights",
  copy.isPublic === false && copy.copiedFrom?.planId === publicPlan.id && copy.copiedFrom?.userId === a.id &&
  copy.copiedFrom?.handle && copy.selectedDays.length === 0 && copy.defaultRestSeconds === 150 && copy.colorKey === "teal" &&
  copy.exercises.every((e) => e.sets.every((s) => s.weight === null)), copy);
check("copy skips Anna's own exercise and its lone superset",
  copy.skippedExercises === 1 && copy.exercises.length === 2 && copy.exercises[0].restSeconds === 180 &&
  copy.exercises[1].supersetGroup === null && copy.exercises[0].sets.length === 2 && copy.exercises[0].sets[0].reps === "5", copy);

r = await req("POST", `/training-plans/${publicPlan.id}/copy`, { token: b.token, body: { clientId: copyClient } });
check("repeated copy is idempotent", r.status === 200 && r.json.id === copy.id, r);
r = await req("GET", "/training-plans", { token: b.token });
check("B has exactly one copy", r.status === 200 && r.json.length === 1 && r.json[0].id === copy.id, r);

r = await req("GET", "/training-plans", { token: a.token });
const authorPlan = r.json.find((p) => p.id === publicPlan.id);
check("copy count bumped once, author's updatedAt kept",
  authorPlan.copyCount === 1 && authorPlan.updatedAt === updatedAt, authorPlan);

// Copy from a post.
r = await req("POST", "/training-sessions", {
  token: a.token,
  body: {
    clientId: randomUUID(),
    planName: "Nogi z Anną",
    status: "completed",
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    finishedAt: new Date(Date.now() - 600_000).toISOString(),
    exercises: [
      {
        exerciseId: SQUAT, exerciseName: "Przysiad", exerciseMuscles: ["legs"], exerciseCategory: "compound", position: 0,
        restSeconds: 200,
        sets: [
          { position: 0, setType: "warmup", plannedReps: "10", actualWeight: "40", actualReps: "10", completed: true },
          { position: 1, plannedWeight: "100", plannedReps: "5", actualWeight: "102.5", actualReps: "6", completed: true },
        ],
      },
      {
        exerciseId: annaExercise, exerciseName: "Wiosłowanie Anny", exerciseMuscles: ["back"], exerciseCategory: "compound", position: 1,
        sets: [{ position: 0, plannedReps: "12", completed: true }],
      },
    ],
  },
});
check("A session created", r.status === 201, r);
const sessionId = r.json.id;
r = await req("POST", `/posts/${sessionId}/copy-plan`, { token: b.token, body: {} });
check("unshared post cannot be copied", r.status === 404 && r.json.error === "post_not_found", r);
r = await req("PATCH", `/training-sessions/${sessionId}/shared-to-profile`, { token: a.token, body: { sharedToProfile: true } });
check("A shares session", r.status === 200, r);
r = await req("POST", `/posts/${sessionId}/copy-plan`, { token: b.token, body: { clientId: randomUUID() } });
check("post copied as plan",
  r.status === 201 && r.json.name === "Nogi z Anną" && r.json.copiedFrom?.userId === a.id && r.json.copiedFrom?.planId === null &&
  r.json.skippedExercises === 1 && r.json.exercises.length === 1 && r.json.exercises[0].restSeconds === 200 &&
  r.json.exercises[0].sets.length === 1 && r.json.exercises[0].sets[0].reps === "6" && r.json.exercises[0].sets[0].weight === null, r);

r = await req("POST", `/training-plans/${randomUUID()}/copy`, { token: b.token, body: {} });
check("unknown plan 404", r.status === 404, r);
r = await req("POST", `/training-plans/${publicPlan.id}/copy`, { token: b.token, body: { clientId: "nope" } });
check("bad clientId 400", r.status === 400, r);

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
