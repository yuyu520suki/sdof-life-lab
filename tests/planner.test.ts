import assert from "node:assert/strict";
import test from "node:test";
import loadHighs from "highs";
import { createEmptyWorkspace, type ActionRequest, type DayTemplate, type ProtectedEvent, WorkspaceDataSchema } from "../lib/domain";
import { buildRulePlan, committedWeekCost, preparePlannerInput, validatePlan, type PlannerInput } from "../lib/planner";
import { interpretHighsOutcome, solveWithHighs } from "../lib/highs-solver";

function fixture(): PlannerInput {
  const data = createEmptyWorkspace();
  data.settings = {
    timezone: "Asia/Shanghai", researchMinPerDay: 60, restMinPerDay: 30, weeklyBudgetCents: 10_000,
    weeklyTemplate: Array.from({ length: 7 }, (_, index): DayTemplate => ({
      weekday: (index + 1) as DayTemplate["weekday"], windows: [{ start: 9 * 60, end: 17 * 60 }], blocks: [
        { title: "Research", kind: "research", start: 9 * 60, end: 10 * 60 },
        { title: "Rest", kind: "rest", start: 12 * 60, end: 12 * 60 + 30 },
        { title: "Sleep", kind: "sleep", start: 0, end: 8 * 60 },
      ],
    })),
  };
  data.people = [{ id: "A", name: "A", status: "active", note: "" }, { id: "B", name: "B", status: "paused", note: "" }];
  return { data, revision: 1, now: "2026-10-15T00:00:00.000Z" };
}

function action(id: string, patch: Partial<ActionRequest> = {}): ActionRequest {
  return { id, personId: "A", title: id, kind: "reply", durationMin: 20, costCents: 0, priority: 2, windows: [{ date: "2026-10-16", start: 14 * 60, end: 15 * 60 }], status: "open", ...patch };
}
function event(id: string, patch: Partial<ProtectedEvent> = {}): ProtectedEvent {
  return { id, date: "2026-10-16", title: id, kind: "meeting", start: 14 * 60, end: 15 * 60, personId: "A", confirmation: "confirmed", costCents: 0, ...patch };
}

test("rule baseline protects confirmed blocks, ignores pending blocks, and paused contacts remain paused", () => {
  const input = fixture();
  input.data.events = [event("confirmed"), event("pending", { confirmation: "pending", start: 15 * 60, end: 16 * 60 })];
  input.data.actions = [action("locked"), action("pending-slot", { windows: [{ date: "2026-10-16", start: 15 * 60, end: 16 * 60 }] }), action("paused", { personId: "B" })];
  const result = buildRulePlan(input);
  assert.equal(result.status, "feasible");
  assert.deepEqual(result.items.map((item) => item.actionId), ["pending-slot"]);
  assert.match(result.unselected.find((item) => item.actionId === "paused")!.reason, /暂停/);
  assert.deepEqual(validatePlan(input, result), []);
});

test("unknown availability and missing protected research produce needs_input with only valid known-day drafts", () => {
  const input = fixture();
  input.data.days = [{ date: "2026-10-16", energy: null, availableWindows: null, facts: [], note: "" }];
  input.data.actions = [action("unknown"), action("known", { windows: [{ date: "2026-10-17", start: 14 * 60, end: 15 * 60 }] })];
  let result = buildRulePlan(input);
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.items.map((item) => item.actionId), ["known"]);
  assert(validatePlan(input, result).some((issue) => issue.code === "unknown_availability"));
  input.data.settings.researchMinPerDay = 61;
  result = buildRulePlan(input);
  assert.equal(result.status, "needs_input");
  assert.equal(result.items.length, 0);
  assert(result.issues.some((issue) => issue.code === "research_below_min"));
});

test("fixed overlapping confirmed events are infeasible even when no optional action is requested", () => {
  const input = fixture();
  input.data.events = [event("a"), event("b", { start: 14 * 60 + 30, end: 16 * 60 })];
  const result = buildRulePlan(input);
  assert.equal(result.status, "infeasible");
  assert(result.issues.some((issue) => issue.code === "confirmed_overlap"));
  assert.equal(result.items.length, 0);
});

test("natural-week budget includes actual costs and future confirmed costs beyond seven-day horizon", async () => {
  const input = fixture();
  input.data.expenses = [{ id: "past-cost", date: "2026-10-12", cents: 8000, sourceId: null, note: "" }];
  input.data.events = [event("outside-horizon", { date: "2026-10-25", costCents: 6000 })];
  input.data.actions = [action("current-too-expensive", { costCents: 3000 }), action("current-exact", { costCents: 2000 }), action("next-too-expensive", { costCents: 5000, windows: [{ date: "2026-10-19", start: 14 * 60, end: 15 * 60 }] })];
  assert.equal(committedWeekCost(input.data, "2026-10-12", input.now), 8000);
  assert.equal(committedWeekCost(input.data, "2026-10-19", input.now), 6000);
  const result = await solveWithHighs(input);
  assert.equal(result.engine, "highs", JSON.stringify(result.issues));
  assert.deepEqual(result.items.map((item) => item.actionId), ["current-exact"]);
  assert.deepEqual(validatePlan(input, result), []);
});

test("sourceId actual expense replaces estimate, including prepaid actions; accepted-plan estimates do not accumulate", async () => {
  const input = fixture();
  input.data.events = [event("paid-event", { costCents: 9000 })];
  input.data.expenses = [{ id: "actual", date: "2026-10-15", cents: 1000, sourceId: "paid-event", note: "" }];
  input.data.actions = [action("future", { costCents: 8000, windows: [{ date: "2026-10-17", start: 14 * 60, end: 15 * 60 }] })];
  input.data.acceptedPlan = buildRulePlan(input);
  input.revision++;
  const result = await solveWithHighs(input);
  assert.equal(result.items.length, 1);
  assert.deepEqual(validatePlan(input, result), []);
  input.data.expenses.push({ id: "action-paid", date: "2026-10-15", cents: 8000, sourceId: "future", note: "" });
  assert.equal(preparePlannerInput(input).actions[0].costCents, 0);
});

test("a past confirmed event keeps its estimate reserved until actual costs are recorded", async () => {
  const input = fixture();
  input.data.settings.weeklyBudgetCents = 5000;
  input.data.events = [event("past-unsettled", { date: "2026-10-14", costCents: 5000 })];
  input.data.actions = [action("new-cost", { costCents: 5000 })];
  assert.equal(committedWeekCost(input.data, "2026-10-12", input.now), 5000);
  let result = await solveWithHighs(input);
  assert.equal(result.items.length, 0);
  input.data.expenses = [{ id: "actual-cheaper", date: "2026-10-14", cents: 0, sourceId: "past-unsettled", note: "" }];
  result = await solveWithHighs(input);
  assert.equal(result.items.length, 1);
});

test("all optional actions may remain unselected; no optional actions yields a valid empty plan", async () => {
  const input = fixture();
  let result = await solveWithHighs(input);
  assert.equal(result.status, "optimal"); assert.deepEqual(result.items, []); assert.deepEqual(validatePlan(input, result), []);
  input.data.actions = [action("too-costly", { costCents: 10_001 }), action("done", { status: "done" }), action("cancelled", { status: "cancelled" })];
  result = await solveWithHighs(input);
  assert.equal(result.status, "optimal"); assert.equal(result.items.length, 0); assert.equal(result.objective, 0);
});

test("integer-minute MILP preserves non-quarter-hour windows and half-open adjacent intervals", async () => {
  const input = fixture();
  input.data.actions = [action("first", { durationMin: 15, windows: [{ date: "2026-10-16", start: 787, end: 802 }] }), action("second", { durationMin: 17, windows: [{ date: "2026-10-16", start: 802, end: 819 }] })];
  const result = await solveWithHighs(input);
  assert.equal(result.engine, "highs", JSON.stringify(result.issues));
  assert.deepEqual(result.items.map((item) => [item.start, item.end]), [[787, 802], [802, 819]]);
  assert.deepEqual(validatePlan(input, result), []);
});

test("earliest start is ceil(current minute)+5 and validator rejects stale/past or overlapping edits", () => {
  const input = fixture();
  input.now = "2026-10-15T02:10:30.000Z";
  input.data.actions = [action("a", { windows: [{ date: "2026-10-15", start: 610, end: 700 }] }), action("b", { windows: [{ date: "2026-10-15", start: 610, end: 700 }] })];
  const result = buildRulePlan(input);
  assert(result.items.every((item) => item.start >= 616));
  assert.deepEqual(validatePlan({ ...input, now: "2026-10-15T02:12:30.000Z" }, result), []);
  assert(validatePlan({ ...input, now: "2026-10-15T02:16:30.000Z" }, result).some((issue) => issue.code === "past_start"));
  result.items[0].start = 610; result.items[0].end = 630;
  result.items[1].start = 620; result.items[1].end = 640;
  const issues = validatePlan(input, result);
  assert(issues.some((issue) => issue.code === "past_start"));
  assert(issues.some((issue) => issue.code === "action_overlap"));
  assert(validatePlan({ ...input, revision: 2 }, result).some((issue) => issue.code === "stale_revision"));
});

test("limited/unknown solver outcomes never mean infeasible and an incumbent remains usable", () => {
  for (const status of [13, 14, 15, 16, 17]) {
    assert.equal(interpretHighsOutcome(status, false), "no_incumbent");
    assert.equal(interpretHighsOutcome(status, true), "feasible");
  }
  assert.equal(interpretHighsOutcome(7, true), "optimal");
  assert.equal(interpretHighsOutcome(8, false), "inconsistent");
});

test("real WASM distinguishes a limit without a solution from an early-stop feasible incumbent", async () => {
  const highs = await loadHighs();
  const names = Array.from({ length: 45 }, (_, index) => `x${index}`);
  const expression = (coefficient: (index: number) => number) => names.map((name, index) => `${coefficient(index)} ${name}`).join(" + ");
  const text = `Maximize\nobj: ${expression((i) => (i * 37) % 89 + 10)}\nSubject To\na: ${expression((i) => (i * 19) % 53 + 5)} <= 430\nb: ${expression((i) => (i * 31) % 47 + 3)} <= 400\nBinary\n${names.join(" ")}\nEnd`;
  highs.withModel({ format: "lp", data: text }, (model) => {
    model.options.set({ output_flag: false, time_limit: 0 });
    model.run();
    assert.equal(model.getModelStatus(), highs.constants.modelStatus.timeLimit);
    assert.notEqual(model.info.get("primal_solution_status"), highs.constants.solutionStatus.feasible);
    assert.equal(interpretHighsOutcome(model.getModelStatus(), false), "no_incumbent");
  });
  highs.withModel({ format: "lp", data: text }, (model) => {
    model.options.set({ output_flag: false, presolve: "off", time_limit: 1, mip_max_improving_sols: 1 });
    model.run();
    assert.equal(model.getModelStatus(), highs.constants.modelStatus.solutionLimit);
    assert.equal(model.info.get("primal_solution_status"), highs.constants.solutionStatus.feasible);
    assert.equal(interpretHighsOutcome(model.getModelStatus(), true), "feasible");
    assert.equal(model.getSolution().colValue.length, names.length);
  });
});

test("tiny MILP agrees with exhaustive subset enumeration under joint time and money limits", async () => {
  const input = fixture();
  input.data.settings.weeklyBudgetCents = 800;
  const lengths = [30, 20, 40, 15, 10]; const priorities = [3, 2, 1, 3, 2] as const; const costs = [600, 500, 0, 400, 200];
  input.data.actions = lengths.map((durationMin, index) => action(`task-${index}`, { durationMin, priority: priorities[index], costCents: costs[index], windows: [{ date: "2026-10-16", start: 13 * 60, end: 14 * 60 }] }));
  WorkspaceDataSchema.parse(input.data);
  let best = 0;
  for (let mask = 0; mask < 1 << lengths.length; mask++) {
    let duration = 0; let cost = 0; let objective = 0;
    for (let i = 0; i < lengths.length; i++) if (mask & (1 << i)) { duration += lengths[i]; cost += costs[i]; objective += lengths[i] * priorities[i]; }
    if (duration <= 60 && cost <= 800) best = Math.max(best, objective);
  }
  const result = await solveWithHighs(input);
  assert.equal(result.engine, "highs", JSON.stringify(result.issues));
  assert.equal(result.status, "optimal"); assert.equal(result.objective, best);
  assert.deepEqual(validatePlan(input, result), []);
});

test("equally valuable plans retain an accepted exact time as a secondary objective", async () => {
  const input = fixture();
  input.data.actions = [action("stable")];
  input.data.acceptedPlan = buildRulePlan(input);
  input.data.acceptedPlan.items[0] = { actionId: "stable", date: "2026-10-16", start: 14 * 60 + 25, end: 14 * 60 + 45 };
  const result = await solveWithHighs(input);
  assert.deepEqual(result.items, input.data.acceptedPlan.items);
  assert.deepEqual(validatePlan(input, result), []);
});
