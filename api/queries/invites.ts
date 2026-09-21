import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { chatLogs, inviteCodes } from "@db/schema";

export function findInviteByCode(code: string) {
  return getDb().query.inviteCodes.findFirst({
    where: eq(inviteCodes.code, code),
  });
}

export function findInviteById(id: number) {
  return getDb().query.inviteCodes.findFirst({
    where: eq(inviteCodes.id, id),
  });
}

// 今天 0 点（服务器本地时区）以来该口令的提问次数
export async function countTodayUsage(codeId: number): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(chatLogs)
    .where(and(eq(chatLogs.codeId, codeId), gte(chatLogs.createdAt, start)));
  return Number(rows[0]?.n ?? 0);
}

export function insertChatLog(
  codeId: number,
  question: string,
  answer: string,
) {
  return getDb().insert(chatLogs).values({ codeId, question, answer });
}
