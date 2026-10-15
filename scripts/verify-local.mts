/** End-to-end API check against a disposable LOOPBACK development database only. */
import assert from "node:assert/strict";
import { createEmptyWorkspace, EnvelopeSchema } from "../lib/domain";
import { createDemoWorkspace } from "../lib/demo";
import { buildRulePlan } from "../lib/planner";
import { todayInShanghai } from "../lib/time";

const origin = process.argv[2] ?? "http://127.0.0.1:5173";
const parsed = new URL(origin);
assert.equal(parsed.protocol, "http:");
assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname), "This destructive integration check only runs against local development");
let cookie = "";
async function request(path: string, method = "GET", body?: unknown) {
  return fetch(new URL(path, origin), { method, redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
assert.equal((await request("/api/workspace")).status, 401);
const signedIn = await request("/signin-with-chatgpt?return_to=/");
assert.equal(signedIn.status, 302);
cookie = signedIn.headers.getSetCookie().map((line) => line.split(";", 1)[0]).join("; ");
assert.ok(cookie, "Local mock sign-in must set a cookie");
let state = EnvelopeSchema.parse(await (await request("/api/workspace")).json());
assert.equal(state.data.people.length, 0, "Use an empty disposable local database; do not overwrite personal records");
assert.equal(state.data.events.length, 0);
assert.equal(state.data.actions.length, 0);
assert.equal(state.data.expenses.length, 0);
assert.equal(state.data.days.length, 0);
const initial = structuredClone(state.data);
try {
  const save = await request("/api/workspace", "PUT", { expectedRevision: state.revision, data: createDemoWorkspace(todayInShanghai()) });
  assert.equal(save.status, 200, await save.clone().text());
  state = EnvelopeSchema.parse(await save.json());
  const plan = buildRulePlan({ data: state.data, revision: state.revision, now: new Date().toISOString() });
  assert.equal(plan.status, "feasible");
  const adopted = await request("/api/plans/accept", "POST", { sourceRevision: state.revision, plan });
  assert.equal(adopted.status, 200, await adopted.clone().text());
  state = EnvelopeSchema.parse(await adopted.json());
  const repeated = await request("/api/plans/accept", "POST", { sourceRevision: plan.sourceRevision, plan });
  assert.equal(repeated.status, 200);
  assert.equal(EnvelopeSchema.parse(await repeated.json()).revision, state.revision);
  const reread = EnvelopeSchema.parse(await (await request("/api/workspace")).json());
  assert.deepEqual(reread, state);
  const stale = await request("/api/workspace", "PUT", { expectedRevision: plan.sourceRevision, data: state.data });
  assert.equal(stale.status, 409);
  console.log("PASS: anonymous 401, D1 save/read, real plan adoption, duplicate adoption, stale write 409.");
} finally {
  state = EnvelopeSchema.parse(await (await request("/api/workspace")).json());
  const reset = await request("/api/workspace", "PUT", { expectedRevision: state.revision, data: { ...initial, acceptedPlan: null } });
  assert.equal(reset.status, 200, "Restore of disposable local workspace failed");
  console.log("Disposable local workspace restored; production database untouched.");
}
