import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Loader2, Send, KeyRound } from "lucide-react";
import { trpc } from "@/providers/trpc";

type Msg = { role: "user" | "ai"; text: string };

const TOKEN_KEY = "nh_token";

export default function Ask() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [code, setCode] = useState("");
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const verify = trpc.ask.verify.useMutation({
    onSuccess: (d) => {
      localStorage.setItem(TOKEN_KEY, d.token);
      setToken(d.token);
      setQuota({ used: d.usedToday, limit: d.dailyLimit });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  const ask = trpc.ask.ask.useMutation({
    onSuccess: (d) => {
      setMsgs((m) => [...m, { role: "ai", text: d.answer }]);
      setQuota({ used: d.usedToday, limit: d.dailyLimit });
    },
    onError: (e) => {
      if (e.data?.code === "UNAUTHORIZED") {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
      }
      setMsgs((m) => [...m, { role: "ai", text: `⚠️ ${e.message}` }]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, ask.isPending]);

  const send = () => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    ask.mutate({ token, question: q });
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
            这是私域分享的 AI 问诊演示。
            <br />
            请向分享者索取口令（每天限次使用）。
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && verify.mutate({ code })}
            placeholder="例如 NIHAIXIA"
            className="mt-6 w-full max-w-xs rounded-xl border border-[#2b2320]/20 bg-white px-4 py-3 text-center font-mono text-lg tracking-widest outline-none focus:border-[#b03a2e]"
          />
          {error && <p className="mt-3 text-xs text-[#b03a2e]">{error}</p>}
          <button
            onClick={() => verify.mutate({ code })}
            disabled={!code.trim() || verify.isPending}
            className="mt-4 w-full max-w-xs rounded-xl bg-[#b03a2e] py-3 text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition"
          >
            {verify.isPending ? "验证中…" : "进入问诊"}
          </button>
        </div>
      </div>
    );
  }

  // ── 对话页 ──────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f1e6] text-[#2b2320]">
      <GateHeader quota={quota} />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {msgs.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-lg font-black">倪师在线（演示）</p>
            <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#2b2320]/60">
              试试问：「吹冷风后发烧 38.5°C、怕冷不出汗、浑身酸痛，是什么证？」
            </p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-10 rounded-2xl rounded-tr-sm bg-[#2b2320] px-4 py-3 text-sm leading-6 text-[#f6f1e6]">
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className="mr-6 whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-[#2b2320]/10 bg-white px-4 py-3 text-sm leading-6 shadow-sm"
            >
              {m.text}
            </div>
          ),
        )}
        {ask.isPending && (
          <div className="mr-6 flex items-center gap-2 rounded-2xl rounded-tl-sm border border-[#2b2320]/10 bg-white px-4 py-3 text-sm text-[#2b2320]/60 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> 倪师辨证中…
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
                send();
              }
            }}
            rows={1}
            placeholder="描述症状，问倪师一句…"
            className="max-h-28 flex-1 resize-none rounded-xl border border-[#2b2320]/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#b03a2e]"
          />
          <button
            onClick={send}
            disabled={!input.trim() || ask.isPending}
            className="rounded-xl bg-[#b03a2e] p-2.5 text-white disabled:opacity-50 active:scale-95 transition"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-[#2b2320]/45">
          仅作经方学习交流，不构成医疗处方；如有不适请找执业中医师面诊
        </p>
      </div>
    </div>
  );
}

function GateHeader({ quota }: { quota?: { used: number; limit: number } | null }) {
  return (
    <header className="flex items-center justify-between border-b border-[#2b2320]/10 bg-[#f6f1e6]/90 px-4 py-3 backdrop-blur">
      <Link to="/" className="flex items-center gap-1 text-xs font-semibold text-[#2b2320]/70">
        <ArrowLeft className="h-4 w-4" /> 返回介绍
      </Link>
      <span className="text-sm font-black">经方问诊</span>
      <span className="text-[11px] text-[#2b2320]/50">
        {quota ? `今日 ${quota.used}/${quota.limit}` : "私域口令"}
      </span>
    </header>
  );
}
