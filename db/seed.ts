// 初始化第一个口令。口令从环境变量 INVITE_CODE 取，没设就随机生成并打印出来。
import { upsertInvite } from "../api/queries/invites";
import { randomCode } from "../scripts/invite";

async function seed() {
  const code = process.env.INVITE_CODE?.trim() || randomCode();
  const row = await upsertInvite(code, process.env.INVITE_LABEL ?? "默认分享口令", Number(process.env.INVITE_LIMIT ?? 20));
  console.log(`默认口令：${row?.code}（${row?.dailyLimit} 次/天）`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
