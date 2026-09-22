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

/** 该口令历史总提问次数（试用口令按总数限） */
export async function countTotalUsage(codeId: number): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(chatLogs)
    .where(eq(chatLogs.codeId, codeId));
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

export type InviteOpts = { expiresAt?: Date | null; totalLimit?: number | null; channel?: string };

export async function upsertInvite(code: string, label: string, dailyLimit: number, opts: InviteOpts = {}) {
  const c = normalizeCode(code);
  const extra = {
    ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.totalLimit !== undefined ? { totalLimit: opts.totalLimit } : {}),
    ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
  };
  await getDb()
    .insert(inviteCodes)
    .values({ code: c, label, dailyLimit, ...extra })
    .onDuplicateKeyUpdate({ set: { label, dailyLimit, active: true, ...extra } });
  return findInviteByCode(c);
}

/** 续期：在"现在"或"原到期日"中较晚者基础上加 days 天 */
export async function extendInvite(code: string, days: number) {
  const row = await findInviteByCode(code);
  if (!row) return null;
  const base = row.expiresAt && row.expiresAt > new Date() ? row.expiresAt : new Date();
  const expiresAt = new Date(base.getTime() + days * 86_400_000);
  await getDb().update(inviteCodes).set({ expiresAt, active: true }).where(eq(inviteCodes.id, row.id));
  return findInviteByCode(code);
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
      channel: inviteCodes.channel,
      dailyLimit: inviteCodes.dailyLimit,
      totalLimit: inviteCodes.totalLimit,
      expiresAt: inviteCodes.expiresAt,
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
