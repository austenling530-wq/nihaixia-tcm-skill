import { getDb } from "../api/queries/connection";
import { inviteCodes } from "./schema";

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // 默认邀请码：NIHAIXIA，每天限 20 次问诊
  await db
    .insert(inviteCodes)
    .values({ code: "NIHAIXIA", label: "默认分享口令", dailyLimit: 20 })
    .onDuplicateKeyUpdate({ set: { label: "默认分享口令" } });

  console.log("Done. Default invite code: NIHAIXIA");
  process.exit(0); // close MySQL connection pool
}

seed();
