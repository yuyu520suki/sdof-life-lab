import loadHighs, { type ModelData } from "highs";
import type { Issue, PlanItem, PlanResult } from "./domain";
import { actionValue, buildRulePlan, finishPlan, preparePlannerInput, validatePlan, type PlannerInput, type PreparedPlanning } from "./planner";
import { weekStart } from "./time";

const HORIZON = 7 * 1440;
const MAX_SOLVER_ACTIONS = 60;
const MAX_CANDIDATE_WINDOWS = 1500;
type HighsRuntime = Awaited<ReturnType<typeof loadHighs>>;
let runtimePromise: Promise<HighsRuntime> | undefined;

function runtime(): Promise<HighsRuntime> {
  runtimePromise ??= loadHighs(typeof window === "undefined" && typeof location === "undefined" ? {} : {
    locateFile: () => new URL("/solver-assets/highs.wasm", globalThis.location.href).href,
  });
  return runtimePromise;
}

type Column = { cost: number; lower: number; upper: number };
class SparseMilp {
  columns: Column[] = [];
  rows: { lower: number; upper: number; entries: [number, number][] }[] = [];
  column(cost = 0, lower = 0, upper = 1): number {
    this.columns.push({ cost, lower, upper });
    return this.columns.length - 1;
  }
  row(entries: [number, number][], lower = -Infinity, upper = Infinity) {
    // Combine repeated coefficients before passing a sparse row to HiGHS.
    const combined = new Map<number, number>();
    for (const [index, value] of entries) combined.set(index, (combined.get(index) ?? 0) + value);
    this.rows.push({ lower, upper, entries: [...combined].filter(([, value]) => value !== 0) });
  }
  model(sense: ModelData["sense"]): ModelData {
    const starts = [0];
    const indices: number[] = [];
    const values: number[] = [];
    for (const row of this.rows) {
      for (const [column, value] of row.entries) { indices.push(column); values.push(value); }
      starts.push(indices.length);
    }
    return {
      numCols: this.columns.length, numRows: this.rows.length, sense,
      colCost: this.columns.map((column) => column.cost),
      colLower: this.columns.map((column) => column.lower), colUpper: this.columns.map((column) => column.upper),
      rowLower: this.rows.map((row) => row.lower), rowUpper: this.rows.map((row) => row.upper),
      integrality: this.columns.map(() => 1),
      matrix: { format: "csr", numCols: this.columns.length, numRows: this.rows.length, starts, indices, values },
    };
  }
}

export function buildMilp(prepared: PreparedPlanning, sense: ModelData["sense"]) {
  const model = new SparseMilp();
  const previous = new Map((prepared.input.data.acceptedPlan?.items ?? []).map((item) => [item.actionId, item]));
  const primaryWeight = previous.size + 1;
  const actionColumns = prepared.actions.map(({ action, windows }) => {
    const selected = model.column(actionValue(action) * primaryWeight);
    const start = model.column(0, 0, HORIZON - action.durationMin);
    const choices = windows.map((window) => ({ column: model.column(), window }));
    model.row([[selected, -1], ...choices.map(({ column }): [number, number] => [column, 1])], 0, 0);
    // With no chosen window start=0. With one chosen window it is bounded by that entire window.
    model.row([[start, 1], ...choices.map(({ column, window }): [number, number] => [column, -(window.dayIndex * 1440 + window.start)])], 0);
    model.row([[start, 1], ...choices.map(({ column, window }): [number, number] => [column, -(window.dayIndex * 1440 + window.end - action.durationMin)])], -Infinity, 0);
    const old = previous.get(action.id);
    if (old && old.end - old.start === action.durationMin && windows.some((window) => window.date === old.date && window.start <= old.start && old.end <= window.end)) {
      const dayIndex = prepared.days.findIndex((day) => day.date === old.date);
      const oldStart = dayIndex * 1440 + old.start;
      const stable = model.column(1);
      model.row([[stable, 1], [selected, -1]], -Infinity, 0);
      model.row([[start, 1], [stable, HORIZON]], -Infinity, oldStart + HORIZON);
      model.row([[start, -1], [stable, HORIZON]], -Infinity, HORIZON - oldStart);
    }
    return { selected, start, choices };
  });
  for (const [week, remaining] of Object.entries(prepared.budgets)) {
    const entries = prepared.actions.flatMap((item, index) => actionColumns[index].choices.filter(({ window }) => weekStart(window.date) === week).map(({ column }): [number, number] => [column, item.costCents]));
    model.row(entries, -Infinity, remaining);
  }
  for (let i = 0; i < prepared.actions.length; i++) {
    for (let j = i + 1; j < prepared.actions.length; j++) {
      const left = prepared.actions[i]; const right = prepared.actions[j];
      // No order variable is needed for activities whose reachable windows cannot overlap.
      const canConflict = left.windows.some((a) => right.windows.some((b) => a.date === b.date && a.start < b.end && b.start < a.end));
      if (!canConflict) continue;
      const a = actionColumns[i]; const b = actionColumns[j];
      const order = model.column();
      model.row([[a.start, 1], [a.selected, left.action.durationMin + HORIZON], [b.start, -1], [b.selected, HORIZON], [order, HORIZON]], -Infinity, 3 * HORIZON);
      model.row([[b.start, 1], [b.selected, right.action.durationMin + HORIZON], [a.start, -1], [a.selected, HORIZON], [order, -HORIZON]], -Infinity, 2 * HORIZON);
    }
  }
  return { data: model.model(sense), actionColumns };
}

export function ruleFallback(input: PlannerInput, message: string, code = "solver_fallback"): PlanResult {
  const result = buildRulePlan(input);
  result.issues.push({ code, message });
  // buildRulePlan itself uses the exact checker; recheck at the public boundary too.
  const invalid = validatePlan(input, result).filter((issue) => !result.issues.some((known) => known.code === issue.code && known.date === issue.date));
  if (invalid.length) { result.items = []; result.status = "error"; result.issues.push(...invalid); result.objective = 0; }
  return result;
}

/** Fresh all-optional models have a known empty assignment; an infeasible claim is a model error. */
export function interpretHighsOutcome(status: number, hasFeasible: boolean): "optimal" | "feasible" | "no_incumbent" | "inconsistent" {
  if (status === 8) return "inconsistent";
  if (status >= 1 && status <= 5) return "no_incumbent";
  if (!hasFeasible) return "no_incumbent";
  return status === 7 ? "optimal" : "feasible";
}

/** Runs only in a browser Worker (or explicitly in Node tests), never on the cloud server. */
export async function solveWithHighs(input: PlannerInput): Promise<PlanResult> {
  const started = performance.now();
  const prepared = preparePlannerInput(input);
  if (prepared.hasConflict || !prepared.actions.length) return finishPlan(prepared, [], "highs", prepared.hasConflict ? "infeasible" : "optimal", performance.now() - started);
  if (prepared.actions.length > MAX_SOLVER_ACTIONS || prepared.actions.reduce((sum, item) => sum + item.windows.length, 0) > MAX_CANDIDATE_WINDOWS) return ruleFallback(input, "待办或候选窗口较多，已使用经过校验的规则草案；可缩小本轮待办范围后重新优化。", "solver_size_limit");
  try {
    const highs = await runtime();
    const { data, actionColumns } = buildMilp(prepared, highs.constants.objectiveSense.maximize);
    return highs.withModel(data, (model) => {
      model.options.set({ time_limit: 5, solver: "choose", output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-7 });
      model.run();
      const status = model.getModelStatus();
      const hasSolution = model.info.get("primal_solution_status") === highs.constants.solutionStatus.feasible;
      const interpretation = interpretHighsOutcome(status, hasSolution);
      if (interpretation === "no_incumbent" || interpretation === "inconsistent") {
        if (interpretation === "inconsistent") {
          // All optional activities being absent is a feasible assignment when prepared hard data passes.
          return ruleFallback(input, "求解器报告不可行，但保留全部固定安排且不新增待办仍有规则可行草案；已回退并记录模型异常。", "solver_model_inconsistency");
        }
        return ruleFallback(input, "本次优化未在限时内取得可用解，已返回经过校验的规则草案；这不代表日程不可安排。", "solver_no_incumbent");
      }
      const solution = model.getSolution().colValue;
      const items: PlanItem[] = [];
      const numericIssues: Issue[] = [];
      for (let index = 0; index < actionColumns.length; index++) {
        const columns = actionColumns[index];
        const selected = solution[columns.selected];
        const absoluteStart = solution[columns.start];
        if (![selected, absoluteStart].every(Number.isFinite) || Math.abs(selected - Math.round(selected)) > 1e-6 || Math.abs(absoluteStart - Math.round(absoluteStart)) > 1e-6) {
          numericIssues.push({ code: "solver_noninteger", activityIds: [prepared.actions[index].action.id], message: "求解结果没有通过整数分钟/布尔值检查，已拒绝该结果。" });
          continue;
        }
        if (Math.round(selected) !== 1) continue;
        const start = Math.round(absoluteStart);
        const dayIndex = Math.floor(start / 1440);
        if (dayIndex < 0 || dayIndex > 6) { numericIssues.push({ code: "solver_horizon", message: "求解结果超出规划窗口。" }); continue; }
        const action = prepared.actions[index].action;
        items.push({ actionId: action.id, date: prepared.days[dayIndex].date, start: start % 1440, end: start % 1440 + action.durationMin });
      }
      if (numericIssues.length) return ruleFallback(input, numericIssues.map((issue) => issue.message).join(" "), "solver_validation_failed");
      const outcome = finishPlan(prepared, items, "highs", interpretation, performance.now() - started, interpretation === "optimal" ? [] : [{ code: "solver_limit_incumbent", message: "已获得满足约束的方案；求解提前停止，尚未证明目标最优。" }]);
      if (outcome.status === "error") return ruleFallback(input, "优化结果未通过独立硬约束检查，已使用经过校验的规则草案。", "solver_validation_failed");
      return outcome;
    });
  } catch (error) {
    return ruleFallback(input, `优化器暂时不可用，已返回规则草案：${error instanceof Error ? error.message : "初始化或运行失败"}`, "solver_error");
  }
}
