import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { chatLogs, inviteCodes } from "@db/schema";
import { startOfTodayShanghai } from "../lib/time";

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function findInviteByCode(code: string) {
  return getDb().query.inviteCodes.findFirst({
    where: eq(inviteCodes.code, normalizeCode(code)),
  });
}

export function findInviteById(id: number) {
  return getDb().query.inviteCodes.findFirst({
    where: eq(inviteCodes.id, id),
  });
}

/** 北京时间今天 0 点以来该口令的提问次数 */
export async function countTodayUsage(codeId: number): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(chatLogs)
    .where(and(eq(chatLogs.codeId, codeId), gte(chatLogs.createdAt, startOfTodayShanghai())));
  return Number(rows[0]?.n ?? 0);
}

export function insertChatLog(row: {
  codeId: number;
  ip: string;
  question: string;
  answer: string;
  sources: string[];
  durationMs: number;
}) {
  return getDb()
    .insert(chatLogs)
    .values({ ...row, sources: JSON.stringify(row.sources) });
}

// ── 管理用 ──────────────────────────────────────────────────
export function listInvites() {
  return getDb().select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt));
}

export async function upsertInvite(code: string, label: string, dailyLimit: number) {
  const c = normalizeCode(code);
  await getDb()
    .insert(inviteCodes)
    .values({ code: c, label, dailyLimit })
    .onDuplicateKeyUpdate({ set: { label, dailyLimit, active: true } });
  return findInviteByCode(c);
}

export async function setInviteActive(code: string, active: boolean) {
  const res = await getDb()
    .update(inviteCodes)
    .set({ active })
    .where(eq(inviteCodes.code, normalizeCode(code)));
  return res;
}

export async function usageToday() {
  return getDb()
    .select({
      code: inviteCodes.code,
      label: inviteCodes.label,
      dailyLimit: inviteCodes.dailyLimit,
      active: inviteCodes.active,
      used: sql<number>`count(${chatLogs.id})`,
    })
    .from(inviteCodes)
    .leftJoin(
      chatLogs,
      and(eq(chatLogs.codeId, inviteCodes.id), gte(chatLogs.createdAt, startOfTodayShanghai())),
    )
    .groupBy(inviteCodes.id);
}

export function recentLogs(limit = 20) {
  return getDb()
    .select({
      id: chatLogs.id,
      codeId: chatLogs.codeId,
      ip: chatLogs.ip,
      question: chatLogs.question,
      durationMs: chatLogs.durationMs,
      createdAt: chatLogs.createdAt,
    })
    .from(chatLogs)
    .orderBy(desc(chatLogs.id))
    .limit(limit);
}
