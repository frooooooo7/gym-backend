// Smoke test: follows, profiles, profile edit, avatar upload (real server + Postgres).
// Standalone: BASE=http://localhost:3101 [API_PREFIX=/api/v1] node scripts/smoke/social.mjs
// Needs a fresh server (in-memory rate limiters) — see run-all.mjs.
import { apiPath, BASE } from "./lib.mjs";
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
};
const req = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
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
    body: { email: `${first.toLowerCase()}${stamp}@smoke.test`, password: "Sup3rTajne!haslo", firstName: first, lastName: last },
  });
  check(`register ${first}`, r.status === 201 || r.status === 200, r);
  return { token: r.json.token, id: r.json.user.id };
};

const a = await register("Anna", "Nowak");
const b = await register("Bartek", "Wiśniewski");

let r = await req("POST", `/users/${b.id}/follow`, { token: a.token });
check("follow 200", r.status === 200 && r.json.isFollowing === true && r.json.followersCount === 1, r);
r = await req("POST", `/users/${b.id}/follow`, { token: a.token });
check("follow idempotent", r.status === 200 && r.json.followersCount === 1, r);
r = await req("POST", `/users/${a.id}/follow`, { token: a.token });
check("follow self 400", r.status === 400 && r.json.error === "cannot_follow_self", r);
r = await req("POST", `/users/00000000-0000-4000-8000-000000000000/follow`, { token: a.token });
check("follow unknown 404", r.status === 404 && r.json.error === "user_not_found", r);

r = await req("GET", `/users/${b.id}/profile`, { token: a.token });
check("A views B: isFollowing", r.status === 200 && r.json.isFollowing === true && r.json.isFollowedBy === false && r.json.stats.followersCount === 1, r);
r = await req("GET", `/users/${a.id}/profile`, { token: b.token });
check("B views A: isFollowedBy", r.status === 200 && r.json.isFollowing === false && r.json.isFollowedBy === true, r);
r = await req("GET", `/profile/me`, { token: a.token });
check("own profile flags false", r.status === 200 && r.json.isFollowing === false && r.json.isFollowedBy === false && r.json.stats.followingCount === 1, r);

r = await req("GET", `/profile/following`, { token: a.token });
check("A following list", r.status === 200 && r.json.length === 1 && r.json[0].id === b.id && r.json[0].isFollowing === true, r);
r = await req("GET", `/profile/followers`, { token: b.token });
check("B followers list (B doesn't follow A)", r.status === 200 && r.json.length === 1 && r.json[0].isFollowing === false, r);
r = await req("GET", `/users/${b.id}/followers`, { token: a.token });
check("users/:id/followers", r.status === 200 && r.json.length === 1 && r.json[0].id === a.id, r);
r = await req("GET", `/users/${a.id}/following?limit=5&offset=0`, { token: b.token });
check("users/:id/following", r.status === 200 && r.json.length === 1 && r.json[0].isFollowing === false, r);
r = await req("GET", `/users/search?q=wiśniew`, { token: a.token });
check("search with isFollowing", r.status === 200 && r.json.some((u) => u.id === b.id && u.isFollowing === true), r);

r = await req("PATCH", `/profile/me`, { token: a.token, body: { firstName: "  Ania ", lastName: "Kowalska" } });
check("patch names", r.status === 200 && r.json.firstName === "Ania" && r.json.lastName === "Kowalska", r);
r = await req("PATCH", `/profile/me`, { token: a.token, body: { bio: "Siłownia 4x w tygodniu" } });
check("patch bio only", r.status === 200 && r.json.bio === "Siłownia 4x w tygodniu" && r.json.firstName === "Ania", r);
r = await req("PATCH", `/profile/me`, { token: a.token, body: {} });
check("patch empty 400", r.status === 400 && r.json.error === "no_fields_to_update", r);
r = await req("PATCH", `/profile/me`, { token: a.token, body: { firstName: "   " } });
check("patch invalid first name", r.status === 400 && r.json.error === "invalid_first_name", r);
r = await req("GET", `/auth/me`, { token: a.token });
check("auth/me reflects name", r.status === 200 && r.json.firstName === "Ania", r);

// 1x1 PNG
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const form = new FormData();
form.append("avatar", new Blob([png], { type: "image/png" }), "me.png");
r = await req("POST", `/profile/me/avatar`, { token: a.token, form });
check("avatar upload", r.status === 200 && /^\/uploads\/avatars\/[0-9a-f-]+\.png$/.test(r.json.avatarUrl ?? ""), r);
const url1 = r.json?.avatarUrl;
if (url1) {
  const img = await fetch(BASE + url1);
  check("avatar served", img.status === 200, img.status);
}
const form2 = new FormData();
form2.append("avatar", new Blob([png], { type: "application/octet-stream" }), "me2.png");
r = await req("POST", `/profile/me/avatar`, { token: a.token, form: form2 });
check("avatar replace (octet-stream)", r.status === 200 && r.json.avatarUrl && r.json.avatarUrl !== url1, r);
if (url1) {
  const old = await fetch(BASE + url1);
  check("old avatar deleted", old.status === 404, old.status);
}
r = await req("POST", `/profile/me/avatar`, { token: a.token, form: new FormData() });
check("avatar missing file", r.status === 400 && r.json.error === "missing_image", r);
r = await req("DELETE", `/profile/me/avatar`, { token: a.token });
check("avatar delete", r.status === 200 && r.json.avatarUrl === null, r);

r = await req("DELETE", `/users/${b.id}/follow`, { token: a.token });
check("unfollow", r.status === 200 && r.json.isFollowing === false && r.json.followersCount === 0, r);
r = await req("DELETE", `/users/${b.id}/follow`, { token: a.token });
check("unfollow idempotent", r.status === 200 && r.json.followersCount === 0, r);

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
