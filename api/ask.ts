import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { issueToken, verifyToken } from "./token";
import { askAI } from "./ai";
import {
  countTodayUsage,
  findInviteByCode,
  findInviteById,
  insertChatLog,
} from "./queries/invites";

export const askRouter = createRouter({
  // 第一步：校验邀请码口令，签发访问令牌
  verify: publicQuery
    .input(z.object({ code: z.string().trim().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const invite = await findInviteByCode(input.code.toUpperCase());
      if (!invite || !invite.active) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "口令无效或已停用" });
      }
      const used = await countTodayUsage(invite.id);
      return {
        token: issueToken(invite.id),
        label: invite.label,
        dailyLimit: invite.dailyLimit,
        usedToday: used,
      };
    }),

  // 第二步：持令牌提问；服务端限流后代理到模型 API
  ask: publicQuery
    .input(
      z.object({
        token: z.string().min(10),
        question: z.string().trim().min(2, "至少写两个字吧").max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const codeId = verifyToken(input.token);
      if (!codeId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "访问令牌已失效，请重新输入口令",
        });
      }
      const invite = await findInviteById(codeId);
      if (!invite || !invite.active) {
        throw new TRPCError({ code: "FORBIDDEN", message: "该口令已被停用" });
      }

      const used = await countTodayUsage(codeId);
      if (used >= invite.dailyLimit) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `这个口令今天已用满 ${invite.dailyLimit} 次，明天再来吧`,
        });
      }

      let answer: string;
      try {
        answer = await askAI(input.question);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AI 服务暂时不可用：${(e as Error).message}`,
        });
      }

      await insertChatLog(codeId, input.question, answer);
      return { answer, usedToday: used + 1, dailyLimit: invite.dailyLimit };
    }),
});
