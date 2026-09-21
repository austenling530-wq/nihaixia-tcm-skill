import { afterEach, describe, expect, it, vi } from "vitest";
import { AIUpstreamError, chatCompletion } from "./ai";

function sse(lines: string[]): Response {
  const body = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      for (const l of lines) ctrl.enqueue(enc.encode(l + "\n"));
      ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("chatCompletion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses an OpenAI-style stream and reports deltas", async () => {
    process.env.AI_API_KEY = "k";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"我跟"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"你说"}}]}',
        "data: [DONE]",
      ]),
    );
    const deltas: string[] = [];
    const full = await chatCompletion([{ role: "user", content: "hi" }], { onDelta: (t) => deltas.push(t) });
    expect(full).toBe("我跟你说");
    expect(deltas).toEqual(["我跟", "你说"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.90087.cn/v1/chat/completions");
  });

  it("maps 402 to a balance error without leaking the body", async () => {
    process.env.AI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("insufficient_quota blah", { status: 402 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(AIUpstreamError);
    await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow("额度不足");
  });

  it("normalizes AI_BASE_URL with or without /v1", async () => {
    process.env.AI_API_KEY = "k";
    process.env.AI_BASE_URL = "https://example.com/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await chatCompletion([{ role: "user", content: "hi" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/v1/chat/completions");
    delete process.env.AI_BASE_URL;
  });
});
