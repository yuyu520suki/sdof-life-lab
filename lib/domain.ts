import { z } from "zod";

/** A date and all calendar minutes are local to Asia/Shanghai. */
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1 && parsed.toISOString().slice(0, 10) === value;
}, "日期必须是真实存在的 YYYY-MM-DD");
export const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "ID 只能包含字母、数字、点、冒号、短横线和下划线");
const title = z.string().trim().min(1).max(160);
const note = z.string().max(2000);
const minute = z.number().finite().int().min(0).max(1440);
const cents = z.number().finite().int().min(0).max(1_000_000_000);
const revision = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const validInterval = (value: { start: number; end: number }) => value.start < value.end;
const intervalError = { message: "结束时间必须晚于开始时间；跨午夜活动请拆分", path: ["end"] };

export const TimeWindowSchema = z.object({ start: minute, end: minute }).strict().refine(validInterval, intervalError);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;
export const BlockKindSchema = z.enum(["research", "course", "sleep", "rest", "meeting", "other"]);
export type BlockKind = z.infer<typeof BlockKindSchema>;
export const TemplateBlockSchema = z.object({ title, kind: BlockKindSchema, start: minute, end: minute }).strict().refine(validInterval, intervalError);
export type TemplateBlock = z.infer<typeof TemplateBlockSchema>;
export const DayTemplateSchema = z.object({
  weekday: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
  windows: z.array(TimeWindowSchema).max(48),
  blocks: z.array(TemplateBlockSchema).max(96),
}).strict();
export type DayTemplate = z.infer<typeof DayTemplateSchema>;
export const SettingsSchema = z.object({
  timezone: z.literal("Asia/Shanghai"),
  researchMinPerDay: minute.nullable(),
  restMinPerDay: minute.nullable(),
  weeklyBudgetCents: cents.nullable(),
  weeklyTemplate: z.array(DayTemplateSchema).max(7),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const PersonSchema = z.object({
  id: IdSchema, name: z.string().trim().min(1).max(80), status: z.enum(["active", "paused"]), note,
}).strict();
export type Person = z.infer<typeof PersonSchema>;
export const FactSchema = z.object({
  personId: IdSchema,
  contact: z.enum(["none", "inbound", "outbound", "both"]).nullable(),
  myInterest: z.number().finite().int().min(0).max(5).nullable(),
  myComfort: z.number().finite().int().min(0).max(5).nullable(),
  note,
}).strict();
export type Fact = z.infer<typeof FactSchema>;
export const DayEntrySchema = z.object({
  date: DateSchema,
  energy: z.number().finite().int().min(0).max(10).nullable(),
  availableWindows: z.array(TimeWindowSchema).max(48).nullable(),
  facts: z.array(FactSchema).max(100),
  note,
}).strict();
export type DayEntry = z.infer<typeof DayEntrySchema>;
export const ProtectedEventSchema = z.object({
  id: IdSchema, date: DateSchema, title, kind: BlockKindSchema, start: minute, end: minute,
  personId: IdSchema.nullable(), confirmation: z.enum(["confirmed", "pending", "cancelled"]), costCents: cents,
}).strict().refine(validInterval, intervalError);
export type ProtectedEvent = z.infer<typeof ProtectedEventSchema>;
export const ActionKindSchema = z.enum(["reply", "greet", "invite", "coordinate", "other"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;
export const ActionWindowSchema = z.object({ date: DateSchema, start: minute, end: minute }).strict().refine(validInterval, intervalError);
export type ActionWindow = z.infer<typeof ActionWindowSchema>;
export const ActionRequestSchema = z.object({
  id: IdSchema, personId: IdSchema.nullable(), title, kind: ActionKindSchema,
  durationMin: z.number().finite().int().min(1).max(1440), costCents: cents,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  windows: z.array(ActionWindowSchema).max(100), status: z.enum(["open", "done", "cancelled"]),
}).strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export const ExpenseSchema = z.object({ id: IdSchema, date: DateSchema, cents, sourceId: IdSchema.nullable(), note }).strict();
export type Expense = z.infer<typeof ExpenseSchema>;
export const IssueSchema = z.object({
  code: z.string().min(1).max(100), message: z.string().min(1).max(2000), date: DateSchema.optional(), activityIds: z.array(IdSchema).max(1000).optional(),
}).strict();
export type Issue = z.infer<typeof IssueSchema>;
export const PlanItemSchema = z.object({ actionId: IdSchema, date: DateSchema, start: minute, end: minute }).strict().refine(validInterval, intervalError);
export type PlanItem = z.infer<typeof PlanItemSchema>;
export const PlanResultSchema = z.object({
  id: IdSchema, sourceRevision: revision,
  generatedAt: z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)), "生成时间无效"),
  startDate: DateSchema,
  status: z.enum(["optimal", "feasible", "infeasible", "unknown", "error", "needs_input"]),
  engine: z.enum(["rules", "highs"]), items: z.array(PlanItemSchema).max(5000), issues: z.array(IssueSchema).max(1000),
  unselected: z.array(z.object({ actionId: IdSchema, reason: z.string().min(1).max(2000) }).strict()).max(5000),
  objective: z.number().finite().nullable(), solveMs: z.number().finite().min(0),
}).strict();
export type PlanResult = z.infer<typeof PlanResultSchema>;

const WorkspaceShapeSchema = z.object({
  schemaVersion: z.literal(1), settings: SettingsSchema,
  people: z.array(PersonSchema).max(100), days: z.array(DayEntrySchema).max(3660),
  events: z.array(ProtectedEventSchema).max(10_000), actions: z.array(ActionRequestSchema).max(5000),
  expenses: z.array(ExpenseSchema).max(10_000), acceptedPlan: PlanResultSchema.nullable(),
}).strict();

export const WorkspaceDataSchema = WorkspaceShapeSchema.superRefine((data, ctx) => {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const checkUnique = <T,>(items: T[], key: (item: T) => string | number, path: string, field: string) => {
    const seen = new Set<string | number>();
    items.forEach((item, index) => { const value = key(item); if (seen.has(value)) fail([path, index, field], "重复标识"); seen.add(value); });
  };
  checkUnique(data.people, (item) => item.id, "people", "id");
  checkUnique(data.days, (item) => item.date, "days", "date");
  checkUnique(data.events, (item) => item.id, "events", "id");
  checkUnique(data.actions, (item) => item.id, "actions", "id");
  checkUnique(data.expenses, (item) => item.id, "expenses", "id");
  const templateDays = new Set<number>();
  data.settings.weeklyTemplate.forEach((item, index) => {
    if (templateDays.has(item.weekday)) fail(["settings", "weeklyTemplate", index, "weekday"], "同一星期只能有一个模板");
    templateDays.add(item.weekday);
  });
  const personIds = new Set(data.people.map((item) => item.id));
  data.days.forEach((day, index) => {
    const facts = new Set<string>();
    day.facts.forEach((fact, factIndex) => {
      if (!personIds.has(fact.personId)) fail(["days", index, "facts", factIndex, "personId"], "对象不存在");
      if (facts.has(fact.personId)) fail(["days", index, "facts", factIndex, "personId"], "同一天同一对象只能有一条事实记录");
      facts.add(fact.personId);
    });
  });
  const eventIds = new Set(data.events.map((item) => item.id));
  const actionMap = new Map(data.actions.map((item) => [item.id, item]));
  for (const collection of ["events", "actions"] as const) {
    data[collection].forEach((item, index) => {
      if (item.personId !== null && !personIds.has(item.personId)) fail([collection, index, "personId"], "对象不存在");
      if (collection === "actions" && eventIds.has(item.id)) fail([collection, index, "id"], "活动与待办不能使用相同 ID");
    });
  }
  const isTemplateSource = (id: string) => {
    const match = /^template-(\d{4}-\d{2}-\d{2})-(0|[1-9]\d*)$/.exec(id);
    if (!match || !DateSchema.safeParse(match[1]).success) return false;
    const date = new Date(`${match[1]}T00:00:00.000Z`);
    const weekday = date.getUTCDay() || 7;
    return Boolean(data.settings.weeklyTemplate.find((item) => item.weekday === weekday)?.blocks[Number(match[2])]);
  };
  data.actions.forEach((action, index) => {
    if (action.id.startsWith("template-")) fail(["actions", index, "id"], "template- 前缀保留给模板日历块");
  });
  data.events.forEach((event, index) => {
    if (event.id.startsWith("template-") && !isTemplateSource(event.id)) fail(["events", index, "id"], "模板覆盖 ID 必须对应真实存在的模板日期和块索引");
  });
  const paidSources = new Set<string>();
  data.expenses.forEach((expense, index) => {
    if (expense.sourceId === null) return;
    if (!eventIds.has(expense.sourceId) && !actionMap.has(expense.sourceId) && !isTemplateSource(expense.sourceId)) fail(["expenses", index, "sourceId"], "费用关联的活动或待办不存在");
    if (paidSources.has(expense.sourceId)) fail(["expenses", index, "sourceId"], "同一活动只能关联一笔实际费用，请合并后更新，避免重复计费");
    paidSources.add(expense.sourceId);
  });
  const plan = data.acceptedPlan;
  if (plan) {
    if (plan.status !== "optimal" && plan.status !== "feasible") fail(["acceptedPlan", "status"], "只能采纳可行或最优计划");
    const planned = new Set<string>();
    const start = Date.parse(`${plan.startDate}T00:00:00.000Z`);
    plan.items.forEach((item, index) => {
      const action = actionMap.get(item.actionId);
      if (!action) fail(["acceptedPlan", "items", index, "actionId"], "计划关联的待办不存在");
      if (planned.has(item.actionId)) fail(["acceptedPlan", "items", index, "actionId"], "同一待办不能安排多次");
      planned.add(item.actionId);
      if (action && item.end - item.start !== action.durationMin) fail(["acceptedPlan", "items", index, "end"], "安排时长与待办时长不一致");
      const day = (Date.parse(`${item.date}T00:00:00.000Z`) - start) / 86_400_000;
      if (day < 0 || day >= 7) fail(["acceptedPlan", "items", index, "date"], "安排必须位于计划起始日期后的七日内");
    });
    const unselected = new Set<string>();
    plan.unselected.forEach((item, index) => {
      if (!actionMap.has(item.actionId)) fail(["acceptedPlan", "unselected", index, "actionId"], "未安排条目关联的待办不存在");
      if (planned.has(item.actionId) || unselected.has(item.actionId)) fail(["acceptedPlan", "unselected", index, "actionId"], "待办不能在结果中重复出现");
      unselected.add(item.actionId);
    });
  }
});
export type WorkspaceData = z.infer<typeof WorkspaceDataSchema>;
export const EnvelopeSchema = z.object({ revision, data: WorkspaceDataSchema }).strict().superRefine((value, ctx) => {
  if (value.data.acceptedPlan && value.data.acceptedPlan.sourceRevision > value.revision) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data", "acceptedPlan", "sourceRevision"], message: "计划不能引用未来版本" });
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
export const workspaceSchema = WorkspaceDataSchema;
export const envelopeSchema = EnvelopeSchema;
export const planResultSchema = PlanResultSchema;

export function createEmptyWorkspace(): WorkspaceData {
  return {
    schemaVersion: 1,
    settings: { timezone: "Asia/Shanghai", researchMinPerDay: null, restMinPerDay: null, weeklyBudgetCents: null, weeklyTemplate: [] },
    people: [], days: [], events: [], actions: [], expenses: [], acceptedPlan: null,
  };
}
