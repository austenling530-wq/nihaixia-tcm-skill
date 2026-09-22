import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Loader2, Send, KeyRound, RotateCcw, Volume2, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "@/providers/trpc";

type Msg = { role: "user" | "ai"; text: string; sources?: string[]; error?: boolean };

const TOKEN_KEY = "nh_token";
const MSGS_KEY = "nh_msgs";
const MAX_SAVED = 40;

function loadMsgs(): Msg[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

type StreamEvent =
  | { event: "sources"; data: string[] }
  | { event: "delta"; data: string }
  | { event: "done"; data: { usedToday: number; dailyLimit: number } }
  | { event: "error"; data: { code: string; message: string } };

/** 读 SSE 流，逐个事件回调 */
async function readSSE(resp: Response, onEvent: (e: StreamEvent) => void) {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let data = "";
  const dispatch = () => {
    if (data) {
      try {
        onEvent({ event, data: JSON.parse(data) } as StreamEvent);
      } catch {
        /* 跳过坏行 */
      }
    }
    event = "message";
    data = "";
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") dispatch();
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
  }
  dispatch();
}

export default function Ask() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [ttsOn, setTtsOn] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((j: { tts?: boolean }) => setTtsOn(Boolean(j.tts)))
      .catch(() => {});
  }, []);
  const [code, setCode] = useState("");
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(""); // 正在生成的回答
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MSGS_KEY, JSON.stringify(msgs.slice(-MAX_SAVED)));
    } catch {
      /* 存不下就算了 */
    }
  }, [msgs]);

  useEffect(() => {
    if (!pending) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  const verify = trpc.ask.verify.useMutation({
    onSuccess: (d) => {
      localStorage.setItem(TOKEN_KEY, d.token);
      setToken(d.token);
      setQuota({ used: d.usedToday, limit: d.dailyLimit });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, streaming, pending]);

  const send = async () => {
    const q = input.trim();
    if (!q || pending) return;
    const history = msgs
      .filter((m) => !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    setStreaming("");
    setElapsed(0);
    let text = "";
    let sources: string[] = [];
    let failed: { code: string; message: string } | null = null;
    try {
      const resp = await fetch("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, question: q, history }),
      });
      if (!resp.ok || !resp.body) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        failed = { code: String(resp.status), message: j.error ?? `请求失败（${resp.status}）` };
      } else {
        await readSSE(resp, (e) => {
          if (e.event === "sources") sources = e.data;
          else if (e.event === "delta") {
            text += e.data;
            setStreaming(text);
          } else if (e.event === "done") setQuota({ used: e.data.usedToday, limit: e.data.dailyLimit });
          else if (e.event === "error") failed = e.data;
        });
        if (!failed && !text) failed = { code: "EMPTY", message: "没有收到回答，请重试" };
      }
    } catch (e) {
      failed = { code: "NETWORK", message: `网络出错：${(e as Error).message}` };
    }
    setPending(false);
    setStreaming("");
    if (failed) {
      const f: { code: string; message: string } = failed;
      if (f.code === "UNAUTHORIZED") {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
      }
      // 已经生成了一部分就保留，错误另起一条
      setMsgs((m) => [
        ...m,
        ...(text ? [{ role: "ai" as const, text, sources }] : []),
        { role: "ai", text: `⚠️ ${f.message}`, error: true },
      ]);
      return;
    }
    setMsgs((m) => [...m, { role: "ai", text, sources }]);
  };

  const reset = () => {
    if (pending) return;
    setMsgs([]);
  };

  // ── 口令门 ──────────────────────────────
  if (!token) {
    return (
      <div className="flex min-h-screen flex-col bg-[#f6f1e6] text-[#2b2320]">
        <GateHeader />
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <div className="rounded-2xl bg-[#b03a2e]/10 p-4 text-[#b03a2e]">
            <KeyRound className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-black">输入访问口令</h1>
          <p className="mt-2 text-center text-xs leading-5 text-[#2b2320]/60">
            这是私域分享的经方学习问答演示。
            <br />
            请向分享者索取口令（每个口令每天限次使用）。
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && verify.mutate({ code })}
            placeholder="输入口令"
            autoCapitalize="characters"
            autoComplete="off"
            className="mt-6 w-full max-w-xs rounded-xl border border-[#2b2320]/20 bg-white px-4 py-3 text-center font-mono text-lg tracking-widest outline-none focus:border-[#b03a2e]"
          />
          {error && <p className="mt-3 max-w-xs text-center text-xs text-[#b03a2e]">{error}</p>}
          <button
            onClick={() => verify.mutate({ code })}
            disabled={!code.trim() || verify.isPending}
            className="mt-4 w-full max-w-xs rounded-xl bg-[#b03a2e] py-3 text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition"
          >
            {verify.isPending ? "验证中…" : "进入问答"}
          </button>
        </div>
      </div>
    );
  }

  // ── 对话页 ──────────────────────────────
  return (
    <div className="flex h-dvh flex-col bg-[#f6f1e6] text-[#2b2320]">
      <GateHeader quota={quota} onReset={msgs.length ? reset : undefined} />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {msgs.length === 0 && !pending && (
          <div className="mt-10 text-center">
            <p className="text-lg font-black">倪师在线（AI 演示）</p>
            <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#2b2320]/60">
              试试问：「吹冷风后发烧 38.5°C、怕冷不出汗、浑身酸痛，是什么证？」
            </p>
            <p className="mx-auto mt-3 max-w-xs text-[11px] leading-5 text-[#2b2320]/45">
              回答由 AI 根据倪海厦Skill 知识库（伤寒论、金匮要略、黄帝内经、神农本草经、医案）检索生成，会保留问答记录用于限流。
            </p>
          </div>
        )}
        {msgs.map((m, i) => (
          <Bubble key={i} msg={m} token={token} tts={ttsOn} />
        ))}
        {pending && (
          <div className="rounded-2xl border border-[#2b2320]/10 bg-white px-4 py-3 text-sm leading-6 shadow-sm">
            {streaming ? (
              <Markdown text={streaming} />
            ) : (
              <span className="flex items-center gap-2 text-[#2b2320]/60">
                <Loader2 className="h-4 w-4 animate-spin" /> 倪师翻书辨证中…{elapsed > 3 ? ` ${elapsed}s` : ""}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#2b2320]/10 bg-white/80 p-3 backdrop-blur">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={500}
            placeholder="描述症状，问倪师一句…"
            className="max-h-28 flex-1 resize-none rounded-xl border border-[#2b2320]/15 bg-white px-3 py-2.5 text-base outline-none focus:border-[#b03a2e]"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || pending}
            className="rounded-xl bg-[#b03a2e] p-2.5 text-white disabled:opacity-50 active:scale-95 transition"
            aria-label="发送"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-[#2b2320]/45">
          AI 生成内容，仅作经方学习交流，不构成医疗处方；如有不适请找执业中医师面诊
        </p>
      </div>
    </div>
  );
}

function Bubble({ msg, token, tts }: { msg: Msg; token: string; tts: boolean }) {
  const [showSources, setShowSources] = useState(false);
  if (msg.role === "user") {
    return (
      <div className="whitespace-pre-wrap rounded-2xl bg-[#2b2320] px-4 py-3 text-sm leading-6 text-[#f6f1e6]">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-[#f6f1e6]/50">问</div>
        {msg.text}
      </div>
    );
  }
  if (msg.error) {
    return (
      <div className="rounded-2xl border border-[#b03a2e]/30 bg-[#b03a2e]/5 px-4 py-3 text-sm leading-6 text-[#b03a2e]">
        {msg.text}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[#2b2320]/10 bg-white px-4 py-3 text-sm leading-6 shadow-sm">
      <Markdown text={msg.text} />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#2b2320]/10 pt-2 text-[10px] text-[#2b2320]/45">
        {tts && <SpeakButton text={msg.text} token={token} />}
        <span>AI 生成</span>
        {msg.sources && msg.sources.length > 0 && (
          <button onClick={() => setShowSources((v) => !v)} className="underline decoration-dotted">
            参考知识库 {msg.sources.length} 处{showSources ? " ▴" : " ▾"}
          </button>
        )}
      </div>
      {showSources && msg.sources && (
        <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-[#2b2320]/55">
          {msg.sources.map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 一小段无声 wav：在用户点击的同一事件里先 play 一下，iOS Safari 才允许之后异步换 src 再播放
const SILENT_WAV =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

function SpeakButton({ text, token }: { text: string; token: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [err, setErr] = useState("");
  const [pos, setPos] = useState<[number, number] | null>(null); // 第几段/共几段
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const partsRef = useRef<string[]>([]);
  const idxRef = useRef(0);
  const runRef = useRef(0); // 停止/重播时让旧的播放链失效

  useEffect(() => () => audioRef.current?.pause(), []);

  const stop = () => {
    runRef.current++;
    audioRef.current?.pause();
    setState("idle");
    setPos(null);
  };

  // 预热下一段：让服务器把它合成好并进浏览器缓存，切换时几乎无缝
  const prefetch = (i: number) => {
    const url = partsRef.current[i];
    if (url) void fetch(url).catch(() => {});
  };

  const playFrom = async (i: number, run: number) => {
    const a = audioRef.current!;
    const parts = partsRef.current;
    if (run !== runRef.current) return;
    if (i >= parts.length) {
      setState("idle");
      setPos(null);
      return;
    }
    idxRef.current = i;
    setPos([i + 1, parts.length]);
    // 先确认这一段已合成（GET 会等到它就绪），同时让它进缓存
    const r = await fetch(parts[i]);
    if (run !== runRef.current) return;
    if (!r.ok) throw new Error(i === 0 ? "语音合成失败，请重试" : "后面一段合成失败");
    a.onended = () => void playFrom(i + 1, run).catch(fail);
    a.src = parts[i];
    await a.play();
    if (run !== runRef.current) return;
    setState("playing");
    prefetch(i + 1);
  };

  const fail = (e: unknown) => {
    setErr((e as Error).message || "播放失败");
    setState("error");
    setPos(null);
  };

  const play = async () => {
    if (state === "playing") return stop();
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    const run = ++runRef.current;
    // 在用户点击的同一事件里先播一段无声，iOS Safari 才允许之后换 src 再播
    a.onerror = null;
    a.src = SILENT_WAV;
    void a.play().catch(() => {});
    setState("loading");
    setErr("");
    try {
      if (!partsRef.current.length) {
        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, text }),
        });
        const j = (await resp.json().catch(() => ({}))) as { parts?: string[]; error?: string };
        if (!resp.ok || !j.parts?.length) throw new Error(j.error ?? `请求失败（${resp.status}）`);
        partsRef.current = j.parts;
      }
      a.onerror = () => fail(new Error("播放失败，再点一次"));
      await playFrom(0, run);
    } catch (e) {
      fail(e);
    }
  };

  const label =
    state === "loading" ? (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 合成中…
      </>
    ) : state === "playing" ? (
      <>
        <Square className="h-3 w-3" /> 停止{pos && pos[1] > 1 ? ` ${pos[0]}/${pos[1]}` : ""}
      </>
    ) : state === "error" ? (
      <>
        <Volume2 className="h-3.5 w-3.5" /> {err || "重试"}
      </>
    ) : (
      <>
        <Volume2 className="h-3.5 w-3.5" /> 听语音
      </>
    );

  return (
    <button
      onClick={() => void play()}
      disabled={state === "loading"}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
        state === "playing"
          ? "border-[#b03a2e] bg-[#b03a2e] text-white"
          : "border-[#b03a2e]/40 bg-[#b03a2e]/5 text-[#b03a2e]"
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _n, ...props }) => (
            <div className="tbl">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function GateHeader({
  quota,
  onReset,
}: {
  quota?: { used: number; limit: number } | null;
  onReset?: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[#2b2320]/10 bg-[#f6f1e6]/90 px-4 py-3 backdrop-blur">
      <Link to="/" className="flex items-center gap-1 text-xs font-semibold text-[#2b2320]/70">
        <ArrowLeft className="h-4 w-4" /> 返回介绍
      </Link>
      <span className="text-sm font-black">经方问答</span>
      <span className="flex items-center gap-2 text-[11px] text-[#2b2320]/50">
        {quota ? `今日 ${quota.used}/${quota.limit}` : "私域口令"}
        {onReset && (
          <button onClick={onReset} className="rounded-md p-1 hover:bg-[#2b2320]/5" aria-label="新对话" title="新对话">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </header>
  );
}
