// Smoke test: account & security — token_version, change-password, logout-all, account deletion, limiters,
// onboarding profile details (real server + Postgres).
// Standalone: BASE=http://localhost:3101 DATABASE_URL=... [API_PREFIX=/api/v1] [SMOKE_BACKEND_DIR=<server cwd>] node scripts/smoke/account.mjs
// Needs a fresh server (in-memory rate limiters) — see run-all.mjs.
import { apiPath, BACKEND_DIR, BASE, closeDb, sql } from "./lib.mjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 1500));
  }
};
const req = async (method, p, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + apiPath(p), { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
};
const tv = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).tv;
const onDisk = (publicUrl) => fs.existsSync(path.join(BACKEND_DIR, publicUrl));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pngForm = (field, name) => {
  const form = new FormData();
  form.append(field, new Blob([png], { type: "image/png" }), name);
  return form;
};

const stamp = Date.now();
const PASSWORD = "Sup3rTajne!haslo";
const NEW_PASSWORD = "N0weHaslo!xyz";
const emailOf = (first) => `${first.toLowerCase()}.p4.${stamp}@smoke.test`;
const register = async (first, last) => {
  const r = await req("POST", "/auth/register", {
    body: { email: emailOf(first), password: PASSWORD, firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 && tv(r.json.token) === 0, r);
  return { token: r.json.token, id: r.json.user.id, email: emailOf(first) };
};
const login = (email, password) => req("POST", "/auth/login", { body: { email, password } });
const SYSTEM_EX = "a1000000-0000-0000-0000-000000000001";
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const sessionBody = (label, exercises, share = true) => {
  const startedAt = hoursAgo(2);
  return {
    clientId: randomUUID(),
    planName: label,
    status: "completed",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    sharedToProfile: share,
    exercises: exercises.map(({ name, exerciseId = null }) => ({
      exerciseId,
      exerciseName: name,
      exerciseMuscles: ["chest"],
      exerciseCategory: "compound",
      sets: [{ position: 0, plannedWeight: "50", plannedReps: "5", actualWeight: "50", actualReps: "5", completed: true }],
    })),
  };
};

check("migration 015 applied", await sql("SELECT count(*) FROM _migrations WHERE name='015_users_token_version'") === "1");
check("token_version column NOT NULL DEFAULT 0", await sql("SELECT is_nullable || ',' || column_default FROM information_schema.columns WHERE table_name='users' AND column_name='token_version'") === "NO,0");

const a = await register("Ala", "Haslowa");
const b = await register("Bogdan", "Usuwany");
const c = await register("Cezary", "Zostaje");

// ================= onboarding / private profile details =================
check("migration 016 applied", await sql("SELECT count(*) FROM _migrations WHERE name='016_users_profile_details'") === "1");
let r = await req("GET", "/auth/me", { token: c.token });
check("new account → onboardingCompleted false", r.status === 200 && r.json.onboardingCompleted === false, r);
const cHandle = `cez_${stamp}`;
r = await req("PATCH", "/profile/me", {
  token: c.token,
  body: { handle: cHandle.toUpperCase(), birthDate: "1995-06-15", gender: "male", heightCm: 181, weightKg: 79.44, trainingGoal: "strength", experienceLevel: "intermediate", weeklyTrainingDays: 4 },
});
check(
  "PATCH /profile/me stores handle + details (weight rounded to 0.1)",
  r.status === 200 && r.json.handle === cHandle && r.json.onboardingCompleted === false &&
    JSON.stringify(r.json.details) === JSON.stringify({ birthDate: "1995-06-15", gender: "male", heightCm: 181, weightKg: 79.4, trainingGoal: "strength", experienceLevel: "intermediate", weeklyTrainingDays: 4 }),
  r,
);
r = await req("PATCH", "/profile/me", { token: b.token, body: { handle: cHandle } });
check("duplicate handle → 409 handle_taken", r.status === 409 && r.json.error === "handle_taken", r);
r = await req("PATCH", "/profile/me", { token: c.token, body: { birthDate: new Date().toISOString().slice(0, 10) } });
check("too young → 400 invalid_birth_date", r.status === 400 && r.json.error === "invalid_birth_date", r);
r = await req("GET", `/users/${c.id}/profile`, { token: b.token });
check("other users never see details", r.status === 200 && !("details" in r.json) && !("onboardingCompleted" in r.json), r);
r = await req("PATCH", "/profile/me", { token: c.token, body: { weightKg: null } });
check("null clears only that detail", r.status === 200 && r.json.details.weightKg === null && r.json.details.heightCm === 181, r);
r = await req("POST", "/profile/me/onboarding/complete", { token: c.token });
check("complete onboarding → own profile with onboardingCompleted", r.status === 200 && r.json.onboardingCompleted === true && r.json.id === c.id, r);
const completedAt = await sql(`SELECT onboarding_completed_at FROM users WHERE id='${c.id}'`);
r = await req("POST", "/profile/me/onboarding/complete", { token: c.token });
check("complete onboarding is idempotent", r.status === 200 && await sql(`SELECT onboarding_completed_at FROM users WHERE id='${c.id}'`) === completedAt, r);
r = await req("GET", "/auth/me", { token: c.token });
check("/auth/me reflects onboardingCompleted", r.status === 200 && r.json.onboardingCompleted === true, r);

// ================= token_version / change-password =================
r = await login(a.email, PASSWORD);
check("login token has tv 0", r.status === 200 && tv(r.json.token) === 0 && Object.keys(r.json).sort().join() === "token,user", r);
const aLogin2 = r.json.token;
r = await req("GET", "/auth/me", { token: a.token });
check("GET /auth/me unchanged shape", r.status === 200 && Object.keys(r.json).sort().join() === "email,firstName,id,lastName,onboardingCompleted", r);

r = await req("POST", "/auth/change-password", { body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
check("change-password 401 unauthorized without token", r.status === 401 && r.json.error === "unauthorized", r);
r = await req("POST", "/auth/change-password", { token: "garbage", body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
check("change-password 401 invalid_token", r.status === 401 && r.json.error === "invalid_token", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: "Zle!Haslo123", newPassword: NEW_PASSWORD } });
check("change-password wrong current 401 invalid_credentials", r.status === 401 && r.json.error === "invalid_credentials", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: PASSWORD, newPassword: "Ab1" } });
check("change-password short 400 password_too_short", r.status === 400 && r.json.error === "password_too_short", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: PASSWORD, newPassword: "bezwielkich123" } });
check("change-password weak 400 password_too_weak", r.status === 400 && r.json.error === "password_too_weak", r);
r = await req("POST", "/auth/register", { body: { email: `weak.${stamp}@smoke.test`, password: "bezwielkich123", firstName: "W", lastName: "K" } });
check("register weak uses the same code (password_too_weak)", r.status === 400 && r.json.error === "password_too_weak", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: PASSWORD } });
check("change-password missing newPassword 400 missing_fields", r.status === 400 && r.json.error === "missing_fields", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { newPassword: NEW_PASSWORD } });
check("change-password missing currentPassword 400 missing_fields", r.status === 400 && r.json.error === "missing_fields", r);
r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: PASSWORD, newPassword: PASSWORD } });
check("change-password same 400 password_unchanged", r.status === 400 && r.json.error === "password_unchanged", r);
check("failed attempts did not bump version", await sql(`SELECT token_version FROM users WHERE id='${a.id}'`) === "0");

r = await req("POST", "/auth/change-password", { token: a.token, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
check("change-password 200 {token,user}", r.status === 200 && Object.keys(r.json).sort().join() === "token,user" && r.json.user.id === a.id && r.json.user.email === a.email && Object.keys(r.json.user).sort().join() === "email,firstName,id,lastName,onboardingCompleted", r);
const aChanged = r.json.token;
check("new token has tv 1", tv(aChanged) === 1);
check("DB token_version = 1", await sql(`SELECT token_version FROM users WHERE id='${a.id}'`) === "1");
r = await req("GET", "/auth/me", { token: a.token });
check("calling device's old token → token_revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("GET", "/profile/me", { token: aLogin2 });
check("other session → token_revoked (any endpoint)", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("GET", "/auth/me", { token: aChanged });
check("returned token works", r.status === 200 && r.json.id === a.id, r);
r = await login(a.email, PASSWORD);
check("login with old password 401", r.status === 401 && r.json.error === "invalid_credentials", r);
r = await login(a.email, NEW_PASSWORD);
check("login with new password 200, tv 1", r.status === 200 && tv(r.json.token) === 1, r);
const aLogin3 = r.json.token;

// ================= logout-all =================
r = await req("POST", "/auth/logout-all", { token: aChanged });
check("logout-all 200 {token,user}", r.status === 200 && Object.keys(r.json).sort().join() === "token,user" && r.json.user.id === a.id, r);
const aAfterLogoutAll = r.json.token;
check("logout-all token tv 2", tv(aAfterLogoutAll) === 2 && await sql(`SELECT token_version FROM users WHERE id='${a.id}'`) === "2");
r = await req("GET", "/auth/me", { token: aChanged });
check("logout-all: calling device's previous token revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("GET", "/feed", { token: aLogin3 });
check("logout-all: other device revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("GET", "/auth/me", { token: aAfterLogoutAll });
check("logout-all: returned token works", r.status === 200, r);
r = await req("POST", "/auth/logout-all", { token: aLogin3 });
check("logout-all with revoked token 401 token_revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("POST", "/auth/logout-all");
check("logout-all without token 401 unauthorized", r.status === 401 && r.json.error === "unauthorized", r);
check("password untouched by logout-all", (await login(a.email, NEW_PASSWORD)).status === 200);
const aTok = aAfterLogoutAll;

// ================= delete account: setup =================
let bTok = b.token;
r = await req("POST", "/profile/me/avatar", { token: bTok, form: pngForm("avatar", "b.png") });
check("B avatar upload", r.status === 200 && r.json.avatarUrl, r);
const bAvatar = r.json?.avatarUrl;
const mkExercise = async (name, withImage) => {
  let rr = await req("POST", "/exercises", { token: bTok, body: { name, muscles: ["chest"], category: "compound" } });
  check(`B creates exercise ${name}`, rr.status === 201 || rr.status === 200, rr);
  const id = rr.json.id;
  let imageUrl = null;
  if (withImage) {
    rr = await req("POST", `/exercises/${id}/image`, { token: bTok, form: pngForm("image", "ex.png") });
    check(`B uploads image for ${name}`, rr.status === 200 && rr.json.imageUrl, rr);
    imageUrl = rr.json.imageUrl;
  }
  return { id, imageUrl };
};
const EX1 = await mkExercise("B wyciskanie custom", true);
const EX2 = await mkExercise("B bez obrazka", false);
const EX3 = await mkExercise("B legacy shared", true);
check("B files on disk before delete", onDisk(bAvatar) && onDisk(EX1.imageUrl) && onDisk(EX3.imageUrl));

r = await req("POST", "/training-plans", { token: bTok, body: { name: "B plan", exercises: [{ exerciseId: EX1.id, sets: [{ reps: "5" }] }, { exerciseId: SYSTEM_EX, sets: [{ reps: "8" }] }] } });
check("B plan with own custom exercise (RESTRICT FK)", r.status === 201 || r.status === 200, r);
r = await req("POST", `/exercises/${SYSTEM_EX}/favourite`, { token: bTok });
check("B favourites system exercise", r.status === 200, r);
r = await req("POST", "/training-sessions", { token: bTok, body: sessionBody("B trening", [{ name: "B wyciskanie custom", exerciseId: EX1.id }]) });
check("B session referencing own exercise", r.status === 201, r);
const bSession = r.json?.id;
r = await req("POST", "/training-sessions", { token: aTok, body: sessionBody("A trening", [{ name: "Martwy ciąg" }]) });
check("A session", r.status === 201, r);
const aSession = r.json?.id;
r = await req("POST", "/training-sessions", { token: c.token, body: sessionBody("C trening", [{ name: "Legacy snapshot" }]) });
check("C session", r.status === 201, r);
const cSession = r.json?.id;
r = await req("POST", "/training-plans", { token: c.token, body: { name: "C plan", exercises: [{ exerciseId: SYSTEM_EX, sets: [{ reps: "5" }] }] } });
check("C plan", r.status === 201 || r.status === 200, r);
const cPlan = r.json?.id;

for (const [from, to] of [[aTok, b.id], [bTok, a.id], [c.token, b.id]]) {
  r = await req("POST", `/users/${to}/follow`, { token: from });
  check("follow setup", r.status === 200, r);
}
r = await req("POST", `/posts/${bSession}/kudos`, { token: aTok });
check("A kudos B post", r.status === 200, r);
r = await req("POST", `/posts/${bSession}/comments`, { token: aTok, body: { body: "Brawo B" } });
check("A comments B post", r.status === 201, r);
r = await req("POST", `/posts/${aSession}/kudos`, { token: bTok });
check("B kudos A post", r.status === 200 && r.json.kudosCount === 1, r);
r = await req("POST", `/posts/${aSession}/comments`, { token: bTok, body: { body: "Komentarz B" } });
check("B comments A post", r.status === 201, r);
r = await req("DELETE", `/training-sessions/by-client-id/${randomUUID()}`, { token: bTok });
check("B tombstone", r.status === 204, r);

// legacy data the API would not allow: C's plan references B's custom EX3, C's session references EX1
await sql(`INSERT INTO training_plan_exercises (plan_id, exercise_id, position) VALUES ('${cPlan}', '${EX3.id}', 1)`);
await sql(`UPDATE training_session_exercises SET exercise_id='${EX1.id}' WHERE session_id='${cSession}'`);
check("legacy references in place", await sql(`SELECT count(*) FROM training_plan_exercises WHERE plan_id='${cPlan}' AND exercise_id='${EX3.id}'`) === "1");

r = await login(b.email, PASSWORD);
const bOtherDevice = r.json.token;

// ================= delete account: errors =================
r = await req("DELETE", "/auth/me", { body: { password: PASSWORD } });
check("DELETE /auth/me 401 unauthorized", r.status === 401 && r.json.error === "unauthorized", r);
r = await req("DELETE", "/auth/me", { token: bTok, body: { password: "Zle!Haslo123" } });
check("DELETE /auth/me wrong password 401 invalid_credentials", r.status === 401 && r.json.error === "invalid_credentials", r);
r = await req("DELETE", "/auth/me", { token: bTok, body: {} });
check("DELETE /auth/me missing password 400 missing_fields", r.status === 400 && r.json.error === "missing_fields", r);
r = await req("DELETE", "/auth/me", { token: bTok });
check("DELETE /auth/me no body 400 missing_fields", r.status === 400 && r.json.error === "missing_fields", r);
check("B still exists after failed attempts", await sql(`SELECT count(*) FROM users WHERE id='${b.id}'`) === "1");

// ================= delete account: success =================
r = await req("DELETE", "/auth/me", { token: bTok, body: { password: PASSWORD } });
check("DELETE /auth/me 204 empty", r.status === 204 && r.text === "", r);
check("user row gone", await sql(`SELECT count(*) FROM users WHERE id='${b.id}'`) === "0");
r = await req("GET", "/auth/me", { token: bTok });
check("deleting device token → token_revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("GET", "/feed", { token: bOtherDevice });
check("other device token → token_revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await req("DELETE", "/auth/me", { token: bOtherDevice, body: { password: PASSWORD } });
check("second delete → token_revoked", r.status === 401 && r.json.error === "token_revoked", r);
r = await login(b.email, PASSWORD);
check("login after delete 401 invalid_credentials", r.status === 401 && r.json.error === "invalid_credentials", r);

const count = (q) => sql(`SELECT count(*) FROM ${q}`);
check("plans gone", await count(`training_plans WHERE user_id='${b.id}'`) === "0");
check("sessions gone", await count(`training_sessions WHERE user_id='${b.id}'`) === "0");
check("tombstones gone", await count(`training_session_tombstones WHERE user_id='${b.id}'`) === "0");
check("favourites gone", await count(`user_favourite_exercises WHERE user_id='${b.id}'`) === "0");
check("follows gone", await count(`user_follows WHERE follower_id='${b.id}' OR following_id='${b.id}'`) === "0");
check("kudos by/on B gone", await count(`session_kudos WHERE user_id='${b.id}' OR session_id='${bSession}'`) === "0");
check("comments by/on B gone", await count(`session_comments WHERE user_id='${b.id}' OR session_id='${bSession}'`) === "0");
check("custom exercises EX1, EX2 deleted", await count(`exercises WHERE id IN ('${EX1.id}','${EX2.id}')`) === "0");
check("no exercise left created_by B", await count(`exercises WHERE created_by='${b.id}'`) === "0");
check("EX3 (referenced by C's plan) kept with created_by NULL", await sql(`SELECT coalesce(created_by::text,'NULL') || ',' || is_system FROM exercises WHERE id='${EX3.id}'`) === "NULL,false");
check("C's plan intact incl. EX3 reference", await count(`training_plan_exercises WHERE plan_id='${cPlan}'`) === "2");
check("C's session exercise: exercise_id SET NULL, snapshot kept", await sql(`SELECT coalesce(exercise_id::text,'NULL') || ',' || exercise_name FROM training_session_exercises WHERE session_id='${cSession}'`) === "NULL,Legacy snapshot");
check("avatar file removed", !onDisk(bAvatar), bAvatar);
check("EX1 image removed", !onDisk(EX1.imageUrl), EX1.imageUrl);
check("EX3 image kept (exercise kept)", onDisk(EX3.imageUrl), EX3.imageUrl);

r = await req("GET", `/posts/${aSession}`, { token: aTok });
check("A's post: B's kudos & comment gone", r.status === 200 && r.json.kudosCount === 0 && r.json.commentCount === 0, r.json);
r = await req("GET", "/profile/me", { token: aTok });
check("A's follower/following counts drop", r.status === 200 && r.json.stats.followersCount === 0 && r.json.stats.followingCount === 0, r.json?.stats);
r = await req("GET", `/users/${b.id}/profile`, { token: aTok });
check("B profile 404", r.status === 404 && r.json.error === "user_not_found", r);
r = await req("GET", `/posts/${bSession}`, { token: aTok });
check("B post 404", r.status === 404, r);
r = await req("GET", `/training-plans`, { token: c.token });
const cPlanJson = Array.isArray(r.json) ? r.json.find((p) => p.id === cPlan) : null;
check("C's plans still load (EX3 visible via plan)", r.status === 200 && cPlanJson && cPlanJson.exercises.length === 2, r.json);

r = await req("POST", "/auth/register", { body: { email: b.email, password: PASSWORD, firstName: "Bogdan", lastName: "Nowy" } });
check("email can be registered again", r.status === 201 && r.json.user.id !== b.id && tv(r.json.token) === 0, r);

// ================= rate limits =================
let codes = [];
for (let i = 0; i < 121; i++) {
  // C has sent no kudos yet in this window (A has — its earlier kudos count towards the same 120/min).
  r = await req(i % 2 === 0 ? "POST" : "DELETE", `/posts/${aSession}/kudos`, { token: c.token });
  codes.push(r.status);
}
check("kudos: first 120 not limited", codes.slice(0, 120).every((s) => s === 200), [...new Set(codes.slice(0, 120))]);
check("kudos: 121st → 429 too_many_requests", codes[120] === 429 && r.json.error === "too_many_requests", r);
r = await req("GET", `/posts/${aSession}/kudos`, { token: c.token });
check("kudos GET list not limited", r.status === 200, r);

codes = [];
for (let i = 0; i < 10; i++) {
  r = await req("POST", "/auth/change-password", { token: c.token, body: { currentPassword: "Zle!Haslo123", newPassword: NEW_PASSWORD } });
  codes.push(r.status);
}
check("change-password: 10 failures are 401", codes.every((s) => s === 401), codes);
r = await req("POST", "/auth/change-password", { token: c.token, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
check("change-password: 11th → 429", r.status === 429 && r.json.error === "too_many_requests", r);
r = await req("POST", "/auth/change-password", { token: aTok, body: { currentPassword: NEW_PASSWORD, newPassword: NEW_PASSWORD } });
check("change-password limiter is per user (A not limited)", r.status === 400 && r.json.error === "password_unchanged", r);

codes = [];
for (let i = 0; i < 5; i++) {
  r = await req("DELETE", "/auth/me", { token: c.token, body: { password: "Zle!Haslo123" } });
  codes.push(r.status);
}
check("delete account: 5 wrong attempts 401", codes.every((s) => s === 401), codes);
r = await req("DELETE", "/auth/me", { token: c.token, body: { password: PASSWORD } });
check("delete account: 6th → 429 and nothing deleted", r.status === 429 && r.json.error === "too_many_requests" && await sql(`SELECT count(*) FROM users WHERE id='${c.id}'`) === "1", r);

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
