import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/demo";
import { createEmptyWorkspace, type Envelope, type WorkspaceData } from "../lib/domain";
import { buildRulePlan } from "../lib/planner";
import { WorkspaceService, ServiceError, emptyEnvelope, type WorkspaceRepository } from "../lib/workspace-service";

class MemoryRepository implements WorkspaceRepository {
  rows = new Map<string, Envelope>();
  async load(owner: string) { return structuredClone(this.rows.get(owner) ?? emptyEnvelope()); }
  async compareAndSwap(owner: string, revision: number, data: WorkspaceData) {
    const current = this.rows.get(owner) ?? emptyEnvelope();
    if (current.revision !== revision) return null;
    const next = { revision: revision + 1, data: structuredClone(data) };
    this.rows.set(owner, next); return structuredClone(next);
  }
}
const fixedNow = () => new Date("2026-10-15T00:00:00Z");
const expectStatus = (status: number) => (error: unknown) => error instanceof ServiceError && error.status === status;

test("workspace records are isolated by authenticated owner and reject absent identity", async () => {
  const repo = new MemoryRepository(); const service = new WorkspaceService(repo, fixedNow);
  const data = createEmptyWorkspace(); data.settings.weeklyBudgetCents = 5000;
  await service.save("alice", { expectedRevision: 0, data });
  assert.equal((await service.get("bob")).data.settings.weeklyBudgetCents, null);
  await assert.rejects(service.get(""), expectStatus(401));
  await assert.rejects(service.save("alice", { expectedRevision: 1, data, ownerId: "bob" }), expectStatus(422));
});
test("two device saves use atomic compare-and-swap; stale data cannot overwrite", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const a = createEmptyWorkspace(), b = createEmptyWorkspace();
  a.settings.weeklyBudgetCents = 100; b.settings.weeklyBudgetCents = 200;
  const results = await Promise.allSettled([service.save("alice", { expectedRevision: 0, data: a }), service.save("alice", { expectedRevision: 0, data: b })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(expectStatus(409)(rejected.reason));
  assert.equal((await service.get("alice")).revision, 1);
});
test("new plans cannot be injected through ordinary workspace save", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const data = createDemoWorkspace("2026-10-15");
  data.acceptedPlan = buildRulePlan({ data, revision: 0, now: fixedNow().toISOString() });
  await assert.rejects(service.save("alice", { expectedRevision: 0, data }), expectStatus(422));
});
test("plan adoption is validated, versioned, idempotent, and preserves confirmation facts", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const saved = await service.save("alice", { expectedRevision: 0, data: createDemoWorkspace("2026-10-15") });
  const plan = buildRulePlan({ data: saved.data, revision: saved.revision, now: fixedNow().toISOString() });
  assert.equal(plan.status, "feasible");
  const accepted = await service.accept("alice", { sourceRevision: saved.revision, plan });
  assert.equal(accepted.revision, 2);
  assert.deepEqual(accepted.data.events, saved.data.events);
  const repeated = await service.accept("alice", { sourceRevision: saved.revision, plan });
  assert.equal(repeated.revision, 2);
  const changed = { ...plan, id: "another-plan" };
  await assert.rejects(service.accept("alice", { sourceRevision: 1, plan: changed }), expectStatus(409));
});
test("server rejects forged time windows despite client feasible status", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const saved = await service.save("alice", { expectedRevision: 0, data: createDemoWorkspace("2026-10-15") });
  const plan = buildRulePlan({ data: saved.data, revision: saved.revision, now: fixedNow().toISOString() });
  assert.ok(plan.items.length > 0);
  const action = saved.data.actions.find((a) => a.id === plan.items[0].actionId)!;
  plan.items[0] = { ...plan.items[0], start: 1, end: 1 + action.durationMin };
  await assert.rejects(service.accept("alice", { sourceRevision: saved.revision, plan }), expectStatus(422));
});
test("missing inputs and unknown outcomes cannot be adopted as a successful plan", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const saved = await service.save("alice", { expectedRevision: 0, data: createEmptyWorkspace() });
  const plan = buildRulePlan({ data: saved.data, revision: saved.revision, now: fixedNow().toISOString() });
  await assert.rejects(service.accept("alice", { sourceRevision: saved.revision, plan }), expectStatus(422));
});

test("two different drafts compete atomically when adopted from the same revision", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const saved = await service.save("alice", { expectedRevision: 0, data: createDemoWorkspace("2026-10-15") });
  const first = buildRulePlan({ data: saved.data, revision: saved.revision, now: fixedNow().toISOString() });
  const second = { ...structuredClone(first), id: "plan-competing-draft" };
  const results = await Promise.allSettled([
    service.accept("alice", { sourceRevision: saved.revision, plan: first }),
    service.accept("alice", { sourceRevision: saved.revision, plan: second }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(expectStatus(409)(rejected.reason));
  const final = await service.get("alice");
  assert.equal(final.revision, saved.revision + 1);
  assert.ok([first.id, second.id].includes(final.data.acceptedPlan!.id));
});

test("adoption and an ordinary save cannot both commit against the same revision", async () => {
  const service = new WorkspaceService(new MemoryRepository(), fixedNow);
  const saved = await service.save("alice", { expectedRevision: 0, data: createDemoWorkspace("2026-10-15") });
  const plan = buildRulePlan({ data: saved.data, revision: saved.revision, now: fixedNow().toISOString() });
  const changed = structuredClone(saved.data);
  changed.days[0].note = "另一台设备尚未合并的日记修改";
  const results = await Promise.allSettled([
    service.accept("alice", { sourceRevision: saved.revision, plan }),
    service.save("alice", { expectedRevision: saved.revision, data: changed }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(expectStatus(409)(rejected.reason));
  const final = await service.get("alice");
  assert.equal(final.revision, saved.revision + 1);
  if (results[0].status === "fulfilled") {
    assert.equal(final.data.acceptedPlan!.id, plan.id);
    assert.equal(final.data.days[0].note, saved.data.days[0].note);
  } else {
    assert.equal(final.data.acceptedPlan, null);
    assert.equal(final.data.days[0].note, changed.days[0].note);
  }
});
