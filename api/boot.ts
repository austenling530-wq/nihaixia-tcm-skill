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
import { TtsConfigError, TtsUpstreamError, prepareSpeech, ttsEnabled, waitChunkFile } from "./tts";
import fs from "node:fs";

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
        data: JSON.stringify({
          usedToday: result.usedToday,
          dailyLimit: result.dailyLimit,
          usedTotal: result.usedTotal,
          totalLimit: result.totalLimit,
        }),
      });
    } catch (e) {
      const err = e instanceof AskError ? e : new AskError("INTERNAL_SERVER_ERROR", "服务出错，请稍后再试");
      if (!(e instanceof AskError)) console.error("[stream]", e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code: err.code, message: err.message }) });
    }
  });
});

// 前端功能开关
app.get("/api/config", (c) => c.json({ tts: ttsEnabled(), kefuNote: process.env.KEFU_NOTE || "" }));

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
  try {
    const r = prepareSpeech(parsed.data.text);
    console.log(`[tts] code=${codeId} chars=${r.chars} parts=${r.keys.length}`);
    // 立刻返回各段地址；每段 GET 会等到该段合成完再给
    return c.json({ parts: r.keys.map((k) => `/api/tts/${k}.mp3`), chars: r.chars });
  } catch (e) {
    if (e instanceof TtsConfigError) return c.json({ error: "站点尚未配置语音服务" }, 503);
    if (e instanceof TtsUpstreamError) return c.json({ error: e.message }, 502);
    console.error("[tts]", e);
    return c.json({ error: "语音合成出错" }, 500);
  }
});

// 播放某一段音频（key 为不可猜测的 sha1；段还在合成时会等它；支持 Range，iOS Safari 需要）
app.get("/api/tts/:file", async (c) => {
  const key = c.req.param("file").replace(/\.mp3$/, "");
  const file = await waitChunkFile(key);
  if (!file) return c.json({ error: "音频不存在或已过期，请重新点击播放" }, 404);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return c.json({ error: "音频已过期，请重新点击播放" }, 404);
  }
  const size = st.size;
  const base = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=604800",
  };
  const range = c.req.header("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const buf = await readSlice(file, start, end);
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const buf = await fs.promises.readFile(file);
  return new Response(new Uint8Array(buf), { status: 200, headers: { ...base, "Content-Length": String(size) } });
});

async function readSlice(file: string, start: number, end: number): Promise<Buffer> {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(end - start + 1);
    await fh.read(buf, 0, buf.length, start);
    return buf;
  } finally {
    await fh.close();
  }
}

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
