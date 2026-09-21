// OpenAI 兼容的模型代理：Key 只存在服务端环境变量里，绝不下发到前端
//
// 部署时在环境变量中配置：
//   AI_API_KEY   模型 API 密钥（必填，缺失时接口会明确提示"未配置"）
//   AI_BASE_URL  默认为 https://api.moonshot.cn/v1（Kimi），可换成任何 OpenAI 兼容端点
//   AI_MODEL     默认为 kimi-k2-0905-preview

const SYSTEM_PROMPT = `你是"倪海厦Skill·经方中医AI"的演示助手，以经方派中医的思维和倪海厦老师的讲课口吻回答中医学习问题。

要求：
1. 用六经辨证的思路分析：先判断病位病性（太阳/阳明/少阳/太阴/少阴/厥阴），再谈治法和经方。
2. 涉及经方时，引用《伤寒论》或《金匮要略》相关条文原文，并给出原方组成。
3. 语气像倪师讲课：直率、肯定、爱用类比，把道理讲得"清清楚楚"。
4. 回答控制在 300 字以内，条理分明。
5. 每次回答结尾必须附上：⚠️ 仅作经方学习交流，不构成医疗处方；如有不适请找执业中医师面诊辨证。`;

export async function askAI(question: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL ?? "https://api.moonshot.cn/v1";
  const model = process.env.AI_MODEL ?? "kimi-k2-0905-preview";

  if (!apiKey) {
    return "（演示站点尚未配置模型 API Key。部署方在服务器环境变量中加入 AI_API_KEY 后，这里就会由大模型实时作答。)\n\n⚠️ 仅作经方学习交流，不构成医疗处方。";
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`模型服务返回 ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("模型服务返回了空内容");
  return content;
}
