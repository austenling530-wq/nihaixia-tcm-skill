import { describe, expect, it } from "vitest";
import { speakableText, splitForTts, splitJsonObjects } from "./tts";

const sample = `我跟你说，这是**少阴寒化**。

**辨证：少阴寒化（真武汤证）**

| 症状 | 六经归属 | 辨证意义 |
|------|----------|----------|
| 怕冷 | 少阴 | 阳虚不能温煦 |
| 夜尿三四次 | 少阴 | 下焦虚寒 |

> 📜 **伤寒论·第316条**「少阴病，二三日不已……真武汤主之。」
> **原方**：茯苓(三两) 芍药(三两)

- 附子要**棉布包先煎**
1. 少阴禁汗

> ⚠️ 本内容仅用于中医学习与学术研究，不构成医疗诊断。`;

describe("speakableText", () => {
  const t = speakableText(sample);
  it("strips markdown emphasis and emoji", () => {
    expect(t).not.toMatch(/\*|📜|⚠/);
    expect(t).toContain("这是少阴寒化");
  });
  it("turns table rows into sentences and drops separator", () => {
    expect(t).toContain("怕冷，少阴，阳虚不能温煦。");
    expect(t).not.toMatch(/---|\|/);
  });
  it("keeps quotes and lists as plain lines", () => {
    expect(t).toContain("伤寒论·第316条「少阴病");
    expect(t).toContain("附子要棉布包先煎");
    expect(t).toContain("少阴禁汗");
  });
  it("drops the disclaimer", () => {
    expect(t).not.toContain("不构成医疗");
  });
});

describe("splitForTts", () => {
  it("keeps short text as one chunk", () => {
    expect(splitForTts("你好。世界。")).toEqual(["你好。世界。"]);
  });
  it("splits at sentence boundaries under the limit", () => {
    const s = "一二三四五。".repeat(100); // 600 chars
    const chunks = splitForTts(s, 100);
    expect(chunks.length).toBe(7); // 每段最多 16 句 96 字
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(100);
      expect(c.endsWith("。")).toBe(true);
    }
    expect(chunks.join("")).toBe(s);
  });
  it("hard-splits a single overlong sentence", () => {
    const s = "字".repeat(700);
    const chunks = splitForTts(s, 280);
    expect(chunks.every((c) => c.length <= 280)).toBe(true);
    expect(chunks.join("")).toBe(s);
  });
});

describe("splitJsonObjects", () => {
  it("splits concatenated objects with or without newlines", () => {
    const raw = '{"code":0,"data":"AA=="}{"code":0,"data":"BB=="}\n{"code":20000000,"message":"}"}';
    expect([...splitJsonObjects(raw)].map((o) => JSON.parse(o).code)).toEqual([0, 0, 20000000]);
  });
});
