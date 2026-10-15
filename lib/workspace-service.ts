import { z } from "zod";
import { createEmptyWorkspace, EnvelopeSchema, PlanResultSchema, WorkspaceDataSchema, type Envelope, type PlanResult, type WorkspaceData } from "./domain";
import { validatePlan } from "./planner";

export const MAX_DOCUMENT_BYTES = 1_000_000;
export class ServiceError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export interface WorkspaceRepository {
  load(ownerId: string): Promise<Envelope>;
  compareAndSwap(ownerId: string, expectedRevision: number, data: WorkspaceData): Promise<Envelope | null>;
}
export const SaveRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), data: WorkspaceDataSchema }).strict();
export const AcceptRequestSchema = z.object({ sourceRevision: z.number().int().nonnegative(), plan: PlanResultSchema }).strict();
export function checkDocumentSize(data: WorkspaceData) {
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_DOCUMENT_BYTES) throw new ServiceError(413, "记录超过 1 MB，请先导出归档后精简历史记录。");
}
export function requireOwner(ownerId: string | null | undefined): string {
  if (!ownerId) throw new ServiceError(401, "请先登录。");
  return ownerId;
}
export class WorkspaceService {
  constructor(private repository: WorkspaceRepository, private now = () => new Date()) {}
  async get(ownerId: string): Promise<Envelope> { return this.repository.load(requireOwner(ownerId)); }
  async save(ownerId: string, payload: unknown): Promise<Envelope> {
    requireOwner(ownerId);
    const parsed = SaveRequestSchema.safeParse(payload);
    if (!parsed.success) throw new ServiceError(422, "记录格式不正确。", parsed.error.flatten());
    const { expectedRevision, data } = parsed.data;
    checkDocumentSize(data);
    const current = await this.repository.load(ownerId);
    if (current.revision !== expectedRevision) throw new ServiceError(409, "其他设备已更新记录。你的修改尚未覆盖云端，请导出保留或重新加载后合并。");
    if (data.acceptedPlan !== null && JSON.stringify(data.acceptedPlan) !== JSON.stringify(current.data.acceptedPlan)) throw new ServiceError(422, "请通过“采纳计划”保存新方案，不能通过记录导入注入已采纳计划。");
    const valid = EnvelopeSchema.safeParse({ revision: current.revision + 1, data });
    if (!valid.success) throw new ServiceError(422, "记录与计划引用不一致，请清除旧计划后保存。", valid.error.flatten());
    const updated = await this.repository.compareAndSwap(ownerId, expectedRevision, data);
    if (!updated) throw new ServiceError(409, "保存时另一个设备更新了记录，请重新加载后合并。");
    return updated;
  }
  async accept(ownerId: string, payload: unknown): Promise<Envelope> {
    requireOwner(ownerId);
    const parsed = AcceptRequestSchema.safeParse(payload);
    if (!parsed.success) throw new ServiceError(422, "计划格式不正确。", parsed.error.flatten());
    const { sourceRevision, plan } = parsed.data;
    if (sourceRevision !== plan.sourceRevision) throw new ServiceError(422, "计划来源版本不一致。");
    const current = await this.repository.load(ownerId);
    // Repeat submissions are idempotent, but a reused ID with different content is not.
    if (current.data.acceptedPlan?.id === plan.id) {
      if (JSON.stringify(current.data.acceptedPlan) === JSON.stringify(plan)) return current;
      throw new ServiceError(409, "同一计划标识对应了不同内容，请重新生成计划。");
    }
    if (current.revision !== sourceRevision) throw new ServiceError(409, "这份草案已经过期，请用最新记录重新生成。");
    if (plan.status !== "feasible" && plan.status !== "optimal") throw new ServiceError(422, "只有完整通过约束检查的可行方案才能采纳。");
    const input = { data: current.data, revision: current.revision, now: this.now().toISOString() };
    const issues = validatePlan(input, plan);
    if (issues.length) throw new ServiceError(422, "计划未通过服务端约束复核，请更新输入并重新规划。", issues);
    // Costs and constraints are rebuilt from server records, never client summaries.
    const checked = WorkspaceDataSchema.safeParse({ ...current.data, acceptedPlan: plan });
    if (!checked.success) throw new ServiceError(422, "计划包含无效引用，请重新生成。", checked.error.flatten());
    const data = checked.data;
    checkDocumentSize(data);
    const updated = await this.repository.compareAndSwap(ownerId, current.revision, data);
    if (!updated) throw new ServiceError(409, "采纳时记录发生变化，请重新生成计划。");
    return updated;
  }
}

export function emptyEnvelope(): Envelope { return { revision: 0, data: createEmptyWorkspace() }; }
