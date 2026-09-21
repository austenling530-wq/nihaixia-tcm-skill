import { Link } from "react-router";
import {
  BookOpen,
  ScrollText,
  Landmark,
  Leaf,
  MessageCircle,
  Github,
  Terminal,
  ShieldCheck,
  Layers,
  Star,
} from "lucide-react";

const stats = [
  { value: "2,452", label: "页讲义" },
  { value: "1,257", label: "结构化医案" },
  { value: "374", label: "味本草" },
  { value: "129", label: "条伤寒论" },
];

const books = [
  {
    icon: ScrollText,
    name: "伤寒论",
    desc: "129 条完整蒸馏，六经辨证核心，从条文到经方选药一步到位。",
    tag: "129 条",
  },
  {
    icon: BookOpen,
    name: "金匮要略",
    desc: "23 篇脏腑杂病辨证体系，经方加减化裁的临床手册。",
    tag: "23 篇",
  },
  {
    icon: Landmark,
    name: "黄帝内经",
    desc: "72 篇完整蒸馏，中医基础理论核心，脏腑经络一站式查询。",
    tag: "72 篇",
  },
  {
    icon: Leaf,
    name: "神农本草经",
    desc: "374 种本草，上药 137、中药 110、下药 127，性味归经全收录。",
    tag: "374 种",
  },
];

const UPSTREAM = "https://github.com/jangviktor-web/nihaixia";

const badges = [
  { icon: Star, text: "开源项目 v2.3.1" },
  { icon: Layers, text: "支持多个 Agent 运行时" },
  { icon: ShieldCheck, text: "MulanPSL-2.0 开源协议" },
  { icon: Terminal, text: "Agent Skills 标准" },
];

const runtimes = ["Claude Code", "OpenClaw", "SkillHub", "Kimi CLI", "Cursor", "腾讯 ima"];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f6f1e6] text-[#2b2320] antialiased">
      <div className="mx-auto max-w-md">
      {/* Hero */}
      <header className="px-6 pt-14 pb-10 text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-1.5 rounded-full border border-[#2b2320]/15 bg-white/60 px-3 py-1 text-xs text-[#2b2320]/70">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Claude Code · OpenClaw · SkillHub
        </div>
        <h1 className="mx-auto max-w-md text-4xl font-black leading-tight tracking-tight">
          两千年中医智慧
          <br />
          <span className="text-[#b03a2e]">一个命令激活</span>
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#2b2320]/70">
          将经方大师倪海厦的完整中医思维体系注入 AI Agent。
          六经辨证、经方选药、849 个临床医案——像倪师一样思考。
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Link
            to="/ask"
            className="rounded-xl bg-[#b03a2e] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#b03a2e]/25 active:scale-95 transition"
          >
            立即体验问答
          </Link>
          <a
            href={UPSTREAM}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#2b2320]/20 bg-white/70 px-5 py-3 text-sm font-semibold active:scale-95 transition"
          >
            <Github className="h-4 w-4" /> GitHub
          </a>
        </div>
      </header>

      {/* Stats */}
      <section className="mx-5 rounded-2xl border border-[#2b2320]/10 bg-white/70 px-2 py-6 shadow-sm">
        <div className="grid grid-cols-4 divide-x divide-[#2b2320]/10">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-xl font-black text-[#b03a2e]">{s.value}</div>
              <div className="mt-1 text-[11px] text-[#2b2320]/60">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Books matrix */}
      <section className="px-5 pt-12">
        <h2 className="text-center text-2xl font-black">四部经典，全部蒸馏</h2>
        <p className="mt-2 text-center text-xs text-[#2b2320]/60">
          另有 243 例叙事医案 · 3.5M 字精萃 · 天纪命理
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3">
          {books.map((b) => (
            <div
              key={b.name}
              className="flex items-start gap-4 rounded-2xl border border-[#2b2320]/10 bg-white/80 p-4 shadow-sm"
            >
              <div className="rounded-xl bg-[#b03a2e]/10 p-2.5 text-[#b03a2e]">
                <b.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">{b.name}</h3>
                  <span className="rounded-full bg-[#b03a2e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b03a2e]">
                    {b.tag}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[#2b2320]/65">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Demo dialogue */}
      <section className="px-5 pt-12">
        <h2 className="text-center text-2xl font-black">像倪师一样回答</h2>
        <div className="mt-6 space-y-3">
          <div className="ml-10 rounded-2xl rounded-tr-sm bg-[#2b2320] px-4 py-3 text-sm text-[#f6f1e6]">
            我吹冷风后发烧 38.5°C，怕冷不出汗，浑身酸痛，喉咙不痛，这是什么证？用什么方？
          </div>
          <div className="mr-6 rounded-2xl rounded-tl-sm border border-[#2b2320]/10 bg-white px-4 py-3 text-sm leading-6 shadow-sm">
            <p>
              你这证，清清楚楚是<strong className="text-[#b03a2e]">太阳伤寒表实证</strong>，方子就是
              <strong className="text-[#b03a2e]">麻黄汤</strong>，跑不掉的。
            </p>
            <div className="mt-2 rounded-lg bg-[#f6f1e6] p-3 text-xs leading-5 text-[#2b2320]/75">
              📜 伤寒论·第35条：「太阳病，头痛发热，身疼腰痛，骨节疼痛，恶风无汗而喘者，麻黄汤主之。」
              <br />
              原方：麻黄（三两） 桂枝（二两） 甘草（一两·炙） 杏仁（七十个）
            </div>
            <p className="mt-2 text-[11px] text-amber-700">
              ⚠️ 仅作经方学习，非医疗处方。须执业中医师摸脉辨证后用药。
            </p>
          </div>
        </div>
        <div className="mt-5 text-center">
          <Link
            to="/ask"
            className="inline-flex items-center gap-2 rounded-xl bg-[#2b2320] px-6 py-3 text-sm font-bold text-[#f6f1e6] active:scale-95 transition"
          >
            <MessageCircle className="h-4 w-4" /> 输入口令，亲自问一句
          </Link>
          <p className="mt-2 text-[11px] text-[#2b2320]/50">
            在线问答由 AI 实时检索上面这套知识库生成，每条回答可查看引用了哪些段落
          </p>
        </div>
      </section>

      {/* Badges & runtimes */}
      <section className="px-5 pt-12">
        <div className="grid grid-cols-2 gap-2.5">
          {badges.map((b) => (
            <div
              key={b.text}
              className="flex items-center gap-2 rounded-xl border border-[#2b2320]/10 bg-white/70 px-3 py-2.5 text-xs font-semibold"
            >
              <b.icon className="h-4 w-4 shrink-0 text-[#b03a2e]" />
              {b.text}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {runtimes.map((r) => (
            <span
              key={r}
              className="rounded-full border border-[#2b2320]/15 px-3 py-1 text-[11px] text-[#2b2320]/70"
            >
              {r}
            </span>
          ))}
        </div>
      </section>

      {/* Install */}
      <section className="mx-5 mt-12 rounded-2xl bg-[#2b2320] p-6 text-[#f6f1e6]">
        <h2 className="text-xl font-black">一个命令，装进你的 Agent</h2>
        <div className="mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 font-mono text-xs leading-6 text-emerald-300">
          <div className="whitespace-nowrap">openclaw skills install @jangviktor-web/nihaixia</div>
          <div className="mt-1 whitespace-nowrap text-emerald-300/70">git clone {UPSTREAM}.git</div>
        </div>
        <p className="mt-3 text-xs leading-5 text-[#f6f1e6]/60">
          Claude Code、OpenClaw、SkillHub、腾讯 ima 等运行时均可安装，详见项目 README。
        </p>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 text-center text-[11px] leading-5 text-[#2b2320]/50">
        <p>本站为开源项目 nihaixia skill 的非官方介绍与学习交流页，与倪海厦先生及其家属、汉唐中医无隶属关系。</p>
        <p className="mt-1">内容不构成任何医疗建议 · 问答功能仅供经方学习演示 · 知识库遵循 MulanPSL-2.0</p>
      </footer>
      </div>
    </div>
  );
}
