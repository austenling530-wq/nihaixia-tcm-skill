// OpenAI 兼容模型代理（默认走中转站）。Key 只存在服务端环境变量里，绝不下发到前端。
//
//   AI_API_KEY    必填
//   AI_BASE_URL   默认 https://api.90087.cn/v1（可换任何 OpenAI 兼容端点；带不带 /v1 都行）
//   AI_MODEL      模型名，默认 gpt-5.4
//   AI_TIMEOUT_MS 单次请求超时，默认 120000
//   AI_MAX_TOKENS 默认 3000

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export class AIConfigError extends Error {}
export class AIUpstreamError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function endpoint(): string {
  let base = (process.env.AI_BASE_URL ?? "https://api.90087.cn/v1").trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) base = base.slice(0, -"/chat/completions".length);
  if (!/\/v\d+$/.test(base)) base += "/v1";
  return `${base}/chat/completions`;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

export function aiModel(): string {
  return process.env.AI_MODEL ?? "gpt-5.4";
}

/**
 * 调模型。传 onDelta 就走流式（逐段回调），否则一次性返回。
 * 两种方式最终都返回完整文本。
 */
export async function chatCompletion(
  messages: ChatMsg[],
  opts: { onDelta?: (text: string) => void; signal?: AbortSignal; temperature?: number } = {},
): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new AIConfigError("未配置 AI_API_KEY");

  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 120_000);
  const maxTokens = Number(process.env.AI_MAX_TOKENS ?? 3000);
  const stream = Boolean(opts.onDelta);
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  const signal = AbortSignal.any(signals);

  let resp: Response;
  try {
    resp = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiModel(),
        temperature: opts.temperature ?? 0.7,
        max_tokens: maxTokens,
        stream,
        messages,
      }),
      signal,
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AIUpstreamError("模型响应超时");
    }
    throw new AIUpstreamError(`连不上模型服务：${(e as Error).message}`);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error(`[ai] upstream ${resp.status}: ${detail.slice(0, 500)}`);
    if (resp.status === 401 || resp.status === 403) throw new AIUpstreamError("模型服务鉴权失败", resp.status);
    if (resp.status === 402 || /insufficient_(balance|quota)|余额不足|额度不足/i.test(detail)) {
      throw new AIUpstreamError("模型服务额度不足", resp.status);
    }
    if (resp.status === 429) throw new AIUpstreamError("模型服务繁忙，请稍后再试", 429);
    throw new AIUpstreamError(`模型服务返回 ${resp.status}`, resp.status);
  }

  if (!stream) {
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new AIUpstreamError("模型返回了空内容");
    return content;
  }

  if (!resp.body) throw new AIUpstreamError("模型服务没有返回流");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let full = "";
  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let obj: { choices?: { delta?: { content?: string }; message?: { content?: string } }[]; error?: { message?: string } };
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    if (obj.error?.message) throw new AIUpstreamError(`模型服务出错：${obj.error.message}`);
    const piece = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? "";
    if (piece) {
      full += piece;
      opts.onDelta!(piece);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).replace(/\r$/, "");
        pending = pending.slice(nl + 1);
        handleLine(line);
      }
    }
    if (pending.trim()) handleLine(pending.trim());
  } catch (e) {
    if (e instanceof AIUpstreamError) throw e;
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new AIUpstreamError("模型响应超时");
    throw new AIUpstreamError(`读取模型流出错：${(e as Error).message}`);
  }
  if (!full.trim()) throw new AIUpstreamError("模型返回了空内容");
  return full;
}
