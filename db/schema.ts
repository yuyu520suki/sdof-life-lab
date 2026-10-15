import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One bounded, versioned document makes compare-and-swap a single atomic SQL
// statement, including plan adoption. Identity never comes from browser input.
export const workspaces = sqliteTable("workspaces", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
