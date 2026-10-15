import { DateSchema, type ProtectedEvent, type TimeWindow, type WorkspaceData, type DayTemplate } from "./domain";

export const TIMEZONE = "Asia/Shanghai" as const;
const DAY_MS = 86_400_000;
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function dateValue(date: string): Date {
  DateSchema.parse(date);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Local calendar date; independent of the browser/server operating timezone. */
export function todayInShanghai(now: Date = new Date()): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

/** Includes fractional minutes, so Math.ceil(value) is safe for future-only plans. */
export function currentMinuteInShanghai(now: Date = new Date()): number {
  const parts = Object.fromEntries(timeFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60 + now.getUTCMilliseconds() / 60_000;
}

export function addDays(date: string, count: number): string {
  if (!Number.isSafeInteger(count)) throw new Error("日期偏移必须是整数");
  const next = new Date(dateValue(date).getTime() + count * DAY_MS);
  const result = next.toISOString().slice(0, 10);
  DateSchema.parse(result);
  return result;
}

export function weekday(date: string): DayTemplate["weekday"] {
  return (dateValue(date).getUTCDay() || 7) as DayTemplate["weekday"];
}

/** Monday is the start of a natural budget week. */
export function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

export function formatMinute(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1440) throw new Error("分钟必须为 0 到 1440 的整数");
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export function parseMinute(value: string): number | null {
  if (value === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Floating local ISO time for calendars configured with Asia/Shanghai/local time. */
export function dateAtMinute(date: string, value: number): string {
  DateSchema.parse(date);
  const time = formatMinute(value);
  return value === 1440 ? `${addDays(date, 1)}T00:00:00` : `${date}T${time}:00`;
}

export function getDayWindows(data: WorkspaceData, date: string): TimeWindow[] | null {
  DateSchema.parse(date);
  const entry = data.days.find((item) => item.date === date);
  if (entry) return entry.availableWindows?.map((window) => ({ ...window })) ?? null;
  const template = data.settings.weeklyTemplate.find((item) => item.weekday === weekday(date));
  return template ? template.windows.map((window) => ({ ...window })) : null;
}

/**
 * Includes pending/cancelled explicit events for reminders. Only confirmed events
 * protect time. An explicit matching ID overrides a template even if moved.
 * Without a date, returns stored dates plus the current seven-day calendar.
 */
export function getProtectedEvents(data: WorkspaceData, date?: string): ProtectedEvent[] {
  if (date === undefined) {
    const dates = new Set([...data.days.map((day) => day.date), ...data.events.map((event) => event.date)]);
    const today = todayInShanghai();
    for (let index = 0; index < 7; index++) dates.add(addDays(today, index));
    return [...dates].sort().flatMap((value) => getProtectedEvents(data, value));
  }
  DateSchema.parse(date);
  const overrides = new Set(data.events.map((event) => event.id));
  const template = data.settings.weeklyTemplate.find((item) => item.weekday === weekday(date));
  const derived: ProtectedEvent[] = (template?.blocks ?? []).map((block, index) => ({
    id: `template-${date}-${index}`, date, ...block, personId: null, confirmation: "confirmed", costCents: 0,
  }));
  return [
    ...derived.filter((event) => !overrides.has(event.id)),
    ...data.events.filter((event) => event.date === date).map((event) => ({ ...event })),
  ].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

export type MaterializedDay = {
  date: string;
  energy: number | null;
  availableWindows: TimeWindow[] | null;
  events: ProtectedEvent[];
};

export function materializeDays(data: WorkspaceData, startDate: string, count = 7): MaterializedDay[] {
  DateSchema.parse(startDate);
  if (!Number.isInteger(count) || count < 0 || count > 366) throw new Error("展开天数必须是 0 到 366 的整数");
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(startDate, index);
    return { date, energy: data.days.find((day) => day.date === date)?.energy ?? null, availableWindows: getDayWindows(data, date), events: getProtectedEvents(data, date) };
  });
}
