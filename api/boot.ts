import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { clientIp, createContext } from "./context";
import { env } from "./lib/env";
import { askInput } from "./ask";
import { AskError, answerQuestion } from "./service";
import { getCorePrompt, getIndex } from "./lib/knowledge";

const app = new Hono<{ Bindings: HttpBindings }>();

const socketIp = (c: { env?: HttpBindings }) => c.env?.incoming?.socket?.remoteAddress ?? "unknown";

app.use(bodyLimit({ maxSize: 64 * 1024 }));

app.use("/api/trpc/*", async (c) => {
  const ip = clientIp(c.req.raw.headers, socketIp(c));
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (opts) => createContext(opts, ip),
  });
});

// 流式问答：SSE。事件：sources / delta / done / error
app.post("/api/ask/stream", async (c) => {
  const ip = clientIp(c.req.raw.headers, socketIp(c));
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是 JSON" }, 400);
  }
  const parsed = askInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const input = parsed.data;

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      const result = await answerQuestion({
        ...input,
        ip,
        signal: abort.signal,
        onSources: (sources) => void stream.writeSSE({ event: "sources", data: JSON.stringify(sources) }),
        onDelta: (text) => void stream.writeSSE({ event: "delta", data: JSON.stringify(text) }),
      });
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ usedToday: result.usedToday, dailyLimit: result.dailyLimit }),
      });
    } catch (e) {
      const err = e instanceof AskError ? e : new AskError("INTERNAL_SERVER_ERROR", "服务出错，请稍后再试");
      if (!(e instanceof AskError)) console.error("[stream]", e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code: err.code, message: err.message }) });
    }
  });
});

app.get("/api/health", (c) => c.json({ ok: true, chunks: getIndex().chunks.length }));
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // 启动就把知识库索引和系统提示词建好，首个请求不用等
  getIndex();
  getCorePrompt();

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
