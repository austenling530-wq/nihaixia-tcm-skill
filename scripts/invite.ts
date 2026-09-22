// 口令管理命令行（在服务器上：node dist/invite.js <子命令>）
//
//   list                                   列出全部口令
//   add <CODE> [标签] [每日次数] [选项]      新增或更新口令（默认 20 次/天）
//   gen [标签] [每日次数] [选项]             随机生成口令
//   extend <CODE> <天数>                    续期：在原到期日（或今天）基础上加 N 天
//   off <CODE> / on <CODE>                 停用 / 启用
//   usage                                  今天各口令用量
//   logs [N]                               最近 N 条提问（默认 20）
//
// 选项（add / gen 通用）：
//   --days N       有效期 N 天（不填 = 永久）
//   --trial N      试用口令：总共只能问 N 次
//   --channel 名   分销员 / 渠道名，方便统计谁的口令
//   --batch N      （gen）一次生成 N 个，给分销员批发
//
// 例：node dist/invite.js gen 月卡 20 --days 30 --channel 张三 --batch 10
//     node dist/invite.js gen 朋友圈试用 20 --trial 3
//     node dist/invite.js extend ABCD2345 365

import { randomCode } from "../api/lib/code";
import {
  extendInvite,
  listInvites,
  normalizeCode,
  recentLogs,
  setInviteActive,
  upsertInvite,
  usageToday,
  type InviteOpts,
} from "../api/queries/invites";

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = args[i + 1] ?? "";
      i++;
    } else positional.push(a);
  }
  return { positional, flags };
}

function optsFromFlags(flags: Record<string, string>): InviteOpts {
  const opts: InviteOpts = {};
  if (flags.days !== undefined) {
    const d = Number(flags.days);
    if (!Number.isFinite(d) || d <= 0) throw new Error("--days 要是正数");
    opts.expiresAt = new Date(Date.now() + d * 86_400_000);
  }
  if (flags.trial !== undefined) {
    const n = Number(flags.trial);
    if (!Number.isInteger(n) || n <= 0) throw new Error("--trial 要是正整数");
    opts.totalLimit = n;
  }
  if (flags.channel !== undefined) opts.channel = flags.channel;
  return opts;
}

const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "永久");

function describe(row: Awaited<ReturnType<typeof upsertInvite>>): string {
  if (!row) return "(无)";
  const parts = [row.code, row.label, `${row.dailyLimit} 次/天`, `到期 ${fmtDate(row.expiresAt)}`];
  if (row.totalLimit != null) parts.push(`试用共 ${row.totalLimit} 次`);
  if (row.channel) parts.push(`渠道 ${row.channel}`);
  return parts.join("  ");
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  switch (cmd) {
    case "list": {
      const rows = await listInvites();
      console.table(
        rows.map((r) => ({
          code: r.code,
          label: r.label,
          channel: r.channel,
          perDay: r.dailyLimit,
          trial: r.totalLimit ?? "",
          expires: fmtDate(r.expiresAt),
          active: r.active,
          created: r.createdAt.toISOString().slice(0, 10),
        })),
      );
      break;
    }
    case "add": {
      const [code, label = "", limit = "20"] = positional;
      if (!code) throw new Error("用法：add <CODE> [标签] [每日次数] [--days N] [--trial N] [--channel 名]");
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) throw new Error("口令只能用字母数字、4～64 位");
      const row = await upsertInvite(code, label, Number(limit), optsFromFlags(flags));
      console.log("已保存：", describe(row));
      break;
    }
    case "gen": {
      const [label = "", limit = "20"] = positional;
      const n = Math.max(1, Number(flags.batch || "1") || 1);
      const opts = optsFromFlags(flags);
      for (let i = 0; i < n; i++) {
        const row = await upsertInvite(randomCode(), label, Number(limit), opts);
        console.log(n > 1 ? row?.code : `新口令：${describe(row)}`);
      }
      if (n > 1) console.log(`—— 共 ${n} 个：${label} ${limit} 次/天，到期 ${fmtDate(opts.expiresAt)}${opts.channel ? `，渠道 ${opts.channel}` : ""}`);
      break;
    }
    case "extend": {
      const [code, days] = positional;
      const d = Number(days);
      if (!code || !Number.isFinite(d) || d <= 0) throw new Error("用法：extend <CODE> <天数>");
      const row = await extendInvite(code, d);
      if (!row) throw new Error("口令不存在");
      console.log("已续期：", describe(row));
      break;
    }
    case "off":
    case "on": {
      const [code] = positional;
      if (!code) throw new Error(`用法：${cmd} <CODE>`);
      await setInviteActive(code, cmd === "on");
      console.log(`${normalizeCode(code)} 已${cmd === "on" ? "启用" : "停用"}`);
      break;
    }
    case "usage": {
      const rows = await usageToday();
      console.table(rows.map((r) => ({ ...r, expiresAt: fmtDate(r.expiresAt), totalLimit: r.totalLimit ?? "" })));
      break;
    }
    case "logs": {
      const rows = await recentLogs(Number(positional[0] ?? 20));
      console.table(rows.map((r) => ({ ...r, question: r.question.slice(0, 40) })));
      break;
    }
    default:
      console.log(`用法：invite <list|add|gen|extend|off|on|usage|logs>`);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2))
  .then(() => process.exit())
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
