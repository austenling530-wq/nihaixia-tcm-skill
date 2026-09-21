import {
  mysqlTable,
  serial,
  varchar,
  text,
  timestamp,
  int,
  boolean,
  bigint,
  index,
} from "drizzle-orm/mysql-core";

// 私域分发的邀请码（口令）
export const inviteCodes = mysqlTable("invite_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 128 }).notNull().default(""),
  dailyLimit: int("daily_limit").notNull().default(20),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 问答记录（按天限流 + 使用日志）
export const chatLogs = mysqlTable(
  "chat_logs",
  {
    id: serial("id").primaryKey(),
    codeId: bigint("code_id", { mode: "number", unsigned: true }).notNull(),
    ip: varchar("ip", { length: 64 }).notNull().default(""),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sources: text("sources"), // 本次检索命中的段落标题，JSON 数组
    durationMs: int("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("chat_logs_code_created").on(t.codeId, t.createdAt)],
);

export type InviteCode = typeof inviteCodes.$inferSelect;
export type ChatLog = typeof chatLogs.$inferSelect;
