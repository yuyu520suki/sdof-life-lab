import { createEmptyWorkspace, WorkspaceDataSchema, type WorkspaceData, type DayTemplate } from "./domain";
import { addDays, todayInShanghai } from "./time";

/** Fictional, isolated example; never copied into the real workspace implicitly. */
export function createDemoWorkspace(startDate: string = todayInShanghai()): WorkspaceData {
  const data = createEmptyWorkspace();
  data.settings = {
    timezone: "Asia/Shanghai", researchMinPerDay: 240, restMinPerDay: 60, weeklyBudgetCents: 40_000,
    weeklyTemplate: Array.from({ length: 7 }, (_, index): DayTemplate => ({
      weekday: (index + 1) as DayTemplate["weekday"],
      windows: [{ start: 8 * 60, end: 23 * 60 }],
      blocks: [
        { title: "示例 · 科研", kind: "research", start: 9 * 60, end: 13 * 60 },
        { title: "示例 · 休息缓冲", kind: "rest", start: 13 * 60, end: 14 * 60 },
        { title: "示例 · 睡眠保护", kind: "sleep", start: 0, end: 8 * 60 },
        { title: "示例 · 睡眠保护", kind: "sleep", start: 23 * 60, end: 1440 },
      ],
    })),
  };
  data.people = ["A", "B", "C", "D"].map((id, index) => ({ id, name: `匿名 ${id}`, status: index === 3 ? "paused" : "active", note: "虚构示例对象，可在演示中编辑" }));
  data.days = Array.from({ length: 7 }, (_, index) => ({
    date: addDays(startDate, index), energy: index === 0 ? 6 : null,
    availableWindows: [{ start: 8 * 60, end: 23 * 60 }],
    facts: index === 0 ? [{ personId: "A", contact: "inbound" as const, myInterest: 4, myComfort: 4, note: "虚构示例：收到日常问候" }] : [],
    note: "虚构演示数据，与现实人物或日程无关",
  }));
  data.events = [
    { id: "demo-confirmed", date: addDays(startDate, 2), title: "示例 · 已确认散步", kind: "meeting", start: 18 * 60, end: 19 * 60, personId: "B", confirmation: "confirmed", costCents: 2000 },
    { id: "demo-pending", date: addDays(startDate, 3), title: "示例 · 周末邀约待回应", kind: "meeting", start: 18 * 60, end: 20 * 60, personId: "A", confirmation: "pending", costCents: 8000 },
  ];
  data.actions = [
    { id: "demo-reply", personId: "A", title: "示例 · 回复问候", kind: "reply", durationMin: 15, costCents: 0, priority: 3, windows: [{ date: addDays(startDate, 1), start: 19 * 60, end: 21 * 60 }], status: "open" },
    { id: "demo-greet", personId: "C", title: "示例 · 主动问候", kind: "greet", durationMin: 20, costCents: 0, priority: 1, windows: [{ date: addDays(startDate, 2), start: 19 * 60 + 30, end: 21 * 60 }], status: "open" },
    { id: "demo-coordinate", personId: "B", title: "示例 · 确认散步地点", kind: "coordinate", durationMin: 10, costCents: 0, priority: 2, windows: [{ date: addDays(startDate, 1), start: 18 * 60, end: 21 * 60 }], status: "open" },
    { id: "demo-invite", personId: "A", title: "示例 · 提出下周邀请（仅本人待办）", kind: "invite", durationMin: 15, costCents: 0, priority: 1, windows: [{ date: addDays(startDate, 4), start: 18 * 60, end: 21 * 60 }], status: "open" },
  ];
  return WorkspaceDataSchema.parse(data);
}
