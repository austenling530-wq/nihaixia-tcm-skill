import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { issueToken } from "./token";
import { countTodayUsage, findInviteByCode } from "./queries/invites";
import { AskError, answerQuestion, checkInviteUsable, checkVerifyAllowed, verifyLock } from "./service";
import { aiConfigured, aiModel } from "./ai";

export const askInput = z.object({
  token: z.string().min(10).max(512),
  question: z.string().trim().min(2, "至少写两个字吧").max(500, "问题请控制在 500 字以内"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .optional(),
});

function toTrpc(e: unknown): never {
  if (e instanceof AskError) throw new TRPCError({ code: e.code, message: e.message });
  throw e;
}

export const askRouter = createRouter({
  // 第一步：校验邀请码口令，签发访问令牌（7 天）
  verify: publicQuery
    .input(z.object({ code: z.string().trim().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      try {
        checkVerifyAllowed(ctx.ip);
      } catch (e) {
        toTrpc(e);
      }
      const invite = await findInviteByCode(input.code);
      if (!invite || !invite.active) {
        const lockMs = verifyLock.fail(ctx.ip);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: lockMs ? "口令错误次数过多，请 15 分钟后再试" : "口令无效或已停用",
        });
      }
      verifyLock.reset(ctx.ip);
      let usedTotal = 0;
      try {
        usedTotal = await checkInviteUsable(invite, invite.id);
      } catch (e) {
        toTrpc(e);
      }
      const used = await countTodayUsage(invite.id);
      return {
        token: issueToken(invite.id),
        label: invite.label,
        dailyLimit: invite.dailyLimit,
        usedToday: used,
        expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
        totalLimit: invite.totalLimit,
        usedTotal,
      };
    }),

  // 第二步：持令牌提问（非流式；网页默认走 /api/ask/stream）
  ask: publicQuery.input(askInput).mutation(async ({ input, ctx }) => {
    try {
      return await answerQuestion({ ...input, ip: ctx.ip });
    } catch (e) {
      toTrpc(e);
    }
  }),

  status: publicQuery.query(() => ({ aiConfigured: aiConfigured(), model: aiConfigured() ? aiModel() : null })),
});
