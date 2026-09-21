// 口令管理命令行（在服务器上：node dist/invite.js <子命令>）
//
//   list                         列出全部口令
//   add <CODE> [标签] [每日次数]   新增或更新口令（默认 20 次/天）
//   gen [标签] [每日次数]          随机生成一个口令
//   off <CODE> / on <CODE>       停用 / 启用
//   usage                        今天各口令用量
//   logs [N]                     最近 N 条提问（默认 20）

import crypto from "node:crypto";
import {
  listInvites,
  normalizeCode,
  recentLogs,
  setInviteActive,
  upsertInvite,
  usageToday,
} from "../api/queries/invites";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混的 I O 0 1

export function randomCode(len = 8): string {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "list": {
      const rows = await listInvites();
      console.table(rows.map((r) => ({ code: r.code, label: r.label, dailyLimit: r.dailyLimit, active: r.active, createdAt: r.createdAt })));
      break;
    }
    case "add": {
      const [code, label = "", limit = "20"] = rest;
      if (!code) throw new Error("用法：add <CODE> [标签] [每日次数]");
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) throw new Error("口令只能用字母数字、4～64 位");
      const row = await upsertInvite(code, label, Number(limit));
      console.log("已保存：", row?.code, row?.label, `${row?.dailyLimit} 次/天`);
      break;
    }
    case "gen": {
      const [label = "", limit = "20"] = rest;
      const row = await upsertInvite(randomCode(), label, Number(limit));
      console.log("新口令：", row?.code, row?.label, `${row?.dailyLimit} 次/天`);
      break;
    }
    case "off":
    case "on": {
      const [code] = rest;
      if (!code) throw new Error(`用法：${cmd} <CODE>`);
      await setInviteActive(code, cmd === "on");
      console.log(`${normalizeCode(code)} 已${cmd === "on" ? "启用" : "停用"}`);
      break;
    }
    case "usage": {
      console.table(await usageToday());
      break;
    }
    case "logs": {
      const rows = await recentLogs(Number(rest[0] ?? 20));
      console.table(rows.map((r) => ({ ...r, question: r.question.slice(0, 40) })));
      break;
    }
    default:
      console.log(`用法：invite <list|add|gen|off|on|usage|logs>`);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2))
  .then(() => process.exit())
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
