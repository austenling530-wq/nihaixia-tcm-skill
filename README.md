# 倪海厦Skill · 经方中医AI（落地页 + 口令保护问答）

手机端落地页，介绍开源项目 [jangviktor-web/nihaixia](https://github.com/jangviktor-web/nihaixia)（倪海厦经方中医 Agent Skill），
并提供一个**口令保护、每日限次**的在线问答演示。问答不是裸调模型：每个问题先在 skill 的知识库里检索
（伤寒论 / 金匮要略 / 黄帝内经 / 神农本草经 / 1257+243 医案 / 速查表），把命中的段落连同 skill 的角色规则一起交给模型，
回答末尾可展开查看引用了知识库哪些段落。

仅用于私域推广与学习交流，不上应用商店。

## 技术栈

- 前端：Vite + React 19 + Tailwind（shadcn 主题），`react-markdown` 渲染回答
- 后端：Hono + tRPC，问答走 SSE 流式（`POST /api/ask/stream`）
- 数据库：MySQL（Drizzle ORM），两张表：`invite_codes` 口令、`chat_logs` 问答记录
- 模型：任何 OpenAI 兼容端点，默认中转站 `https://api.90087.cn/v1`
- 知识库：`knowledge/` 目录，来自上游仓库 v2.3.1，MulanPSL-2.0；启动时切块建索引（BM25 + 中文二元组），全内存，不依赖向量库

## 目录

```
api/               后端
  boot.ts          入口：tRPC + SSE 路由 + 静态文件
  service.ts       问答流程：口令校验 → 限流 → 检索 → 调模型 → 记日志
  ai.ts            模型客户端（流式/非流式、超时、错误归类）
  lib/knowledge.ts 知识库切块、索引、检索、系统提示词拼装
  lib/ratelimit.ts 进程内限流
db/schema.ts       表结构；db/migrations/ 迁移 SQL（已提交）
knowledge/         上游知识库（勿手改，升级时整体替换）
scripts/invite.ts  口令管理命令行
src/pages/         Home 落地页、Ask 问答页
```

## 本地开发

```bash
npm ci
cp .env.example .env      # 填 DATABASE_URL / APP_SECRET / AI_API_KEY
npm run db:migrate        # 建表
npm run build && npm run db:seed   # 生成第一个口令（INVITE_CODE 不设则随机）
npm run dev               # http://localhost:3000
```

## 部署（裸机 Node 20 + nginx）

```bash
npm ci && npm run build
npm run db:migrate
NODE_ENV=production node dist/boot.js        # 或交给 pm2/systemd，记得 TZ=Asia/Shanghai
```

nginx 反代时要透传 `X-Forwarded-For`（限流按 IP），并关闭 SSE 缓冲：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;
  proxy_read_timeout 180s;
}
```

也可以用 Dockerfile 打镜像。

## 口令管理

```bash
node dist/invite.js list                 # 全部口令
node dist/invite.js add VIP2026 老客户群 30   # 新增/更新，每天 30 次
node dist/invite.js gen 抖音评论区 10       # 随机生成
node dist/invite.js off VIP2026           # 停用（持有令牌的人下一问即失效）
node dist/invite.js usage                 # 今天各口令用量
node dist/invite.js logs 50               # 最近 50 条提问
```

## 防滥用

- 口令校验：同一 IP 每分钟 20 次；15 分钟内错 6 次锁 15 分钟
- 提问：同一口令每分钟 6 次、每天 `daily_limit` 次（按北京时间计日）；同一 IP 每分钟 10 次；同一口令同时只答一个问题
- 访问令牌 HMAC 签名，7 天有效，口令停用后立即失效
- 请求体上限 64KB，问题上限 500 字，模型调用 120 秒超时
- 模型 Key 只在服务端；上游错误只回给用户一句归类后的提示，细节进服务端日志

## 环境变量

见 `.env.example`。`AI_PROMPT_PROFILE=full` 时系统提示词约 3 万字（skill 的完整角色规则 + 表达方式全文），
最像倪师；`lite` 约 1 万字，便宜一半以上但口吻会弱一些。

## 升级知识库

上游发新版后，把仓库里的 `SKILL.md`、`expression_style.md`、`modules/`、`cases/`、`references/`、`CHANGELOG.md`
整体覆盖到 `knowledge/`，跑一遍 `npm test` 看检索用例还过不过，重启即可。
