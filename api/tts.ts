// 语音播报：豆包（火山引擎）语音合成 —— 新版控制台 API Key + V3 单向流式 HTTP 接口
//
// 环境变量：
//   TTS_API_KEY       火山引擎语音控制台 → API Key 管理 里创建的 Key（UUID 样式；不是方舟的 ark- 开头那种）
//   TTS_VOICE         音色，默认 zh_male_qingcang_mars_bigtts（擎苍：沉稳男中音，讲课感）
//   TTS_RESOURCE_ID   默认 seed-tts-1.0；用 2.0 音色（*_uranus_bigtts）时填 seed-tts-2.0
//   TTS_SPEED         语速倍率，默认 1.0
//   TTS_CACHE_DIR     mp3 缓存目录，默认 .cache/tts；同一段回答只合成一次
//
// 长回答按句切段、逐段合成、拼接 mp3，既控制单次时长也让首段快些出来。
// Markdown 先转成"能念出来"的纯文本：表格拆成句子、去掉符号和表情。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
export const CHUNK_MAX_CHARS = 280;

export class TtsConfigError extends Error {}
export class TtsUpstreamError extends Error {}

export function ttsEnabled(): boolean {
  return Boolean(process.env.TTS_API_KEY);
}

function cfg() {
  const apiKey = process.env.TTS_API_KEY ?? "";
  if (!apiKey) throw new TtsConfigError("TTS_API_KEY 未配置");
  const voice = process.env.TTS_VOICE || "zh_male_qingcang_mars_bigtts";
  return {
    apiKey,
    voice,
    resourceId: process.env.TTS_RESOURCE_ID || (voice.includes("_uranus_") ? "seed-tts-2.0" : "seed-tts-1.0"),
    speed: Number(process.env.TTS_SPEED || "1.0") || 1.0,
    cacheDir: process.env.TTS_CACHE_DIR || path.resolve(".cache/tts"),
  };
}

/** Markdown 回答 → 适合朗读的纯文本 */
export function speakableText(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inCode = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!line) continue;
    // 表格分隔行 |---|---|
    if (/^\|?\s*:?-{2,}/.test(line) && /-\s*\|/.test(line + "|")) continue;
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .map(stripInline);
      if (cells.length) out.push(cells.join("，") + "。");
      continue;
    }
    // 免责声明段落不念（页面上已经显示）
    if (/^(>\s*)?(⚠️|⚠|警告|免责)/.test(line) || /仅用于中医学习与学术研究|不构成医疗/.test(line)) continue;
    raw = line
      .replace(/^>\s?/, "") // 引用
      .replace(/^#{1,6}\s+/, "") // 标题
      .replace(/^[-*+]\s+/, "") // 列表
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^-{3,}$/, "");
    const t = stripInline(raw);
    if (t) out.push(t);
  }
  return out
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    // 表情与杂符号
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[📜⚠️✅❌➡️→←]/g, "")
    .replace(/[|#*_>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const FIRST_CHUNK_MAX_CHARS = 60;

/** 按句号/问号/换行切段，每段不超过 max 字；首段更短（firstMax），让播放尽快开始 */
export function splitForTts(text: string, max = CHUNK_MAX_CHARS, firstMax = max): string[] {
  const sentences = text.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  const limit = () => (chunks.length === 0 ? Math.min(firstMax, max) : max);
  for (let s of sentences) {
    const max = limit();
    while (s.length > max) {
      // 极长一句：按逗号硬切
      const cut = Math.max(s.lastIndexOf("，", max), s.lastIndexOf(",", max), Math.floor(max / 2));
      if (cur) chunks.push(cur), (cur = "");
      chunks.push(s.slice(0, cut + 1));
      s = s.slice(cut + 1);
    }
    if ((cur + s).length > limit()) {
      if (cur) chunks.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 响应是若干个 JSON 对象直接拼接（可能不换行），逐个切出来 */
export function* splitJsonObjects(buf: string): Generator<string> {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        yield buf.slice(start, i + 1);
        start = -1;
      }
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 上游并发额度超限（45000292）时退避重试几次 */
async function synthesizeChunk(text: string, signal?: AbortSignal): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await synthesizeChunkOnce(text, signal);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof TtsUpstreamError ? e.message : "";
      if (!/45000292|concurrency/i.test(msg)) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function synthesizeChunkOnce(text: string, signal?: AbortSignal): Promise<Buffer> {
  const c = cfg();
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": c.apiKey,
      "X-Api-Resource-Id": c.resourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "nihaixia-web" },
      req_params: {
        text,
        speaker: c.voice,
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
          // 语速：-50~100，0 为原速；只在改过时才带，避免上游不认
          ...(c.speed !== 1 ? { speech_rate: Math.round((c.speed - 1) * 100) } : {}),
        },
      },
    }),
    signal,
  });
  if (!resp.ok) throw new TtsUpstreamError(`HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  const raw = await resp.text();
  const parts: Buffer[] = [];
  for (const obj of splitJsonObjects(raw)) {
    let j: { code?: number; message?: string; data?: string };
    try {
      j = JSON.parse(obj);
    } catch {
      continue;
    }
    if (j.data) parts.push(Buffer.from(j.data, "base64"));
    // 20000000 = 流结束标记，不是错误
    if (j.code && j.code !== 20000000) throw new TtsUpstreamError(`${j.code} ${j.message ?? ""}`.trim());
  }
  if (!parts.length) throw new TtsUpstreamError("上游没有返回音频");
  return Buffer.concat(parts);
}

function cacheKey(text: string, voice: string, speed: number): string {
  return crypto.createHash("sha1").update(`${voice}|${speed}|${text}`).digest("hex");
}

/** 缓存文件路径（key 为 40 位 sha1，用于 GET /api/tts/:key.mp3） */
export function cachedFilePath(key: string): string | null {
  if (!/^[0-9a-f]{40}$/.test(key)) return null;
  return path.join(cfg().cacheDir, `${key}.mp3`);
}

/** 上游并发闸门：试用账号只有 2 路，超了报 45000292 */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
const upstream = new Semaphore(Math.max(1, Number(process.env.TTS_CONCURRENCY || "2") || 2));

// 每段一个后台任务：key → 写好的文件路径
const chunkJobs = new Map<string, Promise<string>>();

function ensureChunk(key: string, text: string): Promise<string> {
  const file = cachedFilePath(key)!;
  let job = chunkJobs.get(key);
  if (job) return job;
  job = (async () => {
    try {
      await fs.promises.access(file);
      return file;
    } catch {
      /* not cached */
    }
    const audio = await upstream.run(() => synthesizeChunk(text, AbortSignal.timeout(60_000)));
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, audio);
    await fs.promises.rename(tmp, file);
    return file;
  })();
  chunkJobs.set(key, job);
  job.finally(() => chunkJobs.delete(key)).catch(() => {});
  return job;
}

/**
 * 规划一段回答的播报：切段、按顺序排队合成（首段最先），立刻返回各段 key。
 * 客户端拿第一段就能开播，后面的段在播放期间继续合成。
 */
export function prepareSpeech(markdown: string): { keys: string[]; chars: number; texts: string[] } {
  const c = cfg();
  const text = speakableText(markdown);
  if (!text) throw new TtsUpstreamError("没有可朗读的内容");
  const texts = splitForTts(text, CHUNK_MAX_CHARS, FIRST_CHUNK_MAX_CHARS);
  const keys = texts.map((t) => cacheKey(t, c.voice, c.speed));
  keys.forEach((k, i) => void ensureChunk(k, texts[i]).catch((e) => console.warn("[tts] chunk failed", k.slice(0, 8), e?.message ?? e)));
  return { keys, chars: text.length, texts };
}

/** 等某一段就绪：已缓存直接给；合成中就等它；都不是返回 null */
export async function waitChunkFile(key: string, timeoutMs = 75_000): Promise<string | null> {
  const file = cachedFilePath(key);
  if (!file) return null;
  const job = chunkJobs.get(key);
  if (job) {
    const timer = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    try {
      return await Promise.race([job, timer]);
    } catch {
      return null;
    }
  }
  try {
    await fs.promises.access(file);
    return file;
  } catch {
    return null;
  }
}
