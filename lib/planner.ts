import type { ActionRequest, Issue, PlanItem, PlanResult, ProtectedEvent, TimeWindow, WorkspaceData } from "./domain";
import { addDays, getDayWindows, getProtectedEvents, materializeDays, todayInShanghai, weekStart } from "./time";

export type PlannerInput = { data: WorkspaceData; revision: number; now: string };
export type CandidateWindow = TimeWindow & { date: string; dayIndex: number };
export type PreparedAction = { action: ActionRequest; windows: CandidateWindow[]; costCents: number };
export type PreparedDay = { date: string; index: number; usable: TimeWindow[]; events: ProtectedEvent[]; excluded: boolean };
export type PreparedPlanning = {
  input: PlannerInput; startDate: string; earliestToday: number; days: PreparedDay[]; actions: PreparedAction[];
  issues: Issue[]; needsInput: boolean; hasConflict: boolean; budgets: Record<string, number>; reasons: Record<string, string>;
};

const DAY_MS = 86_400_000;
const dateMs = (date: string) => Date.parse(`${date}T00:00:00+08:00`);
const overlap = (a: TimeWindow, b: TimeWindow) => a.start < b.end && b.start < a.end;
const issueKey = (issue: Issue) => `${issue.code}|${issue.date ?? ""}|${issue.activityIds?.join(",") ?? ""}`;
const uniqueIssues = (issues: Issue[]) => [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
export const actionValue = (action: ActionRequest) => action.priority * action.durationMin;

export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const sorted = windows.map((window) => ({ ...window })).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: TimeWindow[] = [];
  for (const window of sorted) {
    const last = result[result.length - 1];
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else result.push(window);
  }
  return result;
}

export function subtractWindows(windows: TimeWindow[], blocked: TimeWindow[]): TimeWindow[] {
  let result = mergeWindows(windows);
  for (const block of mergeWindows(blocked)) {
    result = result.flatMap((window) => {
      if (!overlap(window, block)) return [window];
      return [
        ...(window.start < block.start ? [{ start: window.start, end: block.start }] : []),
        ...(block.end < window.end ? [{ start: block.end, end: window.end }] : []),
      ];
    });
  }
  return result;
}

function actualSourceIds(data: WorkspaceData): Set<string> {
  return new Set(data.expenses.flatMap((expense) => expense.sourceId ? [expense.sourceId] : []));
}

/** Unsettled confirmed estimates stay reserved until an actual sourceId expense replaces them. */
export function committedWeekCost(data: WorkspaceData, week: string, now: string): number {
  if (!Number.isFinite(Date.parse(now))) throw new Error("预算核算时间无效");
  const paid = actualSourceIds(data);
  let cents = data.expenses.filter((expense) => weekStart(expense.date) === week).reduce((sum, expense) => sum + expense.cents, 0);
  for (let day = 0; day < 7; day++) {
    for (const event of getProtectedEvents(data, addDays(week, day))) {
      if (event.confirmation === "confirmed" && !paid.has(event.id)) cents += event.costCents;
    }
  }
  return cents;
}

export function preparePlannerInput(input: PlannerInput): PreparedPlanning {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("规划时间无效");
  const { data } = input;
  const startDate = todayInShanghai(new Date(input.now));
  // A five-minute lead avoids generating a start that expires during review/save.
  const earliestToday = Math.ceil((Date.parse(input.now) - dateMs(startDate)) / 60_000) + 5;
  const issues: Issue[] = [];
  let needsInput = false;
  let hasConflict = false;
  const settings = data.settings;
  const missingSettings = [
    ["researchMinPerDay", "科研最低时长"], ["restMinPerDay", "休息最低时长"], ["weeklyBudgetCents", "每周预算"],
  ] as const;
  for (const [key, label] of missingSettings) {
    if (settings[key] === null) {
      issues.push({ code: `missing_${key}`, message: `请先填写${label}；未知值不会自动当作零。` });
      needsInput = true;
    }
  }
  const incompleteSettings = missingSettings.some(([key]) => settings[key] === null);
  const days: PreparedDay[] = materializeDays(data, startDate, 7).map((day, index) => {
    const events = day.events.filter((event) => event.confirmation === "confirmed");
    let excluded = incompleteSettings;
    if (day.availableWindows === null) {
      issues.push({ code: "unknown_availability", date: day.date, message: "这一天的可用时间未知，请补充后再采纳完整计划。" });
      needsInput = true;
      excluded = true;
    }
    for (const [kind, minimum, label] of [
      ["research", settings.researchMinPerDay, "科研"], ["rest", settings.restMinPerDay, "休息"],
    ] as const) {
      const covered = mergeWindows(events.filter((event) => event.kind === kind)).reduce((sum, block) => sum + block.end - block.start, 0);
      if (minimum !== null && covered < minimum) {
        issues.push({ code: `${kind}_below_min`, date: day.date, message: `${label}保护块只有 ${covered} 分钟，低于设置的 ${minimum} 分钟；请补齐真实日程。` });
        needsInput = true;
        excluded = true;
      }
    }
    const sorted = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let a = 0; a < sorted.length; a++) {
      for (let b = a + 1; b < sorted.length && sorted[b].start < sorted[a].end; b++) {
        if (overlap(sorted[a], sorted[b])) {
          issues.push({ code: "confirmed_overlap", date: day.date, activityIds: [sorted[a].id, sorted[b].id], message: `已确认日程“${sorted[a].title}”与“${sorted[b].title}”重叠，需要先沟通调整。` });
          hasConflict = true;
        }
      }
    }
    const available = (day.availableWindows ?? []).map((window) => ({ start: Math.max(window.start, index === 0 ? earliestToday : 0), end: window.end })).filter((window) => window.start < window.end);
    return { date: day.date, index, events, excluded, usable: excluded ? [] : subtractWindows(available, events) };
  });
  const weeks = [...new Set(days.map((day) => weekStart(day.date)))];
  const budgets: Record<string, number> = {};
  for (const week of weeks) {
    const spent = committedWeekCost(data, week, input.now);
    budgets[week] = settings.weeklyBudgetCents === null ? 0 : settings.weeklyBudgetCents - spent;
    if (settings.weeklyBudgetCents !== null && spent > settings.weeklyBudgetCents) {
      issues.push({ code: "committed_budget_exceeded", date: week, message: `自然周 ${week} 的实际支出与尚未记账的已确认预估合计 ${(spent / 100).toFixed(2)} 元，超过预算 ${(settings.weeklyBudgetCents / 100).toFixed(2)} 元；请补记实际费用或核对已确认安排。` });
      hasConflict = true;
    }
  }
  const paid = actualSourceIds(data);
  const people = new Map(data.people.map((person) => [person.id, person]));
  const reasons: Record<string, string> = {};
  const actions: PreparedAction[] = [];
  for (const action of data.actions.filter((action) => action.status === "open")) {
    if (action.personId && people.get(action.personId)?.status !== "active") {
      reasons[action.id] = "联系人已暂停，本轮不安排新的联系待办。";
      continue;
    }
    const windows: CandidateWindow[] = [];
    for (const day of days) {
      const requestedWindows = mergeWindows(action.windows.filter((window) => window.date === day.date));
      const intersections = requestedWindows.flatMap((requested) => day.usable.map((available) => ({ start: Math.max(requested.start, available.start), end: Math.min(requested.end, available.end) }))).filter((window) => window.start < window.end);
      windows.push(...mergeWindows(intersections).filter((window) => window.end - window.start >= action.durationMin).map((window) => ({ ...window, date: day.date, dayIndex: day.index })));
    }
    if (!windows.length) {
      reasons[action.id] = !action.windows.length ? "尚未填写待办允许的日期和时间窗口。" : "未来七天没有已知且完整容纳此待办的可用窗口；可能需补充时间或调整保护日程。";
      continue;
    }
    actions.push({ action, windows, costCents: paid.has(action.id) ? 0 : action.costCents });
  }
  return { input, startDate, earliestToday, days, actions, issues: uniqueIssues(issues), needsInput, hasConflict, budgets, reasons };
}

function validateItems(input: PlannerInput, plan: Pick<PlanResult, "items" | "startDate" | "sourceRevision">, prepared: PreparedPlanning): Issue[] {
  const issues: Issue[] = [];
  if (plan.sourceRevision !== input.revision) issues.push({ code: "stale_revision", message: "计划依据的数据版本已改变，请重新生成。" });
  if (plan.startDate !== prepared.startDate) issues.push({ code: "stale_start_date", message: "计划的七日起始日期已过期，请重新生成。" });
  const actions = new Map(input.data.actions.map((action) => [action.id, action]));
  const people = new Map(input.data.people.map((person) => [person.id, person]));
  const paid = actualSourceIds(input.data);
  const used = new Set<string>();
  const costByWeek: Record<string, number> = {};
  for (const item of plan.items) {
    const failure = (code: string, message: string) => issues.push({ code, date: item.date, activityIds: [item.actionId], message });
    const action = actions.get(item.actionId);
    if (!action) { failure("unknown_action", "计划引用的待办不存在。"); continue; }
    if (used.has(item.actionId)) failure("duplicate_action", "同一个待办只能安排一次。");
    used.add(item.actionId);
    if (action.status !== "open") failure("closed_action", "已完成或取消的待办不能重新安排。");
    if (action.personId && people.get(action.personId)?.status !== "active") failure("paused_person", "联系人已暂停，不能安排新联系。");
    if (![item.start, item.end].every(Number.isSafeInteger) || item.start < 0 || item.end > 1440 || item.start >= item.end) { failure("invalid_interval", "日程必须使用有效整数分钟。"); continue; }
    if (item.end - item.start !== action.durationMin) failure("duration_mismatch", "计划时长与待办时长不一致。");
    const index = (dateMs(item.date) - dateMs(prepared.startDate)) / DAY_MS;
    if (!Number.isInteger(index) || index < 0 || index > 6) { failure("outside_horizon", "活动必须在当前七天滚动窗口内。"); continue; }
    const currentMinute = Math.ceil((Date.parse(input.now) - dateMs(prepared.startDate)) / 60_000);
    if (index === 0 && item.start < currentMinute) failure("past_start", "新安排开始时间已过期，请重新规划。");
    // These checks use the original input windows/events rather than trusting solver preprocessing.
    const available = getDayWindows(input.data, item.date);
    if (available === null || !mergeWindows(available).some((window) => window.start <= item.start && item.end <= window.end)) failure("outside_available_window", "活动没有完整落在本人已确认的可用窗口内。");
    if (!mergeWindows(action.windows.filter((window) => window.date === item.date)).some((window) => window.start <= item.start && item.end <= window.end)) failure("outside_action_window", "活动没有完整落在待办允许的时间窗口内。");
    if (prepared.days[index]?.excluded) failure("incomplete_day", "这一天的可用时间或科研、休息保护不足，需要补齐输入。");
    const locked = getProtectedEvents(input.data, item.date).filter((event) => event.confirmation === "confirmed" && overlap(item, event));
    if (locked.length) issues.push({ code: "protected_overlap", date: item.date, activityIds: [item.actionId, ...locked.map((event) => event.id)], message: "安排挤占了已确认日程或科研、睡眠、休息保护块。" });
    const week = weekStart(item.date);
    costByWeek[week] = (costByWeek[week] ?? 0) + (paid.has(action.id) ? 0 : action.costCents);
  }
  const sorted = [...plan.items].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  for (let a = 0; a < sorted.length; a++) {
    for (let b = a + 1; b < sorted.length && sorted[b].date === sorted[a].date && sorted[b].start < sorted[a].end; b++) {
      if (overlap(sorted[a], sorted[b])) issues.push({ code: "action_overlap", date: sorted[a].date, activityIds: [sorted[a].actionId, sorted[b].actionId], message: "两个待办的时间重叠。" });
    }
  }
  for (const [week, cost] of Object.entries(costByWeek)) {
    if (input.data.settings.weeklyBudgetCents === null || committedWeekCost(input.data, week, input.now) + cost > input.data.settings.weeklyBudgetCents) issues.push({ code: "planned_budget_exceeded", date: week, message: "实际支出、已确认活动预估与本次待办费用合计超过自然周预算。" });
  }
  return uniqueIssues(issues);
}

/** Exact integer checks against current input. Missing inputs are returned as issues as well. */
export function validatePlan(input: PlannerInput, plan: PlanResult): Issue[] {
  const prepared = preparePlannerInput(input);
  return uniqueIssues([...prepared.issues, ...validateItems(input, plan, prepared)]);
}

export function finishPlan(prepared: PreparedPlanning, items: PlanItem[], engine: PlanResult["engine"], status: PlanResult["status"], solveMs: number, additionalIssues: Issue[] = []): PlanResult {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.actionId.localeCompare(b.actionId));
  const candidate = { items: sorted, startDate: prepared.startDate, sourceRevision: prepared.input.revision };
  const invalid = validateItems(prepared.input, candidate, prepared);
  const accepted = invalid.length ? [] : sorted;
  const selected = new Set(accepted.map((item) => item.actionId));
  const actionMap = new Map(prepared.input.data.actions.map((action) => [action.id, action]));
  return {
    id: `plan-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    sourceRevision: prepared.input.revision, generatedAt: prepared.input.now, startDate: prepared.startDate,
    status: prepared.hasConflict ? "infeasible" : invalid.length ? "error" : prepared.needsInput ? "needs_input" : status,
    engine, items: accepted, issues: uniqueIssues([...prepared.issues, ...additionalIssues, ...invalid]),
    unselected: prepared.input.data.actions.filter((action) => action.status === "open" && !selected.has(action.id)).map((action) => ({ actionId: action.id, reason: prepared.reasons[action.id] ?? "本轮未选中；可调整优先级、预算或时间后重新规划，不代表该待办已被证明无法安排。" })),
    objective: accepted.reduce((sum, item) => sum + actionValue(actionMap.get(item.actionId)!), 0), solveMs,
  };
}

/** A deterministic safe baseline, also used when WebAssembly is unavailable. */
export function buildRulePlan(input: PlannerInput): PlanResult {
  const started = performance.now();
  const prepared = preparePlannerInput(input);
  if (prepared.hasConflict) return finishPlan(prepared, [], "rules", "infeasible", performance.now() - started);
  const items: PlanItem[] = [];
  const remaining = { ...prepared.budgets };
  const previous = new Map((input.data.acceptedPlan?.items ?? []).map((item) => [item.actionId, item]));
  const sorted = [...prepared.actions].sort((a, b) => actionValue(b.action) - actionValue(a.action) || Number(previous.has(b.action.id)) - Number(previous.has(a.action.id)) || a.action.id.localeCompare(b.action.id));
  for (const { action, windows, costCents } of sorted) {
    const candidates: PlanItem[] = [];
    const old = previous.get(action.id);
    if (old && old.end - old.start === action.durationMin && windows.some((window) => window.date === old.date && window.start <= old.start && old.end <= window.end)) candidates.push(old);
    for (const window of windows) {
      for (const free of subtractWindows([window], items.filter((item) => item.date === window.date))) {
        if (free.end - free.start >= action.durationMin) candidates.push({ actionId: action.id, date: window.date, start: free.start, end: free.start + action.durationMin });
      }
    }
    const selected = candidates.find((item) => (remaining[weekStart(item.date)] ?? 0) >= costCents && !items.some((other) => other.date === item.date && overlap(item, other)));
    if (selected) {
      items.push({ ...selected });
      remaining[weekStart(selected.date)] -= costCents;
    }
  }
  return finishPlan(prepared, items, "rules", "feasible", performance.now() - started);
}
