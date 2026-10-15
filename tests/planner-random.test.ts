import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyWorkspace, WorkspaceDataSchema, type DayTemplate } from "../lib/domain";
import { solveWithHighs } from "../lib/highs-solver";
import { validatePlan, type PlannerInput } from "../lib/planner";

test("30 seeded cross-week MILPs match independent exhaustive integer scheduling", async () => {
  let seed = 7;
  const random = (maximum: number) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed % maximum;
  };
  // Sunday/Monday deliberately exercise separate natural-week allowances.
  const dates = ["2026-10-18", "2026-10-19"];
  for (let run = 0; run < 30; run++) {
    const data = createEmptyWorkspace();
    const allowance = 3 + random(6);
    data.settings = {
      timezone: "Asia/Shanghai", researchMinPerDay: 0, restMinPerDay: 0, weeklyBudgetCents: allowance,
      weeklyTemplate: Array.from({ length: 7 }, (_, index): DayTemplate => ({ weekday: (index + 1) as DayTemplate["weekday"], windows: [{ start: 0, end: 1440 }], blocks: [] })),
    };
    data.actions = Array.from({ length: 5 }, (_, index) => ({
      id: `a${index}`, personId: null, title: `a${index}`, kind: "other", durationMin: 1 + random(3),
      costCents: random(5), priority: (1 + random(3)) as 1 | 2 | 3,
      windows: Array.from({ length: 1 + random(2) }, () => {
        const start = 600 + random(4);
        return { date: dates[random(2)], start, end: start + 3 };
      }), status: "open",
    }));
    const input: PlannerInput = { data: WorkspaceDataSchema.parse(data), revision: 0, now: "2026-10-18T00:00:00.000Z" };
    // Enumerate omission or every integer-minute placement directly from raw
    // requests. Do not use planner preprocessing, window helpers or MILP rows.
    let optimum = 0;
    const placements: { date: string; start: number; end: number }[] = [];
    const spent: Record<string, number> = {};
    function enumerate(index: number, value: number) {
      if (index === data.actions.length) { optimum = Math.max(optimum, value); return; }
      const action = data.actions[index];
      enumerate(index + 1, value);
      for (const window of action.windows) {
        for (let start = window.start; start + action.durationMin <= window.end; start++) {
          const end = start + action.durationMin;
          // Each of the two selected dates belongs to a different week.
          const week = window.date;
          if ((spent[week] ?? 0) + action.costCents > allowance) continue;
          if (placements.some((item) => item.date === window.date && item.start < end && start < item.end)) continue;
          placements.push({ date: window.date, start, end });
          spent[week] = (spent[week] ?? 0) + action.costCents;
          enumerate(index + 1, value + action.priority * action.durationMin);
          spent[week] -= action.costCents;
          placements.pop();
        }
      }
    }
    enumerate(0, 0);
    const result = await solveWithHighs(input);
    const context = JSON.stringify({ run, actions: data.actions, allowance, issues: result.issues });
    assert.equal(result.engine, "highs", context);
    assert.equal(result.status, "optimal", context);
    assert.equal(result.objective, optimum, context);
    assert.deepEqual(validatePlan(input, result), [], context);
  }
});
