import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import { EnvelopeSchema, type Envelope, type WorkspaceData } from "./domain";
import { emptyEnvelope, type WorkspaceRepository } from "./workspace-service";

export class D1WorkspaceRepository implements WorkspaceRepository {
  async load(ownerId: string): Promise<Envelope> {
    const db = getDb();
    await db.insert(workspaces).values({ ownerId, revision: 0, payload: JSON.stringify(emptyEnvelope().data), updatedAt: new Date().toISOString() }).onConflictDoNothing();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
    if (!row) throw new Error("Workspace unavailable after initialization");
    return EnvelopeSchema.parse({ revision: row.revision, data: JSON.parse(row.payload) });
  }
  async compareAndSwap(ownerId: string, expectedRevision: number, data: WorkspaceData): Promise<Envelope | null> {
    const [row] = await getDb().update(workspaces).set({ revision: expectedRevision + 1, payload: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.revision, expectedRevision))).returning();
    return row ? EnvelopeSchema.parse({ revision: row.revision, data: JSON.parse(row.payload) }) : null;
  }
}
