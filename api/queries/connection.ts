import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";

let instance: MySql2Database<typeof schema>;

export function getDb() {
  if (!instance) {
    const pool = mysql.createPool({ uri: env.databaseUrl, connectionLimit: 8 });
    // Drizzle 读写 timestamp 一律按 UTC，这里把会话时区也钉在 UTC，
    // 否则 NOW() 写进去的是服务器本地时间，按天限流会错 8 小时
    pool.on("connection", (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
    instance = drizzle(pool, { mode: "default", schema });
  }
  return instance;
}
