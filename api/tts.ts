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

/** 按句号/问号/换行切段，每段不超过 max 字 */
export function splitForTts(text: string, max = CHUNK_MAX_CHARS): string[] {
  const sentences = text.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (let s of sentences) {
    while (s.length > max) {
      // 极长一句：按逗号硬切
      const cut = Math.max(s.lastIndexOf("，", max), s.lastIndexOf(",", max), Math.floor(max / 2));
      if (cur) chunks.push(cur), (cur = "");
      chunks.push(s.slice(0, cut + 1));
      s = s.slice(cut + 1);
    }
    if ((cur + s).length > max) {
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

async function synthesizeChunk(text: string, signal?: AbortSignal): Promise<Buffer> {
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

/** 整段回答 → mp3（带磁盘缓存） */
export async function synthesize(markdown: string, signal?: AbortSignal): Promise<{ audio: Buffer; cached: boolean; chars: number }> {
  const c = cfg();
  const text = speakableText(markdown);
  if (!text) throw new TtsUpstreamError("没有可朗读的内容");
  const key = cacheKey(text, c.voice, c.speed);
  const file = path.join(c.cacheDir, `${key}.mp3`);
  try {
    const buf = await fs.promises.readFile(file);
    return { audio: buf, cached: true, chars: text.length };
  } catch {
    /* miss */
  }
  const chunks = splitForTts(text);
  const parts: Buffer[] = [];
  // 四段并发（TTS_CONCURRENCY 可调），兼顾速度和上游并发限制
  const par = Math.max(1, Number(process.env.TTS_CONCURRENCY || "4") || 4);
  for (let i = 0; i < chunks.length; i += par) {
    const batch = chunks.slice(i, i + par).map((t) => synthesizeChunk(t, signal));
    parts.push(...(await Promise.all(batch)));
  }
  const audio = Buffer.concat(parts);
  try {
    await fs.promises.mkdir(c.cacheDir, { recursive: true });
    await fs.promises.writeFile(file, audio);
  } catch (e) {
    console.warn("[tts] cache write failed", e);
  }
  return { audio, cached: false, chars: text.length };
}
