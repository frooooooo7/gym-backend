// Smoke test: notification center — kudos, followers, plan copies and records (real server + Postgres).
// Standalone: BASE=http://localhost:3101 API_PREFIX=/api/v1 node scripts/smoke/notifications.mjs
// The notification routes exist only under /api/v1; with the legacy prefix the script skips.
import { API_PREFIX, apiPath, BASE } from "./lib.mjs";
import { randomUUID } from "node:crypto";

if (API_PREFIX !== "/api/v1") {
  console.log("skip notifications (only under /api/v1)");
  process.exit(0);
}

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
    body: { email: `${first.toLowerCase()}.nt.${stamp}@smoke.test`, password: "Sup3rTajne!haslo", firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 || r.status === 200, r);
  return { token: r.json.token, id: r.json.user.id };
};
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const DEADLIFT = "a1000000-0000-0000-0000-000000000005";
const session = async (user, label, startedAt, weight) => {
  const r = await req("POST", "/training-sessions", {
    token: user.token,
    body: {
      clientId: randomUUID(),
      planName: label,
      status: "completed",
      startedAt,
      finishedAt: new Date(Date.parse(startedAt) + 50 * 60_000).toISOString(),
      exercises: [{
        exerciseId: DEADLIFT,
        exerciseName: "Martwy ciąg",
        exerciseMuscles: ["back"],
        exerciseCategory: "compound",
        position: 0,
        sets: [{ position: 0, plannedWeight: weight, plannedReps: "3", actualWeight: weight, actualReps: "3", completed: true }],
      }],
    },
  });
  check(`create session ${label}`, r.status === 201, r);
  const p = await req("PATCH", `/training-sessions/${r.json.id}/shared-to-profile`, { token: user.token, body: { sharedToProfile: true } });
  check(`share ${label}`, p.status === 200, p);
  return r.json.id;
};

const me = await register("Damian", "Powiadomienia");
const anna = await register("Anna", "Kudosowa");
const ola = await register("Ola", "Kopiująca");

let r = await req("GET", "/notifications", { token: me.token });
check("empty at first", r.status === 200 && r.json.items.length === 0 && r.json.unreadCount === 0, r);
r = await req("GET", "/notifications/settings", { token: me.token });
check("default settings", r.status === 200 && r.json.kudos === true && r.json.quietHours.enabled === false, r);

const push = await session(me, "Push", hoursAgo(2), "100");
await req("POST", `/posts/${push}/kudos`, { token: anna.token });
await req("POST", `/posts/${push}/kudos`, { token: ola.token });
await req("POST", `/posts/${push}/kudos`, { token: me.token }); // own kudo is not a notification
await req("POST", `/users/${me.id}/follow`, { token: ola.token });

const plan = await req("POST", "/training-plans", {
  token: me.token,
  body: { clientId: randomUUID(), name: "Góra A", selectedDays: [1], isPublic: true, exercises: [{ exerciseId: DEADLIFT, sets: [{ weight: "100", reps: "5" }] }] },
});
check("public plan", plan.status === 201, plan);
r = await req("POST", `/training-plans/${plan.json.id}/copy`, { token: ola.token, body: { clientId: randomUUID() } });
check("Ola copies the plan", r.status === 201, r);

// A record by someone I follow: a heavier deadlift than her earlier session.
await req("POST", `/users/${anna.id}/follow`, { token: me.token });
await session(anna, "Legs stary", hoursAgo(30), "100");
const legs = await session(anna, "Legs", hoursAgo(1), "120");

r = await req("GET", "/notifications", { token: me.token });
const byType = Object.fromEntries((r.json?.items ?? []).map((i) => [i.type, i]));
check("four kinds listed", r.status === 200 && r.json.items.length === 4, r.json?.items?.map((i) => i.id));
check("kudos grouped per workout", byType.kudos?.id === `kudos:${push}` && byType.kudos.actorCount === 2 && byType.kudos.session.title === "Push", byType.kudos);
check("new follower, not followed back", byType.follow?.actors[0].id === ola.id && byType.follow.isFollowing === false, byType.follow);
check("plan copy names the plan", byType.plan_copy?.plan?.name === "Góra A" && byType.plan_copy.actors[0].id === ola.id, byType.plan_copy);
check("record of a followed person", byType.record?.id === `record:${legs}` && byType.record.record.exerciseName === "Martwy ciąg" && byType.record.record.weightKg === 120, byType.record);
check("all unread", r.json.unreadCount === 4 && r.json.items.every((i) => !i.read), r.json);
r = await req("GET", "/notifications/unread-count", { token: me.token });
check("unread count", r.status === 200 && r.json.count === 4, r);

r = await req("POST", `/notifications/${encodeURIComponent(`kudos:${push}`)}/read`, { token: me.token });
check("mark one read", r.status === 204, r);
r = await req("DELETE", `/notifications/${encodeURIComponent(`follow:${ola.id}`)}`, { token: me.token });
check("dismiss one", r.status === 204, r);
r = await req("GET", "/notifications", { token: me.token });
check("dismissed hidden, read flagged", r.json.items.length === 3 && r.json.items.find((i) => i.type === "kudos").read === true && r.json.unreadCount === 2, r.json);

r = await req("POST", "/notifications/read-all", { token: me.token });
check("read all", r.status === 204, r);
r = await req("GET", "/notifications/unread-count", { token: me.token });
check("nothing unread", r.json.count === 0, r);

// New activity on a read item makes it unread again.
const kuba = await register("Kuba", "Spóźniony");
await req("POST", `/posts/${push}/kudos`, { token: kuba.token });
r = await req("GET", "/notifications", { token: me.token });
const kudos = r.json.items.find((i) => i.type === "kudos");
check("new kudo reopens the item", kudos?.read === false && kudos.actorCount === 3 && kudos.actors[0].id === kuba.id && r.json.unreadCount === 1, r.json);

r = await req("PATCH", "/notifications/settings", { token: me.token, body: { kudos: false, quietHours: { enabled: true, from: "23:00" } } });
check("update settings", r.status === 200 && r.json.kudos === false && r.json.quietHours.from === "23:00" && r.json.quietHours.to === "07:00", r);
r = await req("GET", "/notifications", { token: me.token });
check("switched-off kind hidden", r.json.items.every((i) => i.type !== "kudos"), r.json.items.map((i) => i.type));
r = await req("PATCH", "/notifications/settings", { token: me.token, body: { quietHours: { from: "7:00" } } });
check("bad time rejected", r.status === 400, r);
r = await req("DELETE", "/notifications/comment:abc", { token: me.token });
check("bad id rejected", r.status === 400, r);
r = await req("GET", "/notifications");
check("auth required", r.status === 401, r);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nnotifications smoke: all checks passed");
