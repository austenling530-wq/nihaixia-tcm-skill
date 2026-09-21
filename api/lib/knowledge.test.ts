import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  KnowledgeIndex,
  buildCorePrompt,
  chunkMarkdown,
  formatReferences,
  formulaNames,
  tokenize,
} from "./knowledge";

const DIR = path.resolve(import.meta.dirname, "../../knowledge");

describe("tokenize", () => {
  it("splits CJK into bigrams and keeps ascii words", () => {
    expect(tokenize("麻黄汤 38.5°C")).toEqual(["38.5", "c", "麻黄", "黄汤"]);
    expect(tokenize("汗")).toEqual(["汗"]);
  });
});

describe("formulaNames", () => {
  it("extracts formula names from a question", () => {
    expect(formulaNames("小柴胡汤和桂枝汤能一起用吗")).toEqual(["小柴胡汤", "桂枝汤"]);
    expect(formulaNames("喝汤好不好")).toEqual([]);
    expect(formulaNames("桂枝加葛根汤和桂枝汤", ["桂枝加葛根汤", "桂枝汤"])).toEqual(["桂枝加葛根汤", "桂枝汤"]);
  });
});

describe("chunkMarkdown", () => {
  it("keeps heading path and splits long sections", () => {
    const md = ["# 文档", "## 二级", "### 三级", ...Array.from({ length: 60 }, (_, i) => `第${i}行，内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容`)].join("\n");
    const cs = chunkMarkdown("x.md", md, 0);
    expect(cs.length).toBeGreaterThan(1);
    expect(cs[0].title).toBe("文档 › 二级 › 三级");
    expect(cs.every((c) => c.text.length <= 1400)).toBe(true);
  });
  it("drops sections with no body", () => {
    expect(chunkMarkdown("x.md", "# a\n## b\n## c\n", 0)).toEqual([]);
  });
});

describe("search on the real knowledge base", () => {
  const idx = KnowledgeIndex.fromDir(DIR);

  it("indexes thousands of chunks and builds a formula dictionary", () => {
    expect(idx.chunks.length).toBeGreaterThan(3000);
    expect(idx.formulaDict).toContain("桂枝汤");
    expect(idx.formulaDict).toContain("大承气汤");
    expect(idx.formulaDict.some((n) => /^(和|用|吃)/.test(n))).toBe(false);
  });

  it("finds 麻黄汤 for a classic 太阳伤寒 question", () => {
    const hits = idx.search("吹冷风后发烧 38.5°C，怕冷不出汗，浑身酸痛，喉咙不痛，这是什么证？用什么方？");
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.chunk.title + h.chunk.text).join("\n");
    expect(joined).toContain("麻黄汤");
  });

  it("finds the formula section when asked by name", () => {
    const hits = idx.search("小建中汤的组成和剂量");
    expect(hits[0].chunk.title + hits[0].chunk.text).toContain("小建中汤");
  });

  it("respects per-file and char caps", () => {
    const hits = idx.search("失眠怎么治", { limit: 8, maxChars: 4000, perFile: 2 });
    const perFile = new Map<string, number>();
    let chars = 0;
    for (const h of hits) {
      perFile.set(h.chunk.file, (perFile.get(h.chunk.file) ?? 0) + 1);
      chars += h.chunk.text.length;
    }
    expect(Math.max(...perFile.values())).toBeLessThanOrEqual(2);
    expect(chars).toBeLessThanOrEqual(4000 + 1400);
  });

  it("formats references without file paths", () => {
    const text = formatReferences(idx.search("桂枝汤"));
    expect(text).toContain("〔参考资料〕");
    expect(text).not.toMatch(/modules\/\d\d_/);
  });
});

describe("buildCorePrompt", () => {
  it("full profile pulls the persona rules and the style guide", () => {
    const p = buildCorePrompt(DIR, "full");
    expect(p).toContain("回答前强制步骤");
    expect(p).toContain("固定免责框模板");
    expect(p).toContain("九、完整回答范式");
    expect(p.length).toBeGreaterThan(25_000);
  });
  it("lite profile is much smaller but keeps the safety box", () => {
    const p = buildCorePrompt(DIR, "lite");
    expect(p).toContain("固定免责框模板");
    expect(p.length).toBeLessThan(25_000);
  });
});
