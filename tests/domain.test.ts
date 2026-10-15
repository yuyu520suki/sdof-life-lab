import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyWorkspace, DateSchema, EnvelopeSchema, TimeWindowSchema, WorkspaceDataSchema, type PlanResult } from "../lib/domain";
import { createDemoWorkspace } from "../lib/demo";
import { addDays, currentMinuteInShanghai, dateAtMinute, formatMinute, getDayWindows, getProtectedEvents, materializeDays, parseMinute, todayInShanghai, weekday, weekStart } from "../lib/time";

const startDate = "2026-10-15";

test("empty workspace contains no invented people, dates, or thresholds", () => {
  const data = createEmptyWorkspace();
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  assert.deepEqual(data.people, []);
  assert.deepEqual(data.days, []);
  assert.equal(data.settings.researchMinPerDay, null);
  assert.equal(data.settings.restMinPerDay, null);
  assert.equal(data.settings.weeklyBudgetCents, null);
  assert.deepEqual(data.settings.weeklyTemplate, []);
});

test("unknown availability overrides template; an absent entry uses template", () => {
  const data = createDemoWorkspace(startDate);
  data.days[0].availableWindows = null;
  data.days[0].energy = null;
  data.days[0].facts[0].contact = null;
  data.days[0].facts[0].myInterest = null;
  const validated = WorkspaceDataSchema.parse(data);
  assert.equal(getDayWindows(validated, startDate), null);
  assert.equal(materializeDays(validated, startDate, 1)[0].energy, null);
  assert.equal(validated.days[0].facts[0].contact, null);
  assert.equal(validated.days[0].facts[0].myInterest, null);
  data.days = [];
  assert.deepEqual(getDayWindows(data, startDate), [{ start: 480, end: 1380 }]);
  assert.equal(getDayWindows(createEmptyWorkspace(), startDate), null);
  data.days = [{ date: startDate, energy: null, availableWindows: [], facts: [], note: "" }];
  assert.deepEqual(getDayWindows(data, startDate), []);
});

test("real Gregorian dates, half-open minutes, and explicit midnight splitting", () => {
  assert.equal(DateSchema.safeParse("2024-02-29").success, true);
  for (const value of ["2025-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "0000-01-01"]) assert.equal(DateSchema.safeParse(value).success, false, value);
  assert.equal(TimeWindowSchema.safeParse({ start: 0, end: 1440 }).success, true);
  for (const value of [{ start: 1440, end: 1440 }, { start: 1380, end: 60 }, { start: 600.5, end: 660 }, { start: -1, end: 60 }]) assert.equal(TimeWindowSchema.safeParse(value).success, false);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(dateAtMinute(startDate, 1440), "2026-10-16T00:00:00");
  assert.equal(formatMinute(0), "00:00");
  assert.equal(formatMinute(1440), "24:00");
  assert.equal(parseMinute("24:00"), 1440);
  assert.equal(parseMinute("24:01"), null);
  assert.equal(parseMinute("08:30"), 510);
});

test("Shanghai dates and natural weeks ignore the process timezone", () => {
  const now = new Date("2026-10-18T16:00:30.000Z");
  assert.equal(todayInShanghai(now), "2026-10-19");
  assert.equal(currentMinuteInShanghai(now), 0.5);
  assert.equal(weekday("2026-10-18"), 7);
  assert.equal(weekStart("2026-10-18"), "2026-10-12");
  assert.equal(weekStart("2026-10-19"), "2026-10-19");
});

test("schemas reject unknown fields, duplicate IDs, missing references and non-finite money", () => {
  const invalids: unknown[] = [];
  const extra = createDemoWorkspace(startDate) as unknown as Record<string, unknown>; extra.unexpected = true; invalids.push(extra);
  const duplicatePerson = createDemoWorkspace(startDate); duplicatePerson.people.push({ ...duplicatePerson.people[0] }); invalids.push(duplicatePerson);
  const duplicateDate = createDemoWorkspace(startDate); duplicateDate.days.push({ ...duplicateDate.days[0] }); invalids.push(duplicateDate);
  const missingPerson = createDemoWorkspace(startDate); missingPerson.actions[0].personId = "missing"; invalids.push(missingPerson);
  const duplicateSourceId = createDemoWorkspace(startDate); duplicateSourceId.actions[0].id = duplicateSourceId.events[0].id; invalids.push(duplicateSourceId);
  const infiniteMoney = createDemoWorkspace(startDate); infiniteMoney.actions[0].costCents = Infinity; invalids.push(infiniteMoney);
  const fractionalMoney = createDemoWorkspace(startDate); fractionalMoney.actions[0].costCents = 0.5; invalids.push(fractionalMoney);
  const duplicateWeekday = createDemoWorkspace(startDate); duplicateWeekday.settings.weeklyTemplate[1].weekday = 1; invalids.push(duplicateWeekday);
  for (const data of invalids) assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
});

test("one actual expense per source replaces its estimate rather than adding another receipt", () => {
  const data = createDemoWorkspace(startDate);
  data.expenses = [{ id: "receipt", date: addDays(startDate, 2), cents: 2500, sourceId: "demo-confirmed", note: "实际费用替换预计 2000 分" }];
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  data.expenses.push({ ...data.expenses[0], id: "receipt-duplicate" });
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  data.expenses = [{ id: "receipt", date: startDate, cents: 2500, sourceId: "missing", note: "" }];
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  data.expenses[0].sourceId = null;
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
});

test("template IDs are reserved and explicit events override the original date even when moved", () => {
  const data = createDemoWorkspace(startDate);
  const original = getProtectedEvents(data, startDate)[0];
  assert.equal(original.id, `template-${startDate}-2`);
  const derived = getProtectedEvents(data, startDate).find((event) => event.id === `template-${startDate}-0`)!;
  data.events.push({ ...derived, date: addDays(startDate, 1), confirmation: "cancelled" });
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  assert.equal(getProtectedEvents(data, startDate).some((event) => event.id === derived.id), false);
  assert.equal(getProtectedEvents(data, addDays(startDate, 1)).find((event) => event.id === derived.id)?.confirmation, "cancelled");
  data.actions[0].id = `template-${startDate}-0`;
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  data.actions[0].id = "demo-reply";
  data.events[data.events.length - 1].id = `template-${startDate}-999`;
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
});

test("accepted plans reject invalid imports while allowing historical completed actions", () => {
  const data = createDemoWorkspace(startDate);
  const action = data.actions[0];
  const window = action.windows[0];
  const plan: PlanResult = {
    id: "plan-test", sourceRevision: 2, generatedAt: "2026-10-15T01:00:00.000Z", startDate,
    status: "feasible", engine: "rules", items: [{ actionId: action.id, date: window.date, start: window.start, end: window.start + action.durationMin }],
    issues: [], unselected: [], objective: null, solveMs: 0,
  };
  data.acceptedPlan = plan;
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  assert.equal(EnvelopeSchema.safeParse({ revision: 1, data }).success, false);
  assert.equal(EnvelopeSchema.safeParse({ revision: 2, data }).success, true);
  action.status = "done";
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  plan.items[0].end++;
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  plan.items[0].end--;
  plan.items[0].date = addDays(startDate, 7);
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  plan.items[0].date = window.date;
  plan.items.push({ ...plan.items[0] });
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
  plan.items.pop();
  plan.status = "unknown";
  assert.equal(WorkspaceDataSchema.safeParse(data).success, false);
});

test("demo contains seven feasible calendar days, separate fictional A-D and no accepted plan", () => {
  const data = createDemoWorkspace(startDate);
  assert.equal(WorkspaceDataSchema.safeParse(data).success, true);
  assert.equal(data.days.length, 7);
  assert.deepEqual(data.people.map((person) => person.id), ["A", "B", "C", "D"]);
  assert.equal(data.acceptedPlan, null);
  for (const day of materializeDays(data, startDate)) {
    const confirmed = day.events.filter((event) => event.confirmation === "confirmed");
    for (let i = 1; i < confirmed.length; i++) assert.ok(confirmed[i - 1].end <= confirmed[i].start);
    assert.ok(confirmed.filter((event) => event.kind === "research").reduce((sum, event) => sum + event.end - event.start, 0) >= data.settings.researchMinPerDay!);
    assert.ok(confirmed.filter((event) => event.kind === "rest").reduce((sum, event) => sum + event.end - event.start, 0) >= data.settings.restMinPerDay!);
  }
  assert.equal(getProtectedEvents(data, addDays(startDate, 3)).some((event) => event.confirmation === "pending"), true);
});
