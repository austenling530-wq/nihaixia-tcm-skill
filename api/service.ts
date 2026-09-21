// 问答核心流程：口令校验 → 限流 → 检索知识库 → 调模型 → 记日志
// tRPC 的 ask.ask 和 SSE 的 /api/ask/stream 都走这里。

import { verifyToken } from "./token";
import { AIConfigError, AIUpstreamError, chatCompletion, type ChatMsg } from "./ai";
import { formatReferences, getCorePrompt, getIndex } from "./lib/knowledge";
import { FailureLock, InFlight, SlidingWindow, formatWait } from "./lib/ratelimit";
import { countTodayUsage, findInviteById, insertChatLog } from "./queries/invites";

export type AskErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR";

export class AskError extends Error {
  code: AskErrorCode;
  constructor(code: AskErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type HistoryMsg = { role: "user" | "assistant"; content: string };

// ── 限流器（进程级） ─────────────────────────────────────────
/** 口令校验：同一 IP 15 分钟内错 6 次锁 15 分钟 */
export const verifyLock = new FailureLock(6, 15 * 60_000, 15 * 60_000);
/** 口令校验：同一 IP 每分钟最多 20 次（不分对错） */
export const verifyWindow = new SlidingWindow(20, 60_000);
/** 提问：同一口令每分钟最多 6 次 */
export const askPerCode = new SlidingWindow(6, 60_000);
/** 提问：同一 IP 每分钟最多 10 次 */
export const askPerIp = new SlidingWindow(10, 60_000);
/** 同一口令同时只答一个问题 */
export const askInFlight = new InFlight();

export function checkVerifyAllowed(ip: string) {
  const locked = verifyLock.lockedFor(ip);
  if (locked > 0) {
    throw new AskError("TOO_MANY_REQUESTS", `口令错误次数过多，请 ${formatWait(locked)}后再试`);
  }
  const w = verifyWindow.hit(ip);
  if (!w.ok) throw new AskError("TOO_MANY_REQUESTS", `操作太频繁，请 ${formatWait(w.retryAfterMs)}后再试`);
}

const HISTORY_TURNS = 6; // 带给模型的历史条数（user+assistant 合计）
const HISTORY_MAX_CHARS = 2500;

function trimHistory(history: HistoryMsg[]): ChatMsg[] {
  return history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-HISTORY_TURNS)
    .map((m) => ({
      role: m.role,
      content: m.content.length > HISTORY_MAX_CHARS ? m.content.slice(0, HISTORY_MAX_CHARS) + "…" : m.content,
    }));
}

export async function answerQuestion(params: {
  token: string;
  question: string;
  history?: HistoryMsg[];
  ip: string;
  onDelta?: (text: string) => void;
  onSources?: (sources: string[]) => void;
  signal?: AbortSignal;
}): Promise<{ answer: string; sources: string[]; usedToday: number; dailyLimit: number }> {
  const codeId = verifyToken(params.token);
  if (!codeId) throw new AskError("UNAUTHORIZED", "访问令牌已失效，请重新输入口令");

  const invite = await findInviteById(codeId);
  if (!invite || !invite.active) throw new AskError("FORBIDDEN", "该口令已被停用");

  const ipW = askPerIp.hit(params.ip);
  if (!ipW.ok) throw new AskError("TOO_MANY_REQUESTS", `提问太频繁，请 ${formatWait(ipW.retryAfterMs)}后再试`);
  const codeW = askPerCode.hit(String(codeId));
  if (!codeW.ok) throw new AskError("TOO_MANY_REQUESTS", `这个口令提问太频繁，请 ${formatWait(codeW.retryAfterMs)}后再试`);

  const used = await countTodayUsage(codeId);
  if (used >= invite.dailyLimit) {
    throw new AskError("TOO_MANY_REQUESTS", `这个口令今天已用满 ${invite.dailyLimit} 次，明天再来吧`);
  }

  if (!askInFlight.tryAcquire(String(codeId))) {
    throw new AskError("TOO_MANY_REQUESTS", "上一个问题还在回答中，请稍等");
  }
  const t0 = Date.now();
  try {
    const history = trimHistory(params.history ?? []);
    // 追问太短（"剂量呢"）时把上一问也拿来检索
    const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = params.question.length < 12 && lastUser ? `${lastUser}\n${params.question}` : params.question;
    const hits = getIndex().search(query);
    const sources = hits.map((h) => h.chunk.title);
    params.onSources?.(sources);

    const messages: ChatMsg[] = [
      { role: "system", content: getCorePrompt() },
      ...history,
      { role: "user", content: `${params.question}\n\n---\n${formatReferences(hits)}` },
    ];

    let answer: string;
    try {
      answer = await chatCompletion(messages, { onDelta: params.onDelta, signal: params.signal });
    } catch (e) {
      if (e instanceof AIConfigError) {
        throw new AskError("INTERNAL_SERVER_ERROR", "站点尚未配置模型 API Key，请联系分享者");
      }
      if (e instanceof AIUpstreamError) {
        throw new AskError("INTERNAL_SERVER_ERROR", `AI 服务暂时不可用：${e.message}`);
      }
      console.error("[ask] unexpected", e);
      throw new AskError("INTERNAL_SERVER_ERROR", "AI 服务暂时不可用，请稍后再试");
    }

    await insertChatLog({
      codeId,
      ip: params.ip,
      question: params.question,
      answer,
      sources,
      durationMs: Date.now() - t0,
    });
    return { answer, sources, usedToday: used + 1, dailyLimit: invite.dailyLimit };
  } finally {
    askInFlight.release(String(codeId));
  }
}
