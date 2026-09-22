// 语音播报：豆包（火山引擎）语音合成 HTTP 接口
//
// 环境变量：
//   TTS_APP_ID        火山引擎语音技术 → 应用管理 里的 APP ID
//   TTS_ACCESS_TOKEN  同一页面的 Access Token
//   TTS_VOICE         音色，默认 zh_male_qingcang_mars_bigtts（擎苍：沉稳男中音，讲课感）
//   TTS_CLUSTER       默认 volcano_tts（大模型音色统一用这个集群）
//   TTS_SPEED         语速倍率，默认 1.0
//   TTS_CACHE_DIR     mp3 缓存目录，默认 .cache/tts；同一段回答只合成一次
//
// 单次请求文本上限 1024 字节（约 300 个汉字），所以长回答按句切段、逐段合成、拼接 mp3。
// Markdown 先转成"能念出来"的纯文本：表格拆成句子、去掉符号和表情。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
export const CHUNK_MAX_CHARS = 280;

export class TtsConfigError extends Error {}
export class TtsUpstreamError extends Error {}

export function ttsEnabled(): boolean {
  return Boolean(process.env.TTS_APP_ID && process.env.TTS_ACCESS_TOKEN);
}

function cfg() {
  const appid = process.env.TTS_APP_ID ?? "";
  const token = process.env.TTS_ACCESS_TOKEN ?? "";
  if (!appid || !token) throw new TtsConfigError("TTS_APP_ID / TTS_ACCESS_TOKEN 未配置");
  return {
    appid,
    token,
    voice: process.env.TTS_VOICE || "zh_male_qingcang_mars_bigtts",
    cluster: process.env.TTS_CLUSTER || "volcano_tts",
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

async function synthesizeChunk(text: string, signal?: AbortSignal): Promise<Buffer> {
  const c = cfg();
  const body = {
    app: { appid: c.appid, token: c.token, cluster: c.cluster },
    user: { uid: "nihaixia-web" },
    audio: { voice_type: c.voice, encoding: "mp3", speed_ratio: c.speed, rate: 24000 },
    request: { reqid: crypto.randomUUID(), text, text_type: "plain", operation: "query" },
  };
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer;${c.token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new TtsUpstreamError(`HTTP ${resp.status}`);
  const j = (await resp.json()) as { code?: number; message?: string; data?: string };
  if (j.code !== 3000 || !j.data) throw new TtsUpstreamError(`${j.code ?? "?"} ${j.message ?? "无音频返回"}`);
  return Buffer.from(j.data, "base64");
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
  // 两段并发，兼顾速度和上游 QPS 限制
  for (let i = 0; i < chunks.length; i += 2) {
    const batch = chunks.slice(i, i + 2).map((t) => synthesizeChunk(t, signal));
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
