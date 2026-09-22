// 知识库：启动时把 knowledge/ 下的 Markdown 切块、建倒排索引（BM25 + 中文二元组），
// 提问时检索最相关的段落喂给模型。全部在内存里完成，不依赖数据库和外部服务。
//
// 语料来源：https://github.com/jangviktor-web/nihaixia （MulanPSL-2.0）

import fs from "node:fs";
import path from "node:path";

export type Chunk = {
  id: number;
  file: string; // 相对 knowledge/ 的路径
  doc: string; // 文件的显示名（首个一级标题）
  title: string; // 文件名 › 二级标题 › 三级标题
  text: string;
  weight: number;
};

export type Hit = { chunk: Chunk; score: number; pinned?: boolean };

const MAX_CHUNK = 1400;
const TARGET_CHUNK = 1000;

// 不进检索索引的文件（说明类、或已整篇进系统提示词）
const SKIP_FILES = new Set([
  "CHANGELOG.md",
  "UPSTREAM_README.md",
  "expression_style.md",
  "distilled_cases.md", // 与 cases/ 重复
  "references/distilled/README.md",
  "references/distilled/audit-notes.md",
  "references/research/combined_reference.md",
]);

// 文件显示名覆盖（默认取首个一级标题）
const DOC_NAMES: Record<string, string> = {
  "SKILL.md": "倪海厦Skill 核心速查",
  "references/distilled/02-acupuncture-quick-ref.md": "针灸速查",
};

// 在跳过的大节里仍要保留的小节
const SKILL_KEEP_HEADINGS = ["常见问题速查"];

// SKILL.md 里这些节是给 Agent 看的规则/索引，已进系统提示词，不当知识块检索
const SKILL_SKIP_HEADINGS = [
  "倪师表达速查卡",
  "F. 新增素材路径索引",
  "关键词索引与检索指南",
  "身份卡",
  "角色扮演规则",
  "回答工作流",
  "深度内容模块",
  "决策启发式",
  "表达DNA",
  "时间线",
  "价值观与反模式",
  "智识谱系",
  "内在张力",
  "诚实边界",
];

function skipSection(rel: string, headingPath: string[]): boolean {
  if (rel !== "SKILL.md") return false;
  if (headingPath.some((h) => SKILL_KEEP_HEADINGS.some((s) => h.startsWith(s)))) return false;
  return headingPath.some((h) => SKILL_SKIP_HEADINGS.some((s) => h.startsWith(s)));
}

function fileWeight(rel: string): number {
  if (rel.startsWith("references/distilled/")) return 1.25;
  if (rel === "SKILL.md") return 1.15;
  if (rel.startsWith("modules/")) return 1.0;
  if (rel.startsWith("cases/") || rel === "distilled_cases.md") return 0.9;
  if (rel.startsWith("references/research/")) return 0.5;
  return 1.0;
}

export function knowledgeDir(): string {
  return process.env.KNOWLEDGE_DIR ?? path.resolve(process.cwd(), "knowledge");
}

// ── 分词：ASCII 词 + 中文二元组 ─────────────────────────────
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const norm = s.toLowerCase();
  for (const m of norm.matchAll(/[a-z0-9]+(?:\.[0-9]+)?/g)) out.push(m[0]);
  for (const m of norm.matchAll(/[㐀-鿿]+/g)) {
    const run = m[0];
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

// 提问里的套话（"这是什么证""用什么方""怎么办"）对检索只有干扰，先剥掉
const QUERY_NOISE =
  /这是什么证|是什么证|什么证|用什么方|开什么方|什么方子|什么方|怎么办|怎么治|怎么看|怎么样|怎么|如何|什么|为什么|请问|我想问|想问一下|帮我看看|帮我|一下|可以吗|行吗|好不好|是不是|有没有|对不对|能不能|应该|需要|倪师|倪老师|老师|您好|你好|谢谢|请|吗|呢|啊|吧|的话/g;

export function cleanQuery(q: string): string {
  const cleaned = q.replace(QUERY_NOISE, " ").replace(/\s+/g, " ").trim();
  // 剥完什么都不剩（"怎么办"这种）就用原句
  return cleaned.replace(/[^\u3400-\u9fffa-zA-Z0-9]/g, "").length >= 2 ? cleaned : q;
}

function cleanHeading(h: string): string {
  return h
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 切块 ────────────────────────────────────────────────────
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const pieces: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  const push = () => {
    if (buf.trim()) pieces.push(buf.trim());
    buf = "";
  };
  for (const p of paras) {
    if (p.length > MAX_CHUNK) {
      push();
      // 段落本身太长（多半是表格或无空行的长文）：按行再切
      let lb = "";
      for (const line of p.split("\n")) {
        if (line.length > MAX_CHUNK) {
          if (lb.trim()) pieces.push(lb.trim());
          lb = "";
          for (let i = 0; i < line.length; i += TARGET_CHUNK) {
            pieces.push(line.slice(i, i + TARGET_CHUNK));
          }
          continue;
        }
        if (lb.length + line.length + 1 > TARGET_CHUNK && lb.trim()) {
          pieces.push(lb.trim());
          lb = "";
        }
        lb += line + "\n";
      }
      if (lb.trim()) pieces.push(lb.trim());
      continue;
    }
    if (buf.length + p.length + 2 > TARGET_CHUNK && buf.trim()) push();
    buf += p + "\n\n";
  }
  push();
  return pieces;
}

export function chunkMarkdown(rel: string, content: string, startId: number): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split("\n");
  const weight = fileWeight(rel);
  let doc = "";
  let h1 = "";
  const stack: string[] = []; // 索引 = 标题层级-2（二级标题起）
  let buf: string[] = [];
  let id = startId;

  const titleOf = () => {
    const parts = stack.filter(Boolean);
    return [DOC_NAMES[rel] ?? (doc || path.basename(rel, ".md")), ...parts].join(" › ");
  };
  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text.length < 20) return; // 只有标题没有正文的空节
    if (skipSection(rel, [h1, ...stack.filter(Boolean)])) return;
    const title = titleOf();
    for (const piece of splitLong(text)) {
      chunks.push({ id: id++, file: rel, doc: doc || rel, title, text: piece, weight });
    }
  };

  for (const line of lines) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) {
      buf.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    const heading = cleanHeading(m[2]);
    if (level === 1) {
      if (!doc) doc = heading;
      h1 = heading;
      stack.length = 0;
      continue;
    }
    stack.length = level - 1;
    stack[level - 2] = heading;
    // 把标题本身也算进正文，检索时能命中方名/条文号
    buf.push(heading);
  }
  flush();
  return chunks;
}

// ── 索引 ────────────────────────────────────────────────────
type Postings = { ids: Uint32Array; tfs: Uint16Array };

export class KnowledgeIndex {
  readonly chunks: Chunk[] = [];
  /** 语料里出现过的方名（xx汤/散/丸…），按长度降序，用于检索加权 */
  readonly formulaDict: string[] = [];
  /** 方名 → 该方"原方组成/剂量"最靠谱的 1～2 个块，回答涉方时强制带上 */
  private formulaChunks = new Map<string, number[]>();
  private postings = new Map<string, Postings>();
  private docLen: Float32Array = new Float32Array(0);
  private avgLen = 1;

  static fromDir(dir: string): KnowledgeIndex {
    const idx = new KnowledgeIndex();
    const files = walk(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.relative(dir, f).split(path.sep).join("/"))
      .filter((rel) => !SKIP_FILES.has(rel))
      .sort();
    let id = 0;
    for (const rel of files) {
      const content = fs.readFileSync(path.join(dir, rel), "utf8");
      const cs = chunkMarkdown(rel, content, id);
      id += cs.length;
      idx.chunks.push(...cs);
    }
    idx.build();
    return idx;
  }

  static fromChunks(chunks: Chunk[]): KnowledgeIndex {
    const idx = new KnowledgeIndex();
    idx.chunks.push(...chunks.map((c, i) => ({ ...c, id: i })));
    idx.build();
    return idx;
  }

  private build() {
    const dict = new Set<string>();
    for (const c of this.chunks) {
      for (const n of extractFormulaNames(c.title)) dict.add(n);
      if (c.file.startsWith("references/distilled/") || c.file === "SKILL.md") {
        for (const n of extractFormulaNames(c.text)) dict.add(n);
      }
    }
    this.formulaDict.push(...Array.from(dict).sort((a, b) => b.length - a.length));
    this.buildFormulaChunks();

    const tmp = new Map<string, number[]>(); // token -> [id, tf, id, tf, ...]
    this.docLen = new Float32Array(this.chunks.length);
    let total = 0;
    for (const c of this.chunks) {
      const toks = tokenize(c.title + "\n" + c.text);
      this.docLen[c.id] = toks.length;
      total += toks.length;
      const counts = new Map<string, number>();
      for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [t, n] of counts) {
        let arr = tmp.get(t);
        if (!arr) tmp.set(t, (arr = []));
        arr.push(c.id, Math.min(n, 65535));
      }
    }
    this.avgLen = this.chunks.length ? total / this.chunks.length : 1;
    for (const [t, arr] of tmp) {
      const n = arr.length / 2;
      const ids = new Uint32Array(n);
      const tfs = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        ids[i] = arr[i * 2];
        tfs[i] = arr[i * 2 + 1];
      }
      this.postings.set(t, { ids, tfs });
    }
  }

  private buildFormulaChunks() {
    // "麻黄汤"不能匹配到"射干麻黄汤"：出现位置前一个字不能是汉字
    const hasExact = (s: string, name: string): boolean => {
      let i = s.indexOf(name);
      while (i >= 0) {
        const prev = i > 0 ? s.charCodeAt(i - 1) : 0;
        if (!(prev >= 0x3400 && prev <= 0x9fff)) return true;
        i = s.indexOf(name, i + 1);
      }
      return false;
    };
    const dosage = /[一二三四五六七八九十半两升枚个斤合钱]\s*[)）]|[(（][一二三四五六七八九十半]+[两升枚个斤合钱]/;
    for (const name of this.formulaDict) {
      const scored: { id: number; s: number }[] = [];
      for (const c of this.chunks) {
        const inTitle = hasExact(c.title, name);
        if (!inTitle && !hasExact(c.text, name)) continue;
        let s = 0;
        if (inTitle) s += 2;
        if (inTitle && (c.title.endsWith(name + "方") || c.title.includes(name + "组成") || c.title.includes(name + "方剂"))) s += 4;
        if (c.text.includes(`| ${name} |`) || c.text.includes(`| **${name}** |`)) s += 4; // 剂量速查表的行
        if (hasExact(c.text, name + "方")) s += 1;
        if (dosage.test(c.text)) s += 2;
        if (c.file.startsWith("references/distilled/")) s += 1;
        if (s >= 4) scored.push({ id: c.id, s });
      }
      if (!scored.length) continue;
      scored.sort((a, b) => b.s - a.s);
      this.formulaChunks.set(
        name,
        scored.slice(0, 2).map((x) => x.id),
      );
    }
  }

  /** 该方的原方/剂量块 id */
  formulaChunkIds(name: string): number[] {
    return this.formulaChunks.get(name) ?? [];
  }

  search(query: string, opts: { limit?: number; maxChars?: number; perFile?: number; pinnedMaxChars?: number } = {}): Hit[] {
    const limit = opts.limit ?? 8;
    const maxChars = opts.maxChars ?? 9000;
    const perFile = opts.perFile ?? 3;
    const N = this.chunks.length;
    if (!N) return [];
    const k1 = 1.2;
    const b = 0.75;
    const qToks = Array.from(new Set(tokenize(cleanQuery(query))));
    const scores = new Float64Array(N);
    for (const t of qToks) {
      const p = this.postings.get(t);
      if (!p) continue;
      const df = p.ids.length;
      // 出现在一半以上块里的二元组（"我们""这个"）几乎没有区分度，直接跳过
      if (df > N * 0.5) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let i = 0; i < df; i++) {
        const id = p.ids[i];
        const tf = p.tfs[i];
        const dl = this.docLen[id];
        scores[id] += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / this.avgLen)));
      }
    }
    // 取前 60 个候选再做标题加权与多样性
    const cand: number[] = [];
    for (let i = 0; i < N; i++) if (scores[i] > 0) cand.push(i);
    cand.sort((a, c) => scores[c] - scores[a]);
    const top = cand.slice(0, 60);

    const names = formulaNames(query, this.formulaDict);
    const qBigrams = qToks.filter((t) => t.length === 2 && /[㐀-鿿]/.test(t));
    const hits: Hit[] = top.map((id) => {
      const c = this.chunks[id];
      let s = scores[id] * c.weight;
      const tl = c.title.toLowerCase();
      if (names.some((n) => tl.includes(n))) s *= 1.6;
      else if (qBigrams.filter((bg) => tl.includes(bg)).length >= 2) s *= 1.25;
      if (names.some((n) => c.text.includes(n))) s *= 1.15;
      return { chunk: c, score: s };
    });
    hits.sort((a, c) => c.score - a.score);

    const out: Hit[] = [];
    const perFileCount = new Map<string, number>();
    let chars = 0;
    for (const h of hits) {
      const n = perFileCount.get(h.chunk.file) ?? 0;
      if (n >= perFile) continue;
      if (chars + h.chunk.text.length > maxChars && out.length > 0) continue;
      out.push(h);
      perFileCount.set(h.chunk.file, n + 1);
      chars += h.chunk.text.length;
      if (out.length >= limit) break;
    }

    // 涉方必带原方：问题里点名的方 + 前 5 个命中标题里出现的方，各补 1～2 块组成/剂量
    const mentioned = new Set<string>(names);
    for (const h of out.slice(0, 5)) for (const n of formulaNames(h.chunk.title, this.formulaDict)) mentioned.add(n);
    const have = new Set(out.map((h) => h.chunk.id));
    let pinnedChars = 0;
    for (const name of Array.from(mentioned).slice(0, 4)) {
      for (const id of this.formulaChunkIds(name)) {
        if (have.has(id)) continue;
        const c = this.chunks[id];
        if (pinnedChars + c.text.length > (opts.pinnedMaxChars ?? 5000)) continue;
        out.push({ chunk: c, score: 0, pinned: true });
        have.add(id);
        pinnedChars += c.text.length;
      }
    }
    return out;
  }
}

// 先按非汉字和常见连接字/虚词切段（"加""合""去"是方名的一部分，不能切），再在段内找 xx汤/散/丸
const SEGMENT_SPLIT =
  /[^一-鿿]+|和|与|及|或|用|吃|喝|服|开|把|跟|是|了|的|个|给|要|想|问|说|看|比|像|叫|这|那|能|可|该|就|都|再|还|先|如|宜|者|症|证|谓|之|于|凡|夫|不|无|仍|致|后|前|上|下|则|而|即|亦|乃|但|若|其|此|为|有|在|以/;
const FORMULA_RE = /[一-鿿]{2,9}?(?:汤|散|丸)/g;

/** 从一段文本里抓所有看起来像方名的词（建词典用，宽松） */
export function extractFormulaNames(text: string): string[] {
  const out = new Set<string>();
  for (const seg of text.split(SEGMENT_SPLIT)) {
    if (seg.length < 3) continue;
    for (const m of seg.matchAll(FORMULA_RE)) {
      if (m[0].length >= 3 && m[0].length <= 10) out.add(m[0]);
    }
  }
  return Array.from(out);
}

/**
 * 从问题里抓方名，只用于检索加权。
 * 有词典时按词典精确匹配（长的优先，避免"桂枝汤"盖掉"桂枝加葛根汤"）；没词典时退回正则。
 */
export function formulaNames(q: string, dict?: string[]): string[] {
  if (dict && dict.length) {
    const out: string[] = [];
    let rest = q;
    for (const name of dict) {
      if (rest.includes(name)) {
        out.push(name);
        rest = rest.split(name).join(" ");
      }
    }
    return out;
  }
  return extractFormulaNames(q);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ── 系统提示词：从 SKILL.md / expression_style.md 按标题抽取 ──────
type Section = { level: number; title: string; start: number; end: number };

export function parseSections(md: string): { lines: string[]; sections: Section[] } {
  const lines = md.split("\n");
  const heads: { level: number; title: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: cleanHeading(m[2]), line: i });
  });
  const sections: Section[] = heads.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line;
        break;
      }
    }
    return { level: h.level, title: h.title, start: h.line, end };
  });
  return { lines, sections };
}

function pick(md: string, titles: string[]): string {
  const { lines, sections } = parseSections(md);
  const out: string[] = [];
  for (const want of titles) {
    const s = sections.find((x) => x.title.startsWith(want));
    if (!s) continue;
    out.push(lines.slice(s.start, s.end).join("\n").trim());
  }
  return out.join("\n\n");
}

export type PromptProfile = "full" | "lite";

const FULL_SKILL_SECTIONS = [
  "倪师表达速查卡",
  "身份卡",
  "回答前强制步骤",
  "用药授权",
  "回答安全策略",
  "核心理论铁律",
  "Step 3: 倪海厦式回答",
  "六经速查表",
  "关键方剂速查",
  "峻药剂量速查",
  "方剂剂量速查卡",
  "剂量换算标准",
  "七步走辨证思维模式",
  "用药铁律",
  "误治急救方案",
  "表达DNA",
  "诚实边界",
];

const LITE_SKILL_SECTIONS = [
  "倪师表达速查卡",
  "身份卡",
  "用药授权",
  "回答安全策略",
  "核心理论铁律",
  "六经速查表",
  "关键方剂速查",
  "七步走辨证思维模式",
  "用药铁律",
  "禁忌表达",
  "绝对不应该出现的话",
];

const LITE_STYLE_SECTIONS = ["七、常用词汇", "八、句式结构模板", "九、完整回答范式"];

export const SITE_PREAMBLE = `你正在"倪海厦Skill·经方中医AI"网站上运行，是开源项目 nihaixia skill 的在线演示。

【检索方式】你自己没有文件系统。系统已经根据用户的问题，从 skill 的知识库（伤寒论、金匮要略、黄帝内经、神农本草经、医案、速查表）里检索出最相关的段落，放在用户消息末尾的〔参考资料〕里。下面规则里凡是要求你"去 modules/ 或 references/ 检索"的地方，一律以〔参考资料〕为准。

【硬性要求】
1. 方剂组成、剂量、条文原文只能引用〔参考资料〕里出现的内容；参考资料里没有的，写"⚠未核对到原文"并省略剂量，禁止凭记忆编造。
2. 回答里禁止出现任何文件名、路径、行号、"源XXXX"、"参考资料"这类定位或来源字样。
3. 这是网页对话，篇幅控制在 500～900 字；用户明确要求详细时可以放宽。
4. 用 Markdown 输出（表格、加粗、引用块），网页会渲染。
5. 文末固定免责框按规则输出一次，不多不少。
6. 用户提到自己或家人有急性危重症状（胸痛大汗、出血不止、昏迷、偏瘫、剧烈腹痛等）时，免责框用急救版。

下面是 skill 的角色与规则原文。`;

export function buildCorePrompt(dir: string, profile: PromptProfile): string {
  const skill = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const style = fs.readFileSync(path.join(dir, "expression_style.md"), "utf8");
  const parts = [SITE_PREAMBLE];
  if (profile === "full") {
    parts.push(pick(skill, FULL_SKILL_SECTIONS));
    parts.push("# 倪海厦口述表达方式（expression_style.md 全文）\n\n" + style.trim());
  } else {
    parts.push(pick(skill, LITE_SKILL_SECTIONS));
    parts.push("# 倪海厦口述表达方式（节选）\n\n" + pick(style, LITE_STYLE_SECTIONS));
  }
  return parts.join("\n\n---\n\n");
}

// ── 单例 ────────────────────────────────────────────────────
let _index: KnowledgeIndex | null = null;
let _core: string | null = null;

export function getIndex(): KnowledgeIndex {
  if (!_index) {
    const t0 = Date.now();
    _index = KnowledgeIndex.fromDir(knowledgeDir());
    console.log(`[knowledge] ${_index.chunks.length} chunks indexed from ${knowledgeDir()} in ${Date.now() - t0}ms`);
  }
  return _index;
}

export function getCorePrompt(): string {
  if (_core === null) {
    const profile: PromptProfile = process.env.AI_PROMPT_PROFILE === "lite" ? "lite" : "full";
    _core = buildCorePrompt(knowledgeDir(), profile);
    console.log(`[knowledge] core prompt (${profile}): ${_core.length} chars`);
  }
  return _core;
}

export function formatReferences(hits: Hit[]): string {
  if (!hits.length) return "〔参考资料〕（本次未检索到直接相关的段落；库内无专条时请按规则先声明，再按六经辨证给思路）";
  const body = hits
    .map((h, i) => `[${i + 1}]${h.pinned ? "【原方/剂量】" : ""} ${h.chunk.title}\n${h.chunk.text}`)
    .join("\n\n");
  return `〔参考资料〕（系统从知识库检索，供你引用；不要向用户提及这一节的存在）\n\n${body}`;
}
