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
import { z } from "zod";
import { verifyToken } from "./token";
import { findInviteById } from "./queries/invites";
import { SlidingWindow } from "./lib/ratelimit";
import { TtsConfigError, TtsUpstreamError, synthesize, ttsEnabled } from "./tts";

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

// 前端功能开关
app.get("/api/config", (c) => c.json({ tts: ttsEnabled() }));

// 语音播报：把一段回答合成 mp3。持令牌、按口令与 IP 限速。
const ttsInput = z.object({ token: z.string().min(10).max(512), text: z.string().trim().min(2).max(6000) });
const ttsPerCode = new SlidingWindow(8, 60_000);
const ttsPerIp = new SlidingWindow(12, 60_000);
app.post("/api/tts", async (c) => {
  const ip = clientIp(c.req.raw.headers, socketIp(c));
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是 JSON" }, 400);
  }
  const parsed = ttsInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  const codeId = verifyToken(parsed.data.token);
  if (!codeId) return c.json({ error: "访问令牌已失效，请重新输入口令" }, 401);
  const invite = await findInviteById(codeId);
  if (!invite || !invite.active) return c.json({ error: "该口令已被停用" }, 403);
  if (!ttsPerIp.hit(ip).ok || !ttsPerCode.hit(String(codeId)).ok) {
    return c.json({ error: "播报太频繁，请稍后再试" }, 429);
  }
  const t0 = Date.now();
  try {
    const r = await synthesize(parsed.data.text, AbortSignal.timeout(90_000));
    console.log(`[tts] code=${codeId} chars=${r.chars} bytes=${r.audio.length} cached=${r.cached} ${Date.now() - t0}ms`);
    return new Response(new Uint8Array(r.audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(r.audio.length),
        "Cache-Control": "private, max-age=86400",
        "X-TTS-Cached": r.cached ? "1" : "0",
      },
    });
  } catch (e) {
    if (e instanceof TtsConfigError) return c.json({ error: "站点尚未配置语音服务" }, 503);
    if (e instanceof TtsUpstreamError) {
      console.warn("[tts] upstream", e.message);
      return c.json({ error: `语音服务暂时不可用：${e.message}` }, 502);
    }
    console.error("[tts]", e);
    return c.json({ error: "语音合成出错" }, 500);
  }
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
