/**
 * Client Adapter — 客户端兼容性适配层
 *
 * 定位：MiniRouter 网关原则上原样透传请求体（只替换 model 字段）。
 * 但部分客户端发出的请求体，在某些上游供应商的严格 schema 校验下会
 * 被 400 拒绝。本模块就是为了解决这些"客户端 vs 上游"的兼容性 gap。
 *
 * 设计原则：
 * 1. 最小改动 — 只修复已知的、可复现的兼容问题，不"帮用户改格式"
 * 2. 可观测 — 每次修改 body 必须打印日志，标注 adapter 名称和改动内容
 * 3. 幂等 — 同一个 adapter 运行多次结果相同
 * 4. 不破坏原生性 — 不做格式转换（如 Anthropic → OpenAI），只做补丁
 * 5. 新增 adapter 必须附带注释说明：触发客户端、报错场景、改动内容
 *
 * 适配器注册表（按执行顺序）：
 *
 * | # | adapter              | 触发客户端   | 问题                                         | 改动                    |
 * |---|----------------------|-------------|----------------------------------------------|------------------------|
 * | 1 | fixEmptyImageDetail  | Claude Code | image_url.detail="" 被上游 400                | "" → "auto"            |
 * | 2 | removeThinkingConfig | Claude Code | thinking: {type} 被转为 thinking_budget=0 400 | 直接移除 thinking 字段  |
 *
 * 如何添加新 adapter：
 * 1. 在下方定义函数：(body) => Record<string, unknown>
 * 2. 函数签名：接收 body，返回 body（可以是原对象或浅拷贝）
 * 3. 只有 body 被修改时才 console.log，格式：
 *    [client-adapter] <adapter-id> → <brief description>
 * 4. 将函数 push 到 adapters 数组
 */

/**
 * [Adapter] fixEmptyImageDetail
 *
 * 触发客户端：Claude Code（发 vision 请求时 image_url.detail 为空字符串）
 * 报错场景：Claude Code 发 image_url.detail="" 或 undefined，上游严格校验后 400。
 *           "detail: invalid value: ``, supported values: low/high/xhigh/auto"
 * 改动内容：将 detail: "" 或 detail: undefined 改为 detail: "auto"
 * 影响范围：OpenAI 兼容路由 + Anthropic 路由
 */
function fixEmptyImageDetail(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;

  let mutated = false;
  const messages = body.messages.map((msg: unknown) => {
    if (typeof msg !== "object" || msg === null) return msg;
    const record = msg as Record<string, unknown>;
    const content = record["content"];
    if (typeof content === "string" || !Array.isArray(content)) return msg;

    return {
      ...record,
      content: content.map((part: unknown) => {
        if (typeof part !== "object" || part === null) return part;
        const pr = part as Record<string, unknown>;
        if (pr["type"] !== "image_url") return part;

        const img = pr["image_url"];
        if (typeof img !== "object" || img === null) return part;
        const imgRec = img as Record<string, unknown>;
        const detail = imgRec["detail"];

        if (detail === "" || detail == null) {
          mutated = true;
          const copy = { ...imgRec };
          copy["detail"] = "auto";
          return { ...pr, image_url: copy };
        }
        return part;
      }),
    };
  });

  if (mutated) {
    console.log("[client-adapter] fixEmptyImageDetail → detail: '' → 'auto'");
  }

  return { ...body, messages };
}

/**
 * [Adapter] removeThinkingConfig
 *
 * 触发客户端：Claude Code（开启 thinking 模式时发送 thinking 参数）
 * 报错场景：Claude Code 发 thinking: {type: "adaptive"}，胜算云内部将其转为
 *           thinking_budget=0 传给上游模型，上游返回：
 *           400 "thinking_budget must be a positive integer and not greater than 0"
 * 改动内容：移除 thinking 对象（非 vision 模型不支持 thinking，保留无意义）
 * 影响范围：OpenAI 兼容路由 + Anthropic 路由
 */
function removeThinkingConfig(body: Record<string, unknown>): Record<string, unknown> {
  const thinking = body["thinking"];
  if (thinking === undefined || thinking === null) return body;

  const copy = { ...body };
  delete copy["thinking"];
  console.log(`[client-adapter] removeThinkingConfig → removed thinking=${JSON.stringify(thinking)}`);
  return copy;
}

// ─── Adapter pipeline ──────────────────────────────────────────────────
// Order matters — each adapter sees the output of the previous one.
const adapters = [fixEmptyImageDetail, removeThinkingConfig];

/**
 * Run all registered client adapters on a request body.
 * Call this before forwarding to any upstream provider.
 */
export function adaptOpenAICompatibleBody(body: Record<string, unknown>): Record<string, unknown> {
  return adapters.reduce((b, adapter) => adapter(b), body);
}